import { extname } from 'node:path'
import type { ArchiveRef } from './archive.js'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_FOLDER_SNAPSHOT_BYTES = 128 * 1024 * 1024
export const MAX_SESSION_FILES = 20
export const MAX_SESSION_BYTES = 1024 * 1024 * 1024
export const UPLOAD_CHUNK_BYTES = 768 * 1024

export type AttachmentKind = 'text' | 'document' | 'archive' | 'folder'
export type AttachmentState = 'READY' | 'PARTIAL'

export interface AttachmentWarning {
  readonly code: string
  readonly message: string
  readonly locator?: Record<string, unknown>
}

/** Latest durable user turn that consumed one composer attachment. */
export interface AttachmentBinding {
  readonly messageId: string
  readonly turn: number
  readonly step: number
  readonly boundAt: string
}

export interface AttachmentRecordBase {
  /** Kept stable so records created by the private preview remain readable. */
  readonly schemaVersion: 'dsh-codex-attachment.v1'
  /** Per-selection identity used by cards, turn receipts, and model tools; the ref below owns CAS identity. */
  readonly attachmentId: string
  readonly name: string
  readonly bytes: number
  readonly status: AttachmentState
  readonly coverage: {
    readonly status: 'COMPLETE' | 'PARTIAL'
    readonly included: readonly string[]
    readonly omitted: readonly string[]
    readonly unsupported: readonly string[]
  }
  readonly warnings: readonly AttachmentWarning[]
  readonly preview: string
  readonly parser: string
  readonly createdAt: string
  /** Whether this content has ever been made available to the conversation. */
  readonly committed: boolean
  /** Composer membership. Missing on legacy records, where !committed is equivalent. */
  readonly pending?: boolean
  /** Latest turn binding; older bindings remain durable in the session log. */
  readonly binding?: AttachmentBinding
}

export interface TextAttachmentRecord extends AttachmentRecordBase {
  readonly mediaType: string
  readonly kind: 'text'
  readonly ref: Record<string, unknown>
}

export interface DocumentAttachmentRecord extends AttachmentRecordBase {
  readonly mediaType: string
  readonly kind: 'document'
  readonly documentKind: 'document' | 'spreadsheet' | 'presentation'
  readonly ref: Record<string, unknown>
}

export interface ArchiveAttachmentRecord extends AttachmentRecordBase {
  readonly mediaType: 'application/zip'
  readonly kind: 'archive'
  readonly documentKind: 'archive'
  readonly ref: ArchiveRef
}

export interface FolderAttachmentRecord extends AttachmentRecordBase {
  readonly mediaType: 'application/vnd.dsh.folder-snapshot+zip'
  readonly kind: 'folder'
  readonly documentKind: 'folder'
  readonly sourceBytes: number
  readonly fileCount: number
  readonly directoryCount: number
  readonly ref: ArchiveRef
}

export type AttachmentRecord = TextAttachmentRecord | DocumentAttachmentRecord | ArchiveAttachmentRecord | FolderAttachmentRecord

/** Read both the current draft flag and records written before the flag existed. */
export function isPendingAttachment(record: AttachmentRecord): boolean {
  return record.pending ?? !record.committed
}

export interface AcceptedFile {
  readonly kind: Exclude<AttachmentKind, 'folder'>
  readonly mediaType: string
}

export type AttachmentErrorCode =
  | 'BAD_REQUEST'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_ATTACHMENTS'
  | 'ATTACHMENTS_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'LEGACY_OFFICE_UNSUPPORTED'
  | 'FILE_TYPE_MISMATCH'
  | 'DOCUMENT_CORRUPT'
  | 'DOCUMENT_RESOURCE_LIMIT'
  | 'DOCUMENT_PARSE_TIMEOUT'
  | 'ARCHIVE_CORRUPT'
  | 'ARCHIVE_RESOURCE_LIMIT'
  | 'ARCHIVE_UNSAFE_PATH'
  | 'ARCHIVE_ENTRY_NOT_FOUND'
  | 'ARCHIVE_ENTRY_UNSUPPORTED'
  | 'ENCRYPTED_DOCUMENT_UNSUPPORTED'
  | 'TEXT_ENCODING_UNSUPPORTED'
  | 'PARSER_OUTPUT_INVALID'
  | 'PARSER_VERSION_MISMATCH'
  | 'ATTACHMENT_STORAGE_FAILED'
  | 'ATTACHMENT_INDEX_FAILED'
  | 'ATTACHMENT_NOT_FOUND'

