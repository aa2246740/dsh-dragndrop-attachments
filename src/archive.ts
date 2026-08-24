import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync, type UnzipFileInfo } from 'fflate'
import { AttachmentPluginError } from './domain.js'

// Persisted refs from the private preview must remain readable after the package rename.
const ARCHIVE_SCHEMA = 'dsh-codex-archive-ref.v1' as const
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 100
const RATIO_CHECK_MIN_BYTES = 1024 * 1024
const MAX_TEXT_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_SEARCH_TEXT_BYTES = 32 * 1024 * 1024
const MAX_SEARCH_FILES = 500
const MAX_OUTLINE_ENTRIES = 2_000
const MAX_READ_LINES = 2_000
const MAX_READ_CHARACTERS = 200_000

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.xml',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.less', '.html', '.htm', '.sh', '.zsh', '.bash', '.sql',
  '.log', '.ini', '.conf', '.env', '.properties', '.java', '.kt', '.kts', '.go', '.rs', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.rb', '.php', '.swift', '.scala', '.lua', '.r', '.dockerfile', '.gradle', '.gitignore', '.gitattributes',
])
const TEXT_BASENAMES = new Set([
  'readme', 'license', 'copying', 'notice', 'changelog', 'makefile', 'dockerfile', 'containerfile', 'gemfile', 'rakefile',
])

export interface ArchiveRef {
  readonly [key: string]: unknown
  readonly schemaVersion: typeof ARCHIVE_SCHEMA
  readonly sha256: string
  readonly relativePath: string
}

export interface ArchiveEntry {
  readonly path: string
  readonly bytes: number
  readonly compressedBytes: number
  readonly compression: number
  readonly directory: boolean
  readonly text: boolean
}

export interface ArchiveManifest {
  readonly entries: readonly ArchiveEntry[]
  readonly totalUncompressedBytes: number
}

function extension(path: string): string {
  const leaf = path.slice(path.lastIndexOf('/') + 1).toLocaleLowerCase()
  const dot = leaf.lastIndexOf('.')
  return dot < 0 ? '' : leaf.slice(dot)
}

function textEntry(path: string): boolean {
  const leaf = path.slice(path.lastIndexOf('/') + 1).toLocaleLowerCase()
  return TEXT_BASENAMES.has(leaf) || TEXT_EXTENSIONS.has(extension(path))
}

export function normalizeArchivePath(raw: string): string {
  if (raw.includes('\0')) throw new AttachmentPluginError('ZIP 包含空字节路径。', 'ARCHIVE_UNSAFE_PATH')
  const normalized = raw.replaceAll('\\', '/').normalize('NFC')
  if (normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:\//u.test(normalized)) {
    throw new AttachmentPluginError(`ZIP 包含绝对路径：${raw}`, 'ARCHIVE_UNSAFE_PATH')
  }
  const directory = normalized.endsWith('/')
  const body = directory ? normalized.slice(0, -1) : normalized
  const segments = body.split('/')
  if (body === '' || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new AttachmentPluginError(`ZIP 包含不安全路径：${raw}`, 'ARCHIVE_UNSAFE_PATH')
  }
  return `${segments.join('/')}${directory ? '/' : ''}`
}

function validateInfo(info: UnzipFileInfo): ArchiveEntry {
  if (!Number.isSafeInteger(info.size) || info.size < 0 || !Number.isSafeInteger(info.originalSize) || info.originalSize < 0) {
    throw new AttachmentPluginError('ZIP 条目大小无效。', 'ARCHIVE_CORRUPT')
  }
  if (info.compression !== 0 && info.compression !== 8) {
    throw new AttachmentPluginError(`ZIP 使用了不支持的压缩算法：${info.name}`, 'ARCHIVE_ENTRY_UNSUPPORTED')
  }
  const path = normalizeArchivePath(info.name)
  const directory = path.endsWith('/')
  if (!directory && info.originalSize >= RATIO_CHECK_MIN_BYTES && info.originalSize / Math.max(1, info.size) > MAX_COMPRESSION_RATIO) {
    throw new AttachmentPluginError(`ZIP 条目压缩比超过安全上限：${path}`, 'ARCHIVE_RESOURCE_LIMIT')
  }
  return {
    path,
    bytes: info.originalSize,
    compressedBytes: info.size,
    compression: info.compression,
    directory,
    text: !directory && textEntry(path),
  }
}

