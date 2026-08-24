import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'

interface SpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

function subprocess() {
  return {
    async resolveExecutable(command: string): Promise<string> {
      await access(command, constants.X_OK)
      return command
    },
    spawn(spec: SpawnSpec) {
      const executable = spec.argv[0]
      if (executable === undefined) throw new Error('missing executable')
      const child = spawn(executable, [...spec.argv.slice(1)], {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        signal: spec.signal,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
      child.stdout.on('data', value => { stdout += String(value) })
      child.stderr.on('data', value => { stderr += String(value) })
      const done = new Promise<{ readonly exitCode: number }>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => { resolve({ exitCode: code ?? 1 }) })
      })
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
        },
      }
    },
  }
}

export function testContext(): Context {
  const runtime = subprocess()
  return { get: (name: string) => name === 'subprocess' ? runtime : undefined } as unknown as Context
}
