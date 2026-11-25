import { describe, expect, it } from 'vitest'
import { assertion, creation } from './test/passkey-kit'
import { asciiRp, descriptorIds, serveCreate, serveGet, timeoutOf } from './passkey-request'

describe('a relying party id', () => {
  it('is none, or a domain in its ASCII form', () => {
    expect(asciiRp(undefined)).toBeUndefined()
    expect(asciiRp('')).toBeUndefined()
    expect(asciiRp('Orbit-Cloud.com')).toBe('orbit-cloud.com')
    expect(asciiRp('bücher.example')).toBe('xn--bcher-kva.example')
  })

  it('is null for what is no domain, which the browser refuses itself', () => {
    for (const bad of [
      'a b.com',
      'orbit.com/x',
      'orbit.com?x',
      'orbit.com#x',
      'a@b.com',
      'a:80',
      '[::1]',
    ])
      expect(asciiRp(bad), bad).toBeNull()
  })
})

describe('a creation Kemlock serves', () => {
  it('takes ES256 among others, or the defaults', () => {
    expect(serveCreate(creation()).serve).toBe(true)
    expect(serveCreate(creation({ pubKeyCredParams: [] })).serve).toBe(true)
    expect(serveCreate(creation({ pubKeyCredParams: undefined })).serve).toBe(true)
  })

  it('goes to the browser without ES256, for a security key only, and with PRF or large blobs', () => {
    expect(
      serveCreate(creation({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] })),
    ).toEqual({ serve: false, reason: 'algorithm' })
    expect(
      serveCreate(
        creation({ authenticatorSelection: { authenticatorAttachment: 'cross-platform' } }),
      ),
    ).toEqual({ serve: false, reason: 'attachment' })
    expect(serveCreate(creation({ extensions: { prf: true } }))).toEqual({
      serve: false,
      reason: 'extension',
    })
    expect(serveCreate(creation({ extensions: { largeBlob: true } }))).toEqual({
      serve: false,
      reason: 'extension',
    })
    expect(serveCreate(creation({ rp: { id: 'a b.com', name: 'x' } }))).toEqual({
      serve: false,
      reason: 'relyingParty',
    })
  })

  it('takes a platform attachment, and asks credProps', () => {
    const served = serveCreate(
      creation({ authenticatorSelection: { authenticatorAttachment: 'platform' } }),
    )
    expect(served).toMatchObject({ serve: true, rpId: 'orbit-cloud.com' })
  })

  it('puts the relying party in its ASCII form, and a time a person can use', () => {
    const served = serveCreate(
      creation({ rp: { id: 'Orbit-Cloud.com', name: 'Orbit' }, timeout: 5 }),
    )
    expect(served).toMatchObject({ serve: true, rpId: 'orbit-cloud.com', timeout: 30_000 })
    if (served.serve) expect(served.options.rp.id).toBe('orbit-cloud.com')
  })

  it('keeps no relying party when the site names none', () => {
    const served = serveCreate(creation({ rp: { name: 'Orbit' } }))
    expect(served).toMatchObject({ serve: true, rpId: undefined })
  })
})

describe('a sign-in Kemlock may answer', () => {
  it('takes any request, conditional or not', () => {
    expect(serveGet(assertion(), false).serve).toBe(true)
    expect(serveGet(assertion(), true)).toMatchObject({ serve: true, timeout: 30 * 60_000 })
  })

  it('goes to the browser with PRF or large blobs, or a relying party that is no domain', () => {
    expect(serveGet(assertion({ extensions: { prf: true } }), false)).toEqual({
      serve: false,
      reason: 'extension',
    })
    expect(serveGet(assertion({ rpId: 'x y' }), false)).toEqual({
      serve: false,
      reason: 'relyingParty',
    })
  })

  it('leaves the relying party to the origin when the site names none', () => {
    expect(serveGet(assertion({ rpId: undefined }), false)).toMatchObject({
      serve: true,
      rpId: undefined,
    })
  })
})

describe('the time of a request', () => {
  it('is held between half a minute and ten minutes, two minutes by default', () => {
    expect(timeoutOf(undefined, false)).toBe(120_000)
    expect(timeoutOf(1, false)).toBe(30_000)
    expect(timeoutOf(60_000, false)).toBe(60_000)
    expect(timeoutOf(99_999_999, false)).toBe(600_000)
    expect(timeoutOf(1, true)).toBe(30 * 60_000)
  })

  it('lists the ids a request names', () => {
    expect(descriptorIds(undefined)).toEqual([])
    expect(descriptorIds([{ id: 'a' }, { id: 'b' }])).toEqual(['a', 'b'])
  })
})
