import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { appendFile, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AttachmentPluginError,
  MAX_FILE_BYTES,
  MAX_FOLDER_SNAPSHOT_BYTES,
  UPLOAD_CHUNK_BYTES,
  sanitizeName,
  type AttachmentRecord,
} from './domain.js'
import type { AttachmentCatalog } from './catalog.js'

interface UploadState {
  readonly uploadId: string
  readonly sessionId: string
  readonly name: string
  readonly source: UploadSource
  readonly declaredBytes: number
  readonly path: string
  expectedChunk: number
  receivedBytes: number
  busy: boolean
}

export type UploadSource =
  | { readonly kind: 'file'; readonly name: string; readonly bytes: number }
  | {
      readonly kind: 'folder'
      readonly name: string
      readonly snapshotBytes: number
      readonly sourceBytes: number
      readonly fileCount: number
      readonly directoryCount: number
    }

function strictBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new AttachmentPluginError('上传分块不是规范 Base64。', 'BAD_REQUEST')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new AttachmentPluginError('上传分块 Base64 校验失败。', 'BAD_REQUEST')
  return new Uint8Array(bytes)
}

export class UploadManager {
  private readonly uploads = new Map<string, UploadState>()

  private constructor(private readonly catalog: AttachmentCatalog, private readonly uploadRoot: string) {}

  static async open(catalog: AttachmentCatalog): Promise<UploadManager> {
    const root = join(catalog.root, 'tmp', 'uploads')
    await mkdir(root, { recursive: true, mode: 0o700 })
    const stale = await readdir(root)
    await Promise.all(stale.filter(name => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.part$/iu.test(name)).map(name => unlink(join(root, name)).catch(() => {})))
    return new UploadManager(catalog, root)
  }

  async begin(sessionId: string, rawSource: UploadSource | string, legacyBytes?: number): Promise<{ readonly uploadId: string; readonly chunkBytes: number }> {
    if (this.uploads.size >= 8) throw new AttachmentPluginError('同时上传的附件过多。', 'BAD_REQUEST')
    const source: UploadSource = typeof rawSource === 'string'
      ? { kind: 'file', name: rawSource, bytes: legacyBytes ?? -1 }
      : rawSource
    const declaredBytes = source.kind === 'file' ? source.bytes : source.snapshotBytes
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0) throw new AttachmentPluginError('附件大小无效。', 'BAD_REQUEST')
    if (declaredBytes > (source.kind === 'folder' ? MAX_FOLDER_SNAPSHOT_BYTES : MAX_FILE_BYTES)) throw new AttachmentPluginError('附件超过大小上限。', 'FILE_TOO_LARGE')
    if (source.kind === 'folder' && (!Number.isSafeInteger(source.sourceBytes) || source.sourceBytes < 0
      || !Number.isSafeInteger(source.fileCount) || source.fileCount < 0
      || !Number.isSafeInteger(source.directoryCount) || source.directoryCount < 0 || source.sourceBytes > 100 * 1024 * 1024)) {
      throw new AttachmentPluginError('文件夹元数据无效。', 'BAD_REQUEST')
    }
    const uploadId = randomUUID()
    const path = join(this.uploadRoot, `${uploadId}.part`)
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.close()
    this.uploads.set(uploadId, {
      uploadId, sessionId, name: sanitizeName(source.name), source: { ...source, name: sanitizeName(source.name) }, declaredBytes, path,
      expectedChunk: 0, receivedBytes: 0, busy: false,
    })
    return { uploadId, chunkBytes: UPLOAD_CHUNK_BYTES }
  }

  async chunk(sessionId: string, uploadId: string, index: number, encoded: string): Promise<{ readonly receivedBytes: number }> {
    const state = this.require(sessionId, uploadId)
    if (state.busy) throw new AttachmentPluginError('同一附件的分块必须顺序上传。', 'BAD_REQUEST')
    if (!Number.isSafeInteger(index) || index !== state.expectedChunk) throw new AttachmentPluginError('附件分块顺序错误。', 'BAD_REQUEST')
    const bytes = strictBase64(encoded)
    if (bytes.byteLength > UPLOAD_CHUNK_BYTES) throw new AttachmentPluginError('附件分块超过限制。', 'BAD_REQUEST')
    if (state.receivedBytes + bytes.byteLength > state.declaredBytes) throw new AttachmentPluginError('附件实际大小超过声明值。', 'BAD_REQUEST')
    state.busy = true
    try {
      await appendFile(state.path, bytes)
      state.receivedBytes += bytes.byteLength
      state.expectedChunk += 1
      return { receivedBytes: state.receivedBytes }
    } finally {
      state.busy = false
    }
  }

  async commit(sessionId: string, uploadId: string, signal?: AbortSignal): Promise<AttachmentRecord> {
    const state = this.require(sessionId, uploadId)
    if (state.busy) throw new AttachmentPluginError('附件仍在接收分块。', 'BAD_REQUEST')
    if (state.receivedBytes !== state.declaredBytes) throw new AttachmentPluginError('附件上传不完整。', 'BAD_REQUEST')
    this.uploads.delete(uploadId)
    try {
      const data = new Uint8Array(await readFile(state.path, { signal }))
      signal?.throwIfAborted()
      return state.source.kind === 'folder'
        ? await this.catalog.ingestFolder(sessionId, state.source, data, signal)
        : await this.catalog.ingest(sessionId, state.name, data, signal)
    } finally {
      await unlink(state.path).catch(() => {})
    }
  }

  async cancel(sessionId: string, uploadId: string): Promise<void> {
    const state = this.require(sessionId, uploadId)
    this.uploads.delete(uploadId)
    await unlink(state.path).catch(() => {})
  }

  async close(): Promise<void> {
    const states = [...this.uploads.values()]
    this.uploads.clear()
    await Promise.all(states.map(state => unlink(state.path).catch(() => {})))
  }

  private require(sessionId: string, uploadId: string): UploadState {
    const state = this.uploads.get(uploadId)
    if (state === undefined || state.sessionId !== sessionId) throw new AttachmentPluginError('上传会话不存在。', 'BAD_REQUEST')
    return state
  }
}
