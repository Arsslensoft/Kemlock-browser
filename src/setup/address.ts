// Server and folder addresses: https only (spec: browser-sync), kept as the origin, path and no
// trailing slash.

export type AddressProblem = 'insecure' | 'invalid'

export type ParsedAddress =
  | { ok: true; address: string; host: string; pattern: string }
  | { ok: false; reason: AddressProblem }

/**
 * `vault.example` is taken as https. `host` is what the person is told (with its port);
 * `pattern` is the host permission asked for: match patterns have no port.
 */
export function parseAddress(text: string): ParsedAddress {
  const typed = text.trim()
  if (typed === '') return { ok: false, reason: 'invalid' }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(typed)
  if (scheme !== null && scheme[1].toLowerCase() === 'http')
    return { ok: false, reason: 'insecure' }
  if (scheme !== null && scheme[1].toLowerCase() !== 'https')
    return { ok: false, reason: 'invalid' }
  let url: URL
  try {
    url = new URL(scheme === null ? `https://${typed}` : typed)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'invalid' }
  if (url.hostname === '' || url.username !== '' || url.password !== '')
    return { ok: false, reason: 'invalid' }
  const path = url.pathname.replace(/\/+$/, '')
  return {
    ok: true,
    address: `${url.origin}${path}`,
    host: url.host,
    pattern: `https://${url.hostname}/*`,
  }
}

/** The server's own origin, to compare with the address typed. */
export function originOf(address: string): string | null {
  try {
    return new URL(address).origin
  } catch {
    return null
  }
}
