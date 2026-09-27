import { mkdtemp, rm, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { NativeDocumentReader, registerNativeDocumentReader } from '../src/native-reader.js'
import { testContext } from './runtime.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'native-documents-'))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(ToolFs)
  ctx.provide('subprocess', testContext().get('subprocess'))
  const reader = new NativeDocumentReader(ctx, join(root, 'store'))
  const scope = ctx.plugin({ name: 'native-reader-test', inject: ['tools', 'systemPrompt', 'fs'], apply(inner: Context) { registerNativeDocumentReader(inner, reader) } })
  await scope
  let serial = 0
  const execute = (name: string, args: Record<string, unknown>, signal = new AbortController().signal) => ctx.tools.execute({
    callId: ToolCallId(`read-${++serial}`), name, arguments: args, signal,
  })
  const fixture = async (source: string, name = source.split('/').at(-1)!) => {
    const path = join(root, name); await copyFile(join(fixtures, source), path); return path
  }
  return { ctx, root, scope, execute, fixture }
}

describe('native read augmentation with actual official tool runtime', () => {
  it('handles non-UTF8 CSV with one success result and no text-edit observation; disable restores native', async () => {
    const { ctx, fixture, execute, scope } = await setup()
    const path = await fixture('csv/gb18030.csv')
    const results: boolean[] = []; let observed = 0
    ctx.on('tools/result', (_exec, result) => { results.push(result.isError) })
    ctx.on('fs/observed', () => { observed++ })
    const result = await execute('read', { file_path: path })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('深圳分行')
    expect(results).toEqual([false]); expect(observed).toBe(0)
    await scope.dispose()
    const native = await execute('read', { file_path: path })
    expect(native.isError).toBe(true)
    expect(JSON.stringify(native)).toContain('FS_NOT_TEXT')
  })

  it('preserves native text/PDF behavior, validation, denial and cancellation', async () => {
    const { ctx, root, fixture, execute } = await setup()
    await writeFile(join(root, 'plain.txt'), 'NATIVE_TEXT_OK')
    await writeFile(join(root, 'plain.pdf'), 'NATIVE_PDF_DELEGATION')
    for (const name of ['plain.txt', 'plain.pdf']) {
      const result = await execute('read', { file_path: name })
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result)).toContain('NATIVE_')
    }
    const csv = await fixture('csv/utf8.csv')
    expect((await execute('read', { file_path: csv, offset: 0 })).isError).toBe(true)
    expect((await execute('read', { file_path: csv }, AbortSignal.abort())).isError).toBe(true)
    const deny = ctx.on('tools/pre-execute', async () => ({ kind: 'deny' as const, reason: 'READ_DENIED' }))
    for (const name of ['read', 'read_document_file']) expect(JSON.stringify(await execute(name, { file_path: csv }))).toContain('READ_DENIED')
    deny()
  })

  it('does not confuse same filenames or retain stale parsed contents after a file changes', async () => {
    const { root, execute } = await setup()
    for (const part of ['one', 'two']) { await mkdir(join(root, part)); await writeFile(join(root, part, 'same.csv'), `name,value\n${part},1\n`) }
    for (const part of ['one', 'two']) {
      const result = await execute('read', { file_path: join(part, 'same.csv') })
      expect(result.isError).toBe(false); expect(JSON.stringify(result)).toContain(part)
    }
    await writeFile(join(root, 'one/same.csv'), 'name,value\nCHANGED,2\n')
    expect(JSON.stringify(await execute('read', { file_path: 'one/same.csv' }))).toContain('CHANGED')
  })

  it('reads ZIP entries without extracting paths and reports corrupt inputs as errors', async () => {
    const { root, execute } = await setup()
    await writeFile(join(root, 'source.zip'), zipSync({ 'docs/a.md': strToU8('ZIP_MARKER'), 'asset.bin': new Uint8Array([0, 255]) }))
    expect((await execute('read', { file_path: 'source.zip' })).isError).toBe(false)
    const entry = await execute('read_document_file', { file_path: 'source.zip', operation: 'archive-entry', entry_path: 'docs/a.md' })
    expect(entry.isError).toBe(false); expect(JSON.stringify(entry)).toContain('ZIP_MARKER')
    await writeFile(join(root, 'corrupt.docx'), new Uint8Array([0x50, 0x4b, 3, 4]))
    expect((await execute('read', { file_path: 'corrupt.docx' })).isError).toBe(true)
  })

  it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('reads DOCX/XLSX/PPTX via native paths and retains exact semantic locators', async () => {
    const { fixture, execute } = await setup()
    for (const name of ['operations-policy.docx', 'operations-analysis.xlsx', 'operations-report.pptx']) {
      const path = await fixture(`office/${name}`)
      const result = await execute('read', { file_path: path })
      expect(result.isError, JSON.stringify(result)).toBe(false)
      expect(JSON.stringify(result)).toContain('extracted-document')
    }
    for (const [name, args, marker] of [
      ['operations-policy.docx', { operation: 'document-path', semantic_path: '/body/tbl[1]' }, '北京分行'],
      ['operations-analysis.xlsx', { operation: 'spreadsheet-range', sheet: '汇总', range: 'A1:D2' }, '=B2*C2'],
      ['operations-report.pptx', { operation: 'slide', slide_number: 1 }, '重点指标为 83 分'],
    ] as const) {
      const result = await execute('read_document_file', { file_path: name, ...args })
      expect(result.isError, JSON.stringify(result)).toBe(false)
      expect(JSON.stringify(result)).toContain(marker)
    }
  }, 60000)
})
