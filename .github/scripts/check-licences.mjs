// Fails when a package in package-lock.json, a dependency or a development tool, has no licence
// or one that is not on the list below, which is what a GPL-3.0-or-later project may build with
// and ship. The development tools count: they build the zips. For the Checks workflow's
// Licences job (CONTRIBUTING.md); run it as `node .github/scripts/check-licences.mjs`.
//
// An SPDX expression passes when it can be satisfied: `(MIT OR Apache-2.0)` when one side is on
// the list, `(MIT AND Zlib)` when both are. A package whose licence is missing or not an SPDX
// identifier is named in licence-exceptions.json (package@version: its licence and why) after a
// person has read its licence. An exception for a package that is no longer in the lockfile
// fails, so that the file holds only what is needed. `WITH` takes only the exceptions listed
// below. Also checks that the copied fonts come with their licence.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** What GPL-3.0-or-later software may use and ship alongside its own code. */
const allowed = new Set(
  [
    '0BSD',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC-BY-4.0',
    'CC0-1.0',
    'GPL-2.0-or-later',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'ISC',
    'LGPL-2.1-or-later',
    'LGPL-3.0-only',
    'LGPL-3.0-or-later',
    'MIT',
    'MPL-2.0',
    'Python-2.0',
    'Unlicense',
    'Zlib',
  ].map((id) => id.toLowerCase()),
)

/** The exceptions that make a licence no stricter for what is built with it. */
const allowedExceptions = new Set(
  [
    'Autoconf-exception-3.0',
    'Bison-exception-2.2',
    'Classpath-exception-2.0',
    'GCC-exception-3.1',
    'LLVM-exception',
  ].map((id) => id.toLowerCase()),
)

/** A licence id as the list spells it: `GPL-2.0+` is `GPL-2.0-or-later`. */
const normalise = (id) => {
  const lower = id.toLowerCase()
  return lower.endsWith('+') ? `${lower.slice(0, -1)}-or-later` : lower
}

/** Splits an SPDX expression into its words and parentheses. */
const tokenize = (expression) => expression.match(/\(|\)|[^\s()]+/g) ?? []

/** Whether the SPDX expression [expression] can be satisfied with the allowed licences. */
function isAllowed(expression) {
  const tokens = tokenize(expression)
  let at = 0
  const peek = () => tokens[at]?.toUpperCase()

  function primary() {
    const token = tokens[at++]
    if (token === undefined) throw new Error('the expression ends too soon')
    if (token === '(') {
      const value = or()
      if (tokens[at++] !== ')') throw new Error('a parenthesis is not closed')
      return value
    }
    if (token === ')' || ['AND', 'OR', 'WITH'].includes(token.toUpperCase())) {
      throw new Error(`unexpected ${token}`)
    }
    let ok = allowed.has(normalise(token))
    if (peek() === 'WITH') {
      at++
      const exception = tokens[at++]
      if (exception === undefined) throw new Error('WITH names no exception')
      ok = ok && allowedExceptions.has(exception.toLowerCase())
    }
    return ok
  }
  function and() {
    let value = primary()
    while (peek() === 'AND') {
      at++
      const next = primary()
      value = value && next
    }
    return value
  }
  function or() {
    let value = and()
    while (peek() === 'OR') {
      at++
      const next = and()
      value = value || next
    }
    return value
  }

  const value = or()
  if (at < tokens.length) throw new Error(`unexpected ${tokens[at]}`)
  return value
}

/** The licence a lockfile entry declares, as one string, or undefined. */
function declared(entry) {
  const one = (value) => (typeof value === 'string' ? value : value?.type)
  if (Array.isArray(entry.license)) return entry.license.map(one).filter(Boolean).join(' OR ')
  return one(entry.license)
}

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const exceptionsFile = join(root, '.github', 'licence-exceptions.json')
const exceptions = existsSync(exceptionsFile)
  ? JSON.parse(readFileSync(exceptionsFile, 'utf8'))
  : {}

let failures = 0
const fail = (message) => {
  failures++
  console.log(`::error title=Licences::${message.replace(/%/g, '%25').replace(/\n/g, '%0A')}`)
}

for (const [key, exception] of Object.entries(exceptions)) {
  let ok
  try {
    ok = isAllowed(exception.licence ?? '')
  } catch {
    ok = false
  }
  if (!ok) fail(`licence-exceptions.json: ${key} names a licence that is not on the list`)
  if (typeof exception.reason !== 'string' || !exception.reason.trim()) {
    fail(`licence-exceptions.json: ${key} has no reason`)
  }
}

const used = new Set()
const counts = new Map()
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === '' || entry.link) continue
  const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const id = `${name}@${entry.version}`
  const kind = entry.dev || entry.devOptional ? 'devDependency' : 'dependency'
  const exception = exceptions[id]
  if (exception) used.add(id)
  const licence = exception?.licence ?? declared(entry)
  counts.set(licence ?? '(none)', (counts.get(licence ?? '(none)') ?? 0) + 1)
  if (!licence) {
    fail(`${id} (${kind}) declares no licence: read it, then add it to licence-exceptions.json`)
    continue
  }
  try {
    if (!isAllowed(licence)) {
      fail(`${id} (${kind}) is under ${licence}, which is not on the list of compatible licences`)
    }
  } catch (error) {
    fail(`${id} (${kind}) declares "${licence}", not an SPDX expression (${error.message})`)
  }
}

for (const key of Object.keys(exceptions)) {
  if (!used.has(key)) {
    fail(`licence-exceptions.json names ${key}, which is not in package-lock.json: remove it`)
  }
}

// The copied fonts come with the licence they are under.
const fonts = join(root, 'fonts')
if (existsSync(fonts)) {
  const files = readdirSync(fonts)
  if (files.some((file) => /\.(ttf|otf|woff2?)$/i.test(file)) && !files.includes('OFL.txt')) {
    fail('fonts/ holds fonts without fonts/OFL.txt, the licence they are under')
  }
}

for (const [licence, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(5)}  ${licence}`)
}
if (failures) {
  console.log(`licences: ${failures} problem(s)`)
  process.exit(1)
}
console.log('licences: ok')
