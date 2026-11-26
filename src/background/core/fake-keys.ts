// The keys, contacts and PGP tools of `FakeCore`: in memory, following `KeysCoreApi`'s contract and not the real formats. A key's
// private half is a line of text, an encrypted message is a base64 of what it says, and a signature is a line that names its
// signer, so the popup's tests and the background's can follow a key from one vault to another by copying text.
import type { ItemExtras, ItemKind, ItemRef } from '../../shared/api'
import type { FakeExtras } from './fake-extras'
import type {
  ContactPreview,
  ContactSave,
  ContactView,
  KeyExport,
  KeyPreview,
  KeyPublic,
  KeysCoreApi,
  KeyView,
  PgpDecrypted,
  PgpEncrypted,
  PgpVerified,
  SignatureView,
  SignerView,
  SshVerified,
  Standing,
} from '../../shared/keys-api'

/** A fake's error: the background passes its message on as the word the page shows. */
class KeysFakeError extends Error {
  constructor(word: string) {
    super(word)
    this.name = 'KemlockError'
  }
}

interface StoredKey {
  id: string
  name: string
  kind: KeyView['kind']
  algorithm: string
  origin: string
  fingerprint: string
  /** What the fake's "private key" says: the id, and the passphrase it is protected by. */
  secret: string
  pgp?: { name: string; email: string }
  note?: string
  tags: string[]
  addedAt: number
  inSpace: boolean
  standing: Standing
  expires?: number
}

interface StoredContact {
  id: string
  name: string
  fingerprint: string
  address: string
  source: string
  checked: boolean
  note?: string
  standing: Standing
  addedAt: number
  /** The details of a person (item format); a contact made without a key has these and an empty fingerprint. */
  company?: string
  email?: string
  phone?: string
  postal?: string
}

interface State {
  keys: StoredKey[]
  contacts: StoredContact[]
  next: number
}

const states = new WeakMap<object, State>()
const hex = (seed: number): string =>
  Array.from({ length: 10 }, (_, i) => ((seed * 2_654_435_761 + i * 40_503) >>> 0).toString(16))
    .join('')
    .toUpperCase()
    .replace(/[^0-9A-F]/g, 'A')
    .slice(0, 40)
