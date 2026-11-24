import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { browserHooks } from './browser-hooks'
import { assertionJson, connectorAddress, passkeyAssertion, readAnswer } from './passkey'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'

const encode = (value: unknown): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = (text: string): unknown =>
  JSON.parse(
    atob(
      text
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(text.length / 4) * 4, '='),
    ),
  )

const redirect = 'https://kemlockid.chromiumapp.org/'
const asked = JSON.stringify({
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'k.example',
  credentialIds: ['Y3JlZDE'],
  userVerification: 'preferred',
  prfInput: 'cHJm',
})
const credential = {
  id: 'Y3JlZDE',
  rawId: 'Y3JlZDE',
  type: 'public-key',
  response: {
    authenticatorData: 'YXV0aA',
    clientDataJSON: 'Y2xpZW50',
    signature: 'c2ln',
    userHandle: 'dXNlcg',
  },
  clientExtensionResults: {},
}

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
})
afterEach(() => mock.uninstall())

type Flow = (arg: { url: string; interactive: boolean }) => Promise<string>

/** What the connector page sends back: the flow ends on our redirect with `#result=...&state=...`. */
const answering =
  (body: (state: string) => unknown, ending = redirect): Flow =>
  async ({ url, interactive }) => {
    mock.authCalls.push({ url, interactive })
    const state = new URLSearchParams(new URL(url).hash.slice(1)).get('state') ?? ''
    return `${ending}#result=${encode(body(state))}&state=${state}`
  }
const useFlow = (flow: Flow) => {
  ;(mock.chrome.identity as unknown as { launchWebAuthFlow: Flow }).launchWebAuthFlow = flow
}
const stateOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('state')

describe("the connector page's address", () => {
  it("is the server's own, with the request, a state and this extension's redirect in the fragment", () => {
    const address = connectorAddress(
      'https://k.example/some/path',
      { challenge: 'abc', rpId: 'k.example', credentialIds: ['id1'], userVerification: 'required' },
      'st4te',
    )
    const url = new URL(address)
    expect(url.origin + url.pathname).toBe('https://k.example/kem/v1/webauthn')
    expect(url.search).toBe('')
    const params = new URLSearchParams(url.hash.slice(1))
    expect(params.get('state')).toBe('st4te')
    expect(params.get('redirect')).toBe(redirect)
    // PRF is asked for: the connector adds it unless prf=0
    expect(params.has('prf')).toBe(false)
    expect(decode(params.get('options')!)).toEqual({
      challenge: 'abc',
      rpId: 'k.example',
      allowCredentials: [{ type: 'public-key', id: 'id1' }],
      userVerification: 'required',
      timeout: 120000,
    })
  })

  it('is refused for an address that is not secure', () => {
    expect(() =>
      connectorAddress('http://k.example', { challenge: 'a', rpId: 'r', credentialIds: [] }, 's'),
    ).toThrow(expect.objectContaining({ code: 'badRequest' }))
  })
})

describe('the answer', () => {
  const ok = (state: string) => ({ state, credential, prf: 'cHJmb3V0' })

  it('is taken from our own redirect address, for our state', () => {
    const redirected = `${redirect}#result=${encode(ok('s1'))}&state=s1`
    expect(readAnswer(redirected, 's1')).toEqual({ credential, prf: 'cHJmb3V0' })
  })

  it('is refused for another state, in the address or in the answer', () => {
    const failed = expect.objectContaining({ code: 'failed' })
    expect(() => readAnswer(`${redirect}#result=${encode(ok('s1'))}&state=s1`, 's2')).toThrow(
      failed,
    )
    expect(() => readAnswer(`${redirect}#result=${encode(ok('other'))}&state=s1`, 's1')).toThrow(
      failed,
    )
    expect(() => readAnswer(`${redirect}#result=${encode(ok('s1'))}`, 's1')).toThrow(failed)
  })

  it('is refused from any address that is not ours', () => {
    const failed = expect.objectContaining({ code: 'failed' })
    const result = `#result=${encode(ok('s1'))}&state=s1`
    expect(() => readAnswer(`https://evil.example/${result}`, 's1')).toThrow(failed)
    expect(() => readAnswer(`https://other.chromiumapp.org/${result}`, 's1')).toThrow(failed)
  })

  it('says cancelled for a dismissed prompt and failed for anything else the page reports', () => {
    const said = (error: string) => `${redirect}#result=${encode({ state: 's1', error })}&state=s1`
    expect(() => readAnswer(said('cancelled'), 's1')).toThrow(
      expect.objectContaining({ code: 'cancelled' }),
    )
    expect(() => readAnswer(said('unavailable'), 's1')).toThrow(
      expect.objectContaining({ code: 'failed' }),
    )
  })

  it('is refused when it is not JSON or holds no credential', () => {
    const failed = expect.objectContaining({ code: 'failed' })
    expect(() => readAnswer(`${redirect}#result=!!!&state=s1`, 's1')).toThrow(failed)
    expect(() =>
      readAnswer(`${redirect}#result=${encode({ state: 's1' })}&state=s1`, 's1'),
    ).toThrow(failed)
  })

  it('becomes the assertion the core reads, with the PRF output when there is one', () => {
    expect(JSON.parse(assertionJson({ credential, prf: 'cHJmb3V0' }))).toEqual({
      credentialId: 'Y3JlZDE',
      authenticatorData: 'YXV0aA',
      clientData: 'Y2xpZW50',
      signature: 'c2ln',
      userHandle: 'dXNlcg',
      prfOutput: 'cHJmb3V0',
    })
    const { userHandle: _handle, ...response } = credential.response
    const bare = JSON.parse(assertionJson({ credential: { ...credential, response } })) as Record<
      string,
      unknown
    >
    expect(bare).not.toHaveProperty('prfOutput')
    expect(bare).not.toHaveProperty('userHandle')
    expect(() => assertionJson({ credential: { rawId: 'x' } })).toThrow()
  })
})

