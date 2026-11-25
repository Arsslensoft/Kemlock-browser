import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  create as makeFake,
  sign as signFake,
  type StoredPasskey,
} from '../background/core/fake-passkeys'
import { challenge, creation, decode } from '../background/test/passkey-kit'
import type { PasskeyCredentialJson, PasskeyOutcome } from '../shared/passkeys'
import { fromBase64Url, toBase64Url } from '../shared/passkeys'
import type { BeginMessage, StatusMessage } from './passkey-protocol'
import { installPasskeyPage, serializeCreate, serializeGet } from './passkey-page'

type Win = Window & typeof globalThis
type Message = BeginMessage | StatusMessage

/** What the bridge does with a request: the page script's side is tested against it, as the real one would answer. */
type Behaviour = (message: Message, port: MessagePort, cancels: unknown[]) => void

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await tick()
}

/** A window with the credentials container, `PublicKeyCredential` and what the page script needs, and a bridge behind it. */
function makeWindow(
  behaviour: Behaviour = () => undefined,
  extra: Partial<Record<string, unknown>> = {},
) {
  const seen: Message[] = []
  const cancels: unknown[] = []
  const native = {
    create: vi.fn(async (..._args: unknown[]) => 'native-create' as unknown),
    get: vi.fn(async (..._args: unknown[]) => 'native-get' as unknown),
    conditional: vi.fn(async (..._args: unknown[]) => 'native-conditional' as unknown),
  }
  class CredentialsContainer {}
  Object.defineProperty(CredentialsContainer.prototype, 'create', {
    value: function create(this: unknown, ...args: unknown[]) {
      return native.create.apply(this, args)
    },
    writable: true,
    configurable: true,
    enumerable: true,
  })
  Object.defineProperty(CredentialsContainer.prototype, 'get', {
    value: function get(this: unknown, ...args: unknown[]) {
      return native.get.apply(this, args)
    },
    writable: true,
    configurable: true,
    enumerable: true,
  })
  class PublicKeyCredential {
    static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(async () => false)
    static isConditionalMediationAvailable = vi.fn(async () => false)
  }
  class AuthenticatorAttestationResponse {}
  class AuthenticatorAssertionResponse {}
  const win = {
    CredentialsContainer,
    PublicKeyCredential,
    AuthenticatorAttestationResponse,
    AuthenticatorAssertionResponse,
    MessageChannel,
    DOMException,
    AbortController,
    AbortSignal,
    crypto,
    document: {} as Record<string, unknown>,
    postMessage(message: Message, _target: string, transfer: MessagePort[]) {
      seen.push(message)
      const port = transfer[0]!
      port.onmessage = (event: MessageEvent) => cancels.push(event.data)
      behaviour(message, port, cancels)
    },
    top: undefined as unknown,
    self: undefined as unknown,
    ...extra,
  }
  win.top = win.top ?? win
  win.self = win
  if (extra.top === undefined) win.top = win
  return {
    win: win as unknown as Win,
    seen,
    cancels,
    native,
    container: new CredentialsContainer(),
  }
}

const reply =
  (result: PasskeyOutcome, taken = true): Behaviour =>
  (message, port) => {
    if (message.op === 'status') return
    if (taken) port.postMessage({ op: 'ack' })
    port.postMessage({ op: 'done', result })
  }

const pending: Behaviour = (message, port) => {
  if (message.op === 'begin') port.postMessage({ op: 'ack' })
}

/** A creation as a real credential store would answer it, for the page script to build a credential from. */
async function madeCredential(): Promise<{ json: PasskeyCredentialJson; passkey: StoredPasskey }> {
  const { passkey, made } = await makeFake(
    [],
    creation(),
    'https://orbit-cloud.com',
    undefined,
    1,
    'p1',
  )
  return { json: made.response, passkey }
}

const publicKey = (over: Record<string, unknown> = {}) =>
  ({
    rp: { id: 'orbit-cloud.com', name: 'Orbit Cloud' },
    user: { id: new TextEncoder().encode('user-1'), name: 'sam@example.com', displayName: 'Sam' },
    challenge: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    excludeCredentials: [{ type: 'public-key', id: new Uint8Array([0, 1, 2]) }],
    extensions: { credProps: true },
    ...over,
  }) as PublicKeyCredentialCreationOptions

