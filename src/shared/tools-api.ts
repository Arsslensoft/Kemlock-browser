// The contract of the vault tools (docs/plans/add-vault-tools.md): tags, pins and order, backup codes, the duplicate cleaner and the
// breach checks. `ToolsCoreApi` is what the background calls in the Dart core (core/lib/src/tools_service.dart answers each by
// name); `ToolsPageApi` is what the popup may ask the background, which checks the sender before it calls the core. Everything is
// JSON, and none of it holds a secret but the backup codes `backupDetail` gives to the page that shows them.
import type { BackupCodeView } from './api'

/** The kinds of item that hold tags. */
export type ItemKind =
  'code' | 'login' | 'passkey' | 'note' | 'card' | 'identity' | 'file' | 'key' | 'keyAccount'

/** What the order and the pin apply to. */
export type OrderedKind = 'code' | 'login'

export interface TagCount {
  name: string
  count: number
}

/* Backup codes */

export interface BackupCodeItem {
  code: string
  used: boolean
  /** When it was marked used. */
  usedAt?: number
}

/** A service's backup codes, with who they belong to. */
export interface BackupDetail {
  serviceId: string
  name: string
  note?: string
  /** Two codes or fewer are left (the app's low warning). */
  low: boolean
  codes: BackupCodeItem[]
  /** The codes whose service this is. */
  accounts: { id: string; name: string }[]
  /** The logins linked to those codes. */
  logins: { id: string; name: string }[]
}

/** Which codes have their backup codes saved. */
export interface BackupCoverage {
  total: number
  covered: number
  missing: { id: string; name: string; account: string }[]
}

/* Duplicates */

export type DuplicateReason =
  | 'sameSignIn'
  | 'sameAccount'
  | 'sameCode'
  | 'samePasskey'
  | 'sameCard'
  | 'sameNote'
  | 'sameFile'
  | 'sameKey'
  | 'sameCodes'
  | 'sameIdentity'
  | 'inTwoPlaces'
  | (string & {})

export interface DuplicateItem {
  id: string
  name: string
  /** A line under the name: a login's username and site, a code's account. */
  detail: string
  changedAt: number
}

export interface DuplicateGroup {
  /** What a dismissal of the group is remembered by. */
  key: string
  reason: DuplicateReason
  /** `login`, `account` (a code), `note`, `file`, `passkey`, `key`, `contact`, `card`, `identity`, `service` (backup codes). */
  kind: string
  items: DuplicateItem[]
}

export interface MergeRecordView {
  id: string
  at: number
  label: string
  count: number
}

export interface DuplicateMatching {
  /** The vault syncs with a Kemlock Server. */
  available: boolean
  on: boolean
}

export interface DuplicatesView {
  checkedAt: number
  groups: DuplicateGroup[]
  records: MergeRecordView[]
  matching: DuplicateMatching
}

/** What a merge would do: the item that stays, and for each field that differs the text of each copy (a password as dots). */
export interface MergePlan {
  key: string
  /** How many of the group's items are left out because they are in a space this account may only read. */
  skipped?: number
  keptId: string
  items: DuplicateItem[]
  fields: {
    id: string
    picked: string
    options: { itemId: string; text: string }[]
  }[]
}

/** What a merge did: the items removed, the record Undo takes, and the items left out (see [MergePlan.skipped]). */
export interface MergeDone {
  removed: number
  recordId: string
  skipped?: number
}

/**
 * What Undo merge did: `undone`; `edited` when the item that stayed was changed after the merge, which putting it back would lose
 * (nothing was changed; ask again with `overwrite`); `unavailable` when there is no such merge, or it is past its 30 days.
 */
export type UndoResult = 'undone' | 'edited' | 'unavailable'

/* Breaches */

export interface BreachEntry {
  kind: 'code' | 'backup'
  id: string
  name: string
}

export interface BreachAlert {
  /** Have I Been Pwned's name for the breach, which "Dealt with" keeps. */
  name: string
  title: string
  domain: string
  breachDate: string
  addedDate: string
  pwnCount: number
  passwords: boolean
  entries: BreachEntry[]
}

export interface BreachesView {
  alerts: BreachAlert[]
  serviceCount: number
  /** The day the list in use was made, `yyyy-mm-dd`. */
  listUpdated: string
  source: string
  /** The data's notice, as its licence asks it to be shown. */
  license: string
  /** The daily refresh of the list is on. */
  refreshOn: boolean
  /** When the list was last asked for a newer breach. */
  checkedAt?: number
}

export interface BreachCheck {
  at: number
  passwords: { on: boolean; breached: number; failed: number }
  list: { on: boolean; checked: boolean; updated: boolean }
}

/**
 * What renaming or deleting a tag did: the items changed, and the items left as they were because they are in a shared space this
 * account may only read.
 */
export interface TagChange {
  changed: number
  skipped: number
}

export interface ToolsSettings {
  /** Ask Have I Been Pwned once a day for breaches newer than the list the extension ships. Off until turned on. */
  breachRefresh: boolean
}

