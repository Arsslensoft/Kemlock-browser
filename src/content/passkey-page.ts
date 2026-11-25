// The passkey provider's script in the page's own world (docs/plans/add-passkeys.md). It runs at `document_start`, before any script of
// the page, and wraps `navigator.credentials.create` and `.get` (and the two availability checks) for requests that ask for a
// public key. It decides nothing that matters: it turns the request into plain data, asks the bridge (which asks the background),
// and either gives the page a `PublicKeyCredential`-shaped object built from the answer, throws the exception the answer says, or
// calls the browser's own function, kept before the page could change it, so security keys and phones still work.
//
// Everything it knows the page knows too. What it must get right is small: never answer a request the person didn't allow (the
// answer only ever comes from the background, over a port this script made for that request), and never take away the browser's
// own way when Kemlock doesn't answer.
import {
  fromBase64Url,
  toBase64Url,
  type PasskeyCreationOptions,
  type PasskeyCredentialJson,
  type PasskeyErrorName,
  type PasskeyOutcome,
  type PasskeyRequestOptions,
} from '../shared/passkeys'
import { modalTimeout } from '../shared/passkey-timeout'
import { isRecord, type BeginMessage, type StatusMessage } from './passkey-protocol'

type Win = Window & typeof globalThis

/** How long the bridge has to say it has the request: a frame without it is left to the browser. */
const ackMs = 1500

const errorNames: ReadonlySet<string> = new Set<PasskeyErrorName>([
  'NotAllowedError',
  'InvalidStateError',
  'NotSupportedError',
  'SecurityError',
  'AbortError',
  'EncodingError',
  'UnknownError',
])

const errorText: Record<PasskeyErrorName, string> = {
  NotAllowedError: 'The operation either timed out or was not allowed.',
  InvalidStateError: 'The authenticator was previously registered.',
  NotSupportedError: 'No supported authenticator could be used.',
  SecurityError: 'The relying party is not valid for this origin.',
  AbortError: 'The operation was aborted.',
  EncodingError: 'The request could not be read.',
  UnknownError: 'The operation failed for an unknown reason.',
}

/* ----------------------------------------------------------------------------------------------- */
/* Turning options into data, and an answer into a credential                                        */
/* ----------------------------------------------------------------------------------------------- */

function bytesOf(source: BufferSource): string {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source)
  return toBase64Url(view)
}

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const descriptors = (list: PublicKeyCredentialDescriptor[] | undefined) =>
  (list ?? [])
    .filter((descriptor) => descriptor.type === 'public-key')
    .map((descriptor) => ({ type: 'public-key' as const, id: bytesOf(descriptor.id) }))

/** The creation options as data; throws for what the browser itself would refuse, which it then does. */
export function serializeCreate(pk: PublicKeyCredentialCreationOptions): PasskeyCreationOptions {
  const rpId = textOf(pk.rp.id)
  const displayName = textOf(pk.user.displayName)
  const params = (pk.pubKeyCredParams ?? []).filter((param) => param.type === 'public-key')
  if ((pk.pubKeyCredParams ?? []).length > 0 && params.length === 0) throw new Error('no algorithm')
  const selection = pk.authenticatorSelection
  const extensions = pk.extensions as Record<string, unknown> | undefined
  return {
    rp: { ...(rpId === undefined ? {} : { id: rpId }), name: String(pk.rp.name ?? '') },
    user: {
      id: bytesOf(pk.user.id),
      name: String(pk.user.name ?? ''),
      ...(displayName === undefined ? {} : { displayName }),
    },
    challenge: bytesOf(pk.challenge),
    pubKeyCredParams: params.map((param) => ({
      type: 'public-key' as const,
      alg: Number(param.alg),
    })),
    excludeCredentials: descriptors(pk.excludeCredentials),
    ...(selection === undefined
      ? {}
      : {
          authenticatorSelection: {
            ...(textOf(selection.authenticatorAttachment) === undefined
              ? {}
              : { authenticatorAttachment: selection.authenticatorAttachment }),
            ...(textOf(selection.residentKey) === undefined
              ? {}
              : { residentKey: selection.residentKey }),
            ...(typeof selection.requireResidentKey === 'boolean'
              ? { requireResidentKey: selection.requireResidentKey }
              : {}),
            ...(textOf(selection.userVerification) === undefined
              ? {}
              : { userVerification: selection.userVerification }),
          },
        }),
    ...(textOf(pk.attestation) === undefined ? {} : { attestation: pk.attestation }),
    ...(typeof pk.timeout === 'number' ? { timeout: pk.timeout } : {}),
    extensions: {
      credProps: extensions?.credProps === true,
      prf: extensions?.prf !== undefined,
      largeBlob: extensions?.largeBlob !== undefined,
    },
  }
}

