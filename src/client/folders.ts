import { zipSync, type Zippable } from 'fflate/browser'

export const MAX_FOLDER_FILES = 10_000
export const MAX_FOLDER_SOURCE_BYTES = 100 * 1024 * 1024
export const MAX_FOLDER_SNAPSHOT_BYTES = 128 * 1024 * 1024
const FIXED_ZIP_TIME = new Date(Date.UTC(1980, 0, 1))

export type FolderEntry =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'file'; readonly path: string; readonly file: File }

export type IntakeItem =
  | { readonly kind: 'file'; readonly file: File }
  | { readonly kind: 'folder'; readonly name: string; readonly entries: readonly FolderEntry[]; readonly emptyDirectories: 'preserved' | 'unavailable' }

export interface EncodedFolderSnapshot {
  readonly kind: 'folder'
  readonly name: string
  readonly sourceBytes: number
  readonly fileCount: number
  readonly directoryCount: number
  readonly snapshot: Uint8Array
  readonly emptyDirectories: 'preserved' | 'unavailable'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeFolderPath(raw: string, directory = false): string {
  const normalized = raw.normalize('NFC')
  if (normalized.includes('\0') || normalized.includes('\\') || normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:[\\/]/u.test(normalized)) {
    throw new Error(`文件夹包含不安全路径：${raw}`)
  }
  const body = directory && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  const parts = body.split('/')
  if (new TextEncoder().encode(normalized).byteLength > 4096 || body === '' || parts.some(part => part === '' || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/u.test(part) || new TextEncoder().encode(part).byteLength > 255)) {
    throw new Error(`文件夹包含不安全路径：${raw}`)
  }
  return `${parts.join('/')}${directory ? '/' : ''}`
}

function rootName(raw: string): string {
  const name = raw.replace(/[\\/\u0000-\u001f\u007f]/gu, '').trim()
  if (name === '') throw new Error('文件夹名称不能为空。')
  return name.slice(0, 255)
}

function parentDirectories(path: string): readonly string[] {
  const parts = path.split('/')
  const result: string[] = []
  for (let index = 1; index < parts.length; index++) result.push(`${parts.slice(0, index).join('/')}/`)
  return result
}
function stripRootPath(root: string, path: string): string {
  const prefix = `${root}/`
  if (!path.startsWith(prefix)) throw new Error('浏览器目录根路径不一致。')
  return path.slice(prefix.length)
}
function withoutRoot(entries: readonly FolderEntry[], root: string): readonly FolderEntry[] {
  return entries.flatMap(entry => entry.kind === 'directory' && entry.path === `${root}/` ? [] : [entry.kind === 'directory'
    ? { kind: 'directory' as const, path: stripRootPath(root, entry.path) }
    : { kind: 'file' as const, path: stripRootPath(root, entry.path), file: entry.file }])
}

export function validateFolderEntries(rawEntries: readonly FolderEntry[]): readonly FolderEntry[] {
  const paths = new Set<string>()
  const files = new Set<string>()
  const directories = new Set<string>()
  const entries = rawEntries.map(entry => entry.kind === 'directory'
    ? { kind: 'directory' as const, path: normalizeFolderPath(entry.path, true) }
    : { kind: 'file' as const, path: normalizeFolderPath(entry.path), file: entry.file })
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new Error(`文件夹包含重复路径：${entry.path}`)
    paths.add(entry.path)
    if (entry.kind === 'directory') directories.add(entry.path.slice(0, -1))
    else files.add(entry.path)
  }
  for (const file of files) {
    for (const parent of parentDirectories(file)) if (files.has(parent.slice(0, -1))) throw new Error(`文件和目录路径冲突：${parent}`)
  }
  for (const directory of directories) if (files.has(directory)) throw new Error(`文件和目录路径冲突：${directory}`)
  return entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

export async function encodeFolderSnapshot(item: Extract<IntakeItem, { readonly kind: 'folder' }>): Promise<EncodedFolderSnapshot> {
  const name = rootName(item.name)
  const entries = validateFolderEntries(item.entries)
  const files = entries.filter((entry): entry is Extract<FolderEntry, { readonly kind: 'file' }> => entry.kind === 'file')
  const directories = entries.filter((entry): entry is Extract<FolderEntry, { readonly kind: 'directory' }> => entry.kind === 'directory')
  const sourceBytes = files.reduce((sum, entry) => sum + entry.file.size, 0)
  if (files.length > MAX_FOLDER_FILES || entries.length > MAX_FOLDER_FILES || sourceBytes > MAX_FOLDER_SOURCE_BYTES) {
    throw new Error('文件夹超过本地附件安全上限。')
  }
  const payload: Zippable = {}
  for (const entry of directories) payload[entry.path] = [new Uint8Array(), { level: 0, mtime: FIXED_ZIP_TIME, attrs: 0o40755 << 16 }]
  for (const entry of files) payload[entry.path] = [new Uint8Array(await entry.file.arrayBuffer()), { level: 0, mtime: FIXED_ZIP_TIME, attrs: 0o100644 << 16 }]
  const snapshot = zipSync(payload, { level: 0, mtime: FIXED_ZIP_TIME, os: 3 })
  if (snapshot.byteLength > MAX_FOLDER_SNAPSHOT_BYTES) throw new Error('文件夹快照超过 128 MiB 上限。')
  return {
    kind: 'folder', name, sourceBytes, fileCount: files.length, directoryCount: directories.length,
    snapshot, emptyDirectories: item.emptyDirectories,
  }
}

function hasFunction(value: Record<string, unknown>, name: string): boolean { return typeof value[name] === 'function' }
function call(value: Record<string, unknown>, name: string, args: readonly unknown[]): unknown {
  const member = value[name]
  if (typeof member !== 'function') throw new Error(`浏览器目录 API ${name} 不可用。`)
  return Reflect.apply(member, value, args)
}
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return isRecord(value) && typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
}

