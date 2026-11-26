// The keys, contacts and PGP tools' part of the contract (docs/plans/add-keys.md): what the vault's keys and contacts look like to
// the browser, and the calls over them. It adds to `CoreApi` and `PageApi` of ./api by declaration merging, so the shared file
// stays as it is.
//
// A private half leaves the core only through `exportKey`, and the background answers it to the extension's own pages and
// copies it itself (`copyKey`). A passphrase is a value of one call and is kept nowhere. Times are milliseconds since the
// epoch.

import type { ItemExtras, ItemExtrasInput, VaultState } from './api'

/* ----------------------------------------------------------------------------------------------- */
/* What the vault holds                                                                              */
/* ----------------------------------------------------------------------------------------------- */

export type KeyKind = 'ssh' | 'signing' | 'exchange' | 'pgp' | 'other'

/** A PGP key's standing now: worked out from its own dates each time, never stored. */
export type Standing = 'ok' | 'expiringSoon' | 'expired' | 'revoked'

export type SubkeyUse = 'certify' | 'sign' | 'encrypt' | 'authenticate'

export interface PgpSubkey {
  /** Grouped upper-case hexadecimal, as GnuPG prints it. */
  fingerprint: string
  algorithm: string
  uses: SubkeyUse[]
  expires?: number
  revoked: boolean
}

/** What a PGP key holds, read from its public half. */
export interface PgpFacts {
  /** The main user ID first. */
  userIds: string[]
  /** The email address of the first user ID that has one. */
  address?: string
  version: number
  /** The primary key may sign (an algorithm Kemlock uses). */
  canSign: boolean
  /** Written when a message to the key is post-quantum protected: `ML-KEM-768 + X25519`. */
  postQuantum?: string
  subkeys: PgpSubkey[]
}

/** A key of the vault, with no secret. */
export interface KeyView {
  id: string
  name: string
  kind: KeyKind
  /** `Ed25519`, `RSA 4096`, `OpenPGP`; an unknown algorithm by its identifier. */
  algorithm: string
  origin: 'generated' | 'imported' | (string & {})
  /** `SHA256:…` as `ssh-keygen -l` prints it, or a PGP key's fingerprint in groups of four; empty when unreadable. */
  fingerprint: string
  /** The line under the name: `ada@example.org · Ed25519`, or the algorithm. */
  line: string
  note?: string
  tags: string[]
  pinned: boolean
  addedAt: number
  /** A PGP key that keeps its own passphrase. */
  protected: boolean
  /** The private half is on a security key's OpenPGP card: nothing signs or decrypts with it here. */
  onCard: boolean
  hasPublic: boolean
  /** OpenSSH has a key type for it: it can sign as an SSH key and be kept as one. */
  hasSshForm: boolean
  /** It belongs to a shared space (listed and usable here, never saved to a file). */
  inSpace: boolean
  /** A PGP key only. */
  standing?: Standing
  expires?: number
  pgp?: PgpFacts
}

/** A key's public half in the forms it is handed out in, with the file names it is saved under. */
export interface KeyPublic {
  /** An SSH key's `authorized_keys` line. */
  ssh?: string
  sshFile?: string
  /** A PGP key's armored public key, or any other key's PEM. */
  pem?: string
  pemFile?: string
  pgp: boolean
}

/** The private half in its kind's form: an OpenSSH file, an armored PGP secret key, or PKCS#8 PEM. */
export interface KeyExport {
  text: string
  fileName: string
  /** A PGP key with a passphrase of its own goes out as it came: no other passphrase is put on it. */
  ownPassphrase: boolean
  partlyProtected: boolean
}

/** What a key or message is given as: pasted text, or a file's bytes in base64. */
export interface Source {
  text?: string
  base64?: string
}

export type PgpKeyType = 'ed25519' | 'pqStandard' | 'pqGnupg' | 'rsa4096'

export type GenerateKeyInput =
  | {
      kind: 'ssh' | 'signing' | 'exchange'
      /** `ed25519`, `ecdsa-p256`, `ecdsa-p384`, `rsa` (with `bits`), `x25519`, `ml-kem-768`, `ml-kem-1024`, `ml-dsa-65`. */
      algorithm: string
      bits?: number
      name: string
    }
  | {
      kind: 'pgp'
      type: PgpKeyType
      /** The name and email of its user ID. */
      name: string
      email: string
      /** Years from now, or null for never. */
      expiresInYears: number | null
    }

/** A key read from a file or pasted text, with the passphrase of a protected one. */
export type ReadKeyInput = Source & { passphrase?: string }

/** What importing a key would add, saving nothing. */
export interface KeyPreview {
  kind: KeyKind
  algorithm: string
  fingerprint: string
  /** The comment of an OpenSSH file, or a PGP key's first user ID: what the key is called unless the person says otherwise. */
  defaultName: string
  /** The key has an SSH form but is not an SSH key: it may be kept as one. */
  canBeSsh: boolean
  userIds: string[]
  protected: boolean
  /** The vault holds this key already: its id and name, and whether this copy adds to it (subkeys, user IDs, an expiry). */
  held: { id: string; name: string; update: boolean } | null
}

