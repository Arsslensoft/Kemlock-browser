// Builds the extension into dist/chrome and dist/firefox (design decision 3):
// the pages and the background as ES modules, the content script as one
// classic script (content scripts can't be modules), the manifest merged
// from manifests/base.json and the browser's own (its version is
// $KEMLOCK_VERSION when that is set: a release's), and _locales from
// locales/. The Dart core (core/) is compiled to WebAssembly once, with
// `dart compile wasm`, and copied to each browser's core/ folder beside the
// data it reads. `node tool/build.mjs chrome` builds one browser.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
 * The version a build carries: `KEMLOCK_VERSION` when it is set, which is how a
 * release takes the version of its tag (tool/build.sh), and otherwise the
 * one in manifests/base.json.
 */
export function releaseVersion(env, manifest) {
  const wanted = env.KEMLOCK_VERSION
  if (wanted === undefined || wanted === '') return manifest.version
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(wanted))
    throw new Error(`KEMLOCK_VERSION is not a version like 1.2.3: ${wanted}`)
  return wanted
}

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

/**
 * The extension's own strings of a language: locales/<lang>.json and each part of it in
 * locales/parts/<part>.<lang>.json (one file per area of the extension), a name in only one of them.
 */
export async function ownStrings(lang) {
  const own = await readJson(join('locales', `${lang}.json`))
  const partsDir = join(root, 'locales', 'parts')
  const parts = existsSync(partsDir)
    ? (await readdir(partsDir)).filter((file) => file.endsWith(`.${lang}.json`)).sort()
    : []
  for (const part of parts) {
    for (const [name, text] of Object.entries(await readJson(join('locales', 'parts', part)))) {
      if (name in own)
        throw new Error(`The message ${name} is in locales/parts/${part} and elsewhere`)
      own[name] = text
    }
  }
  return own
}

/** The extension's strings and locales/app/<lang>.json as the browser's _locales. */
async function writeLocales(outDir) {
  for (const lang of languages) {
    const messages = localeMessages(
      await ownStrings(lang),
      await readJson(join('locales', 'app', `${lang}.json`)),
    )
    const dir = join(outDir, '_locales', lang)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'messages.json'), `${JSON.stringify(messages, null, 2)}\n`)
  }
}

/** The Dart SDK the core is built with (the Containerfile's, and the pubspec's `sdk`). */
export const dartVersion = '3.13.5'

/** The arguments of `dart compile wasm` for the core's entry, writing core.wasm and its loader core.mjs as [out]. */
export function dartCompileArgs(out) {
  return ['compile', 'wasm', '-O2', '-o', out, 'lib/main.dart']
}

function dart(args, cwd) {
  // On Windows dart is dart.bat, which only a shell starts
  const run = spawnSync('dart', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (run.error?.code === 'ENOENT')
    throw new Error(
      `The Dart SDK ${dartVersion} is needed to build the core (core/), and dart is not on the PATH. Install it from dart.dev, or build in the container with tool/build.sh.`,
    )
  if (run.status !== 0)
    throw new Error(`dart ${args.slice(0, 2).join(' ')} failed (exit ${run.status})`)
}

/** Compiles the core once into dist/.core: core.wasm and its loader core.mjs. */
async function compileCore() {
  const coreDir = join(root, 'core')
  const out = join(root, 'dist', '.core')
  dart(['--version'], root)
  if (!existsSync(join(coreDir, '.dart_tool', 'package_config.json'))) dart(['pub', 'get'], coreDir)
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  dart(dartCompileArgs(join(out, 'core.wasm')), coreDir)
  console.log('dist/.core')
  return out
}

/**
 * The background imports the Dart loader as 'kemlock-core-wasm' (a service worker may not `import()`), and the bundle keeps
 * that import as it is, at the file the build copies into core/.
 */
const coreLoader = {
  name: 'kemlock-core-loader',
  resolveId: (source) =>
    source === 'kemlock-core-wasm' ? { id: '/core/core.mjs', external: true } : null,
}

const shared = (browser) => ({
  root,
  configFile: false,
  logLevel: 'warn',
  define: { __BROWSER__: JSON.stringify(browser) },
  plugins: [coreLoader],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
})

async function buildBrowser(browser, coreOut) {
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
  manifest.version = releaseVersion(process.env, manifest)
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeLocales(outDir)
  // The core: its module and loader, and the files it reads (the Public Suffix List, the word list, the 2FA directory)
  // The source map stays out: 1.8 MB the browser never reads, and a zip with it is no use to anyone
  await cp(coreOut, join(outDir, 'core'), {
    recursive: true,
    filter: (from) => !from.endsWith('.map'),
  })
  await cp(join(root, 'core', 'data'), join(outDir, 'core', 'data'), { recursive: true })
  // Rendered by tool/icons/render.sh
  await cp(join(root, 'icons'), join(outDir, 'icons'), { recursive: true })
  // Geist's licence goes with the fonts src/shared/fonts.css bundles
  await mkdir(join(outDir, 'licenses'), { recursive: true })
  await copyFile(join(root, 'fonts', 'OFL.txt'), join(outDir, 'licenses', 'Geist-OFL.txt'))
  console.log(`dist/${browser}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coreOut = await compileCore()
  for (const browser of browsers) await buildBrowser(browser, coreOut)
}
