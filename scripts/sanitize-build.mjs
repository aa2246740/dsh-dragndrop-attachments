import { readFile, readdir, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const root = resolve(process.cwd())
const lib = join(root, 'lib')
function isText(name) { return ['.js', '.map'].includes(extname(name)) || name.endsWith('.d.ts') }

async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile() && isText(entry.name)) result.push(path)
  }
  return result
}

for (const path of await files(lib)) {
  const source = await readFile(path, 'utf8')
  const sanitized = source.replaceAll(root, '.')
  if (sanitized !== source) await writeFile(path, sanitized)
  if (/\/Users\/|\/home\/[^/]+\/|[A-Za-z]:\\\\Users\\\\/u.test(sanitized)) {
    throw new Error(`machine-absolute path remains in ${relative(root, path)}`)
  }
}

console.log('BUILD_PATH_SANITIZE_OK')
