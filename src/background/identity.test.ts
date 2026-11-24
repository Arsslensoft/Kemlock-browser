import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { browserAuth, browserRedirectUrl } from './identity'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
})
afterEach(() => mock.uninstall())

describe('browserAuth', () => {
  it("shows the server's page and gives the address it ended on", async () => {
    mock.authReply = 'https://kemlockid.chromiumapp.org/?code=abc&state=xyz'
    expect(await browserAuth('https://k.example/sso?x=1')).toBe(mock.authReply)
    expect(mock.authCalls).toEqual([{ url: 'https://k.example/sso?x=1', interactive: true }])
    expect(browserRedirectUrl()).toBe('https://kemlockid.chromiumapp.org/')
  })

  it('refuses an address that is not secure or not an address, without opening anything', async () => {
    await expect(browserAuth('http://k.example/sso')).rejects.toMatchObject({ code: 'badRequest' })
    await expect(browserAuth('javascript:alert(1)')).rejects.toMatchObject({ code: 'badRequest' })
    await expect(browserAuth('nope')).rejects.toMatchObject({ code: 'badRequest' })
    expect(mock.authCalls).toEqual([])
  })

  it('says cancelled when the window closes or answers nothing', async () => {
    mock.authReply = new Error('The user did not approve access.')
    await expect(browserAuth('https://k.example/sso')).rejects.toMatchObject({ code: 'cancelled' })
    mock.authReply = undefined
    await expect(browserAuth('https://k.example/sso')).rejects.toMatchObject({ code: 'cancelled' })
  })
})
