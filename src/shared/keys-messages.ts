// The requests of the keys, contacts and PGP tools that the extension's pages may send, as specs for the parser in ./messages
// (each is parsed into a fresh object of known fields, with its sizes bounded, so nothing a sender adds reaches the
// background's handlers). The parsers are handed in as `helpers` because messages.ts holds them and imports this file.
import { maxFileBytes, type KeysPageApi } from './keys-api'

type Parse = (value: unknown) => unknown
interface Field {
  parse: Parse
  optional: boolean
}

/** The small parsers of messages.ts that these specs are made of. */
export interface SpecHelpers {
  text: (max: number, min?: number) => Parse
  id: Parse
  bool: Parse
  int: (min: number, max: number) => Parse
  oneOf: (...allowed: string[]) => Parse
  list: (item: Parse, max: number) => Parse
  nullable: (item: Parse) => Parse
  obj: (spec: Record<string, Field>) => Parse
  req: (parse: Parse) => Field
  opt: (parse: Parse) => Field
}

/** The most text of a message, a signature or a key: the core's 1 MB, and UTF-16 units to spare. */
const maxText = 1_100_000
/** A file of the most the tools take, in base64. */
const maxBase64 = Math.ceil(maxFileBytes / 3) * 4 + 8

export function keysPageSpecs(h: SpecHelpers): { [K in keyof KeysPageApi]: Record<string, Field> } {
  const { text, id, bool, int, oneOf, list, nullable, obj, req, opt } = h
  const secret = text(4096, 1)
  // A text or a file's bytes: the core says when there is neither
  const source = { text: opt(text(maxText)), base64: opt(text(maxBase64)) }
  const readKey = { ...source, passphrase: opt(secret) }
  const edits = { name: opt(text(512)), note: opt(text(20_000)) }
  return {
    keysState: {},
    keys: {},
    keyPublic: { id: req(id) },
    exportKey: { id: req(id), purpose: req(oneOf('show', 'file')), passphrase: opt(secret) },
    copyKey: { id: req(id) },
    saveKey: { id: req(id), ...edits, tags: opt(list(text(100, 1), 50)) },
    deleteKey: { id: req(id) },
    generateKey: {
      input: req(
        obj({
          kind: req(oneOf('ssh', 'signing', 'exchange', 'pgp')),
          algorithm: opt(text(32, 1)),
          bits: opt(int(1024, 16_384)),
          type: opt(oneOf('ed25519', 'pqStandard', 'pqGnupg', 'rsa4096')),
          name: req(text(256, 1)),
          email: opt(text(320, 1)),
          expiresInYears: opt(nullable(int(1, 100))),
        }),
      ),
    },
    previewKey: readKey,
    importKey: { ...readKey, name: req(text(512, 1)), asSsh: opt(bool), update: opt(bool) },

    contacts: {},
    previewContacts: source,
    addContacts: {
      ...source,
      source: opt(oneOf('paste', 'file')),
      checked: opt(list(text(130, 1), 100)),
      replacing: opt(id),
    },
    saveContact: { id: req(id), ...edits, checked: opt(bool) },
    contactPublic: { id: req(id) },
    deleteContact: { id: req(id) },

    pgpEncrypt: {
      data: req(obj({ ...source, fileName: opt(text(255)) })),
      contactIds: req(list(id, 200)),
      keyIds: req(list(id, 200)),
      passphrase: opt(secret),
      signWith: opt(id),
      signPassphrase: opt(secret),
    },
    pgpDecrypt: { ...source, passphrase: opt(secret), fileName: opt(text(255)) },
    pgpSign: {
      ...source,
      keyId: req(id),
      passphrase: opt(secret),
      form: opt(oneOf('cleartext', 'detachedArmored', 'detached')),
    },
    pgpVerify: {
      ...source,
      signature: opt(text(maxText)),
      signatureBase64: opt(text(1_000_000)),
    },
    sshSign: { ...source, keyId: req(id), namespace: req(text(64, 1)) },
    sshVerify: {
      ...source,
      signature: opt(text(100_000)),
      namespace: opt(text(64, 1)),
      git: opt(bool),
      signer: opt(text(8000)),
    },
  }
}
