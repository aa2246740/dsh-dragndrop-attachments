import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ArchiveStore } from './archive.js'
import type { UploadSource } from './uploads.js'
import {
  DocumentPipeline,
  OFFICECLI_VERSION,
  readTextFile,
  saveTextFile,
  type EngineDocumentQuery,
  type EngineDocumentRef,
  type EngineTextRef,
} from './engine.js'
import {
  AttachmentPluginError,
  MAX_FILE_BYTES,
  MAX_FOLDER_SNAPSHOT_BYTES,
  MAX_SESSION_BYTES,
  MAX_SESSION_FILES,
  classifyFile,
  normalizedError,
  sanitizeName,
  type AttachmentRecord, type FolderAttachmentRecord,
} from './domain.js'

// Persisted schema tokens predate the public package name and remain stable for data compatibility.
const CATALOG_SCHEMA = 'dsh-codex-attachment-session.v1' as const
const TEXT_MEDIA = Object.freeze([
  'text/plain', 'text/markdown', 'text/tab-separated-values', 'application/json',
  'application/x-ndjson', 'application/yaml', 'application/xml', 'application/toml',
])
const DOCUMENT_MEDIA = Object.freeze([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
])

const DOCUMENT_LIMITS = Object.freeze({
  maxDocumentBytes: MAX_FILE_BYTES,
  maxDocumentsPerMessage: MAX_SESSION_FILES,
  maxMessageDocumentBytes: MAX_SESSION_BYTES,
  maxDecompressedBytes: 256 * 1024 * 1024,
  maxArchiveEntries: 10_000,
  maxCompressionRatio: 100,
  maxXmlNodes: 2_000_000,
  maxParserOutputBytes: 32 * 1024 * 1024,
  parseTimeoutMs: 30_000,
  maxConcurrentParses: 2,
  maxPreviewCharacters: 4_000,
  maxSearchResults: 50,
  maxQueryItems: 2_000,
  csvRowsPerBlock: 500,
  streamThresholdBytes: 20 * 1024 * 1024,
  mediaTypes: DOCUMENT_MEDIA,
})

const TEXT_LIMITS = Object.freeze({
  maxTextBytes: MAX_FILE_BYTES,
  maxTextAttachmentsPerMessage: MAX_SESSION_FILES,
  maxMessageTextBytes: MAX_SESSION_BYTES,
  mediaTypes: TEXT_MEDIA,
})

interface SessionEnvelope {
  readonly schemaVersion: typeof CATALOG_SCHEMA
  readonly sessionId: string
  readonly attachments: readonly AttachmentRecord[]
}

function sessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEnvelope(value: unknown, sessionId: string): SessionEnvelope {
  if (!isRecord(value) || value.schemaVersion !== CATALOG_SCHEMA || value.sessionId !== sessionId || !Array.isArray(value.attachments)) {
    throw new AttachmentPluginError('会话附件索引格式无效。', 'ATTACHMENT_INDEX_FAILED')
  }
  for (const entry of value.attachments) {
    if (!isRecord(entry) || entry.schemaVersion !== 'dsh-codex-attachment.v1'
      || typeof entry.attachmentId !== 'string' || typeof entry.name !== 'string'
      || typeof entry.bytes !== 'number' || !isRecord(entry.ref)) {
      throw new AttachmentPluginError('会话附件索引包含无效记录。', 'ATTACHMENT_INDEX_FAILED')
    }
  }
  return value as unknown as SessionEnvelope
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
}

function textCoverage() {
  return { status: 'COMPLETE' as const, included: ['utf-8 text'], omitted: [], unsupported: [] }
}

function textPreview(text: string): string {
  return text.slice(0, 4_000)
}

function headingOutline(text: string): readonly Record<string, unknown>[] {
  const lines = text.split(/\r?\n/u)
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line)
    return match?.[1] === undefined || match[2] === undefined ? [] : [{
      id: `lines:${index + 1}-${index + 1}`,
      title: match[2].trim(),
      level: match[1].length,
      locator: { kind: 'text', line: index + 1 },
    }]
  })
  if (headings.length > 0) return headings
  const blocks: Record<string, unknown>[] = []
  for (let start = 1; start <= lines.length; start += 200) {
    const end = Math.min(lines.length, start + 199)
    blocks.push({ id: `lines:${start}-${end}`, title: `第 ${start}-${end} 行`, level: 1, locator: { kind: 'text', line: start } })
  }
  return blocks
}

export interface CatalogOptions {
  readonly root: string
  readonly officeCliPath?: string
}

