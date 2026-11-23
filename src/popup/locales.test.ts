import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import appEn from '../../locales/app/en.json'
import baseEn from '../../locales/en.json'
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
  [...sources(join(src, 'popup')), ...sources(join(src, 'shared', 'ui'))].flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/['"`](popup_[A-Za-z0-9]+)['"`]/g)].map((m) => m[1]!),
  ),
)

// Names built in code: popup_lockAfter<minutes> and popup_strength<0 to 4>.
const dynamic = [1, 5, 15, 60]
  .map((minutes) => `popup_lockAfter${minutes}`)
  .concat([0, 1, 2, 3, 4].map((level) => `popup_strength${level}`))

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('the popup’s strings', () => {
  it('has every string the popup asks for, in English and in French', () => {
    const missing = [...used, ...dynamic].filter((name) => !(name in popupEn) || !(name in popupFr))
    expect(missing).toEqual([])
  })

  it('has no string the popup never asks for', () => {
    const wanted = new Set([...used, ...dynamic])
    expect(Object.keys(popupEn).filter((name) => !wanted.has(name))).toEqual([])
  })

  it('has the same strings in both languages, with the same placeholders', () => {
    expect(Object.keys(popupFr).sort()).toEqual(Object.keys(popupEn).sort())
    for (const [name, text] of Object.entries(popupEn))
      expect(placeholders((popupFr as Record<string, string>)[name]!), name).toEqual(
        placeholders(text),
      )
  })

  it('has no name the build would see twice, case aside', () => {
    const others = [...Object.keys(baseEn), ...Object.keys(appEn)].map((name) => name.toLowerCase())
    const names = Object.keys(popupEn).map((name) => name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((name) => others.includes(name))).toEqual([])
  })

  it('writes French that is French, not English again', () => {
    const same = Object.entries(popupEn)
      .filter(([name, text]) => (popupFr as Record<string, string>)[name] === text)
      .map(([name]) => name)
      .sort()
    // Names and numbers that read the same in both languages.
    expect(same).toEqual([
      'popup_codes',
      'popup_fieldNote',
      'popup_lockAfter1',
      'popup_lockAfter15',
      'popup_lockAfter5',
      'popup_placeKemlock',
      'popup_placeVaultwarden',
      'popup_placeWebdav',
      'popup_removalKindCode',
      'popup_removalKindContact',
      'popup_removalKindNote',
    ])
  })
})
