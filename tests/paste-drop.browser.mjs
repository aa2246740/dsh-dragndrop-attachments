// Uses real RC2 native drop listeners plus this plugin's compiled React client.
// No Host, uploads, real sessions or model calls. Set DSH_HARNESS to a read-only RC2 checkout.
import { homedir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = process.env.DSH_HARNESS
if (!harness) throw new Error('Set DSH_HARNESS to the official 0.1.7-rc.2 source checkout (read-only).')
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const native = await build({ entryPoints: [resolve(harness, 'packages/client/ui-attachment/src/client/drop-events.ts')], bundle: true, format: 'iife', globalName: 'nativeDrop', write: false })
const { launchPinnedChromium } = await import(pathToFileURL(resolve(homedir(), '.codex/playwright-runtime/runtime.mjs')).href)
const browser = await launchPinnedChromium()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:18479/**', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Native attachment coexistence</h1><div id="app"></div></main>' }))
  await page.goto('http://localhost:18479/')
  await page.addScriptTag({ path: root + '/node_modules/react/umd/react.development.js' })
  await page.addScriptTag({ path: root + '/node_modules/react-dom/umd/react-dom.development.js' })
  await page.addScriptTag({ content: native.outputFiles[0].text })
  await page.evaluate(() => { window.__ModuleLoader__ = { load({ factory }) { window.plugin = factory(name => name === 'react' ? React : { jsx: (type, props, key) => React.createElement(type, { ...props, key }), jsxs: (type, props, key) => React.createElement(type, { ...props, key }), Fragment: React.Fragment }) } } })
  await page.addScriptTag({ path: root + '/lib/client.js' })
  const result = await page.evaluate(async () => {
    const calls = [], nativeFiles = [], fallbackFiles = [], folders = []
    let slot, Component, active = false, desktop = false
    const record = { schemaVersion: 'dsh-codex-attachment.v1', attachmentId: 'folder-fixture', name: 'docs', mediaType: 'application/zip', kind: 'folder', bytes: 100, preview: 'folder', warnings: [], pending: true, status: 'READY', fileCount: 0, directoryCount: 0 }
    const connection = { rpc: { call: async (_channel, endpoint) => {
      calls.push(endpoint)
      if (endpoint === 'folder-upload/commit' || endpoint === 'upload/commit') folders.push('docs')
      return { ok: true, value: endpoint === 'attachments/list' ? { protocolVersion: 3, attachments: [] } : endpoint.endsWith('/begin') ? { uploadId: 'fixture', chunkBytes: 1048576 } : record }
    } } }
    window.fetch = async (_input, init) => new Response(JSON.stringify({ type: 'server-response', rpcId: new Headers(init.headers).get('x-dsh-rpc-id'), result: { ok: true, value: {} } }), { status: 200 })
    const ctx = { effect() {}, inject() {}, get(name) { return name === 'connection' ? connection : { createDrafts(_session, files) { fallbackFiles.push(...files.map(f => f.name)); return files.map((f, i) => ({ id: 'draft-' + i })) }, releaseDraftAttachments() {} } }, slots: { inject(_name, fn) { fn() }, register(options, component) { slot = options; Component = component } } }
    plugin.apply(ctx)
    const props = slot.inject('fixture-session')
    const mounted = ReactDOM.createRoot(document.getElementById('app'))
    let key = 0
    const render = () => ReactDOM.flushSync(() => mounted.render(React.createElement(Component, { ...props, key: ++key, useInput: fn => fn({ phase: 'idle' }), useConversation: fn => fn({ views: new Map() }), inputActions: { addAttachments() { return true } } })))
    const cleanNative = nativeDrop.installDocumentDropEvents(true, (files) => nativeFiles.push(...files.map(f => f.name)), { current: 0 }, value => { active = value })
    const paste = event => nativeFiles.push(...Array.from(event.clipboardData.files).map(f => f.name))
    document.addEventListener('paste', paste)
    render()
    const settle = () => new Promise(resolve => setTimeout(resolve, 60))
    await settle()
    const send = (names, type = 'drop') => {
      const data = new DataTransfer()
      for (const name of names) data.items.add(new File(['fixture'], name))
      document.dispatchEvent(type === 'paste' ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }) : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    }
    send(['one.docx', 'two.pdf', 'three.png', 'four.md'])
    send(['paste.png'], 'paste')
    await settle()
    const afterFiles = { native: [...nativeFiles], fallback: [...fallbackFiles], uploads: calls.filter(c => c.includes('begin')).length }
    function folderDrop() {
      const regular = new File(['mixed'], 'alongside.txt')
      const folderEntry = { isDirectory: true, name: 'docs', createReader: () => ({ readEntries: done => done([]) }) }
      const data = { types: ['Files'], files: [regular], items: [{ kind: 'file', webkitGetAsEntry: () => folderEntry, getAsFile: () => null }, { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => regular }] }
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: data })
      document.dispatchEvent(event)
    }
    active = true; folderDrop(); await settle()
    const webFolder = { native: [...nativeFiles], fallback: [...fallbackFiles], folders: [...folders], active, body: document.body.textContent, errors: document.body.textContent.includes('失败') }
    window.__DSH_HOST_PATHS__ = { pathFor: file => file.name }
    render(); await settle(); folderDrop(); await settle()
    const desktopFolder = { native: [...nativeFiles], folders: [...folders] }
    mounted.unmount(); send(['after-disable.txt']); await settle()
    document.removeEventListener('paste', paste); cleanNative()
    return { afterFiles, webFolder, desktopFolder, afterDisable: nativeFiles.at(-1), calls }
  })
  console.log(JSON.stringify(result, null, 2))
  assert.deepEqual(errors, [])
  assert.deepEqual(result.afterFiles.native, ['one.docx', 'two.pdf', 'three.png', 'four.md', 'paste.png'])
  assert.equal(result.afterFiles.uploads, 0)
  assert.deepEqual(result.afterFiles.fallback, [])
  assert.deepEqual(result.webFolder.fallback, ['alongside.txt'])
  assert.equal(result.webFolder.folders.length, 1)
  assert.equal(result.webFolder.active, false)
  assert.equal(result.webFolder.errors, false)
  assert.equal(result.desktopFolder.native.at(-1), 'alongside.txt')
  assert.equal(result.desktopFolder.folders.length, 1)
  assert.equal(result.afterDisable, 'after-disable.txt')
  console.log(JSON.stringify({ status: 'NATIVE_DROP_COEXISTENCE_OK', ...result }, null, 2))
} finally { await browser.close() }
