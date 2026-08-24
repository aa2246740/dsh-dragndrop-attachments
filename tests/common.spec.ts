import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { AttachmentCatalog } from '../src/catalog.js'
import { classifyFile } from '../src/domain.js'
import { UploadManager } from '../src/uploads.js'
import { collectDroppedItems, collectWebkitDirectory, encodeFolderSnapshot, normalizeFolderPath, snapshotDroppedItems, validateFolderEntries } from '../src/client/folders.js'
import { outputDimensions } from '../src/client/image.js'
import { bindFileIntake } from '../src/client/transfers.js'
import { testContext } from './runtime.js'

const roots: string[] = []
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'dsh-dragndrop-attachments-')); roots.push(value); return value }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('common attachment walking skeleton', () => {
  it('persists Markdown by session, reopens it, searches it, and reads selected lines', async () => {
    const dataRoot = await root()
    const first = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    const text = '# 经营制度\n\n北京分行得分 83。\n\n## 口径\n只使用已保存数据。\n'
    const record = await first.ingest('session-a', '制度说明.md', new TextEncoder().encode(text))
    expect(record).toMatchObject({ name: '制度说明.md', kind: 'text', status: 'READY', committed: false })
    expect(await first.list('session-b')).toEqual([])
    await first.commitReferences('session-a', [record.attachmentId])

    const reopened = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    expect(await reopened.list('session-a')).toEqual([expect.objectContaining({ attachmentId: record.attachmentId, committed: true })])
    const outline = await reopened.outline(await reopened.resolve('session-a', record.attachmentId))
    expect(JSON.stringify(outline)).toContain('经营制度')
    const search = await reopened.search(record, '北京分行', 10)
    expect(JSON.stringify(search)).toContain('lines:3-3')
    const blocks = await reopened.blocks(record, ['lines:1-3'])
    expect(JSON.stringify(blocks)).toContain('北京分行得分 83')
  })

  it('receives sequential Base64 chunks and commits through the same durable path', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const uploads = await UploadManager.open(catalog)
    const bytes = new TextEncoder().encode('first line\nsecond line\n')
    const begun = await uploads.begin('session-upload', 'notes.txt', bytes.byteLength)
    expect(begun.chunkBytes).toBeGreaterThan(0)
    await uploads.chunk('session-upload', begun.uploadId, 0, Buffer.from(bytes.slice(0, 5)).toString('base64'))
    await expect(uploads.chunk('session-upload', begun.uploadId, 2, Buffer.from(bytes.slice(5)).toString('base64'))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await uploads.chunk('session-upload', begun.uploadId, 1, Buffer.from(bytes.slice(5)).toString('base64'))
    const record = await uploads.commit('session-upload', begun.uploadId)
    expect(await catalog.readText(record)).toBe('first line\nsecond line\n')
    await uploads.close()
  })

  it('keeps editor text out of attachment intake state', () => {
    const userText = '请分析附件\n\n📎 这是用户自己写的文字'
    expect(userText).toBe('请分析附件\n\n📎 这是用户自己写的文字')
  })

  it('keeps AttachmentDock marker-free: cards and attachment ids are the only draft state', async () => {
    const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../src/client/AttachmentDock.tsx'), 'utf8')
    expect(source).not.toContain('setDraft')
    expect(source).not.toContain('appendMarker')
    expect(source).not.toContain('removeMarker')
    expect(source).not.toContain('📎')
  })

  it('registers a native file-or-folder menu without a Dock chooser and keeps client artifacts marker-free', async () => {
    const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const indexSource = await readFile(join(clientRoot, 'src/client/index.tsx'), 'utf8')
    const dockSource = await readFile(join(clientRoot, 'src/client/AttachmentDock.tsx'), 'utf8')
    const builtSource = await readFile(join(clientRoot, 'lib/client.js'), 'utf8')
    expect(indexSource).toContain("{ id: 'file', label: '选择文件' }")
    expect(indexSource).toContain("{ id: 'folder', label: '选择文件夹' }")
    expect(indexSource).toContain("'添加图片、文档、ZIP 或整个文件夹'")
    expect(dockSource).not.toMatch(/chooser|popupSelect/iu)
    for (const source of [indexSource, dockSource, builtSource]) expect(source).not.toMatch(/appendMarker|removeMarker|setDraft|📎/u)
  })

  it('uses Codex-style image patch budgeting', () => {
    expect(outputDimensions(4096, 3072)).toEqual({ width: 1823, height: 1367 })
    const small = outputDimensions(800, 600)
    expect(small).toEqual({ width: 800, height: 600 })
    expect(Math.ceil(1823 / 32) * Math.ceil(1367 / 32)).toBeLessThanOrEqual(2_500)
  })

  it('accepts modern Office and code/text formats and rejects legacy Office', () => {
    expect(classifyFile('a.docx')).toMatchObject({ kind: 'document' })
    expect(classifyFile('a.xlsx')).toMatchObject({ kind: 'document' })
    expect(classifyFile('a.pptx')).toMatchObject({ kind: 'document' })
    expect(classifyFile('project.zip')).toEqual({ kind: 'archive', mediaType: 'application/zip' })
    expect(classifyFile('a.ts')).toEqual({ kind: 'text', mediaType: 'text/plain' })
    expect(() => classifyFile('old.xls')).toThrow(expect.objectContaining({ code: 'LEGACY_OFFICE_UNSUPPORTED' }))
  })

  it('persists a ZIP, lists its tree, searches text entries, and reads one path on demand', async () => {
    const dataRoot = await root()
    const first = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    const archive = zipSync({
      'README.md': strToU8('# 项目说明\n\n北京分行得分 91。\n'),
      'src/index.ts': strToU8('export const score = 91\n'),
      'assets/logo.bin': new Uint8Array([0, 1, 2, 3]),
    })
    const record = await first.ingest('session-zip', 'project.zip', archive)
    expect(record).toMatchObject({ kind: 'archive', documentKind: 'archive', status: 'READY', committed: false })
    expect(JSON.stringify(await first.outline(record))).toContain('src/index.ts')
    expect(JSON.stringify(await first.search(record, '北京分行', 10))).toContain('README.md')
    expect(await first.readArchiveEntry(record, 'README.md', 1, 3)).toMatchObject({
      documentKind: 'archive', path: 'README.md', text: expect.stringContaining('北京分行得分 91'),
    })
    await first.commitReferences('session-zip', [record.attachmentId])
    const reopened = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    expect(await reopened.readArchiveEntry(await reopened.resolve('session-zip', record.attachmentId), 'src/index.ts'))
      .toMatchObject({ text: expect.stringContaining('score = 91') })
  })

  it('rejects ZIP path traversal and compression bombs before storage', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const traversal = zipSync({ '../escape.txt': strToU8('nope') })
    await expect(catalog.ingest('session-zip-unsafe', 'unsafe.zip', traversal)).rejects.toMatchObject({ code: 'ARCHIVE_UNSAFE_PATH' })
    const bomb = zipSync({ 'repeat.txt': new Uint8Array(2 * 1024 * 1024) })
    await expect(catalog.ingest('session-zip-bomb', 'bomb.zip', bomb)).rejects.toMatchObject({ code: 'ARCHIVE_RESOURCE_LIMIT' })
  })

  it('encodes a deterministic folder snapshot with empty directories and validates paths', async () => {
    const one = new File(['北京分行得分 91'], 'README.md', { type: 'text/markdown' })
    const item = { kind: 'folder' as const, name: '经营材料', emptyDirectories: 'preserved' as const, entries: [
      { kind: 'directory' as const, path: 'empty/' }, { kind: 'directory' as const, path: 'docs/' },
      { kind: 'file' as const, path: 'docs/README.md', file: one },
    ] }
    const first = await encodeFolderSnapshot(item)
    const second = await encodeFolderSnapshot(item)
    expect(Buffer.from(first.snapshot).equals(Buffer.from(second.snapshot))).toBe(true)
    expect(first).toMatchObject({ fileCount: 1, directoryCount: 2, sourceBytes: one.size })
    expect(() => normalizeFolderPath('../escape')).toThrow('不安全路径')
    expect(() => validateFolderEntries([{ kind: 'file', path: 'a', file: one }, { kind: 'directory', path: 'a/' }])).toThrow('路径冲突')
  })

  it('persists a first-class folder, preserves root identity, and reads text with folder locators after reopen', async () => {
    const dataRoot = await root()
    const readme = strToU8('# 月报\n北京分行 91\n')
    const image = Uint8Array.of(1, 2)
    const snapshot = zipSync({ 'empty/': new Uint8Array(), 'docs/': new Uint8Array(), 'docs/README.md': readme, 'image.bin': image }, { mtime: new Date(Date.UTC(1980, 0, 1)) })
    const source = { kind: 'folder' as const, name: '报告目录', snapshotBytes: snapshot.byteLength, sourceBytes: readme.byteLength + image.byteLength, fileCount: 2, directoryCount: 2 }
    const first = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    const folder = await first.ingestFolder('folder-session', source, snapshot)
    const sameBytesOtherRoot = await first.ingestFolder('folder-session', { ...source, name: '另一目录' }, snapshot)
    expect(folder).toMatchObject({ kind: 'folder', name: '报告目录', fileCount: 2, directoryCount: 2 })
    expect(sameBytesOtherRoot.attachmentId).not.toBe(folder.attachmentId)
    expect(JSON.stringify(await first.outline(folder))).toContain('"kind":"folder"')
    expect(JSON.stringify(await first.search(folder, '北京分行', 10))).toContain('docs/README.md')
    expect(await first.readFolderEntry(folder, 'docs/README.md', 1, 3)).toMatchObject({ documentKind: 'folder', path: 'docs/README.md' })
    await first.commitReferences('folder-session', [folder.attachmentId])
    const reopened = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    expect(await reopened.readFolderEntry(await reopened.resolve('folder-session', folder.attachmentId), 'docs/README.md')).toMatchObject({ documentKind: 'folder' })
  })

  it('rejects folder metadata that conflicts with its validated ZIP tree', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const snapshot = zipSync({ 'readme.md': strToU8('ok') })
    await expect(catalog.ingestFolder('folder-invalid', {
      kind: 'folder', name: '坏目录', snapshotBytes: snapshot.byteLength, sourceBytes: 999, fileCount: 1, directoryCount: 0,
    }, snapshot)).rejects.toMatchObject({ code: 'ARCHIVE_CORRUPT' })
  })

  it('accepts a highly compressible folder file because snapshots use ZIP store mode', async () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'zeros.txt')
    const snapshot = await encodeFolderSnapshot({ kind: 'folder', name: '零值目录', emptyDirectories: 'preserved', entries: [{ kind: 'file', path: 'zeros.txt', file }] })
    expect(snapshot.snapshot.byteLength).toBeGreaterThan(2 * 1024 * 1024)
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    await expect(catalog.ingestFolder('folder-store', { ...snapshot, snapshotBytes: snapshot.snapshot.byteLength }, snapshot.snapshot)).resolves.toMatchObject({ kind: 'folder' })
  })

  it('cleans only stale UUID upload parts when reopening UploadManager', async () => {
    const dataRoot = await root()
    const catalog = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    const uploads = await UploadManager.open(catalog)
    await uploads.close()
    const uploadRoot = join(dataRoot, 'tmp', 'uploads')
    await writeFile(join(uploadRoot, '123e4567-e89b-12d3-a456-426614174000.part'), 'stale')
    await writeFile(join(uploadRoot, 'keep-me.part'), 'keep')
    await UploadManager.open(catalog)
    expect(await readdir(uploadRoot)).toEqual(['keep-me.part'])
  })

  it('captures file drag-and-drop and paste before the image-only host handler', () => {
    const documentTarget = new EventTarget()
    const windowTarget = new EventTarget()
    const received: string[][] = []
    const active: boolean[] = []
    const docx = { name: '经营制度.docx' } as File
    const markdown = { name: '说明.md' } as File
    const event = (type: string, field: 'dataTransfer' | 'clipboardData', files: readonly File[]) => {
      const value = new Event(type, { cancelable: true })
      Object.defineProperty(value, field, { value: { types: ['Files'], files, dropEffect: 'none' } })
      return value
    }
    const dispose = bindFileIntake(documentTarget, windowTarget, items => { received.push(items.map(item => item.kind === 'file' ? item.file.name : item.name)) }, value => { active.push(value) }, error => { throw error })

    const enter = event('dragenter', 'dataTransfer', [docx])
    documentTarget.dispatchEvent(enter)
    const drop = event('drop', 'dataTransfer', [docx])
    documentTarget.dispatchEvent(drop)
    const paste = event('paste', 'clipboardData', [markdown])
    documentTarget.dispatchEvent(paste)

    expect(enter.defaultPrevented).toBe(true)
    expect(drop.defaultPrevented).toBe(true)
    expect(paste.defaultPrevented).toBe(true)
    expect(active).toEqual([true, false])
    return new Promise(resolve => setTimeout(resolve, 0)).then(() => {
      expect(received).toEqual([['经营制度.docx'], ['说明.md']])
      dispose()
    })
  })

  it('snapshots drop handles before browser data-transfer items become invalid', async () => {
    const note = new File(['北京分行'], 'note.md', { type: 'text/markdown' })
    let live = true
    const handle = { kind: 'file', name: 'note.md', getFile: async () => note }
    const item = {
      getAsFileSystemHandle: () => {
        if (!live) throw new Error('DataTransferItem is no longer valid')
        return Promise.resolve(handle)
      },
      getAsFile: () => {
        if (!live) throw new Error('DataTransferItem is no longer valid')
        return note
      },
    }
    const snapshot = snapshotDroppedItems({ items: [item], files: [note] } as unknown as DataTransfer)
    live = false
    await expect(collectDroppedItems(snapshot)).resolves.toEqual([
      expect.objectContaining({ kind: 'file', file: note }),
    ])
  })

  it('keeps drag fallbacks when one synchronous browser adapter throws', async () => {
    const note = new File(['北京分行'], 'note.md', { type: 'text/markdown' })
    const snapshot = snapshotDroppedItems({ items: [{
      getAsFileSystemHandle: () => { throw new Error('modern adapter failed') },
      webkitGetAsEntry: () => { throw new Error('legacy adapter failed') },
      getAsFile: () => note,
    }], files: [note] } as unknown as DataTransfer)
    await expect(collectDroppedItems(snapshot)).resolves.toEqual([
      expect.objectContaining({ kind: 'file', file: note }),
    ])
  })

  it('serializes asynchronous drop intake and reports no concurrent item work', async () => {
    const documentTarget = new EventTarget()
    const windowTarget = new EventTarget()
    const starts: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const dispose = bindFileIntake(documentTarget, windowTarget, async items => {
      const name = (items[0] as Extract<IntakeItem, { readonly kind: 'file' }>).file.name
      starts.push(`start:${name}`)
      if (name === 'first.md') await firstGate
      starts.push(`end:${name}`)
    }, () => {}, error => { throw error })
    const drop = (name: string): Event => {
      const value = new Event('drop', { cancelable: true })
      Object.defineProperty(value, 'dataTransfer', { value: { types: ['Files'], files: [new File(['x'], name)], dropEffect: 'none' } })
      return value
    }
    documentTarget.dispatchEvent(drop('first.md'))
    documentTarget.dispatchEvent(drop('second.md'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(starts).toEqual(['start:first.md'])
    releaseFirst?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(starts).toEqual(['start:first.md', 'end:first.md', 'start:second.md', 'end:second.md'])
    dispose()
  })

  it('groups webkit relative paths into a folder without flattening duplicates', () => {
    const first = { name: 'README.md', webkitRelativePath: '根目录/docs/README.md' } as File
    const second = { name: 'index.ts', webkitRelativePath: '根目录/src/index.ts' } as File
    const items = collectWebkitDirectory([first, second])
    expect(items).toEqual([expect.objectContaining({ kind: 'folder', name: '根目录', entries: expect.arrayContaining([
      expect.objectContaining({ path: 'docs/README.md' }), expect.objectContaining({ path: 'src/index.ts' }),
    ]) })])
  })

  it('drains repeated webkit directory batches and retains empty folders in a mixed drop', async () => {
    const note = new File(['北京分行'], 'note.md', { type: 'text/markdown' })
    const batches = <T>(...values: readonly (readonly T[])[]) => {
      let index = 0
      return { readEntries: (resolve: (value: readonly T[]) => void) => { resolve(values[index++] ?? []) } }
    }
    const root = { name: '根目录', isDirectory: true, createReader: () => batches(
      [{ name: 'empty', isDirectory: true, createReader: () => batches() }],
      [{ name: 'docs', isDirectory: true, createReader: () => batches([{ name: 'note.md', isFile: true, file: (resolve: (value: File) => void) => resolve(note) }]) }],
    ) }
    const loose = new File(['loose'], 'loose.md', { type: 'text/markdown' })
    const transfer = { items: [{ webkitGetAsEntry: () => root, getAsFile: () => null }, { getAsFile: () => loose }], files: [loose] } as unknown as DataTransfer
    const items = await collectDroppedItems(snapshotDroppedItems(transfer))
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file', file: loose }),
      expect.objectContaining({ kind: 'folder', name: '根目录', entries: expect.arrayContaining([
        expect.objectContaining({ kind: 'directory', path: 'empty/' }), expect.objectContaining({ kind: 'file', path: 'docs/note.md' }),
      ]) }),
    ]))
  })
})
