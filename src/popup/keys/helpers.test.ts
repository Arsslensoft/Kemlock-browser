// The keys screens' pure helpers: how fingerprints and standings are written, search and sort, the route in the keys tab's
// address, and base64 in and out.
import { describe, expect, it } from 'vitest'
import type { ContactView, KeyView } from '../../shared/keys-api'
import { base64ToBytes, bytesToBase64 } from './files'
import {
  contactMatches,
  keyMatches,
  keyTags,
  parseTags,
  safeFileName,
  shortFingerprint,
  sortContacts,
  sortKeys,
} from './format'
import { hashOf, routeFromHash } from './route'

const key = (over: Partial<KeyView> = {}): KeyView => ({
  id: 'k1',
  name: 'laptop',
  kind: 'ssh',
  algorithm: 'Ed25519',
  origin: 'generated',
  fingerprint: 'SHA256:41s5abcdefghijklmnopqrstuvwxyz0123456789AW4',
  line: 'Ed25519',
  tags: [],
  pinned: false,
  addedAt: 0,
  protected: false,
  onCard: false,
  hasPublic: true,
  hasSshForm: true,
  inSpace: false,
  ...over,
})

const contact = (over: Partial<ContactView> = {}): ContactView => ({
  id: 'c1',
  name: 'Ada Lovelace',
  fingerprint: '1FCD A135 0000 1111 2222 3333 4444 5555 6666 7777',
  line: 'ada@example.org · Ed25519',
  userIds: ['Ada Lovelace <ada@example.org>'],
  source: 'paste',
  checked: false,
  uncheckedAddresses: [],
  standing: 'ok',
  canEncrypt: true,
  addedAt: 0,
  ...over,
})

describe('shortFingerprint', () => {
  it('cuts an SSH fingerprint to its first and last four characters', () => {
    expect(shortFingerprint(key().fingerprint)).toBe('SHA256:41s5…9AW4')
    expect(shortFingerprint('SHA256:short')).toBe('SHA256:short')
  })

  it("keeps a PGP fingerprint's last four groups", () => {
    expect(shortFingerprint(contact().fingerprint)).toBe('…4444 5555 6666 7777')
    expect(shortFingerprint('AAAA BBBB')).toBe('AAAA BBBB')
    expect(shortFingerprint('')).toBe('')
  })
})

describe('search and order', () => {
  it('finds a key by name, kind line, fingerprint, tag or note, whatever the case', () => {
    const item = key({ tags: ['Work'], note: 'for the office' })
    for (const query of ['LAPTOP', 'ed25519', '41s5', 'work', 'OFFICE', '  ', '']) {
      expect(keyMatches(item, query), query).toBe(true)
    }
    expect(keyMatches(item, 'github')).toBe(false)
  })

  it('finds a contact by name, user ID or fingerprint', () => {
    for (const query of ['lovelace', 'ADA@EXAMPLE', '1fcd', '']) {
      expect(contactMatches(contact(), query), query).toBe(true)
    }
    expect(contactMatches(contact(), 'grace')).toBe(false)
  })

  it('puts pinned keys first and sorts by name', () => {
    const sorted = sortKeys([
      key({ id: 'b', name: 'beta' }),
      key({ id: 'p', name: 'zeta', pinned: true }),
      key({ id: 'a', name: 'alpha' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['p', 'a', 'b'])
    expect(
      sortContacts([contact({ id: '2', name: 'Zoe' }), contact({ id: '1', name: 'Ada' })]).map(
        (item) => item.id,
      ),
    ).toEqual(['1', '2'])
  })

  it('lists the tags once, sorted', () => {
    expect(keyTags([key({ tags: ['b', 'a'] }), key({ tags: ['a', 'c'] })])).toEqual(['a', 'b', 'c'])
  })

  it('reads typed tags as a list with no empty or repeated one', () => {
    expect(parseTags(' work, home ,,work, ')).toEqual(['work', 'home'])
    expect(parseTags('')).toEqual([])
  })

  it('makes a file name any file system takes', () => {
    expect(safeFileName('Ada Lovelace <ada@example.org>', '.asc')).toBe(
      'Ada-Lovelace-ada-example.org.asc',
    )
    expect(safeFileName('///', '.pub')).toBe('kemlock.pub')
  })
})

describe("the route in the keys tab's address", () => {
  it('reads each screen by its hash, and the list for anything else', () => {
    expect(routeFromHash('#addKey')).toEqual({ name: 'addKey' })
    expect(routeFromHash('#addContact')).toEqual({ name: 'addContact' })
    expect(routeFromHash('#contacts')).toEqual({ name: 'list', tab: 'contacts' })
    expect(routeFromHash('#tools/verify')).toEqual({ name: 'tools', tool: 'verify' })
    expect(routeFromHash('#tools/telepathy')).toEqual({ name: 'tools' })
    expect(routeFromHash('#tools')).toEqual({ name: 'tools' })
    for (const hash of ['', '#', '#nothing', '#constructor', '#__proto__/x'])
      expect(routeFromHash(hash), hash).toEqual({ name: 'list' })
  })

  it('writes the hash that reads back as the same screen', () => {
    for (const route of [
      { name: 'addKey' },
      { name: 'addContact' },
      { name: 'list', tab: 'contacts' },
      { name: 'tools' },
      { name: 'tools', tool: 'sign' },
    ] as const) {
      expect(routeFromHash(`#${hashOf(route)}`)).toEqual(
        route.name === 'tools' && route.tool === undefined ? { name: 'tools' } : route,
      )
    }
    expect(hashOf({ name: 'list' })).toBe('')
    expect(hashOf({ name: 'key', id: 'k' })).toBe('')
  })
})

describe('base64', () => {
  it('goes there and back for every byte, and for a file larger than one chunk', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all)
    const big = Uint8Array.from({ length: 0x8000 * 2 + 17 }, (_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
    expect(bytesToBase64(new Uint8Array())).toBe('')
    expect(bytesToBase64(new TextEncoder().encode('Kemlock'))).toBe('S2VtbG9jaw==')
  })
})
