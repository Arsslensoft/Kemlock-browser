// Pure helpers for the passkeys' lists and pages (docs/plans/add-passkeys.md): searching, which passkeys belong to a site, and which
// logins belong to a passkey.
import type { LoginView } from '../shared/api'
import type { PasskeyView } from '../shared/passkeys'
import { hostOf } from './format'

const contains = (haystack: (string | undefined)[], needle: string): boolean =>
  haystack.some((text) => text !== undefined && text.toLowerCase().includes(needle))

/** Search by site, name, user name or label, whatever the case. An empty query matches. */
export function passkeyMatches(passkey: PasskeyView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    needle === '' ||
    contains(
      [
        passkey.name,
        passkey.rpId,
        passkey.rpName,
        passkey.userName,
        passkey.userDisplayName,
        passkey.label,
      ],
      needle,
    )
  )
}

/** Whether a host is the passkey's relying party, or under it (the relation WebAuthn uses), or the relying party is under the host. */
export function sameSite(host: string, rpId: string): boolean {
  const a = host.toLowerCase().replace(/^www\./, '')
  const b = rpId.toLowerCase().replace(/^www\./, '')
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/** The passkeys of a login's websites. */
export function passkeysOfWebsites(passkeys: PasskeyView[], websites: string[]): PasskeyView[] {
  const hosts = websites.map(hostOf).filter((host) => host !== '')
  return passkeys.filter((passkey) => hosts.some((host) => sameSite(host, passkey.rpId)))
}

/** The logins of a passkey's site. */
export function loginsOfPasskey(logins: LoginView[], passkey: PasskeyView): LoginView[] {
  return logins.filter((login) =>
    login.websites.some((website) => {
      const host = hostOf(website)
      return host !== '' && sameSite(host, passkey.rpId)
    }),
  )
}

/** The vault's order. */
export const byOrder = (passkeys: PasskeyView[]): PasskeyView[] =>
  [...passkeys].sort((a, b) => a.order - b.order)
