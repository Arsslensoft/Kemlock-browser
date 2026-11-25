// The contract of shared spaces (docs/plans/add-spaces.md): what the core answers about a person's spaces, and what the extension's
// pages may ask the background about them. It adds to `CoreApi`, `PageApi` and the item views by declaration merging, so
// src/shared/api.ts stays as it is.
//
// Everything here is JSON, with no secret: a space's keys and the account's keys never leave the core. A fingerprint is public.

/* ----------------------------------------------------------------------------------------------- */
/* What a space is                                                                                   */
/* ----------------------------------------------------------------------------------------------- */

/** The kinds of item a space page lists. */
export type SpaceItemKind = 'login' | 'code' | 'backupCodes' | 'note' | 'card' | 'identity' | 'key'

/** What an item's view says of the space it is in. */
export interface SpaceNote {
  id: string
  /** The space's name, when it is known (the id's start stands in until it is). */
  name: string
  /** This account may change it, as the verified chain says (a view-only grant, or a space not checked yet, may not). */
  canEdit: boolean
  /** A login's password is hidden from this account (a grant that hides passwords, or a space not checked yet): no Show, no Copy. */
  passwordHidden?: boolean
  /** The collection of a server space it is in. */
  collection?: string
}

/**
 * What a space's row says: an invitation (`invited`, `accepted` waits for an admin), a space whose fingerprint wasn't compared
 * (`compare`), one that can't be checked, the keys that need replacing, or the person's role.
 */
export type SpaceStatus =
  | 'cantBeChecked'
  | 'removed'
  | 'invited'
  | 'accepted'
  | 'compare'
  | 'keysNeedReplacing'
  | 'owner'
  | 'admin'
  | 'custom'
  | 'member'
  | 'webdav'
  | 'moved'

export interface SpaceRow {
  id: string
  kind: 'server' | 'webdav'
  /** The space's name; the start of its id while it can't be opened. */
  name: string
  status: SpaceStatus
  /** A fingerprint was compared for it: first contact is done. */
  compared: boolean
  role?: 'owner' | 'admin' | 'custom' | 'member'
  /** Members and invited, as the verified chain has them. */
  members?: number
  /** The items of it this browser holds. */
  items: number
  lastSync?: number
  /** The sync problem of its last run (`sync_problem_*`). */
  problem?: string
}

export interface SpacesView {
  /** The vault syncs with Kemlock Server, so there are spaces on it. */
  available: boolean
  server: SpaceRow[]
  webdav: SpaceRow[]
  /** The list couldn't be read (`sync_problem_*`); `server` is then the last list. */
  problem?: string
  /** The home server is away: changes to members, roles and keys wait for it. */
  homeAway?: string
}

export type MemberState = 'invited' | 'accepted' | 'confirmed' | 'rekeyed' | 'reconfirm' | 'removed'

export interface SpaceMemberView {
  id: string
  name: string
  role: 'owner' | 'admin' | 'custom' | 'member'
  status: MemberState
  you: boolean
  canRemove: boolean
  /** The roles the chain lets this account give them. */
  roles: ('owner' | 'admin' | 'member')[]
  /** They accepted, and this account may confirm them after comparing `digits`. */
  canConfirm: boolean
  canResend: boolean
  /** Their fingerprint as the server gave it, 12 groups of 5 digits, to compare with theirs before confirming. */
  digits?: string
}

export type CollectionPermission =
  'view' | 'view-hide-passwords' | 'edit' | 'edit-hide-passwords' | 'manage'

export interface SpaceCollectionView {
  id: string
  keyVersion: number
  /** Its key waits for a replacement. */
  marked: boolean
  /** What this account may do in it: `view`, `viewHidden`, `edit`, `editHidden` or `manage`. */
  myAccess?: string
  canGrant: boolean
  grants: { grantee: string; name: string; group: boolean; permission: CollectionPermission }[]
  /** The members who have no grant on it yet. */
  withoutGrant: { id: string; name: string }[]
}

export interface SpaceItemView {
  id: string
  kind: SpaceItemKind
  name: string
  canEdit: boolean
  /** A login whose password a grant hides: it can't be moved out. */
  passwordHidden?: boolean
  collection?: string
}

export interface SpaceView {
  id: string
  name: string
  status: SpaceStatus
  compared: boolean
  role: 'owner' | 'admin' | 'custom' | 'member'
  memberStatus: MemberState
  homeAway?: string
  members: SpaceMemberView[]
  collections: SpaceCollectionView[]
  items: SpaceItemView[]
  policies: { flags: string[]; minLength?: number }
  /** Account recovery is on: the space's admins could reset a member's master password. */
  accountRecovery: boolean
  keys: { spaceKeyVersion: number; needReplacing: boolean }
  canInvite: boolean
  canLeave: boolean
  onlyOwner: boolean
}

/** What a person compares before a space holds anything here (first contact). */
export interface SpaceContactView {
  id: string
  name: string
  /** `creator` and `vouched` have nothing to compare; `compare` shows `digits`; `pickOwner` asks whom to compare with. */
  kind: 'creator' | 'vouched' | 'compare' | 'pickOwner'
  invited: boolean
  person?: string
  personName?: string
  digits?: string
  bundleSigned: boolean
  candidates: { id: string; name: string }[]
  /** The chain records another key for this account than the one this browser holds: not the space it seems. */
  ownKeyMismatch: boolean
  members: number
  accountRecovery: boolean
}

export interface HeldItemView {
  id: string
  kind: string
  name: string
  canKeep: boolean
}

