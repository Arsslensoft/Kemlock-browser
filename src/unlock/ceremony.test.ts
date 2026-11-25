// The WebAuthn side of the passkey unlock, over a fake `navigator.credentials`: what it asks the browser for (the PRF input, user
// verification, the relying party of each browser), what it takes from the answer, and each way it can end.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  askCredentials,
  CeremonyError,
  fromBase64url,
  isFirefox,
  makeCredential,
  prfSupport,
  relyingParty,
  toBase64url,
} from './ceremony'

const buffer = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer
const thirtyTwo = (fill: number): ArrayBuffer => new Uint8Array(32).fill(fill).buffer
const salt = toBase64url(new Uint8Array(32).fill(9))

interface Fake {
  rawId?: ArrayBuffer
  attachment?: string | null
  transports?: string[]
  prf?: unknown
}

/** What `navigator.credentials` gives back: a PublicKeyCredential with its extension results. */
function credential(over: Fake = {}) {
  return {
    rawId: over.rawId ?? buffer(1, 2, 3),
    authenticatorAttachment: over.attachment === undefined ? 'platform' : over.attachment,
    response: { getTransports: () => over.transports ?? ['internal'] },
    getClientExtensionResults: () => (over.prf === undefined ? {} : { prf: over.prf }),
  }
}

const created = (over: Fake = {}) => credential({ prf: { enabled: true }, ...over })
const asked = (over: Fake = {}) =>
  credential({ prf: { results: { first: thirtyTwo(5) } }, ...over })

let create: ReturnType<typeof vi.fn>
let get: ReturnType<typeof vi.fn>
let permissions: { request: ReturnType<typeof vi.fn>; contains: ReturnType<typeof vi.fn> }

