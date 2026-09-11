import type { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentCatalog } from '../src/catalog.js'
import { apply as applyClient } from '../src/client/index.js'
import type { AttachmentDockInjected } from '../src/client/AttachmentDock.js'
import { createAttachmentRpcHandler } from '../src/rpc.js'
import { UploadManager } from '../src/uploads.js'
import { ENDPOINTS } from '../src/wire.js'
import { testContext } from './runtime.js'

const roots: string[] = []
const managers: UploadManager[] = []

async function openCatalog(): Promise<AttachmentCatalog> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upload-slots-'))
  roots.push(root)
  return AttachmentCatalog.open(testContext(), { root })
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function unwrap<T>(result: unknown): T {
  expect(result).toMatchObject({ ok: true })
  return (result as { readonly value: T }).value
}

describe('upload slot lifecycle', () => {
  it('round-trips exact browser Base64 chunks through the Host RPC and commits once', async () => {
    const catalog = await openCatalog()
    const uploads = await UploadManager.open(catalog)
    managers.push(uploads)
    const handler = createAttachmentRpcHandler(catalog, uploads)

    const source = new TextEncoder().encode('真实上传字节\r\nline 2\nemoji: 🧪\n')
    const begun = unwrap<{ readonly uploadId: string }>(await handler(ENDPOINTS.uploadBegin, {
      sessionId: 'rpc-byte-session', name: 'exact.txt', bytes: source.byteLength,
    }))
    let index = 0
    for (let offset = 0; offset < source.byteLength; offset += 7) {
      const chunk = source.slice(offset, Math.min(source.byteLength, offset + 7))
      unwrap(await handler(ENDPOINTS.uploadChunk, {
        sessionId: 'rpc-byte-session', uploadId: begun.uploadId, index, data: Buffer.from(chunk).toString('base64'),
      }))
      index += 1
    }
    const record = unwrap<Awaited<ReturnType<AttachmentCatalog['resolve']>>>(await handler(ENDPOINTS.uploadCommit, {
      sessionId: 'rpc-byte-session', uploadId: begun.uploadId,
    }))

    expect(await catalog.readText(record)).toBe(new TextDecoder().decode(source))
    expect(await readdir(join(catalog.root, 'tmp', 'uploads'))).toEqual([])
  })

  it('cancels every in-flight upload for one browser session without touching another session', async () => {
    const catalog = await openCatalog()
    const uploads = await UploadManager.open(catalog)
    managers.push(uploads)
    const first = await uploads.begin('closing-session', 'one.txt', 3)
    const second = await uploads.begin('closing-session', 'two.txt', 3)
    const survivor = await uploads.begin('other-session', 'three.txt', 3)

    expect(await uploads.cancelSession('closing-session')).toBe(2)
    await expect(uploads.chunk('closing-session', first.uploadId, 0, 'YWJj')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(uploads.chunk('closing-session', second.uploadId, 0, 'YWJj')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(uploads.chunk('other-session', survivor.uploadId, 0, 'YWJj')).resolves.toEqual({ receivedBytes: 3 })
  })

  it('keeps two clients in the same DSH session isolated by upload id', async () => {
    let slot: { readonly inject: (sessionId: string) => AttachmentDockInjected } | undefined
    let nextUpload = 0
    const chunkResolvers = new Map<string, (value: unknown) => void>()
    const cancelled: string[] = []
    const record = {
      schemaVersion: 'dsh-codex-attachment.v1', attachmentId: 'record-1', sessionId: 'same-session', name: 'done.txt',
      kind: 'text', mediaType: 'text/plain', bytes: 3, sha256: '0'.repeat(64), status: 'READY', pending: true,
      committed: false, createdAt: new Date(0).toISOString(), preview: 'abc', warnings: [], ref: {},
    }
    const connection = { rpc: { call: async (_channel: string, endpoint: string, payload: unknown): Promise<unknown> => {
      const request = payload as Record<string, unknown>
      if (endpoint === ENDPOINTS.list) return { ok: true, value: { protocolVersion: 2, attachments: [] } }
      if (endpoint === ENDPOINTS.uploadBegin) return { ok: true, value: { uploadId: `upload-${++nextUpload}`, chunkBytes: 10 } }
      if (endpoint === ENDPOINTS.uploadChunk) return new Promise(resolve => { chunkResolvers.set(String(request.uploadId), resolve) })
      if (endpoint === ENDPOINTS.uploadCancel) {
        cancelled.push(String(request.uploadId))
        return { ok: true, value: { cancelled: true } }
      }
      if (endpoint === ENDPOINTS.uploadCommit) return { ok: true, value: record }
      throw new Error(`unexpected endpoint ${endpoint}`)
    } } }
    const context = {
      effect() {}, inject() {}, get: (name: string) => name === 'connection' ? connection : undefined,
      slots: {
        inject(_name: string, install: () => unknown) { install() },
        register(value: { readonly inject: (sessionId: string) => AttachmentDockInjected }) { slot = value },
      },
    } as unknown as Context
    applyClient(context)
    if (slot === undefined) throw new Error('attachment slot was not registered')
    const clientA = slot.inject('same-session')
    const clientB = slot.inject('same-session')
    const uploadA = clientA.upload({ kind: 'file', file: new File(['aaa'], 'a.txt') }, () => {})
    const uploadB = clientB.upload({ kind: 'file', file: new File(['bbb'], 'b.txt') }, () => {})
    for (let attempt = 0; attempt < 20 && chunkResolvers.size < 2; attempt += 1) await new Promise(resolve => setTimeout(resolve, 0))
    expect([...chunkResolvers.keys()].sort()).toEqual(['upload-1', 'upload-2'])

    await clientA.releaseUploads()
    expect(cancelled).toEqual(['upload-1'])
    // A remounted dock reuses its cached injection; old work must stay cancelled.
    clientA.activateUploads()
    const afterRemount = clientA.upload({ kind: 'file', file: new File(['ccc'], 'after-paste.txt') }, () => {})
    for (let attempt = 0; attempt < 20 && !chunkResolvers.has('upload-3'); attempt += 1) await new Promise(resolve => setTimeout(resolve, 0))
    expect(chunkResolvers.has('upload-3')).toBe(true)
    chunkResolvers.get('upload-3')?.({ ok: true, value: { receivedBytes: 3 } })
    await expect(afterRemount).resolves.toMatchObject({ attachmentId: 'record-1' })
    chunkResolvers.get('upload-1')?.({ ok: true, value: { receivedBytes: 3 } })
    chunkResolvers.get('upload-2')?.({ ok: true, value: { receivedBytes: 3 } })
    await expect(uploadA).rejects.toThrow('附件上传已取消')
    await expect(uploadB).resolves.toMatchObject({ attachmentId: 'record-1' })
    expect(cancelled.every(uploadId => uploadId === 'upload-1')).toBe(true)
  })

  it('reclaims an idle slot before enforcing the global concurrency limit', async () => {
    let now = 1_000
    const catalog = await openCatalog()
    const uploads = await UploadManager.open(catalog, {
      idleTimeoutMs: 100,
      sweepIntervalMs: 60_000,
      maxConcurrentUploads: 1,
      now: () => now,
    })
    managers.push(uploads)
    const stale = await uploads.begin('stale-session', 'stale.txt', 3)
    await expect(uploads.begin('next-session', 'blocked.txt', 3)).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    now += 101
    const replacement = await uploads.begin('next-session', 'replacement.txt', 3)
    await expect(uploads.chunk('stale-session', stale.uploadId, 0, 'YWJj')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(uploads.chunk('next-session', replacement.uploadId, 0, 'YWJj')).resolves.toEqual({ receivedBytes: 3 })
  })

  it('counts concurrent begin reservations against the global limit', async () => {
    const catalog = await openCatalog()
    const uploads = await UploadManager.open(catalog, { maxConcurrentUploads: 2 })
    managers.push(uploads)

    const results = await Promise.allSettled([
      uploads.begin('parallel-session', 'one.txt', 3),
      uploads.begin('parallel-session', 'two.txt', 3),
      uploads.begin('parallel-session', 'three.txt', 3),
      uploads.begin('parallel-session', 'four.txt', 3),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(2)
    expect(await uploads.cancelSession('parallel-session')).toBe(2)
  })

  it('cancels a begin that has entered the session but has not created its slot file yet', async () => {
    const catalog = await openCatalog()
    const uploads = await UploadManager.open(catalog)
    managers.push(uploads)
    const starting = uploads.begin('cancel-race-session', 'race.txt', 3)

    expect(await uploads.cancelSession('cancel-race-session')).toBe(1)
    await expect(starting).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await readdir(join(catalog.root, 'tmp', 'uploads'))).toEqual([])
  })

  it('closes the begin gate before waiting for an in-flight file creation', async () => {
    const catalog = await openCatalog()
    const uploads = await UploadManager.open(catalog)
    managers.push(uploads)
    const starting = uploads.begin('closing-runtime', 'race.txt', 3)

    await uploads.close()
    await expect(starting).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(uploads.begin('closing-runtime', 'later.txt', 3)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await readdir(join(catalog.root, 'tmp', 'uploads'))).toEqual([])
  })
})
