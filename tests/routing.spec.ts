import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentCatalog } from '../src/catalog.js'
import { attachmentDiscoveryDenial, registerAttachmentTools } from '../src/tools.js'
import { AttachmentTurnState } from '../src/turn-context.js'
import { testContext } from './runtime.js'

interface CapturedTool {
  readonly name: string
  execute(args: Record<string, unknown>, exec: { readonly signal: AbortSignal }): Promise<string>
}

const roots: string[] = []
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-attachment-routing-'))
  roots.push(value)
  return value
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function captureTools(catalog: AttachmentCatalog, sessionId: string, state: AttachmentTurnState): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>()
  const context = {
    systemPrompt: { section() {} },
    tools: {
      register(tool: CapturedTool) { tools.set(tool.name, tool) },
      guard() { return () => {} },
    },
  } as unknown as Context
  registerAttachmentTools(context, catalog, sessionId, state)
  return tools
}

async function call(tool: CapturedTool | undefined, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (tool === undefined) throw new Error('tool was not registered')
  return JSON.parse(await tool.execute(args, { signal: new AbortController().signal })) as Record<string, unknown>
}

describe('attachment-first routing', () => {
  it('scopes listing to the current turn and reads same-name text by exact attachment id', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    await catalog.ingest('routing-session', 'old.md', new TextEncoder().encode('historical marker'))
    await catalog.bindPending('routing-session', { messageId: 'old-message', turn: 1, step: 1 })
    const first = await catalog.ingest('routing-session', 'same.md', new TextEncoder().encode('FIRST CURRENT MARKER'))
    const second = await catalog.ingest('routing-session', 'same.md', new TextEncoder().encode('SECOND CURRENT MARKER'))
    const current = await catalog.bindPending('routing-session', { messageId: 'current-message', turn: 2, step: 1 })
    const binding = current[0]?.binding
    if (binding === undefined) throw new Error('missing durable binding')
    const state = new AttachmentTurnState()
    state.activate(binding, current)
    const tools = captureTools(catalog, 'routing-session', state)

    const listed = await call(tools.get('list_attachments'), {})
    expect(listed).toMatchObject({ scope: 'current_turn' })
    expect((listed.attachments as { attachment_id: string }[]).map(item => item.attachment_id)).toEqual([first.attachmentId, second.attachmentId])

    const firstRead = await call(tools.get('read_attachment'), { attachment_id: first.attachmentId })
    const secondRead = await call(tools.get('read_attachment'), { attachment_id: second.attachmentId })
    expect(firstRead.text).toBe('FIRST CURRENT MARKER')
    expect(secondRead.text).toBe('SECOND CURRENT MARKER')
    expect(firstRead).toMatchObject({ queryKind: 'text-range', locator: { kind: 'text', lineStart: 1 } })
  })

  it('blocks attachment discovery scans while allowing ordinary project commands', () => {
    const records = [{ attachmentId: 'attachment:one', name: '音频生成式能力演进时间轴.md' }]
    expect(attachmentDiscoveryDenial('bash', { command: 'find /Users/wu -name "音频生成式能力演进时间轴.md"' }, records))
      .toContain('plugin-managed snapshots')
    expect(attachmentDiscoveryDenial('bash', { command: 'find /tmp -path "*/attachments/*"' }, records))
      .toContain('read_attachment')
    expect(attachmentDiscoveryDenial('read_file', { path: '/project/音频生成式能力演进时间轴.md' }, records))
      .toContain('not workspace paths')
    expect(attachmentDiscoveryDenial('bash', { command: 'rg -n TODO src tests' }, records)).toBeUndefined()
    expect(attachmentDiscoveryDenial('read_attachment', { attachment_id: 'attachment:one' }, records)).toBeUndefined()
  })

  it('turns the two observed wrong-tool patterns into successful attachment reads', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const record = await catalog.ingest('compat-session', 'timeline.md', new TextEncoder().encode('# Timeline\n\nuseful content'))
    const current = await catalog.bindPending('compat-session', { messageId: 'message', turn: 1, step: 1 })
    const binding = current[0]?.binding
    if (binding === undefined) throw new Error('missing durable binding')
    const state = new AttachmentTurnState()
    state.activate(binding, current)
    const tools = captureTools(catalog, 'compat-session', state)

    const invalidBlock = await call(tools.get('read_attachment_blocks'), {
      attachment_id: record.attachmentId,
      block_ids: ['block_0'],
    })
    expect(invalidBlock).toMatchObject({ queryKind: 'text-range' })
    expect(invalidBlock.routing_correction).toContain('line ranges')
    expect(invalidBlock.text).toContain('useful content')

    const wrongFolder = await call(tools.get('query_folder_document'), {
      attachment_id: record.attachmentId,
      path: 'timeline.md',
      operation: 'outline',
    })
    expect(wrongFolder).toMatchObject({ queryKind: 'text-range' })
    expect(wrongFolder.routing_correction).toContain('not a folder')
    expect(wrongFolder.text).toContain('useful content')
  })
})
