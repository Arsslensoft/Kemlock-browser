import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import appEn from '../../locales/app/en.json'
import baseEn from '../../locales/en.json'
import contentEn from '../../locales/parts/content.en.json'
import itemsEn from '../../locales/parts/items.en.json'
import itemsFr from '../../locales/parts/items.fr.json'
import popupEn from '../../locales/parts/popup.en.json'

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
    [
      ...readFileSync(file, 'utf8').matchAll(
        /['"`]((?:items_|bgMenuFill(?:Card|Identity))[A-Za-z0-9_]*)['"`]/g,
      ),
    ]
      .map((m) => m[1]!)
      // The names built in code: a prefix and the kind it is for
      .filter((name) => !name.endsWith('_')),
  ),
)

const dynamic = [
  ...['driversLicence', 'idCard', 'other', 'passport', 'taxNumber'].map(
    (type) => `items_doc_${type}`,
  ),
  ...['notes', 'cards', 'identities'].flatMap((kind) => [
    `items_new_${kind}`,
    `items_none_${kind}`,
  ]),
]

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('the strings of notes, cards and identities', () => {
  it('has every string the extension asks for, in English and in French', () => {
    const missing = [...used, ...dynamic].filter((name) => !(name in itemsEn) || !(name in itemsFr))
    expect(missing).toEqual([])
  })

  it('has no string the extension never asks for', () => {
    const wanted = new Set([...used, ...dynamic])
    expect(Object.keys(itemsEn).filter((name) => !wanted.has(name))).toEqual([])
  })

  it('has the same strings in both languages, with the same placeholders', () => {
    expect(Object.keys(itemsFr).sort()).toEqual(Object.keys(itemsEn).sort())
    for (const [name, text] of Object.entries(itemsEn))
      expect(placeholders((itemsFr as Record<string, string>)[name]!), name).toEqual(
        placeholders(text),
      )
  })

  it('has no name the build would see twice, case aside', () => {
    const others = [
      ...Object.keys(baseEn),
      ...Object.keys(appEn),
      ...Object.keys(popupEn),
      ...Object.keys(contentEn),
    ].map((name) => name.toLowerCase())
    const names = Object.keys(itemsEn).map((name) => name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((name) => others.includes(name))).toEqual([])
  })

  it('writes French that is French, not English again', () => {
    const same = Object.entries(itemsEn)
      .filter(([name, text]) => (itemsFr as Record<string, string>)[name] === text)
      .map(([name]) => name)
      .sort()
    // Words that read the same in both languages
    expect(same).toEqual([
      'items_document',
      'items_documentN',
      'items_documents',
      'items_fieldDocumentType',
      'items_fieldNote',
      'items_noteLabel',
      'items_notes',
    ])
  })

  it('keeps a message under what the browser takes for a name', () => {
    for (const name of Object.keys(itemsEn)) expect(name).toMatch(/^[A-Za-z0-9_]+$/)
  })
})