/** The sign-in options as data. */
export function serializeGet(pk: PublicKeyCredentialRequestOptions): PasskeyRequestOptions {
  const rpId = textOf(pk.rpId)
  const extensions = pk.extensions as Record<string, unknown> | undefined
  return {
    ...(rpId === undefined ? {} : { rpId }),
    challenge: bytesOf(pk.challenge),
    allowCredentials: descriptors(pk.allowCredentials),
    ...(textOf(pk.userVerification) === undefined ? {} : { userVerification: pk.userVerification }),
    ...(typeof pk.timeout === 'number' ? { timeout: pk.timeout } : {}),
    extensions: {
      prf: extensions?.prf !== undefined,
      largeBlob: extensions?.largeBlob !== undefined,
    },
  }
}

function buffer(text: unknown): ArrayBuffer {
  const bytes = typeof text === 'string' ? fromBase64Url(text) : null
  if (bytes === null) throw new Error('not base64url')
  return bytes.buffer as ArrayBuffer
}

function define(target: object, name: string, value: unknown, data = true): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: data,
    writable: !data,
    configurable: true,
  })
}

/**
 * A `PublicKeyCredential`-shaped object for the answer: its prototype is the browser's own, so `instanceof` and the class name hold,
 * and the fields a site reads are its own properties (the prototype's accessors need the browser's internal state, which a
 * made-up object doesn't have).
 */
export function credentialFrom(win: Win, json: PasskeyCredentialJson, create: boolean): Credential {
  const parts = json.response
  const response = Object.create(
    (create ? win.AuthenticatorAttestationResponse : win.AuthenticatorAssertionResponse)
      ?.prototype ?? Object.prototype,
  ) as object
  define(response, 'clientDataJSON', buffer(parts.clientDataJSON))
  if (create) {
    const authenticatorData = buffer(parts.authenticatorData)
    define(response, 'attestationObject', buffer(parts.attestationObject))
    define(response, 'getAuthenticatorData', () => authenticatorData.slice(0), false)
    define(response, 'getPublicKey', () => buffer(parts.publicKey), false)
    define(response, 'getPublicKeyAlgorithm', () => Number(parts.publicKeyAlgorithm), false)
    define(
      response,
      'getTransports',
      () => (Array.isArray(parts.transports) ? [...(parts.transports as string[])] : []),
      false,
    )
  } else {
    define(response, 'authenticatorData', buffer(parts.authenticatorData))
    define(response, 'signature', buffer(parts.signature))
    // A passkey with no user handle gives null, as the browser's own does
    define(
      response,
      'userHandle',
      typeof parts.userHandle === 'string' && parts.userHandle !== ''
        ? buffer(parts.userHandle)
        : null,
    )
  }
  const credential = Object.create(win.PublicKeyCredential?.prototype ?? Object.prototype) as object
  define(credential, 'id', json.id)
  define(credential, 'rawId', buffer(json.rawId))
  define(credential, 'type', 'public-key')
  define(credential, 'authenticatorAttachment', json.authenticatorAttachment ?? null)
  define(credential, 'response', response)
  define(credential, 'getClientExtensionResults', () => ({ ...json.clientExtensionResults }), false)
  define(credential, 'toJSON', () => JSON.parse(JSON.stringify(json)) as unknown, false)
  return credential as Credential
}

