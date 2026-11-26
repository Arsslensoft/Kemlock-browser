// The messages the extension's parts send each other (design decision 4).
// Each part's messages are parsed into fresh objects of known fields, with
// their sizes bounded, so nothing a sender adds, like an address, reaches
// the background's handlers.
import { cxfKinds } from './transfer'
import type {
  CardPart,
  ContentApi,
  ItemKind,
  MatchRule,
  ContentRequest,
  FormPart,
  IdentityPart,
  PageApi,
  PageRequest,
  SecondMethod,
  StepAnswer,
} from './api'
import { spacePageSpecs } from './spaces-messages'
import { keysPageSpecs } from './keys-messages'
import { toolsPageSpecs } from './tools-messages'
import type { PasskeyOutcome } from './passkeys'
import { parseAccountRequest } from './account'

/** A field the content script found, by decision 7's rules. */
export type FieldKind = 'username' | 'password' | 'newPassword' | 'code' | 'card' | 'identity'

export interface FieldReport {
  /** The content script's own name for the field, unique in its frame. */
  id: string
  kind: FieldKind
  /** For a code split across one-character boxes: how many (4 to 10). */
  boxes?: number
  /**
   * The field's site rules (maxlength, minlength, passwordrules), for a new password; for a card or identity field, the
   * format the field shows (`len:5;year:2;sep:/`, see src/content/forms.ts), which only shapes the text filled in.
   */
  rules?: string
  /** A card or identity field: what it asks for, and the form or address block it is in. */
  part?: FormPart
  group?: string
  /** A card or identity field the person is in: a fill with no field named fills its block. */
  focus?: boolean
}

/**
 * What a content script may ask. It never names a site: the background
 * answers for the frame the browser says sent it.
 */
export type ContentMessage = ContentRequest

/** What only the extension's own pages may ask. */
export type PageMessage = PageRequest

/** What the background sends one frame of a tab. */
export type ToContent =
  /**
   * `origin` is the frame's origin the background matched the item against: the content script
   * refuses to fill when its own origin is another (the page may have gone elsewhere since), and
   * answers `{ ok: false }`.
   */
  | { kind: 'fill'; fieldId: string; value: string; origin: string; alt?: string[] }
  /** Opens the menu on a field by itself (the code after the password, decision 9 still holds). */
  | { kind: 'openMenu'; fieldId: string }
  /** Locking closes every open Kemlock menu. */
  | { kind: 'closeMenus' }
  /** The right-click menu was used: which editable field was it opened on? */
  | { kind: 'contextTarget' }
  /** A form was sent and the next page has loaded: show "Save to Kemlock?" if one is due. */
  | { kind: 'savePrompt' }
  /** Added by passkeys: show the passkey card (a request of this tab is waiting for the person). The top frame only. */
  | { kind: 'passkeyPrompt'; token: string }
  /** Added by passkeys: close the passkey card of this request, and no other menu or prompt. */
  | { kind: 'passkeyClose'; token: string }
  /** Added by passkeys: how a request the frame's page script started ended. */
  | { kind: 'passkeyDone'; id: string; result: PasskeyOutcome }
  /** Added by passkeys: is this request still waiting in this frame? Answers `{ ok: true }` when it is. */
  | { kind: 'passkeyPing'; id: string }
  /**
   * Asked of the top frame before a confirmed card or identity fill into a frame inside the page: is the frame `origin` drawn
   * there, in plain view? The answer is `{ ok: true }` only when every iframe of that origin is.
   */
  | { kind: 'frameVisible'; origin: string }

/** What a frame answers `contextTarget` with: the field it registered, or null. */
export interface ContextTarget {
  fieldId: string
  kind: FieldKind
  boxes?: number
  rules?: string
  part?: FormPart
  group?: string
}

export const fieldKinds: readonly FieldKind[] = [
  'username',
  'password',
  'newPassword',
  'code',
  'card',
  'identity',
]

export const cardParts: readonly CardPart[] = [
  'cardName',
  'cardNumber',
  'cardExp',
  'cardExpMonth',
  'cardExpYear',
  'cardCsc',
  'cardType',
]