const ACTIONS: Record<AttachmentErrorCode, string> = {
  BAD_REQUEST: '请重新选择文件后再试。',
  FILE_TOO_LARGE: '请将单个文件控制在 50 MiB 以内，或拆分后重新上传。',
  TOO_MANY_ATTACHMENTS: '每个会话最多保留 20 个附件，请移除不需要的附件。',
  ATTACHMENTS_TOO_LARGE: '每个会话附件总量最多 1 GiB，请拆分到其他会话。',
  UNSUPPORTED_FILE_TYPE: '请使用 PNG/JPEG/WebP/GIF、TXT/Markdown、CSV、DOCX、XLSX、PPTX 或 ZIP。',
  LEGACY_OFFICE_UNSUPPORTED: '请用 Office 另存为 DOCX、XLSX 或 PPTX 后重新上传。',
  FILE_TYPE_MISMATCH: '文件扩展名与实际内容不一致，请修复文件后重新上传。',
  DOCUMENT_CORRUPT: '文件已损坏或不是有效的 Office 文档，请重新保存后上传。',
  DOCUMENT_RESOURCE_LIMIT: '文档超过安全解析上限，请拆分文档或改用 CSV。',
  DOCUMENT_PARSE_TIMEOUT: '文档解析超时，请拆分后重新上传。',
  ARCHIVE_CORRUPT: '请重新创建 ZIP 后再上传。',
  ARCHIVE_RESOURCE_LIMIT: 'ZIP 超过安全解压上限，请拆分或移除异常大条目。',
  ARCHIVE_UNSAFE_PATH: 'ZIP 包含不安全路径，请重新打包后上传。',
  ARCHIVE_ENTRY_NOT_FOUND: '请先读取 ZIP 目录并使用其中的准确路径。',
  ARCHIVE_ENTRY_UNSUPPORTED: '该 ZIP 条目不是可直接读取的文本文件。',
  ENCRYPTED_DOCUMENT_UNSUPPORTED: '请先在 Office 中移除密码保护，再重新上传。',
  TEXT_ENCODING_UNSUPPORTED: '请将文本保存为 UTF-8；CSV 也支持 GB18030。',
  PARSER_OUTPUT_INVALID: '解析结果不完整，请重新保存原文件后上传。',
  PARSER_VERSION_MISMATCH: '本机 Office 解析器不可用，请重新安装完整插件包。',
  ATTACHMENT_STORAGE_FAILED: '本地附件保存失败，请检查 DSH 数据目录权限和磁盘空间。',
  ATTACHMENT_INDEX_FAILED: '附件索引不可用，请重新上传该文件。',
  ATTACHMENT_NOT_FOUND: '当前会话找不到这个附件，请重新上传。',
}

export class AttachmentPluginError extends Error {
  constructor(
    message: string,
    readonly code: AttachmentErrorCode,
    readonly action = ACTIONS[code],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AttachmentPluginError'
  }
}

