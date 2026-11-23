import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasApp } from './app.mjs'
import { localeMessages } from './build.mjs'
import {
  appLocales,
  languages,
  messageName,
  pickAppStrings,
  readAppStrings,
  toBrowserMessage,
} from './locales.mjs'

describe('locales/app', () => {
  it.skipIf(!hasApp)(
    "is what the app's en.json and fr.json give: run `npm run locales` after they change",
    async () => {
      const strings = await readAppStrings()
      for (const lang of languages) {
        const committed = JSON.parse(await readFile(join(appLocales, `${lang}.json`), 'utf8'))
        expect(committed, lang).toEqual(strings[lang])
      }
    },
  )

  it.skipIf(!hasApp)('holds every sync problem the app has, in both languages', async () => {
    const strings = await readAppStrings()
    expect(Object.keys(strings.en)).toContain('sync_problem_signedOut')
    expect(Object.keys(strings.en)).toContain('sync_problem_removals')
    expect(Object.keys(strings.fr)).toEqual(Object.keys(strings.en))
    expect(strings.fr.sync_problem_signedOut).not.toBe(strings.en.sync_problem_signedOut)
  })
})

describe('pickAppStrings', () => {
  it('takes the sync problems only', () => {
    const app = { 'sync.problem.auth': 'No', 'app.title': 'Kemlock', 'sync.sheet.title': 'Sync' }
    expect(pickAppStrings({ en: app, fr: { ...app, 'sync.problem.auth': 'Non' } })).toEqual({
      en: { sync_problem_auth: 'No' },
      fr: { sync_problem_auth: 'Non' },
    })
  })

  it("stops when English and French don't hold the same keys", () => {
    expect(() =>
      pickAppStrings({
        en: { 'sync.problem.auth': 'No', 'sync.problem.key': 'Key' },
        fr: { 'sync.problem.auth': 'Non' },
      }),
    ).toThrow(/sync\.problem\.key/)
  })
})

describe('messageName', () => {
  it("is the key with underscores, and refuses what the browser can't name", () => {
    expect(messageName('sync.problem.homeMissing')).toBe('sync_problem_homeMissing')
    expect(() => messageName('sync.problem.home-missing')).toThrow()
  })
})

describe('toBrowserMessage', () => {
  it('leaves plain text as it is', () => {
    expect(toBrowserMessage('The server didn’t accept it.')).toEqual({
      message: 'The server didn’t accept it.',
    })
  })

  it('numbers the placeholders in the order they first appear', () => {
    expect(toBrowserMessage('Saved {name} to {location}, {name}.')).toEqual({
      message: 'Saved $name$ to $location$, $name$.',
      placeholders: { name: { content: '$1' }, location: { content: '$2' } },
    })
  })

  it("doubles a dollar of the text, so the browser doesn't read it", () => {
    expect(toBrowserMessage('Costs $5 for {name}')).toEqual({
      message: 'Costs $$5 for $name$',
      placeholders: { name: { content: '$1' } },
    })
  })

  it("refuses plurals, selects and stray braces, which the browser can't express", () => {
    expect(() => toBrowserMessage('{count, plural, one {# code} other {# codes}}')).toThrow(
      /Plurals/,
    )
    expect(() => toBrowserMessage('{kind, select, a {A} other {B}}')).toThrow(/Plurals/)
    expect(() => toBrowserMessage('A { brace')).toThrow(/brace/)
  })
})

describe('localeMessages', () => {
  it("joins the extension's strings and the app's", () => {
    expect(localeMessages({ extName: 'Kemlock' }, { sync_problem_auth: 'No {name}' })).toEqual({
      extName: { message: 'Kemlock' },
      sync_problem_auth: { message: 'No $name$', placeholders: { name: { content: '$1' } } },
    })
  })

  it('stops on a name in both, whatever its case, as the browser ignores case', () => {
    expect(() => localeMessages({ sync_problem_auth: 'A' }, { sync_problem_auth: 'B' })).toThrow()
    expect(() => localeMessages({ Sync_Problem_Auth: 'A' }, { sync_problem_auth: 'B' })).toThrow()
  })
})