export const identityParts: readonly IdentityPart[] = [
  'title',
  'fullName',
  'givenName',
  'middleName',
  'familyName',
  'company',
  'email',
  'phone',
  'birthDate',
  'birthDay',
  'birthMonth',
  'birthYear',
  'street',
  'line1',
  'line2',
  'line3',
  'city',
  'region',
  'postalCode',
  'country',
  'countryName',
]
const maxFields = 200
const maxIdLength = 64
const maxRulesLength = 512

/* ----------------------------------------------------------------------------------------------- */
/* Small parsers: each gives the value, or `bad`                                                     */
/* ----------------------------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const bad = Symbol('invalid')
type Bad = typeof bad
type Parser<T> = (value: unknown) => T | Bad

const text =
  (max: number, min = 0): Parser<string> =>
  (value) =>
    typeof value === 'string' && value.length >= min && value.length <= max ? value : bad
const id = text(128, 1)
const fieldId = text(maxIdLength, 1)
const bool: Parser<boolean> = (value) => (typeof value === 'boolean' ? value : bad)
const int =
  (min: number, max: number): Parser<number> =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? value
      : bad
const browserId = int(0, 2 ** 31 - 1)
const oneOf =
  <T extends string | number>(...allowed: readonly T[]): Parser<T> =>
  (value) =>
    allowed.includes(value as T) ? (value as T) : bad
const list =
  <T>(item: Parser<T>, max: number): Parser<T[]> =>
  (value) => {
    if (!Array.isArray(value) || value.length > max) return bad
    const out: T[] = []
    for (const element of value) {
      const parsed = item(element)
      if (parsed === bad) return bad
      out.push(parsed as T)
    }
    return out
  }
const nullable =
  <T>(item: Parser<T>): Parser<T | null> =>
  (value) =>
    value === null ? null : item(value)

interface Field {
  parse: Parser<unknown>
  optional: boolean
}
const req = (parse: Parser<unknown>): Field => ({ parse, optional: false })
const opt = (parse: Parser<unknown>): Field => ({ parse, optional: true })

/** A fresh object of the spec's fields only, or `bad` when one is missing or wrong. */
function shape<T>(raw: unknown, spec: Record<string, Field>): T | Bad {
  if (!isRecord(raw)) return bad
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(spec)) {
    const value = Object.hasOwn(raw, key) ? raw[key] : undefined
    if (value === undefined) {
      if (field.optional) continue
      return bad
    }
    const parsed = field.parse(value)
    if (parsed === bad) return bad
    out[key] = parsed
  }
  return out as T
}
const obj =
  <T>(spec: Record<string, Field>): Parser<T> =>
  (value) =>
    shape<T>(value, spec)

/* ----------------------------------------------------------------------------------------------- */
/* Values the requests carry                                                                         */
/* ----------------------------------------------------------------------------------------------- */

const password = text(4096)
const secondMethods: readonly SecondMethod[] = [
  'authenticator',
  'email',
  'yubikey',
  'securityKey',
  'duo',
  'apiKey',
  'recoveryCode',
]

// Added by item format (begin): custom fields and links (docs/plans/add-item-format.md). An item is named by its kind and an entry id.
export const itemKinds: readonly ItemKind[] = [
  'login',
  'note',
  'file',
  'otp',
  'backup-codes',
  'card',
  'identity',
  'contact',
  'ssh-key',
  'pgp-key',
  'certificate',
  'passkey',
  'key',
  'key-otp',
]
/**
 * The kind of an item a link names: any word of 1 to 40 lower-case letters, digits and dashes, so a link the core holds to a kind this
 * build does not list round-trips instead of failing the whole save (the core checks what the vault holds).
 */
const itemKind: Parser<ItemKind> = (value) =>
  typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) ? (value as ItemKind) : bad
