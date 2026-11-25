import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import appEn from '../../locales/app/en.json'
import baseEn from '../../locales/en.json'
import popupEn from '../../locales/parts/popup.en.json'
import sendsEn from '../../locales/parts/sends.en.json'
import sendsFr from '../../locales/parts/sends.fr.json'

const src = join(import.meta.dirname, '..')
const fr = sendsFr as Record<string, string>

/** The code that asks for Sends strings: the Sends tab, the popup's Send pages, and what they share. */
function sources(): string[] {
  const own = [
    'shared/sends-text.ts',
    'shared/sends-fields.tsx',
    'popup/sends.tsx',
    'popup/send-page.tsx',
    'popup/note-page.tsx',
    'background/sends.ts',
  ]
  const tab = readdirSync(join(src, 'sends'))
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
    .map((file) => `sends/${file}`)
  return [...own, ...tab].map((file) => readFileSync(join(src, file), 'utf8'))
}

const code = sources().join('\n')
const asked = new Set([...code.matchAll(/'(sends_[A-Za-z0-9_]+)'/g)].map((match) => match[1]!))
// Names the code builds: sends_status_<status>
const dynamic = ['active', 'expired', 'usedUp', 'off', 'waitingForFile'].map(
  (status) => `sends_status_${status}`,
)

const placeholders = (text: string): string[] => [
  ...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)),
]

describe('the Sends strings', () => {
  it('are the same names in English and French', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(sendsEn).sort())
  })

  it('have a browser-legal name, `sends_` first, unique without regard to case or to other parts', () => {
    const names = Object.keys(sendsEn)
    for (const name of names) expect(name).toMatch(/^sends_[A-Za-z0-9_]+$/)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length)
    const others = [...Object.keys(baseEn), ...Object.keys(appEn), ...Object.keys(popupEn)].map(
      (name) => name.toLowerCase(),
    )
    expect(names.filter((name) => others.includes(name.toLowerCase()))).toEqual([])
  })

  it('keep the same placeholders in the same order in both languages, and no plural or select', () => {
    for (const [name, text] of Object.entries(sendsEn)) {
      expect(placeholders(fr[name]!), name).toEqual(placeholders(text))
      expect(text, name).not.toMatch(/\{\s*\w+\s*,/)
    }
  })

  it('include every name the code asks for, and every string is asked for', () => {
    const wanted = new Set([...asked, ...dynamic])
    expect([...wanted].filter((name) => !(name in sendsEn))).toEqual([])
    expect(Object.keys(sendsEn).filter((name) => !wanted.has(name))).toEqual([])
  })

  it('write French that is French, apart from what reads the same in both', () => {
    const same = Object.entries(sendsEn)
      .filter(([name, text]) => fr[name] === text)
      .map(([name]) => name)
      .sort()
    expect(same).toEqual([
      'sends_detailType',
      'sends_fileChosen',
      'sends_notes',
      'sends_receivedFile',
    ])
  })

  it('never promise a Premium: Kemlock is free', () => {
    for (const text of [...Object.values(sendsEn), ...Object.values(fr)])
      expect(text).not.toMatch(/premium|upgrade|paywall|subscri/i)
  })
})
