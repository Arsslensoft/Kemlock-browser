import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import appEn from '../../locales/app/en.json'
import baseEn from '../../locales/en.json'
import contentEn from '../../locales/parts/content.en.json'
import extrasEn from '../../locales/parts/extras.en.json'
import extrasFr from '../../locales/parts/extras.fr.json'
import itemsEn from '../../locales/parts/items.en.json'
import itemsFr from '../../locales/parts/items.fr.json'
import popupEn from '../../locales/parts/popup.en.json'
import popupFr from '../../locales/parts/popup.fr.json'

const src = fileURLToPath(new URL('..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.|testing\./.test(entry.name) ? [path] : []
  })
}

const used = new Set(
  sources(src).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/['"`](extras_[A-Za-z0-9_]*)['"`]/g)]
      .map((m) => m[1]!)
      // The names built in code: a prefix and what it is for
      .filter((name) => !name.endsWith('_')),
  ),
)

const dynamic = [
  ...[
    'backup_codes',
    'card',
    'certificate',
    'contact',
    'file',
    'identity',
    'key',
    'key_otp',
    'login',
    'note',
    'otp',
    'passkey',
    'pgp_key',
    'ssh_key',
  ].map((kind) => `extras_kind_${kind}`),
  ...['default', 'domain', 'exact', 'host', 'never', 'regex', 'startsWith'].map(
    (rule) => `extras_rule_${rule}`,
  ),
]

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('the strings of custom fields, links and match rules', () => {
  it('has every string the extension asks for, in English and in French', () => {
    const missing = [...used, ...dynamic].filter(
      (name) => !(name in extrasEn) || !(name in extrasFr),
    )
    expect(missing).toEqual([])
  })

  it('has no string the extension never asks for', () => {
    const wanted = new Set([...used, ...dynamic])
    expect(Object.keys(extrasEn).filter((name) => !wanted.has(name))).toEqual([])
  })

  it('has the same strings in both languages, with the same placeholders', () => {
    expect(Object.keys(extrasFr).sort()).toEqual(Object.keys(extrasEn).sort())
    for (const [name, text] of Object.entries(extrasEn))
      expect(placeholders((extrasFr as Record<string, string>)[name]!), name).toEqual(
        placeholders(text),
      )
  })

  it('has no name the build would see twice, case aside', () => {
    const others = [
      ...Object.keys(baseEn),
      ...Object.keys(appEn),
      ...Object.keys(popupEn),
      ...Object.keys(itemsEn),
      ...Object.keys(contentEn),
    ].map((name) => name.toLowerCase())
    const names = Object.keys(extrasEn).map((name) => name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((name) => others.includes(name))).toEqual([])
  })

  it('writes French that is French, not English again', () => {
    const same = Object.entries(extrasEn)
      .filter(([name, text]) => (extrasFr as Record<string, string>)[name] === text)
      .map(([name]) => name)
      .sort()
    // Words that read the same in both languages
    expect(same).toEqual(['extras_admin', 'extras_kind_contact', 'extras_kind_note'])
  })

  it('keeps a message under what the browser takes for a name', () => {
    for (const name of Object.keys(extrasEn)) expect(name).toMatch(/^[A-Za-z0-9_]+$/)
  })
})

describe('MFA codes', () => {
  // What a code is called besides an MFA code: a QR code, a backup code, a card's security code, a postal code
  const named = /(QR codes?|[Bb]ackup codes?|[Ss]ecurity codes?|[Pp]ostal codes?|MFA codes?)/g
  const frenchNamed =
    /(QR codes?|codes? de secours|codes? de sécurité|codes? postal|codes? PIN|codes? MFA|code QR)/gi

  it('are never called a plain code in English', () => {
    const plain = Object.entries({ ...popupEn, ...itemsEn, ...extrasEn })
      .filter(([, text]) => /\bcodes?\b/i.test(text.replace(named, '')))
      .map(([name]) => name)
    expect(plain).toEqual([])
  })

  it('are never called a plain code in French', () => {
    const plain = Object.entries({ ...popupFr, ...itemsFr, ...extrasFr })
      .filter(([, text]) => /\bcodes?\b/i.test(text.replace(frenchNamed, '')))
      .map(([name]) => name)
    expect(plain).toEqual([])
  })
})

describe('MFA codes in the other parts', () => {
  const part = (name: string, lang: 'en' | 'fr'): Record<string, string> =>
    JSON.parse(
      readFileSync(join(src, '..', 'locales', 'parts', `${name}.${lang}.json`), 'utf8'),
    ) as Record<string, string>

  // What means a two-step code, by part and name (a backup, security or postal code keeps its own word)
  const renamed: Record<string, string[]> = {
    background: ['bgMenuFillCode', 'bgClipboardJustification'],
    content: ['menu_empty_codes'],
    spaces: ['spaces_kindCode'],
    account: ['account_move_kind_otp', 'account_move_kind_keyotp'],
    transfer: ['transfer_kind_codes', 'transfer_sample_code'],
    tools: ['tools_breachEntryCode', 'tools_reason_sameCode', 'tools_reorderCodes'],
    setup: ['setup_place_lead', 'setup_next_open'],
  }

  it('say MFA code wherever the string means a two-step code', () => {
    for (const [name, keys] of Object.entries(renamed))
      for (const lang of ['en', 'fr'] as const)
        for (const key of keys)
          expect(part(name, lang)[key], `${name}.${lang} ${key}`).toMatch(/\bMFA\b/)
  })
})
