import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentCatalog } from '../src/catalog.js'
import { AttachmentTurnState, registerAttachmentTurnContext } from '../src/turn-context.js'
import { testContext } from './runtime.js'

type PreStepPayload = {
  readonly messages: UserMessage[]
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}
type PreStepDecision = { readonly kind: 'reject' } | { readonly kind: 'enter'; readonly messages: UserMessage[] }
type PreStepListener = (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

const roots: string[] = []
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-attachment-context-'))
  roots.push(value)
  return value
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function captureListener(catalog: AttachmentCatalog, sessionId: string, state = new AttachmentTurnState()): PreStepListener {
  let listener: PreStepListener | undefined
  const context = {
    on(name: string, value: PreStepListener) {
      if (name !== 'agent/pre-step') throw new Error(`unexpected event ${name}`)
      listener = value
      return () => {}
    },
  } as unknown as Context
  registerAttachmentTurnContext(context, catalog, sessionId, state)
  if (listener === undefined) throw new Error('pre-step listener was not registered')
  return listener
}

describe('current-turn attachment projection', () => {
  it('binds cards to a generic request before an unrelated workspace can become the inferred subject', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const audio = await catalog.ingest(
      'session-context',
      '音频生成式能力演进时间轴.md',
      new TextEncoder().encode('# 时间轴\n正文不应直接进入清单。'),
    )
    const video = await catalog.ingest(
      'session-context',
      '视频生成式能力演进时间轴-主流精简版.md',
      new TextEncoder().encode('# 视频时间轴\n第二份正文也不应直接进入清单。'),
    )
    await expect(catalog.resolve('session-context', audio.attachmentId)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })

    const user = createUserMessage({ content: [{ type: 'text', text: '看看有啥值得优化的地方' }], source: { kind: 'user' } })
    const runtime = createUserMessage({
      content: [{ type: 'text', text: 'Current workspace: /tmp/unrelated-project/migration-staging/dsh-image-container' }],
      source: { kind: 'plugin', plugin: 'runtime' },
    })
    const listener = captureListener(catalog, 'session-context')
    const result = await listener(
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [user, runtime] }),
    )

    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') throw new Error('expected enter')
    expect(result.messages[0]).toBe(user)
    expect(result.messages[2]).toBe(runtime)
    const context = result.messages[1]!
    expect(context.source).toMatchObject({
      kind: 'plugin',
      plugin: 'dsh-dragndrop-attachments',
      form: 'notice',
      summary: '📎 2 个附件：音频生成式能力演进时间轴.md、视频生成式能力演进时间轴-主流精简版.md',
      boundToMessageId: String(user.id),
    })
    const modelContext = context.content[0]?.type === 'text' ? context.content[0].text : ''
    expect(modelContext).toContain('Treat these attachments as the primary subject')
    expect(modelContext).toContain('original absolute paths are intentionally unavailable')
    expect(modelContext).toContain('Never call bash, find, grep, glob, read_file')
    expect(modelContext).toContain('Call list_attachments first')
    expect(modelContext).toContain('"preferred_tool": "read_attachment"')
    expect(modelContext).toContain('"workspace_path": null')
    expect(modelContext).toContain('音频生成式能力演进时间轴.md')
    expect(modelContext).toContain('视频生成式能力演进时间轴-主流精简版.md')
    expect(modelContext).not.toContain('正文不应直接进入清单')
    expect(modelContext).not.toContain('第二份正文也不应直接进入清单')
    expect(user.content).toEqual([{ type: 'text', text: '看看有啥值得优化的地方' }])

    expect(await catalog.available('session-context')).toEqual([
      expect.objectContaining({
        attachmentId: audio.attachmentId,
        pending: false,
        committed: true,
        binding: expect.objectContaining({ messageId: String(user.id), turn: 1, step: 1 }),
      }),
      expect.objectContaining({
        attachmentId: video.attachmentId,
        pending: false,
        committed: true,
        binding: expect.objectContaining({ messageId: String(user.id), turn: 1, step: 1 }),
      }),
    ])
  })

  it('does not consume cards when another pre-step listener rejects the user message', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    const record = await catalog.ingest('session-reject', 'keep.md', new TextEncoder().encode('keep'))
    const user = createUserMessage({ content: [{ type: 'text', text: 'send' }], source: { kind: 'user' } })
    const result = await captureListener(catalog, 'session-reject')(
      { messages: [user], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'reject' }),
    )
    expect(result).toEqual({ kind: 'reject' })
    expect(await catalog.list('session-reject')).toEqual([expect.objectContaining({
      attachmentId: record.attachmentId, committed: false, pending: true,
    })])
  })

  it('does not project historical attachments into a later tool-only step', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    await catalog.ingest('session-history', 'history.md', new TextEncoder().encode('history'))
    const listener = captureListener(catalog, 'session-history')
    const plugin = createUserMessage({ content: [{ type: 'text', text: 'tool continuation' }], source: { kind: 'plugin', plugin: 'tool' } })
    const result = await listener(
      { messages: [plugin], turn: 1, step: 2, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [plugin] }),
    )
    expect(result).toEqual({ kind: 'enter', messages: [plugin] })
    expect(await catalog.available('session-history')).toEqual([])
  })

  it('clears current-turn routing when a later accepted user message has no attachment cards', async () => {
    const catalog = await AttachmentCatalog.open(testContext(), { root: await root() })
    await catalog.ingest('session-clear', 'first.md', new TextEncoder().encode('first'))
    const state = new AttachmentTurnState()
    const listener = captureListener(catalog, 'session-clear', state)
    const first = createUserMessage({ content: [{ type: 'text', text: 'first turn' }], source: { kind: 'user' } })
    await listener(
      { messages: [first], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [first] }),
    )
    expect(state.current()?.records).toHaveLength(1)

    const second = createUserMessage({ content: [{ type: 'text', text: 'second turn' }], source: { kind: 'user' } })
    await listener(
      { messages: [second], turn: 2, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [second] }),
    )
    expect(state.current()).toBeUndefined()
  })
})
