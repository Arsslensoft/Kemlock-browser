import { describe, expect, it } from 'vitest'
import { originOf, parseAddress } from './address'

describe('parseAddress', () => {
  it('takes an https address and keeps its path without the trailing slash', () => {
    expect(parseAddress('https://dav.example/kemlock/')).toEqual({
      ok: true,
      address: 'https://dav.example/kemlock',
      host: 'dav.example',
      pattern: 'https://dav.example/*',
    })
  })

  it('takes a bare host as https, and asks for the host without its port', () => {
    expect(parseAddress(' vault.example:8443 ')).toEqual({
      ok: true,
      address: 'https://vault.example:8443',
      host: 'vault.example:8443',
      pattern: 'https://vault.example/*',
    })
  })

  it('refuses http', () => {
    expect(parseAddress('http://vault.example')).toEqual({ ok: false, reason: 'insecure' })
    expect(parseAddress('HTTP://vault.example')).toEqual({ ok: false, reason: 'insecure' })
  })

  it('refuses what is not an address', () => {
    for (const text of [
      '',
      '   ',
      'ftp://vault.example',
      'https://user:pw@vault.example',
      'https://',
    ]) {
      expect(parseAddress(text)).toEqual({ ok: false, reason: 'invalid' })
    }
  })
})

describe('originOf', () => {
  it('names the origin, or nothing', () => {
    expect(originOf('https://vault.example/vault')).toBe('https://vault.example')
    expect(originOf('nope')).toBeNull()
  })
})