describe('the passkeyAssertion hook', () => {
  it("opens the server's connector through the identity flow and gives the assertion", async () => {
    useFlow(answering((state) => ({ state, credential, prf: 'cHJmb3V0' })))
    const json = await passkeyAssertion(asked, 'https://k.example/')
    expect(JSON.parse(json!)).toMatchObject({ credentialId: 'Y3JlZDE', prfOutput: 'cHJmb3V0' })
    expect(mock.authCalls).toHaveLength(1)
    expect(mock.authCalls[0]).toMatchObject({ interactive: true })
    expect(mock.authCalls[0]!.url.startsWith('https://k.example/kem/v1/webauthn#options=')).toBe(
      true,
    )
  })

  it('answers null when the window is closed or the prompt dismissed', async () => {
    mock.authReply = new Error('The user did not approve access.')
    expect(await passkeyAssertion(asked, 'https://k.example')).toBeNull()
    useFlow(answering((state) => ({ state, error: 'cancelled' })))
    expect(await passkeyAssertion(asked, 'https://k.example')).toBeNull()
  })

  it('fails on an answer for another state, or from another address, and on bad options', async () => {
    const failed = { code: 'failed' }
    useFlow(answering(() => ({ state: 'not-ours', credential })))
    await expect(passkeyAssertion(asked, 'https://k.example')).rejects.toMatchObject(failed)
    useFlow(answering((state) => ({ state, credential }), 'https://evil.example/'))
    await expect(passkeyAssertion(asked, 'https://k.example')).rejects.toMatchObject(failed)
    await expect(passkeyAssertion('{}', 'https://k.example')).rejects.toMatchObject({
      code: 'badRequest',
    })
    await expect(passkeyAssertion('nope', 'https://k.example')).rejects.toMatchObject({
      code: 'badRequest',
    })
  })

  it('uses a different state every time', async () => {
    useFlow(answering((state) => ({ state, credential })))
    await passkeyAssertion(asked, 'https://k.example')
    await passkeyAssertion(asked, 'https://k.example')
    const states = mock.authCalls.map((call) => stateOf(call.url))
    expect(new Set(states).size).toBe(2)
    expect(states[0]).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })
})

describe('the hooks the core is loaded with', () => {
  it("end the SSO trip at this extension's redirect address, and say cancelled as null", async () => {
    const hooks = browserHooks()
    expect(hooks.redirectUrl).toBe(redirect)
    mock.authReply = `${redirect}?code=c1&state=s1`
    expect(await hooks.launchWebAuthFlow!('https://idp.example/authorize?x=1')).toBe(mock.authReply)
    expect(mock.authCalls.at(-1)).toEqual({
      url: 'https://idp.example/authorize?x=1',
      interactive: true,
    })
    mock.authReply = new Error('The user did not approve access.')
    expect(await hooks.launchWebAuthFlow!('https://idp.example/authorize')).toBeNull()
    // Not https: refused rather than shown
    await expect(hooks.launchWebAuthFlow!('http://idp.example/')).rejects.toMatchObject({
      code: 'badRequest',
    })
    expect(typeof hooks.passkeyAssertion).toBe('function')
  })
})
