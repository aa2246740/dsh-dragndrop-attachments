import { chmod, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('src/engine.js')
const target = resolve('lib/types/engine.js')
await copyFile(source, target)
await chmod(target, 0o644)