export const matchRules: readonly MatchRule[] = [
  'default',
  'domain',
  'host',
  'startsWith',
  'exact',
  'regex',
  'never',
]
/** An entry id (a UUID, or what the vault names an entry). */
const entryId = text(100, 1)
const itemRef = obj({ kind: req(itemKind), id: req(entryId) })
const exactlyTrue: Parser<true> = (value) => (value === true ? true : bad)
export const maxFieldRows = 100
export const maxLinks = 100
const fieldInput = obj({
  origin: opt(int(0, 9999)),
  // A row with no name is dropped by the core, so an empty one is allowed through
  name: req(text(200)),
  kind: req(oneOf('text', 'hidden', 'boolean')),
  value: opt(text(10_000)),
  keepValue: opt(exactlyTrue),
  adminField: opt(text(100, 1)),
})
// A blank row (an editor row nobody typed in) is let through, and the core drops it
const websiteRule = obj({ uri: req(text(2000)), match: req(oneOf(...matchRules)) })
/** `fields` and `links` of an input: a missing one leaves them as they are. */
const itemExtras = {
  fields: opt(list(fieldInput, maxFieldRows)),
  links: opt(list(itemRef, maxLinks)),
}
// Added by item format (end)

const loginInput = obj({
  name: req(text(512)),
  username: req(text(1024)),
  password: req(password),
  /** Spaces: a password a grant hides is kept as it is (docs/plans/add-spaces.md). */
  keepPassword: opt(bool),
  websites: req(list(text(2048, 1), 50)),
  websiteRules: opt(list(websiteRule, 50)),
  note: opt(text(20_000)),
  tags: opt(list(text(100, 1), 50)),
  ...itemExtras,
})

const optText = (max: number) => opt(text(max))
const tagList = opt(list(text(100, 1), 50))

const noteInput = obj({
  title: req(text(512)),
  text: req(text(10_000)),
  pinned: opt(bool),
  tags: tagList,
  ...itemExtras,
})

// Added by item format (begin): a code's account and a service's backup codes, a File item, a staged or attached file
const codeInput = obj({
  name: optText(512),
  websites: opt(list(text(2048, 1), 50)),
  note: optText(20_000),
  pinned: opt(bool),
  ...itemExtras,
})
const backupCodesInput = obj({
  name: optText(512),
  websites: opt(list(text(2048, 1), 50)),
  note: optText(20_000),
  ...itemExtras,
})
/** What the core names a staged or opened file by. */
const itemFileHandle = text(64, 1)
const stagedFile = obj({ handle: req(itemFileHandle), name: req(text(255, 1)), type: optText(255) })
const fileInput = obj({
  name: req(text(512)),
  notes: optText(20_000),
  pinned: opt(bool),
  tags: tagList,
  links: opt(list(itemRef, maxLinks)),
  staged: opt(stagedFile),
})
/** A piece of a file crosses as base64: 1 MiB is 1,398,104 characters. */
const itemFileChunk = text(1_398_104)
// Added by item format (end)

const cardInput = obj({
  name: req(text(512)),
  cardholder: optText(256),
  number: optText(64),
  brand: optText(40),
  expMonth: opt(int(1, 12)),
  expYear: opt(int(0, 9999)),
  code: optText(16),
  pin: optText(16),
  validFromMonth: opt(int(1, 12)),
  validFromYear: opt(int(0, 9999)),
  note: optText(20_000),
  tags: tagList,
  pinned: opt(bool),
  fromAutofill: opt(bool),
  ...itemExtras,
})

const identityAddressInput = obj({
  lines: opt(list(text(2048), 3)),
  city: optText(2048),
  region: optText(2048),
  postalCode: optText(2048),
  country: optText(2048),
})

const identityDocumentInput = obj({
  id: opt(id),
  type: req(text(64, 1)),
  number: req(text(2048, 1)),
  issuingCountry: optText(2048),
  issuingAuthority: optText(2048),
  issuedOn: optText(32),
  expiresOn: optText(32),
})

const identityInput = obj({
  name: req(text(512)),
  title: optText(256),
  givenName: optText(512),
  middleName: optText(512),
  familyName: optText(512),
  company: optText(512),
  email: optText(512),
  phone: optText(128),
  username: optText(512),
  birthDate: optText(32),
  address: opt(identityAddressInput),
  documents: opt(list(identityDocumentInput, 50)),
  note: optText(20_000),
  tags: tagList,
  pinned: opt(bool),
  ...itemExtras,
})

