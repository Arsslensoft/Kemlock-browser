// The passkey provider's types (docs/plans/add-passkeys.md), shared by the page scripts, the background, the menu and the popup.
//
// A WebAuthn request travels as the JSON form of its options (`PublicKeyCredentialCreationOptionsJSON` and
// `PublicKeyCredentialRequestOptionsJSON`, WebAuthn Level 3): every binary value base64url, no functions. The answer travels as
// the JSON form of the credential (`RegistrationResponseJSON`, `AuthenticationResponseJSON`). Kemlock-core's provider
// (features/passkeys/passkey_provider.dart) reads and writes exactly those.

/** A passkey of the vault as the popup lists it: never its key. */
export interface PasskeyView {
  id: string
  /** The credential's id, base64url. */
  credentialId: string
  /** The relying party: the site's domain. */
  rpId: string
  /** The name the site gave itself. */
  rpName?: string
  userName: string
  userDisplayName?: string
  /** A name the person gave the passkey on the phone. */
  label?: string
  /** The tags the person gave it (a passkey holds tags like any other item). */
  tags?: string[]
  /** What it is listed as: its label, the site's name, or its domain. */
  name: string
  /** Epoch ms the passkey was made. */
  createdAt: number
  /** Epoch ms of the last change. */
  changedAt: number
  order: number
}

export interface PasskeyDescriptor {
  type: 'public-key'
  /** base64url. */
  id: string
}

/** The creation options as the page script gives them: the parts Kemlock reads. */
export interface PasskeyCreationOptions {
  rp: { id?: string; name?: string }
  user: { id: string; name: string; displayName?: string }
  /** base64url. */
  challenge: string
  pubKeyCredParams?: { type: 'public-key'; alg: number }[]
  excludeCredentials?: PasskeyDescriptor[]
  authenticatorSelection?: {
    authenticatorAttachment?: string
    residentKey?: string
    requireResidentKey?: boolean
    userVerification?: string
  }
  attestation?: string
  timeout?: number
  /** The extensions the page asked for, as flags: `credProps` is answered, the others send the request to the browser. */
  extensions?: { credProps?: boolean; prf?: boolean; largeBlob?: boolean }
}

/** The sign-in options as the page script gives them: the parts Kemlock reads. */
export interface PasskeyRequestOptions {
  rpId?: string
  /** base64url. */
  challenge: string
  allowCredentials?: PasskeyDescriptor[]
  userVerification?: string
  timeout?: number
  extensions?: { prf?: boolean; largeBlob?: boolean }
}

/** `RegistrationResponseJSON` or `AuthenticationResponseJSON`: what the page script turns into a `PublicKeyCredential`. */
export interface PasskeyCredentialJson {
  id: string
  rawId: string
  type: 'public-key'
  authenticatorAttachment?: string
  /** `clientDataJSON` and the rest, every binary value base64url. */
  response: Record<string, unknown>
  clientExtensionResults: Record<string, unknown>
}

/** What the core answers to `createPasskey`. */
export interface CreatedPasskey {
  passkeyId: string
  response: PasskeyCredentialJson
}

/** The DOM exceptions a request ends in, by name. */
export type PasskeyErrorName =
  | 'NotAllowedError'
  | 'InvalidStateError'
  | 'NotSupportedError'
  | 'SecurityError'
  | 'AbortError'
  | 'EncodingError'
  | 'UnknownError'

/**
 * How a request ends, for the page script: a credential, the browser's own function (Kemlock doesn't answer, or the person chose
 * another device), or an exception. `pending` is only an answer to the request's start: the end comes later, in a `passkeyDone`.
 */
export type PasskeyOutcome =
  | { outcome: 'credential'; credential: PasskeyCredentialJson }
  | { outcome: 'fallback' }
  | { outcome: 'error'; name: PasskeyErrorName }

export type PasskeyStart = PasskeyOutcome | { outcome: 'pending' }

/** A passkey the menu offers to sign in with: names only. */
export interface PasskeyChoice {
  id: string
  /** The site (or the name it gave itself). */
  name: string
  /** The account. */
  detail: string
}

/** What the passkey card of the in-page menu shows (`passkeyPrompt`). */
export interface PasskeyPrompt {
  state: { exists: boolean; unlocked: boolean; wrongPasswords: number }
  kind: 'create' | 'get'
  /** The relying party: the site the passkey is for. */
  site: string
  rpName?: string
  /** The host of the frame that asks, which is not the page's when a frame of another site asks. */
  host: string
  crossOrigin: boolean
  /** Creating: the account the passkey is for, as the site wrote it. */
  user?: { name: string; displayName?: string }
  /** Signing in: the passkeys of the site (none while the vault is locked). */
  choices: PasskeyChoice[]
  /** Creating: the vault holds a credential the site excludes; the card says so and the page is told only after it is dismissed. */
  alreadyHeld?: boolean
}

/** The menu's answer to the card. */
export type PasskeyAction = 'save' | 'use' | 'other' | 'cancel' | 'never' | 'dismiss'

const alphabet = /^[A-Za-z0-9_-]*$/

/** A byte string as base64url, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url (padding or not) as bytes, or null when it is not base64url. */
export function fromBase64Url(input: string): Uint8Array | null {
  const text = input.replace(/={0,2}$/, '')
  if (!alphabet.test(text) || text.length % 4 === 1) return null
  try {
    const padded = text
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(text.length / 4) * 4, '=')
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}
