// The WebAuthn side of unlocking the vault with a passkey, Windows Hello, Touch ID or a security key
// (docs/plans/add-passkey-unlock.md). It runs in a tab page of the extension: the popup closes when the prompt takes focus.
//
// The PRF extension gives each credential 32 secret bytes for an input only the vault knows (its salt); the core wraps the vault's key
// under them. Nothing here keeps a secret: the answers go to the background, which hands them to the core.
import type {
  NewPasskey,
  PasskeyEnrolOptions,
  PasskeyUnlockAnswer,
  PasskeyUnlockInfo,
} from '../shared/api'

/** A credential just made, with the PRF output it gave: what the core keeps once the password is checked. */
export type MadeCredential = Omit<NewPasskey, 'password'>

/** How long the browser's prompt waits, in milliseconds. */
const timeoutMs = 120_000

/** What the person chose to make: the device's own (Windows Hello, Touch ID, a passkey), a security key, or the browser's choice. */
export type Attachment = 'platform' | 'cross-platform' | 'any'

/**
 * Whether the browser can give a credential's PRF output: `unknown` where it can't say (the answer is checked when one is made), and
 * `firefox` where it is not offered at all: a Firefox extension page can only name a web domain as the relying party, so the
 * credential would answer to any page of that domain too (docs/plans/add-passkey-unlock.md). Chrome and Edge bind the credential to
 * the extension's own id.
 */
export type PrfSupport = 'yes' | 'no' | 'unknown' | 'firefox'

/** Why a ceremony ended, as a word the page puts in its own: the person's dismissal is `cancelled`, not a failure. */
export type CeremonyCode =
  'cancelled' | 'unsupported' | 'firefox' | 'noPrf' | 'duplicate' | 'security' | 'failed'

export class CeremonyError extends Error {
  constructor(readonly code: CeremonyCode) {
    super(code)
    this.name = 'CeremonyError'
  }
}

/** Which browser this build is for; the tests, which have no build, are Chrome. */
const browserName = (): 'chrome' | 'firefox' | 'safari' =>
  typeof __BROWSER__ === 'undefined' ? 'chrome' : __BROWSER__

/** Whether this is Firefox, where passkey unlock is not offered. */
export const isFirefox = (): boolean => browserName() === 'firefox'

/** The relying party's id the vault's credentials were made for; none, so the browser's default, the extension's own id. */
export function relyingParty(stored?: string): string | undefined {
  return stored !== undefined && stored !== '' ? stored : undefined
}

/* ----------------------------------------------------------------------------------------------- */
/* Bytes                                                                                             */
/* ----------------------------------------------------------------------------------------------- */

export function toBase64url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let text = ''
  for (const byte of view) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new CeremonyError('failed')
  const padded = text
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(length))

/* ----------------------------------------------------------------------------------------------- */
/* Support                                                                                           */
/* ----------------------------------------------------------------------------------------------- */

interface CapabilitiesApi {
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>
}

/**
 * Whether this browser has the PRF extension: `firefox` in Firefox, which doesn't offer it, `no` without WebAuthn or when it says it has no PRF, `yes` when it says it has,
 * `unknown` when it can't say (no `getClientCapabilities`): the option is then offered, and making a credential checks.
 */
export async function prfSupport(): Promise<PrfSupport> {
  if (isFirefox()) return 'firefox'
  const credentials = (globalThis as { navigator?: { credentials?: unknown } }).navigator
    ?.credentials
  const api = (globalThis as { PublicKeyCredential?: CapabilitiesApi }).PublicKeyCredential
  if (api === undefined || credentials === undefined || credentials === null) return 'no'
  if (typeof api.getClientCapabilities !== 'function') return 'unknown'
  try {
    const prf = (await api.getClientCapabilities.call(api))['extension:prf']
    return prf === true ? 'yes' : prf === false ? 'no' : 'unknown'
  } catch {
    return 'unknown'
  }
}

/* ----------------------------------------------------------------------------------------------- */
/* The browser's answers                                                                             */
/* ----------------------------------------------------------------------------------------------- */

interface PrfResults {
  enabled?: boolean
  results?: { first?: ArrayBuffer | ArrayBufferView }
}

const prfOf = (credential: PublicKeyCredential): PrfResults | undefined =>
  (credential.getClientExtensionResults() as unknown as { prf?: PrfResults }).prf

/** A dismissal, a timeout and the rest, as a ceremony's own words. */
function failure(error: unknown): CeremonyError {
  if (error instanceof CeremonyError) return error
  const name = (error as { name?: unknown } | null)?.name
  switch (name) {
    // The person dismissed the prompt, or it timed out: the browser says the same for both
    case 'NotAllowedError':
    case 'AbortError':
      return new CeremonyError('cancelled')
    // A credential of the excluded list is already on the authenticator
    case 'InvalidStateError':
      return new CeremonyError('duplicate')
    case 'SecurityError':
      return new CeremonyError('security')
    case 'NotSupportedError':
      return new CeremonyError('unsupported')
    default:
      return new CeremonyError('failed')
  }
}

