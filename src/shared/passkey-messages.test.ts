import { describe, expect, it } from 'vitest'
import { parseContentMessage, parsePageMessage } from './messages'
import { fromBase64Url, toBase64Url } from './passkeys'

const challenge = 'AQIDBAUGBwgJCgsMDQ4PEA'
const begin = (over: Record<string, unknown> = {}) => ({
  kind: 'passkeyBegin',
  id: '0123456789abcdef0123456789abcdef',
  type: 'create',
  conditional: false,
  options: {
    rp: { id: 'orbit-cloud.com', name: 'Orbit Cloud' },
    user: { id: 'dXNlci0x', name: 'sam@example.com', displayName: 'Sam' },
    challenge,
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    excludeCredentials: [{ type: 'public-key', id: 'AAEC' }],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    attestation: 'none',
    timeout: 60000,
    extensions: { credProps: true },
  },
  ...over,
})

describe('base64url', () => {
  it('reads what it writes, with or without padding', () => {
    const bytes = Uint8Array.from({ length: 70 }, (_, i) => i * 3)
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    expect(toBase64Url(new Uint8Array([251, 255]))).toBe('-_8')
    expect(fromBase64Url('-_8=')).toEqual(new Uint8Array([251, 255]))
    expect(fromBase64Url('AAEC')).toEqual(new Uint8Array([0, 1, 2]))
  })

  it('is null for what is not base64url', () => {
    expect(fromBase64Url('a+b')).toBeNull()
    expect(fromBase64Url('a b')).toBeNull()
    expect(fromBase64Url('A')).toBeNull()
  })
})

describe('what the bridge may ask', () => {
  it('reads a request as a fresh object of its known fields', () => {
    const raw = begin({ origin: 'https://evil.test', url: 'https://evil.test/' })
    const parsed = parseContentMessage(raw)
    expect(parsed).toEqual(begin())
    expect(parsed).not.toBe(raw)
    expect(Object.keys(parsed as object)).not.toContain('origin')
  })

  it('reads a sign-in with the descriptors it allows', () => {
    const raw = {
      kind: 'passkeyBegin',
      id: 'a'.repeat(32),
      type: 'get',
      conditional: true,
      options: {
        rpId: 'orbit-cloud.com',
        challenge,
        allowCredentials: [{ type: 'public-key', id: 'AAEC' }],
        userVerification: 'required',
        extensions: { prf: false },
      },
    }
    expect(parseContentMessage(raw)).toEqual(raw)
  })

  it('refuses a request that is not shaped as one', () => {
    for (const over of [
      { type: 'delete' },
      { conditional: 'yes' },
      { id: '' },
      { id: 'x'.repeat(65) },
      { options: null },
      { options: {} },
      { options: { challenge: '' } },
      { options: { challenge: 'not base64url!' } },
      { options: { ...begin().options, user: { id: 'AAEC' } } },
      { options: { ...begin().options, user: { id: 'x'.repeat(129), name: 'a' } } },
      { options: { ...begin().options, pubKeyCredParams: [{ type: 'other', alg: -7 }] } },
      { options: { ...begin().options, pubKeyCredParams: [{ type: 'public-key', alg: 1.5 }] } },
      { options: { ...begin().options, excludeCredentials: [{ type: 'public-key', id: '??' }] } },
      {
        options: {
          ...begin().options,
          excludeCredentials: Array(101).fill({ type: 'public-key', id: 'AA' }),
        },
      },
      { options: { ...begin().options, timeout: -1 } },
      { options: { ...begin().options, extensions: { credProps: 'yes' } } },
      { options: { ...begin().options, rp: { id: 'x'.repeat(254) } } },
    ])
      expect(parseContentMessage(begin(over)), JSON.stringify(over).slice(0, 80)).toBeNull()
  })

  it('reads a cancel and a status check, and no more than they hold', () => {
    expect(parseContentMessage({ kind: 'passkeyCancel', id: 'abc', extra: 1 })).toEqual({
      kind: 'passkeyCancel',
      id: 'abc',
    })
    expect(parseContentMessage({ kind: 'passkeyCancel' })).toBeNull()
    expect(parseContentMessage({ kind: 'passkeyStatus', origin: 'https://evil.test' })).toEqual({
      kind: 'passkeyStatus',
    })
  })

  it('is not a page’s to ask: the extension’s pages may not send it, and the other way round', () => {
    expect(parsePageMessage(begin())).toBeNull()
    expect(parseContentMessage({ kind: 'passkeyAnswer', tabId: 1, action: 'save' })).toBeNull()
    expect(parseContentMessage({ kind: 'passkeys' })).toBeNull()
  })
})