const grouped = (fingerprint: string): string => fingerprint.match(/.{1,4}/g)?.join(' ') ?? ''
const encode = (value: unknown): string => btoa(JSON.stringify(value))
const decode = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(atob(text))
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  } catch {
    // Not one of ours
  }
  throw new KeysFakeError('pgpNotAMessage')
}
const block = (label: string, body: string): string =>
  `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
const inside = (text: string, label: string): string | undefined =>
  new RegExp(`-----BEGIN ${label}-----\\n([^\\n]*)\\n-----END ${label}-----`).exec(text)?.[1]
const textOf = (source: { text?: string; base64?: string }): string =>
  source.text ?? (source.base64 === undefined ? '' : atob(source.base64))

export class KeysFake implements KeysCoreApi {
  constructor(
    disk: object,
    private readonly open: () => boolean,
    private readonly now: () => number,
    /** Fields and links of the item format, which a contact takes as every item does. */
    private readonly extras?: FakeExtras,
  ) {
    if (!states.has(disk)) states.set(disk, { keys: [], contacts: [], next: 1 })
    this.state = states.get(disk)!
  }

  private readonly state: State

  private need(): State {
    if (!this.open()) throw new KeysFakeError('locked')
    return this.state
  }

  private id(prefix: string): string {
    return `${prefix}-${this.state.next++}`
  }

  private key(id: string): StoredKey {
    const key = this.need().keys.find((k) => k.id === id)
    if (key === undefined) throw new KeysFakeError('notFound')
    return key
  }

  private contact(id: string): StoredContact {
    const contact = this.need().contacts.find((c) => c.id === id)
    if (contact === undefined) throw new KeysFakeError('notFound')
    return contact
  }

  private view(key: StoredKey): KeyView {
    const pgp = key.kind === 'pgp'
    const email = key.pgp?.email ?? ''
    return {
      id: key.id,
      name: key.name,
      kind: key.kind,
      algorithm: key.algorithm,
      origin: key.origin,
      fingerprint: key.fingerprint,
      line: pgp ? `${email} · ${key.algorithm}` : key.algorithm,
      ...(key.note === undefined ? {} : { note: key.note }),
      tags: [...key.tags],
      pinned: false,
      addedAt: key.addedAt,
      protected: false,
      onCard: false,
      hasPublic: true,
      hasSshForm: key.kind === 'ssh',
      inSpace: key.inSpace,
      ...(pgp
        ? {
            standing: key.standing,
            ...(key.expires === undefined ? {} : { expires: key.expires }),
            pgp: {
              userIds: [`${key.pgp?.name ?? ''} <${email}>`],
              address: email,
              version: 4,
              canSign: true,
              subkeys: [
                {
                  fingerprint: grouped(hex(key.addedAt + 1)),
                  algorithm: 'X25519',
                  uses: ['encrypt' as const],
                  revoked: false,
                },
              ],
            },
          }
        : {}),
    }
  }

  private contactView(contact: StoredContact, failures: string[] = []): ContactView {
    const hasKey = contact.fingerprint !== ''
    const more: ItemExtras = this.extras?.view({ kind: 'contact', id: contact.id }) ?? {
      fields: [],
      links: 0,
    }
    return {
      id: contact.id,
      name: contact.name,
      ...(contact.company === undefined ? {} : { company: contact.company }),
      ...(contact.email === undefined ? {} : { email: contact.email }),
      ...(contact.phone === undefined ? {} : { phone: contact.phone }),
      ...(contact.postal === undefined ? {} : { address: contact.postal }),
      hasKey,
      ...more,
      ...(failures.length > 0 ? { linkFailures: failures } : {}),
      fingerprint: grouped(contact.fingerprint),
      line: hasKey ? `${contact.address} · Ed25519` : (contact.email ?? contact.company ?? ''),
      userIds: hasKey ? [`${contact.name} <${contact.address}>`] : [],
      source: contact.source,
      checked: contact.checked,
      uncheckedAddresses: contact.checked || !hasKey ? [] : [contact.address],
      standing: contact.standing,
      canEncrypt: hasKey && (contact.standing === 'ok' || contact.standing === 'expiringSoon'),
      ...(contact.note === undefined ? {} : { note: contact.note }),
      addedAt: contact.addedAt,
    }
  }

  async keys(): Promise<KeyView[]> {
    return this.need().keys.map((key) => this.view(key))
  }

  async keyPublic(id: string): Promise<KeyPublic> {
    const key = this.key(id)
    const base = key.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'key'
    if (key.kind === 'ssh')
      return {
        ssh: `ssh-ed25519 AAAAFAKE${key.fingerprint} ${key.name}`,
        sshFile: `${base}.pub`,
        pem: block('PUBLIC KEY', key.fingerprint),
        pemFile: `${base}.pub.pem`,
        pgp: false,
      }
    if (key.kind === 'pgp')
      return {
        pem: block(
          'PGP PUBLIC KEY BLOCK',
          `fake:${key.fingerprint}:${key.pgp?.name ?? ''}:${key.pgp?.email ?? ''}`,
        ),
        pemFile: `${base}.pub.asc`,
        pgp: true,
      }
    return { pem: block('PUBLIC KEY', key.fingerprint), pemFile: `${base}.pub.pem`, pgp: false }
  }

  async exportKey(args: Parameters<KeysCoreApi['exportKey']>[0]): Promise<KeyExport> {
    const key = this.key(args.id)
    if (!['show', 'copy', 'file'].includes(args.purpose)) throw new KeysFakeError('invalid')
    if (args.passphrase !== undefined && (args.passphrase === '' || args.purpose !== 'file'))
      throw new KeysFakeError('invalid')
    if (args.purpose === 'file' && key.inSpace) throw new KeysFakeError('keyInSpace')
    const label =
      key.kind === 'ssh'
        ? 'OPENSSH PRIVATE KEY'
        : key.kind === 'pgp'
          ? 'PGP PRIVATE KEY BLOCK'
          : 'PRIVATE KEY'
    const own = args.passphrase === undefined ? '' : `;passphrase=${args.passphrase}`
    const body = `fake|${key.kind}|${key.algorithm}|${key.name}|${key.fingerprint}${own}`
    const base = key.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'key'
    return {
      text: block(label, body),
      fileName: key.kind === 'ssh' ? base : key.kind === 'pgp' ? `${base}.asc` : `${base}.pem`,
      ownPassphrase: false,
      partlyProtected: false,
    }
  }

  async saveKey(args: {
    id: string
    name?: string
    note?: string
    tags?: string[]
  }): Promise<KeyView> {
    const key = this.key(args.id)
    if (args.name !== undefined && args.name.trim() !== '') key.name = args.name.trim()
    if (args.note !== undefined) key.note = args.note.trim() === '' ? undefined : args.note.trim()
    if (args.tags !== undefined) key.tags = [...args.tags]
    return this.view(key)
  }

  async deleteKey(id: string): Promise<void> {
    this.key(id)
    this.state.keys = this.state.keys.filter((key) => key.id !== id)
  }

  async generateKey(args: Parameters<KeysCoreApi['generateKey']>[0]): Promise<KeyView> {
    const state = this.need()
    if (args.name.trim() === '') throw new KeysFakeError('invalid')
    const id = this.id('key')
    const fingerprint = hex(state.next * 7919)
    if (args.kind === 'pgp') {
      if (args.email.trim() === '') throw new KeysFakeError('invalid')
      const key: StoredKey = {
        id,
        name: `${args.name.trim()} <${args.email.trim()}>`,
        kind: 'pgp',
        algorithm: args.type === 'rsa4096' ? 'RSA 4096' : 'Ed25519',
        origin: 'generated',
        fingerprint: grouped(fingerprint),
        secret: '',
        pgp: { name: args.name.trim(), email: args.email.trim() },
        tags: [],
        addedAt: this.now(),
        inSpace: false,
        standing: 'ok',
        ...(args.expiresInYears === null
          ? {}
          : { expires: this.now() + args.expiresInYears * 365 * 86_400_000 }),
      }
      state.keys.push(key)
      return this.view(key)
    }
    const algorithm =
      args.algorithm === 'rsa'
        ? `RSA ${args.bits ?? 3072}`
        : args.algorithm === 'ed25519'
          ? 'Ed25519'
          : args.algorithm === 'ecdsa-p256'
            ? 'ECDSA P-256'
            : args.algorithm.toUpperCase()
    const key: StoredKey = {
      id,
      name: args.name.trim(),
      kind: args.kind,
      algorithm,
      origin: 'generated',
      fingerprint: `SHA256:${fingerprint}`,
      secret: '',
      tags: [],
      addedAt: this.now(),
      inSpace: false,
      standing: 'ok',
    }
    state.keys.push(key)
    return this.view(key)
  }

  /** What a pasted private key says it is: the fake's own lines, or a shape that fails as the real one does. */
  private read(args: { text?: string; base64?: string; passphrase?: string }): {
    kind: StoredKey['kind']
    algorithm: string
    name: string
    fingerprint: string
  } {
    const text = textOf(args)
    const body =
      inside(text, 'OPENSSH PRIVATE KEY') ??
      inside(text, 'PGP PRIVATE KEY BLOCK') ??
      inside(text, 'PRIVATE KEY')
    if (body === undefined) {
      if (/-----BEGIN (PGP PUBLIC KEY BLOCK|PUBLIC KEY)-----/.test(text) || /^ssh-/.test(text))
        throw new KeysFakeError('keyPublicKeyOnly')
      throw new KeysFakeError('keyUnrecognized')
    }
    const wanted = /;passphrase=(.*)$/.exec(body)?.[1]
    if (wanted !== undefined) {
      if (args.passphrase === undefined || args.passphrase === '')
        throw new KeysFakeError('keyPassphraseNeeded')
      if (args.passphrase !== wanted) throw new KeysFakeError('keyWrongPassphrase')
    }
    const [, kind = 'signing', algorithm = 'Ed25519', name = 'imported', fingerprint = ''] = body
      .replace(/;passphrase=.*$/, '')
      .split('|')
    return { kind: kind as StoredKey['kind'], algorithm, name, fingerprint }
  }

  async previewKey(args: Parameters<KeysCoreApi['previewKey']>[0]): Promise<KeyPreview> {
    this.need()
    const read = this.read(args)
    const held = this.state.keys.find((key) => key.fingerprint === read.fingerprint)
    return {
      kind: read.kind,
      algorithm: read.algorithm,
      fingerprint: read.fingerprint,
      defaultName: read.name,
      canBeSsh: read.kind === 'signing' && read.algorithm === 'Ed25519',
      userIds: [],
      protected: false,
      held: held === undefined ? null : { id: held.id, name: held.name, update: false },
    }
  }

  async importKey(args: Parameters<KeysCoreApi['importKey']>[0]): Promise<KeyView> {
    const state = this.need()
    const read = this.read(args)
    const held = state.keys.find((key) => key.fingerprint === read.fingerprint)
    if (held !== undefined) throw new KeysFakeError('duplicate')
    if (args.name.trim() === '') throw new KeysFakeError('invalid')
    const key: StoredKey = {
      id: this.id('key'),
      name: args.name.trim(),
      kind: args.asSsh === true ? 'ssh' : read.kind,
      algorithm: read.algorithm,
      origin: 'imported',
      fingerprint: read.fingerprint,
      secret: '',
      tags: [],
      addedAt: this.now(),
      inSpace: false,
      standing: 'ok',
    }
    state.keys.push(key)
    return this.view(key)
  }

  async contacts(): Promise<ContactView[]> {
    return this.need().contacts.map((contact) => this.contactView(contact))
  }

  /** The fake's public keys: `fake:<fingerprint>:<name>:<email>` in a PGP PUBLIC KEY BLOCK. */
  private readPublic(source: { text?: string; base64?: string }): ContactPreview[] {
    const text = textOf(source)
    if (/-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(text))
      throw new KeysFakeError('contactPrivateKeyGiven')
    const found = [...text.matchAll(/-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake:([^:]+):([^:]*):([^\n]*)\n/g)]
    if (found.length === 0) throw new KeysFakeError('contactUnrecognized')
    return found.map(([, fingerprint = '', name = '', address = '']) => {
      const compact = fingerprint.replace(/ /g, '')
      const own = this.state.keys.find((key) => key.fingerprint.replace(/ /g, '') === compact)
      const held = this.state.contacts.find((c) => c.fingerprint === compact)
      const same = this.state.contacts.find((c) => c.address === address && c !== held)
      return {
        fingerprintHex: compact,
        fingerprint: grouped(compact),
        name,
        line: `${address} · Ed25519`,
        userIds: [`${name} <${address}>`],
        standing: 'ok' as const,
        status: (own ? 'own' : held ? 'held' : 'new') as ContactPreview['status'],
        ...(own || held ? { existing: (own ?? held)!.id } : {}),
        ...(same === undefined || own || held
          ? {}
          : { sameAddressId: same.id, sameAddressName: same.name, sameAddress: address }),
      }
    })
  }

  async previewContacts(args: Parameters<KeysCoreApi['previewContacts']>[0]): Promise<ContactPreview[]> {
    this.need()
    return this.readPublic(args)
  }

  async addContacts(args: Parameters<KeysCoreApi['addContacts']>[0]): Promise<ContactView[]> {
    const state = this.need()
    const added: ContactView[] = []
    const checked = new Set((args.checked ?? []).map((fp) => fp.replace(/ /g, '')))
    for (const plan of this.readPublic(args)) {
      if (plan.status === 'own') continue
      if (plan.status !== 'new') {
        const held = state.contacts.find((c) => c.fingerprint === plan.fingerprintHex)!
        if (checked.has(plan.fingerprintHex) && !held.checked) {
          held.checked = true
          added.push(this.contactView(held))
        }
        continue
      }
      const replaced =
        args.replacing === undefined ? undefined : state.contacts.find((c) => c.id === args.replacing)
      const contact: StoredContact = replaced ?? {
        id: this.id('contact'),
        name: plan.name,
        fingerprint: plan.fingerprintHex,
        address: /<([^>]*)>/.exec(plan.userIds[0] ?? '')?.[1] ?? '',
        source: args.source ?? 'paste',
        checked: false,
        standing: 'ok',
        addedAt: this.now(),
      }
      if (replaced !== undefined) {
        contact.fingerprint = plan.fingerprintHex
        contact.checked = false
      } else {
        state.contacts.push(contact)
      }
      if (checked.has(plan.fingerprintHex)) contact.checked = true
      added.push(this.contactView(contact))
    }
    return added
  }

  async saveContact(args: ContactSave): Promise<ContactView> {
    const state = this.need()
    const text = (value: string | undefined): string | undefined => {
      const trimmed = (value ?? '').trim()
      return trimmed === '' ? undefined : trimmed
    }
    let contact: StoredContact
    if (args.id === null) {
      // A person with no key: a name is all it must have
      const name = text(args.name)
      if (name === undefined) throw new KeysFakeError('invalid')
      this.extras?.check('contact', args)
      contact = {
        id: this.id('contact'),
        name,
        fingerprint: '',
        address: '',
        source: 'manual',
        checked: false,
        standing: 'ok',
        addedAt: this.now(),
      }
      state.contacts.push(contact)
    } else {
      contact = this.contact(args.id)
      this.extras?.validate({ kind: 'contact', id: contact.id }, args)
      if (args.name !== undefined && args.name.trim() !== '') contact.name = args.name.trim()
    }
    if (args.note !== undefined) contact.note = text(args.note)
    if (args.checked !== undefined) contact.checked = args.checked
    if (args.company !== undefined) contact.company = text(args.company)
    if (args.email !== undefined) contact.email = text(args.email)
    if (args.phone !== undefined) contact.phone = text(args.phone)
    if (args.address !== undefined) contact.postal = text(args.address)
    for (const key of ['company', 'email', 'phone', 'postal', 'note'] as const)
      if (contact[key] === undefined) delete contact[key]
    const failures = this.extras?.apply({ kind: 'contact', id: contact.id }, args) ?? []
    return this.contactView(contact, failures)
  }

  /** What a ref names, when it is a contact or a key of this vault: its name and the line under it. */
  nameOf(ref: ItemRef): { name: string; detail?: string } | undefined {
    return this.items().find((item) => item.ref.kind === ref.kind && item.ref.id === ref.id)
  }

  /** The contacts and keys, as items that may be linked. */
  items(): { ref: ItemRef; name: string; detail?: string }[] {
    // What the real core's `itemKindOf` says: an SSH or PGP key by its kind, any other key (signing, exchange) is a `key`
    const kindOf = (kind: StoredKey['kind']): ItemKind =>
      kind === 'ssh' ? 'ssh-key' : kind === 'pgp' ? 'pgp-key' : 'key'
    return [
      ...this.state.contacts.map((contact) => ({
        ref: { kind: 'contact' as const, id: contact.id },
        name: contact.name,
        ...(contact.email === undefined ? {} : { detail: contact.email }),
      })),
      ...this.state.keys.map((key) => ({
        ref: { kind: kindOf(key.kind), id: key.id },
        name: key.name,
        detail: key.algorithm,
      })),
    ]
  }

  async contactPublic(id: string): Promise<{ pem: string; fileName: string }> {
    const contact = this.contact(id)
    if (contact.fingerprint === '') throw new KeysFakeError('noKey')
    return {
      pem: block('PGP PUBLIC KEY BLOCK', `fake:${contact.fingerprint}:${contact.name}:${contact.address}`),
      fileName: `${contact.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.pub.asc`,
    }
  }

  async deleteContact(id: string): Promise<void> {
    this.contact(id)
    this.state.contacts = this.state.contacts.filter((contact) => contact.id !== id)
    this.extras?.forget({ kind: 'contact', id })
  }

  /* ---------------------------------------------------------------------------------------- */
  /* The tools                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  /** The people a fingerprint (compact) may be: a contact, or one of the vault's own keys. */
  private signerOf(fingerprint: string): SignerView | undefined {
    const own = this.state.keys.find((key) => key.fingerprint.replace(/ /g, '') === fingerprint)
    if (own !== undefined) return { kind: 'key', id: own.id, name: own.name, checked: true }
    const contact = this.state.contacts.find((c) => c.fingerprint === fingerprint)
    return contact === undefined
      ? undefined
      : { kind: 'contact', id: contact.id, name: contact.name, checked: contact.checked }
  }

  private signature(fingerprint: string | undefined, good: boolean): SignatureView {
    const signer = fingerprint === undefined ? undefined : this.signerOf(fingerprint)
    return {
      verdict: !good ? 'bad' : signer === undefined ? 'unknownSigner' : 'good',
      ...(signer === undefined ? {} : { signer }),
      made: this.now(),
      keyExpired: false,
      keyExpiredSince: false,
      keyRevoked: false,
    }
  }

  private pgpKey(id: string): StoredKey {
    const key = this.key(id)
    if (key.kind !== 'pgp') throw new KeysFakeError('invalid')
    return key
  }

  async pgpEncrypt(args: Parameters<KeysCoreApi['pgpEncrypt']>[0]): Promise<PgpEncrypted> {
    this.need()
    const to = [
      ...(args.contactIds ?? []).map((id) => {
        const { fingerprint } = this.contact(id)
        // A contact with no key has nothing to encrypt to
        if (fingerprint === '') throw new KeysFakeError('noKey')
        return fingerprint
      }),
      ...(args.keyIds ?? []).map((id) => this.pgpKey(id).fingerprint.replace(/ /g, '')),
    ]
    if (to.length === 0 && (args.passphrase === undefined || args.passphrase === ''))
      throw new KeysFakeError('invalid')
    const signer = args.signWith === undefined ? undefined : this.pgpKey(args.signWith)
    const payload = encode({
      to,
      ...(to.length === 0 ? { passphrase: args.passphrase } : {}),
      data: args.text ?? args.base64,
      isText: args.text !== undefined,
      fileName: args.fileName ?? '',
      ...(signer === undefined ? {} : { signer: signer.fingerprint.replace(/ /g, '') }),
    })
    return args.text !== undefined
      ? { text: block('PGP MESSAGE', payload) }
      : { base64: btoa(payload) }
  }

  async pgpDecrypt(args: Parameters<KeysCoreApi['pgpDecrypt']>[0]): Promise<PgpDecrypted> {
    this.need()
    const raw = args.text === undefined ? atob(args.base64 ?? '') : inside(args.text, 'PGP MESSAGE')
    if (raw === undefined) {
      if (args.text !== undefined && /-----BEGIN PGP SIGNED MESSAGE-----/.test(args.text)) {
        const verified = await this.pgpVerify({ text: args.text })
        return {
          isText: true,
          encrypted: false,
          length: verified.text?.length ?? 0,
          fileName: '',
          text: verified.text ?? '',
          openedWithPassphrase: false,
          signatures: verified.signatures,
        }
      }
      throw new KeysFakeError('pgpNotAMessage')
    }
    const message = decode(raw)
    const to = message.to as string[]
    let opened: SignerView | undefined
    if (to.length === 0) {
      if (args.passphrase === undefined || args.passphrase === '')
        throw new KeysFakeError('pgpPassphraseNeeded')
      if (args.passphrase !== message.passphrase) throw new KeysFakeError('pgpWrongPassphrase')
    } else {
      const key = this.state.keys.find(
        (k) => k.kind === 'pgp' && to.includes(k.fingerprint.replace(/ /g, '')),
      )
      if (key === undefined) throw new KeysFakeError('pgpNoKeyOpensIt')
      opened = { kind: 'key', id: key.id, name: key.name, checked: true }
    }
    const isText = message.isText === true
    const data = String(message.data ?? '')
    return {
      isText,
      encrypted: true,
      length: data.length,
      fileName: String(message.fileName ?? ''),
      ...(isText ? { text: data } : { base64: data }),
      ...(opened === undefined ? {} : { openedWith: opened }),
      openedWithPassphrase: to.length === 0,
      signatures:
        typeof message.signer === 'string' ? [this.signature(message.signer, true)] : [],
    }
  }

  async pgpSign(
    args: Parameters<KeysCoreApi['pgpSign']>[0],
  ): ReturnType<KeysCoreApi['pgpSign']> {
    this.need()
    const key = this.pgpKey(args.keyId)
    const fingerprint = key.fingerprint.replace(/ /g, '')
    const form = args.form ?? 'cleartext'
    if (form === 'cleartext') {
      if (args.text === undefined) throw new KeysFakeError('invalid')
      const proof = encode({ fingerprint, digest: args.text.length })
      return {
        text: `-----BEGIN PGP SIGNED MESSAGE-----\n\n${args.text}\n${block('PGP SIGNATURE', proof)}`,
      }
    }
    const proof = encode({ fingerprint, digest: textOf(args).length })
    return form === 'detached' ? { base64: btoa(proof) } : { text: block('PGP SIGNATURE', proof) }
  }

  async pgpVerify(args: Parameters<KeysCoreApi['pgpVerify']>[0]): Promise<PgpVerified> {
    this.need()
    const detached = args.signature ?? (args.signatureBase64 === undefined ? undefined : atob(args.signatureBase64))
    if (detached !== undefined) {
      const proof = decode(inside(detached, 'PGP SIGNATURE') ?? detached)
      const good = proof.digest === textOf(args).length
      return { isText: false, signatures: [this.signature(String(proof.fingerprint), good)] }
    }
    const text = textOf(args)
    if (/-----BEGIN PGP MESSAGE-----/.test(text)) throw new KeysFakeError('pgpIsEncrypted')
    const match = /^-----BEGIN PGP SIGNED MESSAGE-----\n\n([\s\S]*)\n-----BEGIN PGP SIGNATURE-----\n([^\n]*)\n/.exec(text)
    if (match === null) throw new KeysFakeError('pgpNotAMessage')
    const [, content = '', proof = ''] = match
    const parsed = decode(proof)
    return {
      isText: true,
      text: content,
      signatures: [this.signature(String(parsed.fingerprint), parsed.digest === content.length)],
    }
  }

  async sshSign(args: Parameters<KeysCoreApi['sshSign']>[0]): Promise<{ text: string }> {
    this.need()
    const key = this.key(args.keyId)
    if (key.kind !== 'ssh' || /\s/.test(args.namespace)) throw new KeysFakeError('invalid')
    return {
      text: block(
        'SSH SIGNATURE',
        encode({ fingerprint: key.fingerprint, namespace: args.namespace, digest: textOf(args).length }),
      ),
    }
  }

  async sshVerify(args: Parameters<KeysCoreApi['sshVerify']>[0]): Promise<SshVerified> {
    this.need()
    const body = inside(args.signature ?? '', 'SSH SIGNATURE')
    if (body === undefined) throw new KeysFakeError('sshNotSsh')
    const proof = decode(body)
    const namespace = String(proof.namespace)
    const own = this.state.keys.find((key) => key.fingerprint === proof.fingerprint)
    const verdict =
      namespace !== args.namespace
        ? 'wrongNamespace'
        : proof.digest === textOf(args).length
          ? 'good'
          : 'bad'
    return {
      verdict,
      ...(verdict === 'wrongNamespace' ? { detail: namespace } : {}),
      keyType: 'ssh-ed25519',
      fingerprint: String(proof.fingerprint),
      namespace,
      matches: null,
      own: own === undefined ? null : { id: own.id, name: own.name },
    }
  }
}