const request = (over: Record<string, unknown> = {}) =>
  ({
    rpId: 'orbit-cloud.com',
    challenge: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    allowCredentials: [],
    ...over,
  }) as PublicKeyCredentialRequestOptions

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the options as data', () => {
  it('writes a creation with every binary value base64url', () => {
    expect(serializeCreate(publicKey({ attestation: 'none', timeout: 5000 }))).toEqual({
      rp: { id: 'orbit-cloud.com', name: 'Orbit Cloud' },
      user: {
        id: toBase64Url(new TextEncoder().encode('user-1')),
        name: 'sam@example.com',
        displayName: 'Sam',
      },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      excludeCredentials: [{ type: 'public-key', id: 'AAEC' }],
      attestation: 'none',
      timeout: 5000,
      extensions: { credProps: true, prf: false, largeBlob: false },
    })
  })

  it('says which extensions are asked, and keeps no more of them', () => {
    const asked = serializeCreate(
      publicKey({ extensions: { prf: { eval: {} }, largeBlob: { support: 'required' } } }),
    )
    expect(asked.extensions).toEqual({ credProps: false, prf: true, largeBlob: true })
  })

  it('takes views of a buffer, an array buffer and a data view alike', () => {
    const bytes = Uint8Array.from([9, 8, 7, 6, 5])
    const view = new DataView(bytes.buffer, 1, 3)
    expect(serializeGet(request({ challenge: bytes.buffer })).challenge).toBe(toBase64Url(bytes))
    expect(decode(serializeGet(request({ challenge: view })).challenge)).toEqual(
      Uint8Array.of(8, 7, 6),
    )
    expect(decode(serializeGet(request({ challenge: bytes.subarray(2) })).challenge)).toEqual(
      Uint8Array.of(7, 6, 5),
    )
  })

  it('leaves out descriptors that are not public keys, and refuses a list of nothing else', () => {
    const odd = serializeGet(
      request({
        allowCredentials: [
          { type: 'public-key', id: new Uint8Array([1]) },
          { type: 'other', id: new Uint8Array([2]) },
        ],
      }),
    )
    expect(odd.allowCredentials).toEqual([{ type: 'public-key', id: 'AQ' }])
    expect(() =>
      serializeCreate(publicKey({ pubKeyCredParams: [{ type: 'other', alg: -7 }] })),
    ).toThrow()
  })

  it('writes a sign-in', () => {
    expect(serializeGet(request({ userVerification: 'preferred', timeout: 9000 }))).toEqual({
      rpId: 'orbit-cloud.com',
      challenge,
      allowCredentials: [],
      userVerification: 'preferred',
      timeout: 9000,
      extensions: { prf: false, largeBlob: false },
    })
  })
})

describe('wrapping the credentials container', () => {
  it('wraps once, and only where there is something to wrap', () => {
    const { win } = makeWindow()
    expect(installPasskeyPage(win)).toBe(true)
    expect(installPasskeyPage(win)).toBe(false)
    expect(installPasskeyPage({} as Win)).toBe(false)
  })

  it('keeps the names and lengths of the browser’s functions', () => {
    const { win, container } = makeWindow()
    installPasskeyPage(win)
    const prototype = Object.getPrototypeOf(container) as CredentialsContainer
    expect(prototype.create.name).toBe('create')
    expect(prototype.get.name).toBe('get')
    expect(prototype.create.length).toBe(0)
    expect(Object.getOwnPropertyDescriptor(prototype, 'create')).toMatchObject({
      writable: true,
      configurable: true,
      enumerable: true,
    })
  })
})

