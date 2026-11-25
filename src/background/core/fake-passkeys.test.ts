import { describe, expect, it } from 'vitest'
import { toBase64Url } from '../../shared/passkeys'
import {
  authDataOf,
  challenge,
  clientDataOf,
  creation,
  decode,
  derToRaw,
  verifies,
} from '../test/passkey-kit'
import { checkRp, create, derSignature, findIn, sign, type StoredPasskey } from './fake-passkeys'

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

describe('the fake core’s relying party check', () => {
  it('takes the origin’s host, or a domain above it', () => {
    expect(checkRp('https://login.orbit-cloud.com')).toBe('login.orbit-cloud.com')
    expect(checkRp('https://login.orbit-cloud.com', 'orbit-cloud.com')).toBe('orbit-cloud.com')
    expect(checkRp('https://orbit-cloud.com', 'ORBIT-cloud.com.')).toBe('orbit-cloud.com')
  })

  it('refuses another site, a public suffix, an address and an insecure origin', () => {
    for (const [origin, rp] of [
      ['https://orbit-cloud.com', 'evil.test'],
      ['https://orbit-cloud.com', 'com'],
      ['https://alice.github.io', 'github.io'],
      ['https://orbit-cloud.com.evil.io', 'orbit-cloud.com'],
      ['https://notorbit-cloud.com', 'orbit-cloud.com'],
      ['https://10.0.0.1', undefined],
      ['http://orbit-cloud.com', undefined],
      ['null', undefined],
    ] as const)
      expect(() => checkRp(origin, rp), `${origin} ${rp}`).toThrow('passkeySecurity')
  })

  it('allows http on localhost', () => {
    expect(checkRp('http://localhost:3000')).toBe('localhost')
  })
})

