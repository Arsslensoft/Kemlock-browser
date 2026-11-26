// The contract between the extension's parts (design decisions 3 and 4).
//
// - `CoreApi` is what the background calls in the Dart core (core/, compiled with dart2wasm over
//   Kemlock-core). Only the background holds it. Secrets stay inside it: a code's secret never
//   leaves, and a password leaves only through `revealLogin`, which the background calls to copy or
//   fill, never to answer a page.
// - `PageApi` is what the extension's own pages (popup, setup, menu) may ask the background.
// - `ContentApi` is what a content script may ask; it names no site, the background answers for the
//   frame the browser reports.
//
// Every value here is JSON: messages cross `runtime.sendMessage`, and the core answers through
// JS interop with plain objects. Times are milliseconds since the epoch.
import type {
  NewSendInput,
  ReceivedSendView,
  SendDetail,
  SendDraft,
  SendPatch,
  SendResult,
  SendsListing,
} from './sends'

import type { ToolsCoreApi, ToolsPageApi } from './tools-api'
import type {
  CreatedPasskey,
  PasskeyAction,
  PasskeyChoice,
  PasskeyCreationOptions,
  PasskeyCredentialJson,
  PasskeyPrompt,
  PasskeyRequestOptions,
  PasskeyStart,
  PasskeyView,
} from './passkeys'

import type {
  ExportedFile,
  ExportInfo,
  ExportRequest,
  QrExport,
  QrExportRequest,
  TransferOpened,
  TransferOptions,
  TransferPlan,
  TransferPreview,
  TransferResult,
} from './transfer'

import type { AccountRequest, AccountResult } from './account'

/* ----------------------------------------------------------------------------------------------- */
/* What the vault holds, as the browser shows it                                                     */
/* ----------------------------------------------------------------------------------------------- */

export type CodeType = 'totp' | 'hotp' | 'steam'

/** A code's account, with no secret. */
export interface CodeView extends ItemExtras {
  id: string
  /** Its own name, when it has one (the issuer names it otherwise). */
  name?: string
  issuer: string
  account: string
  type: CodeType
  digits: number
  /** TOTP and Steam: seconds per code. */
  period: number
  tags: string[]
  /** The vault's own order, which the order tool changes. */
  order: number
  /** Pinned to the top of its list (the app's `pinned`). */
  pinned?: boolean
  /** Kept on a security key: named, never computed or filled (spec). */
  onSecurityKey: boolean
  /**
   * Its websites and the issuer's domains, for matching and the hint. A code linked to items takes the websites of those
   * (`websitesFrom` names them), and these are then theirs.
   */
  websites: string[]
  /** The websites the code names itself, whatever the linked items lend. */
  ownWebsites: string[]
  /** The linked items that lend their websites: changed on them, not here. */
  websitesFrom?: ItemRef[]
  /** The login it is linked to, if any. */
  loginId?: string
  /** Its note. */
  note?: string
  /** Backup codes left for the service, when the vault has them. */
  backupCodesLeft?: number
}

/** A code found on a page, not yet added. */
export interface CodePreview {
  /** The link the QR code holds, to be added as it is or with another name. */
  otpauth: string
  /** The name it would have, and its account. */
  issuer: string
  account: string
  /** The page's site, which the code would have as its website. */
  website?: string
  /** The code in the vault that has this secret already. */
  existing?: CodeView
}

/** A live code: only the digits leave the core. */
export interface LiveCode {
  id: string
  code: string
  /** When it stops being valid (TOTP, Steam); absent for HOTP. */
  expiresAt?: number
}

export interface LoginHealth {
  reused: boolean
  weak: boolean
  /** The site offers two-step sign-in and no code is linked. */
  withoutItsCode: boolean
  /** Known from a breach (only behind the breached-passwords switch). */
  breached?: boolean
  /** "Don't warn for this login". */
  ignored: boolean
}

/** A login, with no password. */
export interface LoginView extends ItemExtras {
  id: string
  name: string
  username: string
  websites: string[]
  /** Each website with the rule that matches it (`websites` is the same addresses, without the rules). */
  websiteRules: WebsiteRuleView[]
  tags: string[]
  order: number
  /** Pinned to the top of its list (the app's `pinned`). */
  pinned?: boolean
  note?: string
  hasPassword: boolean
  /** Strength 0 (weakest) to 4, the app's meter. Left out for a password a shared space hides from this account. */
  strength?: number
  passwordChangedAt?: number
  previousPasswords: number
  codeId?: string
  health: LoginHealth
}

export interface LoginSecret {
  username: string
  password: string
}

export interface LoginInput extends ItemExtrasInput {
  name: string
  username: string
  password: string
  websites: string[]
  /** Wins over `websites` when present. Only http and https addresses; a regex must compile. */
  websiteRules?: WebsiteRuleView[]
  note?: string
  tags?: string[]
  /** A login saved from "Save to Kemlock?": the app marks it `source: 'autofill'` (a new login only). */
  fromAutofill?: boolean
}

export interface BackupCodeView extends ItemExtras {
  /** The service's id; one row per service. */
  serviceId: string
  /** Its own name, when it has one. */
  name?: string
  issuer: string
  /** Its websites (the linked items' when it is linked to some). */
  websites: string[]
  total: number
  left: number
  /** Two codes or fewer are left (the app's low warning). */
  low?: boolean
}

/** What fills on a page or a tab's address: every match is offered (spec). */
export interface SiteMatch {
  /** The address's registrable domain, shown in the picker. */
  site: string
  logins: string[]
  codes: string[]
  /** The address looks like a known site's but isn't it (the look-alike guard). */
  lookAlikeOf?: string
  /** Added by passkeys: the passkeys whose relying party is the address's host or a domain above it. */
  passkeys?: string[]
}

export interface GeneratorOptions {
  mode: 'random' | 'passphrase'
  /** Random: 8 to 128. */
  length?: number
  lowercase?: boolean
  uppercase?: boolean
  digits?: boolean
  symbols?: boolean
  /** Passphrase: 3 to 20 words from the EFF list. */
  words?: number
  separator?: string
  capitalize?: boolean
  includeNumber?: boolean
  /** A site's rules (maxlength, minlength, pattern, password-rules), when filling a new-password field. */
  siteRules?: string
  // Added by popup
  /** Leave out look-alike characters (l, 1, I, O, 0); true when not given. */
  avoidLookAlikes?: boolean
}

export interface GeneratedPassword {
  value: string
  at: number
  site?: string
}

export interface HealthReport {
  reused: string[]
  weak: string[]
  withoutItsCode: string[]
  breached: string[]
}

/* ----------------------------------------------------------------------------------------------- */
/* The item format's additions: custom fields, links, website rules, files                           */
/* ----------------------------------------------------------------------------------------------- */

/** The kinds of item the vault holds, as the server names them; an item is named by one of these and its entry id. */
export type ItemKind =
  | 'login'
  | 'note'
  | 'file'
  | 'otp'
  | 'backup-codes'
  | 'card'
  | 'identity'
  | 'contact'
  | 'ssh-key'
  | 'pgp-key'
  | 'certificate'
  | 'passkey'

/** One item: its kind and its entry id (never the server's item id). */
export interface ItemRef {
  kind: ItemKind
  id: string
}

/** What a custom field may be edited as. */
export type FieldKind = 'text' | 'hidden' | 'boolean'

/** A custom field as a view shows it: a hidden field's value is never here (`revealField` gives it, one at a time). */
export interface FieldView {
  /** Its place in the item's own list of fields: what `revealField` and `FieldInput.origin` name. */
  index: number
  name: string
  /** `linked` (a field that follows another item) and `other` (a later version's kind) are shown and kept, never edited. */
  kind: FieldKind | 'linked' | 'other'
  /** A text field's text, or `true` or `false` for a checkbox; never for a hidden field. */
  value?: string
  hasValue: boolean
  /** The id of the administrator's definition this field was made from. */
  adminField?: string
  editable: boolean
}