beforeEach(() => {
  create = vi.fn(async () => created())
  get = vi.fn(async () => asked())
  permissions = { request: vi.fn(async () => true), contains: vi.fn(async () => true) }
  vi.stubGlobal('navigator', { credentials: { create, get } })
  vi.stubGlobal('PublicKeyCredential', {
    getClientCapabilities: async () => ({ 'extension:prf': true }),
  })
  vi.stubGlobal('chrome', { permissions })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const options = (over: object = {}) => ({ salt, exclude: [] as string[], ...over })

describe('base64url', () => {
  it('reads back what it wrote, with no padding and the URL alphabet', () => {
    const bytes = new Uint8Array([251, 255, 254, 0, 1, 2, 3])
    const text = toBase64url(bytes)
    expect(text).toBe('-__-AAECAw')
    expect([...fromBase64url(text)]).toEqual([...bytes])
    expect(toBase64url(bytes.buffer)).toBe(text)
    expect(toBase64url(new Uint8Array([0, ...bytes]).subarray(1))).toBe(text)
  })

  it('refuses text that is not base64url', () => {
    expect(() => fromBase64url('a b')).toThrow(CeremonyError)
    expect(() => fromBase64url('a+b/')).toThrow(CeremonyError)
  })
})

describe('prfSupport', () => {
  it('is yes when the browser says it has PRF, and no when it says it has not', async () => {
    expect(await prfSupport()).toBe('yes')
    vi.stubGlobal('PublicKeyCredential', {
      getClientCapabilities: async () => ({ 'extension:prf': false }),
    })
    expect(await prfSupport()).toBe('no')
  })

  it('is no without WebAuthn at all', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    expect(await prfSupport()).toBe('no')
    vi.stubGlobal('PublicKeyCredential', {})
    vi.stubGlobal('navigator', {})
    expect(await prfSupport()).toBe('no')
  })

  it('is unknown where the browser cannot say, and a credential then settles it', async () => {
    vi.stubGlobal('PublicKeyCredential', {})
    expect(await prfSupport()).toBe('unknown')
    vi.stubGlobal('PublicKeyCredential', {
      getClientCapabilities: async () => {
        throw new Error('no')
      },
    })
    expect(await prfSupport()).toBe('unknown')
    vi.stubGlobal('PublicKeyCredential', { getClientCapabilities: async () => ({}) })
    expect(await prfSupport()).toBe('unknown')
  })
})

describe('making a credential', () => {
  it('asks for the PRF input and user verification, leaves the relying party to Chrome, and keeps the output of a second ask', async () => {
    const made = await makeCredential(options({ exclude: ['AQID'] }), 'platform', 'My laptop')
    const asking = create.mock.calls[0]![0].publicKey
    expect(asking.rp).toEqual({ name: 'Kemlock' })
    expect(asking.user.name).toBe('My laptop')
    expect(asking.user.id).toHaveLength(16)
    expect(asking.authenticatorSelection).toEqual({
      userVerification: 'required',
      residentKey: 'discouraged',
      authenticatorAttachment: 'platform',
    })
    expect([...asking.extensions.prf.eval.first]).toEqual(new Array(32).fill(9))
    expect(asking.excludeCredentials).toHaveLength(1)
    expect([...asking.excludeCredentials[0].id]).toEqual([1, 2, 3])
    // The output is the one the second ask gave, for this credential and the same input
    const second = get.mock.calls[0]![0].publicKey
    expect(second.userVerification).toBe('required')
    expect(second.rpId).toBeUndefined()
    expect(second.allowCredentials).toHaveLength(1)
    expect([...second.allowCredentials[0].id]).toEqual([1, 2, 3])
    expect([...second.extensions.prf.eval.first]).toEqual(new Array(32).fill(9))
    expect(made).toEqual({
      name: 'My laptop',
      credentialId: 'AQID',
      prfOutput: toBase64url(thirtyTwo(5)),
      attachment: 'platform',
      transports: ['internal'],
    })
  })

  it('makes a credential of any attachment when the browser is let choose', async () => {
    await makeCredential(options(), 'any', 'Key')
    expect(create.mock.calls[0]![0].publicKey.authenticatorSelection).toEqual({
      userVerification: 'required',
      residentKey: 'discouraged',
    })
  })

  it('gives each credential a user handle of its own', async () => {
    await makeCredential(options(), 'platform', 'A')
    await makeCredential(options(), 'platform', 'B')
    const [a, b] = create.mock.calls.map((call) => [...call[0].publicKey.user.id])
    expect(a).not.toEqual(b)
  })

  it('takes the output of the second ask even when the creation gave one', async () => {
    create.mockResolvedValueOnce(
      created({ prf: { enabled: true, results: { first: thirtyTwo(1) } } }),
    )
    const made = await makeCredential(options(), 'platform', 'A')
    expect(made.prfOutput).toBe(toBase64url(thirtyTwo(5)))
  })

  it('says an authenticator without PRF has none, whether it says so or says nothing', async () => {
    for (const prf of [undefined, { enabled: false }, {}]) {
      create.mockResolvedValueOnce(credential(prf === undefined ? {} : { prf }))
      await expect(makeCredential(options(), 'platform', 'A')).rejects.toMatchObject({
        code: 'noPrf',
      })
    }
    expect(get).not.toHaveBeenCalled()
  })

  it('says so when the second ask gives no output, or one that is not 32 bytes', async () => {
    get.mockResolvedValueOnce(credential({ prf: { results: {} } }))
    await expect(makeCredential(options(), 'platform', 'A')).rejects.toMatchObject({
      code: 'noPrf',
    })
    get.mockResolvedValueOnce(credential({ prf: { results: { first: new ArrayBuffer(16) } } }))
    await expect(makeCredential(options(), 'platform', 'A')).rejects.toMatchObject({
      code: 'noPrf',
    })
  })

  it('names each way the browser can refuse in its own word', async () => {
    const refusals: [string, string][] = [
      ['NotAllowedError', 'cancelled'],
      ['AbortError', 'cancelled'],
      ['InvalidStateError', 'duplicate'],
      ['SecurityError', 'security'],
      ['NotSupportedError', 'unsupported'],
      ['SomethingElse', 'failed'],
    ]
    for (const [name, code] of refusals) {
      create.mockRejectedValueOnce(Object.assign(new Error('x'), { name }))
      await expect(makeCredential(options(), 'platform', 'A')).rejects.toMatchObject({ code })
    }
    create.mockResolvedValueOnce(null)
    await expect(makeCredential(options(), 'platform', 'A')).rejects.toMatchObject({
      code: 'cancelled',
    })
  })

  it('is unsupported where there is no WebAuthn to ask', async () => {
    vi.stubGlobal('navigator', {})
    await expect(makeCredential(options(), 'platform', 'A')).rejects.toMatchObject({
      code: 'unsupported',
    })
  })
})

describe('Firefox', () => {
  const info = {
    credentials: [{ id: 's1', credentialId: 'AQID', name: 'A', addedAt: 0, transports: [] }],
    salt,
  }

  beforeEach(() => {
    vi.stubGlobal('__BROWSER__', 'firefox')
  })

  it('is not offered: the browser is said to be one that does not, however much WebAuthn it has', async () => {
    expect(await prfSupport()).toBe('firefox')
    expect(isFirefox()).toBe(true)
    vi.stubGlobal('__BROWSER__', 'chrome')
    expect(await prfSupport()).toBe('yes')
    expect(isFirefox()).toBe(false)
  })

  it('makes and asks nothing, whichever page asks, and never touches the browser', async () => {
    await expect(makeCredential(options(), 'platform', 'A')).rejects.toMatchObject({
      code: 'firefox',
    })
    await expect(askCredentials(info)).rejects.toMatchObject({ code: 'firefox' })
    expect(create).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(permissions.request).not.toHaveBeenCalled()
  })
})

describe('the relying party', () => {
  it('is the one the credentials were made for, and else the browser’s own default', () => {
    expect(relyingParty('made.example')).toBe('made.example')
    expect(relyingParty('')).toBeUndefined()
    expect(relyingParty()).toBeUndefined()
  })
})

describe('asking the credentials', () => {
  const info = {
    credentials: [
      {
        id: 's1',
        credentialId: 'AQID',
        name: 'A',
        addedAt: 0,
        transports: ['internal'],
      },
      { id: 's2', credentialId: 'BAUG', name: 'B', addedAt: 0, transports: [] },
    ],
    salt,
  }

  it('offers every credential with its transports, the PRF input and user verification, and answers the one that answered', async () => {
    get.mockResolvedValueOnce(asked({ rawId: buffer(4, 5, 6) }))
    const answer = await askCredentials(info)
    const asking = get.mock.calls[0]![0].publicKey
    expect(asking.allowCredentials).toHaveLength(2)
    expect(asking.allowCredentials[0].transports).toEqual(['internal'])
    expect(asking.allowCredentials[1].transports).toBeUndefined()
    expect(asking.userVerification).toBe('required')
    expect([...asking.extensions.prf.eval.first]).toEqual(new Array(32).fill(9))
    expect(answer).toEqual({ credentialId: 'BAUG', prfOutput: toBase64url(thirtyTwo(5)) })
  })

  it('uses the relying party the credentials were made for', async () => {
    await askCredentials({ ...info, rpId: 'made.example' })
    expect(get.mock.calls[0]![0].publicKey.rpId).toBe('made.example')
  })

  it('says the authenticator has no PRF when the answer has none', async () => {
    get.mockResolvedValueOnce(credential())
    await expect(askCredentials(info)).rejects.toMatchObject({ code: 'noPrf' })
  })

  it('has nothing to ask with no credential or no input', async () => {
    await expect(askCredentials({ credentials: [] })).rejects.toBeInstanceOf(CeremonyError)
    await expect(askCredentials({ credentials: info.credentials })).rejects.toBeInstanceOf(
      CeremonyError,
    )
    expect(get).not.toHaveBeenCalled()
  })

  it('is cancelled when the person dismisses the prompt', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await expect(askCredentials(info)).rejects.toMatchObject({ code: 'cancelled' })
    get.mockResolvedValueOnce(null)
    await expect(askCredentials(info)).rejects.toMatchObject({ code: 'cancelled' })
  })
})