export interface DavSpaceJoin {
  /** The `bmc-space:` invite, and the one-time code that opens it. */
  invite: string
  code: string
  /** The WebDAV folder that holds the space's file, and its account. */
  folder: string
  username: string
  password: string
}

/* ----------------------------------------------------------------------------------------------- */
/* Added to the core, the pages' requests and the item views                                         */
/* ----------------------------------------------------------------------------------------------- */

/** The page requests of spaces, by name (the background's handlers and the message parsers each cover exactly these). */
export const spacePageKinds = [
  'spaces',
  'space',
  'spaceContact',
  'spaceTrust',
  'spaceAnswer',
  'spaceMake',
  'spaceLeave',
  'spaceInvite',
  'spaceResend',
  'spaceConfirm',
  'spaceRole',
  'spaceRemove',
  'spaceGrant',
  'spaceHeld',
  'spaceKeepHeld',
  'spaceDeleteHeld',
  'ownFingerprint',
  'moveItem',
  'syncSpaces',
  'joinDavSpace',
  'leaveDavSpace',
] as const

export type SpacePageKind = (typeof spacePageKinds)[number]

declare module './api' {
  /** The spaces' methods of the core. Optional, as the ones added by other parts are: a core without them answers `unsupported`. */
  interface CoreApi {
    spaces?(refresh?: boolean): Promise<SpacesView>
    space?(id: string): Promise<SpaceView>
    spaceContact?(id: string, person?: string): Promise<SpaceContactView>
    spaceTrust?(id: string, person?: string, digits?: string): Promise<void>
    spaceAnswer?(id: string, accept: boolean): Promise<void>
    spaceMake?(name: string): Promise<{ id: string }>
    spaceLeave?(id: string): Promise<void>
    spaceInvite?(id: string, email: string, role: string): Promise<void>
    spaceResend?(id: string, member: string): Promise<void>
    spaceConfirm?(id: string, member: string, digits: string): Promise<void>
    spaceRole?(id: string, member: string, role: string): Promise<void>
    spaceRemove?(id: string, member: string): Promise<void>
    spaceGrant?(
      id: string,
      collection: string,
      member: string,
      permission: CollectionPermission | null,
    ): Promise<void>
    spaceHeld?(id: string): Promise<HeldItemView[]>
    spaceKeepHeld?(id: string, item: string): Promise<void>
    spaceDeleteHeld?(id: string, item: string): Promise<void>
    /** This account's own fingerprint (12 groups of 5 digits), for the other side's comparison. */
    ownFingerprint?(): Promise<string | null>
    /** Puts an entry in a space (null: the vault's own), in one of its collections. */
    moveItem?(
      kind: SpaceItemKind,
      id: string,
      space: string | null,
      collection?: string,
    ): Promise<void>
    /** The logins whose password is hidden from this account: nothing may show or copy it. */
    hiddenLoginIds?(): Promise<string[]>
    joinDavSpace?(join: DavSpaceJoin): Promise<{ id: string; name: string }>
    leaveDavSpace?(id: string): Promise<void>
    /** Runs the spaces' scopes alone (a vault that syncs nowhere else, or "Refresh"), then lists them. */
    syncSpaces?(): Promise<SpacesView>
  }

  /** What the extension's own pages may ask the background about spaces. */
  interface PageApi {
    /** The spaces; `refresh: false` answers the last list without asking the server. */
    spaces(args?: { refresh?: boolean }): Promise<SpacesView>
    space(args: { id: string }): Promise<SpaceView>
    spaceContact(args: { id: string; person?: string }): Promise<SpaceContactView>
    /** The digits matched: stores the space's anchor as compared. `digits` is what the screen showed. */
    spaceTrust(args: { id: string; person?: string; digits?: string }): Promise<void>
    spaceAnswer(args: { id: string; accept: boolean }): Promise<void>
    spaceMake(args: { name: string }): Promise<{ id: string }>
    spaceLeave(args: { id: string }): Promise<void>
    spaceInvite(args: {
      id: string
      email: string
      role: 'owner' | 'admin' | 'member'
    }): Promise<void>
    spaceResend(args: { id: string; member: string }): Promise<void>
    /** Confirms a member after their `digits` were compared. */
    spaceConfirm(args: { id: string; member: string; digits: string }): Promise<void>
    spaceRole(args: {
      id: string
      member: string
      role: 'owner' | 'admin' | 'member'
    }): Promise<void>
    spaceRemove(args: { id: string; member: string }): Promise<void>
    spaceGrant(args: {
      id: string
      collection: string
      member: string
      permission: CollectionPermission | null
    }): Promise<void>
    spaceHeld(args: { id: string }): Promise<HeldItemView[]>
    spaceKeepHeld(args: { id: string; item: string }): Promise<void>
    spaceDeleteHeld(args: { id: string; item: string }): Promise<void>
    ownFingerprint(): Promise<string | null>
    moveItem(args: {
      /** The kind of the entry (`kind` is the request's own name on the wire). */
      itemKind: SpaceItemKind
      id: string
      space: string | null
      collection?: string
    }): Promise<void>
    syncSpaces(): Promise<SpacesView>
    joinDavSpace(args: DavSpaceJoin): Promise<{ id: string; name: string }>
    leaveDavSpace(args: { id: string }): Promise<void>
  }

  interface CodeView {
    space?: SpaceNote
  }
  interface LoginInput {
    /** The login's password is hidden from this account: the save keeps the one it holds. */
    keepPassword?: boolean
  }
  interface LoginView {
    space?: SpaceNote
  }
  interface BackupCodeView {
    space?: SpaceNote
  }
}