describe('what the extension’s pages may ask about passkeys', () => {
  it('lists, deletes and switches', () => {
    expect(parsePageMessage({ kind: 'passkeys' })).toEqual({ kind: 'passkeys' })
    expect(parsePageMessage({ kind: 'deletePasskey', id: 'p1' })).toEqual({
      kind: 'deletePasskey',
      id: 'p1',
    })
    expect(parsePageMessage({ kind: 'deletePasskey' })).toBeNull()
    expect(parsePageMessage({ kind: 'passkeyHere', host: 'orbit-cloud.com' })).toEqual({
      kind: 'passkeyHere',
      host: 'orbit-cloud.com',
    })
    expect(
      parsePageMessage({ kind: 'passkeyHereSet', host: 'orbit-cloud.com', off: true }),
    ).toEqual({
      kind: 'passkeyHereSet',
      host: 'orbit-cloud.com',
      off: true,
    })
    expect(parsePageMessage({ kind: 'passkeyHereSet', host: 'orbit-cloud.com' })).toBeNull()
  })

  it('answers a card with one of its six choices, under the card’s secret', () => {
    const token = '0123456789abcdef0123456789abcdef'
    for (const action of ['save', 'use', 'other', 'cancel', 'never', 'dismiss'])
      expect(
        parsePageMessage({ kind: 'passkeyAnswer', tabId: 7, token, action, passkeyId: 'p1' }),
      ).toEqual({ kind: 'passkeyAnswer', tabId: 7, token, action, passkeyId: 'p1' })
    expect(parsePageMessage({ kind: 'passkeyAnswer', tabId: 7, token, action: 'sign' })).toBeNull()
    expect(parsePageMessage({ kind: 'passkeyAnswer', tabId: -1, token, action: 'save' })).toBeNull()
    // No secret, no answer, and none that is empty or too long to be one
    expect(parsePageMessage({ kind: 'passkeyAnswer', tabId: 7, action: 'save' })).toBeNull()
    expect(
      parsePageMessage({ kind: 'passkeyAnswer', tabId: 7, token: '', action: 'save' }),
    ).toBeNull()
    expect(
      parsePageMessage({ kind: 'passkeyAnswer', tabId: 7, token: 'x'.repeat(65), action: 'save' }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'passkeyPrompt', tabId: 7, token })).toEqual({
      kind: 'passkeyPrompt',
      tabId: 7,
      token,
    })
    expect(parsePageMessage({ kind: 'passkeyPrompt', tabId: 7 })).toBeNull()
  })

  it('picks a passkey for a field of a frame', () => {
    const message = { kind: 'passkeyChoose', tabId: 7, frameId: 0, fieldId: 'f1', passkeyId: 'p1' }
    expect(parsePageMessage(message)).toEqual(message)
    expect(parsePageMessage({ ...message, passkeyId: undefined })).toBeNull()
  })

  it('keeps the provider switch in the settings it takes', () => {
    expect(parsePageMessage({ kind: 'saveSettings', settings: { passkeys: false } })).toEqual({
      kind: 'saveSettings',
      settings: { passkeys: false },
    })
    expect(parsePageMessage({ kind: 'saveSettings', settings: { passkeys: 'no' } })).toBeNull()
  })
})
