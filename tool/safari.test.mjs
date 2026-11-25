// The Safari target (docs/plans/add-safari.md): its manifest, the build and zip that list it, the Xcode project's settings, the
// script that makes the project (with the Mac's tools replaced by stand-ins), and the workflows and the Swift handler that must
// agree with the rest. Nothing here needs a Mac.
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { applyRemovals, mergeManifest, targets } from './build.mjs'
import { manifestVersion, patchProject, schemeFor, schemeNames } from './safari/project.mjs'
import { browsers } from './zip.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const readText = (path) => readFile(join(root, path), 'utf8')
const readJson = async (path) => JSON.parse(await readText(path))

/** The Safari manifest as the build makes it. */
const safariManifest = async () =>
  applyRemovals(
    mergeManifest(await readJson('manifests/base.json'), await readJson('manifests/safari.json')),
  )

describe('the Safari manifest', () => {
  it('is Manifest V3 with the same name, pages and icons as the others', async () => {
    const [safari, chrome] = [await safariManifest(), await readJson('manifests/base.json')]
    expect(safari.manifest_version).toBe(3)
    for (const key of ['name', 'description', 'default_locale', 'icons', 'action', 'version'])
      expect(safari[key], key).toEqual(chrome[key])
    expect(safari.optional_host_permissions).toEqual(['<all_urls>'])
  })

  it('runs the background as a page with scripts, not a service worker', async () => {
    const { background } = await safariManifest()
    expect(background).toEqual({ scripts: ['background.js'], type: 'module', persistent: false })
    expect(background).not.toHaveProperty('service_worker')
  })

  it('has no permission Safari does not know, and has the ones the extension needs', async () => {
    const { permissions } = await safariManifest()
    for (const gone of ['idle', 'identity', 'clipboardRead', 'offscreen'])
      expect(permissions, gone).not.toContain(gone)
    for (const kept of [
      'storage',
      'alarms',
      'contextMenus',
      'activeTab',
      'scripting',
      'clipboardWrite',
      'nativeMessaging',
    ])
      expect(permissions, kept).toContain(kept)
  })

  it('keeps every permission to those Safari documents as supported', async () => {
    // WebKit's list: a permission outside it is a warning in Xcode and in Safari. Add a name here, or remove it in
    // manifests/safari.json under $remove, when another change asks for a permission
    const supported = new Set([
      'activeTab',
      'alarms',
      'clipboardWrite',
      'contextMenus',
      'cookies',
      'declarativeNetRequest',
      'declarativeNetRequestFeedback',
      'declarativeNetRequestWithHostAccess',
      'menus',
      'nativeMessaging',
      'notifications',
      'scripting',
      'storage',
      'tabs',
      'unlimitedStorage',
      'webNavigation',
      'webRequest',
    ])
    const { permissions } = await safariManifest()
    expect(permissions.filter((name) => !supported.has(name))).toEqual([])
  })

  it('keeps every optional permission to those Safari documents as supported too', async () => {
    // The same list as above: `notifications` (the account's alert) and the optional `webNavigation` (passkeys) are on it. If a
    // check on a Mac (docs/safari-checklist.md, section 11) finds one missing, remove it in manifests/safari.json under $remove
    const supported = new Set(['webNavigation', 'notifications', 'tabs', 'cookies', 'webRequest'])
    const { optional_permissions = [] } = await safariManifest()
    expect(optional_permissions).toContain('webNavigation')
    expect(optional_permissions.filter((name) => !supported.has(name))).toEqual([])
  })

  it('keeps the CSP that lets the core run WebAssembly', async () => {
    const { content_security_policy } = await safariManifest()
    expect(content_security_policy.extension_pages).toContain("'wasm-unsafe-eval'")
  })

  it("leaves out what is Chrome's or Firefox's own", async () => {
    const manifest = await safariManifest()
    expect(manifest).not.toHaveProperty('minimum_chrome_version')
    expect(manifest).not.toHaveProperty('$remove')
    expect(manifest.browser_specific_settings).not.toHaveProperty('gecko')
    for (const entry of manifest.web_accessible_resources)
      expect(entry).not.toHaveProperty('use_dynamic_url')
  })

  it('asks for a Safari version, as two numbers, which is the first that runs the core', async () => {
    const { browser_specific_settings } = await safariManifest()
    expect(browser_specific_settings.safari.strict_min_version).toMatch(/^\d{2}(\.\d+)?$/)
    // WasmGC arrived in Safari 18.2, and the core is dart2wasm
    expect(Number(browser_specific_settings.safari.strict_min_version)).toBeGreaterThanOrEqual(18.2)
  })

  it('leaves the other two manifests as they were', async () => {
    const chrome = mergeManifest(
      await readJson('manifests/base.json'),
      await readJson('manifests/chrome.json'),
    )
    expect(applyRemovals(chrome)).toEqual(chrome)
    expect(chrome.permissions).toContain('idle')
    expect(chrome.permissions).toContain('offscreen')
    const firefox = mergeManifest(
      await readJson('manifests/base.json'),
      await readJson('manifests/firefox.json'),
    )
    expect(firefox.permissions).toContain('identity')
  })
})