/** A field as it is saved. A field the list leaves out is removed; a nameless row is dropped; an entry that can't be edited stays. */
export interface FieldInput {
  /** The `FieldView.index` this row edits, so the entry's other members are kept; absent for a new field. */
  origin?: number
  name: string
  kind: FieldKind
  /** Text, or `true` or `false` for a checkbox. */
  value?: string
  /** A hidden field that was not revealed: its value stays as it is. */
  keepValue?: true
  adminField?: string
}

/** A field the administrator defines for kinds of item (`GET /kem/v1/custom-fields`). */
export interface AdminFieldDef {
  id: string
  name: string
  type: 'text' | 'hidden' | 'checkbox'
  /** The item kinds it applies to, or `all`. */
  kinds: string[] | 'all'
}

export interface CustomFieldDefs {
  fields: AdminFieldDef[]
  /** The person may add fields of their own (true when there is no Kemlock Server to say otherwise). */
  allowOwn: boolean
}

/** An item that links to this one, or that this one links to. */
export interface LinkedItemView {
  ref: ItemRef
  name: string
  /** A line under the name, as a list shows it. */
  detail?: string
  /** Only one end names the other (the other item can't be written, or an older version made the link). */
  halfMade?: boolean
  /** The shared space it is in, as for a note. */
  space?: Record<string, unknown>
}

/** What every item's view carries of the format's additions. */
export interface ItemExtras {
  fields: FieldView[]
  /** How many links it has, counted from both ends (a login's linked code counts). */
  links: number
  /** On a saved view: the names of the items whose end of a new link could not be written. */
  linkFailures?: string[]
}

/** What every item's input may carry of them: a missing `fields` or `links` leaves them as they are. */
export interface ItemExtrasInput {
  fields?: FieldInput[]
  links?: ItemRef[]
}

/** How a login's website is matched: the app's `uriMatch` (absent, 0, 1, 2, 3, 4, 5). */
export type MatchRule = 'default' | 'domain' | 'host' | 'startsWith' | 'exact' | 'regex' | 'never'

export interface WebsiteRuleView {
  uri: string
  match: MatchRule
}

/** A file attached to a note. */
export interface AttachmentView {
  id: string
  name: string
  size: number
  type?: string
  sha256?: string
  /** The file is on Kemlock Server (it is only named until the vault has synced it). */
  onServer: boolean
}

/** What a vault may do with files: only a vault that syncs with Kemlock Server uploads, downloads and deletes them. */
export type FileSync = 'kemlock' | 'readOnly'

/** A File item's row. */
export interface FileView {
  id: string
  /** The item's name. */
  name: string
  /** The file's own name. */
  fileName?: string
  size?: number
  type?: string
  pinned: boolean
  tags: string[]
  order: number
  changedAt: number
  onServer: boolean
  links: number
  /** The shared space it is in, as for a note. */
  space?: Record<string, unknown>
}

export interface FileFull extends FileView {
  notes: string
}

/** What the browser edits of a File item. `staged` names the file a new item or a replacement holds (`stageItemFile` first). */
export interface FileInput {
  name: string
  notes?: string
  pinned?: boolean
  tags?: string[]
  links?: ItemRef[]
  staged?: { handle: string; name: string; type?: string }
}

/** A file the core opened for reading, a piece at a time with `readOpened`. */
export interface Opened {
  handle: string
  size: number
  name: string
  type?: string
}

/** One staged file to attach to a note. */
export interface StagedAttachment {
  handle: string
  name: string
  type?: string
}

/** What the browser edits of a code's account (its secret never changes). A missing member stays as it is. */
export interface CodeInput extends ItemExtrasInput {
  name?: string
  websites?: string[]
  note?: string
  pinned?: boolean
}

/** What the browser edits of a service's backup codes (the codes themselves have their own calls). */
export interface BackupCodesInput extends ItemExtrasInput {
  name?: string
  websites?: string[]
  note?: string
}

/* ----------------------------------------------------------------------------------------------- */
/* Notes, cards and identities (docs/plans/add-items.md)                                             */
/* ----------------------------------------------------------------------------------------------- */

/** A note's row: its title, never its text. */
export interface NoteView extends ItemExtras {
  id: string
  title: string
  tags: string[]
  order: number
  pinned: boolean
  /** How many files are attached. */
  files: number
  changedAt: number
  /** A note Kemlock made to keep a security key's PIV management key. */
  keyNote?: boolean
  /** The shared space it is in, as the core describes it (docs/plans/add-spaces.md); absent for the vault's own. */
  space?: Record<string, unknown>
}

/** A note whole: its text, and the names of its files. */
export interface NoteFull extends NoteView {
  text: string
  attachments: AttachmentView[]
}

/** What the browser edits of a note. A missing `pinned` or `tags` leaves them as they are. */
export interface NoteInput extends ItemExtrasInput {
  title: string
  text: string
  pinned?: boolean
  tags?: string[]
}

/** A card's row: its last four digits, never its number, security code or PIN. */
export interface CardView extends ItemExtras {
  id: string
  name: string
  cardholder?: string
  brand?: string
  lastFour?: string
  expMonth?: number
  expYear?: number
  validFromMonth?: number
  validFromYear?: number
  /** Its expiry month is over. */
  expired: boolean
  hasNumber: boolean
  hasCode: boolean
  hasPin: boolean
  note?: string
  tags: string[]
  order: number
  pinned: boolean
  changedAt: number
  /** The shared space it is in, as for a note. */
  space?: Record<string, unknown>
}

/** A card whole. */
export interface CardFull extends CardView {
  number: string
  code: string
  pin: string
}

/** What the browser edits of a card; a field left out is cleared, except `tags` and `pinned`, which stay. */
export interface CardInput extends ItemExtrasInput {
  name: string
  cardholder?: string
  /** Digits, which may be written with spaces and dashes. */
  number?: string
  brand?: string
  expMonth?: number
  /** Four digits, or two (29 is 2029). */
  expYear?: number
  code?: string
  pin?: string
  validFromMonth?: number
  validFromYear?: number
  note?: string
  tags?: string[]
  pinned?: boolean
  /** A card saved from "Save this card to Kemlock?" (a new card only). */
  fromAutofill?: boolean
}

export interface IdentityAddress {
  lines: string[]
  city?: string
  region?: string
  postalCode?: string
  /** An ISO 3166-1 alpha-2 code when picked from the list, else as typed. */
  country?: string
}

/** A document of an identity, without its number. */
export interface IdentityDocumentView {
  id: string
  /** passport, driversLicence, idCard, taxNumber or other (a later version's type is kept as it is). */
  type: string
  issuingCountry?: string
  issuingAuthority?: string
  /** yyyy-mm-dd */
  issuedOn?: string
  expiresOn?: string
  expired: boolean
  hasNumber: boolean
}

export interface IdentityDocumentFull extends IdentityDocumentView {
  number: string
}

/** An identity's row: its details and address, and its documents with no number. */
export interface IdentityView extends ItemExtras {
  id: string
  name: string
  title?: string
  givenName?: string
  middleName?: string
  familyName?: string
  /** The given, middle and family names in order. */
  fullName?: string
  company?: string
  email?: string
  phone?: string
  username?: string
  /** yyyy-mm-dd */
  birthDate?: string
  address?: IdentityAddress
  documents: IdentityDocumentView[]
  note?: string
  tags: string[]
  order: number
  pinned: boolean
  changedAt: number
  /** The shared space it is in, as for a note. */
  space?: Record<string, unknown>
}

