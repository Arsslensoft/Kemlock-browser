import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import appEn from '../../../locales/app/en.json'
import baseEn from '../../../locales/en.json'
import popupEn from '../../../locales/parts/popup.en.json'
import toolsEn from '../../../locales/parts/tools.en.json'
import toolsFr from '../../../locales/parts/tools.fr.json'

const src = fileURLToPath(new URL('../..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.|testing\./.test(entry.name) ? [path] : []
  })
}

const used = new Set(
  sources(src).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/['"`](tools_[A-Za-z0-9_]+)['"`]/g)].map((m) => m[1]!),
  ),
)

// Names built in code: the reasons a group matched (src/shared/tools-api.ts), and the fields a merge picks between
// (`mergeFieldsOf` in Kemlock-core's duplicate_merge.dart).
const dynamic = [
  'sameSignIn',
  'sameAccount',
  'sameCode',
  'samePasskey',
  'sameCard',
  'sameNote',
  'sameFile',
  'sameKey',
  'sameCodes',
  'sameIdentity',
  'inTwoPlaces',
]
  .map((reason) => `tools_reason_${reason}`)
  .concat(
    [
      'name',
      'username',
      'password',
      'note',
      'issuer',
      'label',
      'title',
      'text',
      'service',
      'cardholder',
    ].map((field) => `tools_field_${field}`),
  )

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('the vault tools’ strings', () => {
  it('have every string the tools ask for, in English and in French', () => {
    const missing = [...used, ...dynamic].filter((name) => !(name in toolsEn) || !(name in toolsFr))
    expect(missing).toEqual([])
  })

  it('have no string the tools never ask for', () => {
    const wanted = new Set([...used, ...dynamic])
    expect(Object.keys(toolsEn).filter((name) => !wanted.has(name))).toEqual([])
  })

  it('are the same in both languages, with the same placeholders', () => {
    expect(Object.keys(toolsFr).sort()).toEqual(Object.keys(toolsEn).sort())
    for (const [name, text] of Object.entries(toolsEn))
      expect(placeholders((toolsFr as Record<string, string>)[name]!), name).toEqual(
        placeholders(text),
      )
  })

  it('keep the order of their placeholders in both languages, since a value goes by its place', () => {
    for (const [name, text] of Object.entries(toolsEn)) {
      const english = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      const french = [...(toolsFr as Record<string, string>)[name]!.matchAll(/\{(\w+)\}/g)].map(
        (m) => m[1],
      )
      // The first appearance of each name decides which value it takes
      expect([...new Set(french)], name).toEqual([...new Set(english)])
    }
  })

  it('share no name with the rest of the extension, case aside', () => {
    const others = [...Object.keys(baseEn), ...Object.keys(appEn), ...Object.keys(popupEn)].map(
      (name) => name.toLowerCase(),
    )
    const names = Object.keys(toolsEn).map((name) => name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((name) => others.includes(name))).toEqual([])
  })

  it('are French that is French, not English again, but for names and numbers', () => {
    const same = Object.entries(toolsEn)
      .filter(([name, text]) => (toolsFr as Record<string, string>)[name] === text)
      .map(([name]) => name)
      .sort()
    expect(same).toEqual([
      'tools_field_note',
      'tools_field_service',
      'tools_serviceName',
      'tools_serviceNamePlaceholder',
    ])
  })

  it('say nothing of a price', () => {
    const premium = /premium|paywall|upgrade|subscri|purchase|unlock more/i
    for (const text of [...Object.values(toolsEn), ...Object.values(toolsFr)])
      expect(text).not.toMatch(premium)
  })
})