/* ----------------------------------------------------------------------------------------------- */
/* Asking the bridge                                                                                 */
/* ----------------------------------------------------------------------------------------------- */

function randomId(win: Win): string {
  const bytes = win.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** What the bridge says a request ended as; null for an answer that isn't one (the browser's own way then). */
export function readOutcome(value: unknown): PasskeyOutcome | null {
  if (!isRecord(value)) return null
  if (value.outcome === 'fallback') return { outcome: 'fallback' }
  if (value.outcome === 'error' && typeof value.name === 'string' && errorNames.has(value.name))
    return { outcome: 'error', name: value.name as PasskeyErrorName }
  if (value.outcome === 'credential' && isRecord(value.credential)) {
    const { credential } = value
    if (
      typeof credential.id === 'string' &&
      typeof credential.rawId === 'string' &&
      isRecord(credential.response) &&
      isRecord(credential.clientExtensionResults)
    )
      return { outcome: 'credential', credential: credential as unknown as PasskeyCredentialJson }
  }
  return null
}

interface Session {
  /** How it ended; null when the bridge never took it. */
  result: Promise<PasskeyOutcome | null>
  cancel(): void
}

function begin(
  win: Win,
  type: 'create' | 'get',
  conditional: boolean,
  options: PasskeyCreationOptions | PasskeyRequestOptions,
): Session {
  const channel = new win.MessageChannel()
  let finish: (outcome: PasskeyOutcome | null) => void = () => undefined
  const result = new Promise<PasskeyOutcome | null>((resolve) => (finish = resolve))
  let taken = false
  const timer = setTimeout(() => {
    if (taken) return
    channel.port1.close()
    finish(null)
  }, ackMs)
  channel.port1.onmessage = (event: MessageEvent) => {
    const data: unknown = event.data
    if (!isRecord(data)) return
    if (data.op === 'ack') {
      taken = true
      clearTimeout(timer)
    } else if (data.op === 'done') {
      taken = true
      clearTimeout(timer)
      channel.port1.close()
      finish(readOutcome(data.result))
    }
  }
  const message: BeginMessage = {
    kemlockPasskey: 1,
    op: 'begin',
    id: randomId(win),
    type,
    conditional,
    options,
  }
  win.postMessage(message, '*', [channel.port2])
  return {
    result,
    cancel() {
      clearTimeout(timer)
      try {
        channel.port1.postMessage({ op: 'cancel' })
      } catch {
        // The port is closed already: the request ended
      }
      channel.port1.close()
      finish(null)
    },
  }
}

/** Whether Kemlock answers passkey requests in this frame now; false when the bridge doesn't say. */
function active(win: Win): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new win.MessageChannel()
    const timer = setTimeout(() => {
      channel.port1.close()
      resolve(false)
    }, ackMs)
    channel.port1.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data
      if (!isRecord(data) || data.op !== 'status') return
      clearTimeout(timer)
      channel.port1.close()
      resolve(data.active === true)
    }
    const message: StatusMessage = { kemlockPasskey: 1, op: 'status' }
    win.postMessage(message, '*', [channel.port2])
  })
}

/* ----------------------------------------------------------------------------------------------- */
/* The wrappers                                                                                      */
/* ----------------------------------------------------------------------------------------------- */

const installed = Symbol.for('kemlock.passkey.page')

/**
 * What the page can read of an error: the extension's own address, which is in the stack of anything made while one of our
 * frames is on it, names this extension and its id to a page that looks. Errors that pass through here lose those lines.
 * What remains: a getter or a proxy of the page's own that runs while our function is reading its options (it can read
 * `new Error().stack` and see our frame), which can't be avoided while the options are read at all; each is read once, at the top.
 */
const ownAddress: string | undefined = (() => {
  try {
    return /(?:chrome|moz|safari-web)-extension:\/\/[^/\s)]+/.exec(new Error().stack ?? '')?.[0]
  } catch {
    return undefined
  }
})()

