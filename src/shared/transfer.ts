// What the transfer page and the background say to each other about importing and exporting (docs/plans/add-transfer.md). Every
// value is JSON. A file's items stay in the core until they are merged: the page gets names, counts and reasons, never a secret,
// and an export's text goes to the transfer page, which is the extension's own, and nowhere else.

/** What the core tells a file is, by the format it was written in. `qr` is otpauth links and Google Authenticator's codes in images. */
export type TransferFormat =
  | 'kemlock'
  | 'google'
  | 'aegis'
  | 'twoFas'
  | 'bitwarden'
  | 'uris'
  | 'cxf'
  | 'csv'
  | 'qr'
  | 'kemlockQr'

/** The kinds of item a file may hold, which the preview counts one by one. */
export const transferKinds = [
  'codes',
  'backupServices',
  'logins',
  'notes',
  'passkeys',
  'keys',
  'cards',
  'identities',
  'contacts',
  'keyAccounts',
] as const
export type TransferKind = (typeof transferKinds)[number]
export type TransferCounts = Record<TransferKind, number>

/** A file (or images of QR codes) opened as far as telling what it is: nothing is read of it yet if it needs a password. */
export interface TransferOpened {
  /** Names the opened file in the core until it is merged or cancelled. */
  token: string
  format: TransferFormat
  /** The file needs a password to be read. */
  encrypted: boolean
  /** A Credential Exchange file names the app that made it. */
  exporter?: string
  /** The attached files an archive holds (which this browser does not keep). */
  archiveFiles: number
  /** From images: how many different codes were read, and how many images held none. */
  codesRead?: number
  imagesUnread?: number
}

/** One item of a file, by name only. */
export interface TransferSample {
  kind: 'code' | 'login' | 'backupServices' | 'note' | 'passkey' | 'key' | 'card' | 'identity'
  name: string
  detail: string
}

/** A place a Credential Exchange file asks about: an exported account, or a collection shared with others in the old app. */
export interface TransferUnit {
  id: string
  name: string
  shared: boolean
  count: number
}

/** Why a credential or an item of a Credential Exchange file isn't imported. */
export type TransferSkipReason =
  | 'file'
  | 'wifi'
  | 'apiKey'
  | 'generatedPassword'
  | 'itemReference'
  | 'unknownType'
  | 'unreadable'
  | 'totpAlgorithm'
  | 'totpDigits'
  | 'totpSecret'
  | 'passkeyAlgorithm'
  | 'passkeyKey'
  | 'sshKey'
  | 'nothingKept'

export interface TransferSkip {
  title: string
  reason: TransferSkipReason
  detail?: string
}

export interface TransferNotice {
  title: string
  reason: 'passkeyExtras'
}

/** What a limit cut from a Credential Exchange file. */
export interface TransferCuts {
  items: number
  credentials: number
  urls: number
  collections: number
  values: number
}

/** What a file holds, once opened. */
export interface TransferPreview {
  format: TransferFormat
  exporter?: string
  /** By kind, as the file holds them. */
  held: TransferCounts
  /** Entries of another app's backup that Kemlock can't represent, counted when the importer lists none. */
  skipped: number
  skips: TransferSkip[]
  notices: TransferNotice[]
  cuts?: TransferCuts
  /** The places a Credential Exchange file asks about; none for other files. */
  units: TransferUnit[]
  /** The first names of each kind, for the person to recognise the file by. */
  samples: TransferSample[]
  /** The attached files its notes name, which this browser does not keep. */
  attachedFiles: number
  /** The items that came from a shared space, which come in as the person's own. */
  spaceItems: number
}

/** What the person chose for the import. */
export interface TransferOptions {
  /** `merge` adds what the vault doesn't hold (the default); `replace` puts a file's codes in place of the vault's. */
  mode?: 'merge' | 'replace'
  /** The ids of the places left out. */
  excluded?: string[]
  /** Keep the checks a file records of other people's keys (off: they come in not checked). */
  keepChecks?: boolean
}

/** What the import would do under the options. */
export interface TransferPlan {
  /** What it would add, by kind. */
  adding: TransferCounts
  held: TransferCounts
  /** What the vault holds already, by kind. */
  duplicates: TransferCounts
  canImport: boolean
  /** The keys of other people it would bring. */
  contacts: { name: string; fingerprint?: string; checkedInFile: boolean }[]
}

export interface TransferResult {
  added: TransferCounts
  replaced: boolean
  /** Items left as they were because they are in a shared space this account may only read (replacing would have changed them). */
  skipped?: number
}

/** The formats a file can be exported in. */
export type ExportFormat = 'encrypted' | 'plain' | 'csv' | 'links' | 'cxf'

/** The kinds a Credential Exchange export may hold. */
export const cxfKinds = [
  'logins',
  'codes',
  'passkeys',
  'notes',
  'cards',
  'identities',
  'keys',
] as const
export type CxfKind = (typeof cxfKinds)[number]

/** What an export of the open vault could hold: nothing secret. */
export interface ExportInfo {
  counts: TransferCounts
  /** The items of shared spaces, which no export holds. */
  spaceItems: number
  /** The attached files its notes name, which this browser does not keep, so no export holds them. */
  attachedFiles: number
  cxf: {
    /** How many of each kind the Credential Exchange writer would write. */
    sendable: Record<CxfKind, number>
    /** What it would leave out, by reason. */
    leftOut: Record<string, number>
  }
}

export interface ExportRequest {
  format: ExportFormat
  /** The vault's own password, which every export asks again. */
  password: string
  /** An encrypted export's own password. */
  exportPassword?: string
  /** A Credential Exchange export's kinds. */
  kinds?: CxfKind[]
}

/** An export, ready to be saved by the page. */
export interface ExportedFile {
  name: string
  mime: string
  text: string
  counts: Partial<TransferCounts>
  leftOut: { title: string; reason: string; count?: number }[]
  spaceItems: number
  attachedFiles: number
}

export type QrExportFormat = 'google' | 'kemlock' | 'kemlockPlain'

export interface QrExportRequest {
  format: QrExportFormat
  password: string
  /** Kemlock's encrypted transfer's own password. */
  transferPassword?: string
}

/** A QR code as its modules, `size` by `size`, `1` for a dark one, row by row. */
export interface QrModules {
  size: number
  modules: string
}

export interface QrExport {
  codes: QrModules[]
  /** How many codes the QR codes hold. */
  exported: number
  /** How many backup-code services go too (Kemlock's transfer only). */
  backupServices: number
  leftOut: { title: string; reason: string }[]
}
