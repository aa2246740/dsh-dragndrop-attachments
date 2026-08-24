/**
 * Linux stand-in for Harness `tools/dshx/src/client-build.js`.
 *
 * Official `externalClientBundle` is not in the public RC8 tree. This emits the
 * same host + `__ModuleLoader__` client artifacts `pnpm build` already expects
 * so the plugin can load in `dsh web` on Linux.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve as resolvePath } from 'node:path'

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const PLATFORM_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

function styleInjectionModule(pluginId, fileId, css, classMap) {
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${pluginId}/${basename(fileId)}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

function hashClass(fileId, local) {
  let hash = 2166136261
  const seed = `${fileId}:${local}`
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${local}_${(hash >>> 0).toString(36)}`
}

function rewriteCssModules(css, fileId) {
  const classMap = {}
  const rewritten = css.replace(/\.(-?[_A-Za-z][\w-]*)/g, (match, local, offset, source) => {
    const before = source.slice(Math.max(0, offset - 1), offset)
    if (before === ':' || before === '/') return match
    if (classMap[local] === undefined) classMap[local] = hashClass(fileId, local)
    return `.${classMap[local]}`
  })
  return { css: rewritten, classMap }
}

function sourceAssetPath(source, importer) {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const typesMarker = `${dirname(importer).includes(`${'/'}lib${'/'}types`) ? '' : ''}`
  void typesMarker
  const boundary = emitted.indexOf('/lib/types/')
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + '/lib/types/'.length))
}

function cssModulesPlugin(pluginId) {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId, 'utf8')
      const { css, classMap } = rewriteCssModules(source, fileId)
      return styleInjectionModule(pluginId, fileId, css, classMap)
    },
  }
}

function clientExternals(declaration) {
  const extra = Array.isArray(declaration?.external) ? declaration.external : []
  return new Set([...PLATFORM_EXTERNALS, ...extra])
}

function isBare(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('\0') && !isAbsolute(specifier)
}

/**
 * @param {string} id
 * @param {readonly string[]} libEntry
 * @param {{ readonly clientEntry?: string }} [options]
 */
export function externalClientBundle(id, libEntry, options = {}) {
  const clientEntry = options.clientEntry ?? 'src/client/index.tsx'
  const hostName = basename(libEntry[0] ?? 'index.js', '.js')
  return ({}) => {
    const host = {
      name: id,
      entry: { [hostName]: libEntry[0] },
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
      deps: {
        neverBundle: specifier => isBare(specifier),
        alwaysBundle: specifier => !isBare(specifier),
      },
    }
    const client = {
      name: `${id}/client`,
      entry: { client: clientEntry },
      outDir: 'lib',
      format: 'cjs',
      platform: 'browser',
      dts: false,
      sourcemap: true,
      clean: false,
      deps: {
        neverBundle: specifier => clientExternals({}).has(specifier),
        alwaysBundle: specifier => !clientExternals({}).has(specifier),
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
        'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
        'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      },
      plugins: [cssModulesPlugin(id)],
      outputOptions: {
        entryFileNames: 'client.js',
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
        footer: 'return module.exports; } });',
        intro: 'var module = { exports: {} }; var exports = module.exports;',
      },
    }
    return [host, client]
  }
}
