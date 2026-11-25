// What the passkey tests share: the options a site sends, and the checks a site makes of what it is given (a signature over
// the authenticator data and the client data's hash, verified with the public key it was given at creation).
import type {
  PasskeyCreationOptions,
  PasskeyCredentialJson,
  PasskeyRequestOptions,
} from '../../shared/passkeys'
import { fromBase64Url, toBase64Url } from '../../shared/passkeys'

export const challenge = toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => i + 1))
export const userHandle = toBase64Url(new TextEncoder().encode('user-1'))

/** A creation request of `orbit-cloud.com`, as the page script reports it. */
export function creation(over: Partial<PasskeyCreationOptions> = {}): PasskeyCreationOptions {
  return {
    rp: { id: 'orbit-cloud.com', name: 'Orbit Cloud' },
    user: { id: userHandle, name: 'sam@example.com', displayName: 'Sam' },
    challenge,
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    excludeCredentials: [],
    extensions: { credProps: true },
    ...over,
  }
}

/** A sign-in request for `orbit-cloud.com`. */
export function assertion(over: Partial<PasskeyRequestOptions> = {}): PasskeyRequestOptions {
  return { rpId: 'orbit-cloud.com', challenge, allowCredentials: [], ...over }
}

const bytes = (text: unknown): Uint8Array => {
  const out = typeof text === 'string' ? fromBase64Url(text) : null
  if (out === null) throw new Error('not base64url')
  return out
}

/** The raw r and s (32 bytes each) of an ECDSA signature in DER, as WebCrypto verifies it. */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('not a DER sequence')
  let at = 2
  const out = new Uint8Array(64)
  for (let half = 0; half < 2; half += 1) {
    if (der[at] !== 0x02) throw new Error('not a DER integer')
    let length = der[at + 1]!
    let start = at + 2
    if (der[start] === 0 && length > 32) {
      start += 1
      length -= 1
    }
    out.set(der.slice(start, start + length), half * 32 + (32 - length))
    at = start + length
  }
  return out
}

const sha256 = async (data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))

/** Whether the sign-in's signature is the passkey's over the authenticator data and the hash of the client data. */
export async function verifies(
  publicKey: string,
  credential: PasskeyCredentialJson,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'spki',
    bytes(publicKey) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const { authenticatorData, clientDataJSON, signature } = credential.response
  const signed = new Uint8Array([
    ...bytes(authenticatorData),
    ...(await sha256(bytes(clientDataJSON))),
  ])
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    derToRaw(bytes(signature)) as BufferSource,
    signed as BufferSource,
  )
}

/** The client data of a response, as the site reads it. */
export function clientDataOf(credential: PasskeyCredentialJson): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(bytes(credential.response.clientDataJSON))) as Record<
    string,
    unknown
  >
}

/** The authenticator data of a response, as bytes. */
export const authDataOf = (credential: PasskeyCredentialJson): Uint8Array =>
  bytes(credential.response.authenticatorData)

export const decode = bytes