describe('applyRemovals', () => {
  it('takes the named entries out of the merged list, and the $remove key itself', () => {
    const merged = { a: 1, list: ['x', 'y', 'z'], $remove: { list: ['y'] } }
    expect(applyRemovals(merged)).toEqual({ a: 1, list: ['x', 'z'] })
    expect(merged.list).toEqual(['x', 'y', 'z'])
  })

  it('is the manifest as it is when nothing is to be removed', () => {
    expect(applyRemovals({ list: ['x'] })).toEqual({ list: ['x'] })
  })

  it('refuses a removal that removes nothing, which is a typo', () => {
    expect(() => applyRemovals({ list: ['x'], $remove: { list: ['q'] } })).toThrow(/names q/)
  })

  it('refuses what is not a list', () => {
    expect(() => applyRemovals({ list: 'x', $remove: { list: ['x'] } })).toThrow(/lists/)
    expect(() => applyRemovals({ list: ['x'], $remove: { list: 'x' } })).toThrow(/lists/)
    expect(() => applyRemovals({ $remove: { missing: ['x'] } })).toThrow(/lists/)
    expect(() => applyRemovals({ $remove: ['x'] })).toThrow(/object/)
  })
})

describe('the build and the zip', () => {
  it('build Chrome, Firefox and Safari, each for its own engine', () => {
    expect(Object.keys(targets)).toEqual(['chrome', 'firefox', 'safari'])
    expect(targets.safari).toMatch(/^safari\d+$/)
    expect(Number(targets.safari.slice('safari'.length))).toBeGreaterThanOrEqual(18)
  })

  it('zip the three, so the release holds and sums them', () => {
    expect(browsers).toEqual(['chrome', 'firefox', 'safari'])
  })

  it('know the Safari build to the code that tells the browsers apart', async () => {
    expect(await readText('src/shared/env.d.ts')).toContain("'chrome' | 'firefox' | 'safari'")
    const scripts = (await readJson('package.json')).scripts
    expect(scripts['build:safari']).toBe('node tool/build.mjs safari')
    expect(scripts['safari:project']).toBe('bash tool/safari/convert.sh')
  })
})

