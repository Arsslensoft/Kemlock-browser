import { describe, expect, it } from 'vitest'
import { acceptRelay, connectorUrl, otherAddress } from './securityKey'

const challenge = {
  domain: 'https://vault.example/',
  path: '/webauthn-fallback-connector.html',
  data: 'eyJjaGFsbGVuZ2UiOiJ4In0',
}

describe('connectorUrl', () => {
  it('opens the connector on the server with the challenge, this page as parent, v=1 and the locale', () => {
    const url = new URL(
      connectorUrl(challenge, 'chrome-extension://abc/src/setup/index.html', 'fr'),
    )
    expect(url.origin).toBe('https://vault.example')
    expect(url.pathname).toBe('/webauthn-fallback-connector.html')
    expect(url.searchParams.get('data')).toBe(challenge.data)
    expect(url.searchParams.get('parent')).toBe('chrome-extension://abc/src/setup/index.html')
    expect(url.searchParams.get('v')).toBe('1')
    expect(url.searchParams.get('locale')).toBe('fr')
  })
})

describe('otherAddress', () => {
  it("names the server's own address when it is not the one typed", () => {
    const other = { ...challenge, domain: 'https://vw.example' }
    expect(otherAddress('https://vault.example', other)).toBe('https://vw.example')
  })

  it('says nothing when the origins are the same', () => {
    expect(otherAddress('https://vault.example/sub', challenge)).toBeNull()
  })
})

describe('acceptRelay', () => {
  const origin = 'https://vault.example'
  const sender = { tab: { id: 7 }, url: 'https://vault.example/webauthn-fallback-connector.html?x' }
  const message = { kind: 'securityKeyResult', data: '{"id":"k"}', remember: true }

  it("takes the answer from the tab asked, on the server's origin", () => {
    expect(acceptRelay(message, sender, 7, origin)).toEqual({
      assertion: '{"id":"k"}',
      remember: true,
    })
  })

  it('takes nothing from another tab, another origin or another message', () => {
    expect(acceptRelay(message, { ...sender, tab: { id: 8 } }, 7, origin)).toBeNull()
    expect(
      acceptRelay(message, { tab: { id: 7 }, url: 'https://evil.example/' }, 7, origin),
    ).toBeNull()
    expect(acceptRelay(message, { tab: { id: 7 } }, 7, origin)).toBeNull()
    expect(acceptRelay({ ...message, kind: 'other' }, sender, 7, origin)).toBeNull()
    expect(acceptRelay({ ...message, data: 5 }, sender, 7, origin)).toBeNull()
    expect(acceptRelay({ ...message, data: '' }, sender, 7, origin)).toBeNull()
    expect(acceptRelay(null, sender, 7, origin)).toBeNull()
  })

  it('does not remember unless the page said so', () => {
    expect(acceptRelay({ ...message, remember: 'yes' }, sender, 7, origin)?.remember).toBe(false)
  })
})
