// A vault in the item format Kemlock Server's web vault and the app write (docs/plans/add-item-format.md), as the phone
// would leave it in a WebDAV folder: custom fields of every kind, two-way links, a code linked to a login, a login with
// several websites and match rules, a contact with no PGP key, a File item and a note with an attached file. Every item
// also holds a key the browser doesn't know, so a test can see that a save leaves what it didn't edit as it was.
//
// Ids are UUIDs, as links name them. Nothing here is a secret: the keys and digests are made up.
import type { SyncDoc } from '../otp'

export const ITEM_FORMAT_PASSPHRASE = 'sync passphrase item format'

export const ids = {
  orbit: '3f1c2b9e-5a0d-4c7e-8b21-0a1b2c3d4e01',
  harbor: '3f1c2b9e-5a0d-4c7e-8b21-0a1b2c3d4e02',
  wifi: '3f1c2b9e-5a0d-4c7e-8b21-0a1b2c3d4e03',
  ada: '3f1c2b9e-5a0d-4c7e-8b21-0a1b2c3d4e04',
  orbitCode: '3f1c2b9e-5a0d-4c7e-8b21-0a1b2c3d4e05',
  vpnCode: '3f1c2b9e-5a0d-4c7e-8b21-0a1b2c3d4e06',
  taxFile: '3f1c2b9e-5a0d-4c7e-8b21-0a1b2c3d4e07',
} as const

const NOW = 1_764_000_000_000

/** An attached file's record, as a note and a File item hold it (the sealed bytes live apart from the vault). */
const attachment = (id: string, name: string, size: number) => ({
  id,
  name,
  size,
  type: 'application/pdf',
  key: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  addedAt: NOW,
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
})

export const fileNames = {
  attached: 'router-label.pdf',
  item: 'tax-return.pdf',
  itemName: 'Tax return 2025',
}

/** The document the phone writes. Build a fresh one per test: tests change what they get. */
export function itemFormatDoc(): SyncDoc {
  return {
    logins: [
      {
        id: ids.orbit,
        name: 'Orbit Cloud',
        username: 'sam@example.com',
        password: 'Orbit-Cloud-p4ss!',
        websites: ['orbit-cloud.com', 'login.orbit-cloud.com'],
        uris: [
          { uri: 'orbit-cloud.com' },
          { uri: 'https://login.orbit-cloud.com/', match: 2 },
          { uri: '^https://[a-z]+\\.orbit-cloud\\.com/admin$', match: 4 },
        ],
        note: 'the account of the whole family',
        addedAt: NOW,
        updatedAt: NOW,
        links: [{ id: ids.wifi, 'x-note': 'kept' }],
        fields: [
          { name: 'Account number', value: 'AC-1234', kind: 'text', 'x-source': 'import' },
          { name: 'Recovery PIN', value: '8842', kind: 'hidden' },
          { name: 'Paid plan', value: 'true', kind: 'boolean' },
          // What the Bitwarden import writes: shown nowhere, edited nowhere, and kept
          { name: 'Linked username', value: null, kind: 'linked', linkedId: 100 },
          // A field with no name can't be edited either
          { value: 'orphan', kind: 'text' },
        ],
        'x-future': { keep: ['me', 1, true] },
      },
      {
        id: ids.harbor,
        name: 'Harbor Notes',
        username: 'alex@harbornotes.app',
        password: 'Harb0r-pw-!!',
        websites: ['harbornotes.app'],
        addedAt: NOW,
        updatedAt: NOW,
      },
    ],
    notes: [
      {
        id: ids.wifi,
        title: 'Wi-Fi',
        text: 'hunter2 at home',
        attachments: [attachment('AAECAwQFBgcICQoLDA0ODw', fileNames.attached, 2048)],
        links: [{ id: ids.orbit }],
        fields: [{ name: 'SSID', value: 'HomeNet', kind: 'text' }],
        addedAt: NOW,
        updatedAt: NOW,
        'x-future': 'kept',
      },
    ],
    contacts: [
      {
        id: ids.ada,
        name: 'Ada Lovelace',
        company: 'Analytical Engines Ltd',
        email: 'ada@analytical.example',
        phone: '+44 20 7946 0000',
        address: '12 St James Square\nLondon',
        // No key: a contact the person typed in
        public: '',
        source: 'manual',
        addedAt: NOW,
        updatedAt: NOW,
        'x-future': 'kept',
      },
    ],
    accounts: [
      {
        id: ids.orbitCode,
        type: 'totp',
        issuer: 'Orbit Cloud',
        label: 'sam@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        addedAt: NOW,
        // Its websites are the login's: nothing of its own
        linkedLoginId: ids.orbit,
      },
      {
        id: ids.vpnCode,
        type: 'totp',
        name: 'Work VPN',
        issuer: 'Example Corp',
        label: 'sam@corp.example',
        secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        websites: ['vpn.example.com', 'sso.example.com'],
        addedAt: NOW,
      },
    ],
    // File items: one encrypted file each, in `files` (kemlock-core's Lists.files)
    files: [
      {
        id: ids.taxFile,
        name: fileNames.itemName,
        notes: 'the scan',
        file: attachment('BQYHCAkKCwwNDg8QERITFA', fileNames.item, 4096),
        addedAt: NOW,
        updatedAt: NOW,
      },
    ],
    backupServices: [],
    deleted: [],
  }
}

/** A list of the doc, by name, as the tests read it (`readFolder` gives the same shape). */
export function members(doc: SyncDoc, list: string): Record<string, unknown>[] {
  return (doc[list] as Record<string, unknown>[] | undefined) ?? []
}

/** One member by id. */
export function member(doc: SyncDoc, list: string, id: string): Record<string, unknown> {
  const found = members(doc, list).find((item) => item.id === id)
  if (!found) throw new Error(`no ${list} item ${id}`)
  return found
}

/** The ids a body's `links` name, sorted. */
export function linkIds(body: Record<string, unknown>): string[] {
  return ((body.links as { id: string }[] | undefined) ?? []).map((link) => link.id).sort()
}