export function inspectArchive(data: Uint8Array): ArchiveManifest {
  const signature = data.length >= 4 ? String.fromCharCode(...data.subarray(0, 4)) : ''
  if (signature !== 'PK\u0003\u0004' && signature !== 'PK\u0005\u0006' && signature !== 'PK\u0007\u0008') {
    throw new AttachmentPluginError('文件扩展名是 ZIP，但内容不是有效 ZIP。', 'FILE_TYPE_MISMATCH')
  }
  const entries: ArchiveEntry[] = []
  const paths = new Set<string>()
  let totalUncompressedBytes = 0
  try {
    unzipSync(data, {
      filter: (info) => {
        if (entries.length >= MAX_ARCHIVE_ENTRIES) throw new AttachmentPluginError('ZIP 条目数量超过 10000。', 'ARCHIVE_RESOURCE_LIMIT')
        const entry = validateInfo(info)
        if (paths.has(entry.path)) throw new AttachmentPluginError(`ZIP 包含重复路径：${entry.path}`, 'ARCHIVE_UNSAFE_PATH')
        paths.add(entry.path)
        totalUncompressedBytes += entry.bytes
        if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
          throw new AttachmentPluginError('ZIP 解压后总量超过 256 MiB。', 'ARCHIVE_RESOURCE_LIMIT')
        }
        entries.push(entry)
        return false
      },
    })
  } catch (error) {
    if (error instanceof AttachmentPluginError) throw error
    throw new AttachmentPluginError('ZIP 目录损坏或无法解析。', 'ARCHIVE_CORRUPT', undefined, { cause: error })
  }
  return { entries, totalUncompressedBytes }
}

function decodeText(data: Uint8Array, path: string): string {
  try {
    if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(data.subarray(2))
    if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(data.subarray(2))
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch (error) {
    throw new AttachmentPluginError(`ZIP 文本条目不是 UTF-8/UTF-16：${path}`, 'TEXT_ENCODING_UNSUPPORTED', undefined, { cause: error })
  }
}

function archiveError(error: unknown): never {
  if (error instanceof AttachmentPluginError) throw error
  throw new AttachmentPluginError('ZIP 条目解压失败。', 'ARCHIVE_CORRUPT', undefined, error instanceof Error ? { cause: error } : undefined)
}

function extractSelected(data: Uint8Array, paths: ReadonlySet<string>): ReadonlyMap<string, Uint8Array> {
  try {
    const unzipped = unzipSync(data, { filter: info => paths.has(normalizeArchivePath(info.name)) })
    const result = new Map<string, Uint8Array>()
    for (const [sourcePath, bytes] of Object.entries(unzipped)) result.set(normalizeArchivePath(sourcePath), bytes)
    return result
  } catch (error) {
    archiveError(error)
  }
}

function parseRef(value: Record<string, unknown>): ArchiveRef {
  if (value.schemaVersion !== ARCHIVE_SCHEMA || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.sha256) || typeof value.relativePath !== 'string') {
    throw new AttachmentPluginError('ZIP 存储引用无效。', 'ATTACHMENT_INDEX_FAILED')
  }
  const expected = `${value.sha256.slice(0, 2)}/${value.sha256}.zip`
  if (value.relativePath !== expected) throw new AttachmentPluginError('ZIP 存储路径无效。', 'ATTACHMENT_INDEX_FAILED')
  return value as unknown as ArchiveRef
}

export class ArchiveStore {
  private readonly root: string

  constructor(engineRoot: string) {
    this.root = join(engineRoot, 'archives')
  }

  async open(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
  }