describe('the project settings', () => {
  const project = [
    '\t\t\t\tMARKETING_VERSION = 1.0;',
    '\t\t\t\tCURRENT_PROJECT_VERSION = 1;',
    '\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 10.14;',
    '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.kemlock.browser";',
    '\t\t\t\tMARKETING_VERSION = 1.0;',
    '\t\t\t\tCURRENT_PROJECT_VERSION = 1;',
    '\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 15.0;',
    '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.kemlock.browser.Extension;',
    '',
  ].join('\n')
  const settings = { version: '1.2.3', build: '7', macos: '14.0', ios: '17.0' }

  it('sets the version, the build, and both deployment targets, wherever they are', () => {
    const { text, counts } = patchProject(project, settings)
    expect(counts).toEqual({ version: 2, build: 2, macos: 1, ios: 1, team: 0 })
    expect(text).not.toContain('MARKETING_VERSION = 1.0;')
    expect(text.match(/MARKETING_VERSION = 1\.2\.3;/g)).toHaveLength(2)
    expect(text.match(/CURRENT_PROJECT_VERSION = 7;/g)).toHaveLength(2)
    expect(text).toContain('MACOSX_DEPLOYMENT_TARGET = 14.0;')
    expect(text).toContain('IPHONEOS_DEPLOYMENT_TARGET = 17.0;')
    // Nothing else moved
    expect(text).toContain('PRODUCT_BUNDLE_IDENTIFIER = "com.kemlock.browser";')
    expect(text).not.toContain('DEVELOPMENT_TEAM')
  })

  it('signs with no team unless one is given, and with it beside each bundle identifier', () => {
    const signed = patchProject(project, { ...settings, team: 'ABCDE12345' })
    expect(signed.counts.team).toBe(2)
    expect(signed.text.match(/DEVELOPMENT_TEAM = ABCDE12345;/g)).toHaveLength(2)
    expect(patchProject(project, { ...settings, team: '' }).counts.team).toBe(0)
  })

  it('replaces a team the project had, instead of adding a second', () => {
    const team = '\t\t\t\tDEVELOPMENT_TEAM = OLDTEAM123;\n'
    const had = project.replace('\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com', `${team}$&`)
    const { text } = patchProject(had, { ...settings, team: 'ABCDE12345' })
    expect(text).not.toContain('OLDTEAM123')
    expect(text.match(/DEVELOPMENT_TEAM/g)).toHaveLength(2)
  })

  it('is the same text when it is patched twice', () => {
    const once = patchProject(project, { ...settings, team: 'ABCDE12345' }).text
    expect(patchProject(once, { ...settings, team: 'ABCDE12345' }).text).toBe(once)
  })

  it('reports a project without the settings, which means the converter changed', () => {
    expect(patchProject('nothing here\n', settings).counts).toMatchObject({ version: 0, build: 0 })
  })

  it('refuses a value that could change the project beyond its setting', () => {
    const bad = (change) => () => patchProject(project, { ...settings, ...change })
    expect(bad({ version: '1.2' })).toThrow(/version/)
    expect(bad({ version: '1.2.3; EVIL = 1' })).toThrow(/version/)
    expect(bad({ build: '0' })).toThrow(/build/)
    expect(bad({ build: '1;\n' })).toThrow(/build/)
    expect(bad({ macos: 'latest' })).toThrow(/macos/)
    expect(bad({ ios: '17.0; X = 1' })).toThrow(/ios/)
    expect(bad({ team: 'abc' })).toThrow(/team/)
    expect(bad({ team: 'ABCDE12345; X = 1' })).toThrow(/team/)
    expect(bad({ version: undefined })).toThrow(/version/)
  })

  it('picks the scheme from what xcodebuild lists, for each platform the project was made for', () => {
    const schemes = ['Kemlock Extension (macOS)', 'Kemlock (iOS)', 'Kemlock (macOS)']
    const both = { project: { schemes } }
    const one = { project: { schemes: ['Kemlock'] } }
    expect(schemeFor(both, 'macos')).toBe('Kemlock (macOS)')
    expect(schemeFor(both, 'ios')).toBe('Kemlock (iOS)')
    expect(schemeFor(JSON.stringify(both), 'macos', 'Kemlock')).toBe('Kemlock (macOS)')
    // --macos-only and --ios-only may leave one scheme, with no platform in its name
    expect(schemeFor(one, 'macos')).toBe('Kemlock')
    expect(schemeFor(one, 'ios')).toBe('Kemlock')
    // Another app name, or a name the converter changed
    const other = { project: { schemes: ['Other (macOS)'] } }
    expect(schemeFor(other, 'macos', 'Kemlock')).toBe('Other (macOS)')
    const workspace = { workspace: { schemes: ['Kemlock (macOS)'] } }
    expect(schemeFor(workspace, 'macos')).toBe('Kemlock (macOS)')
  })

  it('has no scheme to give when there is none for the platform, or no list', () => {
    const iosOnly = { project: { schemes: ['Kemlock (iOS)'] } }
    expect(() => schemeFor(iosOnly, 'macos')).toThrow(/no scheme/)
    expect(() => schemeFor({ project: { schemes: [] } }, 'macos')).toThrow(/no scheme/)
    expect(() => schemeFor({ project: {} }, 'macos')).toThrow(/schemes/)
    expect(() => schemeNames('{}')).toThrow(/schemes/)
    const one = { project: { schemes: ['Kemlock'] } }
    expect(() => schemeFor(one, 'watchos')).toThrow(/macos or ios/)
  })

  it("reads the extension's own version from its manifest, as three numbers", () => {
    expect(manifestVersion('{"version":"0.10.2"}')).toBe('0.10.2')
    expect(() => manifestVersion('{"version":"0.1"}')).toThrow(/version/)
    expect(() => manifestVersion('{}')).toThrow(/version/)
  })
})