const TEXT_MEDIA = new Map<string, string>([
  ['.txt', 'text/plain'], ['.md', 'text/markdown'], ['.markdown', 'text/markdown'],
  ['.json', 'application/json'], ['.jsonl', 'application/x-ndjson'], ['.ndjson', 'application/x-ndjson'],
  ['.yaml', 'application/yaml'], ['.yml', 'application/yaml'], ['.toml', 'application/toml'],
  ['.xml', 'application/xml'], ['.tsv', 'text/tab-separated-values'],
  ['.py', 'text/plain'], ['.js', 'text/plain'], ['.jsx', 'text/plain'], ['.ts', 'text/plain'],
  ['.tsx', 'text/plain'], ['.css', 'text/plain'], ['.html', 'text/plain'], ['.htm', 'text/plain'],
  ['.sh', 'text/plain'], ['.zsh', 'text/plain'], ['.sql', 'text/plain'], ['.log', 'text/plain'],
  ['.ini', 'text/plain'], ['.conf', 'text/plain'], ['.env', 'text/plain'], ['.properties', 'text/plain'],
  ['.java', 'text/plain'], ['.go', 'text/plain'], ['.rs', 'text/plain'], ['.c', 'text/plain'],
  ['.h', 'text/plain'], ['.cpp', 'text/plain'], ['.hpp', 'text/plain'],
])

const DOCUMENT_MEDIA = new Map<string, string>([
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.csv', 'text/csv'],
])

export function sanitizeName(value: string): string {
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 255)
  if (clean === '') throw new AttachmentPluginError('附件文件名不能为空。', 'BAD_REQUEST')
  return clean
}

export function classifyFile(rawName: string): AcceptedFile {
  const name = sanitizeName(rawName)
  const extension = extname(name).toLocaleLowerCase()
  if (extension === '.doc' || extension === '.xls' || extension === '.ppt') {
    throw new AttachmentPluginError('旧版 Office 二进制格式暂不支持。', 'LEGACY_OFFICE_UNSUPPORTED')
  }
  if (extension === '.zip') return { kind: 'archive', mediaType: 'application/zip' }
  const document = DOCUMENT_MEDIA.get(extension)
  if (document !== undefined) return { kind: 'document', mediaType: document }
  const text = TEXT_MEDIA.get(extension)
  if (text !== undefined) return { kind: 'text', mediaType: text }
  throw new AttachmentPluginError(`不支持的附件类型：${extension || '(无扩展名)'}`, 'UNSUPPORTED_FILE_TYPE')
}

const ENGINE_CODE_MAP: Partial<Record<string, AttachmentErrorCode>> = {
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_MISMATCH: 'FILE_TYPE_MISMATCH',
  DOCUMENT_CORRUPT: 'DOCUMENT_CORRUPT',
  DOCUMENT_RESOURCE_LIMIT: 'DOCUMENT_RESOURCE_LIMIT',
  DOCUMENT_PARSE_TIMEOUT: 'DOCUMENT_PARSE_TIMEOUT',
  LEGACY_OFFICE_UNSUPPORTED: 'LEGACY_OFFICE_UNSUPPORTED',
  ENCRYPTED_DOCUMENT_UNSUPPORTED: 'ENCRYPTED_DOCUMENT_UNSUPPORTED',
  TEXT_ENCODING_UNSUPPORTED: 'TEXT_ENCODING_UNSUPPORTED',
  INVALID_TEXT: 'TEXT_ENCODING_UNSUPPORTED',
  PARSER_OUTPUT_INVALID: 'PARSER_OUTPUT_INVALID',
  PARSER_VERSION_MISMATCH: 'PARSER_VERSION_MISMATCH',
  ATTACHMENT_WRITE_FAILED: 'ATTACHMENT_STORAGE_FAILED',
  ATTACHMENT_READ_FAILED: 'ATTACHMENT_STORAGE_FAILED',
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',
  ATTACHMENT_INDEX_FAILED: 'ATTACHMENT_INDEX_FAILED',
}

export function normalizedError(error: unknown): AttachmentPluginError {
  if (error instanceof AttachmentPluginError) return error
  const rawCode = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
  const code = rawCode === undefined ? 'ATTACHMENT_STORAGE_FAILED' : (ENGINE_CODE_MAP[rawCode] ?? 'ATTACHMENT_STORAGE_FAILED')
  const message = error instanceof Error ? error.message : String(error)
  return new AttachmentPluginError(message, code, undefined, error instanceof Error ? { cause: error } : undefined)
}
