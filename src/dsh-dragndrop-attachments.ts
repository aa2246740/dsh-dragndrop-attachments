import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { AttachmentCatalog } from './catalog.js'
import { registerAttachmentRpc } from './rpc.js'
import { registerAttachmentTools } from './tools.js'
import { UploadManager } from './uploads.js'

export const name = 'dsh-dragndrop-attachments'
export const inject = ['agents', 'connection', 'subprocess']

export interface Config {
  readonly enabled?: boolean
  readonly dataDir?: string
  readonly officeCliPath?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().default(''),
  officeCliPath: z.string().default(''),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (config.enabled === false) return
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const configuredRoot = config.dataDir?.trim()
  const defaultRoot = join(dshHome, 'dragndrop-attachments', 'v1')
  const legacyRoot = join(dshHome, 'codex-attachments', 'v1')
  const dataRoot = configuredRoot
    ? resolve(configuredRoot)
    : existsSync(defaultRoot) || !existsSync(legacyRoot)
      ? defaultRoot
      : legacyRoot
  const catalog = await AttachmentCatalog.open(ctx, {
    root: resolve(dataRoot),
    ...(config.officeCliPath?.trim() ? { officeCliPath: resolve(config.officeCliPath.trim()) } : {}),
  })
  const uploads = await UploadManager.open(catalog)
  registerAttachmentRpc(ctx, catalog, uploads)

  const fibers = new Map<Agent, ReturnType<Context['inject']>>()
  const install = (agent: Agent): void => {
    if (agent.session.header.origin === 'subagent' || fibers.has(agent)) return
    fibers.set(agent, agent.ctx.inject(['tools', 'systemPrompt'], scope => {
      registerAttachmentTools(scope, catalog, agent.session.id)
    }))
  }
  const dispose = (agent: Agent): void => {
    const fiber = fibers.get(agent)
    if (fiber === undefined) return
    fibers.delete(agent)
    void fiber.dispose().catch(error => ctx.logger.warn(`dsh-dragndrop-attachments cleanup failed: ${String(error)}`))
  }

  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => { install(agent) })
  ctx.on('agent/disposed', ({ agent }) => { dispose(agent) })
  ctx.effect(() => async () => {
    const active = [...fibers.values()]
    fibers.clear()
    await Promise.all(active.map(fiber => fiber.dispose()))
    await uploads.close()
  }, 'dsh-dragndrop-attachments: runtime')

  if (dataRoot === legacyRoot) ctx.logger.info('[my-plugins/dsh-dragndrop-attachments] using legacy attachment store')
  ctx.logger.info('[my-plugins/dsh-dragndrop-attachments] loaded')
}