function scrubError<E>(error: E): E {
  if (ownAddress === undefined || typeof error !== 'object' || error === null) return error
  try {
    const stack = (error as { stack?: unknown }).stack
    if (typeof stack === 'string' && stack.includes(ownAddress)) {
      const kept = stack
        .split('\n')
        .filter((line) => !line.includes(ownAddress))
        .join('\n')
      Object.defineProperty(error, 'stack', { value: kept, writable: true, configurable: true })
    }
  } catch {
    // An error that can't be changed is passed on as it is
  }
  return error
}

/** The browser's own function, run so that what it throws or rejects with shows no line of ours. */
function scrubbed<T>(call: () => Promise<T>): Promise<T> {
  try {
    return call().catch((error: unknown) => {
      throw scrubError(error)
    })
  } catch (error) {
    throw scrubError(error)
  }
}

/**
 * Wraps the credentials container in [win]. Calling it twice does nothing the second time. Answers whether it wrapped anything
 * (a page without WebAuthn has nothing to wrap).
 */
export function installPasskeyPage(win: Win): boolean {
  const scope = win as unknown as Record<symbol, boolean>
  if (scope[installed] === true) return false
  const proto = win.CredentialsContainer?.prototype
  if (proto === undefined) return false
  const createDescriptor = Object.getOwnPropertyDescriptor(proto, 'create')
  const getDescriptor = Object.getOwnPropertyDescriptor(proto, 'get')
  const originalCreate = createDescriptor?.value as CredentialsContainer['create'] | undefined
  const originalGet = getDescriptor?.value as CredentialsContainer['get'] | undefined
  if (typeof originalCreate !== 'function' || typeof originalGet !== 'function') return false
  // Bound once the check passes: the functions below are hoisted, so they would not see the narrowing
  const nativeCreate: CredentialsContainer['create'] = originalCreate
  const nativeGet: CredentialsContainer['get'] = originalGet
  scope[installed] = true

  const exception = (name: PasskeyErrorName) =>
    scrubError(new win.DOMException(errorText[name], name))
  const isContainer = (value: unknown) => value instanceof win.CredentialsContainer

  /** Gives the request to Kemlock and ends as the answer says; the browser's own function when it doesn't answer. */
  function serve(
    type: 'create' | 'get',
    data: PasskeyCreationOptions | PasskeyRequestOptions,
    signal: AbortSignal | undefined,
    timeout: number | undefined,
    native: () => Promise<Credential | null>,
  ): Promise<Credential | null> {
    const session = begin(win, type, false, data)
    return new Promise((resolve, reject) => {
      let over = false
      const end = (action: () => void) => {
        if (over) return
        over = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        action()
      }
      const onAbort = () =>
        end(() => {
          session.cancel()
          reject(signal?.reason ?? exception('AbortError'))
        })
      const timer = setTimeout(
        () =>
          end(() => {
            session.cancel()
            reject(exception('NotAllowedError'))
          }),
        // A request the person never answers ends as the browser's own would, as not allowed
        modalTimeout(timeout),
      )
      signal?.addEventListener('abort', onAbort, { once: true })
      void session.result.then((outcome) =>
        end(() => {
          if (outcome === null || outcome.outcome === 'fallback') native().then(resolve, reject)
          else if (outcome.outcome === 'error') reject(exception(outcome.name))
          else {
            try {
              resolve(credentialFrom(win, outcome.credential, type === 'create'))
            } catch {
              native().then(resolve, reject)
            }
          }
        }),
      )
    })
  }

  /**
   * A conditional request: the browser's own request runs as it would, and Kemlock registers the page's with the background, so a
   * field's menu can answer it. Whichever answers first wins, and the other is cancelled.
   */
  function serveConditional(
    self: unknown,
    options: CredentialRequestOptions,
    data: PasskeyRequestOptions,
  ): Promise<Credential | null> {
    const nativeAbort = new win.AbortController()
    const signal =
      options.signal === undefined || options.signal === null
        ? nativeAbort.signal
        : win.AbortSignal.any([options.signal, nativeAbort.signal])
    const nativeRequest = scrubbed(() =>
      nativeGet.call(self as CredentialsContainer, { ...options, signal }),
    )
    const session = begin(win, 'get', true, data)
    return new Promise((resolve, reject) => {
      let over = false
      let oursPending = true
      const failed: { native: { error: unknown } | null } = { native: null }
      nativeRequest.then(
        (credential) => {
          if (over) return
          over = true
          session.cancel()
          resolve(credential)
        },
        (error: unknown) => {
          if (over) return
          // Kemlock may still answer, unless the page itself ended the request
          if (oursPending && options.signal?.aborted !== true) {
            failed.native = { error }
            return
          }
          over = true
          session.cancel()
          reject(error)
        },
      )
      void session.result.then((outcome) => {
        oursPending = false
        if (over) return
        if (outcome !== null && outcome.outcome === 'credential') {
          try {
            const credential = credentialFrom(win, outcome.credential, false)
            over = true
            nativeAbort.abort()
            resolve(credential)
            return
          } catch {
            // Not a credential the page can take: the browser's own request goes on
          }
        }
        // Kemlock steps aside; the browser's request already failed, so its failure is the answer
        if (failed.native !== null) {
          over = true
          reject(failed.native.error)
        }
      })
    })
  }

  function create(
    this: unknown,
    ...args: [CredentialCreationOptions?]
  ): Promise<Credential | null> {
    const self = this as CredentialsContainer
    const native = () => scrubbed(() => nativeCreate.apply(self, args))
    // Every option of the page is read once, here; whatever can't be read is the browser's to answer, with its own exception
    let plan: (() => Promise<Credential | null>) | null = null
    try {
      const options = args[0]
      const pk = options?.publicKey
      const signal = options?.signal ?? undefined
      const mediation = (options as { mediation?: string } | undefined)?.mediation
      // A creation the browser offers by itself, as an upgrade of a password sign-in, is the browser's own
      if (options !== undefined && pk !== undefined && isContainer(self)) {
        if (signal?.aborted !== true && mediation !== 'conditional') {
          const data = serializeCreate(pk)
          plan = () => serve('create', data, signal, data.timeout, native)
        }
      }
    } catch {
      plan = null
    }
    return plan === null ? native() : plan()
  }

  function get(this: unknown, ...args: [CredentialRequestOptions?]): Promise<Credential | null> {
    const self = this as CredentialsContainer
    const native = () => scrubbed(() => nativeGet.apply(self, args))
    let plan: (() => Promise<Credential | null>) | null = null
    try {
      const options = args[0]
      const pk = options?.publicKey
      const signal = options?.signal ?? undefined
      const mediation = options?.mediation
      if (
        options !== undefined &&
        pk !== undefined &&
        isContainer(self) &&
        signal?.aborted !== true
      ) {
        const data = serializeGet(pk)
        plan =
          mediation === 'conditional'
            ? () => serveConditional(self, options, data)
            : () => serve('get', data, signal, data.timeout, native)
      }
    } catch {
      plan = null
    }
    return plan === null ? native() : plan()
  }

  Object.defineProperty(proto, 'create', { ...createDescriptor, value: create })
  Object.defineProperty(proto, 'get', { ...getDescriptor, value: get })

  // A site decides whether to offer passkeys from these: true when Kemlock answers, the browser's own word otherwise
  const statics = win.PublicKeyCredential as unknown as Record<string, unknown> | undefined
  for (const name of [
    'isUserVerifyingPlatformAuthenticatorAvailable',
    'isConditionalMediationAvailable',
  ]) {
    const original = statics?.[name]
    if (statics === undefined || typeof original !== 'function') continue
    const wrapped = function (this: unknown, ...args: unknown[]): Promise<boolean> {
      const call = original as (...a: unknown[]) => unknown
      const native = () => scrubbed(() => Promise.resolve(call.apply(this, args) as boolean))
      return active(win).then((on) => (on ? true : native()), native)
    }
    Object.defineProperty(statics, name, {
      ...Object.getOwnPropertyDescriptor(statics, name),
      value: wrapped,
    })
  }
  return true
}
