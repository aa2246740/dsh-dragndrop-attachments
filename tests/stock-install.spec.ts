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
