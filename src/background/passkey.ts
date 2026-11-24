// Kemlock Server's passkey and security-key sign-in (docs/plans/add-kemlock-server-sync.md, design D4). WebAuthn binds an answer
// to the origin of the page that asks, so the server's own connector page (`/kem/v1/webauthn`) asks the key, for the server's
// relying party, and hands the answer back to this extension's redirect address.
//
// The page is shown through `identity.launchWebAuthFlow` (the way SSO is), not a tab the background opens: a tab made by
// `tabs.create` has no opener to take a `postMessage` from the connector, and the address the flow ends at is one the browser
// itself hands only to this extension, in Chrome, Edge and Firefox. The request travels in the fragment, which no server sees:
//
//   #options=<base64url JSON of PublicKeyCredentialRequestOptions>&state=<ours>&redirect=<this extension's redirect address>
//
// and the answer is `<redirect>#result=<base64url JSON>&state=<ours>`, the JSON `{ state, credential, prf? }` or `{ state, error }`
// (`cancelled`, `unavailable`, `invalid`). Both states must be ours, and the answer must end on our own redirect address.
import { BackgroundError } from './errors'
import { browserAuth, browserRedirectUrl } from './identity'

/** The connector's path on a Kemlock Server. */
const connectorPath = '/kem/v1/webauthn'

const maxAnswer = 128 * 1024

/** What the core asks (`PagePasskeys` in core/lib/src/js/host.dart): binary values base64url. */
interface AskedOptions {
  challenge: string
  rpId: string
  credentialIds: string[]
  userVerification?: string
}

/** What the connector's answer holds once read: the credential as `PublicKeyCredential.toJSON()` writes it, and the PRF output. */
export interface PasskeyAnswer {
  credential: Record<string, unknown>
  prf?: string
}

const base64url = (bytes: Uint8Array): string => {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesOf(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new BackgroundError('failed')
  const padded = text
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=')
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  } catch {
    throw new BackgroundError('failed')
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function parseAsked(optionsJson: string): AskedOptions {
  let raw: unknown
  try {
    raw = JSON.parse(optionsJson)
  } catch {
    throw new BackgroundError('badRequest')
  }
  if (
    !isRecord(raw) ||
    !isText(raw.challenge) ||
    !isText(raw.rpId) ||
    !Array.isArray(raw.credentialIds) ||
    !raw.credentialIds.every(isText)
  )
    throw new BackgroundError('badRequest')
  return {
    challenge: raw.challenge,
    rpId: raw.rpId,
    credentialIds: raw.credentialIds as string[],
    ...(typeof raw.userVerification === 'string' ? { userVerification: raw.userVerification } : {}),
  }
}

/** The connector page's address, with the request in its fragment. */
export function connectorAddress(server: string, asked: AskedOptions, state: string): string {
  let origin: string
  try {
    const address = new URL(server)
    if (address.protocol !== 'https:') throw new Error('insecure')
    origin = address.origin
  } catch {
    throw new BackgroundError('badRequest')
  }
  const options = {
    challenge: asked.challenge,
    rpId: asked.rpId,
    allowCredentials: asked.credentialIds.map((id) => ({ type: 'public-key', id })),
    ...(asked.userVerification === undefined ? {} : { userVerification: asked.userVerification }),
    timeout: 120_000,
  }
  const fragment = new URLSearchParams({
    options: base64url(new TextEncoder().encode(JSON.stringify(options))),
    state,
    redirect: browserRedirectUrl(),
  })
  return `${origin}${connectorPath}#${fragment.toString()}`
}

/**
 * The answer in the address the flow ended at: only on our own redirect address (its origin), only for our state (in the address
 * and in the answer). A `cancelled` answer throws `cancelled`; any other failure `failed`.
 */
export function readAnswer(redirected: string, state: string): PasskeyAnswer {
  let address: URL
  let ours: URL
  try {
    address = new URL(redirected)
    ours = new URL(browserRedirectUrl())
  } catch {
    throw new BackgroundError('failed')
  }
  if (address.origin !== ours.origin) throw new BackgroundError('failed')
  const params = new URLSearchParams(address.hash.replace(/^#/, ''))
  const result = params.get('result')
  if (params.get('state') !== state || result === null || result.length > maxAnswer)
    throw new BackgroundError('failed')
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytesOf(result)))
  } catch {
    throw new BackgroundError('failed')
  }
  if (!isRecord(body) || body.state !== state) throw new BackgroundError('failed')
  if (typeof body.error === 'string')
    throw new BackgroundError(body.error === 'cancelled' ? 'cancelled' : 'failed')
  const credential = body.credential
  if (!isRecord(credential)) throw new BackgroundError('failed')
  return {
    credential,
    ...(typeof body.prf === 'string' ? { prf: body.prf } : {}),
  }
}

/** The assertion as the core reads it (`PagePasskeys`): every binary value base64url. */
export function assertionJson(answer: PasskeyAnswer): string {
  const { credential } = answer
  const response = credential.response
  if (
    !isRecord(response) ||
    !isText(credential.rawId) ||
    !isText(response.authenticatorData) ||
    !isText(response.clientDataJSON) ||
    !isText(response.signature)
  )
    throw new BackgroundError('failed')
  return JSON.stringify({
    credentialId: credential.rawId,
    authenticatorData: response.authenticatorData,
    clientData: response.clientDataJSON,
    signature: response.signature,
    ...(isText(response.userHandle) ? { userHandle: response.userHandle } : {}),
    ...(answer.prf === undefined ? {} : { prfOutput: answer.prf }),
  })
}

/**
 * The core's `passkeyAssertion` hook: asks the key on the server's own connector page. Answers the assertion as JSON, or null when
 * the person closed the window or dismissed the prompt; anything else the page reports throws.
 */
export async function passkeyAssertion(
  optionsJson: string,
  server: string,
): Promise<string | null> {
  const asked = parseAsked(optionsJson)
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)))
  try {
    const redirected = await browserAuth(connectorAddress(server, asked, state))
    return assertionJson(readAnswer(redirected, state))
  } catch (error) {
    if (error instanceof BackgroundError && error.code === 'cancelled') return null
    throw error
  }
}