/** Stand-ins for `xcrun safari-web-extension-converter` and `sips`, which write what the real ones write, in outline. */
const fakeXcrun = `#!/bin/sh
echo "$@" >> "$FAKE_LOG"
[ "$1" = "safari-web-extension-converter" ] || exit 64
shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-location) location="$2"; shift ;;
    --app-name) name="$2"; shift ;;
  esac
  shift
done
project="$location/$name"
mkdir -p "$project/$name.xcodeproj" "$project/Shared (Extension)" "$project/Shared (App)/Assets.xcassets/AppIcon.appiconset"
printf '\\t\\t\\t\\tMARKETING_VERSION = 1.0;\\n\\t\\t\\t\\tCURRENT_PROJECT_VERSION = 1;\\n\\t\\t\\t\\tMACOSX_DEPLOYMENT_TARGET = 10.14;\\n\\t\\t\\t\\tPRODUCT_BUNDLE_IDENTIFIER = x.y;\\n' > "$project/$name.xcodeproj/project.pbxproj"
echo "// the converter's echo" > "$project/Shared (Extension)/SafariWebExtensionHandler.swift"
printf 'old' > "$project/Shared (App)/Assets.xcassets/AppIcon.appiconset/mac-icon-128@1x.png"
printf 'old' > "$project/Shared (App)/Assets.xcassets/AppIcon.appiconset/mac-icon-512@2x.png"
`
const fakeXcodebuild = `#!/bin/sh
echo '{"project":{"name":"Kemlock","schemes":["Kemlock Extension (macOS)","Kemlock (iOS)","Kemlock (macOS)"]}}'
`
const fakeSips = `#!/bin/sh
echo "$@" >> "$FAKE_LOG"
case "$1" in
  -g)
    case "$2" in
      pixelWidth) case "$3" in *512@2x*) echo "  pixelWidth: 1024" ;; *) echo "  pixelWidth: 128" ;; esac ;;
      pixelHeight) case "$3" in *512@2x*) echo "  pixelHeight: 1024" ;; *) echo "  pixelHeight: 128" ;; esac ;;
    esac ;;
  -z) cp "$4" "$6" ;;
esac
`