export type ContactSource = 'paste' | 'file'

/**
 * A person in the vault: a name with a company, an email, a phone and an address, and, optionally, their OpenPGP public key. Without
 * a key (`hasKey` false) the key's members are empty: no fingerprint, no user IDs, nothing to encrypt to.
 */
export interface ContactView extends ItemExtras {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  address?: string
  /** The contact holds a public key. */
  hasKey: boolean
  fingerprint: string
  line: string
  userIds: string[]
  /** `paste`, `file`, or `manual` for a contact made without a key. */
  source: string
  sourceEmail?: string
  /** The fingerprint of the key the contact holds is the one compared with its owner. */
  checked: boolean
  checkedAt?: number
  /** The addresses of the key's user IDs that the comparison does not cover. */
  uncheckedAddresses: string[]
  standing: Standing
  expires?: number
  /** A message can be encrypted to it: an encryption key that is neither expired nor revoked. */
  canEncrypt: boolean
  note?: string
  addedAt: number
  /** The stored key could not be read. */
  unreadable?: true
}

/** How a public key meets the vault when it is offered as a contact. */
export interface ContactPreview {
  /** Upper-case hexadecimal, as the comparison is made on. */
  fingerprintHex: string
  fingerprint: string
  name: string
  line: string
  userIds: string[]
  standing: Standing
  /**
   * `new`; `own` (it is one of the vault's key pairs); `held` (a contact has this key); `update` (a contact has it, and this
   * copy adds to it).
   */
  status: 'new' | 'own' | 'held' | 'update'
  /** The contact (or own key) that has it. */
  existing?: string
  existingName?: string
  /** A new key that shares an address with this contact, which it may replace. */
  sameAddressId?: string
  sameAddressName?: string
  sameAddress?: string
}

/* ----------------------------------------------------------------------------------------------- */
/* The PGP tools                                                                                     */
/* ----------------------------------------------------------------------------------------------- */

/** Who made a signature: a contact, or one of the vault's own keys. */
export interface SignerView {
  kind: 'contact' | 'key'
  id: string
  name: string
  /** A contact whose fingerprint the person compared (always true for the vault's own key). */
  checked: boolean
}

export type SignatureVerdict =
  'good' | 'bad' | 'unknownSigner' | 'weakHash' | 'weakKey' | 'unsupported'

export interface SignatureView {
  verdict: SignatureVerdict
  /** The fingerprint or key ID the signature names. */
  issuer?: string
  signer?: SignerView
  made?: number
  keyExpired: boolean
  /** The key had not expired when it signed, and has since. */
  keyExpiredSince: boolean
  keyRevoked: boolean
  /** What is not supported, or the weak key. */
  detail?: string
}

export type PgpData = Source & {
  /** A file's name, which the encrypted message carries. */
  fileName?: string
}

export interface PgpEncryptInput {
  /** The text or file. */
  data: PgpData
  contactIds: string[]
  /** The vault's own PGP keys to also encrypt to. */
  keyIds: string[]
  /** With no recipient: encrypt with this passphrase. */
  passphrase?: string
  /** Sign with this key of the vault, opened with `signPassphrase` when it keeps one. */
  signWith?: string
  signPassphrase?: string
}

/** An encrypted message: armored `text`, or the binary message of a file in `base64`. */
export type PgpEncrypted = { text: string } | { base64: string }

export interface PgpDecrypted {
  isText: boolean
  /** The message was encrypted (a clear-signed text is not). */
  encrypted: boolean
  length: number
  fileName: string
  text?: string
  base64?: string
  /** The key that opened it: one of the vault's. */
  openedWith?: SignerView
  openedWithPassphrase: boolean
  cipher?: string
  signatures: SignatureView[]
}

export type PgpSignForm = 'cleartext' | 'detachedArmored' | 'detached'

export interface PgpVerified {
  isText: boolean
  /** The signed content of a clear-signed text or a signed message. */
  text?: string
  base64?: string
  signatures: SignatureView[]
}

export type SshVerdict = 'good' | 'bad' | 'wrongNamespace' | 'unsupported' | 'weak' | 'weakKey'

export interface SshVerified {
  verdict: SshVerdict
  detail?: string
  keyType: string
  /** `SHA256:…` of the key that made the signature. */
  fingerprint: string
  namespace: string
  /** With a given signer key: it is the one that signed. Null when none was given. */
  matches: boolean | null
  /** The vault's own SSH key that made it, if one did. */
  own: { id: string; name: string } | null
}

/**
 * What `saveContact` takes: with an `id`, the members that change (a member left out stays, an empty text clears it); with `id: null`,
 * a new contact with no key (`source: 'manual'`), which needs a name. A key is added with `addContacts`.
 */
export interface ContactSave extends ItemExtrasInput {
  id: string | null
  name?: string
  company?: string
  email?: string
  phone?: string
  address?: string
  note?: string
  checked?: boolean
}