/** An identity whole: each document with its number. */
export interface IdentityFull extends Omit<IdentityView, 'documents'> {
  documents: IdentityDocumentFull[]
}

/** A document as it is saved: one with an `id` the identity holds is changed, any other is added. */
export interface IdentityDocumentInput {
  id?: string
  type: string
  number: string
  issuingCountry?: string
  issuingAuthority?: string
  issuedOn?: string
  expiresOn?: string
}

/**
 * What the browser edits of an identity; a detail left out is cleared, except `tags` and `pinned`, which stay. Without
 * `documents` they stay as they are; with it, a document the list leaves out is removed.
 */
export interface IdentityInput extends ItemExtrasInput {
  name: string
  title?: string
  givenName?: string
  middleName?: string
  familyName?: string
  company?: string
  email?: string
  phone?: string
  username?: string
  birthDate?: string
  address?: Omit<IdentityAddress, 'lines'> & { lines?: string[] }
  documents?: IdentityDocumentInput[]
  note?: string
  tags?: string[]
  pinned?: boolean
}

/** The hidden things a page shows or copies on a click, one at a time. */
export type ItemSecret = 'cardNumber' | 'cardCode' | 'cardPin' | 'documentNumber'

/** Card fields a form asks for. */
export type CardPart =
  'cardName' | 'cardNumber' | 'cardExp' | 'cardExpMonth' | 'cardExpYear' | 'cardCsc' | 'cardType'

/** Identity and address fields a form asks for. */
export type IdentityPart =
  | 'title'
  | 'fullName'
  | 'givenName'
  | 'middleName'
  | 'familyName'
  | 'company'
  | 'email'
  | 'phone'
  | 'birthDate'
  | 'birthDay'
  | 'birthMonth'
  | 'birthYear'
  | 'street'
  | 'line1'
  | 'line2'
  | 'line3'
  | 'city'
  | 'region'
  | 'postalCode'
  | 'country'
  | 'countryName'

export type FormPart = CardPart | IdentityPart

/* ----------------------------------------------------------------------------------------------- */
/* The vault's state, and sync                                                                       */
/* ----------------------------------------------------------------------------------------------- */

export type SyncPlace = 'kemlock' | 'webdav' | 'vaultwarden'

/** The app's sync problems (sync_problem_* in _locales): sync stops and says why. */
export type SyncProblem =
  | 'signedOut'
  | 'modeChanged'
  | 'homeMissing'
  | 'removals'
  | 'unsupported'
  | 'older'
  | 'auth'
  | 'network'
  | 'server'
  | 'kemlockAddress'
  | 'kemlockOlder'
  | 'sessionEnded'
  | 'sessionReused'
  | 'spaceCantBeChecked'
  | 'spaceKeysPending'
  | (string & {})

/** An entry the removal guard would remove: its name, and its kind (code, backupCodes, login, note, card, identity, key, passkey, contact). */
export interface RemovalItem {
  name: string
  kind: string
}

export interface SyncStatus {
  place: SyncPlace
  /** The server or folder address. */
  server: string
  account?: string
  deviceName?: string
  lastSync?: number
  running: boolean
  problem?: SyncProblem
  /** A removal guard asked first (spec): how many would go. */
  pendingRemovals?: number
  /** With `pendingRemovals`: how many entries the scope holds ("would remove 6 of 22 items"). */
  scopeSize?: number
  /** With `pendingRemovals`: what would go, by name and kind, when the run can tell ("Review"). */
  pendingRemovalItems?: RemovalItem[]
  /** Vaultwarden: logins travel through WebDAV only (spec), so the popup says so. */
  loginsNotSynced?: boolean
  // Added by popup
  storage?: 'sealed' | 'plain'
  /** The home's name. */
  home?: string
  /** Added by item format: whether files can go up and down (only with Kemlock Server). */
  fileSync?: FileSync
}

export interface VaultState {
  exists: boolean
  unlocked: boolean
  /** Wrong passwords since the vault last opened, and the last one's time (spec). */
  wrongPasswords: number
  lastWrongAt?: number
  sync?: SyncStatus
  /** Added by item format: `kemlock` only when the vault syncs with Kemlock Server, which then holds the files. */
  fileSync: FileSync
}

export interface UnlockResult {
  ok: boolean
  wrongPasswords: number
}

/** Sign-in as steps, the engine's own (KmSignIn, VwSignInStep), as data. */
export type SignInStep =
  | { step: 'done'; status: SyncStatus }
  /** A second step: the methods the browser can answer, the others named. */
  | {
      step: 'second'
      methods: SecondMethod[]
      unsupported: string[]
      /** Added by core: Vaultwarden's obscured address for the email code ("m***@example.com"). */
      emailHint?: string
    }
  /** Kemlock Server: approve from another device, which shows these five words. */
  | { step: 'approval'; phrase: string[]; requestId: string }
  /** Kemlock Server: the account key opens with the master password (no trusted device). */
  | { step: 'masterPassword' }
  /** Vaultwarden: the vault's Kemlock homes to join, with their storage and counts. */
  | { step: 'homes'; homes: HomeView[] }
  /** A WebDAV folder or a sealed home asks for the sync passphrase. */
  | { step: 'passphrase' }
  /** The first sync is shown before it runs (spec). */
  | { step: 'firstSync'; adds: number; removes: number }
  /**
   * Kemlock Server: the vault syncs with Vaultwarden on this server, or with WebDAV, so it moves into Kemlock Server before the old
   * store is let go (docs/plans/add-browser-account.md). The sign-in is held, sealed, until the person says; the move runs through
   * the account's `moveStart`.
   */
  | {
      step: 'move'
      source: 'vaultwarden' | 'webdav'
      /** What would move, by kind. */
      counts: Record<string, number>
      /** Attached files the vault's notes name: a browser keeps none, so the move waits for the phone. */
      files: number
      /** An earlier move stopped part way and goes on. */
      resumed: boolean
    }
  | { step: 'error'; problem: SyncProblem; message?: string }

export type SecondMethod =
  | 'authenticator'
  | 'email'
  | 'yubikey'
  | 'securityKey'
  | 'duo'
  | 'apiKey'
  /** Kemlock Server: the account's recovery code, which every account takes as its second step. */
  | 'recoveryCode'

export interface HomeView {
  id: string
  name: string
  storage: 'sealed' | 'plain'
  items: number
}

export interface KemlockSignIn {
  server: string
  email: string
  password: string
}

export interface WebdavSignIn {
  folder: string
  username: string
  password: string
}

export interface VaultwardenSignIn {
  server: string
  email: string
  password: string
}

export interface Settings {
  /** Minutes: 1, 5, 15 or 60. */
  autoLockMinutes: 1 | 5 | 15 | 60
  lockOnSleep: boolean
  /** The code is offered on the page after the password (spec). */
  codeAfterPassword: boolean
  /** Buttons in fields on every site (the optional all-sites permission). */
  buttonsOnPages: boolean
  /** Look passwords up in known breaches (k-anonymity, off by default). */
  breachedPasswords: boolean
  /** Save and update prompts. */
  offerToSave: boolean
  clipboardSeconds: number
  /** Added by passkeys: Kemlock answers the browser's passkey requests (absent means on). */
  passkeys?: boolean
}