describe('creating a credential', () => {
  it('gives the page a credential built from the answer, and the bridge the request as data', async () => {
    const { json } = await madeCredential()
    const { win, seen, container } = makeWindow(reply({ outcome: 'credential', credential: json }))
    installPasskeyPage(win)
    const promise = (container as unknown as CredentialsContainer).create({
      publicKey: publicKey(),
    })
    await settle()
    const credential = (await promise) as PublicKeyCredential & {
      response: AuthenticatorAttestationResponse
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      kemlockPasskey: 1,
      op: 'begin',
      type: 'create',
      conditional: false,
      options: { rp: { id: 'orbit-cloud.com' }, challenge },
    })
    expect((seen[0] as BeginMessage).id).toMatch(/^[0-9a-f]{32}$/)
    expect(credential).toBeInstanceOf(win.PublicKeyCredential)
    expect(credential.response).toBeInstanceOf(win.AuthenticatorAttestationResponse)
    expect(credential.id).toBe(json.id)
    expect(credential.type).toBe('public-key')
    expect(credential.authenticatorAttachment).toBe('platform')
    expect(new Uint8Array(credential.rawId)).toEqual(fromBase64Url(json.rawId))
    expect(new Uint8Array(credential.response.clientDataJSON)).toEqual(
      fromBase64Url(String(json.response.clientDataJSON)),
    )
    expect(new Uint8Array(credential.response.attestationObject)).toEqual(
      fromBase64Url(String(json.response.attestationObject)),
    )
    expect(new Uint8Array(credential.response.getAuthenticatorData())).toEqual(
      fromBase64Url(String(json.response.authenticatorData)),
    )
    expect(new Uint8Array(credential.response.getPublicKey()!)).toEqual(
      fromBase64Url(String(json.response.publicKey)),
    )
    expect(credential.response.getPublicKeyAlgorithm()).toBe(-7)
    expect(credential.response.getTransports()).toEqual(['internal'])
    expect(credential.getClientExtensionResults()).toEqual({ credProps: { rk: true } })
    expect(JSON.parse(JSON.stringify(credential))).toEqual(json)
    expect(credential.toJSON()).toEqual(json)
  })

  it('calls the browser’s own function, with the page’s own arguments, when Kemlock steps aside', async () => {
    const { win, native, container } = makeWindow(reply({ outcome: 'fallback' }))
    installPasskeyPage(win)
    const options = { publicKey: publicKey() }
    const result = await (container as unknown as CredentialsContainer).create(options)
    expect(result).toBe('native-create')
    expect(native.create).toHaveBeenCalledTimes(1)
    expect(native.create.mock.calls[0]![0]).toBe(options)
    expect(native.create.mock.contexts[0]).toBe(container)
  })

  it('goes straight to the browser for what is not a public key, or can’t be read, or has been aborted', async () => {
    const { win, seen, native, container } = makeWindow(reply({ outcome: 'fallback' }))
    installPasskeyPage(win)
    const credentials = container as unknown as CredentialsContainer
    await credentials.create({ password: { id: 'x' } } as unknown as CredentialCreationOptions)
    await credentials.create(undefined)
    await credentials.create({
      publicKey: { rp: { name: 'x' } },
    } as unknown as CredentialCreationOptions)
    const controller = new AbortController()
    controller.abort()
    await credentials.create({ publicKey: publicKey(), signal: controller.signal })
    // A conditional creation is the browser's own upgrade of a password sign-in
    await credentials.create({
      publicKey: publicKey(),
      mediation: 'conditional',
    } as CredentialCreationOptions)
    expect(seen).toHaveLength(0)
    expect(native.create).toHaveBeenCalledTimes(5)
    // Not called on a container: the browser says so
    await (Object.getPrototypeOf(container) as CredentialsContainer).create.call(
      {},
      {
        publicKey: publicKey(),
      },
    )
    expect(seen).toHaveLength(0)
  })

  it('goes to the browser when the bridge never takes the request', async () => {
    const { win, native, container } = makeWindow()
    installPasskeyPage(win)
    const promise = (container as unknown as CredentialsContainer).create({
      publicKey: publicKey(),
    })
    await vi.advanceTimersByTimeAsync(1499)
    expect(native.create).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(await promise).toBe('native-create')
  })

  it('throws the exception the answer names', async () => {
    const { win, container } = makeWindow(reply({ outcome: 'error', name: 'InvalidStateError' }))
    installPasskeyPage(win)
    const failure = await (container as unknown as CredentialsContainer)
      .create({ publicKey: publicKey() })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DOMException)
    expect((failure as DOMException).name).toBe('InvalidStateError')
  })

  it('goes to the browser for an answer that is not one', async () => {
    const { win, native, container } = makeWindow((message, port) => {
      if (message.op === 'begin') port.postMessage({ op: 'done', result: { outcome: 'surprise' } })
    })
    installPasskeyPage(win)
    expect(
      await (container as unknown as CredentialsContainer).create({ publicKey: publicKey() }),
    ).toBe('native-create')
    expect(native.create).toHaveBeenCalled()
  })

  it('ends when the page aborts, telling the bridge', async () => {
    const { win, cancels, container } = makeWindow(pending)
    installPasskeyPage(win)
    const controller = new AbortController()
    const promise = (container as unknown as CredentialsContainer)
      .create({ publicKey: publicKey(), signal: controller.signal })
      .catch((error: unknown) => error)
    await settle()
    controller.abort()
    const failure = (await promise) as DOMException
    expect(failure.name).toBe('AbortError')
    await settle()
    expect(cancels).toContainEqual({ op: 'cancel' })
  })

  it('ends as not allowed when the person never answers, after the time it asked for', async () => {
    const { win, cancels, container } = makeWindow(pending)
    installPasskeyPage(win)
    const promise = (container as unknown as CredentialsContainer)
      .create({ publicKey: publicKey({ timeout: 45_000 }) })
      .catch((error: unknown) => error)
    await settle()
    await vi.advanceTimersByTimeAsync(44_999)
    let over = false
    void promise.then(() => (over = true))
    await settle()
    expect(over).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(((await promise) as DOMException).name).toBe('NotAllowedError')
    await settle()
    expect(cancels).toContainEqual({ op: 'cancel' })
  })

  it('makes no mark on the page when it ends, and keeps the browser’s other methods', async () => {
    const { win, container } = makeWindow(reply({ outcome: 'fallback' }))
    installPasskeyPage(win)
    const prototype = Object.getPrototypeOf(container) as Record<string, unknown>
    expect(Object.keys(prototype).sort()).toEqual(['create', 'get'])
  })
})

