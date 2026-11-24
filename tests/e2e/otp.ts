// What the tests compute for themselves, to check what the extension shows: one-time codes
// (RFC 4226 and 6238) and the app's sync files (AES-256-GCM, keyed by scrypt of the sync
// passphrase), so a test can seed a WebDAV folder as the phone would and open what the browser
// wrote back.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(text: string): Buffer {
  let bits = ''
  for (const char of text.replace(/=+$/, '').toUpperCase())
    bits += BASE32.indexOf(char).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export function hotp(secret: string, counter: number, digits = 6, algorithm = 'sha1'): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac(algorithm, base32Decode(secret)).update(message).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  return String(value).padStart(digits, '0')
}

export function totp(secret: string, at = Date.now(), period = 30, digits = 6): string {
  return hotp(secret, Math.floor(at / 1000 / period), digits)
}

/** The codes valid around `at`: a code that ticked over while a test ran is still right. */
export function totpNear(secret: string, at = Date.now(), period = 30, digits = 6): string[] {
  return [-1, 0, 1].map((step) => totp(secret, at + step * period * 1000, period, digits))
}

/* ---------------------------------------------------------------------------------------------- */
/* Sync files                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

export const SCRYPT = { N: 131072, r: 8, p: 1 } as const

export function syncKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { ...SCRYPT, maxmem: 512 * 1024 * 1024 })
}

/** A sync document: what the app keeps in a sync file, as JSON. Lists the browser doesn't show are `unknown`. */
export interface SyncDoc {
  accounts?: Record<string, unknown>[]
  backupServices?: Record<string, unknown>[]
  logins?: Record<string, unknown>[]
  deleted?: Record<string, unknown>[]
  [other: string]: unknown
}

function seal(doc: SyncDoc, key: Buffer): { nonce: string; ct: string } {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()])
  return {
    nonce: nonce.toString('base64'),
    ct: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
  }
}

/**
 * A vault's own sync file keyed by a passphrase: what the phone writes to a WebDAV folder. A phone
 * writing again keeps the file's salt, so pass the salt of the file you are replacing.
 */
export function makeSyncFile(
  doc: SyncDoc,
  passphrase: string,
  salt: Buffer = randomBytes(32),
): string {
  const sealed = seal(doc, syncKey(passphrase, salt))
  return JSON.stringify({
    app: 'BackMyCodes',
    kind: 'sync',
    version: 1,
    kdf: { salt: salt.toString('base64'), ...SCRYPT },
    ...sealed,
  })
}

/** Opens a sync file with its passphrase, or with the raw key some of the app's fixtures give. */
export function openSyncFile(
  text: string,
  secret: { passphrase: string } | { key: string },
): SyncDoc {
  const file = JSON.parse(text) as {
    kdf?: { salt: string; N: number; r: number; p: number }
    nonce: string
    ct: string
  }
  const key =
    'key' in secret
      ? Buffer.from(secret.key, 'base64')
      : syncKey(secret.passphrase, Buffer.from(file.kdf!.salt, 'base64'))
  const ct = Buffer.from(file.ct, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.nonce, 'base64'))
  decipher.setAuthTag(ct.subarray(ct.length - 16))
  const plain = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as SyncDoc
}

/** The salt of a sync file made from a passphrase. */
export function saltOf(text: string): Buffer {
  return Buffer.from((JSON.parse(text) as { kdf: { salt: string } }).kdf.salt, 'base64')
}