export class AttachmentCatalog {
  readonly root: string
  private readonly sessionsRoot: string
  private readonly engineRoot: string
  private readonly documents: DocumentPipeline
  private readonly archives: ArchiveStore
  private readonly locks = new Map<string, Promise<void>>()

  private constructor(ctx: Context, options: CatalogOptions) {
    this.root = resolve(options.root)
    this.sessionsRoot = join(this.root, 'sessions')
    this.engineRoot = join(this.root, 'store', 'v1')
    this.documents = new DocumentPipeline(ctx, this.engineRoot, DOCUMENT_LIMITS, options.officeCliPath)
    this.archives = new ArchiveStore(this.engineRoot)
  }

  static async open(ctx: Context, options: CatalogOptions): Promise<AttachmentCatalog> {
    const catalog = new AttachmentCatalog(ctx, options)
    await mkdir(catalog.sessionsRoot, { recursive: true, mode: 0o700 })
    await mkdir(join(catalog.root, 'tmp'), { recursive: true, mode: 0o700 })
    await chmod(catalog.root, 0o700)
    await chmod(catalog.sessionsRoot, 0o700)
    await catalog.archives.open()
    return catalog
  }

  private path(sessionId: string): string {
    return join(this.sessionsRoot, `${sessionKey(sessionId)}.json`)
  }

