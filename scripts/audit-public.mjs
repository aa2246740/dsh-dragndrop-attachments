import { readFile, readdir } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'

const root = resolve(process.cwd())
const ignoredDirectories = new Set(['.git', '.pnpm-store', 'node_modules', 'coverage'])
const textNames = new Set(['.gitignore', 'LICENSE'])
const textExtensions = new Set([
  '.css', '.d.ts', '.js', '.json', '.jsx', '.lock', '.map', '.md', '.mjs', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml',
])
const forbidden = [
  { name: 'macOS user path', pattern: /\/Users\/[A-Za-z0-9._-]+\//u },
  { name: 'Linux user path', pattern: /\/home\/[A-Za-z0-9._-]+\//u },
  { name: 'Windows user path', pattern: /[A-Za-z]:\\Users\\[^\\]+\\/u },
  { name: 'real DSH session id', pattern: /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu },
  { name: 'GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/u },
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
]

function isText(path) {
  const name = basename(path)
  return textNames.has(name) || textExtensions.has(extname(name)) || name.endsWith('.d.ts')
}

async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) result.push(...await files(path))
    } else if (entry.isFile() && isText(path)) {
      result.push(path)
    }
  }
  return result
}

const failures = []
for (const path of await files(root)) {
  const source = await readFile(path, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) failures.push(`${relative(root, path)}: ${rule.name}`)
  }
}

if (failures.length > 0) throw new Error(`public audit failed:\n${failures.join('\n')}`)
console.log('PUBLIC_AUDIT_OK')
