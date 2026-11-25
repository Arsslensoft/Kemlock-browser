// Whether a WebAuthn request is one Kemlock can serve, read from what the page script reported (docs/plans/add-passkeys.md). A request
// Kemlock can't serve is left to the browser, whose own function the page script then calls, so security keys and phones still
// work; it is never answered with a failure Kemlock made up. Nothing here is trusted for who asks or where: the origin is the
// browser's word on the sender, and the core checks the relying party against it.
import type { PasskeyCreationOptions, PasskeyRequestOptions } from '../shared/passkeys'
import { modalTimeout } from '../shared/passkey-timeout'

/** Why a request is left to the browser. */
export type Skip = 'malformed' | 'algorithm' | 'attachment' | 'extension' | 'relyingParty'

export type Served<T> =
  | { serve: true; rpId: string | undefined; timeout: number; options: T }
  | { serve: false; reason: Skip }

/** A conditional request waits as long as the page does. */
const conditionalMs = 30 * 60_000

export function timeoutOf(requested: number | undefined, conditional: boolean): number {
  if (conditional) return conditionalMs
  return modalTimeout(requested)
}

/**
 * A relying party id the way a browser reads it: a domain name in its ASCII form. `undefined` for none, null when it is not a
 * domain (the browser then refuses it itself, with its own exception).
 */
export function asciiRp(rpId: string | undefined): string | undefined | null {
  if (rpId === undefined || rpId === '') return undefined
  if (!/^[^\s/?#@:\\[\]]+$/.test(rpId)) return null
  try {
    const host = new URL(`https://${rpId}`).hostname
    return host === '' ? null : host
  } catch {
    return null
  }
}

/** A creation request Kemlock makes a passkey for: ES256 allowed, no authenticator of another kind asked for, no extension it lacks. */
export function serveCreate(options: PasskeyCreationOptions): Served<PasskeyCreationOptions> {
  if (options.rp === undefined || options.user === undefined)
    return { serve: false, reason: 'malformed' }
  const algorithms = options.pubKeyCredParams ?? []
  if (algorithms.length > 0 && !algorithms.some((param) => param.alg === -7))
    return { serve: false, reason: 'algorithm' }
  if (options.authenticatorSelection?.authenticatorAttachment === 'cross-platform')
    return { serve: false, reason: 'attachment' }
  // PRF and large blobs are the phones' providers' to ignore, but a site that asks for them needs them: the browser has them
  if (options.extensions?.prf === true || options.extensions?.largeBlob === true)
    return { serve: false, reason: 'extension' }
  const rpId = asciiRp(options.rp.id)
  if (rpId === null) return { serve: false, reason: 'relyingParty' }
  return {
    serve: true,
    rpId,
    timeout: timeoutOf(options.timeout, false),
    options: { ...options, rp: { ...options.rp, ...(rpId === undefined ? {} : { id: rpId }) } },
  }
}

/** A sign-in request Kemlock answers with a passkey of its own, when the vault holds one. */
export function serveGet(
  options: PasskeyRequestOptions,
  conditional: boolean,
): Served<PasskeyRequestOptions> {
  if (options.extensions?.prf === true || options.extensions?.largeBlob === true)
    return { serve: false, reason: 'extension' }
  const rpId = asciiRp(options.rpId)
  if (rpId === null) return { serve: false, reason: 'relyingParty' }
  return {
    serve: true,
    rpId,
    timeout: timeoutOf(options.timeout, conditional),
    options: { ...options, ...(rpId === undefined ? {} : { rpId }) },
  }
}

/** The credential ids a request excludes or allows (base64url). */
export const descriptorIds = (list: { id: string }[] | undefined): string[] =>
  (list ?? []).map((descriptor) => descriptor.id)