  private async read(sessionId: string): Promise<SessionEnvelope> {
    try {
      return parseEnvelope(JSON.parse(await readFile(this.path(sessionId), 'utf8')), sessionId)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { schemaVersion: CATALOG_SCHEMA, sessionId, attachments: [] }
      }
      if (error instanceof AttachmentPluginError) throw error
      throw new AttachmentPluginError('无法读取会话附件索引。', 'ATTACHMENT_INDEX_FAILED', undefined, { cause: error })
    }
  }

  private async write(envelope: SessionEnvelope): Promise<void> {
    const target = this.path(envelope.sessionId)
    const temporary = join(this.sessionsRoot, `.${sessionKey(envelope.sessionId)}-${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      await handle.writeFile(JSON.stringify(envelope))
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, target)
      await syncDirectory(dirname(target))
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => {})
      throw new AttachmentPluginError('无法保存会话附件索引。', 'ATTACHMENT_INDEX_FAILED', undefined, { cause: error })
    }
  }

  private mutate<T>(sessionId: string, operation: (current: SessionEnvelope) => Promise<{ readonly next: SessionEnvelope; readonly value: T }>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve()
    let resolveDone!: () => void
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const tail = previous.then(() => done, () => done)
    this.locks.set(sessionId, tail)
    return previous.catch(() => {}).then(async () => {
      try {
        const result = await operation(await this.read(sessionId))
        await this.write(result.next)
        return result.value
      } finally {
        resolveDone()
        if (this.locks.get(sessionId) === tail) this.locks.delete(sessionId)
      }
    })
  }

  async list(sessionId: string): Promise<readonly AttachmentRecord[]> {
    return (await this.read(sessionId)).attachments
  }

  async ingest(sessionId: string, rawName: string, data: Uint8Array, signal?: AbortSignal): Promise<AttachmentRecord> {
    signal?.throwIfAborted()
    if (data.byteLength === 0) throw new AttachmentPluginError('附件不能为空。', 'BAD_REQUEST')
    if (data.byteLength > MAX_FILE_BYTES) throw new AttachmentPluginError('附件超过 50 MiB。', 'FILE_TOO_LARGE')
    const name = sanitizeName(rawName)
    const accepted = classifyFile(name)
    try {
      let record: AttachmentRecord
      if (accepted.kind === 'text') {
        const ref = await saveTextFile(this.engineRoot, { data, mediaType: accepted.mediaType, name }, TEXT_LIMITS)
        const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
        record = {
          schemaVersion: 'dsh-codex-attachment.v1', attachmentId: ref.attachmentId, name,
          mediaType: accepted.mediaType, bytes: data.byteLength, kind: 'text', status: 'READY',
          coverage: textCoverage(), warnings: [], preview: textPreview(text), parser: 'utf8-local',
          createdAt: new Date().toISOString(), ref, committed: false,
        }
      } else if (accepted.kind === 'document') {
        const ref = await this.documents.save({ data, mediaType: accepted.mediaType, name }, signal)
        record = {
          schemaVersion: 'dsh-codex-attachment.v1', attachmentId: ref.attachmentId, name,
          mediaType: accepted.mediaType, bytes: data.byteLength, kind: 'document', documentKind: ref.documentKind,
          status: ref.status, coverage: ref.coverage, warnings: ref.warnings, preview: ref.preview,
          parser: `officecli-${OFFICECLI_VERSION}`, createdAt: new Date().toISOString(), ref, committed: false,
        }
      } else {
        const { ref, manifest } = await this.archives.save(data)
        const files = manifest.entries.filter(entry => !entry.directory)
        const readable = files.filter(entry => entry.text)
        const binary = files.length - readable.length
        record = {
          schemaVersion: 'dsh-codex-attachment.v1', attachmentId: `sha256:${ref.sha256}`, name,
          mediaType: 'application/zip', bytes: data.byteLength, kind: 'archive', documentKind: 'archive', status: 'READY',
          coverage: {
            status: binary === 0 ? 'COMPLETE' : 'PARTIAL',
            included: ['ZIP directory', `${readable.length} text/code entries readable on demand`],
            omitted: binary === 0 ? [] : [`${binary} binary entries are listed but not injected`],
            unsupported: ['nested archive expansion'],
          },
          warnings: binary === 0 ? [] : [{ code: 'ARCHIVE_BINARY_ENTRIES', message: `${binary} 个二进制条目只列目录，不注入正文。` }],
          preview: [`ZIP · ${files.length} files · ${manifest.entries.length - files.length} folders`, ...files.slice(0, 30).map(entry => entry.path)].join('\n'),
          parser: 'zip-local-fflate-0.8.2', createdAt: new Date().toISOString(), ref, committed: false,
        }
      }
      return await this.mutate(sessionId, async current => {
        const same = current.attachments.find(entry => entry.attachmentId === record.attachmentId)
        if (same !== undefined) return { next: current, value: same }
        if (current.attachments.length >= MAX_SESSION_FILES) throw new AttachmentPluginError('会话附件数量已达上限。', 'TOO_MANY_ATTACHMENTS')
        const total = current.attachments.reduce((sum, entry) => sum + entry.bytes, 0) + record.bytes
        if (total > MAX_SESSION_BYTES) throw new AttachmentPluginError('会话附件总量超过 100 MiB。', 'ATTACHMENTS_TOO_LARGE')
        return { next: { ...current, attachments: [...current.attachments, record] }, value: record }
      })
    } catch (error) {
      throw normalizedError(error)
    }
  }

  async ingestFolder(
    sessionId: string,
    source: Extract<UploadSource, { readonly kind: 'folder' }>,
    data: Uint8Array,
    signal?: AbortSignal,
  ): Promise<FolderAttachmentRecord> {
    signal?.throwIfAborted()
    if (data.byteLength !== source.snapshotBytes || data.byteLength === 0 || data.byteLength > MAX_FOLDER_SNAPSHOT_BYTES || source.sourceBytes > MAX_SESSION_BYTES) {
      throw new AttachmentPluginError('文件夹快照大小无效。', data.byteLength > MAX_FOLDER_SNAPSHOT_BYTES || source.sourceBytes > MAX_SESSION_BYTES ? 'FILE_TOO_LARGE' : 'BAD_REQUEST')
    }
    const name = sanitizeName(source.name)
    try {
      const { ref, manifest } = await this.archives.save(data)
      const files = manifest.entries.filter(entry => !entry.directory)
      const directories = manifest.entries.filter(entry => entry.directory)
      if (files.length !== source.fileCount || directories.length !== source.directoryCount
        || manifest.totalUncompressedBytes !== source.sourceBytes) {
        throw new AttachmentPluginError('文件夹快照目录与声明不一致。', 'ARCHIVE_CORRUPT')
      }
      const binary = files.filter(entry => !entry.text).length
      const attachmentId = `sha256:${createHash('sha256').update(name).update('\0').update(ref.sha256).digest('hex')}`
      const record: FolderAttachmentRecord = {
        schemaVersion: 'dsh-codex-attachment.v1', attachmentId, name,
        mediaType: 'application/vnd.dsh.folder-snapshot+zip', bytes: source.sourceBytes,
        sourceBytes: source.sourceBytes, fileCount: files.length, directoryCount: directories.length,
        kind: 'folder', documentKind: 'folder', status: 'READY',
        coverage: {
          status: binary === 0 ? 'COMPLETE' : 'PARTIAL',
          included: ['文件夹目录', `${files.filter(entry => entry.text).length} 个文本/代码条目可按需读取`],
          omitted: binary === 0 ? [] : [`${binary} 个二进制条目仅列目录，不注入正文`],
          unsupported: ['嵌套压缩包不会自动展开'],
        },
        warnings: binary === 0 ? [] : [{ code: 'FOLDER_BINARY_ENTRIES', message: `${binary} 个二进制条目只列目录，不注入正文。` }],
        preview: [`文件夹 · ${files.length} files · ${directories.length} folders`, ...manifest.entries.slice(0, 30).map(entry => entry.path)].join('\n'),
        parser: 'folder-snapshot-fflate-0.8.2', createdAt: new Date().toISOString(), ref, committed: false,
      }
      return await this.mutate(sessionId, async current => {
        const same = current.attachments.find(entry => entry.attachmentId === record.attachmentId)
        if (same !== undefined) return { next: current, value: same as FolderAttachmentRecord }
        if (current.attachments.length >= MAX_SESSION_FILES) throw new AttachmentPluginError('会话附件数量已达上限。', 'TOO_MANY_ATTACHMENTS')
        const total = current.attachments.reduce((sum, entry) => sum + entry.bytes, 0) + record.bytes
        if (total > MAX_SESSION_BYTES) throw new AttachmentPluginError('会话附件总量超过 100 MiB。', 'ATTACHMENTS_TOO_LARGE')
        return { next: { ...current, attachments: [...current.attachments, record] }, value: record }
      })
    } catch (error) {
      throw normalizedError(error)
    }
  }

  async commitReferences(sessionId: string, attachmentIds: readonly string[]): Promise<void> {
    const wanted = new Set(attachmentIds)
    await this.mutate(sessionId, async current => ({
      next: { ...current, attachments: current.attachments.map(record => wanted.has(record.attachmentId) ? { ...record, committed: true } : record) },
      value: undefined,
    }))
  }

  async removeDraft(sessionId: string, attachmentId: string): Promise<boolean> {
    return this.mutate(sessionId, async current => {
      const target = current.attachments.find(entry => entry.attachmentId === attachmentId)
      if (target === undefined || target.committed) return { next: current, value: false }
      return { next: { ...current, attachments: current.attachments.filter(entry => entry !== target) }, value: true }
    })
  }

  async resolve(sessionId: string, attachmentId: string): Promise<AttachmentRecord> {
    const record = (await this.list(sessionId)).find(entry => entry.attachmentId === attachmentId)
    if (record === undefined) throw new AttachmentPluginError('当前会话没有这个附件。', 'ATTACHMENT_NOT_FOUND')
    return record
  }

  async readText(record: AttachmentRecord, signal?: AbortSignal): Promise<string> {
    if (record.kind !== 'text') throw new AttachmentPluginError('该附件不是普通文本。', 'BAD_REQUEST')
    const stored = await readTextFile(this.engineRoot, record.ref as EngineTextRef, signal)
    return new TextDecoder('utf-8', { fatal: true }).decode(stored.data)
  }

  async outline(record: AttachmentRecord, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (record.kind === 'folder') return this.folderize(record, await this.archives.outline(record.ref, signal))
    if (record.kind === 'archive') return this.archives.outline(record.ref, signal)
    if (record.kind === 'document') return this.documents.query(record.ref as EngineDocumentRef, { kind: 'outline' }, signal)
    const text = await this.readText(record, signal)
    return { attachmentId: record.attachmentId, name: record.name, documentKind: 'text', queryKind: 'outline', items: headingOutline(text), coverage: record.coverage, warnings: record.warnings }
  }

  async search(record: AttachmentRecord, query: string, limit: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (record.kind === 'folder') return this.folderize(record, await this.archives.search(record.ref, query, limit, signal))
    if (record.kind === 'archive') return this.archives.search(record.ref, query, limit, signal)
    if (record.kind === 'document') return this.documents.query(record.ref as EngineDocumentRef, { kind: 'search', query, limit }, signal)
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') throw new AttachmentPluginError('搜索词不能为空。', 'BAD_REQUEST')
    const lines = (await this.readText(record, signal)).split(/\r?\n/u)
    const items = lines.flatMap((line, index) => line.toLocaleLowerCase().includes(needle)
      ? [{ id: `lines:${index + 1}-${index + 1}`, type: 'paragraph', text: line, locator: { kind: 'text', line: index + 1 } }]
      : []).slice(0, Math.min(50, Math.max(1, limit)))
    return { attachmentId: record.attachmentId, name: record.name, documentKind: 'text', queryKind: 'search', items, coverage: record.coverage, warnings: record.warnings }
  }

  async blocks(record: AttachmentRecord, blockIds: readonly string[], signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (record.kind === 'folder') throw new AttachmentPluginError('文件夹条目请使用 read_folder_entry 或 query_folder_document。', 'BAD_REQUEST')
    if (record.kind === 'archive') throw new AttachmentPluginError('ZIP 条目请使用 read_archive_entry 按路径读取。', 'BAD_REQUEST')
    if (record.kind === 'document') return this.documents.query(record.ref as EngineDocumentRef, { kind: 'blocks', blockIds }, signal)
    const lines = (await this.readText(record, signal)).split(/\r?\n/u)
    let budget = 2_000
    const items = blockIds.map((id) => {
      const match = /^lines:([1-9][0-9]*)-([1-9][0-9]*)$/u.exec(id)
      if (match?.[1] === undefined || match[2] === undefined) throw new AttachmentPluginError(`无效文本块：${id}`, 'BAD_REQUEST')
      const start = Number(match[1]); const requestedEnd = Number(match[2])
      if (requestedEnd < start) throw new AttachmentPluginError(`无效文本块：${id}`, 'BAD_REQUEST')
      const end = Math.min(requestedEnd, start + budget - 1, lines.length)
      budget -= Math.max(0, end - start + 1)
      return { id, type: 'paragraph', text: lines.slice(start - 1, end).join('\n'), locator: { kind: 'text', lineStart: start, lineEnd: end } }
    })
    return { attachmentId: record.attachmentId, name: record.name, documentKind: 'text', queryKind: 'blocks', items, coverage: record.coverage, warnings: record.warnings }
  }

  async documentQuery(record: AttachmentRecord, query: EngineDocumentQuery, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (record.kind !== 'document') throw new AttachmentPluginError('该读取方式只适用于 Office 或 CSV 附件。', 'BAD_REQUEST')
    return this.documents.query(record.ref as EngineDocumentRef, query, signal)
  }

  async readArchiveEntry(
    record: AttachmentRecord, path: string, lineStart?: number, lineEnd?: number, signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (record.kind !== 'archive') throw new AttachmentPluginError('该读取方式只适用于 ZIP 附件。', 'BAD_REQUEST')
    return this.archives.readEntry(record.ref, path, lineStart, lineEnd, signal)
  }

  async readFolderEntry(
    record: AttachmentRecord, path: string, lineStart?: number, lineEnd?: number, signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (record.kind !== 'folder') throw new AttachmentPluginError('该读取方式只适用于文件夹附件。', 'BAD_REQUEST')
    return this.folderize(record, await this.archives.readEntry(record.ref, path, lineStart, lineEnd, signal), path)
  }

  async folderDocumentQuery(
    record: AttachmentRecord, path: string, query: EngineDocumentQuery, signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (record.kind !== 'folder') throw new AttachmentPluginError('该读取方式只适用于文件夹附件。', 'BAD_REQUEST')
    const entry = await this.archives.readEntryBytes(record.ref, path, signal)
    const accepted = classifyFile(entry.path.slice(entry.path.lastIndexOf('/') + 1))
    if (accepted.kind !== 'document') throw new AttachmentPluginError('文件夹条目不是 Office 或 CSV 文档。', 'ARCHIVE_ENTRY_UNSUPPORTED')
    const ref = await this.documents.save({ data: entry.bytes, mediaType: accepted.mediaType, name: entry.path }, signal)
    return this.folderize(record, await this.documents.query(ref, query, signal), entry.path)
  }

  private folderize(record: FolderAttachmentRecord, value: Record<string, unknown>, entryPath?: string): Record<string, unknown> {
    const items = Array.isArray(value.items)
      ? value.items.map(item => isRecord(item) ? {
        ...item,
        locator: {
          kind: 'folder', path: entryPath ?? (typeof item.path === 'string' ? item.path : isRecord(item.locator) && typeof item.locator.path === 'string' ? item.locator.path : undefined),
          entry_locator: item.locator ?? { kind: 'office', ...(typeof item.sheet === 'string' ? { sheet: item.sheet } : {}), ...(typeof item.cell === 'string' ? { cell: item.cell } : {}), ...(typeof item.id === 'string' ? { id: item.id } : {}) },
        },
      } : item)
      : value.items
    return {
      ...value, attachmentId: record.attachmentId, name: record.name, documentKind: 'folder',
      ...(items === undefined ? {} : { items }),
      locator: { kind: 'folder', path: entryPath ?? (typeof value.path === 'string' ? value.path : undefined) },
    }
  }
}