// Added by unlock (begin): unlocking the vault with a passkey, Windows Hello, Touch ID or a security key (PRF).
/** One credential that opens the vault beside its password. Nothing secret: the slot's wrap stays in the core. */
export interface PasskeySlotView {
  /** The slot's own id, for renaming and removing it. */
  id: string
  /** The credential's id, base64url, to ask the authenticator for. */
  credentialId: string
  name: string
  addedAt: number
  lastUsedAt?: number
  /** `platform` (Windows Hello, Touch ID) or `cross-platform` (a security key), as the browser said. */
  attachment?: string
  transports: string[]
}

/** What the lock screen and the unlock page need: the credentials, and why the password is needed instead, if it is. */
export interface PasskeyUnlockInfo {
  credentials: PasskeySlotView[]
  /** The PRF input of every credential, base64url (with a credential set up). */
  salt?: string
  /** The relying party's id the credentials were made for; absent for the browser's own default. */
  rpId?: string
  /** The password is needed now: after failed passkey tries, or too long without it. */
  passwordRequired?: 'tries' | 'days'
}

/** What a page needs to make a credential, base64url throughout. */
export interface PasskeyEnrolOptions {
  salt: string
  rpId?: string
  /** The credentials there are, which the authenticator is told not to make again. */
  exclude: string[]
}

/** A credential just made and the PRF output it gave for the vault's salt, to be kept as a slot. */
export interface NewPasskey {
  /** The vault's password, which the core checks as an unlock does before it keeps the credential. */
  password: string
  name: string
  credentialId: string
  prfOutput: string
  rpId?: string
  attachment?: string
  transports?: string[]
}

/** What the authenticator answered at the lock screen. */
export interface PasskeyUnlockAnswer {
  credentialId: string
  prfOutput: string
}

export interface PasskeyUnlockResult {
  ok: boolean
  wrongPasswords: number
  /** Why it didn't open: the answer opens nothing (`wrong`), or opens a key the vault no longer has (`stale`). */
  reason?: 'wrong' | 'stale'
}
// Added by unlock (end)

/* ----------------------------------------------------------------------------------------------- */
/* The core                                                                                          */
/* ----------------------------------------------------------------------------------------------- */

/**
 * The Dart core, as the background sees it (src/background/core/). Implemented by core/ through
 * dart2wasm; `FakeCore` (src/background/core/fake.ts) stands in for it in tests.
 */
export interface CoreApi extends ToolsCoreApi {
  // The vault (browser-vault spec)
  state(): Promise<VaultState>
  createVault(password: string): Promise<void>
  unlock(password: string): Promise<UnlockResult>
  lock(): Promise<void>
  removeVault(): Promise<void>
  /** The open vault's keys, sealed for storage.session, so a restarted worker opens it again. */
  exportSession(): Promise<string>
  /** False when the blob doesn't open (another browser session): the vault stays locked. */
  restoreSession(blob: string): Promise<boolean>

  // What it holds
  codes(): Promise<CodeView[]>
  liveCodes(ids: string[], now: number): Promise<LiveCode[]>
  /** HOTP: the next code, counting it. */
  nextHotp(id: string): Promise<LiveCode>
  logins(): Promise<LoginView[]>
  revealLogin(id: string): Promise<LoginSecret>
  saveLogin(id: string | null, input: LoginInput): Promise<LoginView>
  deleteLogin(id: string): Promise<void>
  /** "Don't warn for this login". */
  ignoreHealth(id: string, ignored: boolean): Promise<void>
  backupCodes(): Promise<BackupCodeView[]>
  /** Marks the next backup code used and returns it. */
  useBackupCode(serviceId: string): Promise<string>
  /** An otpauth:// link (pasted, or read from a QR code), with the page's site as its website. */
  addCode(otpauth: string, website?: string, linkTo?: string): Promise<CodeView>
  /** Decodes a QR code from an image (a PNG data URL, e.g. captureVisibleTab), or null. */
  readQr(imageDataUrl: string): Promise<string | null>
  /** What a link would add, saving nothing: its name, and the saved code that has its secret already. */
  previewCode(
    otpauth: string,
  ): Promise<{ issuer: string; account: string; existing: CodeView | null }>
  linkCode(codeId: string, loginId: string | null): Promise<void>

  // "Always suggest here": picks sealed in the vault (never synced, deleted with it), so a locked core has none and a page that
  // writes to storage.local changes nothing. The ids are a login's or a code's.
  /** Remembers that an item was picked on a host. */
  rememberPick(host: string, itemId: string): Promise<void>
  /** The items picked on a host. */
  picks(host: string): Promise<string[]>
  /** The hosts an item was picked on. */
  pickedHosts(itemId: string): Promise<string[]>
  forgetPick(host: string, itemId: string): Promise<void>
  /** Recently generated passwords (30 days, never synced), newest first. */
  recentPasswords?(): Promise<GeneratedPassword[]>
  addRecentPassword?(password: GeneratedPassword): Promise<void>

  // Notes, cards and identities (core/lib/src/vault_items.dart). Lists carry no secret; a reveal is the whole item.
  notes(): Promise<NoteView[]>
  revealNote(id: string): Promise<NoteFull>
  saveNote(id: string | null, input: NoteInput): Promise<NoteView>
  deleteNote(id: string): Promise<void>
  cards(): Promise<CardView[]>
  revealCard(id: string): Promise<CardFull>
  saveCard(id: string | null, input: CardInput): Promise<CardView>
  deleteCard(id: string): Promise<void>
  identities(): Promise<IdentityView[]>
  revealIdentity(id: string): Promise<IdentityFull>
  saveIdentity(id: string | null, input: IdentityInput): Promise<IdentityView>
  deleteIdentity(id: string): Promise<void>

  // Added by item format: custom fields, links and files. A hidden field's value and a file's key are one call each and never in a
  // list; a file's key never leaves the core.
  /** The administrator's field definitions on this server (kept for the session; `refresh` asks again). None, and `allowOwn`, off Kemlock Server. */
  customFieldDefs(refresh?: boolean): Promise<CustomFieldDefs>
  /** One field's value, a hidden field's too. */
  revealField(ref: ItemRef, index: number): Promise<string>
  /** Every field's value, for an edit page. */
  revealFields(ref: ItemRef): Promise<{ index: number; value: string }[]>
  linkedItems(ref: ItemRef): Promise<LinkedItemView[]>
  /** What may be linked: at most 50 items that can be read and written, are not in the trash and are not the item itself. */
  linkCandidates(ref: ItemRef | null, query: string): Promise<LinkedItemView[]>
  /** Makes the item's links these, writing both ends. */
  setLinks(ref: ItemRef, refs: ItemRef[]): Promise<{ linkFailures: string[] }>
  /** Changes a code's account (name, websites, note, fields, links), never its secret. */
  saveCode(id: string, input: CodeInput): Promise<CodeView>
  saveBackupCodes(serviceId: string, input: BackupCodesInput): Promise<BackupCodeView>
  files(): Promise<FileView[]>
  revealFile(id: string): Promise<FileFull>
  deleteFile(id: string): Promise<void>
  /** Fails `unavailable` off Kemlock Server when `staged` is given. */
  saveFile(id: string | null, input: FileInput): Promise<FileView>
  /** Adds a piece of a file (base64, at most 1 MiB) to the staged file under `handle`, or, with null, to a new one. */
  stageItemFile(data: string, handle: string | null): Promise<{ handle: string; length: number }>
  releaseStaged(handle: string): Promise<void>
  /** Attaches staged files to a note (at most 100 in all, 50 MiB each). */
  addAttachments(noteId: string, files: StagedAttachment[]): Promise<NoteFull>
  removeAttachment(noteId: string, attachmentId: string): Promise<NoteFull>
  /** Fetches and opens a File item's file, or a note's attachment, and holds it for `readOpened`. */
  openItemFile(ref: ItemRef, attachmentId?: string): Promise<Opened>
  /** A piece of the opened file, base64, from `index` times 1 MiB; empty past its end. */
  readOpened(handle: string, index: number): Promise<string>
  closeOpened(handle: string): Promise<void>
  // End of added by item format