/** What the background calls in the core. */
export interface ToolsCoreApi {
  tags(): Promise<TagCount[]>
  setTags(kind: ItemKind, id: string, tags: string[]): Promise<string[]>
  renameTag(from: string, to: string): Promise<TagChange>
  deleteTag(name: string): Promise<TagChange>
  setPinned(kind: OrderedKind, id: string, pinned: boolean): Promise<void>
  /** The app's custom order of the codes: the ids given take 0, 1, 2, ... (pinned codes first). */
  reorderCodes(ids: string[]): Promise<void>
  /** The browser's own order of the logins (the app keeps none), sealed in the vault and never synced. */
  reorderLogins(ids: string[]): Promise<void>

  backupDetail(serviceId: string): Promise<BackupDetail>
  parseBackupCodes(text: string): Promise<string[]>
  addBackupService(name: string, text: string): Promise<BackupCodeView>
  editBackupService(
    serviceId: string,
    name: string | null,
    note: string | null,
    clearNote: boolean,
  ): Promise<BackupCodeView>
  addBackupCodes(serviceId: string, text: string): Promise<{ added: number; duplicates: number }>
  /** `code` is the code the page shows at `index`: the core refuses with `stale` when the vault's list has another there. */
  setBackupCodeUsed(
    serviceId: string,
    index: number,
    used: boolean,
    code: string,
  ): Promise<BackupCodeView>
  removeBackupCode(serviceId: string, index: number, code: string): Promise<BackupCodeView>
  deleteBackupService(serviceId: string): Promise<void>
  backupCoverage(): Promise<BackupCoverage>
  setNoBackupCodes(codeId: string, none: boolean): Promise<void>

  duplicates(): Promise<DuplicatesView>
  duplicateReview(key: string): Promise<MergePlan>
  duplicateMerge(key: string, keptId: string, picks: Record<string, string>): Promise<MergeDone>
  duplicateDismiss(key: string): Promise<boolean>
  duplicateRestore(key: string): Promise<void>
  duplicateUndo(recordId: string, overwrite: boolean): Promise<UndoResult>
  duplicateMatching(): Promise<DuplicateMatching>
  setDuplicateMatching(on: boolean): Promise<DuplicateMatching>

  breaches(): Promise<BreachesView>
  dismissBreach(name: string, accountIds: string[], serviceIds: string[]): Promise<void>
  checkBreaches(): Promise<BreachCheck>
  toolsSettings(): Promise<ToolsSettings>
  saveToolsSettings(settings: Partial<ToolsSettings>): Promise<ToolsSettings>
}

/** What the extension's own pages (the popup, setup) may ask the background. */
export interface ToolsPageApi {
  tags(): Promise<TagCount[]>
  setTags(args: { itemKind: ItemKind; id: string; tags: string[] }): Promise<string[]>
  renameTag(args: { from: string; to: string }): Promise<TagChange>
  deleteTag(args: { name: string }): Promise<TagChange>
  setPinned(args: { itemKind: OrderedKind; id: string; pinned: boolean }): Promise<void>
  /** Saves the order of a list: its ids, first first. (A request's `kind` names the request, so the item's is `itemKind`.) */
  reorder(args: { itemKind: OrderedKind; ids: string[] }): Promise<void>

  backupDetail(args: { serviceId: string }): Promise<BackupDetail>
  parseBackupCodes(args: { text: string }): Promise<string[]>
  addBackupService(args: { name: string; text: string }): Promise<BackupCodeView>
  editBackupService(args: {
    serviceId: string
    name?: string
    note?: string
    clearNote?: boolean
  }): Promise<BackupCodeView>
  addBackupCodes(args: {
    serviceId: string
    text: string
  }): Promise<{ added: number; duplicates: number }>
  /** `code` is the code the page shows at `index`, so a list that changed since can't be marked or lost by place. */
  setBackupCodeUsed(args: {
    serviceId: string
    index: number
    used: boolean
    code: string
  }): Promise<BackupCodeView>
  removeBackupCode(args: {
    serviceId: string
    index: number
    code: string
  }): Promise<BackupCodeView>
  deleteBackupService(args: { serviceId: string }): Promise<void>
  backupCoverage(): Promise<BackupCoverage>
  setNoBackupCodes(args: { codeId: string; none: boolean }): Promise<void>

  duplicates(): Promise<DuplicatesView>
  duplicateReview(args: { key: string }): Promise<MergePlan>
  duplicateMerge(args: {
    key: string
    keptId: string
    picks: Record<string, string>
  }): Promise<MergeDone>
  duplicateDismiss(args: { key: string }): Promise<boolean>
  duplicateRestore(args: { key: string }): Promise<void>
  duplicateUndo(args: { recordId: string; overwrite?: boolean }): Promise<UndoResult>
  setDuplicateMatching(args: { on: boolean }): Promise<DuplicateMatching>

  breaches(): Promise<BreachesView>
  dismissBreach(args: { name: string; accountIds: string[]; serviceIds: string[] }): Promise<void>
  checkBreaches(): Promise<BreachCheck>
  toolsSettings(): Promise<ToolsSettings>
  saveToolsSettings(args: { settings: Partial<ToolsSettings> }): Promise<ToolsSettings>
}
