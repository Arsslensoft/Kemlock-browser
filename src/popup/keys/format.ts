// Pure helpers of the keys screens: how a key, a fingerprint and a standing are written, and search and sort.
import type { ContactView, KeyKind, KeyView, Standing } from '../../shared/keys-api'

export const kindNames: Record<KeyKind, string> = {
  ssh: 'keys_kindSsh',
  signing: 'keys_kindSigning',
  exchange: 'keys_kindExchange',
  pgp: 'keys_kindPgp',
  other: 'keys_kindOther',
}

export const standingNames: Record<Exclude<Standing, 'ok'>, string> = {
  expiringSoon: 'keys_standingExpiringSoon',
  expired: 'keys_standingExpired',
  revoked: 'keys_standingRevoked',
}

/**
 * A fingerprint as a row shows it: an SSH one as `SHA256:41s5…AW4`, a PGP one as its last four groups, which GnuPG's short
 * listings show too.
 */
export function shortFingerprint(fingerprint: string): string {
  const prefix = 'SHA256:'
  if (fingerprint.startsWith(prefix)) {
    const digest = fingerprint.slice(prefix.length)
    return digest.length <= 9 ? fingerprint : `${prefix}${digest.slice(0, 4)}…${digest.slice(-4)}`
  }
  const groups = fingerprint.split(' ')
  return groups.length <= 4 ? fingerprint : `…${groups.slice(-4).join(' ')}`
}

const contains = (haystack: (string | undefined)[], needle: string): boolean =>
  haystack.some((text) => text !== undefined && text.toLowerCase().includes(needle))

/** Search by name, what the key is, its fingerprint, tags or note, whatever the case. An empty query matches. */
export function keyMatches(key: KeyView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    needle === '' ||
    contains([key.name, key.line, key.fingerprint, key.note, key.algorithm, ...key.tags], needle)
  )
}

export function contactMatches(contact: ContactView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    needle === '' ||
    contains(
      [contact.name, contact.line, contact.fingerprint, contact.note, ...contact.userIds],
      needle,
    )
  )
}

/** Pinned keys first, then by name. */
export function sortKeys(keys: KeyView[]): KeyView[] {
  return [...keys].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name),
  )
}

export function sortContacts(contacts: ContactView[]): ContactView[] {
  return [...contacts].sort((a, b) => a.name.localeCompare(b.name))
}

export function keyTags(keys: KeyView[]): string[] {
  return [...new Set(keys.flatMap((key) => key.tags))].sort((a, b) => a.localeCompare(b))
}

/** The tags typed in a box: split at commas, trimmed, with no empty or repeated one. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
    ),
  ]
}

/** The file name a download gets when the person chose none: `name.suffix`, safe in any file system. */
export function safeFileName(name: string, suffix: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base === '' ? 'kemlock' : base}${suffix}`
}
