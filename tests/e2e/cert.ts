// A self-signed certificate made in pure Node (no openssl, no dependency), so the fixture server
// can speak https: the extension only takes https addresses (browser-sync spec). The browser is
// launched with --ignore-certificate-errors, so the names in it only keep Chromium content.
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts)
  const n = body.length
  const length =
    n < 0x80
      ? Buffer.from([n])
      : n < 0x100
        ? Buffer.from([0x81, n])
        : Buffer.from([0x82, n >> 8, n & 0xff])
  return Buffer.concat([Buffer.from([tag]), length, body])
}

const seq = (...parts: Buffer[]) => der(0x30, ...parts)
const set = (...parts: Buffer[]) => der(0x31, ...parts)
const oid = (bytes: number[]) => der(0x06, Buffer.from(bytes))
const utf8 = (text: string) => der(0x0c, Buffer.from(text))
const utcTime = (date: Date) =>
  der(0x17, Buffer.from(date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'))

const ECDSA_SHA256 = oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])
const COMMON_NAME = oid([0x55, 0x04, 0x03])
const SUBJECT_ALT_NAME = oid([0x55, 0x1d, 0x11])

export interface Certificate {
  key: string
  cert: string
  /** The SHA-256 of the certificate, for the log. */
  fingerprint: string
}

/** A certificate for `names` (and `*.name` for each), valid from yesterday for ten years. */
export function selfSigned(names: string[]): Certificate {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const name = seq(set(seq(COMMON_NAME, utf8('Kemlock e2e'))))
  const dns = names.flatMap((host) => [host, `*.${host}`])
  const alt = seq(...dns.map((host) => der(0x82, Buffer.from(host))))
  const extensions = der(0xa3, seq(seq(SUBJECT_ALT_NAME, der(0x04, alt))))
  const day = 24 * 60 * 60 * 1000
  const serial = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([0x02]))),
    der(0x02, serial),
    seq(ECDSA_SHA256),
    name,
    seq(utcTime(new Date(Date.now() - day)), utcTime(new Date(Date.now() + 3650 * day))),
    name,
    spki,
    extensions,
  )
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' })
  const cert = seq(tbs, seq(ECDSA_SHA256), der(0x03, Buffer.concat([Buffer.from([0]), signature])))
  const pem = (label: string, body: Buffer) =>
    `-----BEGIN ${label}-----\n${body.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END ${label}-----\n`
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: pem('CERTIFICATE', cert),
    fingerprint: createHash('sha256').update(cert).digest('hex'),
  }
}
