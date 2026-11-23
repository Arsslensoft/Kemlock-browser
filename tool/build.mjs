// Builds the extension into dist/chrome and dist/firefox (design decision 3):
// the pages and the background as ES modules, the content script as one
// classic script (content scripts can't be modules), the manifest merged
// from manifests/base.json and the browser's own (its version is
// $KEMLOCK_VERSION when that is set: a release's), and _locales from
// locales/. The Dart core (core/) is compiled to WebAssembly once, with
// `dart compile wasm`, and copied to each browser's core/ folder beside the
// data it reads. `node tool/build.mjs chrome` builds one browser.
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

/** Whether the build runs on `FakeCore` (src/background/core/fake.ts) in place of the Dart core: `KEMLOCK_FAKE_CORE=1`. */
export const fakeCore = process.env.KEMLOCK_FAKE_CORE === '1'

/**
 * The Dart packages the core ships, from `dart pub get`'s package_graph.json: the core's own dependencies and, by theirs,
 * everything they need, never the development dependencies (the tests and the lints build nothing that is shipped). As
 * { name, version }, in name order, without the core itself.
 */
export function shippedPackages(graph) {
  const byName = new Map(graph.packages.map((pkg) => [pkg.name, pkg]))
  const seen = new Set()
  const walk = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    const pkg = byName.get(name)
    if (!pkg) throw new Error(`package_graph.json lists the dependency ${name} but not the package`)
    for (const dependency of pkg.dependencies ?? []) walk(dependency)
  }
  for (const rootName of graph.roots) {
    for (const dependency of byName.get(rootName)?.dependencies ?? []) walk(dependency)
  }
  return [...seen].sort().map((name) => ({ name, version: byName.get(name).version }))
}

/** The files at the top of a package's folder that are licence files, or the notice beside them. */
const licenceFileName = /^(licen[cs]e|copying|notice)/i
/** The folders at the top of a package's folder whose files are all licence files. */
const licenceFolderName = /^licen[cs]es$/i

const byEntryName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/**
 * The licence files of a package's folder, as { file, notice }: file the path inside the folder (forward slashes), in name
 * order. The files at its top whose names start with LICENSE, LICENCE, COPYING or NOTICE, and every file under a top-level
 * licenses/ or licences/ folder. A notice is not a licence: a package needs a file that is not one.
 */
export async function licenceFilesIn(dir) {
  const files = []
  const walk = async (folder, prefix) => {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort(byEntryName)) {
      if (entry.isDirectory()) await walk(join(folder, entry.name), `${prefix}${entry.name}/`)
      else if (entry.isFile()) files.push({ file: `${prefix}${entry.name}`, notice: false })
    }
  }
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort(byEntryName)) {
    if (entry.isFile() && licenceFileName.test(entry.name))
      files.push({ file: entry.name, notice: /^notice/i.test(entry.name) })
    else if (entry.isDirectory() && licenceFolderName.test(entry.name))
      await walk(join(dir, entry.name), `${entry.name}/`)
  }
  return files
}

/**
 * Copies the licence files of every Dart package the core ships into [outDir]/licenses/dart/<package>/, as they are in the
 * package's folder (the compiled code carries what they ask to be kept with it). Throws when a shipped package has no
 * licence file, or is not downloaded. Returns the package names, in order.
 */
export async function copyDartLicences(coreDir, outDir) {
  const configFile = join(coreDir, '.dart_tool', 'package_config.json')
  const graphFile = join(coreDir, '.dart_tool', 'package_graph.json')
  if (!existsSync(configFile) || !existsSync(graphFile))
    throw new Error(`${configFile} or package_graph.json is missing: run \`dart pub get\` in core/`)
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  const base = pathToFileURL(join(coreDir, '.dart_tool') + '/')
  const packages = shippedPackages(JSON.parse(await readFile(graphFile, 'utf8')))
  for (const { name, version } of packages) {
    const entry = config.packages.find((pkg) => pkg.name === name)
    if (!entry)
      throw new Error(
        `The Dart package ${name} is not in package_config.json: run \`dart pub get\` in core/`,
      )
    const rootUri = entry.rootUri.endsWith('/') ? entry.rootUri : `${entry.rootUri}/`
    const from = fileURLToPath(new URL(rootUri, base))
    if (!existsSync(from))
      throw new Error(`The Dart package ${name} ${version} is not downloaded at ${from}`)
    const files = await licenceFilesIn(from)
    if (!files.some(({ notice }) => !notice))
      throw new Error(
        `The Dart package ${name} ${version} has no licence file (LICENSE*, LICENCE*, COPYING* or licenses/) in ${from}`,
      )
    for (const { file } of files) {
      const to = join(outDir, 'licenses', 'dart', name, ...file.split('/'))
      await mkdir(dirname(to), { recursive: true })
      await copyFile(join(from, ...file.split('/')), to)
    }
  }
  return packages.map(({ name }) => name)
}

