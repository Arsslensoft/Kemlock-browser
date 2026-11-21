// Builds the extension into dist/chrome and dist/firefox (design decision 3):
// the pages and the background as ES modules, the content script as one
// classic script (content scripts can't be modules), the manifest merged
// from manifests/base.json and the browser's own, and _locales from
// locales/. `node tool/build.mjs chrome` builds one browser.
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { languages, toBrowserMessage } from './locales.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'firefox']

const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))

/** The browser's manifest over the base: objects merge, lists join. */
export function mergeManifest(base, extra) {
  const out = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    const old = out[key]
    if (Array.isArray(old) && Array.isArray(value)) out[key] = [...new Set([...old, ...value])]
    else if (isObject(old) && isObject(value)) out[key] = mergeManifest(old, value)
    else out[key] = value
  }
  return out
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The extension's own strings and the app's (tool/locales.mjs), by name,
 * as the browser's messages. A name may be in only one of them.
 */
export function localeMessages(own, app) {
  const messages = {}
  for (const [name, text] of [...Object.entries(own), ...Object.entries(app)]) {
    if (Object.keys(messages).some((taken) => taken.toLowerCase() === name.toLowerCase()))
      throw new Error(`The message ${name} is defined twice`)
    messages[name] = toBrowserMessage(text)
  }
  return messages
}

/** locales/<lang>.json and locales/app/<lang>.json as the browser's _locales. */
async function writeLocales(outDir) {
  for (const lang of languages) {
    const messages = localeMessages(
      await readJson(join('locales', `${lang}.json`)),
      await readJson(join('locales', 'app', `${lang}.json`)),
    )
    const dir = join(outDir, '_locales', lang)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'messages.json'), `${JSON.stringify(messages, null, 2)}\n`)
  }
}

const shared = (browser) => ({
  root,
  configFile: false,
  logLevel: 'warn',
  define: { __BROWSER__: JSON.stringify(browser) },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
})

async function buildBrowser(browser) {
  const outDir = join(root, 'dist', browser)
  await rm(outDir, { recursive: true, force: true })
  const pages = {
    popup: 'src/popup/index.html',
    setup: 'src/setup/index.html',
    menu: 'src/menu/index.html',
    ...(browser === 'chrome' ? { offscreen: 'src/offscreen/index.html' } : {}),
  }
  await build({
    ...shared(browser),
    build: {
      outDir,
      emptyOutDir: false,
      target: browser === 'chrome' ? 'chrome119' : 'firefox131',
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: { background: 'src/background/index.ts', ...pages },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        },
      },
    },
  })
  await build({
    ...shared(browser),
    build: {
      outDir,
      emptyOutDir: false,
      target: browser === 'chrome' ? 'chrome119' : 'firefox131',
      lib: {
        entry: 'src/content/index.ts',
        formats: ['iife'],
        name: 'kemlockContent',
        fileName: () => 'content.js',
      },
    },
  })
  const manifest = mergeManifest(
    await readJson('manifests/base.json'),
    await readJson(`manifests/${browser}.json`),
  )
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeLocales(outDir)
  // Rendered by tool/icons/render.sh
  await cp(join(root, 'icons'), join(outDir, 'icons'), { recursive: true })
  // Geist's licence goes with the fonts src/shared/fonts.css bundles
  await mkdir(join(outDir, 'licenses'), { recursive: true })
  await copyFile(
    join(root, '..', 'mobile', 'assets', 'fonts', 'OFL.txt'),
    join(outDir, 'licenses', 'Geist-OFL.txt'),
  )
  console.log(`dist/${browser}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const browser of browsers) await buildBrowser(browser)
}
