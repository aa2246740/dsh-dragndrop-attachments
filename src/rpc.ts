import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { AttachmentPluginError, normalizedError, UPLOAD_CHUNK_BYTES } from './domain.js'
import type { AttachmentCatalog } from './catalog.js'
import type { UploadManager } from './uploads.js'
import { ATTACHMENT_RPC_CHANNEL, ENDPOINTS, isRecord, requiredInteger, requiredString, RPC_PROTOCOL_VERSION } from './wire.js'

const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/
/** JSON control messages only. File bytes use `upload/chunk` as octet-stream. */
export const MAX_RPC_BODY_BYTES = 1_048_576
const BINARY_CHUNK_HEADER = 'x-dsh-rpc-id'

function success<T>(value: T) {
  return { ok: true as const, value }
}

function failure(error: unknown) {
  const normalized = error instanceof AttachmentPluginError
    ? error
    : error instanceof Error && !('code' in error)
      ? new AttachmentPluginError(error.message, 'BAD_REQUEST')
      : normalizedError(error)
  return {
    ok: false as const,
    error: {
      code: 'internal' as const,
      message: `[${normalized.code}] ${normalized.message} ${normalized.action}`,
      details: {},
    },
  }
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${field} must be an array of strings`)
  return value
}

function attachmentEndpointFromUrl(url: string | undefined): string | undefined {
  const path = (url ?? '').split('?')[0] ?? ''
  if (!path.startsWith(`${ATTACHMENT_RPC_CHANNEL}/`)) return undefined
  const endpoint = path.slice(ATTACHMENT_RPC_CHANNEL.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT.test(segment))) {
    return undefined
  }
  return endpoint
}

function writeRpc(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

async function readBoundedBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array | 'too-large'> {
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > maxBytes) {
      req.destroy()
      return 'too-large'
    }
    chunks.push(buffer)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

async function handleBinaryUploadChunk(req: IncomingMessage, res: ServerResponse, uploads: UploadManager, mediaType: string | undefined): Promise<void> {
  if (mediaType !== 'application/octet-stream') {
    writeRpc(res, 415, 'upload/chunk requires application/octet-stream')
    return
  }
  const url = new URL(req.url ?? '', 'http://dsh.internal')
  const rpcIdHeader = req.headers[BINARY_CHUNK_HEADER]
  const rpcId = typeof rpcIdHeader === 'string' && rpcIdHeader !== '' ? rpcIdHeader : 'upload-chunk'
  let sessionId: string
  let uploadId: string
  let index: number
  try {
    sessionId = requiredString(url.searchParams.get('sessionId'), 'sessionId')
    uploadId = requiredString(url.searchParams.get('uploadId'), 'uploadId')
    const rawIndex = url.searchParams.get('index')
    if (rawIndex === null) throw new Error('index must be a non-negative integer')
    index = requiredInteger(Number(rawIndex), 'index')
  } catch {
    writeRpc(res, 400, 'invalid upload/chunk query')
    return
  }
  const body = await readBoundedBody(req, UPLOAD_CHUNK_BYTES)
  if (body === 'too-large') {
    res.writeHead(413, { connection: 'close' })
    res.end()
    return
  }
  try {
    const value = await uploads.chunkBytes(sessionId, uploadId, index, body)
    writeRpc(res, 200, { type: 'server-response', rpcId, result: success(value) })
  } catch (error) {
    writeRpc(res, 200, { type: 'server-response', rpcId, result: failure(error) })
  }
}

/** Dispatch one attachment RPC after the HTTP envelope is validated. */
export function createAttachmentRpcHandler(catalog: AttachmentCatalog, uploads: UploadManager) {
  return async (endpoint: string, payload: unknown) => {
    try {
      if (!isRecord(payload)) throw new Error('request payload must be an object')
      const sessionId = requiredString(payload.sessionId, 'sessionId')
      switch (endpoint) {
        case ENDPOINTS.list:
          return success({ protocolVersion: RPC_PROTOCOL_VERSION, attachments: await catalog.list(sessionId) })
        case ENDPOINTS.remove:
          return success({ removed: await catalog.removeDraft(sessionId, requiredString(payload.attachmentId, 'attachmentId')) })
        case ENDPOINTS.commitReferences:
          await catalog.commitReferences(sessionId, stringArray(payload.attachmentIds, 'attachmentIds'))
          return success({ accepted: true })
        case ENDPOINTS.uploadBegin:
          return success(await uploads.begin(sessionId, {
            kind: 'file', name: requiredString(payload.name, 'name'), bytes: requiredInteger(payload.bytes, 'bytes'),
          }))
        case ENDPOINTS.folderUploadBegin:
          return success(await uploads.begin(sessionId, {
            kind: 'folder',
            name: requiredString(payload.name, 'name'),
            snapshotBytes: requiredInteger(payload.snapshotBytes, 'snapshotBytes'),
            sourceBytes: requiredInteger(payload.sourceBytes, 'sourceBytes'),
            fileCount: requiredInteger(payload.fileCount, 'fileCount'),
            directoryCount: requiredInteger(payload.directoryCount, 'directoryCount'),
          }))
        case ENDPOINTS.uploadChunk:
          return success(await uploads.chunk(
            sessionId,
            requiredString(payload.uploadId, 'uploadId'),
            requiredInteger(payload.index, 'index'),
            requiredString(payload.data, 'data'),
          ))
        case ENDPOINTS.uploadCommit:
          return success(await uploads.commit(sessionId, requiredString(payload.uploadId, 'uploadId')))
        case ENDPOINTS.uploadCancel:
          await uploads.cancel(sessionId, requiredString(payload.uploadId, 'uploadId'))
          return success({ cancelled: true })
        default:
          throw new Error(`unknown attachment endpoint: ${endpoint}`)
      }
    } catch (error) {
      return failure(error)
    }
  }
}

/**
 * Dedicated attachment RPC is mounted on this plugin fiber's webServer.
 * Connection.rpc.handle registers the same prefix on the Connection fiber,
 * which does not inject webServer in 0.1.5-rc.2. Unclaimed POSTs then hit the
 * SPA fallback and return HTTP 405.
 */
export function registerAttachmentRpc(ctx: Context, catalog: AttachmentCatalog, uploads: UploadManager): void {
  const dispatch = createAttachmentRpcHandler(catalog, uploads)
  const route: WebRoute = {
    kind: 'prefix',
    path: ATTACHMENT_RPC_CHANNEL,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const endpoint = attachmentEndpointFromUrl(req.url)
      if (req.method !== 'POST' || endpoint === undefined) {
        writeRpc(res, 404, 'not found')
        return
      }
      const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
      if (endpoint === ENDPOINTS.uploadChunk) {
        await handleBinaryUploadChunk(req, res, uploads, mediaType)
        return
      }
      if (mediaType !== 'application/json') {
        writeRpc(res, 415, 'content type must be application/json')
        return
      }
      const raw = await readBoundedBody(req, MAX_RPC_BODY_BYTES)
      if (raw === 'too-large') {
        res.writeHead(413, { connection: 'close' })
        res.end()
        return
      }
      let body: unknown
      try {
        body = JSON.parse(Buffer.from(raw).toString('utf8'))
      } catch {
        writeRpc(res, 400, 'body is not JSON')
        return
      }
      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        const rawId = (body as { rpcId?: unknown } | null)?.rpcId
        writeRpc(res, 200, {
          type: 'server-response',
          rpcId: typeof rawId === 'string' ? rawId : 'invalid-request',
          result: { ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: { issues: envelope.error.issues } } },
        })
        return
      }
      if (envelope.data.method !== endpoint) {
        writeRpc(res, 200, {
          type: 'server-response',
          rpcId: envelope.data.rpcId,
          result: {
            ok: false,
            error: {
              code: 'gateway/bad-request',
              message: `method ${JSON.stringify(envelope.data.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
              details: { issues: [] },
            },
          },
        })
        return
      }
      try {
        const result = await dispatch(endpoint, envelope.data.payload)
        writeRpc(res, 200, { type: 'server-response', rpcId: envelope.data.rpcId, result })
      } catch (error: unknown) {
        writeRpc(res, 500, `handler failure: ${String(error)}`)
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'dsh-dragndrop-attachments: RPC channel')
}
