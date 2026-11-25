import { describe, expect, it } from 'vitest'
import { FakeCore } from './fake'

async function openCore(): Promise<FakeCore> {
  const core = new FakeCore({ sample: true })
  await core.unlock('correct horse')
  return core
}

describe('the keys of FakeCore', () => {
  it('answer nothing while the vault is locked, and keep what they hold across a restart', async () => {
    const core = new FakeCore({ sample: true })
    await expect(core.keys()).rejects.toThrow('locked')
    await core.unlock('correct horse')
    const made = await core.generateKey({ kind: 'ssh', algorithm: 'ed25519', name: 'laptop' })
    const again = new FakeCore({ disk: core.disk })
    await again.unlock('correct horse')
    expect((await again.keys()).map((key) => key.id)).toEqual([made.id])
    await core.lock()
    await expect(core.contacts()).rejects.toThrow('locked')
  })

  it('make a key of each kind, with the fields the screens read', async () => {
    const core = await openCore()
    const ssh = await core.generateKey({ kind: 'ssh', algorithm: 'ed25519', name: 'laptop' })
    expect(ssh).toMatchObject({ kind: 'ssh', algorithm: 'Ed25519', hasSshForm: true })
    expect(ssh.fingerprint).toMatch(/^SHA256:/)
    const pgp = await core.generateKey({
      kind: 'pgp',
      type: 'ed25519',
      name: 'Ada',
      email: 'ada@example.org',
      expiresInYears: null,
    })
    expect(pgp).toMatchObject({ kind: 'pgp', name: 'Ada <ada@example.org>', standing: 'ok' })
    expect(pgp.pgp?.userIds).toEqual(['Ada <ada@example.org>'])
    expect(pgp.expires).toBeUndefined()
    await expect(
      core.generateKey({ kind: 'ssh', algorithm: 'ed25519', name: ' ' }),
    ).rejects.toThrow('invalid')
  })

  it('hand a private half out only through exportKey, and protect it with a passphrase asked for later', async () => {
    const core = await openCore()
    const made = await core.generateKey({ kind: 'ssh', algorithm: 'ed25519', name: 'laptop' })
    expect(JSON.stringify(await core.keys())).not.toContain('PRIVATE')
    const out = await core.exportKey({ id: made.id, purpose: 'file', passphrase: 'a passphrase' })
    expect(out.text).toContain('BEGIN OPENSSH PRIVATE KEY')
    await core.deleteKey(made.id)
    await expect(core.previewKey({ text: out.text })).rejects.toThrow('keyPassphraseNeeded')
    await expect(core.previewKey({ text: out.text, passphrase: 'x' })).rejects.toThrow(
      'keyWrongPassphrase',
    )
    const added = await core.importKey({ text: out.text, passphrase: 'a passphrase', name: 'again' })
    expect(added.fingerprint).toBe(made.fingerprint)
    await expect(
      core.importKey({ text: out.text, passphrase: 'a passphrase', name: 'third' }),
    ).rejects.toThrow('duplicate')
  })

  it('take a contact from a public key and tell what a key block is', async () => {
    const core = await openCore()
    const pgp = await core.generateKey({
      kind: 'pgp',
      type: 'ed25519',
      name: 'Ada',
      email: 'ada@example.org',
      expiresInYears: 2,
    })
    const armored = (await core.keyPublic(pgp.id)).pem!
    expect((await core.previewContacts({ text: armored }))[0]?.status).toBe('own')
    await core.deleteKey(pgp.id)
    const [added] = await core.addContacts({ text: armored })
    expect(added).toMatchObject({ name: 'Ada', checked: false, canEncrypt: true })
    await expect(core.previewContacts({ text: 'nothing' })).rejects.toThrow('contactUnrecognized')
    expect((await core.saveContact({ id: added!.id, checked: true })).checked).toBe(true)
  })

  it('encrypt and decrypt, sign and verify, between a key and itself', async () => {
    const core = await openCore()
    const key = await core.generateKey({
      kind: 'pgp',
      type: 'ed25519',
      name: 'Ada',
      email: 'ada@example.org',
      expiresInYears: 2,
    })
    const sent = await core.pgpEncrypt({ text: 'hello', contactIds: [], keyIds: [key.id] })
    const opened = await core.pgpDecrypt({ text: 'text' in sent ? sent.text : '' })
    expect(opened.text).toBe('hello')
    await expect(core.pgpDecrypt({ text: 'plain words' })).rejects.toThrow('pgpNotAMessage')
    const signed = await core.pgpSign({ text: 'agreed', keyId: key.id })
    const checked = await core.pgpVerify({ text: 'text' in signed ? signed.text : '' })
    expect(checked.signatures[0]?.verdict).toBe('good')
    const altered = ('text' in signed ? signed.text : '').replace('agreed', 'refused')
    expect((await core.pgpVerify({ text: altered })).signatures[0]?.verdict).toBe('bad')
  })
})
