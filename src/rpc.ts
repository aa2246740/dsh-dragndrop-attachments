import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { AttachmentPluginError, normalizedError } from './domain.js'
import type { AttachmentCatalog } from './catalog.js'
import type { UploadManager } from './uploads.js'
import { ATTACHMENT_RPC_CHANNEL, ENDPOINTS, isRecord, requiredInteger, requiredString, RPC_PROTOCOL_VERSION } from './wire.js'

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

export function registerAttachmentRpc(ctx: Context, catalog: AttachmentCatalog, uploads: UploadManager): void {
  ctx.connection.rpc.handle(
    ATTACHMENT_RPC_CHANNEL,
    async (endpoint, payload) => {
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
    },
    { authority: 'loopback' },
  )
}
