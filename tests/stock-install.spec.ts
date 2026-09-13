import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('stock DSH 0.1.5-rc.2 install contract', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: string }; client?: { entry?: string } }
    main?: string
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

  it('declares dsh.bundle.patch so dsh plugin add joins the profile layer stack', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(patch).toMatch(/id:\s*dsh-dragndrop-attachments/)
    expect(patch).toMatch(/name:\s*dsh-dragndrop-attachments/)
    expect(patch).not.toMatch(/name:\s*['"]?\.\//)
  })

  it('ships committed lib/ and has no install lifecycle that would need allowBuilds', () => {
    expect(manifest.main).toBe('lib/dsh-dragndrop-attachments.js')
    expect(manifest.dsh?.client?.entry).toBe('./lib/client.js')
    expect(readFileSync(join(root, 'lib/dsh-dragndrop-attachments.js'), 'utf8').length).toBeGreaterThan(0)
    expect(readFileSync(join(root, 'lib/client.js'), 'utf8').length).toBeGreaterThan(0)
    expect(manifest.scripts?.prepare).toBeUndefined()
    expect(manifest.scripts?.preinstall).toBeUndefined()
    expect(manifest.scripts?.postinstall).toBeUndefined()
  })

  it('ships Host-lib third-party imports as real dependencies, not Host peers', () => {
    const pins = {
      'fast-xml-parser': '5.3.1',
      fflate: '0.8.2',
      saxes: '6.0.0',
      sharp: '0.35.3',
    } as const
    for (const [name, version] of Object.entries(pins)) {
      expect(manifest.dependencies?.[name]).toBe(version)
      expect(manifest.peerDependencies?.[name]).toBeUndefined()
      expect(manifest.devDependencies?.[name]).toBeUndefined()
    }
    const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
    expect(lockfile).toContain(
      '    dependencies:\n      fast-xml-parser:\n        specifier: 5.3.1\n        version: 5.3.1\n      fflate:\n        specifier: 0.8.2\n        version: 0.8.2\n      saxes:\n        specifier: 6.0.0\n        version: 6.0.0\n      sharp:\n        specifier: 0.35.3\n        version: 0.35.3',
    )
    const hostLib = readFileSync(join(root, 'lib/dsh-dragndrop-attachments.js'), 'utf8')
    expect(hostLib).toMatch(/from ["']fast-xml-parser["']/)
    expect(hostLib).toMatch(/from ["']fflate["']/)
    expect(hostLib).toMatch(/from ["']saxes["']/)
    expect(hostLib).toMatch(/from ["']sharp["']/)
  })

  it('leads the README with the official one-liner, restart, and pnpm', () => {
    const firstFence = readme.match(/```sh\n([\s\S]*?)```/)
    expect(firstFence?.[1].trim()).toBe(
      'dsh plugin --profile web add github:aa2246740/dsh-dragndrop-attachments',
    )
    expect(readme).toMatch(/pnpm/)
    expect(readme).toMatch(/重启这个 Host/)
    expect(readme).toMatch(/刷新页面/)
    expect(readme).not.toMatch(/dshx|DSHX|my-plugins/)
  })
})