  // Matching, generating, health
  match(address: string): Promise<SiteMatch>
  generate(options: GeneratorOptions): Promise<string>
  health(): Promise<HealthReport>

  // Sync (browser-sync spec, and docs/plans/add-kemlock-server-sync.md)
  syncStatus(): Promise<SyncStatus | null>
  signInKemlock(input: KemlockSignIn): Promise<SignInStep>
  signInWebdav(input: WebdavSignIn): Promise<SignInStep>
  signInVaultwarden(input: VaultwardenSignIn): Promise<SignInStep>
  /** Answers the step the last sign-in returned (a code, a passphrase, a home id, `approve` to poll). */
  answerStep(answer: StepAnswer): Promise<SignInStep>
  syncNow(): Promise<SyncStatus>
  /** The removal guard: go on with the run that would remove many. */
  confirmRemovals(): Promise<SyncStatus>
  /** The removal guard's other answer: run once more with no deletion either way (the app's "Keep"). */
  keepRemovals(): Promise<SyncStatus>
  signOut(): Promise<void>
  // Added by setup
  /** Checks that the address answers as a supported server, before any password is asked. */
  checkServer(place: 'kemlock' | 'vaultwarden', server: string): Promise<ServerCheck>
  /** The connector page for the last sign-in's security-key step, or null. */
  securityKeyChallenge(): Promise<SecurityKeyChallenge | null>
  // End of added by setup

  settings(): Promise<Settings>
  saveSettings(settings: Partial<Settings>): Promise<Settings>

  // Added by core: Kemlock Server's other ways in (design D4). Both answer as the sign-ins above do; the hooks they use (the
  // browser's identity flow, the passkey page) are given to the core when it loads (src/background/core/wasm.ts).
  /** SSO through `identity.launchWebAuthFlow`, on the provider the server names. */
  signInKemlockSso?(input: { server: string; email?: string }): Promise<SignInStep>
  /** A passkey or security key with its PRF, asked in a page of the extension. */
  signInKemlockPasskey?(input: { server: string; email?: string }): Promise<SignInStep>

  // Added by unlock (begin): the passkeys that open the vault beside its password (docs/plans/add-passkey-unlock.md).
  /** The credentials set up and why the password is needed instead; answers while the vault is locked. */
  passkeyUnlockInfo(): Promise<PasskeyUnlockInfo>
  /** The PRF input and user handle for a new credential (made now the first time), and the credentials not to make again. */
  passkeyUnlockPrepare(): Promise<PasskeyEnrolOptions>
  /** Keeps a credential and its PRF output as a slot wrapping the vault's key. */
  addPasskeyUnlock(input: NewPasskey): Promise<PasskeyUnlockInfo>
  renamePasskeyUnlock(id: string, name: string): Promise<PasskeyUnlockInfo>
  removePasskeyUnlock(id: string): Promise<PasskeyUnlockInfo>
  /** Opens the vault with a credential's answer; a failed try is counted, and the password is needed after too many. */
  unlockWithPasskey(answer: PasskeyUnlockAnswer): Promise<PasskeyUnlockResult>
  // Added by unlock (end)
  // Added by sends (begin): Kemlock Server's Sends, and opening one from its link (src/shared/sends.ts). Each answers a `SendResult`,
  // so the server's own words reach the pages; what isn't a Send's failure (a locked vault) throws as everywhere.
  sendsList(): Promise<SendResult<SendsListing>>
  sendsGet(id: string): Promise<SendResult<SendDetail>>
  /** The Send's link, rebuilt from its sealed key. For the clipboard in the background, never for a page. */
  sendsLink(id: string): Promise<SendResult<string>>
  /**
   * Adds a piece of a file (base64) for a new Send: to the file under `handle`, or, with null, to a new one. Answers the handle,
   * which the tab that started the file alone has, and how many bytes are staged.
   */
  sendsStageFile(
    data: string,
    handle: string | null,
  ): Promise<SendResult<{ handle: string; length: number }>>
  /** Makes a Send (a file's bytes staged first) and gives its id and link; the link is for the clipboard. */
  sendsMake(input: NewSendInput): Promise<SendResult<{ id: string; link: string }>>
  sendsUpdate(id: string, patch: SendPatch): Promise<SendResult<null>>
  sendsDelete(id: string): Promise<SendResult<null>>
  /** Opens the Send a link names, with its password if it has one; needs no account. One Send is held at a time. */
  sendsOpen(link: string, password?: string): Promise<SendResult<ReceivedSendView>>
  /** Fetches and opens the received file Send's file, which spends an open, and holds it. */
  sendsDownload(handle: string): Promise<SendResult<{ size: number }>>
  /** A piece of the downloaded file, base64, from `index` times the chunk size; empty past its end. */
  sendsReadFile(handle: string, index: number): Promise<string>
  /** The received text Send's text, for the clipboard. */
  sendsReceivedText(handle: string): Promise<string>
  /** Lets go of the received Send or the staged file under `handle`, and its file. */
  sendsClose(handle: string): Promise<void>
  // Added by sends (end)
  // Added by passkeys (docs/plans/add-passkeys.md): the vault's passkeys, and the extension as a passkey provider. The options and
  // answers are WebAuthn's JSON forms (src/shared/passkeys.ts); the core checks the relying party against the origin itself.
  passkeys(): Promise<PasskeyView[]>
  deletePasskey(id: string): Promise<void>
  /** The relying party id a request from `origin` may use (its own host when `rpId` is none); fails `passkeySecurity` when none. Needs no open vault. */
  checkPasskeyRp(origin: string, rpId?: string): Promise<string>
  /** The passkeys of exactly `rpId`, limited to the credentials in `allowed` (base64url) when it names any. */
  findPasskeys(rpId: string, allowed: string[]): Promise<PasskeyView[]>
  /** Makes a passkey, keeps it in the vault, and answers what the page is told. */
  createPasskey(
    options: PasskeyCreationOptions,
    origin: string,
    topOrigin?: string,
  ): Promise<CreatedPasskey>
  /** Signs the challenge (base64url) with a passkey for the origin. */
  signPasskey(
    id: string,
    challenge: string,
    origin: string,
    topOrigin?: string,
  ): Promise<PasskeyCredentialJson>
  // Added by transfer (begin): import and export (docs/plans/add-transfer.md). A file's items stay in the core until they are merged.
  /** Opens a file (its bytes as base64) as far as telling what it is, without its password. */
  transferOpen(data: string): Promise<TransferOpened>
  /** The same for images of QR codes (data URLs): each is read for its code. */
  transferOpenQr(images: string[]): Promise<TransferOpened>
  /** Reads the opened file, with its password when it needs one, and says what it holds. */
  transferPreview(token: string, password?: string): Promise<TransferPreview>
  /**
   * The same for an encrypted Kemlock export opened with pieces of its vault's Recovery Kit (two of the three) in place of the export
   * password. The core puts the pieces together, opens the file's kit wrap with the key they rebuild, and wipes the key at once.
   */
  transferPreviewKit(token: string, pieces: string[]): Promise<TransferPreview>
  /** What the file would add to the vault under the options, and what it holds already. Saves nothing. */
  transferPlan(token: string, options: TransferOptions): Promise<TransferPlan>
  /** Merges the file into the vault as the app's import does, counted as a change made here so that sync carries it. */
  transferApply(token: string, options: TransferOptions): Promise<TransferResult>
  /** Drops an opened file. */
  transferCancel(token: string): Promise<void>
  /** What an export of the open vault could hold. */
  transferExportInfo(): Promise<ExportInfo>
  /** An export file, after the vault's own password. */
  transferExport(request: ExportRequest): Promise<ExportedFile>
  /** The vault's codes as QR codes, after the vault's own password. */
  transferExportQr(request: QrExportRequest): Promise<QrExport>
  // End of added by transfer
  // Added by account: the account's own calls (src/shared/account.ts lists the ops).
  account?(request: AccountRequest): Promise<AccountResult>
}

