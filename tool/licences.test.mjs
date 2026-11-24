import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyDartLicences,
  findDartSdk,
  licenceFilesIn,
  shippedPackages,
  twoFactorLicence,
} from './build.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const graph = {
  roots: ['app'],
  packages: [
    { name: 'app', version: '1.0.0', dependencies: ['a', 'b'], devDependencies: ['tester'] },
    { name: 'tester', version: '1.0.0', dependencies: ['only_dev'] },
    { name: 'only_dev', version: '1.0.0', dependencies: [] },
    { name: 'a', version: '1.1.0', dependencies: ['c'] },
    { name: 'b', version: '2.0.0', dependencies: ['c'] },
    { name: 'c', version: '3.0.0', dependencies: [] },
  ],
}

describe('shippedPackages', () => {
  it("holds the core's dependencies and theirs once, and no development dependency", () => {
    expect(shippedPackages(graph)).toEqual([
      { name: 'a', version: '1.1.0' },
      { name: 'b', version: '2.0.0' },
      { name: 'c', version: '3.0.0' },
    ])
  })

  it('refuses a dependency the graph does not list', () => {
    const broken = {
      roots: ['app'],
      packages: [{ name: 'app', version: '1', dependencies: ['gone'] }],
    }
    expect(() => shippedPackages(broken)).toThrow(/gone/)
  })
})

describe('copyDartLicences', () => {
  const dirs = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  /** A core folder whose packages are in its own pub cache: { files } by package name. */
  async function fakeCore(packages) {
    const dir = await mkdtemp(join(tmpdir(), 'kemlock-licences-'))
    dirs.push(dir)
    const core = join(dir, 'core')
    await mkdir(join(core, '.dart_tool'), { recursive: true })
    const config = { packages: [] }
    for (const [name, files] of Object.entries(packages)) {
      const at = join(dir, 'cache', name)
      await mkdir(at, { recursive: true })
      for (const [file, text] of Object.entries(files)) {
        await mkdir(dirname(join(at, file)), { recursive: true })
        await writeFile(join(at, file), text)
      }
      config.packages.push({ name, rootUri: pathToFileURL(at).href, packageUri: 'lib/' })
    }
    await writeFile(join(core, '.dart_tool', 'package_config.json'), JSON.stringify(config))
    const names = Object.keys(packages)
    await writeFile(
      join(core, '.dart_tool', 'package_graph.json'),
      JSON.stringify({
        roots: ['app'],
        packages: [
          { name: 'app', version: '1.0.0', dependencies: names },
          ...names.map((name) => ({ name, version: '1.0.0' })),
        ],
      }),
    )
    return { core, out: join(dir, 'out') }
  }

  it("copies each package's licence files, a licenses/ folder's included, and leaves the rest", async () => {
    const { core, out } = await fakeCore({
      one: { LICENSE: 'MIT text', 'lib/x.dart': '//' },
      two: {
        'LICENSE-other.md': 'other',
        NOTICE: 'notice',
        'licenses/sub/BC.html': '<p>x</p>',
        'README.md': 'no',
      },
    })
    expect(await copyDartLicences(core, out)).toEqual(['one', 'two'])
    expect(await readFile(join(out, 'licenses', 'dart', 'one', 'LICENSE'), 'utf8')).toBe('MIT text')
    expect(existsSync(join(out, 'licenses', 'dart', 'one', 'lib'))).toBe(false)
    expect(
      await readFile(join(out, 'licenses', 'dart', 'two', 'licenses', 'sub', 'BC.html'), 'utf8'),
    ).toBe('<p>x</p>')
    expect((await readdir(join(out, 'licenses', 'dart', 'two'))).sort()).toEqual([
      'LICENSE-other.md',
      'NOTICE',
      'licenses',
    ])
  })

  it('fails when a shipped package has no licence file, a notice being none', async () => {
    const { core, out } = await fakeCore({ one: { LICENSE: 'x' }, bare: { 'README.md': 'x' } })
    await expect(copyDartLicences(core, out)).rejects.toThrow(/bare .*no licence file/)
    const noticeOnly = await fakeCore({ one: { NOTICE: 'x' } })
    await expect(copyDartLicences(noticeOnly.core, noticeOnly.out)).rejects.toThrow(
      /no licence file/,
    )
  })

  it('fails when pub get has not run', async () => {
    const { core, out } = await fakeCore({ one: { LICENSE: 'x' } })
    await rm(join(core, '.dart_tool'), { recursive: true })
    await expect(copyDartLicences(core, out)).rejects.toThrow(/dart pub get/)
  })
})

