// What tool/safari/convert.sh does to the Xcode project `xcrun safari-web-extension-converter` writes, kept here as plain
// functions so a test can check them without a Mac (docs/plans/add-safari.md):
//
//   node tool/safari/project.mjs version <manifest.json>
//   node tool/safari/project.mjs patch <project.pbxproj> --version 1.2.3 --build 1 --macos 14.0 --ios 17.0 [--bundle com.example.app] [--team ABCDE12345]
//   xcodebuild -list -json -project <project> | node tool/safari/project.mjs scheme macos|ios [<app name>]
//
// The converter makes the project from the extension's folder, with its own defaults (version 1.0, build 1, an old deployment
// target, no team). The project is not kept in the repository: it is made again from each build, and this sets what the
// owner would otherwise set by hand each time. Signing is the owner's: a team is set only when one is given.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const patterns = {
  version: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  build: /^[1-9]\d{0,8}$/,
  target: /^\d{1,2}(\.\d{1,2})?$/,
  team: /^[A-Z0-9]{10}$/,
  bundle: /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/,
}

function check(name, value) {
  const pattern = patterns[name === 'macos' || name === 'ios' ? 'target' : name]
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`${name} is not valid: ${String(value)}`)
}

/**
 * The project's text with its version, build number, deployment targets and, when given, bundle identifiers and development team
 * set. A bundle identifier given is the app's, and each extension target's is it with ".Extension": the converter does not keep
 * them so (Xcode 26's names the app <prefix>.<app name>, and the build refuses an extension not under its app). Every value is
 * checked against a strict pattern first, since it is written into the project. Gives `{ text, counts }`, the number of places
 * each setting was set at, so a caller can tell that a setting it needed was not in the project (a converter that changed).
 */
export function patchProject(text, { version, build, macos, ios, team, bundle }) {
  check('version', version)
  check('build', build)
  check('macos', macos)
  check('ios', ios)
  if (team !== undefined && team !== '') check('team', team)
  if (bundle !== undefined && bundle !== '') check('bundle', bundle)
  const counts = { version: 0, build: 0, macos: 0, ios: 0, bundle: 0, team: 0 }
  const set = (key, setting, value) => {
    text = text.replace(new RegExp(`(\\b${setting} = )[^;\\n]*;`, 'g'), (_, head) => {
      counts[key] += 1
      return `${head}${value};`
    })
  }
  set('version', 'MARKETING_VERSION', version)
  set('build', 'CURRENT_PROJECT_VERSION', build)
  set('macos', 'MACOSX_DEPLOYMENT_TARGET', macos)
  set('ios', 'IPHONEOS_DEPLOYMENT_TARGET', ios)
  if (bundle !== undefined && bundle !== '') {
    // An extension's identifier ends in "Extension" (the converter's <prefix>.Extension or <app>-Extension); the app's does not
    text = text.replace(
      /(\bPRODUCT_BUNDLE_IDENTIFIER = )("?)([^";\n]*)\2;/g,
      (_, head, _quote, value) => {
        counts.bundle += 1
        return `${head}${/extension$/i.test(value) ? `${bundle}.Extension` : bundle};`
      },
    )
  }
  if (team !== undefined && team !== '') {
    // Any team the project had goes, and each target that has a bundle identifier gets this one beside it
    text = text.replace(/^[ \t]*DEVELOPMENT_TEAM = [^;\n]*;\n/gm, '')
    const bundle = /^([ \t]*)(PRODUCT_BUNDLE_IDENTIFIER = [^;\n]*;\n)/gm
    text = text.replace(bundle, (_, indent, line) => {
      counts.team += 1
      return `${indent}DEVELOPMENT_TEAM = ${team};\n${indent}${line}`
    })
  }
  return { text, counts }
}

/** The schemes `xcodebuild -list -json` lists, from its JSON text (or the object). */
export function schemeNames(listing) {
  const parsed = typeof listing === 'string' ? JSON.parse(listing) : listing
  const schemes = (parsed?.project ?? parsed?.workspace)?.schemes
  if (!Array.isArray(schemes) || !schemes.every((name) => typeof name === 'string'))
    throw new Error('xcodebuild -list gave no list of schemes')
  return schemes
}

/**
 * The scheme that builds the app for a platform (`macos` or `ios`), from `xcodebuild -list -json`. A project made for both
 * platforms has "<app> (macOS)" and "<app> (iOS)"; one made with --macos-only or --ios-only may have a single "<app>". The
 * converter's names are not promised, so this reads them: the app's own name with the platform, then the app's name alone, then
 * any scheme for the platform, then any that is not for the other. Throws when none is.
 */
export function schemeFor(listing, platform, app = 'Kemlock') {
  if (platform !== 'macos' && platform !== 'ios')
    throw new Error(`platform is macos or ios, not ${platform}`)
  const names = schemeNames(listing)
  const mine = platform === 'ios' ? 'iOS' : 'macOS'
  const other = platform === 'ios' ? 'macOS' : 'iOS'
  const found =
    names.find((name) => name === `${app} (${mine})`) ??
    names.find((name) => name === app) ??
    names.find((name) => name.endsWith(`(${mine})`)) ??
    names.find((name) => !name.endsWith(`(${other})`))
  if (found === undefined) throw new Error(`no scheme for ${platform} in: ${names.join(', ')}`)
  return found
}

/** The version of a built extension's manifest, as three numbers. */
export function manifestVersion(manifestText) {
  const { version } = JSON.parse(manifestText)
  check('version', version)
  return version
}

function option(args, name) {
  const at = args.indexOf(`--${name}`)
  return at < 0 ? undefined : args[at + 1]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, file, ...args] = process.argv.slice(2)
  if (command === 'version' && file !== undefined) {
    console.log(manifestVersion(readFileSync(file, 'utf8')))
  } else if (command === 'patch' && file !== undefined) {
    const { text, counts } = patchProject(readFileSync(file, 'utf8'), {
      version: option(args, 'version'),
      build: option(args, 'build'),
      macos: option(args, 'macos'),
      ios: option(args, 'ios'),
      team: option(args, 'team'),
      bundle: option(args, 'bundle'),
    })
    if (counts.version === 0 || counts.build === 0) {
      throw new Error(
        `${file} has no MARKETING_VERSION or CURRENT_PROJECT_VERSION: did the converter change?`,
      )
    }
    if (option(args, 'bundle') !== undefined && counts.bundle === 0) {
      throw new Error(`${file} has no PRODUCT_BUNDLE_IDENTIFIER: did the converter change?`)
    }
    writeFileSync(file, text)
    console.log(`patched ${file}: ${JSON.stringify(counts)}`)
  } else if (command === 'scheme' && (file === 'macos' || file === 'ios')) {
    // The listing comes in on stdin: xcodebuild -list -json | project.mjs scheme macos Kemlock
    console.log(schemeFor(readFileSync(0, 'utf8'), file, args[0]))
  } else {
    console.error(
      'usage: project.mjs version <manifest.json> | patch <project.pbxproj> --version … --build … --macos … --ios … [--bundle …] [--team …] | scheme macos|ios [app name]',
    )
    process.exit(2)
  }
}
