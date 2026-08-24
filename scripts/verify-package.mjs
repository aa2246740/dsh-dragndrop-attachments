import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`)
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}: ${result.stderr}`)
  return result.stdout.trim()
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

const archiveArg = process.argv.slice(2).find(value => value !== '--')
if (!archiveArg) throw new Error('usage: pnpm verify:package -- /absolute/path/dsh-dragndrop-attachments-1.2.0.tgz')
const archive = resolve(archiveArg)
await stat(archive)

const entries = capture('tar', ['-tzf', archive]).split('\n').filter(Boolean)
const required = [
  'package/package.json',
  'package/pnpm-lock.yaml',
  'package/install.sh',
  'package/cordis.yml',
  'package/dshx.yml',
  'package/lib/dsh-dragndrop-attachments.js',
  'package/lib/client.js',
  'package/src/dsh-dragndrop-attachments.ts',
  'package/tests/common.spec.ts',
  'package/vendor/officecli/manifest.json',
  'package/vendor/officecli/darwin-arm64/officecli',
  'package/README.md',
  'package/USER_GUIDE.zh-CN.md',
  'package/THIRD_PARTY_NOTICES.md',
  'package/CHANGELOG.md',
  'package/SECURITY.md',
  'package/CONTRIBUTING.md',
  'package/CODE_OF_CONDUCT.md',
  'package/scripts/audit-public.mjs',
  'package/docs/folder-attachments.md',
]
for (const path of required) if (!entries.includes(path)) throw new Error(`archive missing ${path}`)
for (const path of entries) {
  if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe archive path: ${path}`)
  if (/^package\/(?:node_modules|store|tmp|\.git|\.env(?:\.|$))/u.test(path)) throw new Error(`forbidden archive entry: ${path}`)
}

const temporary = await mkdtemp(join(tmpdir(), 'dsh-dragndrop-attachments-package-'))
try {
  run('tar', ['-xzf', archive, '-C', temporary])
  const root = join(temporary, 'package')
  const installMode = (await stat(join(root, 'install.sh'))).mode
  const officeMode = (await stat(join(root, 'vendor/officecli/darwin-arm64/officecli'))).mode
  if ((installMode & 0o111) === 0) throw new Error('install.sh is not executable')
  if ((officeMode & 0o111) === 0) throw new Error('OfficeCLI is not executable')
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== 'dsh-dragndrop-attachments' || manifest.version !== '1.2.0') throw new Error('unexpected package identity')
  if (manifest.dsh?.client?.entry !== './lib/client.js') throw new Error('missing DSH client manifest entry')

  const officeManifest = JSON.parse(await readFile(join(root, 'vendor/officecli/manifest.json'), 'utf8'))
  const officePath = join(root, 'vendor/officecli', officeManifest.assets['darwin-arm64'].path)
  const officeHash = sha256(await readFile(officePath))
  if (officeHash !== officeManifest.assets['darwin-arm64'].sha256) throw new Error('OfficeCLI SHA-256 mismatch')
  const officeVersion = capture(officePath, ['--version'])
  if (!officeVersion.includes(officeManifest.version)) throw new Error(`OfficeCLI version mismatch: ${officeVersion}`)

  const configuredPath = join(homedir(), '.config/dshx/harness')
  const harness = process.env.DSHX_HARNESS?.trim() || (await readFile(configuredPath, 'utf8')).trim()
  const storeDir = process.env.PNPM_STORE_DIR?.trim() || capture('pnpm', ['store', 'path'], { cwd: process.cwd() })
  run('pnpm', ['install', '--ignore-workspace', '--offline', '--frozen-lockfile', '--store-dir', storeDir], { cwd: root })
  run('pnpm', ['audit:public'], { cwd: root })
  run('pnpm', ['test'], { cwd: root })
  run('pnpm', ['build'], { cwd: root, env: { ...process.env, DSHX_HARNESS: harness } })
  const clientBundle = await readFile(join(root, 'lib/client.js'), 'utf8')
  if (/appendMarker|removeMarker|setDraft|📎/u.test(clientBundle)) throw new Error('marker residue found in client bundle')
  if (/\/Users\/|\/home\/[^/]+\/|[A-Za-z]:\\\\Users\\\\/u.test(clientBundle)) throw new Error('machine-absolute path found in client bundle')

  const archiveHash = sha256(await readFile(archive))
  process.stdout.write(`${JSON.stringify({
    status: 'PACKAGE_VERIFY_OK',
    archive: basename(archive),
    sha256: archiveHash,
    files: entries.length,
    officeCli: officeVersion,
    officeCliSha256: officeHash,
    offlineInstall: true,
    pnpmStore: storeDir,
    tests: 'passed',
    build: 'passed',
  }, null, 2)}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
