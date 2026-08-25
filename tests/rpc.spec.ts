import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AttachmentCatalog } from '../src/catalog.js'
import { registerAttachmentRpc } from '../src/rpc.js'
import type { UploadManager } from '../src/uploads.js'
import { ENDPOINTS, hasCurrentRpcProtocol, RPC_PROTOCOL_VERSION } from '../src/wire.js'
import { testContext } from './runtime.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Handler = (endpoint: string, payload: unknown) => Promise<unknown>

describe('attachment RPC protocol boundary', () => {
  it('versions successful and failed responses and rejects a legacy unversioned envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachment-rpc-'))
    try {
      const catalog = await AttachmentCatalog.open(testContext(), { root })
      let handler: Handler | undefined
      const context = {
        connection: {
          rpc: {
            handle(_channel: string, value: Handler) { handler = value },
          },
        },
      } as unknown as Context
      registerAttachmentRpc(context, catalog, {} as UploadManager)
      if (handler === undefined) throw new Error('attachment RPC handler was not registered')

      const listed = await handler(ENDPOINTS.list, { sessionId: 'session-rpc' })
      expect(listed).toEqual({
        ok: true,
        value: { protocolVersion: RPC_PROTOCOL_VERSION, attachments: [] },
      })
      expect(hasCurrentRpcProtocol((listed as { value: unknown }).value)).toBe(true)

      const failed = await handler(ENDPOINTS.list, {})
      expect(failed).toMatchObject({ ok: false })
      expect(hasCurrentRpcProtocol({ attachments: [] })).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