const credentialsApi = (): CredentialsContainer => {
  if (typeof navigator === 'undefined' || navigator.credentials === undefined)
    throw new CeremonyError('unsupported')
  return navigator.credentials
}

/** A ceremony isn't run in Firefox, whatever page asks for it. */
function notInFirefox(): void {
  if (isFirefox()) throw new CeremonyError('firefox')
}

/** The PRF output a credential gives for [salt]: one prompt. */
async function readPrf(
  credentialId: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  rpId: string | undefined,
  transports?: string[],
): Promise<string> {
  return (await getAssertion([{ id: credentialId, transports }], salt, rpId)).prfOutput
}

async function getAssertion(
  credentials: { id: Uint8Array<ArrayBuffer>; transports?: string[] | undefined }[],
  salt: Uint8Array<ArrayBuffer>,
  rpId: string | undefined,
): Promise<PasskeyUnlockAnswer> {
  let assertion: Credential | null
  try {
    assertion = await credentialsApi().get({
      publicKey: {
        challenge: randomBytes(32),
        ...(rpId === undefined ? {} : { rpId }),
        allowCredentials: credentials.map(({ id, transports }) => ({
          type: 'public-key' as const,
          id,
          ...(transports === undefined || transports.length === 0
            ? {}
            : { transports: transports as AuthenticatorTransport[] }),
        })),
        userVerification: 'required',
        timeout: timeoutMs,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })
  } catch (error) {
    throw failure(error)
  }
  if (assertion === null) throw new CeremonyError('cancelled')
  const credential = assertion as PublicKeyCredential
  const first = prfOf(credential)?.results?.first
  if (first === undefined) throw new CeremonyError('noPrf')
  const output = toBase64url(first)
  // 32 bytes, as every HMAC-SHA-256 PRF gives
  if (output.length !== 43) throw new CeremonyError('noPrf')
  return { credentialId: toBase64url(credential.rawId), prfOutput: output }
}

/* ----------------------------------------------------------------------------------------------- */
/* Making a credential                                                                               */
/* ----------------------------------------------------------------------------------------------- */

/**
 * Makes a credential with the PRF extension for [options], and asks it once more for the output: the one the slot wraps, so that what
 * unlocking reads later is what was wrapped, whatever the authenticator does at creation. Two prompts.
 */
export async function makeCredential(
  options: PasskeyEnrolOptions,
  attachment: Attachment,
  name: string,
): Promise<MadeCredential> {
  notInFirefox()
  const rpId = relyingParty(options.rpId)
  const salt = fromBase64url(options.salt)
  let created: Credential | null
  try {
    created = await credentialsApi().create({
      publicKey: {
        rp: { name: 'Kemlock', ...(rpId === undefined ? {} : { id: rpId }) },
        // A handle of its own for each credential, so an authenticator that keys them by it keeps them all
        user: { id: randomBytes(16), name, displayName: name },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'discouraged',
          ...(attachment === 'any' ? {} : { authenticatorAttachment: attachment }),
        },
        excludeCredentials: options.exclude.map((id) => ({
          type: 'public-key' as const,
          id: fromBase64url(id),
        })),
        attestation: 'none',
        timeout: timeoutMs,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })
  } catch (error) {
    throw failure(error)
  }
  if (created === null) throw new CeremonyError('cancelled')
  const credential = created as PublicKeyCredential
  const prf = prfOf(credential)
  // An authenticator without PRF says nothing, or `enabled: false`
  if (prf === undefined || (prf.enabled !== true && prf.results?.first === undefined))
    throw new CeremonyError('noPrf')
  const transports = (credential.response as AuthenticatorAttestationResponse).getTransports?.()
  const prfOutput = await readPrf(new Uint8Array(credential.rawId), salt, rpId, transports)
  return {
    name,
    credentialId: toBase64url(credential.rawId),
    prfOutput,
    ...(rpId === undefined ? {} : { rpId }),
    ...(credential.authenticatorAttachment === 'platform' ||
    credential.authenticatorAttachment === 'cross-platform'
      ? { attachment: credential.authenticatorAttachment }
      : {}),
    ...(transports === undefined || transports.length === 0 ? {} : { transports }),
  }
}

/* ----------------------------------------------------------------------------------------------- */
/* Unlocking                                                                                         */
/* ----------------------------------------------------------------------------------------------- */

/** Asks the vault's credentials, whichever answers, for the PRF output: one prompt. */
export async function askCredentials(info: PasskeyUnlockInfo): Promise<PasskeyUnlockAnswer> {
  if (info.credentials.length === 0 || info.salt === undefined) throw new CeremonyError('failed')
  notInFirefox()
  const rpId = relyingParty(info.rpId)
  return getAssertion(
    info.credentials.map((credential) => ({
      id: fromBase64url(credential.credentialId),
      transports: credential.transports,
    })),
    fromBase64url(info.salt),
    rpId,
  )
}