export type StepAnswer =
  | { step: 'second'; method: SecondMethod; code: string; remember: boolean }
  /** A security key's assertion, from the setup tab on the server's own address. */
  | { step: 'securityKey'; assertion: string; remember: boolean }
  | { step: 'approval'; requestId: string }
  | { step: 'masterPassword'; password: string }
  | { step: 'homes'; homeId: string }
  | { step: 'passphrase'; passphrase: string }
  | { step: 'firstSync'; go: boolean }
  /** Kemlock Server: opens an account that signed in without opening, with two pieces of its Recovery Kit. */
  | { step: 'recoveryKit'; pieces: string[] }

/* ----------------------------------------------------------------------------------------------- */
/* What the extension's pages and content scripts may ask the background                             */
/* ----------------------------------------------------------------------------------------------- */

/** The popup's view of the tab in front. */
export interface TabView {
  tabId: number
  address: string
  match: SiteMatch
}

export interface PopupView {
  state: VaultState
  tab?: TabView
}

// Added by setup (begin): what the setup tab needs beyond the sign-in steps.
/** What `checkServer` found: the address answers as the place's server, or the app's problem. */
export type ServerCheck = { ok: true } | { ok: false; problem: SyncProblem }

/**
 * The security key's connector on the server's own address (design decision 13). Setup opens
 * `domain + path + ?data=<data>&parent=<setup page>&v=1&locale=<language>` in a tab, relays the
 * page's `webAuthnResult` and answers `{ step: 'securityKey', assertion }`. Vaultwarden: the web
 * vault's `/webauthn-fallback-connector.html`; Kemlock Server: `/kem/v1/webauthn`.
 */
export interface SecurityKeyChallenge {
  /** The server's own address (Vaultwarden's DOMAIN, the Kemlock server's address), no trailing slash. */
  domain: string
  /** The connector page's path on it. */
  path: string
  /** The challenge, encoded for the connector's `data` parameter. */
  data: string
}
// Added by setup (end)

/**
 * The extension's own pages' requests. Each is `{ kind, ...args }` on the wire
 * (`PageRequest`), and the answer is the method's result, or `{ error }`.
 */
export interface PageApi extends ToolsPageApi {
  /** The tab in front, or the one named (the e2e tests open the popup as a tab with ?tabId=). */
  popup(args?: { tabId?: number }): Promise<PopupView>
  /**
   * Whether the vault is open, for a page that holds what it decrypted (a tab) and asks again when it comes to the front, as it may
   * have missed the message that the vault locked (`useVaultLock`). Reads the state and starts nobody's idle time over.
   */
  pageState(): Promise<VaultState>
  createVault(args: { password: string }): Promise<void>
  unlock(args: { password: string }): Promise<UnlockResult>
  lock(): Promise<void>
  removeVault(): Promise<void>

  codes(): Promise<CodeView[]>
  liveCodes(args: { ids: string[] }): Promise<LiveCode[]>
  nextHotp(args: { id: string }): Promise<LiveCode>
  logins(): Promise<LoginView[]>
  saveLogin(args: { id: string | null; input: LoginInput }): Promise<LoginView>
  deleteLogin(args: { id: string }): Promise<void>
  ignoreHealth(args: { id: string; ignored: boolean }): Promise<void>
  /** Shows the password on the login's page, after the vault's password again when it was set so. */
  showPassword(args: { id: string }): Promise<string>
  backupCodes(): Promise<BackupCodeView[]>
  health(): Promise<HealthReport>
  generate(args: { options: GeneratorOptions }): Promise<string>
  recentPasswords(): Promise<GeneratedPassword[]>

  /** Copies through the background (decision 14), cleared later only if unchanged. */
  copy(args: {
    what:
      | 'username'
      | 'password'
      | 'code'
      | 'backupCode'
      | 'generated'
      // Added by items: a card's or an identity's field, or a note's text
      | 'cardNumber'
      | 'cardCode'
      | 'cardPin'
      | 'cardholder'
      | 'email'
      | 'phone'
      | 'documentNumber'
      | 'noteText'
      // Added by item format: one custom field of the item `ref`, by its index (`id` is the ref's id)
      | 'field'
    id: string
    value?: string
    /** With `documentNumber`: the document of the identity. */
    documentId?: string
    /** With `field`: the item, and the field's `FieldView.index`. */
    ref?: ItemRef
    index?: number
  }): Promise<void>
  /** Fills the tab in front, its frame that holds the field, after the site check (decision 4). */
  fill(args: {
    tabId: number
    frameId?: number
    fieldId?: string
    loginId?: string
    codeId?: string
    // Added by background: a suggested password fills the field and its confirmation, and is
    // kept under Recently generated; `remember` is "Always suggest here" on an unknown site.
    newPassword?: string
    remember?: boolean
    // From the menu only: the person confirmed the address on its Confirm screen (the picker or the
    // look-alike path), so the item may fill a site it doesn't match
    picked?: boolean
    // Added by items: fills the card's or the identity's fields the frame reported (docs/plans/add-items.md, decision 1)
    cardId?: string
    identityId?: string
  }): Promise<void>

  addCodeFromLink(args: { otpauth: string; website?: string; linkTo?: string }): Promise<CodeView>
  /** Reads a QR code shown in the tab in front. */
  addCodeFromTab(args: { tabId: number; linkTo?: string }): Promise<CodeView | null>
  /** Reads a QR code shown in the tab in front and says what it would add, adding nothing; null when it holds no code. */
  readCodeFromTab(args: { tabId: number }): Promise<CodePreview | null>
  linkCode(args: { codeId: string; loginId: string | null }): Promise<void>
  // Added by popup
  /** The code each id will show once its current one ends (the popup asks in a code's last 5 seconds). */
  nextCodes(args: { ids: string[] }): Promise<LiveCode[]>
  /** Marks the next unused backup code used; `copy({what:'backupCode'})` copies that same code. */
  useBackupCode(args: { serviceId: string }): Promise<void>
  /** The sites a login was picked for with "Always suggest here" (sealed in the vault), and forgetting one. */
  rememberedSites(args: { loginId: string }): Promise<string[]>
  forgetSite(args: { loginId: string; host: string }): Promise<void>
  // End of added by popup

  // Notes, cards and identities. The lists carry no secret; `reveal*` is for the edit pages, and a hidden field is shown or
  // copied one at a time (`showSecret`, `copy`).
  notes(): Promise<NoteView[]>
  revealNote(args: { id: string }): Promise<NoteFull>
  saveNote(args: { id: string | null; input: NoteInput }): Promise<NoteView>
  deleteNote(args: { id: string }): Promise<void>
  cards(): Promise<CardView[]>
  revealCard(args: { id: string }): Promise<CardFull>
  saveCard(args: { id: string | null; input: CardInput }): Promise<CardView>
  deleteCard(args: { id: string }): Promise<void>
  identities(): Promise<IdentityView[]>
  revealIdentity(args: { id: string }): Promise<IdentityFull>
  saveIdentity(args: { id: string | null; input: IdentityInput }): Promise<IdentityView>
  deleteIdentity(args: { id: string }): Promise<void>
  /** A card's number, security code or PIN, or a document's number, to show on its page. */
  showSecret(args: { what: ItemSecret; id: string; documentId?: string }): Promise<string>