const generatorOptions = obj({
  mode: req(oneOf('random', 'passphrase')),
  length: opt(int(8, 128)),
  lowercase: opt(bool),
  uppercase: opt(bool),
  digits: opt(bool),
  symbols: opt(bool),
  words: opt(int(3, 20)),
  separator: opt(text(8)),
  capitalize: opt(bool),
  includeNumber: opt(bool),
  siteRules: opt(text(2000)),
  avoidLookAlikes: opt(bool),
})

const settingsPatch = obj({
  autoLockMinutes: opt(oneOf(1, 5, 15, 60)),
  lockOnSleep: opt(bool),
  codeAfterPassword: opt(bool),
  buttonsOnPages: opt(bool),
  breachedPasswords: opt(bool),
  offerToSave: opt(bool),
  clipboardSeconds: opt(oneOf(10, 30, 60, 120)),
  passkeys: opt(bool),
})

const stepAnswer: Parser<StepAnswer> = (value) => {
  if (!isRecord(value)) return bad
  const spec = (step: string, fields: Record<string, Field>) =>
    shape<StepAnswer>(value, { step: req(oneOf(step)), ...fields })
  switch (value.step) {
    case 'second':
      return spec('second', {
        method: req(oneOf(...secondMethods)),
        code: req(text(2048)),
        remember: req(bool),
      })
    case 'securityKey':
      return spec('securityKey', { assertion: req(text(200_000)), remember: req(bool) })
    case 'approval':
      return spec('approval', { requestId: req(id) })
    case 'masterPassword':
      return spec('masterPassword', { password: req(password) })
    case 'homes':
      return spec('homes', { homeId: req(id) })
    case 'passphrase':
      return spec('passphrase', { passphrase: req(password) })
    case 'firstSync':
      return spec('firstSync', { go: req(bool) })
    case 'recoveryKit':
      return spec('recoveryKit', { pieces: req(list(text(300, 1), 3)) })
    default:
      return bad
  }
}

const anyText = text(2048, 1)
/**
 * A server or folder address: an http or https URL. Only https is signed in to, since the password goes to it, and the
 * core answers an http one with the step the setup tab shows (`insecure`), before any request is made.
 */
const address: Parser<string> = (value) => {
  const typed = anyText(value)
  if (typed === bad) return bad
  try {
    const { protocol } = new URL(typed)
    return protocol === 'https:' || protocol === 'http:' ? typed : bad
  } catch {
    return bad
  }
}
const otpauth = text(4096, 1)

// Added by unlock (begin): a credential's id and a PRF output are base64url; the output is 32 bytes (43 characters).
const credentialId: Parser<string> = (value) =>
  typeof value === 'string' && value.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(value) ? value : bad
const prfOutput: Parser<string> = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : bad
// Added by unlock (end)
// Added by sends (begin)
const sendTime = int(0, 2 ** 53)
// The core's handles are 22 characters; a page names one by what the core gave it
const sendHandle = text(64, 1)
const sendLimit = int(1, 2 ** 31 - 1)
const sendInput = obj({
  kind: req(oneOf('text', 'file')),
  name: req(text(512, 1)),
  // A sealed payload must fit 256 KiB: the core says when a text is too long, this only bounds the message
  text: opt(text(270_000)),
  mime: opt(text(255)),
  handle: opt(sendHandle),
  size: opt(int(0, 2 ** 31)),
  notes: req(text(16_384)),
  deleteInDays: req(int(1, 30)),
  expiresAt: opt(sendTime),
  maxAccess: opt(sendLimit),
  password: opt(password),
  hideEmail: req(bool),
})
const sendPatch = obj({
  name: opt(text(512, 1)),
  notes: opt(text(16_384)),
  text: opt(text(270_000)),
  deletionAt: opt(sendTime),
  expiresAt: opt(nullable(sendTime)),
  maxAccess: opt(nullable(sendLimit)),
  hideEmail: opt(bool),
  disabled: opt(bool),
  newPassword: opt(password),
  removePassword: opt(bool),
})
// A piece of a file crosses as base64: 1 MiB is 1,398,104 characters
const sendChunk = text(1_500_000)
// Added by sends (end)
// Added by transfer (begin): a file to import is at most this many characters of base64 (40 MiB of file, under the 64 MiB a message may be
// in Chrome), a picture this many of data URL, and the pictures of one message this many together.
export const maxTransferData = 54 * 1024 * 1024
const maxTransferImage = 22 * 1024 * 1024
export const maxTransferImages = 44 * 1024 * 1024