describe.skipIf(process.platform === 'win32')('tool/safari/convert.sh', () => {
  const dirs = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  /** A built Safari folder, an icon, and the stand-in tools, in a temp folder. */
  async function setUp() {
    const dir = await mkdtemp(join(tmpdir(), 'kemlock-safari-'))
    dirs.push(dir)
    const folder = join(dir, 'safari')
    await mkdir(folder)
    await writeFile(join(folder, 'manifest.json'), '{"version":"1.2.3"}\n')
    await writeFile(join(dir, 'icon.png'), 'the icon')
    for (const [name, text] of [
      ['xcrun', fakeXcrun],
      ['sips', fakeSips],
      ['xcodebuild', fakeXcodebuild],
    ]) {
      await writeFile(join(dir, name), text)
      await chmod(join(dir, name), 0o755)
    }
    return { dir, folder, output: join(dir, 'out'), log: join(dir, 'log') }
  }

  const run = (setup, env = {}, args = [setup.folder, setup.output]) =>
    spawnSync('bash', [join(root, 'tool', 'safari', 'convert.sh'), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        // The runner's node, which the script runs
        PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
        KEMLOCK_XCRUN: join(setup.dir, 'xcrun'),
        KEMLOCK_SIPS: join(setup.dir, 'sips'),
        KEMLOCK_SAFARI_ICON: join(setup.dir, 'icon.png'),
        FAKE_LOG: setup.log,
        ...env,
      },
    })

  const project = (setup) => join(setup.output, 'Kemlock')
  const pbxprojOf = (setup) => join(project(setup), 'Kemlock.xcodeproj', 'project.pbxproj')
  const handlerFile = 'SafariWebExtensionHandler.swift'

  it('makes the project from the folder, and sets the version, the build and the targets', async () => {
    const setup = await setUp()
    const done = run(setup, { KEMLOCK_SAFARI_BUILD: '9' })
    expect(done.stderr).toBe('')
    expect(done.status).toBe(0)
    const pbxproj = await readFile(pbxprojOf(setup), 'utf8')
    expect(pbxproj).toContain('MARKETING_VERSION = 1.2.3;')
    expect(pbxproj).toContain('CURRENT_PROJECT_VERSION = 9;')
    expect(pbxproj).toContain('MACOSX_DEPLOYMENT_TARGET = 14.0;')
    expect(pbxproj).not.toContain('DEVELOPMENT_TEAM')
  })

  it('calls the converter with the folder, the names, and no prompt', async () => {
    const setup = await setUp()
    run(setup, {
      KEMLOCK_SAFARI_BUNDLE_ID: 'com.example.kemlock',
      KEMLOCK_SAFARI_APP_NAME: 'Kemlock Test',
    })
    const lines = (await readFile(setup.log, 'utf8')).split('\n')
    const converter = lines.find((line) => line.startsWith('safari-web-extension-converter'))
    expect(converter).toContain(` ${setup.folder} `)
    expect(converter).toContain(`--project-location ${setup.output}`)
    expect(converter).toContain('--app-name Kemlock Test')
    expect(converter).toContain('--bundle-identifier com.example.kemlock')
    for (const flag of ['--swift', '--copy-resources', '--no-open', '--no-prompt', '--force'])
      expect(converter, flag).toContain(flag)
    expect(converter).not.toContain('--macos-only')
    expect(converter).not.toContain('--ios-only')
  })

  it('makes one platform when asked, and signs with the team it is given', async () => {
    const setup = await setUp()
    const signing = { KEMLOCK_SAFARI_PLATFORMS: 'macos', KEMLOCK_SAFARI_TEAM: 'ABCDE12345' }
    const done = run(setup, signing)
    expect(done.status).toBe(0)
    expect(await readFile(setup.log, 'utf8')).toContain('--macos-only')
    const pbxproj = await readFile(pbxprojOf(setup), 'utf8')
    expect(pbxproj).toContain('DEVELOPMENT_TEAM = ABCDE12345;')
    const ios = await setUp()
    expect(run(ios, { KEMLOCK_SAFARI_PLATFORMS: 'ios' }).status).toBe(0)
    expect(await readFile(ios.log, 'utf8')).toContain('--ios-only')
  })

  it("puts Kemlock's handler over the converter's echo, and the icon at each size of the icon set", async () => {
    const setup = await setUp()
    expect(run(setup).status).toBe(0)
    const handler = await readFile(join(project(setup), 'Shared (Extension)', handlerFile), 'utf8')
    expect(handler).toBe(await readText('tool/safari/SafariWebExtensionHandler.swift'))
    const set = join(project(setup), 'Shared (App)', 'Assets.xcassets', 'AppIcon.appiconset')
    expect(await readFile(join(set, 'mac-icon-128@1x.png'), 'utf8')).toBe('the icon')
    expect(await readFile(join(set, 'mac-icon-512@2x.png'), 'utf8')).toBe('the icon')
    const log = await readFile(setup.log, 'utf8')
    expect(log).toContain('-z 128 128 ')
    expect(log).toContain('-z 1024 1024 ')
  })

  it('names the scheme to build, read from the project when xcodebuild is there', async () => {
    const setup = await setUp()
    const found = run(setup, { KEMLOCK_XCODEBUILD: join(setup.dir, 'xcodebuild') })
    expect(found.status).toBe(0)
    expect(found.stdout).toContain('build "Kemlock (macOS)"')
    const ios = await setUp()
    const iosOnly = run(ios, {
      KEMLOCK_XCODEBUILD: join(ios.dir, 'xcodebuild'),
      KEMLOCK_SAFARI_PLATFORMS: 'ios',
    })
    expect(iosOnly.stdout).toContain('build "Kemlock (iOS)"')
    // Without xcodebuild on the path, it says how to find it rather than guess one
    const none = run(await setUp(), { KEMLOCK_XCODEBUILD: join(setup.dir, 'not-there') })
    expect(none.status).toBe(0)
    expect(none.stdout).toContain('xcodebuild -list')
  })

  it('makes the project again from nothing each time', async () => {
    const setup = await setUp()
    await mkdir(setup.output)
    await writeFile(join(setup.output, 'stale'), 'left from before')
    expect(run(setup).status).toBe(0)
    await expect(readFile(join(setup.output, 'stale'))).rejects.toThrow()
  })

  it('refuses a folder with no manifest, and says to build first', async () => {
    const setup = await setUp()
    await rm(join(setup.folder, 'manifest.json'))
    const done = run(setup)
    expect(done.status).toBe(1)
    expect(done.stderr).toContain('npm run build:safari')
  })

  it('refuses a bundle identifier, a name, a platform, and an output that are not safe', async () => {
    const setup = await setUp()
    for (const env of [
      { KEMLOCK_SAFARI_BUNDLE_ID: 'kemlock' },
      { KEMLOCK_SAFARI_BUNDLE_ID: 'com.example.a b' },
      { KEMLOCK_SAFARI_APP_NAME: 'Kemlock; rm -rf /' },
      { KEMLOCK_SAFARI_PLATFORMS: 'watchos' },
    ]) {
      const done = run(setup, env)
      expect(done.status, JSON.stringify(env)).toBe(1)
      expect(done.stderr).toContain('convert.sh:')
    }
  })

  it('refuses a value with a newline in it, which a line-by-line check lets through', async () => {
    const setup = await setUp()
    for (const env of [
      { KEMLOCK_SAFARI_BUNDLE_ID: 'com.example.app\n--evil' },
      { KEMLOCK_SAFARI_APP_NAME: 'Kemlock\nrm' },
    ]) {
      expect(run(setup, env).status, JSON.stringify(env)).toBe(1)
    }
  })

  it('never deletes the repository, what is above it, its files, the folder it was given or what holds it', async () => {
    const setup = await setUp()
    const refused = [
      '/',
      '.',
      root,
      dirname(root),
      join(root, 'dist'),
      join(root, 'src'),
      join(root, '.git'),
      setup.dir,
      setup.folder,
      join(setup.folder, '..'),
    ]
    for (const output of refused) {
      const done = run(setup, {}, [setup.folder, output])
      expect(done.status, output).toBe(1)
      expect(done.stderr, output).toContain('deleted first')
    }
    // The built folder is still there, and the repository's files are
    expect(await readText('package.json')).toContain('kemlock-extension')
    await expect(readFile(join(setup.folder, 'manifest.json'), 'utf8')).resolves.toContain('1.2.3')
  })

  it('may make the project anywhere outside the repository', async () => {
    const setup = await setUp()
    expect(run(setup, {}, [setup.folder, join(setup.dir, 'elsewhere', 'deeper')]).status).toBe(0)
  })

  it('refuses a version or a team that the project would take literally', async () => {
    const setup = await setUp()
    expect(run(setup, { KEMLOCK_SAFARI_TEAM: 'nope' }).status).not.toBe(0)
    expect(run(setup, { KEMLOCK_SAFARI_BUILD: '1; X = 2' }).status).not.toBe(0)
    await writeFile(join(setup.folder, 'manifest.json'), '{"version":"1.2"}\n')
    expect(run(setup).status).not.toBe(0)
  })

  it('goes on without an icon, and says so', async () => {
    const setup = await setUp()
    const done = run(setup, { KEMLOCK_SAFARI_ICON: join(setup.dir, 'missing.png') })
    expect(done.status).toBe(0)
    expect(done.stderr).toContain('no icon')
  })
})