  // Added by item format (begin): custom fields, links and files. Staging, attaching and saving a file go from the files tab only.
  customFieldDefs(args?: { refresh?: boolean }): Promise<CustomFieldDefs>
  /** One field's value, to show or copy on a click. */
  revealField(args: { ref: ItemRef; index: number }): Promise<string>
  /** Every field's value, for an edit page. */
  revealFields(args: { ref: ItemRef }): Promise<{ index: number; value: string }[]>
  linkedItems(args: { ref: ItemRef }): Promise<LinkedItemView[]>
  linkCandidates(args: { ref: ItemRef | null; query: string }): Promise<LinkedItemView[]>
  setLinks(args: { ref: ItemRef; refs: ItemRef[] }): Promise<{ linkFailures: string[] }>
  saveCode(args: { id: string; input: CodeInput }): Promise<CodeView>
  saveBackupCodes(args: { serviceId: string; input: BackupCodesInput }): Promise<BackupCodeView>
  files(): Promise<FileView[]>
  revealFile(args: { id: string }): Promise<FileFull>
  deleteFile(args: { id: string }): Promise<void>
  /** With `staged`: the files tab only, and `unavailable` off Kemlock Server. */
  saveFile(args: { id: string | null; input: FileInput }): Promise<FileView>
  /** A piece of a file (base64, at most 1 MiB): the first has no handle and is answered one, the others name it. Files tab only. */
  stageItemFile(args: { data: string; handle?: string }): Promise<{ handle: string; length: number }>
  releaseStaged(args: { handle: string }): Promise<void>
  /** Files tab only. */
  addAttachments(args: { noteId: string; files: StagedAttachment[] }): Promise<NoteFull>
  removeAttachment(args: { noteId: string; attachmentId: string }): Promise<NoteFull>
  /** Opens a File item's file or a note's attachment, to be read with `readOpened`. Popup and files tab. */
  openItemFile(args: { ref: ItemRef; attachmentId?: string }): Promise<Opened>
  readOpened(args: { handle: string; index: number }): Promise<string>
  closeOpened(args: { handle: string }): Promise<void>
  // Added by item format (end)

  syncStatus(): Promise<SyncStatus | null>
  signInKemlock(args: KemlockSignIn): Promise<SignInStep>
  signInWebdav(args: WebdavSignIn): Promise<SignInStep>
  signInVaultwarden(args: VaultwardenSignIn): Promise<SignInStep>
  answerStep(args: { answer: StepAnswer }): Promise<SignInStep>
  syncNow(): Promise<SyncStatus>
  confirmRemovals(): Promise<SyncStatus>
  /** The removal guard's "Keep": runs once with no deletion either way. */
  keepRemovals(): Promise<SyncStatus>
  signOut(): Promise<void>
  // Added by unlock (begin): the credentials that open the vault. The unlock page is the one that makes and asks them.
  passkeyUnlockInfo(): Promise<PasskeyUnlockInfo>
  passkeyUnlockPrepare(): Promise<PasskeyEnrolOptions>
  addPasskeyUnlock(args: NewPasskey): Promise<PasskeyUnlockInfo>
  renamePasskeyUnlock(args: { id: string; name: string }): Promise<PasskeyUnlockInfo>
  removePasskeyUnlock(args: { id: string }): Promise<PasskeyUnlockInfo>
  unlockWithPasskey(args: PasskeyUnlockAnswer): Promise<PasskeyUnlockResult>
  // End of added by unlock
  // Added by sign-in: Kemlock Server's other ways in (the core's hooks do the browser's part).
  /** SSO on the provider the server names. Answers the steps a sign-in does; `email` only narrows which account the steps name. */
  signInKemlockSso(args: { server: string; email?: string }): Promise<SignInStep>
  /** A passkey or security key (with its PRF, which opens the account). */
  signInKemlockPasskey(args: { server: string; email?: string }): Promise<SignInStep>
  // End of added by sign-in
  // Added by account: the account's own calls, one message with the op inside (src/shared/account.ts).
  account(args: { request: AccountRequest }): Promise<AccountResult>
  // End of added by account

  settings(): Promise<Settings>
  saveSettings(args: { settings: Partial<Settings> }): Promise<Settings>
  /** Asks for the all-sites permission (must run from a user gesture in a page). */
  allSitesGranted(): Promise<boolean>

  /** The in-page menu's list for the frame that opened it. */
  menu(args: { tabId: number; frameId: number; fieldId: string }): Promise<MenuView>
  /** Saving or updating a login the content script saw sent (decision 10). */
  pendingSave(args: { tabId: number }): Promise<PendingSave | null>
  /** `card` or `identity` says which offer is answered (a tab may hold a login, a card and an identity); neither is the login. */
  answerSave(args: {
    tabId: number
    save: boolean
    never?: boolean
    card?: boolean
    identity?: boolean
  }): Promise<void>

  // Added by setup (begin)
  /**
   * Before the master password: the address answers as a Vaultwarden at a supported version, or
   * as a Kemlock Server (its /kem/v1/config). Sends nothing but the check; needs the access step.
   */
  checkServer(args: { place: 'kemlock' | 'vaultwarden'; server: string }): Promise<ServerCheck>
  /**
   * The challenge of the last sign-in's security key step, or null when the server serves no
   * connector page (the other methods and the API key are offered instead).
   */
  securityKeyChallenge(): Promise<SecurityKeyChallenge | null>
  // Added by setup (end)

  // Added by sends (begin): the popup and the Sends tab. Copying a link or a received text goes through the background's clipboard.
  sends(): Promise<SendResult<SendsListing>>
  sendGet(args: { id: string }): Promise<SendResult<SendDetail>>
  sendCopyLink(args: { id: string }): Promise<SendResult<null>>
  /** A piece of a file for a new Send, base64 (at most the chunk size): the first has no handle and is answered one, the others name it. */
  sendStageFile(args: {
    data: string
    handle?: string
  }): Promise<SendResult<{ handle: string; length: number }>>
  /** The link goes to no page: copy it with `sendCopyLink`. */
  sendMake(args: { input: NewSendInput }): Promise<SendResult<{ id: string }>>
  sendUpdate(args: { id: string; patch: SendPatch }): Promise<SendResult<null>>
  sendDelete(args: { id: string }): Promise<SendResult<null>>
  /** From the Sends tab only. */
  sendOpen(args: { link: string; password?: string }): Promise<SendResult<ReceivedSendView>>
  sendDownload(args: { handle: string }): Promise<SendResult<{ size: number }>>
  sendReadFile(args: { handle: string; index: number }): Promise<string>
  sendCopyText(args: { handle: string }): Promise<void>
  sendClose(args: { handle: string }): Promise<void>
  /**
   * From the popup: "Send this note". Reads the note in the background and holds its title and text for the Sends tab, which takes
   * them once with the token this answers (the text is in no address). Needs Sends: the vault syncs with Kemlock Server.
   */
  sendFromNote(args: { id: string }): Promise<SendResult<{ token: string }>>
  /** From the Sends tab: the draft the token names, once; null when there is none (taken, kept too long, or the vault locked). */
  sendTakeDraft(args: { token: string }): Promise<SendDraft | null>
  /** From the Sends tab: the received text Send under `handle` as a new note named after the Send (the background knows its name); answers the note's id. */
  sendSaveAsNote(args: { handle: string }): Promise<{ id: string }>
  // Added by sends (end)
  // Added by passkeys (begin): the popup's list, and the in-page card that asks the person (docs/plans/add-passkeys.md).
  passkeys(): Promise<PasskeyView[]>
  deletePasskey(args: { id: string }): Promise<void>
  /** Whether Kemlock stays out of the passkey requests of a host ("Don't offer here"). */
  passkeyHere(args: { host: string }): Promise<boolean>
  passkeyHereSet(args: { host: string; off: boolean }): Promise<void>
  /**
   * The card of the request a tab's top frame is showing; null when there is none (it ended or was answered). `token` is the one
   * the background minted when it asked for the card: it names the request, and only the content script that was told it can give
   * it to the card, so neither a page framing the menu nor another request of the tab can ask or answer for it.
   */
  passkeyPrompt(args: { tabId: number; token: string }): Promise<PasskeyPrompt | null>
  /** The person's answer to that card: a click through the menu's gate; `use` names one of the card's choices. */
  passkeyAnswer(args: {
    tabId: number
    token: string
    action: PasskeyAction
    passkeyId?: string
  }): Promise<void>
  /** A passkey picked in a field's menu, for the page's conditional request in that frame. */
  passkeyChoose(args: {
    tabId: number
    frameId: number
    fieldId: string
    passkeyId: string
  }): Promise<void>
  // Added by passkeys (end)
  // Added by transfer (begin): what the transfer tab asks (no other page may).
  /** Opens the vault from the transfer tab, which has no lock screen of its own. */
  transferUnlock(args: { password: string }): Promise<UnlockResult>
  transferOpen(args: { data: string }): Promise<TransferOpened>
  transferOpenQr(args: { images: string[] }): Promise<TransferOpened>
  transferPreview(args: { token: string; password?: string }): Promise<TransferPreview>
  transferPreviewKit(args: { token: string; pieces: string[] }): Promise<TransferPreview>
  transferPlan(args: { token: string; options: TransferOptions }): Promise<TransferPlan>
  transferApply(args: { token: string; options: TransferOptions }): Promise<TransferResult>
  transferCancel(args: { token: string }): Promise<void>
  transferExportInfo(): Promise<ExportInfo>
  transferExport(args: ExportRequest): Promise<ExportedFile>
  transferExportQr(args: QrExportRequest): Promise<QrExport>
  // End of added by transfer
}