function asFile(value: unknown): File {
  if (!(value instanceof File)) throw new Error('浏览器目录条目不是文件。')
  return value
}

async function handleToEntries(handle: unknown, prefix: string): Promise<readonly FolderEntry[]> {
  if (!isRecord(handle) || typeof handle.kind !== 'string' || typeof handle.name !== 'string') throw new Error('浏览器目录句柄无效。')
  const path = prefix === '' ? handle.name : `${prefix}/${handle.name}`
  if (handle.kind === 'file') {
    if (!hasFunction(handle, 'getFile')) throw new Error('浏览器文件句柄无效。')
    return [{ kind: 'file', path: normalizeFolderPath(path), file: asFile(await call(handle, 'getFile', [])) }]
  }
  if (handle.kind !== 'directory' || !hasFunction(handle, 'values')) throw new Error('浏览器目录句柄无效。')
  const iterator = call(handle, 'values', [])
  if (!isAsyncIterable(iterator)) throw new Error('浏览器目录遍历不可用。')
  const children: FolderEntry[] = [{ kind: 'directory', path: normalizeFolderPath(path, true) }]
  for await (const child of iterator) children.push(...await handleToEntries(child, path))
  return children
}

function readerBatch(reader: Record<string, unknown>): Promise<readonly unknown[]> {
  if (!hasFunction(reader, 'readEntries')) throw new Error('浏览器目录读取器无效。')
  return new Promise((resolve, reject) => {
    call(reader, 'readEntries', [resolve, reject])
  })
}

async function entryToEntries(entry: unknown, prefix: string): Promise<readonly FolderEntry[]> {
  if (!isRecord(entry) || typeof entry.name !== 'string') throw new Error('浏览器目录条目无效。')
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
  if (entry.isFile === true) {
    if (!hasFunction(entry, 'file')) throw new Error('浏览器文件条目无效。')
    const file = await new Promise<File>((resolve, reject) => { call(entry, 'file', [resolve, reject]) })
    return [{ kind: 'file', path: normalizeFolderPath(path), file }]
  }
  if (entry.isDirectory !== true || !hasFunction(entry, 'createReader')) throw new Error('浏览器目录条目无效。')
  const reader = call(entry, 'createReader', [])
  if (!isRecord(reader)) throw new Error('浏览器目录读取器无效。')
  const children: FolderEntry[] = [{ kind: 'directory', path: normalizeFolderPath(path, true) }]
  for (;;) {
    const batch = await readerBatch(reader)
    if (batch.length === 0) break
    for (const child of batch) children.push(...await entryToEntries(child, path))
  }
  return children
}

function fileItem(file: File): IntakeItem { return { kind: 'file', file } }

