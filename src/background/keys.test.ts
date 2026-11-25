// The background's answers for the keys, contacts and PGP tools: who may ask, what a change does besides changing, what leaves
// the vault and how, over a `FakeCore` and the real router.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ContactPreview,
  ContactView,
  KeyExport,
  KeyPublic,
  KeyView,
  PgpDecrypted,
  PgpEncrypted,
  SshVerified,
} from '../shared/keys-api'
import { content, harness, menuFrame, popup, setup, useClock, type Harness } from './test/harness'
import { syncSoonAlarm } from './sync'

const keysTab = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/keys/index.html',
  origin: 'chrome-extension://kemlockid',
}

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const generateSsh = (name = 'laptop') =>
  h.ok<KeyView>({
    kind: 'generateKey',
    input: { kind: 'ssh', algorithm: 'ed25519', name },
  })
const generatePgp = (name = 'Ada', email = 'ada@example.org') =>
  h.ok<KeyView>({
    kind: 'generateKey',
    input: { kind: 'pgp', type: 'ed25519', name, email, expiresInYears: 2 },
  })

describe('who may ask', () => {
  it('answers the popup and the keys tab, and no other page or content script', async () => {
    expect(await h.ok<KeyView[]>({ kind: 'keys' }, popup)).toEqual([])
    expect(await h.ok<KeyView[]>({ kind: 'keys' }, keysTab)).toEqual([])
    for (const sender of [setup, menuFrame]) {
      expect(await h.send({ kind: 'keys' }, sender)).toEqual({ ok: false, error: 'refused' })
    }
    const page = content('https://orbit-cloud.com/')
    expect(await h.send({ kind: 'keys' }, page)).toEqual({ ok: false, error: 'refused' })
    expect(await h.send({ kind: 'exportKey', id: 'k', purpose: 'show' }, page)).toEqual({
      ok: false,
      error: 'refused',
    })
  })

  it('answers nothing while the vault is locked, and says whether it is open', async () => {
    expect(await h.ok<{ unlocked: boolean }>({ kind: 'keysState' }, keysTab)).toMatchObject({
      unlocked: true,
    })
    await h.ok({ kind: 'lock' })
    expect(await h.send({ kind: 'keys' })).toEqual({ ok: false, error: 'locked' })
    expect(await h.send({ kind: 'pgpDecrypt', text: 'x' })).toEqual({ ok: false, error: 'locked' })
    expect(await h.ok<{ unlocked: boolean }>({ kind: 'keysState' }, keysTab)).toMatchObject({
      unlocked: false,
    })
  })

  it('refuses a message with an unknown field, an oversized text or no kind', async () => {
    const key = await generateSsh()
    // An extra field never reaches the core: it is dropped, and the call still answers
    const answered = await h.ok<KeyPublic>({ kind: 'keyPublic', id: key.id, address: 'evil' })
    expect(answered.pgp).toBe(false)
    expect(await h.send({ kind: 'keyPublic' })).toEqual({ ok: false, error: 'malformed' })
    expect(await h.send({ kind: 'previewKey', text: 'x'.repeat(1_200_000) })).toEqual({
      ok: false,
      error: 'malformed',
    })
    expect(await h.send({ kind: 'sshSign', text: 'x', keyId: key.id })).toEqual({
      ok: false,
      error: 'malformed',
    })
  })
})

