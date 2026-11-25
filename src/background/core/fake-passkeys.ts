// The passkeys of `FakeCore` (docs/plans/add-passkeys.md): real ES256 keys through WebCrypto, and the bytes Kemlock-core's provider
// builds (features/passkeys/passkey_bytes.dart, held to the phone's fixtures), so the tests and a build with the fake core run a
// request end to end and a page can verify what it is given. Only the relying-party check is an approximation: the real one
// reads the Public Suffix List.
import type {
  CreatedPasskey,
  PasskeyCreationOptions,
  PasskeyCredentialJson,
  PasskeyView,
} from '../../shared/passkeys'
import { fromBase64Url, toBase64Url } from '../../shared/passkeys'

/** What the fake keeps of a passkey: the phone's record (src/shared/passkeys.ts has the view). */
export interface StoredPasskey {
  id: string
  /** base64url. */
  credentialId: string
  rpId: string
  rpName?: string
  /** base64url. */
  userHandle: string
  userName: string
  userDisplayName?: string
  /** PKCS#8, standard base64, as the vault keeps it. */
  privateKey: string
  addedAt: number
  updatedAt: number
}

/** An error the way the core's are: `KemlockError` whose message is the code. */
export class PasskeyFakeError extends Error {
  constructor(word: string) {
    super(word)
    this.name = 'KemlockError'
  }
}

const aaguid = 'f85899be-d2db-4b3b-9b10-9b48e146dc1c'
const publicSuffixes = new Set([
  'com',
  'net',
  'org',
  'io',
  'co.uk',
  'com.au',
  'github.io',
  'gitlab.io',
  'herokuapp.com',
  'netlify.app',
  'vercel.app',
  'pages.dev',
])
const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** The relying party a request from `origin` may use, or `passkeySecurity`. */
export function checkRp(origin: string, rpId?: string): string {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new PasskeyFakeError('passkeySecurity')
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const local = host === 'localhost' || host.endsWith('.localhost')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new PasskeyFakeError('passkeySecurity')
  if (host.includes(':') || ipv4.test(host) || !domain.test(host))
    throw new PasskeyFakeError('passkeySecurity')
  const wanted = (rpId ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (wanted === '') return host
  if (!domain.test(wanted) || ipv4.test(wanted)) throw new PasskeyFakeError('passkeySecurity')
  if (wanted === host) return host
  if (!host.endsWith(`.${wanted}`) || publicSuffixes.has(wanted) || !wanted.includes('.'))
    throw new PasskeyFakeError('passkeySecurity')
  return wanted
}

/* ----------------------------------------------------------------------------------------------- */
/* The bytes                                                                                         */
/* ----------------------------------------------------------------------------------------------- */

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

function cborHead(major: number, value: number): Uint8Array {
  if (value < 24) return Uint8Array.of((major << 5) | value)
  if (value < 0x100) return Uint8Array.of((major << 5) | 24, value)
  if (value < 0x10000) return Uint8Array.of((major << 5) | 25, value >> 8, value & 0xff)
  return Uint8Array.of(
    (major << 5) | 26,
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  )
}
const cborInt = (value: number) => (value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value))
const cborBytes = (value: Uint8Array) => concat(cborHead(2, value.length), value)
const cborText = (value: string) => concat(cborHead(3, utf8(value).length), utf8(value))
const cborMap = (entries: [Uint8Array, Uint8Array][]) =>
  concat(cborHead(5, entries.length), ...entries.flat())

const rpIdHash = (rpId: string) => sha256(utf8(rpId))

function uuidBytes(text: string): Uint8Array {
  const hex = text.replace(/-/g, '')
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

/** The ES256 public key at `point` (65 bytes, uncompressed) as a COSE key, in canonical order. */
export function coseKey(point: Uint8Array): Uint8Array {
  return cborMap([
    [cborInt(1), cborInt(2)],
    [cborInt(3), cborInt(-7)],
    [cborInt(-1), cborInt(1)],
    [cborInt(-2), cborBytes(point.slice(1, 33))],
    [cborInt(-3), cborBytes(point.slice(33, 65))],
  ])
}

async function registrationAuthData(
  rpId: string,
  credentialId: Uint8Array,
  point: Uint8Array,
): Promise<Uint8Array> {
  return concat(
    await rpIdHash(rpId),
    Uint8Array.of(0x5d),
    new Uint8Array(4),
    uuidBytes(aaguid),
    Uint8Array.of(credentialId.length >> 8, credentialId.length & 0xff),
    credentialId,
    coseKey(point),
  )
}

const attestationObject = (authData: Uint8Array) =>
  cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(authData)],
  ])

const spkiPrefix = Uint8Array.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200'
    .match(/../g)!
    .map((pair) => parseInt(pair, 16)),
)

/** The client data a browser writes, in the order the phone's providers write it. */
export function clientData(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
  origin: string,
  topOrigin?: string,
): string {
  // A top origin is given only when some ancestor is of another site; it may equal the frame's own
  const cross = topOrigin !== undefined
  return JSON.stringify({
    type,
    challenge,
    origin,
    crossOrigin: cross,
    ...(cross ? { topOrigin } : {}),
  })
}

/* DER of an ES256 signature, with the low s the phone's signatures have. */
const curveOrder = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551')

function derInteger(value: bigint): Uint8Array {
  let hex = value.toString(16)
  if (hex.length % 2 === 1) hex = `0${hex}`
  const bytes = Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)))
  const body = bytes[0]! >= 0x80 ? concat(Uint8Array.of(0), bytes) : bytes
  return concat(Uint8Array.of(0x02, body.length), body)
}