describe('getting a credential', () => {
  it('gives the page an assertion with the signature and the user handle', async () => {
    const { json, passkey } = await madeCredential()
    const signed = await signFake(passkey, challenge, 'https://orbit-cloud.com')
    const { win, seen, container } = makeWindow(
      reply({ outcome: 'credential', credential: signed }),
    )
    installPasskeyPage(win)
    const credential = (await (container as unknown as CredentialsContainer).get({
      publicKey: request(),
    })) as PublicKeyCredential & { response: AuthenticatorAssertionResponse }
    expect(seen[0]).toMatchObject({ op: 'begin', type: 'get', conditional: false })
    expect(credential).toBeInstanceOf(win.PublicKeyCredential)
    expect(credential.response).toBeInstanceOf(win.AuthenticatorAssertionResponse)
    expect(credential.id).toBe(json.id)
    expect(new Uint8Array(credential.response.signature)).toEqual(
      fromBase64Url(String(signed.response.signature)),
    )
    expect(new Uint8Array(credential.response.userHandle!)).toEqual(
      fromBase64Url(String(signed.response.userHandle)),
    )
    expect(new Uint8Array(credential.response.authenticatorData)).toEqual(
      fromBase64Url(String(signed.response.authenticatorData)),
    )
    expect(credential.toJSON()).toEqual(signed)
  })

  it('gives a passkey with no user handle a null one', async () => {
    const { passkey } = await madeCredential()
    const signed = await signFake(
      { ...passkey, userHandle: '' },
      challenge,
      'https://orbit-cloud.com',
    )
    const { win, container } = makeWindow(reply({ outcome: 'credential', credential: signed }))
    installPasskeyPage(win)
    const credential = (await (container as unknown as CredentialsContainer).get({
      publicKey: request(),
    })) as PublicKeyCredential & { response: AuthenticatorAssertionResponse }
    expect(credential.response.userHandle).toBeNull()
  })

  it('goes to the browser when Kemlock steps aside', async () => {
    const { win, native, container } = makeWindow(reply({ outcome: 'fallback' }))
    installPasskeyPage(win)
    expect(await (container as unknown as CredentialsContainer).get({ publicKey: request() })).toBe(
      'native-get',
    )
    expect(native.get).toHaveBeenCalledTimes(1)
  })
})

