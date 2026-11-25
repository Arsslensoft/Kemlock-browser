import { describe, expect, it } from 'vitest'
import { fileNameOnly, findSendLink, hostOfLink, originPatternOf } from './links'

const access = 'AQIDBAUGBwgJCgsMDQ4PEA'
const key = 'A'.repeat(43)
const link = `https://vault.example.com/#/send/${access}/${key}`

describe('a Send link in text', () => {
  it('is found whole, or in a message', () => {
    expect(findSendLink(link)).toBe(link)
    expect(findSendLink(`Here you go: <${link}>. Cheers`)).toBe(link)
    expect(findSendLink(`see "${link}"`)).toBe(link)
  })

  it('is found under a path, with a port', () => {
    const under = `https://example.com:8443/kemlock/#/send/${access}/${key}`
    expect(findSendLink(under)).toBe(under)
  })

  it('is the first link, with nothing after its key, and one that is no longer than its key', () => {
    const other = `https://other.example/#/send/${access}/${'B'.repeat(43)}`
    expect(findSendLink(`${link} and ${other}`)).toBe(link)
    // A key that goes on is not a key of either length
    expect(findSendLink(`${link}A`)).toBeNull()
    expect(findSendLink(`https://vault.example.com/#/send/${access}/${'A'.repeat(30)}`)).toBeNull()
    expect(findSendLink(`https://vault.example.com/#/send/${access}A/${key}`)).toBeNull()
    // A Bitwarden Send's key is 22 characters
    const bitwarden = `https://vault.example.com/#/send/${access}/${'A'.repeat(22)}`
    expect(findSendLink(bitwarden)).toBe(bitwarden)
    // No second `#` inside what comes before the first
    expect(findSendLink(`https://a.example/#x#/send/${access}/${key}`)).toBeNull()
  })

  it('is not an http link, a page, or a fragment that is not a Send', () => {
    expect(findSendLink(link.replace('https', 'http'))).toBeNull()
    expect(findSendLink('https://vault.example.com/')).toBeNull()
    expect(findSendLink(`https://vault.example.com/#/vault/${access}/${key}`)).toBeNull()
    expect(findSendLink('nothing here')).toBeNull()
  })
})

describe('the access a link needs', () => {
  it('is its host, without the port a match pattern has none for', () => {
    expect(originPatternOf(link)).toBe('https://vault.example.com/*')
    expect(originPatternOf(`https://example.com:8443/#/send/${access}/${key}`)).toBe(
      'https://example.com/*',
    )
    expect(hostOfLink(`https://example.com:8443/#/send/${access}/${key}`)).toBe('example.com:8443')
  })

  it('is none for what is not an https address', () => {
    expect(originPatternOf('http://vault.example.com/')).toBeNull()
    expect(originPatternOf('not a link')).toBeNull()
    expect(hostOfLink('not a link')).toBe('')
  })
})

describe('a name the sender chose', () => {
  it('stays a name: no path, no control characters, no leading dots', () => {
    expect(fileNameOnly('scan.pdf')).toBe('scan.pdf')
    expect(fileNameOnly('../../etc/passwd')).toBe('passwd')
    expect(fileNameOnly('C:\\Users\\sam\\notes.txt')).toBe('notes.txt')
    expect(fileNameOnly('a\u0000b\u001f.txt')).toBe('ab.txt')
    expect(fileNameOnly('.bashrc')).toBe('bashrc')
    expect(fileNameOnly('re<po>rt?.txt')).toBe('report.txt')
  })

  it('has no backslash and no control that reorders the text it is shown in', () => {
    expect(fileNameOnly('a\\b.txt')).toBe('b.txt')
    expect(fileNameOnly('\\\\server\\share\\x.txt')).toBe('x.txt')
    // Right-to-left override: "photo" + RLO + "gpj.exe" reads as "photoexe.jpg"
    expect(fileNameOnly('photo\u202egpj.exe')).toBe('photogpj.exe')
    for (const mark of [
      '\u200e',
      '\u200f',
      '\u202a',
      '\u202b',
      '\u202c',
      '\u202d',
      '\u202e',
      '\u2066',
      '\u2067',
      '\u2068',
      '\u2069',
    ])
      expect(fileNameOnly(`a${mark}b.txt`)).toBe('ab.txt')
  })

  it('is "send" when nothing is left, and is cut when long', () => {
    expect(fileNameOnly('')).toBe('send')
    expect(fileNameOnly('/')).toBe('send')
    expect(fileNameOnly('...')).toBe('send')
    expect(fileNameOnly('x'.repeat(500))).toHaveLength(200)
  })
})
