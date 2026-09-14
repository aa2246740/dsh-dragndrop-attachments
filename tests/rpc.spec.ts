import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it } from 'vitest'
import { UPLOAD_CHUNK_BYTES } from '../src/domain.js'
import { AttachmentCatalog } from '../src/catalog.js'
import { createAttachmentRpcHandler, MAX_RPC_BODY_BYTES, registerAttachmentRpc } from '../src/rpc.js'
import type { UploadManager } from '../src/uploads.js'
import { ATTACHMENT_RPC_CHANNEL, ENDPOINTS, hasCurrentRpcProtocol, RPC_PROTOCOL_VERSION } from '../src/wire.js'
import { testContext } from './runtime.js'

function mockRequest(method: string, url: string, body: unknown): IncomingMessage {
  const payload = Buffer.from(JSON.stringify(body))
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield payload },
    destroy() {},
  } as IncomingMessage
}

function mockResponse() {
  const recorded = { status: 0, body: '' }
  const res = {
    writeHead(status: number) { recorded.status = status },
    end(text?: string) { recorded.body = text ?? '' },
  } as ServerResponse
  return { res, recorded }
}

describe('attachment RPC protocol boundary', () => {
  it('versions successful and failed responses and rejects a legacy unversioned envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachment-rpc-'))
    try {
      const catalog = await AttachmentCatalog.open(testContext(), { root })
      const handler = createAttachmentRpcHandler(catalog, {} as UploadManager)

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

  it('mounts the attachment prefix on this plugin fiber webServer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachment-rpc-http-'))
    try {
      const catalog = await AttachmentCatalog.open(testContext(), { root })
      let route: WebRoute | undefined
      const context = {
        connection: { requestRejection: () => undefined },
        webServer: {
          register(value: WebRoute) {
            route = value
            return () => {}
          },
        },
        effect(install: () => unknown) { install() },
      } as unknown as Context
      registerAttachmentRpc(context, catalog, {} as UploadManager)
      if (route === undefined) throw new Error('attachment RPC route was not registered')
      expect(route.kind).toBe('prefix')
      expect(route.path).toBe(ATTACHMENT_RPC_CHANNEL)

      const { res, recorded } = mockResponse()
      await route.handler(mockRequest('POST', `${ATTACHMENT_RPC_CHANNEL}/${ENDPOINTS.list}`, {
        type: 'client-request',
        rpcId: 'r1',
        method: ENDPOINTS.list,
        payload: { sessionId: 'session-rpc' },
      }), res)
      expect(recorded.status).toBe(200)
      expect(JSON.parse(recorded.body)).toMatchObject({
        type: 'server-response',
        rpcId: 'r1',
        result: { ok: true, value: { protocolVersion: RPC_PROTOCOL_VERSION, attachments: [] } },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts a full binary upload/chunk and keeps JSON control bodies at 1 MiB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachment-rpc-chunk-'))
    try {
      const catalog = await AttachmentCatalog.open(testContext(), { root })
      const uploads = {
        chunkBytes: async (_sessionId: string, _uploadId: string, _index: number, bytes: Uint8Array) => ({ receivedBytes: bytes.byteLength }),
      } as unknown as UploadManager
      let route: WebRoute | undefined
      const context = {
        connection: { requestRejection: () => undefined },
        webServer: {
          register(value: WebRoute) {
            route = value
            return () => {}
          },
        },
        effect(install: () => unknown) { install() },
      } as unknown as Context
      registerAttachmentRpc(context, catalog, uploads)
      if (route === undefined) throw new Error('attachment RPC route was not registered')

      const jsonChunk = mockResponse()
      await route.handler(mockRequest('POST', `${ATTACHMENT_RPC_CHANNEL}/${ENDPOINTS.uploadChunk}`, {
        type: 'client-request',
        rpcId: 'chunk-json',
        method: ENDPOINTS.uploadChunk,
        payload: { sessionId: 'session-rpc', uploadId: 'upload-rpc', index: 0, data: 'YQ==' },
      }), jsonChunk.res)
      expect(jsonChunk.recorded.status).toBe(415)

      const accepted = mockResponse()
      const binary = {
        method: 'POST',
        url: `${ATTACHMENT_RPC_CHANNEL}/${ENDPOINTS.uploadChunk}?sessionId=session-rpc&uploadId=upload-rpc&index=0`,
        headers: { 'content-type': 'application/octet-stream', 'x-dsh-rpc-id': 'chunk-1' },
        async *[Symbol.asyncIterator]() { yield Buffer.alloc(UPLOAD_CHUNK_BYTES) },
        destroy() {},
      } as IncomingMessage
      await route.handler(binary, accepted.res)
      expect(accepted.recorded.status).toBe(200)
      expect(JSON.parse(accepted.recorded.body)).toMatchObject({
        type: 'server-response',
        rpcId: 'chunk-1',
        result: { ok: true, value: { receivedBytes: UPLOAD_CHUNK_BYTES } },
      })

      const oversizedBinary = mockResponse()
      const tooLargeBinary = {
        method: 'POST',
        url: `${ATTACHMENT_RPC_CHANNEL}/${ENDPOINTS.uploadChunk}?sessionId=session-rpc&uploadId=upload-rpc&index=0`,
        headers: { 'content-type': 'application/octet-stream', 'x-dsh-rpc-id': 'chunk-2' },
        async *[Symbol.asyncIterator]() { yield Buffer.alloc(UPLOAD_CHUNK_BYTES + 1) },
        destroy() {},
      } as IncomingMessage
      await route.handler(tooLargeBinary, oversizedBinary.res)
      expect(oversizedBinary.recorded.status).toBe(413)

      const oversizedJson = mockResponse()
      const tooLargeJson = {
        method: 'POST',
        url: `${ATTACHMENT_RPC_CHANNEL}/${ENDPOINTS.list}`,
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() { yield Buffer.alloc(MAX_RPC_BODY_BYTES + 1) },
        destroy() {},
      } as IncomingMessage
      await route.handler(tooLargeJson, oversizedJson.res)
      expect(oversizedJson.recorded.status).toBe(413)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
