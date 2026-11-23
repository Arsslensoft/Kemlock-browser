import { describe, expect, it } from 'vitest'
import { frameAddress, identifySender, originOf } from './senders'

describe('originOf', () => {
  it("gives an extension address's origin, which the URL standard calls null", () => {
    expect(new URL('chrome-extension://kemlockid/src/popup/index.html').origin).toBe('null')
    expect(originOf(new URL('chrome-extension://kemlockid/src/popup/index.html'))).toBe(
      'chrome-extension://kemlockid',
    )
    expect(originOf(new URL('moz-extension://1b2c3d/src/setup/index.html'))).toBe(
      'moz-extension://1b2c3d',
    )
    expect(originOf(new URL('https://accounts.orbit-cloud.com:8443/sign-in'))).toBe(
      'https://accounts.orbit-cloud.com:8443',
    )
  })
})

describe('frameAddress', () => {
  it("is the frame's own address, or the web origin an address-less frame inherits", () => {
    expect(
      frameAddress({
        url: 'https://accounts.orbit-cloud.com/sign-in',
        origin: 'https://x.example',
      }),
    ).toBe('https://accounts.orbit-cloud.com/sign-in')
    expect(frameAddress({ url: 'about:blank', origin: 'https://shop.example' })).toBe(
      'https://shop.example/',
    )
    expect(frameAddress({ url: 'about:blank', origin: null })).toBeNull()
    expect(frameAddress({ url: 'data:text/html,<input>', origin: null })).toBeNull()
    expect(frameAddress({ url: 'about:srcdoc', origin: 'chrome-extension://abc' })).toBeNull()
    expect(frameAddress({ url: 'not a url', origin: null })).toBeNull()
  })
})

describe('identifySender', () => {
  it('recognises the popup by its extension origin', () => {
    expect(
      identifySender(
        { id: 'kemlockid', url: 'chrome-extension://kemlockid/src/popup/index.html' },
        { id: 'kemlockid', origins: ['chrome-extension://kemlockid'] },
      ),
    ).toEqual({ from: 'page', page: 'popup', tabId: undefined, frameId: undefined })
  })
})