describe('a conditional sign-in', () => {
  /** The browser's own request: pending until the test settles it, and ended by the signal it was given. */
  function nativeRequest(native: {
    get: { mockImplementation(fn: (...args: unknown[]) => unknown): unknown }
  }) {
    let resolve!: (value: unknown) => void
    let reject!: (error: unknown) => void
    native.get.mockImplementation((...args: unknown[]) => {
      const signal = (args[0] as { signal?: AbortSignal }).signal
      return new Promise((done, fail) => {
        resolve = done
        reject = fail
        signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')))
      })
    })
    return { resolve: (v: unknown) => resolve(v), reject: (e: unknown) => reject(e) }
  }

  const conditional = () => ({ publicKey: request(), mediation: 'conditional' as const })

  it('runs the browser’s own request and registers Kemlock’s, and Kemlock’s answer ends both', async () => {
    // A sign-in is answered with an assertion: the passkey signs the page's challenge
    const { passkey } = await madeCredential()
    const json = await signFake(passkey, challenge, 'https://orbit-cloud.com')
    let port: MessagePort | undefined
    const { win, seen, native, container } = makeWindow((message, p) => {
      if (message.op === 'begin') p.postMessage({ op: 'ack' })
      port = p
    })
    const browser = nativeRequest(native)
    installPasskeyPage(win)
    const options = conditional()
    const promise = (container as unknown as CredentialsContainer).get(options)
    await settle()
    expect(seen[0]).toMatchObject({ op: 'begin', type: 'get', conditional: true })
    const given = native.get.mock.calls[0]![0] as {
      signal: AbortSignal
      mediation: string
      publicKey: unknown
    }
    expect(given.mediation).toBe('conditional')
    expect(given.publicKey).toBe(options.publicKey)
    expect(given.signal.aborted).toBe(false)
    port!.postMessage({ op: 'done', result: { outcome: 'credential', credential: json } })
    const credential = (await promise) as PublicKeyCredential
    expect(credential.id).toBe(json.id)
    // The browser's own request is ended
    expect(given.signal.aborted).toBe(true)
    browser.resolve('late')
    await settle()
  })

  it('is ended by the browser’s answer, and Kemlock’s request is cancelled', async () => {
    const { win, cancels, native, container } = makeWindow(pending)
    const browser = nativeRequest(native)
    installPasskeyPage(win)
    const promise = (container as unknown as CredentialsContainer).get(conditional())
    await settle()
    browser.resolve('from-the-browser')
    expect(await promise).toBe('from-the-browser')
    await settle()
    expect(cancels).toContainEqual({ op: 'cancel' })
  })

  it('waits for Kemlock when the browser’s request fails first, and takes the failure if Kemlock steps aside', async () => {
    let port: MessagePort | undefined
    const { win, native, container } = makeWindow((message, p) => {
      if (message.op === 'begin') p.postMessage({ op: 'ack' })
      port = p
    })
    const browser = nativeRequest(native)
    installPasskeyPage(win)
    const promise = (container as unknown as CredentialsContainer)
      .get(conditional())
      .catch((error: unknown) => error)
    await settle()
    browser.reject(new DOMException('no conditional UI', 'NotSupportedError'))
    await settle()
    let over = false
    void promise.then(() => (over = true))
    await settle()
    expect(over).toBe(false)
    port!.postMessage({ op: 'done', result: { outcome: 'fallback' } })
    expect(((await promise) as DOMException).name).toBe('NotSupportedError')
  })

  it('leaves the browser’s request alone when Kemlock steps aside first', async () => {
    const { win, native, container } = makeWindow(reply({ outcome: 'fallback' }))
    const browser = nativeRequest(native)
    installPasskeyPage(win)
    const promise = (container as unknown as CredentialsContainer).get(conditional())
    await settle()
    browser.resolve('from-the-browser')
    expect(await promise).toBe('from-the-browser')
  })

  it('ends when the page aborts, on both sides', async () => {
    const { win, cancels, native, container } = makeWindow(pending)
    nativeRequest(native)
    installPasskeyPage(win)
    const controller = new AbortController()
    const promise = (container as unknown as CredentialsContainer)
      .get({ ...conditional(), signal: controller.signal })
      .catch((error: unknown) => error)
    await settle()
    controller.abort()
    expect(((await promise) as DOMException).name).toBe('AbortError')
    await settle()
    expect(cancels).toContainEqual({ op: 'cancel' })
  })
})

