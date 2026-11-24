import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname
const root = join(here, '..', '..')
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>
const en = read('locales/parts/setup.en.json')
const fr = read('locales/parts/setup.fr.json')
const app = read('locales/app/en.json')

const sources = readdirSync(here)
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
  .map((file) => readFileSync(join(here, file), 'utf8'))
  .join('\n')

// Names built in code, like `setup_method_${method}`
const dynamic = [
  ...['veryweak', 'weak', 'fair', 'strong', 'verystrong'].map((l) => `setup_strength_${l}`),
  ...['length', 'uppercase', 'lowercase', 'number', 'special'].map((c) => `setup_check_${c}`),
  ...['kemlock', 'webdav', 'vaultwarden'].flatMap((p) => [
    `setup_place_${p}_body`,
    `setup_form_title_${p}`,
    `setup_form_lead_${p}`,
  ]),
  ...['kemlock', 'vaultwarden'].map((p) => `setup_form_master_${p}`),
  ...['authenticator', 'email', 'yubikey', 'securityKey', 'apiKey', 'duo'].map(
    (m) => `setup_method_${m}`,
  ),
  ...['authenticator', 'email', 'yubikey', 'apiKey'].map((m) => `setup_method_${m}_hint`),
  ...['setup_items', 'setup_first_adds', 'setup_first_removes'].flatMap((n) => [
    `${n}_one`,
    `${n}_other`,
  ]),
]
// Asked for by their base name, with _one or _other added by tCount
const counted = ['setup_items', 'setup_first_adds', 'setup_first_removes']

describe('the setup strings', () => {
  it('are the same names in English and French', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  it('have a browser-legal name, unique without regard to case', () => {
    const names = Object.keys(en)
    for (const name of names) expect(name).toMatch(/^setup_[A-Za-z0-9_]+$/)
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length)
  })

  it('keep the same placeholders in the same order in both languages', () => {
    const names = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
    for (const [name, text] of Object.entries(en))
      expect(names(fr[name]), name).toEqual(names(text))
  })

  it('include every name the code asks for', () => {
    const asked = [...sources.matchAll(/'((?:setup|sync_problem)_[A-Za-z0-9_]+)'/g)].map(
      (m) => m[1],
    )
    for (const name of new Set(asked)) {
      expect(name in en || name in app || counted.includes(name), name).toBe(true)
    }
    for (const name of dynamic) expect(name in en, name).toBe(true)
  })
})
