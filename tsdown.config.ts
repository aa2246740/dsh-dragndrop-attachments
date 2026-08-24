import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function resolveHarness(): string {
  const configured = process.env.DSHX_HARNESS?.trim()
  const configPath = join(homedir(), '.config/dshx/harness')
  const recorded = existsSync(configPath) ? readFileSync(configPath, 'utf8').trim() : undefined
  const roots = [...new Set([configured, recorded]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .map(value => resolve(value)))]
  if (roots.length !== 1 || roots[0] === undefined) throw new Error('dshx client build requires exactly one Harness root')
  return roots[0]
}

const adapter = join(resolveHarness(), 'tools/dshx/src/client-build.js')
if (!existsSync(adapter)) throw new Error(`dshx client build adapter not found: ${adapter}`)
const { externalClientBundle } = await import(pathToFileURL(adapter).href)

export default externalClientBundle('dsh-dragndrop-attachments', ['lib/types/dsh-dragndrop-attachments.js'], {
  clientEntry: 'src/client/index.tsx',
})
