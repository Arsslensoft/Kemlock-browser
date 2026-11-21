// Writes locales/app/<lang>.json from the app's mobile/assets/i18n/<lang>.json:
// the messages the extension says in the app's own words (design decision
// 3). The build turns them, with the extension's own locales/<lang>.json,
// into the browser's _locales. Run it after the app's strings change;
// tool/locales.test.mjs fails until it is.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const appI18n = join(root, '..', 'mobile', 'assets', 'i18n')
export const appLocales = join(root, 'locales', 'app')
export const languages = ['en', 'fr']

/**
 * The app's keys the extension takes. The Save and Update prompts of
 * add-passwords join once it is merged.
 */
export const appKeys = [/^sync\.problem\./]

/** The browser's name for an app key: letters, digits and underscores only. */
export function messageName(key) {
  const name = key.replace(/\./g, '_')
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`"${key}" can't be a browser message name`)
  return name
}

/**
 * A message in the browser's form: `{name}` becomes `$name$` with a
 * placeholder for it, numbered in the order the names first appear, and a
 * `$` of the text is doubled. ICU plurals and selects have no such form,
 * so they are refused.
 */
export function toBrowserMessage(text) {
  if (/\{\s*\w+\s*,/.test(text))
    throw new Error(`Plurals and selects aren't for the browser: ${text}`)
  const names = []
  const message = text.replace(/\$/g, '$$$$').replace(/\{(\w+)\}/g, (_, name) => {
    if (!names.includes(name)) names.push(name)
    return `$${name}$`
  })
  if (/[{}]/.test(message)) throw new Error(`Unmatched brace in: ${text}`)
  if (names.length === 0) return { message }
  return {
    message,
    placeholders: Object.fromEntries(names.map((name, i) => [name, { content: `$${i + 1}` }])),
  }
}

/** The app's strings the extension takes, by browser name, per language. */
export function pickAppStrings(byLanguage) {
  const keys = (strings) => Object.keys(strings).filter((key) => appKeys.some((re) => re.test(key)))
  const [first, ...rest] = languages
  const wanted = keys(byLanguage[first]).sort()
  for (const lang of rest) {
    const theirs = keys(byLanguage[lang]).sort()
    const missing = wanted.filter((key) => !theirs.includes(key))
    const extra = theirs.filter((key) => !wanted.includes(key))
    if (missing.length || extra.length)
      throw new Error(`${lang} differs from ${first}: ${[...missing, ...extra].join(', ')}`)
  }
  const names = new Set()
  for (const key of wanted) {
    const name = messageName(key).toLowerCase()
    if (names.has(name)) throw new Error(`Two keys are the browser's ${name}`)
    names.add(name)
  }
  return Object.fromEntries(
    languages.map((lang) => [
      lang,
      Object.fromEntries(wanted.map((key) => [messageName(key), byLanguage[lang][key]])),
    ]),
  )
}

export async function readAppStrings() {
  const byLanguage = {}
  for (const lang of languages)
    byLanguage[lang] = JSON.parse(await readFile(join(appI18n, `${lang}.json`), 'utf8'))
  return pickAppStrings(byLanguage)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const strings = await readAppStrings()
  await mkdir(appLocales, { recursive: true })
  for (const lang of languages) {
    await writeFile(join(appLocales, `${lang}.json`), `${JSON.stringify(strings[lang], null, 2)}\n`)
    console.log(`locales/app/${lang}.json`)
  }
}