/** A list of pictures that are not more than [maxTransferImages] characters together. */
const pictures: Parser<string[]> = (value) => {
  const images = list(text(maxTransferImage, 1), 40)(value)
  if (images === bad) return bad
  return images.reduce((sum, image) => sum + image.length, 0) <= maxTransferImages ? images : bad
}

const transferOptions = obj({
  mode: opt(oneOf('merge', 'replace')),
  excluded: opt(list(text(256, 1), 500)),
  keepChecks: opt(bool),
})
const transferToken = text(128, 1)
// Added by transfer (end)

/** Each page request's arguments, as a spec. A method with none has `{}`. */
type PageSpecs = { [K in keyof PageApi]: Record<string, Field> }
const pageSpecs: PageSpecs = {
  popup: { tabId: opt(browserId) },
  pageState: {},
  createVault: { password: req(password) },
  unlock: { password: req(password) },
  lock: {},
  removeVault: {},
  codes: {},
  liveCodes: { ids: req(list(id, 500)) },
  nextHotp: { id: req(id) },
  logins: {},
  saveLogin: { id: req(nullable(id)), input: req(loginInput) },
  deleteLogin: { id: req(id) },
  ignoreHealth: { id: req(id), ignored: req(bool) },
  showPassword: { id: req(id) },
  backupCodes: {},
  health: {},
  generate: { options: req(generatorOptions) },
  recentPasswords: {},
  copy: {
    what: req(
      oneOf(
        'username',
        'password',
        'code',
        'backupCode',
        'generated',
        'cardNumber',
        'cardCode',
        'cardPin',
        'cardholder',
        'email',
        'phone',
        'documentNumber',
        'noteText',
        'field',
      ),
    ),
    id: req(text(128)),
    value: opt(text(4096)),
    documentId: opt(id),
    ref: opt(itemRef),
    index: opt(int(0, 9999)),
  },
  fill: {
    tabId: req(browserId),
    frameId: opt(browserId),
    fieldId: opt(fieldId),
    loginId: opt(id),
    codeId: opt(id),
    newPassword: opt(text(1024, 1)),
    remember: opt(bool),
    picked: opt(bool),
    cardId: opt(id),
    identityId: opt(id),
  },
  addCodeFromLink: { otpauth: req(otpauth), website: opt(text(253, 1)), linkTo: opt(id) },
  addCodeFromTab: { tabId: req(browserId), linkTo: opt(id) },
  readCodeFromTab: { tabId: req(browserId) },
  linkCode: { codeId: req(id), loginId: req(nullable(id)) },
  nextCodes: { ids: req(list(id, 500)) },
  useBackupCode: { serviceId: req(id) },
  rememberedSites: { loginId: req(id) },
  forgetSite: { loginId: req(id), host: req(text(253, 1)) },
  notes: {},
  revealNote: { id: req(id) },
  saveNote: { id: req(nullable(id)), input: req(noteInput) },
  deleteNote: { id: req(id) },
  cards: {},
  revealCard: { id: req(id) },
  saveCard: { id: req(nullable(id)), input: req(cardInput) },
  deleteCard: { id: req(id) },
  identities: {},
  revealIdentity: { id: req(id) },
  saveIdentity: { id: req(nullable(id)), input: req(identityInput) },
  deleteIdentity: { id: req(id) },
  showSecret: {
    what: req(oneOf('cardNumber', 'cardCode', 'cardPin', 'documentNumber')),
    id: req(id),
    documentId: opt(id),
  },
  // Added by item format (begin): custom fields, links and files
  customFieldDefs: { refresh: opt(bool) },
  revealField: { ref: req(itemRef), index: req(int(0, 9999)) },
  revealFields: { ref: req(itemRef) },
  linkedItems: { ref: req(itemRef) },
  linkCandidates: { ref: req(nullable(itemRef)), query: req(text(200)) },
  setLinks: { ref: req(itemRef), refs: req(list(itemRef, maxLinks)) },
  saveCode: { id: req(id), input: req(codeInput) },
  saveBackupCodes: { serviceId: req(id), input: req(backupCodesInput) },
  files: {},
  revealFile: { id: req(id) },
  deleteFile: { id: req(id) },
  saveFile: { id: req(nullable(id)), input: req(fileInput) },
  stageItemFile: { data: req(itemFileChunk), handle: opt(itemFileHandle) },
  releaseStaged: { handle: req(itemFileHandle) },
  addAttachments: { noteId: req(id), files: req(list(stagedFile, 100)) },
  removeAttachment: { noteId: req(id), attachmentId: req(id) },
  openItemFile: { ref: req(itemRef), attachmentId: opt(id) },
  // A file is at most 50 MiB: 50 pieces
  readOpened: { handle: req(itemFileHandle), index: req(int(0, 100)) },
  closeOpened: { handle: req(itemFileHandle) },
  // Added by item format (end)
  syncStatus: {},
  signInKemlock: { server: req(address), email: req(text(320, 1)), password: req(password) },
  signInKemlockSso: { server: req(address), email: opt(text(320)) },
  signInKemlockPasskey: { server: req(address), email: opt(text(320)) },
  signInWebdav: { folder: req(address), username: req(text(1024)), password: req(password) },
  signInVaultwarden: { server: req(address), email: req(text(320, 1)), password: req(password) },
  answerStep: { answer: req(stepAnswer) },
  checkServer: { place: req(oneOf('kemlock', 'vaultwarden')), server: req(address) },
  securityKeyChallenge: {},
  syncNow: {},
  confirmRemovals: {},
  keepRemovals: {},
  signOut: {},
  settings: {},
  saveSettings: { settings: req(settingsPatch) },
  allSitesGranted: {},
  menu: { tabId: req(browserId), frameId: req(browserId), fieldId: req(fieldId) },
  pendingSave: { tabId: req(browserId) },
  answerSave: {
    tabId: req(browserId),
    save: req(bool),
    never: opt(bool),
    card: opt(bool),
    identity: opt(bool),
  },
  // Added by unlock (begin)
  passkeyUnlockInfo: {},
  passkeyUnlockPrepare: {},
  addPasskeyUnlock: {
    name: req(text(100, 1)),
    password: req(password),
    credentialId: req(credentialId),
    prfOutput: req(prfOutput),
    rpId: opt(text(253, 1)),
    attachment: opt(oneOf('platform', 'cross-platform')),
    transports: opt(list(text(32, 1), 8)),
  },
  renamePasskeyUnlock: { id: req(id), name: req(text(100, 1)) },
  removePasskeyUnlock: { id: req(id) },
  unlockWithPasskey: { credentialId: req(credentialId), prfOutput: req(prfOutput) },
  // Added by unlock (end)
  // Spaces (docs/plans/add-spaces.md)
  ...spacePageSpecs({
    req,
    opt,
    text,
    bool,
    nullable,
    oneOf,
    address,
  }),
  // Added by sends (begin)
  sends: {},
  sendGet: { id: req(id) },
  sendCopyLink: { id: req(id) },
  sendStageFile: { data: req(sendChunk), handle: opt(sendHandle) },
  sendMake: { input: req(sendInput) },
  sendUpdate: { id: req(id), patch: req(sendPatch) },
  sendDelete: { id: req(id) },
  sendOpen: { link: req(text(8192, 1)), password: opt(password) },
  sendDownload: { handle: req(sendHandle) },
  sendReadFile: { handle: req(sendHandle), index: req(int(0, 100)) },
  sendCopyText: { handle: req(sendHandle) },
  sendClose: { handle: req(sendHandle) },
  sendFromNote: { id: req(id) },
  sendTakeDraft: { token: req(text(64, 1)) },
  sendSaveAsNote: { handle: req(sendHandle) },
  // Added by sends (end)
  // Keys, contacts and the PGP tools (docs/plans/add-keys.md)
  ...keysPageSpecs({ text, id, bool, int, oneOf, list, nullable, obj, req, opt }, itemExtras),
  // Added by tools: the vault tools' requests (src/shared/tools-messages.ts)
  ...toolsPageSpecs({ bad, text, id, bool, int, oneOf, list, obj, req, opt }),
  // Added by passkeys (docs/plans/add-passkeys.md)
  passkeys: {},
  deletePasskey: { id: req(id) },
  passkeyHere: { host: req(text(253, 1)) },
  passkeyHereSet: { host: req(text(253, 1)), off: req(bool) },
  passkeyPrompt: { tabId: req(browserId), token: req(text(64, 1)) },
  passkeyAnswer: {
    tabId: req(browserId),
    token: req(text(64, 1)),
    action: req(oneOf('save', 'use', 'other', 'cancel', 'never', 'dismiss')),
    passkeyId: opt(id),
  },
  passkeyChoose: {
    tabId: req(browserId),
    frameId: req(browserId),
    fieldId: req(fieldId),
    passkeyId: req(id),
  },
  // Added by transfer (begin)
  transferUnlock: { password: req(password) },
  transferOpen: { data: req(text(maxTransferData, 1)) },
  transferOpenQr: { images: req(pictures) },
  transferPreview: { token: req(transferToken), password: opt(password) },
  // A Recovery Kit has at most nine pieces (`maxPieces`), each a line of about 80 characters
  transferPreviewKit: { token: req(transferToken), pieces: req(list(text(300, 1), 9)) },
  transferPlan: { token: req(transferToken), options: req(transferOptions) },
  transferApply: { token: req(transferToken), options: req(transferOptions) },
  transferCancel: { token: req(transferToken) },
  transferExportInfo: {},
  transferExport: {
    format: req(oneOf('encrypted', 'plain', 'csv', 'links', 'cxf')),
    password: req(password),
    exportPassword: opt(password),
    kinds: opt(list(oneOf(...cxfKinds), cxfKinds.length)),
  },
  transferExportQr: {
    format: req(oneOf('google', 'kemlock', 'kemlockPlain')),
    password: req(password),
    transferPassword: opt(password),
  },
  // End of added by transfer
  // The account's own calls: each op's own fields are checked by src/shared/account.ts
  account: { request: req((value) => parseAccountRequest(value) ?? bad) },
}

