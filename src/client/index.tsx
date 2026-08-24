import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerAttachment, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { AttachmentRecord } from '../domain.js'
import { ATTACHMENT_RPC_CHANNEL, ENDPOINTS, isRecord, type RpcResult } from '../wire.js'
import { AttachmentDock, type AttachmentDockInjected, type ClientUploadSource } from './AttachmentDock.js'
import { prepareImage } from './image.js'

export { AttachmentDock } from './AttachmentDock.js'
export const name = 'dsh-dragndrop-attachments-client'
export const inject = ['connection', 'slots', 'conversation', 'commandUi']

interface RpcConnection {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>
  }
}

interface NativeConversation {
  createDraftImages(files: readonly File[]): readonly ComposerAttachment[]
  releaseDraftImages(attachments: readonly ComposerAttachment[]): void
}

interface CommandSession { readonly sessionId: SessionId }
interface PickerOption { readonly id: 'file' | 'folder'; readonly label: string }
interface CommandUi {
  register(contribution: {
    readonly name: string
    readonly description: string
    available(session: CommandSession): boolean
    readonly ui: {
      readonly kind: 'popupSelect'
      options(session: CommandSession, signal: AbortSignal): Promise<readonly PickerOption[]>
      onSelect(option: PickerOption, session: CommandSession): void | Promise<void>
    }
  }): () => void
}

const ATTACHMENT_MENU_LABEL = '文件和文件夹'
const ATTACHMENT_MENU_DETAIL = '添加图片、文档、ZIP 或整个文件夹'

function rpcConnection(value: unknown): RpcConnection {
  if (!isRecord(value) || !isRecord(value.rpc) || typeof value.rpc.call !== 'function') throw new Error('附件连接不可用。')
  return value as unknown as RpcConnection
}

function nativeConversation(value: unknown): NativeConversation {
  if (!isRecord(value) || typeof value.createDraftImages !== 'function' || typeof value.releaseDraftImages !== 'function') {
    throw new Error('DSH 原生图片管线不可用。')
  }
  return value as unknown as NativeConversation
}

function commandUi(value: unknown): CommandUi {
  if (!isRecord(value) || typeof value.register !== 'function') {
    throw new Error('DSH 原生 + 菜单不可用。')
  }
  return value as unknown as CommandUi
}