describe('what the page can see of the wrapper', () => {
  it('hands the browser’s own error to the page as it is, and its own call once', async () => {
    const { win, native, container } = makeWindow(reply({ outcome: 'fallback' }))
    const failure = new DOMException('no authenticator', 'NotSupportedError')
    native.create.mockRejectedValueOnce(failure)
    installPasskeyPage(win)
    const caught = await (container as unknown as CredentialsContainer)
      .create({ publicKey: publicKey() })
      .catch((error: unknown) => error)
    expect(caught).toBe(failure)
    expect(native.create).toHaveBeenCalledTimes(1)
  })

  it('reads each option of the page once, and calls the browser once when one throws', async () => {
    const { win, seen, native, container } = makeWindow(reply({ outcome: 'fallback' }))
    installPasskeyPage(win)
    let reads = 0
    const options = {
      get publicKey(): never {
        reads += 1
        throw new Error('a getter of the page’s own')
      },
    }
    await (container as unknown as CredentialsContainer).create(
      options as CredentialCreationOptions,
    )
    expect(reads).toBe(1)
    expect(native.create).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
    const counted = {
      publicKey: publicKey(),
      get signal() {
        reads += 10
        return undefined
      },
    }
    reads = 0
    await (container as unknown as CredentialsContainer).create(
      counted as CredentialCreationOptions,
    )
    expect(reads).toBe(10)
  })

  it('calls the browser once when the page’s arguments make its own function throw', async () => {
    const { win, native, container } = makeWindow()
    native.get.mockImplementationOnce(() => {
      throw new TypeError('illegal')
    })
    installPasskeyPage(win)
    expect(() => (container as unknown as CredentialsContainer).get(undefined)).toThrow('illegal')
    expect(native.get).toHaveBeenCalledTimes(1)
  })

  it('waits two minutes by default for the person, and as long as the page asked within the limits', async () => {
    const { win, container } = makeWindow(pending)
    installPasskeyPage(win)
    const settled = vi.fn()
    void (container as unknown as CredentialsContainer)
      .create({ publicKey: publicKey() })
      .catch((error: unknown) => settled((error as DOMException).name))
    await settle()
    await vi.advanceTimersByTimeAsync(119_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    await settle()
    expect(settled).toHaveBeenCalledWith('NotAllowedError')
  })
})

describe('the availability checks', () => {
  const statusBehaviour =
    (active: boolean): Behaviour =>
    (message, port) => {
      if (message.op === 'status') port.postMessage({ op: 'status', active })
    }

  it('say yes when Kemlock answers here, whatever the browser would say', async () => {
    const { win } = makeWindow(statusBehaviour(true))
    installPasskeyPage(win)
    expect(await win.PublicKeyCredential.isConditionalMediationAvailable()).toBe(true)
    expect(await win.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(true)
  })

  it('say what the browser says when Kemlock does not answer here, or the bridge is silent', async () => {
    const { win } = makeWindow(statusBehaviour(false))
    installPasskeyPage(win)
    expect(await win.PublicKeyCredential.isConditionalMediationAvailable()).toBe(false)
    const silent = makeWindow()
    installPasskeyPage(silent.win)
    const asked = silent.win.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    await vi.advanceTimersByTimeAsync(1600)
    expect(await asked).toBe(false)
  })
})
