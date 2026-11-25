// What Sends carry between the extension's parts (docs/plans/add-sends.md). The core makes, lists and opens them through
// Kemlock-core's own Sends client; these are the values it answers with and the pages ask with. Every one is JSON.
//
// A Send's link, the key in it and its password are secrets: the owner's link goes from the core to the clipboard in the background
// and to no page, and a received link's key stays in the core. What a page does hold is a received Send's content, which is what
// opening it is for.
import type { SyncPlace } from './api'

export type SendKind = 'text' | 'file'

/** What the owner's list shows of a Send, from what the server keeps in plain. */
export type SendStatus = 'active' | 'expired' | 'usedUp' | 'off' | 'waitingForFile'

/** One of the account's Sends, as the list shows it. */
export interface SendView {
  /** The Send's id (a UUID), which is not part of its link. */
  id: string
  kind: SendKind
  /** False when its sealed name doesn't open in this browser: it is listed with Delete only, as the app does. */
  readable: boolean
  /** The name, when it is readable. */
  name?: string
  status: SendStatus
  /** How many times it was opened, and the limit if there is one. */
  accessCount: number
  maxAccess?: number
  /** When it is deleted, and when the link stops working before that. */
  deletionAt: number
  expiresAt?: number
  disabled: boolean
  hasPassword: boolean
  hideEmail: boolean
}

/** A Send a Bitwarden app made: listed and deleted here, never opened, edited or shared (the server keeps it in another format). */
export interface ForeignSendView {
  id: string
  kind: SendKind
  status: SendStatus
  accessCount: number
  maxAccess?: number
  deletionAt: number
  expiresAt?: number
  disabled: boolean
}

/** Where Sends are: on Kemlock Server's list, or nowhere, and then where the vault syncs instead (or nowhere). */
export type SendsListing =
  | { available: false; place: SyncPlace | null }
  | { available: true; sends: SendView[]; foreign: ForeignSendView[] }

/** One Send with what only its owner reads: the notes, and a text Send's text. */
export interface SendDetail extends SendView {
  notes?: string
  text?: string
}

/** What a Send call can fail with, in the words the pages know. */
export type SendProblem =
  /** The vault doesn't sync with Kemlock Server: `place` says where it syncs instead. */
  | 'noSync'
  /** The home server is away (the phone's "offline since"): `since`. */
  | 'away'
  | 'sessionEnded'
  | 'network'
  | 'server'
  /** A space's rule refuses it: `detail` is the server's own words. */
  | 'policy'
  /** The server's file limit: `maxSize`. */
  | 'tooLarge'
  | 'storage'
  /** No such Send, or one that is closed (the server doesn't say which). */
  | 'notFound'
  /** Too many password tries: wait `seconds`. */
  | 'rateLimited'
  /** A file Send's bytes didn't go up, so the Send was deleted. */
  | 'upload'
  /** An input the core refused before anything was sent: `reason`. */
  | 'invalid'
  | 'passwordRequired'
  | 'wrongPassword'
  /** A payload that isn't the Send's own, or a file of the wrong length: nothing is shown. */
  | 'doesntOpen'
  /** A file over the limit the browser downloads: `size`. */
  | 'tooBig'
  /** The core no longer holds what the handle named (its background stopped meanwhile): start again. */
  | 'lost'
  /** The text holds no Send link. */
  | 'badLink'
  /** A Bitwarden Send, which Kemlock doesn't open. */
  | 'bitwarden'
  | 'insecure'

/** Why the core refused an input (the app's own checks, `SendsInvalid`). */
export type SendInvalid =
  | 'noName'
  | 'noText'
  | 'textTooLong'
  | 'notesTooLong'
  | 'fileTooBig'
  | 'deletion'
  | 'expiry'
  | 'maxAccess'

export interface SendFailure {
  problem: SendProblem
  reason?: SendInvalid
  place?: SyncPlace | null
  since?: number
  detail?: string
  maxSize?: number
  seconds?: number
  size?: number
}

/** A Send call's answer: its value, or the problem. */
export type SendResult<T> = { ok: true; value: T } | ({ ok: false } & SendFailure)

/** What the New Send page gives. A file's bytes go first, in pieces (`sendStageFile`). */
export interface NewSendInput {
  kind: SendKind
  /** The name the recipient sees (a file's own, by default). */
  name: string
  /** A text Send's text. */
  text?: string
  /** A file's media type. */
  mime?: string
  /** A file Send's staged file (the handle `sendStageFile` gave) and its size in bytes, which must be what was staged. */
  handle?: string
  size?: number
  /** Notes only the owner sees. */
  notes: string
  /** Deleted this many days from now, 1 to 30. */
  deleteInDays: number
  /** When the link stops working, no later than the deletion; epoch ms. */
  expiresAt?: number
  /** How many times it may be opened, from 1. */
  maxAccess?: number
  /** Its password; the core sends only a proof of it. */
  password?: string
  hideEmail: boolean
}

/**
 * What an edit changes: the fields that are given, the others stay as the Send has them. `expiresAt` and `maxAccess` given as null
 * mean none. A file Send's file and name never change.
 */
export interface SendPatch {
  name?: string
  notes?: string
  text?: string
  /** Epoch ms, within 30 days from now. */
  deletionAt?: number
  expiresAt?: number | null
  maxAccess?: number | null
  hideEmail?: boolean
  disabled?: boolean
  /** Sets or changes the password. */
  newPassword?: string
  /** Takes the password away (not with `newPassword`). */
  removePassword?: boolean
}

/** A Send a recipient opened: what its payload says and what the server added. */
export interface ReceivedSendView {
  /** What every later call about this Send names it by: the tab that opened it holds it, and no other tab has it. */
  handle: string
  kind: SendKind
  name: string
  /** A text Send's text. */
  text?: string
  /** A file Send's media type and size. */
  mime?: string
  size?: number
  /** A file over the limit Kemlock downloads. */
  tooBig: boolean
  expiresAt?: number
  deletionAt: number
  /** The server's word about who sent it, shown only as that. */
  senderEmail?: string
  /** The server the link names, with its port when it isn't https's own. */
  host: string
}

/** The port the Sends tab holds open to the background while it has a Send open or a file going up, and how often it pings. */
export const sendsKeepAlivePort = 'kemlock-sends-alive'
export const sendsPingMs = 15_000

/** The longest text the Open a Send page sends the core: a link, and nothing around it (the page messages bound it the same). */
export const sendLinkMaxLength = 8192

/** The longest name a Send takes, which a file's own name is cut to. */
export const sendNameMaxLength = 512

/**
 * A text Send the popup starts from a note: the name and the text New Send opens with. The text crosses from the core to the Sends tab
 * through the background and never through an address: the tab is opened with a token that names the draft, and takes it once.
 */
export interface SendDraft {
  name: string
  text: string
}

/** How long the background holds a draft for the tab to take it (milliseconds). */
export const sendDraftKeepMs = 2 * 60_000

/** The largest file a Send is made from, the app's attachment limit (50 MiB). */
export const sendFileLimit = 50 * 1024 * 1024

/** How many bytes of a file cross to or from a page in one message (before base64): the core's `sendsChunkBytes`. */
export const sendChunkBytes = 1024 * 1024

/** The choices of "Deletes after", in days, and the most days ahead a Send's deletion may be. */
export const sendDeleteDayChoices = [1, 2, 3, 7, 14, 30] as const
export const sendMaxDeleteDays = 30
