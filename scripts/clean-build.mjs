import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (manifest.name !== 'dsh-dragndrop-attachments') throw new Error('refusing to clean an unexpected package')
const target = join(root, 'lib')
await rm(target, { recursive: true, force: true })
