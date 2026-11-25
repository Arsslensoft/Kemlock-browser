// What the pages may send about the credentials that open the vault: fresh objects of known fields, a PRF output that is exactly 32 bytes
// of base64url, and nothing a sender adds (docs/plans/add-passkey-unlock.md).
import { describe, expect, it } from 'vitest'
import { parsePageMessage } from './messages'

const prf = 'A'.repeat(43)

describe('the passkey unlock messages', () => {
  it('read what a well-formed page sends, and drop what it adds', () => {
    expect(
      parsePageMessage({
        kind: 'addPasskeyUnlock',
        name: 'Windows Hello',
        password: 'a password',
        credentialId: 'AQID-_',
        prfOutput: prf,
        rpId: 'unlock.example',
        attachment: 'platform',
        transports: ['internal'],
        origin: 'https://evil.example',
      }),
    ).toEqual({
      kind: 'addPasskeyUnlock',
      name: 'Windows Hello',
      password: 'a password',
      credentialId: 'AQID-_',
      prfOutput: prf,
      rpId: 'unlock.example',
      attachment: 'platform',
      transports: ['internal'],
    })
    expect(
      parsePageMessage({ kind: 'unlockWithPasskey', credentialId: 'AQID', prfOutput: prf, x: 1 }),
    ).toEqual({ kind: 'unlockWithPasskey', credentialId: 'AQID', prfOutput: prf })
    expect(parsePageMessage({ kind: 'passkeyUnlockInfo', extra: 1 })).toEqual({
      kind: 'passkeyUnlockInfo',
    })
    expect(parsePageMessage({ kind: 'renamePasskeyUnlock', id: 'a', name: 'b' })).toEqual({
      kind: 'renamePasskeyUnlock',
      id: 'a',
      name: 'b',
    })
    expect(parsePageMessage({ kind: 'removePasskeyUnlock', id: 'a' })).toEqual({
      kind: 'removePasskeyUnlock',
      id: 'a',
    })
  })

  it('refuses a PRF output that is not 32 bytes of base64url', () => {
    for (const prfOutput of [
      '',
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}=`,
      `${'A'.repeat(42)}+`,
      43,
      null,
    ])
      expect(
        parsePageMessage({ kind: 'unlockWithPasskey', credentialId: 'AQID', prfOutput }),
      ).toBeNull()
  })

  it('refuses a credential id that is not base64url, or is too long', () => {
    for (const credentialId of ['', 'a b', 'a+b', 'a/b', 'a=', 'A'.repeat(1025), 7])
      expect(
        parsePageMessage({ kind: 'unlockWithPasskey', credentialId, prfOutput: prf }),
      ).toBeNull()
  })

  it('refuses a name that is empty or too long, and an attachment that is not one', () => {
    const add = {
      kind: 'addPasskeyUnlock',
      password: 'a password',
      credentialId: 'AQID',
      prfOutput: prf,
    }
    // The password is not optional
    expect(parsePageMessage({ ...add, password: undefined, name: 'ok' })).toBeNull()
    expect(parsePageMessage({ ...add, password: 7, name: 'ok' })).toBeNull()
    expect(parsePageMessage({ ...add, name: '' })).toBeNull()
    expect(parsePageMessage({ ...add, name: 'x'.repeat(101) })).toBeNull()
    expect(parsePageMessage({ ...add, name: 'ok', attachment: 'usb' })).toBeNull()
    expect(parsePageMessage({ ...add, name: 'ok', transports: Array(9).fill('usb') })).toBeNull()
    expect(parsePageMessage({ ...add, name: 'ok' })).toEqual({ ...add, name: 'ok' })
    expect(parsePageMessage({ kind: 'renamePasskeyUnlock', id: 'a', name: '' })).toBeNull()
  })
})