describe('keys', () => {
  it('are made, listed, and kept with a sync soon after', async () => {
    h.mock.alarms.delete(syncSoonAlarm)
    const key = await generateSsh()
    expect(h.mock.alarms.has(syncSoonAlarm)).toBe(true)
    const listed = await h.ok<KeyView[]>({ kind: 'keys' })
    expect(listed.map((item) => item.id)).toEqual([key.id])
    expect(listed[0]).toMatchObject({ kind: 'ssh', name: 'laptop', origin: 'generated' })
  })

  it('give their public half without asking, and the private half only when asked', async () => {
    const key = await generateSsh()
    const publicHalf = await h.ok<KeyPublic>({ kind: 'keyPublic', id: key.id })
    expect(publicHalf.ssh).toContain('ssh-ed25519')
    expect(JSON.stringify(await h.ok({ kind: 'keys' }))).not.toContain('PRIVATE KEY')
    const out = await h.ok<KeyExport>({ kind: 'exportKey', id: key.id, purpose: 'show' })
    expect(out.text).toContain('PRIVATE KEY')
    expect(h.clipboard.writes).toEqual([])
  })

  it('are copied by the background itself, through the clipboard that clears', async () => {
    const key = await generateSsh()
    await h.ok({ kind: 'copyKey', id: key.id })
    expect(h.clipboard.text).toContain('PRIVATE KEY')
    // Nothing of the key came back to the page
    expect(await h.ok({ kind: 'copyKey', id: key.id })).toBeUndefined()
  })

  it('are renamed and deleted, and a key that is not there is not found', async () => {
    const key = await generateSsh()
    const saved = await h.ok<KeyView>({
      kind: 'saveKey',
      id: key.id,
      name: 'work laptop',
      note: 'office',
      tags: ['work'],
    })
    expect(saved).toMatchObject({ name: 'work laptop', note: 'office', tags: ['work'] })
    await h.ok({ kind: 'deleteKey', id: key.id })
    expect(await h.ok({ kind: 'keys' })).toEqual([])
    expect(await h.send({ kind: 'deleteKey', id: key.id })).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('are imported from what was exported, and not twice', async () => {
    const key = await generateSsh()
    const out = await h.ok<KeyExport>({ kind: 'exportKey', id: key.id, purpose: 'show' })
    await h.ok({ kind: 'deleteKey', id: key.id })
    const preview = await h.ok<{ kind: string; held: unknown }>({
      kind: 'previewKey',
      text: out.text,
    })
    expect(preview).toMatchObject({ kind: 'ssh', held: null })
    const added = await h.ok<KeyView>({ kind: 'importKey', text: out.text, name: 'again' })
    expect(added).toMatchObject({ name: 'again', origin: 'imported' })
    expect(await h.send({ kind: 'importKey', text: out.text, name: 'third' })).toEqual({
      ok: false,
      error: 'duplicate',
    })
  })

  it("say why a key is refused, in the core's word", async () => {
    expect(await h.send({ kind: 'previewKey', text: 'hello' })).toEqual({
      ok: false,
      error: 'keyUnrecognized',
    })
    const key = await generateSsh()
    const out = await h.ok<KeyExport>({
      kind: 'exportKey',
      id: key.id,
      purpose: 'file',
      passphrase: 'hunter2 pw',
    })
    await h.ok({ kind: 'deleteKey', id: key.id })
    expect(await h.send({ kind: 'previewKey', text: out.text })).toEqual({
      ok: false,
      error: 'keyPassphraseNeeded',
    })
    expect(await h.send({ kind: 'previewKey', text: out.text, passphrase: 'nope nope' })).toEqual({
      ok: false,
      error: 'keyWrongPassphrase',
    })
  })
})

describe('contacts', () => {
  it('are added from a public key, once, and marked as compared', async () => {
    const key = await generatePgp()
    const publicKey = (await h.ok<KeyPublic>({ kind: 'keyPublic', id: key.id })).pem!
    // The vault's own key is not a contact
    const own = await h.ok<ContactPreview[]>({ kind: 'previewContacts', text: publicKey })
    expect(own[0]?.status).toBe('own')
    await h.ok({ kind: 'deleteKey', id: key.id })
    const preview = await h.ok<ContactPreview[]>({ kind: 'previewContacts', text: publicKey })
    expect(preview[0]).toMatchObject({ status: 'new', name: 'Ada' })
    const [added] = await h.ok<ContactView[]>({
      kind: 'addContacts',
      text: publicKey,
      source: 'paste',
      checked: [preview[0]!.fingerprintHex],
    })
    expect(added).toMatchObject({ name: 'Ada', checked: true })
    expect(await h.ok<ContactView[]>({ kind: 'addContacts', text: publicKey })).toEqual([])
    const saved = await h.ok<ContactView>({
      kind: 'saveContact',
      id: added!.id,
      checked: false,
      name: 'Ada L.',
    })
    expect(saved).toMatchObject({ checked: false, name: 'Ada L.' })
    await h.ok({ kind: 'deleteContact', id: added!.id })
    expect(await h.ok({ kind: 'contacts' })).toEqual([])
  })
})

describe('the PGP tools', () => {
  it("encrypt to a contact and open with the contact's key, and sign and check", async () => {
    const key = await generatePgp()
    const publicKey = (await h.ok<KeyPublic>({ kind: 'keyPublic', id: key.id })).pem!
    const text = 'meet at noon'
    const sent = await h.ok<PgpEncrypted>({
      kind: 'pgpEncrypt',
      data: { text },
      contactIds: [],
      keyIds: [key.id],
    })
    expect('text' in sent && sent.text).toContain('BEGIN PGP MESSAGE')
    const opened = await h.ok<PgpDecrypted>({
      kind: 'pgpDecrypt',
      text: 'text' in sent ? sent.text : '',
    })
    expect(opened).toMatchObject({ text, isText: true, encrypted: true })
    const signed = await h.ok<{ text: string }>({ kind: 'pgpSign', text: 'I agree', keyId: key.id })
    const verified = await h.ok<{ signatures: { verdict: string }[]; text: string }>({
      kind: 'pgpVerify',
      text: signed.text,
    })
    expect(verified.text).toBe('I agree')
    expect(verified.signatures[0]?.verdict).toBe('good')
    expect(publicKey).toContain('PGP PUBLIC KEY')
  })

  it('refuse to encrypt to nobody, and say a passphrase is needed', async () => {
    expect(
      await h.send({ kind: 'pgpEncrypt', data: { text: 'x' }, contactIds: [], keyIds: [] }),
    ).toEqual({ ok: false, error: 'invalid' })
    const sent = await h.ok<{ text: string }>({
      kind: 'pgpEncrypt',
      data: { text: 'secret' },
      contactIds: [],
      keyIds: [],
      passphrase: 'blue heron',
    })
    expect(await h.send({ kind: 'pgpDecrypt', text: sent.text })).toEqual({
      ok: false,
      error: 'pgpPassphraseNeeded',
    })
    expect(await h.send({ kind: 'pgpDecrypt', text: sent.text, passphrase: 'red heron' })).toEqual({
      ok: false,
      error: 'pgpWrongPassphrase',
    })
  })

  it('sign and check an SSH signature for a namespace', async () => {
    const key = await generateSsh()
    const signed = await h.ok<{ text: string }>({
      kind: 'sshSign',
      keyId: key.id,
      namespace: 'file',
      text: 'notes',
    })
    const good = await h.ok<SshVerified>({
      kind: 'sshVerify',
      signature: signed.text,
      namespace: 'file',
      text: 'notes',
    })
    expect(good).toMatchObject({ verdict: 'good', own: { name: 'laptop' } })
    const wrong = await h.ok<SshVerified>({
      kind: 'sshVerify',
      signature: signed.text,
      namespace: 'git',
      text: 'notes',
    })
    expect(wrong.verdict).toBe('wrongNamespace')
  })
})