/** A WebCrypto ECDSA signature (r and s, 32 bytes each) as the DER WebAuthn wants. */
export function derSignature(raw: Uint8Array): Uint8Array {
  const toBig = (bytes: Uint8Array) =>
    BigInt(`0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`)
  const r = toBig(raw.slice(0, 32))
  let s = toBig(raw.slice(32, 64))
  if (s > curveOrder >> 1n) s = curveOrder - s
  const body = concat(derInteger(r), derInteger(s))
  return concat(Uint8Array.of(0x30, body.length), body)
}

const standardBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const standardBytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/* ----------------------------------------------------------------------------------------------- */
/* What the core answers                                                                             */
/* ----------------------------------------------------------------------------------------------- */

export function view(passkey: StoredPasskey, order: number): PasskeyView {
  const label = passkey.rpName !== undefined && passkey.rpName !== '' ? passkey.rpName : passkey.rpId
  return {
    id: passkey.id,
    credentialId: passkey.credentialId,
    rpId: passkey.rpId,
    ...(passkey.rpName === undefined ? {} : { rpName: passkey.rpName }),
    userName: passkey.userName,
    ...(passkey.userDisplayName === undefined ? {} : { userDisplayName: passkey.userDisplayName }),
    name: label,
    createdAt: passkey.addedAt,
    changedAt: passkey.updatedAt,
    order,
  }
}

/** The passkeys of exactly `rpId`, each credential once, limited to `allowed` when it names any. */
export function findIn(
  list: StoredPasskey[],
  rpId: string,
  allowed: string[],
): { passkey: StoredPasskey; order: number }[] {
  const wanted = rpId.toLowerCase().replace(/\.$/, '')
  const seen = new Set<string>()
  const out: { passkey: StoredPasskey; order: number }[] = []
  list.forEach((passkey, order) => {
    if (passkey.rpId.toLowerCase().replace(/\.$/, '') !== wanted) return
    if (allowed.length > 0 && !allowed.includes(passkey.credentialId)) return
    if (seen.has(passkey.credentialId)) return
    seen.add(passkey.credentialId)
    out.push({ passkey, order })
  })
  return out
}

/** Makes a passkey, as the real core does, and says what the page is told. The caller keeps `passkey`. */
export async function create(
  list: StoredPasskey[],
  options: PasskeyCreationOptions,
  origin: string,
  topOrigin: string | undefined,
  now: number,
  id: string,
): Promise<{ passkey: StoredPasskey; made: CreatedPasskey }> {
  const rpId = checkRp(origin, options.rp.id)
  const algorithms = (options.pubKeyCredParams ?? []).map((param) => param.alg)
  if (algorithms.length > 0 && !algorithms.includes(-7))
    throw new PasskeyFakeError('passkeyNotSupported')
  const challenge = options.challenge
  const userHandle = fromBase64Url(options.user.id)
  if (challenge === '' || fromBase64Url(challenge) === null || userHandle === null || userHandle.length > 64)
    throw new PasskeyFakeError('passkeyEncoding')
  const held = findIn(list, rpId, []).map((entry) => entry.passkey.credentialId)
  if ((options.excludeCredentials ?? []).some((excluded) => held.includes(excluded.id)))
    throw new PasskeyFakeError('passkeyInvalidState')
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const point = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const credentialId = crypto.getRandomValues(new Uint8Array(16))
  const credential = toBase64Url(credentialId)
  const authData = await registrationAuthData(rpId, credentialId, point)
  const passkey: StoredPasskey = {
    id,
    credentialId: credential,
    rpId,
    ...(options.rp.name === undefined || options.rp.name === '' ? {} : { rpName: options.rp.name }),
    userHandle: toBase64Url(userHandle),
    userName: options.user.name,
    ...(options.user.displayName === undefined || options.user.displayName === ''
      ? {}
      : { userDisplayName: options.user.displayName }),
    privateKey: standardBase64(pkcs8),
    addedAt: now,
    updatedAt: now,
  }
  const response: PasskeyCredentialJson = {
    id: credential,
    rawId: credential,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: toBase64Url(
        utf8(clientData('webauthn.create', challenge, origin, topOrigin)),
      ),
      attestationObject: toBase64Url(attestationObject(authData)),
      authenticatorData: toBase64Url(authData),
      transports: ['internal'],
      publicKeyAlgorithm: -7,
      publicKey: toBase64Url(concat(spkiPrefix, point)),
    },
    clientExtensionResults: options.extensions?.credProps === true ? { credProps: { rk: true } } : {},
  }
  return { passkey, made: { passkeyId: id, response } }
}

/** Signs `challenge` (base64url) with the passkey for the origin, as the real core does. */
export async function sign(
  passkey: StoredPasskey,
  challenge: string,
  origin: string,
  topOrigin?: string,
): Promise<PasskeyCredentialJson> {
  if (checkRp(origin, passkey.rpId) !== passkey.rpId) throw new PasskeyFakeError('passkeySecurity')
  if (challenge === '' || fromBase64Url(challenge) === null)
    throw new PasskeyFakeError('passkeyEncoding')
  const key = await crypto.subtle.importKey(
    'pkcs8',
    standardBytes(passkey.privateKey) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const authData = concat(await rpIdHash(passkey.rpId), Uint8Array.of(0x1d), new Uint8Array(4))
  const clientDataBytes = utf8(clientData('webauthn.get', challenge, origin, topOrigin))
  const signed = concat(authData, await sha256(clientDataBytes))
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed as BufferSource),
  )
  return {
    id: passkey.credentialId,
    rawId: passkey.credentialId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: toBase64Url(clientDataBytes),
      authenticatorData: toBase64Url(authData),
      signature: toBase64Url(derSignature(raw)),
      userHandle: passkey.userHandle,
    },
    clientExtensionResults: {},
  }
}
