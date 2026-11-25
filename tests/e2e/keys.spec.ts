// The keys, contacts and PGP tools in the real extension: a key made in it is listed and handed out in the forms a server
// or a mail program reads, its private half stays behind a warning, a contact's key encrypts and nothing but the matching
// key opens it, and none of it sits in the clear in the browser's storage.
import type {
  ContactView,
  KeyExport,
  KeyPublic,
  KeyView,
  PgpDecrypted,
  PgpEncrypted,
} from '../../src/shared/keys-api'
import { expect, test } from './kemlock'
import { control } from './ui'

test.describe('keys', () => {
  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
  })

  test('an SSH key made in the extension is listed, handed out for authorized_keys, and its private half asks first', async ({
    kemlock,
  }) => {
    const key = await kemlock.call('generateKey', {
      input: { kind: 'ssh', algorithm: 'ed25519', name: 'laptop' },
    })
    expect(key).toMatchObject({ kind: 'ssh', name: 'laptop', algorithm: 'Ed25519' })
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)

    const popup = await kemlock.popup()
    await control(popup, /^keys and pgp$/i).click()
    await expect(popup.getByText('laptop').first()).toBeVisible()
    await popup.getByRole('button', { name: /open laptop/i }).click()

    // The public half is on the page, in the form OpenSSH reads
    const texts = () =>
      popup
        .locator('textarea')
        .evaluateAll((areas) => areas.map((area) => (area as HTMLTextAreaElement).value))
    await expect
      .poll(async () =>
        (await texts()).some(
          (value) => value.startsWith('ssh-ed25519 ') && value.endsWith(' laptop'),
        ),
      )
      .toBe(true)
    expect((await texts()).join(' ')).not.toContain('PRIVATE KEY')

    // The private half: a warning first, then it shows, and hides again
    await popup.getByRole('button', { name: /^show$/i }).click()
    await expect(popup.getByText(/take the private key out\?/i)).toBeVisible()
    expect(
      await popup
        .locator('textarea')
        .evaluateAll((areas) =>
          areas.some((area) => (area as HTMLTextAreaElement).value.includes('PRIVATE')),
        ),
    ).toBe(false)
    await control(popup, /^continue$/i).click()
    await expect
      .poll(() =>
        popup
          .locator('textarea')
          .evaluateAll((areas) =>
            areas.some((area) =>
              (area as HTMLTextAreaElement).value.includes('BEGIN OPENSSH PRIVATE KEY'),
            ),
          ),
      )
      .toBe(true)
    await control(popup, /^hide$/i).click()
    await expect
      .poll(() =>
        popup
          .locator('textarea')
          .evaluateAll((areas) =>
            areas.some((area) => (area as HTMLTextAreaElement).value.includes('PRIVATE')),
          ),
      )
      .toBe(false)
  })

  test('the private half is copied by the background, never by the page', async ({ kemlock }) => {
    const key = await kemlock.call('generateKey', {
      input: { kind: 'ssh', algorithm: 'ecdsa-p256', name: 'build server' },
    })
    await kemlock.call('copyKey', { id: key.id })
    expect(await kemlock.clipboard()).toContain('BEGIN OPENSSH PRIVATE KEY')
  })

  test('a key exported with a passphrase asks for it when it is imported again', async ({
    kemlock,
  }) => {
    const key = await kemlock.call('generateKey', {
      input: { kind: 'signing', algorithm: 'ed25519', name: 'releases' },
    })
    const out: KeyExport = await kemlock.call('exportKey', {
      id: key.id,
      passphrase: 'blue heron lantern',
      purpose: 'file',
    })
    expect(out.text).toContain('ENCRYPTED PRIVATE KEY')
    await kemlock.call('deleteKey', { id: key.id })
    await expect(kemlock.call('previewKey', { text: out.text })).rejects.toThrow(
      /keyPassphraseNeeded/,
    )
    await expect(
      kemlock.call('previewKey', { text: out.text, passphrase: 'red heron lantern' }),
    ).rejects.toThrow(/keyWrongPassphrase/)
    const added = await kemlock.call('importKey', {
      text: out.text,
      passphrase: 'blue heron lantern',
      name: 'releases again',
    })
    expect(added).toMatchObject({
      kind: 'signing',
      origin: 'imported',
      fingerprint: key.fingerprint,
    })
    await expect(
      kemlock.call('importKey', {
        text: out.text,
        passphrase: 'blue heron lantern',
        name: 'twice',
      }),
    ).rejects.toThrow(/duplicate/)
  })

  test('a contact’s key encrypts a message that only the matching key opens', async ({
    kemlock,
  }) => {
    // Ada's key pair is made here, then only its public half is kept, as a contact
    const adaKey = await kemlock.call('generateKey', {
      input: {
        kind: 'pgp',
        type: 'ed25519',
        name: 'Ada Lovelace',
        email: 'ada@example.org',
        expiresInYears: 2,
      },
    })
    const armored = ((await kemlock.call('keyPublic', { id: adaKey.id })) as KeyPublic).pem!
    expect(armored).toContain('BEGIN PGP PUBLIC KEY BLOCK')
    await kemlock.call('deleteKey', { id: adaKey.id })

    const preview = await kemlock.call('previewContacts', { text: armored })
    expect(preview[0]).toMatchObject({ status: 'new', name: 'Ada Lovelace' })
    const [ada]: ContactView[] = await kemlock.call('addContacts', {
      text: armored,
      source: 'paste',
      checked: [preview[0]!.fingerprintHex],
    })
    expect(ada).toMatchObject({ checked: true, canEncrypt: true, standing: 'ok' })

    // Sam's own key signs, and is also a recipient
    const sam: KeyView = await kemlock.call('generateKey', {
      input: {
        kind: 'pgp',
        type: 'ed25519',
        name: 'Sam',
        email: 'sam@example.org',
        expiresInYears: null,
      },
    })
    const sent: PgpEncrypted = await kemlock.call('pgpEncrypt', {
      data: { text: 'meet at noon' },
      contactIds: [ada!.id],
      keyIds: [sam.id],
      signWith: sam.id,
    })
    expect('text' in sent && sent.text).toContain('BEGIN PGP MESSAGE')
    const opened: PgpDecrypted = await kemlock.call('pgpDecrypt', {
      text: 'text' in sent ? sent.text : '',
    })
    expect(opened).toMatchObject({ text: 'meet at noon', isText: true, encrypted: true })
    expect(opened.signatures[0]).toMatchObject({ verdict: 'good', signer: { kind: 'key' } })

    // To Ada alone, nothing in this vault opens it
    const toAda: PgpEncrypted = await kemlock.call('pgpEncrypt', {
      data: { text: 'for Ada' },
      contactIds: [ada!.id],
      keyIds: [],
    })
    await expect(
      kemlock.call('pgpDecrypt', { text: 'text' in toAda ? toAda.text : '' }),
    ).rejects.toThrow(/pgpNoKeyOpensIt/)
  })

  test('the PGP tools page encrypts a text to a contact', async ({ kemlock }) => {
    const other = await kemlock.call('generateKey', {
      input: {
        kind: 'pgp',
        type: 'ed25519',
        name: 'Bo',
        email: 'bo@example.org',
        expiresInYears: 2,
      },
    })
    const armored = (await kemlock.call('keyPublic', { id: other.id })).pem!
    await kemlock.call('deleteKey', { id: other.id })
    await kemlock.call('addContacts', { text: armored })

    const popup = await kemlock.popup()
    await control(popup, /^keys and pgp$/i).click()
    await popup.getByRole('button', { name: /^pgp tools$/i }).click()
    await popup.getByRole('switch', { name: /^bo$/i }).check()
    await popup.getByLabel(/^message$/i).fill('hello Bo')
    await popup.locator('form button[type="submit"]').click()
    await expect
      .poll(() =>
        popup
          .locator('textarea')
          .evaluateAll((areas) =>
            areas.some((area) =>
              (area as HTMLTextAreaElement).value.startsWith('-----BEGIN PGP MESSAGE-----'),
            ),
          ),
      )
      .toBe(true)
  })

  test('SSH signatures and git commits are checked against the namespace and the key', async ({
    kemlock,
  }) => {
    const key = await kemlock.call('generateKey', {
      input: { kind: 'ssh', algorithm: 'ed25519', name: 'laptop' },
    })
    const { text } = await kemlock.call('sshSign', {
      keyId: key.id,
      namespace: 'file',
      text: 'release notes',
    })
    expect(text).toContain('BEGIN SSH SIGNATURE')
    const good = await kemlock.call('sshVerify', {
      signature: text,
      namespace: 'file',
      text: 'release notes',
    })
    expect(good).toMatchObject({ verdict: 'good', own: { name: 'laptop' } })
    const wrong = await kemlock.call('sshVerify', {
      signature: text,
      namespace: 'git',
      text: 'release notes',
    })
    expect(wrong.verdict).toBe('wrongNamespace')
  })

  test('nothing of a key is in the browser’s storage in the clear', async ({ kemlock }) => {
    const key = await kemlock.call('generateKey', {
      input: { kind: 'ssh', algorithm: 'ed25519', name: 'zq-unique-key-name-4711' },
    })
    const out = await kemlock.call('exportKey', { id: key.id, purpose: 'show' })
    const body = out.text.split('\n')[1]!
    const stored = JSON.stringify(await kemlock.storage())
    expect(stored).not.toContain('zq-unique-key-name-4711')
    expect(stored).not.toContain(key.fingerprint)
    expect(stored).not.toContain(body)
    const found = await kemlock.scanProfile(['zq-unique-key-name-4711', body])
    expect(found).toEqual([])
  })
})
