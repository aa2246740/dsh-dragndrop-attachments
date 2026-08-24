import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`)
}

const outputArg = process.argv.slice(2).find(value => value !== '--')
if (!outputArg) throw new Error('usage: pnpm release -- /absolute/output/directory')
const outputDir = resolve(outputArg)
await mkdir(outputDir, { recursive: true })
const manifest = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'))

const temporary = await mkdtemp(join(tmpdir(), 'dsh-dragndrop-attachments-release-'))
try {
  const packed = join(temporary, 'packed')
  const extracted = join(temporary, 'extracted')
  await mkdir(packed); await mkdir(extracted)
  run('pnpm', ['pack', '--pack-destination', packed])
  const generated = (await readdir(packed)).find(name => name.endsWith('.tgz'))
  if (!generated) throw new Error('pnpm pack did not produce a tarball')
  run('tar', ['-xzf', join(packed, generated), '-C', extracted])
  await chmod(join(extracted, 'package/install.sh'), 0o755)
  await chmod(join(extracted, 'package/vendor/officecli/darwin-arm64/officecli'), 0o755)

  const target = join(outputDir, `dsh-dragndrop-attachments-${manifest.version}.tgz`)
  run('tar', ['-czf', target, '-C', extracted, 'package'])
  const hash = createHash('sha256').update(await readFile(target)).digest('hex')
  process.stdout.write(`${JSON.stringify({ status: 'RELEASE_BUILT', archive: target, sha256: hash }, null, 2)}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