/** Keep the attachment action at the top of DSH RC8's shared +/command list. */
function bindAttachmentMenuPlacement(): () => void {
  let queued = false
  const promote = (): void => {
    queued = false
    for (const listbox of document.querySelectorAll<HTMLElement>('[role="listbox"]')) {
      const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')]
      const attachment = options.find(option => {
        const text = option.textContent ?? ''
        return text.includes(ATTACHMENT_MENU_LABEL) && text.includes(ATTACHMENT_MENU_DETAIL)
      })
      const first = options[0]
      if (attachment === undefined || first === undefined || attachment === first) continue
      attachment.parentElement?.insertBefore(attachment, first)
    }
  }
  const schedule = (): void => {
    if (queued) return
    queued = true
    queueMicrotask(promote)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  promote()
  return () => { observer.disconnect() }
}

function parseRecord(value: unknown): AttachmentRecord {
  if (!isRecord(value) || value.schemaVersion !== 'dsh-codex-attachment.v1'
    || typeof value.attachmentId !== 'string' || typeof value.name !== 'string'
    || typeof value.mediaType !== 'string' || typeof value.bytes !== 'number'
    || (value.kind !== 'text' && value.kind !== 'document' && value.kind !== 'archive' && value.kind !== 'folder') || typeof value.preview !== 'string') {
    throw new Error('附件服务返回了无效记录。')
  }
  return value as unknown as AttachmentRecord
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function apply(ctx: ClientContext): void {
  const pickers = new Map<SessionId, { readonly openFile: () => Promise<void>; readonly openFolder: () => Promise<void> }>()
  ctx.effect(bindAttachmentMenuPlacement, 'dsh-dragndrop-attachments: pin native + menu entry')
  ctx.inject(['commandUi'], (scope: ClientContext) => {
    const commands = commandUi(scope.get('commandUi'))
    scope.effect(() => commands.register({
      name: '文件和文件夹',
      description: ATTACHMENT_MENU_DETAIL,
      available: session => pickers.has(session.sessionId),
      ui: {
        kind: 'popupSelect',
        options: async () => [{ id: 'file', label: '选择文件' }, { id: 'folder', label: '选择文件夹' }],
        onSelect: (option, session): void | Promise<void> => {
          const picker = pickers.get(session.sessionId)
          if (picker === undefined) return
          return option.id === 'file' ? picker.openFile() : picker.openFolder()
        },
      },
    }), 'dsh-dragndrop-attachments: native + menu entry')
  })

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'dsh-dragndrop-attachments', order: -20, priority: 80,
    inject: (sessionId: SessionId): AttachmentDockInjected => {
      const call = async (endpoint: string, payload: Record<string, unknown>): Promise<unknown> => {
        const connection = rpcConnection(ctx.get('connection'))
        const result = await connection.rpc.call(ATTACHMENT_RPC_CHANNEL, endpoint, { sessionId, ...payload })
        if (!result.ok) {
          const action = result.error.action === undefined ? '' : ` ${result.error.action}`
          throw new Error(`${result.error.message}${action}`)
        }
        return result.value
      }
      return {
        list: async () => {
          const value = await call(ENDPOINTS.list, {})
          if (!isRecord(value) || !Array.isArray(value.attachments)) throw new Error('附件清单响应无效。')
          return value.attachments.map(parseRecord)
        },
        upload: async (source: ClientUploadSource, progress) => {
          const file = source.kind === 'file' ? source.file : undefined
          const bytes = source.kind === 'file' ? undefined : source.snapshot
          const name = source.kind === 'file' ? source.file.name : source.name
          const total = source.kind === 'file' ? source.file.size : source.snapshot.byteLength
          const begun = await call(source.kind === 'file' ? ENDPOINTS.uploadBegin : ENDPOINTS.folderUploadBegin,
            source.kind === 'file'
              ? { name, bytes: total }
              : { name, snapshotBytes: total, sourceBytes: source.sourceBytes, fileCount: source.fileCount, directoryCount: source.directoryCount })
          if (!isRecord(begun) || typeof begun.uploadId !== 'string' || typeof begun.chunkBytes !== 'number') throw new Error('附件上传初始化失败。')
          const uploadId = begun.uploadId
          try {
            let index = 0
            for (let offset = 0; offset < total; offset += begun.chunkBytes) {
              const chunk = file === undefined
                ? bytes!.slice(offset, Math.min(total, offset + begun.chunkBytes))
                : new Uint8Array(await file.slice(offset, Math.min(total, offset + begun.chunkBytes)).arrayBuffer())
              await call(ENDPOINTS.uploadChunk, { uploadId, index, data: bytesToBase64(chunk) })
              index += 1
              progress(Math.min(99, Math.round(Math.min(total, offset + chunk.byteLength) / total * 100)), '上传中')
            }
            progress(100, source.kind === 'folder' ? '建立文件夹索引中' : /\.(docx|xlsx|pptx|csv)$/iu.test(name) ? '本地解析中' : '建立索引中')
            return parseRecord(await call(ENDPOINTS.uploadCommit, { uploadId }))
          } catch (error) {
            await call(ENDPOINTS.uploadCancel, { uploadId }).catch(() => {})
            throw error
          }
        },
        removeDraft: async (attachmentId) => {
          const value = await call(ENDPOINTS.remove, { attachmentId })
          return isRecord(value) && value.removed === true
        },
        commitReferences: async (attachmentIds) => { await call(ENDPOINTS.commitReferences, { attachmentIds }) },
        registerPicker: (open) => {
          pickers.set(sessionId, open)
          return () => { if (pickers.get(sessionId) === open) pickers.delete(sessionId) }
        },
        attachNativeImages: async (files, accept) => {
          const prepared = []
          for (const file of files) prepared.push(await prepareImage(file))
          const conversation = nativeConversation(ctx.get('conversation'))
          const attachments = conversation.createDraftImages(prepared.map(item => item.file))
          if (!accept(attachments.map(item => item.id as DraftAttachmentId))) {
            conversation.releaseDraftImages(attachments)
            throw new Error('当前输入框暂时不能接收图片。')
          }
          return prepared.map(item => ({
            name: item.file.name, resized: item.resized,
            source: `${item.source.width}×${item.source.height}`,
            output: `${item.output.width}×${item.output.height}`,
          }))
        },
      }
    },
  }, AttachmentDock))
}