const maxGroupLength = 32
const formPart = oneOf<FormPart>(...cardParts, ...identityParts)

const fieldReport = obj<FieldReport>({
  id: req(fieldId),
  kind: req(oneOf(...fieldKinds)),
  boxes: opt(int(4, 10)),
  rules: opt(text(maxRulesLength)),
  part: opt(formPart),
  group: opt(text(maxGroupLength, 1)),
  focus: opt(bool),
})

/**
 * Whether a field's part and group agree with its kind: a card field has a card part, an identity field an identity part,
 * and no other field has either.
 */
function partFits(field: { kind: FieldKind; part?: FormPart; group?: string }): boolean {
  if (field.kind === 'card')
    return field.part !== undefined && cardParts.includes(field.part as CardPart)
  if (field.kind === 'identity')
    return field.part !== undefined && identityParts.includes(field.part as IdentityPart)
  return field.part === undefined && field.group === undefined
}

/** A field report, or `bad`: boxes belong to a code field only, and a part to a card or identity field. */
function parseField(raw: unknown): FieldReport | Bad {
  const field = fieldReport(raw)
  if (field === bad) return bad
  if (field.boxes !== undefined && field.kind !== 'code') return bad
  if (!partFits(field)) return bad
  if (field.focus !== undefined && field.kind !== 'card' && field.kind !== 'identity') return bad
  return field
}

