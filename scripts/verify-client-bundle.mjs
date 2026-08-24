import { readFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

const bundlePath = resolve('lib/client.js')
const source = await readFile(bundlePath, 'utf8')
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
const requested = [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1])
const leaked = [...new Set(requested.filter(specifier => builtins.has(specifier)))].sort()

if (leaked.length > 0) {
  throw new Error(`browser bundle leaked Node built-ins: ${leaked.join(', ')}`)
}

console.log(`CLIENT_BUNDLE_PURITY_OK ${bundlePath}`)
