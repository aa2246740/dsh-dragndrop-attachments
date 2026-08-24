#!/usr/bin/env node
/**
 * Record a real Chromium session against local DSH Web with this plugin loaded.
 * Output: docs/demo/out/plugin-demo.mp4 and plugin-demo.gif
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const demo = resolve(here, '..')
const fixtures = join(demo, 'fixtures')
const outDir = join(demo, 'out')
const rawDir = join(demo, 'raw')
const url = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const workspace = process.env.DSH_DEMO_WORKSPACE ?? '/tmp/dsh-demo-workspace'

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

function mimeFor(name) {
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.md')) return 'text/markdown'
  if (name.endsWith('.zip')) return 'application/zip'
  if (name.endsWith('.csv')) return 'text/csv'
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

async function dropFiles(page, paths) {
  const files = paths.map(path => ({
    name: path.split('/').pop(),
    type: mimeFor(path),
    b64: readFileSync(path).toString('base64'),
  }))
  await page.evaluate(async payload => {
    const transfer = new DataTransfer()
    for (const item of payload) {
      const bytes = Uint8Array.from(atob(item.b64), char => char.charCodeAt(0))
      transfer.items.add(new File([bytes], item.name, { type: item.type }))
    }
    const fire = type => document.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: transfer,
    }))
    fire('dragenter')
    fire('dragover')
    await new Promise(resolveWait => setTimeout(resolveWait, 700))
    fire('drop')
  }, files)
}

async function waitVisible(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { state: 'visible', timeout })
}

async function dismissNoise(page) {
  const labels = ['Accept', 'Got it', 'Continue', 'I understand', 'Skip', '关闭', '知道了']
  for (const label of labels) {
    const button = page.getByRole('button', { name: label })
    if (await button.count() && await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {})
    }
  }
}

async function chooseWorkspace(page) {
  const already = page.getByRole('textbox').or(page.locator('[contenteditable="true"]'))
  if (await already.count() && await already.first().isVisible().catch(() => false)) return
  const candidates = [
    page.getByRole('button', { name: /Choose workspace|选择工作区|Add workspace|添加工作区/i }),
    page.getByText(/Choose workspace|选择工作区/i),
  ]
  for (const locator of candidates) {
    if (await locator.count() && await locator.first().isVisible().catch(() => false)) {
      await locator.first().click()
      break
    }
  }
  const dialogInput = page.locator('input[type="text"], input:not([type])').last()
  if (await dialogInput.count()) {
    await dialogInput.fill(workspace)
    const confirm = page.getByRole('button', { name: /Add|Choose|Select|Open|确认|添加|选择/i }).last()
    if (await confirm.count()) await confirm.click().catch(() => {})
    else await page.keyboard.press('Enter')
  }
}

async function waitForPlugin(page) {
  await page.waitForFunction(() => {
    return document.querySelector('[data-dsh-dragndrop-attachments="ready"]') !== null
  }, null, { timeout: 45000 })
}

async function openFolderPicker(page, folder) {
  const plus = page.getByRole('button', { name: /^\+$|^＋$|Add|添加/ }).first()
    .or(page.locator('button').filter({ hasText: '+' }).first())
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null)
  if (await plus.count()) await plus.click().catch(() => {})
  const menu = page.getByText('文件和文件夹')
  if (await menu.count()) await menu.first().click().catch(() => {})
  const folderOption = page.getByText('选择文件夹')
  if (await folderOption.count()) await folderOption.first().click().catch(() => {})
  const chooser = await fileChooserPromise
  if (chooser) {
    await chooser.setFiles(folder)
    return
  }
  const folderInput = page.locator('input[webkitdirectory], input[directory]')
  if (await folderInput.count()) await folderInput.first().setInputFiles(folder)
}

async function main() {
  if (!existsSync(join(fixtures, 'paste-note.md'))) {
    throw new Error('fixtures missing; run docs/demo/prepare-fixtures.sh')
  }
  mkdirSync(outDir, { recursive: true })
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const work = join(outDir, 'record-work')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  const browser = await chromium.launch({
    headless: process.env.DSH_DEMO_HEADED !== '1',
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    recordVideo: { dir: work, size: { width: 1280, height: 720 } },
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await dismissNoise(page)
  await chooseWorkspace(page)
  await page.waitForTimeout(800)
  await waitForPlugin(page)

  const image = join(fixtures, 'oversized-image-4096x3072.png')
  const note = join(fixtures, 'paste-note.md')
  const zip = join(fixtures, 'project-archive.zip')
  const csv = join(fixtures, 'utf8.csv')
  const folder = join(fixtures, 'sample-folder')
  const office = join(fixtures, 'operations-policy.docx')

  await page.mouse.move(640, 360)
  await page.waitForTimeout(400)

  await dropFiles(page, [image])
  await page.waitForTimeout(1800)

  await dropFiles(page, [note])
  await waitVisible(page, '[data-dsh-dragndrop-attachment-dock="ready"]', 20000)
  await page.waitForTimeout(900)

  await dropFiles(page, [csv])
  await page.waitForTimeout(900)

  await dropFiles(page, [zip])
  await page.waitForTimeout(1200)

  await openFolderPicker(page, folder)
  await page.waitForTimeout(1600)

  await dropFiles(page, [office])
  await page.waitForTimeout(1600)

  const dock = page.locator('[data-dsh-dragndrop-attachment-dock="ready"]')
  if (await dock.count()) {
    const preview = dock.getByRole('button', { name: '预览' }).first()
    if (await preview.count()) await preview.click().catch(() => {})
  }
  await page.waitForTimeout(1400)

  const video = page.video()
  await context.close()
  await browser.close()
  if (!video) throw new Error('Playwright did not produce a video')
  const webm = await video.path()
  const rawWebm = join(rawDir, '01-dsh-web-live.webm')
  writeFileSync(rawWebm, readFileSync(webm))

  const mp4 = join(outDir, 'plugin-demo.mp4')
  const gif = join(outDir, 'plugin-demo.gif')
  await run('ffmpeg', [
    '-y', '-i', rawWebm,
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-crf', '20', '-an', '-movflags', '+faststart', mp4,
  ])
  await run('ffmpeg', [
    '-y', '-i', mp4,
    '-vf', 'fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=80:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0', gif,
  ])
  rmSync(work, { recursive: true, force: true })
  writeFileSync(join(outDir, 'CAPTURE.md'), [
    '# Real DSH Web capture',
    '',
    `Recorded ${url} with Playwright Chromium.`,
    `plugin-demo.mp4 ${statSync(mp4).size} bytes`,
    `plugin-demo.gif ${statSync(gif).size} bytes`,
    '',
  ].join('\n'))
  console.log(`RECORD_OK ${mp4}`)
  console.log(`RECORD_OK ${gif}`)
}

await main()