/* Added by passkeys: a WebAuthn request as the page script reports it, with every size bounded. The background reads what it needs
 * of it and checks the rest; nothing here is trusted for who asks or where (that is the browser's word on the sender). */
const base64url =
  (max: number, min = 1): Parser<string> =>
  (value) =>
    typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9_-]*$/.test(value)
      ? value
      : bad
const passkeyDescriptor = obj({ type: req(oneOf('public-key')), id: req(base64url(2048)) })
const passkeyOptions = obj({
  rp: opt(obj({ id: opt(text(253)), name: opt(text(512)) })),
  user: opt(obj({ id: req(base64url(128)), name: req(text(1024)), displayName: opt(text(1024)) })),
  rpId: opt(text(253)),
  challenge: req(base64url(2048)),
  pubKeyCredParams: opt(
    list(obj({ type: req(oneOf('public-key')), alg: req(int(-65536, 65536)) }), 32),
  ),
  excludeCredentials: opt(list(passkeyDescriptor, 100)),
  allowCredentials: opt(list(passkeyDescriptor, 100)),
  authenticatorSelection: opt(
    obj({
      authenticatorAttachment: opt(text(32)),
      residentKey: opt(text(32)),
      requireResidentKey: opt(bool),
      userVerification: opt(text(32)),
    }),
  ),
  attestation: opt(text(32)),
  userVerification: opt(text(32)),
  timeout: opt(int(0, 2 ** 31 - 1)),
  extensions: opt(obj({ credProps: opt(bool), prf: opt(bool), largeBlob: opt(bool) })),
})