function entryFromRelativeFiles(files: readonly File[]): readonly IntakeItem[] {
  const groups = new Map<string, FolderEntry[]>()
  const plain: IntakeItem[] = []
  for (const file of files) {
    const candidate: unknown = file
    const relative = isRecord(candidate) && typeof candidate.webkitRelativePath === 'string' ? candidate.webkitRelativePath : ''
    if (relative === '') { plain.push(fileItem(file)); continue }
    const segments = relative.replaceAll('\\', '/').split('/')
    const root = rootName(segments.shift() ?? '')
    const path = normalizeFolderPath(segments.join('/'))
    const entries = groups.get(root) ?? []
    for (const parent of parentDirectories(path)) if (!entries.some(entry => entry.kind === 'directory' && entry.path === parent)) entries.push({ kind: 'directory', path: parent })
    entries.push({ kind: 'file', path, file })
    groups.set(root, entries)
  }
  return [...plain, ...[...groups.entries()].map(([name, entries]) => ({ kind: 'folder' as const, name, entries: validateFolderEntries(entries), emptyDirectories: 'unavailable' as const }))]
}

export interface DropItemSnapshot { readonly modern?: Promise<unknown>; readonly legacy?: unknown; readonly file: File | null }

export function snapshotDropItem(item: DataTransferItem): DropItemSnapshot {
  const candidate: unknown = item
  let modern: Promise<unknown> | undefined
  let legacy: unknown
  let file: File | null = null
  if (isRecord(candidate) && hasFunction(candidate, 'getAsFileSystemHandle')) {
    try { modern = Promise.resolve(call(candidate, 'getAsFileSystemHandle', [])).catch(() => undefined) } catch {}
  }
  if (isRecord(candidate) && hasFunction(candidate, 'webkitGetAsEntry')) {
    try { legacy = call(candidate, 'webkitGetAsEntry', []) } catch {}
  }
  try { file = item.getAsFile() } catch {}
  return { modern, legacy, file }
}

async function itemFromSnapshot(snapshot: DropItemSnapshot): Promise<IntakeItem | undefined> {
  if (snapshot.modern !== undefined) {
    const handle = await snapshot.modern.catch(() => undefined)
    if (isRecord(handle) && handle.kind === 'directory') {
      const entries = await handleToEntries(handle, '')
      const root = rootName(String(handle.name))
      return { kind: 'folder', name: root, entries: validateFolderEntries(withoutRoot(entries, root)), emptyDirectories: 'preserved' }
    }
    if (isRecord(handle) && handle.kind === 'file' && hasFunction(handle, 'getFile')) return fileItem(asFile(await call(handle, 'getFile', [])))
  }
  if (snapshot.legacy !== undefined) {
    const entry = snapshot.legacy
    if (isRecord(entry) && entry.isDirectory === true) {
      const entries = await entryToEntries(entry, '')
      const root = rootName(String(entry.name))
      return { kind: 'folder', name: root, entries: validateFolderEntries(withoutRoot(entries, root)), emptyDirectories: 'preserved' }
    }
    if (isRecord(entry) && entry.isFile === true) {
      const values = await entryToEntries(entry, '')
      const first = values[0]
      if (first?.kind === 'file') return fileItem(first.file)
    }
  }
  const file = snapshot.file
  return file === null ? undefined : fileItem(file)
}

export function snapshotDroppedItems(dataTransfer: DataTransfer): { readonly items: readonly DropItemSnapshot[]; readonly files: readonly File[] } {
  return { items: dataTransfer.items === undefined ? [] : [...dataTransfer.items].map(snapshotDropItem), files: [...dataTransfer.files] }
}

export async function collectDroppedItems(snapshot: { readonly items: readonly DropItemSnapshot[]; readonly files: readonly File[] }): Promise<readonly IntakeItem[]> {
  if (snapshot.items.length > 0) {
    const values = await Promise.all(snapshot.items.map(itemFromSnapshot))
    const items = values.filter((value): value is IntakeItem => value !== undefined)
    if (items.length > 0) return items
  }
  return entryFromRelativeFiles(snapshot.files)
}

export function supportsModernDirectoryPicker(): boolean {
  const candidate: unknown = window
  return isRecord(candidate) && hasFunction(candidate, 'showDirectoryPicker')
}

export async function collectPickedDirectory(): Promise<IntakeItem> {
  const candidate: unknown = window
  if (supportsModernDirectoryPicker() && isRecord(candidate)) {
    const handle = await call(candidate, 'showDirectoryPicker', [])
    if (!isRecord(handle) || handle.kind !== 'directory' || typeof handle.name !== 'string') throw new Error('文件夹选择器没有返回目录。')
    const entries = await handleToEntries(handle, '')
    const root = rootName(handle.name)
    return { kind: 'folder', name: root, entries: validateFolderEntries(withoutRoot(entries, root)), emptyDirectories: 'preserved' }
  }
  throw new Error('此浏览器不支持保留空目录的文件夹选择器。')
}

export function collectWebkitDirectory(files: readonly File[]): readonly IntakeItem[] { return entryFromRelativeFiles(files) }