describe("the Swift handler and the extension's side of it", () => {
  it('speak the same protocol version and the same commands', async () => {
    const swift = await readText('tool/safari/SafariWebExtensionHandler.swift')
    const native = await readText('src/background/native.ts')
    const swiftVersion = swift.match(/private let protocolVersion = (\d+)/)?.[1]
    const tsVersion = native.match(/export const nativeProtocol = (\d+)/)?.[1]
    expect(swiftVersion).toBeDefined()
    expect(swiftVersion).toBe(tsVersion)
    const commands = native.match(/export type NativeCommand = ([^\n]+)/)?.[1] ?? ''
    for (const command of [...commands.matchAll(/'(\w+)'/g)].map((m) => m[1])) {
      expect(swift, command).toContain(`case "${command}"`)
    }
    // Neither side answers a message that is not ours with anything but a no
    expect(swift).toContain('default:\n            return failure')
  })

  it('has a sign-in-free, click-free clipboard marked as concealed', async () => {
    const swift = await readText('tool/safari/SafariWebExtensionHandler.swift')
    expect(swift).toContain('org.nspasteboard.ConcealedType')
    expect(swift).toContain('CGSSessionScreenIsLocked')
  })

  it("is the file the manifest's nativeMessaging permission is for", async () => {
    expect((await readJson('manifests/safari.json')).permissions).toContain('nativeMessaging')
  })
})