const contentSpecs: { [K in keyof ContentApi]: Record<string, Field> } = {
  fields: {
    fields: req((value) => {
      const fields = list(parseField, maxFields)(value)
      if (fields === bad) return bad
      return new Set(fields.map((field) => field.id)).size === fields.length ? fields : bad
    }),
  },
  sent: { username: req(text(1024)), password: req(password), newPassword: opt(password) },
  cardSent: {
    number: req(text(64)),
    holder: req(text(256)),
    expiry: req(text(32)),
    month: req(text(32)),
    year: req(text(32)),
    code: req(text(16)),
  },
  identitySent: {
    given: req(text(256)),
    family: req(text(256)),
    full: req(text(512)),
    email: req(text(320)),
    phone: req(text(128)),
    company: req(text(512)),
    line1: req(text(512)),
    city: req(text(256)),
    postalCode: req(text(64)),
    country: req(text(256)),
  },
  openMenu: { fieldId: req(fieldId) },
  frame: {},
  // Added by passkeys
  passkeyBegin: {
    id: req(text(64, 1)),
    type: req(oneOf('create', 'get')),
    conditional: req(bool),
    options: req(passkeyOptions),
  },
  passkeyCancel: { id: req(text(64, 1)) },
  passkeyStatus: {},
}

const isKind = <S extends object>(specs: S, kind: unknown): kind is keyof S =>
  typeof kind === 'string' && Object.hasOwn(specs, kind)

/** A content script's message, or null when it isn't one. */
export function parseContentMessage(raw: unknown): ContentMessage | null {
  if (!isRecord(raw) || !isKind(contentSpecs, raw.kind)) return null
  const args = shape<object>(raw, contentSpecs[raw.kind])
  return args === bad ? null : ({ kind: raw.kind, ...args } as ContentMessage)
}

/** An extension page's message, or null when it isn't one. */
export function parsePageMessage(raw: unknown): PageMessage | null {
  if (!isRecord(raw) || !isKind(pageSpecs, raw.kind)) return null
  const args = shape<object>(raw, pageSpecs[raw.kind])
  return args === bad ? null : ({ kind: raw.kind, ...args } as PageMessage)
}

/** What a frame answered `contextTarget` with, or null when it isn't one. */
export function parseContextTarget(raw: unknown): ContextTarget | null {
  if (raw === null || raw === undefined) return null
  const target = shape<ContextTarget>(raw, {
    fieldId: req(fieldId),
    kind: req(oneOf(...fieldKinds)),
    boxes: opt(int(4, 10)),
    rules: opt(text(maxRulesLength)),
    part: opt(formPart),
    group: opt(text(maxGroupLength, 1)),
  })
  if (target === bad || (target.boxes !== undefined && target.kind !== 'code')) return null
  if (!partFits(target)) return null
  return target
}

/** Whether a frame said it could not fill (an answer that says nothing counts as filled). */
export function fillRefused(raw: unknown): boolean {
  return isRecord(raw) && raw.ok === false
}
