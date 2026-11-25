// The keys, contacts and PGP tools' requests as the parser takes them: known fields only, bounded sizes, and nothing a content
// script could send.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { maxFileBytes } from './keys-api'
import { parseContentMessage, parsePageMessage } from './messages'

const keysKinds = [
  'keys',
  'keysState',
  'keyPublic',
  'exportKey',
  'copyKey',
  'saveKey',
  'deleteKey',
  'generateKey',
  'previewKey',
  'importKey',
  'contacts',
  'previewContacts',
  'addContacts',
  'saveContact',
  'contactPublic',
  'deleteContact',
  'pgpEncrypt',
  'pgpDecrypt',
  'pgpSign',
  'pgpVerify',
  'sshSign',
  'sshVerify',
]

describe('the keys requests', () => {
  it('keep the known fields only', () => {
    expect(parsePageMessage({ kind: 'keys' })).toEqual({ kind: 'keys' })
    expect(parsePageMessage({ kind: 'keyPublic', id: 'k1', address: 'evil.example' })).toEqual({
      kind: 'keyPublic',
      id: 'k1',
    })
    expect(
      parsePageMessage({
        kind: 'exportKey',
        id: 'k1',
        passphrase: 'a passphrase',
        purpose: 'file',
        extra: 1,
      }),
    ).toEqual({ kind: 'exportKey', id: 'k1', passphrase: 'a passphrase', purpose: 'file' })
    expect(
      parsePageMessage({ kind: 'saveKey', id: 'k1', name: 'work', note: '', tags: ['a', 'b'] }),
    ).toEqual({ kind: 'saveKey', id: 'k1', name: 'work', note: '', tags: ['a', 'b'] })
    expect(
      parsePageMessage({
        kind: 'generateKey',
        input: {
          kind: 'pgp',
          type: 'pqStandard',
          name: 'Ada',
          email: 'a@b.c',
          expiresInYears: null,
        },
      }),
    ).toEqual({
      kind: 'generateKey',
      input: { kind: 'pgp', type: 'pqStandard', name: 'Ada', email: 'a@b.c', expiresInYears: null },
    })
    expect(
      parsePageMessage({
        kind: 'pgpEncrypt',
        data: { text: 'hello', fileName: 'a.txt', other: 1 },
        contactIds: ['c1'],
        keyIds: [],
        passphrase: 'p',
        x: 1,
      }),
    ).toEqual({
      kind: 'pgpEncrypt',
      data: { text: 'hello', fileName: 'a.txt' },
      contactIds: ['c1'],
      keyIds: [],
      passphrase: 'p',
    })
  })

  it('take a text or a file in base64, within the bounds', () => {
    const base64Limit = Math.ceil(maxFileBytes / 3) * 4 + 8
    expect(parsePageMessage({ kind: 'previewKey', base64: 'AAAA' })).toEqual({
      kind: 'previewKey',
      base64: 'AAAA',
    })
    expect(
      parsePageMessage({ kind: 'previewContacts', base64: 'A'.repeat(base64Limit) }),
    ).not.toBeNull()
    expect(
      parsePageMessage({ kind: 'previewContacts', base64: 'A'.repeat(base64Limit + 1) }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'pgpDecrypt', text: 'x'.repeat(1_100_000) })).not.toBeNull()
    expect(parsePageMessage({ kind: 'pgpDecrypt', text: 'x'.repeat(1_100_001) })).toBeNull()
  })

  it('refuse what is not one of them', () => {
    for (const raw of [
      { kind: 'keyPublic' },
      { kind: 'keyPublic', id: '' },
      { kind: 'keyPublic', id: 12 },
      { kind: 'exportKey', id: 'k', purpose: 'show', passphrase: '' },
      { kind: 'exportKey', id: 'k', purpose: 'copy' },
      { kind: 'exportKey', id: 'k' },
      { kind: 'exportKey', id: 'k', purpose: 'file', file: true, passphrase: '' },
      { kind: 'saveKey', id: 'k', tags: ['ok', ''] },
      { kind: 'saveKey', id: 'k', tags: Array.from({ length: 51 }, () => 'tag') },
      { kind: 'generateKey', input: { kind: 'dsa', name: 'x' } },
      { kind: 'generateKey', input: { kind: 'ssh' } },
      { kind: 'generateKey', input: { kind: 'pgp', type: 'rsa1024', name: 'x', email: 'e' } },
      { kind: 'generateKey', input: { kind: 'pgp', name: 'x', expiresInYears: 0 } },
      { kind: 'importKey', text: 'x' },
      { kind: 'addContacts', text: 'x', source: 'qr' },
      { kind: 'addContacts', text: 'x', checked: [1] },
      { kind: 'pgpEncrypt', data: { text: 'x' }, contactIds: 'c', keyIds: [] },
      { kind: 'pgpEncrypt', contactIds: [], keyIds: [] },
      { kind: 'pgpSign', text: 'x', keyId: 'k', form: 'armored' },
      { kind: 'sshSign', text: 'x', keyId: 'k' },
      { kind: 'sshSign', text: 'x', keyId: 'k', namespace: '' },
      { kind: 'sshVerify', text: 'x', git: 'true' },
    ]) {
      expect(parsePageMessage(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  it('are not what a content script may send', () => {
    for (const kind of keysKinds) {
      expect(parseContentMessage({ kind, id: 'k', text: 'x' }), kind).toBeNull()
    }
  })

  it('never throw, whatever they are given, and keep their kind', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...keysKinds),
        fc.dictionary(fc.string({ maxLength: 12 }), fc.anything(), { maxKeys: 6 }),
        (kind, rest) => {
          const parsed = parsePageMessage({ ...rest, kind })
          expect(parsed === null || parsed.kind === kind).toBe(true)
          if (parsed !== null) expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
        },
      ),
      { numRuns: 300 },
    )
  })
})