/** A login as the in-page menu gets it: no note. */
export type MenuLogin = Omit<LoginView, 'note'>

export interface MenuView {
  state: VaultState
  match: SiteMatch
  /** The logins the menu lists: the popup's `LoginView`, without its note. */
  logins: MenuLogin[]
  codes: CodeView[]
  /** A new-password field: suggestions, a strong password and a passphrase. */
  suggestions?: string[]
  field: { kind: 'username' | 'password' | 'newPassword' | 'code' | 'card' | 'identity' }
  /** Added by items: the cards, on a card field; names and last digits only. */
  cards?: MenuCard[]
  /** Added by items: the identities, on an identity field; names and an email or company only. */
  identities?: MenuIdentity[]
  /** Added by items: where a card or identity would be filled, and whether that needs the person's confirmation. */
  form?: FormGate
  /** Added by background: sync's session ended (an SSO-only account has no password to type here), so point to setup. */
  signInAgain?: boolean
  /** Added by passkeys: the passkeys the page's conditional request in this frame can be answered with. */
  passkeys?: PasskeyChoice[]
}

export interface PendingSave {
  site: string
  username: string
  /** An existing login whose password changed, when it is an update. */
  updateOf?: string
  /** Added by items: a card to save, shown by its last digits (never its number or code). */
  card?: { brand?: string; lastFour: string; holder?: string; expiry?: string }
  /** Added by items: an identity to save, shown by its name, email and address. */
  identity?: { name: string; email?: string; address?: string }
}

/** A card as the in-page menu lists it: what tells two cards apart. */
export type MenuCard = Pick<
  CardView,
  | 'id'
  | 'name'
  | 'brand'
  | 'lastFour'
  | 'expMonth'
  | 'expYear'
  | 'expired'
  | 'cardholder'
  | 'pinned'
>

/** An identity as the in-page menu lists it. */
export type MenuIdentity = Pick<
  IdentityView,
  'id' | 'name' | 'fullName' | 'email' | 'company' | 'pinned'
>

/**
 * Where a card or identity would be filled (decision 1): the frame's own origin, whether it is the tab's top frame, whether it
 * is https, and the top page's site when the frame is another. `confirm` is true unless the frame is the top frame over https,
 * and then the menu asks the person first and fills with `picked`.
 */
export interface FormGate {
  origin: string
  top: boolean
  secure: boolean
  confirm: boolean
  topSite?: string
}

/** What a content script may ask (it names no site: the background takes the sender's frame). */
export interface ContentApi {
  /** The fields this frame found (decision 7); the answer says whether to show buttons. */
  fields(args: {
    fields: {
      id: string
      kind: 'username' | 'password' | 'newPassword' | 'code' | 'card' | 'identity'
      boxes?: number
      /** Added by background: the field's site rules (maxlength, minlength, passwordrules). */
      rules?: string
      /** Added by items: with `card` or `identity`, what the field asks for, and the form or address block it is in. */
      part?: FormPart
      group?: string
      focus?: boolean
    }[]
  }): Promise<{ buttons: boolean }>
  /**
   * Added by items: a form with card fields was sent with these values (as the fields hold them): maybe offer to save the card.
   * The values stay text; the background reads them.
   */
  cardSent(args: {
    number: string
    holder: string
    expiry: string
    month: string
    year: string
    code: string
  }): Promise<void>
  /** Added by items: a form with identity fields was sent with these values: maybe offer to save the identity. */
  identitySent(args: {
    given: string
    family: string
    full: string
    email: string
    phone: string
    company: string
    line1: string
    city: string
    postalCode: string
    country: string
  }): Promise<void>
  /** A form was sent with these values: maybe offer to save (decision 10). */
  sent(args: { username: string; password: string; newPassword?: string }): Promise<void>
  /**
   * The tab and frame the browser says this script runs in, so the menu frame it opens can name its field to the background,
   * which checks the sender (the `menu` request). A content script can't learn its own frame id any other way. The background
   * answers from the sender it trusts, never from the message.
   */
  frame(args: Record<string, never>): Promise<{ tabId: number; frameId: number }>
  /** The field's menu was opened by a click in plain view (decision 9). */
  openMenu(args: { fieldId: string }): Promise<void>

  // Added by passkeys (begin): the page's WebAuthn requests, as the bridge script hands them over (docs/plans/add-passkeys.md).
  /**
   * A `navigator.credentials.create` or `get` for a public key. `id` is the page script's, to match the end with the start. The
   * answer is how it starts: `pending` (the end comes later, as the background's `passkeyDone` to this frame), or already ended.
   * The frame's origin is the browser's, never the request's.
   */
  passkeyBegin(args: {
    id: string
    type: 'create' | 'get'
    conditional: boolean
    options: PasskeyCreationOptions | PasskeyRequestOptions
  }): Promise<PasskeyStart>
  /** The page aborted the request, or the script gave up on it. */
  passkeyCancel(args: { id: string }): Promise<void>
  /** Whether Kemlock answers passkey requests in this frame now (for the availability checks). */
  passkeyStatus(args: Record<string, never>): Promise<{ active: boolean }>
  // Added by passkeys (end)
}

export type PageRequest = {
  [K in keyof PageApi]: { kind: K } & (Parameters<PageApi[K]> extends []
    ? object
    : NonNullable<Parameters<PageApi[K]>[0]>)
}[keyof PageApi]
export type ContentRequest = {
  [K in keyof ContentApi]: { kind: K } & Parameters<ContentApi[K]>[0]
}[keyof ContentApi]

/** The wire answer: the result, or an error the page shows in its own words. */
export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }
