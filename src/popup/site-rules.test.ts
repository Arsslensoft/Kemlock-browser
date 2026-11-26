// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { rulesOf, sameSites, siteProblem, siteRowsOf, type SiteRow } from './site-rules'

// The message is its own name here: a problem is "extras_siteBad" or "extras_siteBadRegex", no problem is undefined
beforeEach(() => {
  Object.assign(globalThis, { chrome: { i18n: { getMessage: (name: string) => name } } })
})

const row = (uri: string, match: SiteRow['match'] = 'domain'): SiteRow => ({ uri, match })

describe('what a website may be', () => {
  it('takes a host, a web address, a host with a port and an app’s package name', () => {
    for (const uri of [
      'github.com',
      'https://github.com/login',
      'http://localhost:8080/app',
      'localhost:8080',
      'intranet.local:8443/app',
      '192.168.1.5:8080',
      'androidapp://com.example.app',
      'iosapp://com.example.app',
      '',
    ])
      expect(siteProblem(row(uri)), uri).toBeUndefined()
  })

  it('looks at the scheme first: javascript and the like are refused even when dressed as a host and a port', () => {
    for (const uri of [
      'javascript:alert(1)',
      'javascript:1/alert(1)',
      'JavaScript:1',
      'data:1/x',
      'file:///etc/passwd',
      'vbscript:1',
      'intranet:8080',
      'ftp://example.com',
      'with space.com',
    ])
      expect(siteProblem(row(uri)), uri).toBe('extras_siteBad')
  })

  it('wants a regular expression to be one, and leaves its text alone otherwise', () => {
    expect(siteProblem(row('a(b', 'regex'))).toBe('extras_siteBadRegex')
    expect(siteProblem(row('javascript:.*', 'regex'))).toBeUndefined()
  })
})

describe('the rows of a login', () => {
  it('start from its rules, also when it has no plain website to go with them', () => {
    const login = {
      websites: [],
      websiteRules: [{ uri: '^https://orbit', match: 'regex' as const }],
    }
    expect(siteRowsOf(login)).toEqual([{ uri: '^https://orbit', match: 'regex' }])
    expect(rulesOf(login)).toEqual(login.websiteRules)
  })

  it('start from its websites on the default rule when it has no rules, and from one empty row when it has neither', () => {
    expect(siteRowsOf({ websites: ['github.com'], websiteRules: [] })).toEqual([
      { uri: 'github.com', match: 'default' },
    ])
    expect(siteRowsOf({ websites: [], websiteRules: [] })).toEqual([{ uri: '', match: 'domain' }])
    expect(siteRowsOf(undefined, ['new.example'])).toEqual([
      { uri: 'new.example', match: 'domain' },
    ])
  })

  it('say whether they are what the login holds, a blank row aside', () => {
    const login = {
      websites: ['github.com'],
      websiteRules: [{ uri: 'github.com', match: 'host' as const }],
    }
    expect(sameSites(siteRowsOf(login), login)).toBe(true)
    expect(sameSites([...siteRowsOf(login), row('')], login)).toBe(true)
    expect(sameSites([row('github.com', 'domain')], login)).toBe(false)
    expect(sameSites([row('github.com', 'host'), row('gitlab.com')], login)).toBe(false)
    expect(sameSites([row('')], { websites: [], websiteRules: [] })).toBe(true)
  })
})