  async save(data: Uint8Array): Promise<{ readonly ref: ArchiveRef; readonly manifest: ArchiveManifest }> {
    const manifest = inspectArchive(data)
    const sha256 = createHash('sha256').update(data).digest('hex')
    const relativePath = `${sha256.slice(0, 2)}/${sha256}.zip`
    const directory = join(this.root, sha256.slice(0, 2))
    const target = join(this.root, relativePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = join(directory, `.${sha256}-${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      await handle.writeFile(data)
      await handle.sync()
      await handle.close()
      handle = undefined
      try { await link(temporary, target) } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      }
      await syncDirectory(directory)
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => {})
      throw new AttachmentPluginError('无法保存 ZIP 附件。', 'ATTACHMENT_STORAGE_FAILED', undefined, { cause: error })
    } finally {
      await unlink(temporary).catch(() => {})
    }
    return { ref: { schemaVersion: ARCHIVE_SCHEMA, sha256, relativePath }, manifest }
  }

  private async load(rawRef: Record<string, unknown>, signal?: AbortSignal): Promise<Uint8Array> {
    const ref = parseRef(rawRef)
    let data: Uint8Array
    try {
      data = new Uint8Array(await readFile(join(this.root, ref.relativePath), { signal }))
    } catch (error) {
      throw new AttachmentPluginError('无法读取 ZIP 附件。', 'ATTACHMENT_STORAGE_FAILED', undefined, { cause: error })
    }
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== ref.sha256) throw new AttachmentPluginError('ZIP 附件完整性校验失败。', 'ATTACHMENT_STORAGE_FAILED')
    return data
  }

  async outline(ref: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const data = await this.load(ref, signal)
    const manifest = inspectArchive(data)
    return {
      documentKind: 'archive', queryKind: 'outline',
      items: manifest.entries.slice(0, MAX_OUTLINE_ENTRIES).map(entry => ({
        id: `entry:${entry.path}`, title: entry.path, type: entry.directory ? 'directory' : 'file',
        bytes: entry.bytes, text_readable: entry.text, locator: { kind: 'archive', path: entry.path },
      })),
      total_entries: manifest.entries.length,
      total_uncompressed_bytes: manifest.totalUncompressedBytes,
      truncated: manifest.entries.length > MAX_OUTLINE_ENTRIES,
    }
  }

  async search(ref: Record<string, unknown>, rawQuery: string, limit: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const query = rawQuery.trim().toLocaleLowerCase()
    if (query === '') throw new AttachmentPluginError('搜索词不能为空。', 'BAD_REQUEST')
    const data = await this.load(ref, signal)
    const manifest = inspectArchive(data)
    let bytes = 0
    const selected: string[] = []
    for (const entry of manifest.entries) {
      if (!entry.text || entry.bytes > MAX_TEXT_ENTRY_BYTES || selected.length >= MAX_SEARCH_FILES) continue
      if (bytes + entry.bytes > MAX_SEARCH_TEXT_BYTES) continue
      bytes += entry.bytes
      selected.push(entry.path)
    }
    const extracted = extractSelected(data, new Set(selected))
    const items: Record<string, unknown>[] = []
    for (const path of selected) {
      const entry = extracted.get(path)
      if (entry === undefined) continue
      const lines = decodeText(entry, path).split(/\r?\n/u)
      for (let index = 0; index < lines.length && items.length < limit; index++) {
        const line = lines[index] ?? ''
        if (line.toLocaleLowerCase().includes(query)) {
          items.push({
            id: `entry:${path}:lines:${index + 1}-${index + 1}`,
            type: 'archive-text', path, text: line,
            locator: { kind: 'archive', path, line: index + 1 },
          })
        }
      }
      if (items.length >= limit) break
    }
    const searchable = manifest.entries.filter(entry => entry.text && entry.bytes <= MAX_TEXT_ENTRY_BYTES).length
    return {
      documentKind: 'archive', queryKind: 'search', items,
      searched_files: selected.length, searchable_files: searchable,
      coverage: selected.length === searchable ? 'COMPLETE' : 'PARTIAL',
    }
  }

  async readEntry(
    ref: Record<string, unknown>, rawPath: string, lineStart = 1, lineEnd?: number, signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const path = normalizeArchivePath(rawPath)
    if (path.endsWith('/')) throw new AttachmentPluginError('不能读取 ZIP 目录条目。', 'ARCHIVE_ENTRY_UNSUPPORTED')
    if (!Number.isSafeInteger(lineStart) || lineStart < 1 || (lineEnd !== undefined && (!Number.isSafeInteger(lineEnd) || lineEnd < lineStart))) {
      throw new AttachmentPluginError('ZIP 文本行范围无效。', 'BAD_REQUEST')
    }
    const data = await this.load(ref, signal)
    const manifest = inspectArchive(data)
    const entry = manifest.entries.find(item => item.path === path && !item.directory)
    if (entry === undefined) throw new AttachmentPluginError(`ZIP 中找不到条目：${path}`, 'ARCHIVE_ENTRY_NOT_FOUND')
    if (!entry.text) throw new AttachmentPluginError(`ZIP 条目不是可读文本：${path}`, 'ARCHIVE_ENTRY_UNSUPPORTED')
    if (entry.bytes > MAX_TEXT_ENTRY_BYTES) throw new AttachmentPluginError(`ZIP 文本条目超过 8 MiB：${path}`, 'ARCHIVE_RESOURCE_LIMIT')
    const extracted = extractSelected(data, new Set([path])).get(path)
    if (extracted === undefined) throw new AttachmentPluginError(`ZIP 中找不到条目：${path}`, 'ARCHIVE_ENTRY_NOT_FOUND')
    const lines = decodeText(extracted, path).split(/\r?\n/u)
    const requestedEnd = lineEnd ?? Math.min(lines.length, lineStart + 399)
    const end = Math.min(lines.length, requestedEnd, lineStart + MAX_READ_LINES - 1)
    const fullText = lines.slice(lineStart - 1, end).join('\n')
    const text = fullText.slice(0, MAX_READ_CHARACTERS)
    return {
      documentKind: 'archive', queryKind: 'entry', path, text,
      locator: { kind: 'archive', path, lineStart, lineEnd: end },
      total_lines: lines.length,
      truncated: end < requestedEnd || fullText.length > text.length,
    }
  }

  async readEntryBytes(ref: Record<string, unknown>, rawPath: string, signal?: AbortSignal): Promise<{ readonly path: string; readonly bytes: Uint8Array }> {
    const path = normalizeArchivePath(rawPath)
    if (path.endsWith('/')) throw new AttachmentPluginError('不能读取 ZIP 目录条目。', 'ARCHIVE_ENTRY_UNSUPPORTED')
    const data = await this.load(ref, signal)
    const manifest = inspectArchive(data)
    const entry = manifest.entries.find(item => item.path === path && !item.directory)
    if (entry === undefined) throw new AttachmentPluginError(`ZIP 中找不到条目：${path}`, 'ARCHIVE_ENTRY_NOT_FOUND')
    const bytes = extractSelected(data, new Set([path])).get(path)
    if (bytes === undefined) throw new AttachmentPluginError(`ZIP 中找不到条目：${path}`, 'ARCHIVE_ENTRY_NOT_FOUND')
    return { path, bytes }
  }
}
