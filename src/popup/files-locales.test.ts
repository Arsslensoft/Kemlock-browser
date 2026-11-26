import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import appEn from '../../locales/app/en.json'
import baseEn from '../../locales/en.json'
import filesEn from '../../locales/parts/files.en.json'
import filesFr from '../../locales/parts/files.fr.json'

const src = join(import.meta.dirname, '..')
const parts = join(import.meta.dirname, '..', '..', 'locales', 'parts')
const fr = filesFr as Record<string, string>

/** The code that asks for the files strings: the files tab, the pages and rows of files, the note's attachments, and Home. */
function sources(): string[] {
  const own = [
    'popup/file-actions.ts',
    'popup/file-edit.tsx',
    'popup/file-page.tsx',
    'popup/files-rows.tsx',
    'popup/home.tsx',
    'popup/note-page.tsx',
  ]
  const tab = readdirSync(join(src, 'files'))
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
    .map((file) => `files/${file}`)
  return [...own, ...tab].map((file) => readFileSync(join(src, file), 'utf8'))
}

const code = sources().join('\n')
const asked = new Set([...code.matchAll(/'(files_[A-Za-z0-9_]+)'/g)].map((match) => match[1]!))
// Names the code builds: files_kind_<family> and files_error_<code>
const dynamic = [
  ...['audio', 'image', 'text', 'video'].map((kind) => `files_kind_${kind}`),
  ...['lost', 'tooLarge', 'tooMany'].map((error) => `files_error_${error}`),
]

const placeholders = (text: string): string[] => [
  ...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)),
]

/** The names of every other part of the strings. */
function otherNames(): string[] {
  const others = readdirSync(parts)
    .filter((file) => file.endsWith('.en.json') && file !== 'files.en.json')
    .flatMap((file) =>
      Object.keys(JSON.parse(readFileSync(join(parts, file), 'utf8')) as Record<string, string>),
    )
  return [...others, ...Object.keys(baseEn), ...Object.keys(appEn)].map((name) =>
    name.toLowerCase(),
  )
}

describe('the files strings', () => {
  it('are the same names in English and French', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(filesEn).sort())
  })

  it('have a browser-legal name, `files_` first, unique without regard to case or to other parts', () => {
    const names = Object.keys(filesEn)
    for (const name of names) expect(name).toMatch(/^files_[A-Za-z0-9_]+$/)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length)
    const others = otherNames()
    expect(names.filter((name) => others.includes(name.toLowerCase()))).toEqual([])
  })

  it('keep the same placeholders in the same order in both languages, and no plural or select', () => {
    for (const [name, text] of Object.entries(filesEn)) {
      expect(placeholders(fr[name]!), name).toEqual(placeholders(text))
      expect(text, name).not.toMatch(/\{\s*\w+\s*,/)
    }
  })

  it('include every name the code asks for, and every string is asked for', () => {
    const wanted = new Set([...asked, ...dynamic])
    expect([...wanted].filter((name) => !(name in filesEn))).toEqual([])
    expect(Object.keys(filesEn).filter((name) => !wanted.has(name))).toEqual([])
  })

  it('write French that is French, apart from what reads the same in both', () => {
    const same = Object.entries(filesEn)
      .filter(([name, text]) => fr[name] === text)
      .map(([name]) => name)
      .sort()
    expect(same).toEqual([
      'files_fieldNotes',
      'files_kind_audio',
      'files_kind_image',
      'files_labelNotes',
      'files_labelType',
    ])
  })

  it('say Kemlock Server where files need it, and never promise a Premium: Kemlock is free', () => {
    expect(filesEn.files_needSync).toBe('Files need Kemlock Server sync')
    expect(fr.files_needSync).toContain('Kemlock Server')
    for (const text of [...Object.values(filesEn), ...Object.values(fr)])
      expect(text).not.toMatch(/premium|upgrade|paywall|subscri/i)
  })
})