describe('the fake core’s passkeys', () => {
  const origin = 'https://orbit-cloud.com'
  const made = async (list: StoredPasskey[] = [], options = creation()) => {
    const result = await create(list, options, origin, undefined, 1_800_000_000_000, 'passkey-1')
    list.push(result.passkey)
    return result
  }

  it('makes a passkey the phone’s way: 16-byte id, authenticator data 0x5D, counter 0, attestation none', async () => {
    const { passkey, made: result } = await made()
    const response = result.response.response
    expect(decode(passkey.credentialId)).toHaveLength(16)
    expect(result.response.id).toBe(passkey.credentialId)
    expect(passkey.rpId).toBe('orbit-cloud.com')
    expect(passkey.rpName).toBe('Orbit Cloud')
    expect(passkey.userName).toBe('sam@example.com')
    const authData = decode(response.authenticatorData)
    expect(hex(authData.slice(0, 32))).toBe(hex(await sha256('orbit-cloud.com')))
    expect(authData[32]).toBe(0x5d)
    expect([...authData.slice(33, 37)]).toEqual([0, 0, 0, 0])
    expect(hex(authData.slice(37, 53))).toBe('f85899bed2db4b3b9b109b48e146dc1c')
    expect([...authData.slice(53, 55)]).toEqual([0, 16])
    // The attestation object is {"fmt": "none", "attStmt": {}, "authData": …}
    const attestation = decode(response.attestationObject)
    expect(attestation[0]).toBe(0xa3)
    expect(new TextDecoder().decode(attestation.slice(2, 5))).toBe('fmt')
    expect(new TextDecoder().decode(attestation.slice(6, 10))).toBe('none')
    expect(response.transports).toEqual(['internal'])
    expect(response.publicKeyAlgorithm).toBe(-7)
    expect(decode(response.publicKey)).toHaveLength(91)
    expect(result.response.clientExtensionResults).toEqual({ credProps: { rk: true } })
    expect(clientDataOf(result.response)).toEqual({
      type: 'webauthn.create',
      challenge,
      origin,
      crossOrigin: false,
    })
  })

  it('signs a challenge, and a site verifies it with the key it was given', async () => {
    const { passkey, made: result } = await made()
    const response = await sign(passkey, challenge, origin)
    expect(response.id).toBe(passkey.credentialId)
    expect(response.response.userHandle).toBe(passkey.userHandle)
    const authData = authDataOf(response)
    expect(authData[32]).toBe(0x1d)
    expect([...authData.slice(33)]).toEqual([0, 0, 0, 0])
    expect(await verifies(String(result.response.response.publicKey), response)).toBe(true)
    // Not for another challenge's client data
    const other = await sign(passkey, toBase64Url(new Uint8Array([9, 9, 9])), origin)
    expect(
      await verifies(String(result.response.response.publicKey), {
        ...response,
        response: { ...response.response, clientDataJSON: other.response.clientDataJSON },
      }),
    ).toBe(false)
  })

  it('names the top origin when a frame of another origin asks', async () => {
    const { passkey } = await made()
    const response = await sign(passkey, challenge, origin, 'https://embedder.test')
    expect(clientDataOf(response)).toMatchObject({
      crossOrigin: true,
      topOrigin: 'https://embedder.test',
    })
  })

  it('says crossOrigin whenever a top origin is given, though it is the frame’s own', async () => {
    const { passkey } = await made()
    const response = await sign(passkey, challenge, origin, origin)
    expect(clientDataOf(response)).toMatchObject({ crossOrigin: true, topOrigin: origin })
  })

  it('refuses another origin, a site that takes no ES256, and a credential it already holds', async () => {
    const list: StoredPasskey[] = []
    const { passkey } = await made(list)
    await expect(sign(passkey, challenge, 'https://evil.test')).rejects.toThrow('passkeySecurity')
    await expect(
      create(
        list,
        creation({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] }),
        origin,
        undefined,
        1,
        'x',
      ),
    ).rejects.toThrow('passkeyNotSupported')
    await expect(
      create(
        list,
        creation({ excludeCredentials: [{ type: 'public-key', id: passkey.credentialId }] }),
        origin,
        undefined,
        1,
        'x',
      ),
    ).rejects.toThrow('passkeyInvalidState')
    await expect(
      create(list, creation({ challenge: '' }), origin, undefined, 1, 'x'),
    ).rejects.toThrow('passkeyEncoding')
  })

  it('finds the passkeys of exactly one relying party, each credential once', async () => {
    const list: StoredPasskey[] = []
    const first = (await made(list)).passkey
    await create(list, creation(), origin, undefined, 2, 'passkey-2').then((r) =>
      list.push(r.passkey),
    )
    list.push({ ...first, id: 'copy' })
    list.push({ ...first, id: 'elsewhere', rpId: 'login.orbit-cloud.com', credentialId: 'AAAA' })
    expect(findIn(list, 'orbit-cloud.com', []).map((entry) => entry.passkey.id)).toEqual([
      'passkey-1',
      'passkey-2',
    ])
    expect(
      findIn(list, 'orbit-cloud.com', [first.credentialId]).map((entry) => entry.passkey.id),
    ).toEqual(['passkey-1'])
    expect(findIn(list, 'com', [])).toEqual([])
  })
})

describe('an ECDSA signature as DER', () => {
  it('has the low s, and reads back to the raw one', () => {
    const order = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551')
    const raw = new Uint8Array(64)
    raw.fill(0x11, 0, 32)
    // s above half the curve's order is flipped to the low one: the order less one is 1
    raw.set(
      Uint8Array.from((order - 1n).toString(16).padStart(64, '0').match(/../g)!, (pair) =>
        parseInt(pair, 16),
      ),
      32,
    )
    const der = derSignature(raw)
    expect(der[0]).toBe(0x30)
    const back = derToRaw(der)
    expect(hex(back.slice(0, 32))).toBe('11'.repeat(32))
    expect(hex(back.slice(32))).toBe(`${'00'.repeat(31)}01`)
    // A high first byte takes a leading zero
    const high = new Uint8Array(64)
    high[0] = 0x80
    high[63] = 0x01
    expect(derSignature(high).slice(2, 5)).toEqual(Uint8Array.of(0x02, 0x21, 0x00))
  })
})
