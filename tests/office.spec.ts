import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { AttachmentCatalog } from '../src/catalog.js'
import { testContext } from './runtime.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const roots: string[] = []
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'dsh-dragndrop-office-')); roots.push(value); return value }
async function bytes(path: string): Promise<Uint8Array> { return new Uint8Array(await readFile(join(FIXTURES, path))) }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('OfficeCLI plugin pipeline', () => {
  it('extracts DOCX paragraphs and tables with stable semantic locators after reopen', async () => {
    const dataRoot = await root()
    const catalog = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    const record = await catalog.ingest('office-session', '经营制度.docx', await bytes('office/operations-policy.docx'))
    expect(record).toMatchObject({ documentKind: 'document', status: 'READY', parser: 'officecli-1.0.144' })
    const search = await catalog.search(record, '北京分行', 10)
    expect(JSON.stringify(search)).toContain('/body/tbl[1]')
    const reopened = await AttachmentCatalog.open(testContext(), { root: dataRoot })
    const path = await reopened.documentQuery(await reopened.resolve('office-session', record.attachmentId), { kind: 'document-path', path: '/body/tbl[1]' })
    expect(JSON.stringify(path)).toContain('北京分行')
  }, 60_000)

  it('keeps rich DOCX headers, footnotes, and comments addressable by semantic path', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const record = await catalog.ingest('rich-docx', 'semantic-rich.docx', await bytes('office/semantic-rich.docx'))
    const header = await catalog.documentQuery(record, { kind: 'document-path', path: '/header[1]' })
    const footnotes = await catalog.documentQuery(record, { kind: 'document-path', path: '/footnotes' })
    const comments = await catalog.documentQuery(record, { kind: 'document-path', path: '/comments' })
    expect(JSON.stringify(header)).toContain('Header: internal operations attachment')
    expect(JSON.stringify(footnotes)).toContain('Footnote: source is the 2026 operating policy')
    expect(JSON.stringify(comments)).toContain('Comment: verify the Beijing branch source')
    expect(JSON.stringify(comments)).toContain('/comments/comment[1]')
  }, 60_000)

  it('separates PPTX slide text and speaker notes', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const record = await catalog.ingest('ppt-session', '经营汇报.pptx', await bytes('office/operations-report.pptx'))
    const first = await catalog.documentQuery(record, { kind: 'slide', slide: 1, includeNotes: true })
    expect(JSON.stringify(first)).toContain('重点指标为 83 分')
    expect(JSON.stringify(first)).toContain('演讲者备注')
    const second = await catalog.documentQuery(record, { kind: 'slide', slide: 2, includeNotes: false })
    expect(JSON.stringify(second)).toContain('北京分行')
  }, 60_000)

  it('keeps PPTX picture geometry and source notes in the slide result', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const record = await catalog.ingest('rich-pptx', 'semantic-rich.pptx', await bytes('office/semantic-rich.pptx'))
    const slide = await catalog.documentQuery(record, { kind: 'slide', slide: 1, includeNotes: true })
    const value = JSON.stringify(slide)
    expect(value).toContain('Office image and notes acceptance')
    expect(value).toContain('/slide[1]/picture[@id=6]')
    expect(value).toContain('"visionStatus":"NOT_REQUESTED"')
    expect(value).toContain('Speaker note: inspect the QR acceptance marker separately')
  }, 60_000)

  it('reads XLSX hidden sheets, exact cells, formulas, and saved-value status', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const record = await catalog.ingest('xlsx-session', '经营分析.xlsx', await bytes('office/operations-analysis.xlsx'))
    const outline = await catalog.outline(record)
    expect(JSON.stringify(outline)).toContain('隐藏参数')
    const range = await catalog.documentQuery(record, { kind: 'spreadsheet-range', sheet: '汇总', range: 'A1:D2' })
    expect(JSON.stringify(range)).toContain('北京分行')
    expect(JSON.stringify(range)).toContain('=B2*C2')
    expect(JSON.stringify(range)).toContain('FORMULA_ONLY')
  }, 60_000)

  it('preserves CSV quoted newlines and strictly decodes GB18030', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const quoted = await catalog.ingest('csv-session', 'quoted.csv', await bytes('csv/quoted-newlines.csv'))
    const quotedRange = await catalog.documentQuery(quoted, { kind: 'spreadsheet-range', sheet: 'CSV', range: 'A1:C3' })
    expect(JSON.stringify(quotedRange)).toContain('第一行\\n第二行,含逗号')
    const gb = await catalog.ingest('csv-session', '中文.csv', await bytes('csv/gb18030.csv'))
    expect(gb.coverage.included).toContain('encoding:gb18030')
    const gbRange = await catalog.documentQuery(gb, { kind: 'spreadsheet-range', sheet: 'CSV', range: 'A1:C2' })
    expect(JSON.stringify(gbRange)).toContain('深圳分行')
  }, 60_000)

  it('queries DOCX, XLSX, PPTX, and CSV entries inside one folder attachment', async () => {
    const policy = await bytes('office/operations-policy.docx')
    const workbook = await bytes('office/operations-analysis.xlsx')
    const slides = await bytes('office/operations-report.pptx')
    const csv = await bytes('csv/quoted-newlines.csv')
    const snapshot = zipSync({
      'docs/': new Uint8Array(), 'docs/policy.docx': policy, 'docs/analysis.xlsx': workbook,
      'docs/report.pptx': slides, 'docs/quoted.csv': csv,
    }, { mtime: new Date(Date.UTC(1980, 0, 1)) })
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const folder = await catalog.ingestFolder('folder-office', {
      kind: 'folder', name: '经营材料', snapshotBytes: snapshot.byteLength,
      sourceBytes: policy.byteLength + workbook.byteLength + slides.byteLength + csv.byteLength,
      fileCount: 4, directoryCount: 1,
    }, snapshot)
    const docx = await catalog.folderDocumentQuery(folder, 'docs/policy.docx', { kind: 'outline' })
    const xlsx = await catalog.folderDocumentQuery(folder, 'docs/analysis.xlsx', { kind: 'spreadsheet-range', sheet: '汇总', range: 'A1:D2' })
    const pptx = await catalog.folderDocumentQuery(folder, 'docs/report.pptx', { kind: 'slide', slide: 1, includeNotes: true })
    expect(JSON.stringify(docx)).toContain('经营制度')
    expect(JSON.stringify(xlsx)).toContain('北京分行')
    expect(JSON.stringify(pptx)).toContain('重点指标为 83 分')
    for (const [result, path] of [[docx, 'docs/policy.docx'], [xlsx, 'docs/analysis.xlsx'], [pptx, 'docs/report.pptx']] as const) {
      expect(JSON.stringify(result)).toContain(`"path":"${path}"`)
      expect(JSON.stringify(result)).toContain('"entry_locator"')
    }
    expect(JSON.stringify(await catalog.folderDocumentQuery(folder, 'docs/quoted.csv', { kind: 'spreadsheet-range', sheet: 'CSV', range: 'A1:C3' }))).toContain('第一行\\n第二行')
  }, 120_000)

  it('returns stable user-actionable codes for mismatched, corrupt, and legacy files', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    await expect(catalog.ingest('bad-session', '伪装.xlsx', await bytes('office/operations-policy.docx')))
      .rejects.toMatchObject({ code: 'FILE_TYPE_MISMATCH' })
    await expect(catalog.ingest('bad-session', '损坏.docx', Uint8Array.of(0x50, 0x4b, 3, 4)))
      .rejects.toMatchObject({ code: 'DOCUMENT_CORRUPT' })
    await expect(catalog.ingest('bad-session', '旧格式.doc', Uint8Array.of(1, 2, 3)))
      .rejects.toMatchObject({ code: 'LEGACY_OFFICE_UNSUPPORTED' })
  }, 60_000)
})