describe('licenceFilesIn', () => {
  it('names the licence files at the top of a folder, by any case and extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kemlock-licences-'))
    try {
      for (const file of [
        'license',
        'COPYING.txt',
        'Notice.md',
        'LICENCE-MIT',
        'pubspec.yaml',
        'changelog.md',
      ])
        await writeFile(join(dir, file), 'x')
      const files = await licenceFilesIn(dir)
      expect(files.map(({ file }) => file).sort()).toEqual([
        'COPYING.txt',
        'LICENCE-MIT',
        'Notice.md',
        'license',
      ])
      expect(files.filter(({ notice }) => notice).map(({ file }) => file)).toEqual(['Notice.md'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('findDartSdk', () => {
  const dirs = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  /** An SDK folder (bin/ and a LICENSE) at [at] under a fresh temporary folder, whose path is returned. */
  async function sdkAt(base, at, licence = true) {
    const sdk = join(base, ...at)
    await mkdir(join(sdk, 'bin'), { recursive: true })
    await writeFile(join(sdk, 'bin', 'dart'), '')
    if (licence) await writeFile(join(sdk, 'LICENSE'), 'Copyright the Dart project authors')
    return sdk
  }
  const temp = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kemlock-sdk-'))
    dirs.push(dir)
    return dir
  }

  it('is DART_SDK when it is set, and refuses one that is no SDK', async () => {
    const base = await temp()
    const sdk = await sdkAt(base, ['sdk'])
    expect(findDartSdk({ DART_SDK: sdk }, [])).toBe(sdk)
    const bare = await sdkAt(base, ['bare'], false)
    expect(() => findDartSdk({ DART_SDK: bare }, [])).toThrow(/DART_SDK .* holds no Dart SDK/)
  })

  it("is the folder above the dart executable's bin/, as a plain install has it", async () => {
    const base = await temp()
    const sdk = await sdkAt(base, ['dart-sdk'])
    expect(findDartSdk({}, [join(sdk, 'bin', 'dart')])).toBe(sdk)
  })

  it("is Flutter's bin/cache/dart-sdk when the executable is Flutter's script", async () => {
    const base = await temp()
    const sdk = await sdkAt(base, ['flutter', 'bin', 'cache', 'dart-sdk'])
    const script = join(base, 'flutter', 'bin', 'dart')
    await writeFile(script, '')
    expect(findDartSdk({}, [join(base, 'nowhere', 'dart'), script])).toBe(sdk)
  })

  it('fails, saying how to fix it, when no SDK with a LICENSE is found', async () => {
    const base = await temp()
    const bare = await sdkAt(base, ['bare'], false)
    expect(() => findDartSdk({}, [])).toThrow(/DART_SDK/)
    expect(() => findDartSdk({}, [join(bare, 'bin', 'dart')])).toThrow(/LICENSE is needed/)
  })
})

describe('the Lucide licence', () => {
  it('is kept beside the icons it covers, with the ISC text and the Feather part, and both icon files name it', async () => {
    const text = await readFile(join(root, 'src', 'shared', 'ui', 'LUCIDE-LICENSE.txt'), 'utf8')
    expect(text).toContain('ISC License')
    expect(text).toContain('Lucide')
    expect(text).toContain('Cole Bemis')
    expect(text).toContain('Permission to use, copy, modify, and/or distribute')
    for (const file of [
      join('src', 'shared', 'ui', 'icons.tsx'),
      join('src', 'setup', 'icons.tsx'),
    ])
      expect(await readFile(join(root, file), 'utf8'), file).toContain('LUCIDE-LICENSE.txt')
  })
})

describe('twoFactorLicence', () => {
  it("is the data file's own licence text under a header, and refuses a file without one", async () => {
    const directory = JSON.parse(
      await readFile(join(root, 'core', 'data', 'two_factor_directory.json'), 'utf8'),
    )
    const text = twoFactorLicence(directory)
    expect(text).toContain('Permission is hereby granted')
    expect(text).toContain('2factorauth')
    expect(() => twoFactorLicence({ license: 'MIT' })).toThrow(/no licence text/)
    expect(() => twoFactorLicence({})).toThrow(/no licence text/)
  })
})

// What the build wrote, when it has run (npm run build): the folders' licenses/ hold every shipped package's licence and the
// three data files' notices
describe.skipIf(!existsSync(join(root, 'dist', 'chrome', 'licenses')))('a built licenses/', () => {
  for (const browser of ['chrome', 'firefox']) {
    it(`${browser}'s holds a licence for each shipped Dart package and the data files' notices`, async () => {
      const base = join(root, 'dist', browser, 'licenses')
      if (!existsSync(base)) return
      const graph = JSON.parse(
        await readFile(join(root, 'core', '.dart_tool', 'package_graph.json'), 'utf8'),
      )
      const names = shippedPackages(graph).map(({ name }) => name)
      expect(names).toEqual(
        expect.arrayContaining(['cryptography', 'zxing2', 'http', 'web', 'kemlock_core']),
      )
      for (const name of names) {
        const files = await readdir(join(base, 'dart', name))
        expect(
          files.some((file) => /^(licen[cs]e|copying)/i.test(file)),
          `licenses/dart/${name} holds no licence`,
        ).toBe(true)
      }
      expect(await readFile(join(base, 'lucide.txt'), 'utf8')).toBe(
        await readFile(join(root, 'src', 'shared', 'ui', 'LUCIDE-LICENSE.txt'), 'utf8'),
      )
      expect(await readFile(join(base, 'public-suffix-list.txt'), 'utf8')).toContain('MPL-2.0')
      expect(await readFile(join(base, 'eff-wordlist.txt'), 'utf8')).toContain('CC BY 3.0 US')
      expect(await readFile(join(base, 'dart-sdk.txt'), 'utf8')).toContain('Dart project authors')
      expect(await readFile(join(base, '2fa-directory.txt'), 'utf8')).toContain(
        'Permission is hereby granted',
      )
    })
  }
})