/* ----------------------------------------------------------------------------------------------- */
/* The calls                                                                                         */
/* ----------------------------------------------------------------------------------------------- */

/** What the Dart core answers, as `CoreApi` has them (src/background/core/bridge.ts lists the names). */
export interface KeysCoreApi {
  keys(): Promise<KeyView[]>
  keyPublic(id: string): Promise<KeyPublic>
  /**
   * The private half, for what `purpose` says: shown, copied or saved as a file. Only a file takes a passphrase, and a key of
   * a shared space is never saved to one.
   */
  exportKey(args: {
    id: string
    purpose: 'show' | 'copy' | 'file'
    passphrase?: string
  }): Promise<KeyExport>
  saveKey(args: { id: string; name?: string; note?: string; tags?: string[] }): Promise<KeyView>
  deleteKey(id: string): Promise<void>
  generateKey(args: GenerateKeyInput): Promise<KeyView>
  previewKey(args: ReadKeyInput): Promise<KeyPreview>
  importKey(
    args: ReadKeyInput & { name: string; asSsh?: boolean; update?: boolean },
  ): Promise<KeyView>

  contacts(): Promise<ContactView[]>
  previewContacts(args: Source): Promise<ContactPreview[]>
  addContacts(
    args: Source & { source?: ContactSource; checked?: string[]; replacing?: string },
  ): Promise<ContactView[]>
  saveContact(args: ContactSave): Promise<ContactView>
  contactPublic(id: string): Promise<{ pem: string; fileName: string }>
  deleteContact(id: string): Promise<void>

  pgpEncrypt(args: PgpData & Omit<PgpEncryptInput, 'data'>): Promise<PgpEncrypted>
  pgpDecrypt(args: Source & { passphrase?: string; fileName?: string }): Promise<PgpDecrypted>
  pgpSign(
    args: Source & { keyId: string; passphrase?: string; form?: PgpSignForm },
  ): Promise<{ text: string } | { base64: string }>
  pgpVerify(args: Source & { signature?: string; signatureBase64?: string }): Promise<PgpVerified>
  sshSign(args: Source & { keyId: string; namespace: string }): Promise<{ text: string }>
  sshVerify(
    args: Source & { signature?: string; namespace?: string; git?: boolean; signer?: string },
  ): Promise<SshVerified>
}

/** What the extension's pages ask the background (popup and the keys tab; `sender.page` is checked). */
export interface KeysPageApi {
  /** Whether the vault is open, for the keys tab, which has no lock screen of its own: unlocking is the popup's. */
  keysState(): Promise<VaultState>
  keys(): Promise<KeyView[]>
  keyPublic(args: { id: string }): Promise<KeyPublic>
  /** The private half, for the page to show or save as a file: asked only after the page's own warning. */
  exportKey(args: { id: string; purpose: 'show' | 'file'; passphrase?: string }): Promise<KeyExport>
  /** Copies the private half through the background's clipboard, which clears itself. */
  copyKey(args: { id: string }): Promise<void>
  saveKey(args: { id: string; name?: string; note?: string; tags?: string[] }): Promise<KeyView>
  deleteKey(args: { id: string }): Promise<void>
  generateKey(args: { input: GenerateKeyInput }): Promise<KeyView>
  previewKey(args: ReadKeyInput): Promise<KeyPreview>
  importKey(
    args: ReadKeyInput & { name: string; asSsh?: boolean; update?: boolean },
  ): Promise<KeyView>

  contacts(): Promise<ContactView[]>
  previewContacts(args: Source): Promise<ContactPreview[]>
  addContacts(
    args: Source & { source?: ContactSource; checked?: string[]; replacing?: string },
  ): Promise<ContactView[]>
  saveContact(args: ContactSave): Promise<ContactView>
  contactPublic(args: { id: string }): Promise<{ pem: string; fileName: string }>
  deleteContact(args: { id: string }): Promise<void>

  pgpEncrypt(args: PgpEncryptInput): Promise<PgpEncrypted>
  pgpDecrypt(args: Source & { passphrase?: string; fileName?: string }): Promise<PgpDecrypted>
  pgpSign(
    args: Source & { keyId: string; passphrase?: string; form?: PgpSignForm },
  ): Promise<{ text: string } | { base64: string }>
  pgpVerify(args: Source & { signature?: string; signatureBase64?: string }): Promise<PgpVerified>
  sshSign(args: Source & { keyId: string; namespace: string }): Promise<{ text: string }>
  sshVerify(
    args: Source & { signature?: string; namespace?: string; git?: boolean; signer?: string },
  ): Promise<SshVerified>
}

declare module './api' {
  // Declaration merging: the shared interfaces take these members on (an empty body is the point)
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface CoreApi extends KeysCoreApi {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface PageApi extends KeysPageApi {}
}

/** The largest file the tools take, which the core holds in memory and the message carries as base64. */
export const maxFileBytes = 16 * 1024 * 1024