/**
 * The Dart SDK's folder, the one with bin/ and LICENSE: [env].DART_SDK when it is set (the container's, which sets it), and
 * otherwise beside one of the dart executables on the PATH [executables]: the SDK that holds it (bin/dart, as the container
 * and a plain install have it, through links), or the one Flutter keeps in bin/cache/dart-sdk (its bin/dart is a script).
 * Throws when none holds a LICENSE, which the zip has to carry: the compiled core holds the SDK's runtime.
 */
export function findDartSdk(env, executables) {
  const isSdk = (dir) => existsSync(join(dir, 'LICENSE')) && existsSync(join(dir, 'bin'))
  if (env.DART_SDK) {
    if (isSdk(env.DART_SDK)) return resolve(env.DART_SDK)
    throw new Error(
      `DART_SDK is ${env.DART_SDK}, which holds no Dart SDK (a folder with bin/ and LICENSE)`,
    )
  }
  for (const executable of executables) {
    let real
    try {
      real = realpathSync(executable)
    } catch {
      continue
    }
    const bin = dirname(real)
    // Flutter's own folder holds a bin/ and a LICENSE too (Flutter's), so the SDK it keeps comes first
    for (const dir of [join(bin, 'cache', 'dart-sdk'), dirname(bin)]) if (isSdk(dir)) return dir
  }
  throw new Error(
    "The Dart SDK's LICENSE is needed in licenses/, and the SDK's folder was not found: set DART_SDK to it (a folder with bin/ and LICENSE), or put its bin/ on the PATH",
  )
}

/** The dart executables on the PATH, as `where dart` (Windows) or `command -v dart` lists them. */
function dartExecutables() {
  const run =
    process.platform === 'win32'
      ? spawnSync('where', ['dart'], { encoding: 'utf8' })
      : spawnSync('sh', ['-c', 'command -v dart'], { encoding: 'utf8' })
  return run.status === 0 ? run.stdout.split(/\r?\n/).filter(Boolean) : []
}

/**
 * The 2FA directory's licence as the file licenses/2fa-directory.txt: the text its data file carries in `license`, under a
 * header that says what it is (the data is 2fa.directory's, under the MIT licence).
 */
export function twoFactorLicence(directory) {
  if (
    typeof directory.license !== 'string' ||
    !directory.license.includes('Permission is hereby granted')
  )
    throw new Error('core/data/two_factor_directory.json carries no licence text in its "license"')
  return [
    'The 2FA directory',
    '=================',
    '',
    "Kemlock ships a copy of 2fa.directory's data (https://2fa.directory) in core/data/two_factor_directory.json,",
    'and the extension reads it to find the sites that offer two-factor authentication. The data is under the MIT',
    "licence, and its text is the data file's own `license`, as follows.",
    '',
    directory.license.trim(),
    '',
  ].join('\n')
}

/**
 * The licences the zip carries beside the code and the data it ships, in [outDir]/licenses: Geist's, the Dart packages' (the
 * core is compiled from them), and the notices of the data files in core/data (core/licenses/ holds those of the Public
 * Suffix List and the EFF's word list; the 2FA directory's text is the one its own file carries).
 */
async function writeLicences(outDir) {
  const licenses = join(outDir, 'licenses')
  await mkdir(licenses, { recursive: true })
  // Geist's licence goes with the fonts src/shared/fonts.css bundles
  await copyFile(join(root, 'fonts', 'OFL.txt'), join(licenses, 'Geist-OFL.txt'))
  await copyDartLicences(join(root, 'core'), outDir)
  // The compiled core holds the Dart SDK's runtime and core libraries, under its licence
  await copyFile(
    join(findDartSdk(process.env, dartExecutables()), 'LICENSE'),
    join(licenses, 'dart-sdk.txt'),
  )
  for (const file of ['public-suffix-list.txt', 'eff-wordlist.txt'])
    await copyFile(join(root, 'core', 'licenses', file), join(licenses, file))
  const directory = await readJson(join('core', 'data', 'two_factor_directory.json'))
  await writeFile(join(licenses, '2fa-directory.txt'), twoFactorLicence(directory))
}

const shared = (browser) => ({
  root,
  configFile: false,
  logLevel: 'warn',
  define: {
    __BROWSER__: JSON.stringify(browser),
    // true only in a build made with KEMLOCK_FAKE_CORE=1 (the e2e tests'): a release leaves FakeCore out of the bundle
    __FAKE_CORE__: JSON.stringify(fakeCore),
  },
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
  await writeLicences(outDir)
  console.log(`dist/${browser}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coreOut = await compileCore()
  for (const browser of browsers) await buildBrowser(browser, coreOut)
}