describe('the workflows', () => {
  const pinned = /uses: [\w./-]+@[0-9a-f]{40} # v\d/
  const usesIn = (job) => job.split('\n').filter((line) => line.includes('uses:'))

  it('build the Xcode project unsigned on a Mac in checks.yml, from the Build job', async () => {
    const checks = await readText('.github/workflows/checks.yml')
    const job = checks.slice(checks.indexOf('\n  safari:'), checks.indexOf('\n  e2e:'))
    expect(job).toContain('runs-on: macos-latest')
    expect(job).toContain('needs: build')
    expect(job).toContain('bash tool/safari/convert.sh dist/safari')
    expect(job).toContain('CODE_SIGNING_ALLOWED=NO')
    for (const line of usesIn(job)) expect(line).toMatch(pinned)
    // A release does not wait for it
    expect(checks).toContain('safari-project:')
  })

  it('attach the Safari zip with the others in release.yml, which waits for no macOS job', async () => {
    const release = await readText('.github/workflows/release.yml')
    expect(release).toContain('safari-project: false')
    expect(release).not.toContain('macos')
    // The zips are attached by glob, so Safari's goes with Chrome's and Firefox's
    expect(release).toContain('files/*.zip files/SHA256SUMS')
  })

  it("makes the release's Xcode project in a workflow of its own, from a pinned Mac with no write access", async () => {
    const workflow = await readText('.github/workflows/safari-project.yml')
    expect(workflow).toContain('workflows: [Release]')
    const jobs = workflow.split(/\n {2}(?=\w+:\n)/)
    const build = jobs.find((job) => job.startsWith('build:')) ?? ''
    const attach = jobs.find((job) => job.startsWith('attach:')) ?? ''
    expect(build).toContain('runs-on: macos-15')
    expect(build).toContain('contents: read')
    expect(build).not.toContain('contents: write')
    expect(build).toContain('gh release download')
    // It runs the default branch's tools only: code from another ref could poison the default branch's cache
    expect(build).not.toContain('ref:')
    expect(build).toContain('timeout-minutes')
    expect(attach).toContain('runs-on: ubuntu-24.04')
    expect(attach).toContain('contents: write')
    // Never over a file that is there, and with a sum of its own
    expect(attach).not.toContain('--clobber')
    expect(attach).toContain('SHA256SUMS-safari-xcode')
    for (const line of usesIn(workflow)) expect(line).toMatch(pinned)
  })
})
