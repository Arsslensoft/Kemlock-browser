// The account's own calls (docs/plans/add-browser-account.md, decision A3): one page message, `account`, carries `{ op, ...args }`.
// The ops, their arguments and their answers are listed here once; the background validates each request by its op's spec before the
// core sees it, so a field a sender adds, or one of the wrong kind or size, never gets that far. Every answer is JSON, and times are
// milliseconds since the epoch unless a field says the server's own text.
import type { SignInStep } from './api'

/* ----------------------------------------------------------------------------------------------- */
/* What the account's pages show                                                                     */
/* ----------------------------------------------------------------------------------------------- */

/** A device of the account (`GET /kem/v1/devices`). */
export interface DeviceView {
  id: string
  name: string
  /** The server's kind: `kemlock-android`, `kemlock-ios`, `kemlock-browser`, `kemlock-web`, ... */
  kind: string
  /** This browser. */
  current: boolean
  /** The server holds a trusted-device copy of the root key for it. */
  trusted: boolean
  createdAt?: number | null
  lastSeen?: number | null
  lastKemlock?: number | null
  lastBitwarden?: number | null
}

/** A new device waiting to be approved. */
export interface ApprovalView {
  id: string
  deviceName: string
  deviceKind: string
  /** The requester's address, cut to its /24 or /48. */
  ip: string
  /** The five words the core worked out from the request's one-time key; null when the server gave no key. */
  phrase: string[] | null
  /** The server's own words are these words. When false the page says to deny, and approving is refused. */
  agrees: boolean
  canApprove: boolean
  ageSeconds: number
  createdAt: number
  expiresAt: number
}

export type EmergencyKind = 'view' | 'takeover'
export type EmergencyState =
  'invited' | 'accepted' | 'confirmed' | 'recovery-initiated' | 'approved' | 'rejected'

export interface EmergencyGrant {
  id: string
  grantorId: string
  granteeEmail: string
  granteeId: string | null
  kind: EmergencyKind
  waitDays: number
  state: EmergencyState
  recoveryInitiatedAt: string | null
  /** While a request runs: when the wait ends and the timer approves (the server's RFC 3339 text). */
  dueAt: string | null
  createdAt: string
}

export interface GrantView {
  grant: EmergencyGrant
  /** On the contact's side: who named them. */
  grantorEmail: string | null
  /** On the grantor's side: the contact shared their keys, which confirming seals the root key to. */
  hasKeys: boolean
}

/** The account's Recovery Kit as the server keeps it: the record, never a piece. */
export interface KitRecord {
  kitId: string
  threshold: number
  shares: number
  keyVersion: number
  createdAt: string
  /** Whether the kit is for the account's current key version: only then do its pieces open the account. */
  current: boolean
}

export type TwoStepMethod = 'totp' | 'webauthn' | 'email' | 'yubikey' | 'duo'

export interface TwoStepView {
  methods: { method: TwoStepMethod; enabled: boolean }[]
  recoveryCodes: boolean
  /** The address codes are mailed to, when the email method is on. */
  email: string | null
  /** Whether this server can mail a code. */
  emailOffered: boolean
}

export type MoveSource = 'vaultwarden' | 'webdav'
export type MoveStep = 'sync' | 'copy' | 'files' | 'check' | 'oldStore' | 'done'

/** What a finished move did (the app's record's `result`). */
export interface MoveResult {
  /** The entries that moved, by kind. */
  moved?: Record<string, number>
  files?: number
  /** What happened to the old store: `closed`, `gone`, `copyKept`, `fileLeft` or `blocked`. */
  oldStore?: string
  changed?: number
  unreadable?: number
  unconfirmed?: number
  skipped?: number
}

/** Where the move stands. */
export interface MoveStatus {
  /** A vault that syncs with Vaultwarden on the server's address, or with WebDAV, and hasn't moved. */
  offered: boolean
  source?: MoveSource
  /** A sign-in is held, waiting for the person to say the vault moves. */
  held: boolean
  running: boolean
  step?: MoveStep
  done: number
  total: number
  finished: boolean
  result?: MoveResult
  /** Why the last run stopped: a move problem (`unreadable`, `fileMissing`, `checkFailed`, `newer`, `filesNeedPhone`,
   *  `oldStoreGone`, `editedMeanwhile`) or a sync problem (`removals`, `network`, `auth`, ...). */
  problem?: string
  /** With `held`: what the move would do, as setup shows it before anything is written. */
  counts?: Record<string, number>
  /** With `held`: the attached files the vault's notes name, which a browser can't move. */
  files?: number
  /** With `held`: an earlier move stopped part way and goes on. */
  resumed?: boolean
}

/* ----------------------------------------------------------------------------------------------- */
/* The ops                                                                                           */
/* ----------------------------------------------------------------------------------------------- */

/** No arguments, or no answer but an empty object. */
type None = object

export interface AccountOps {
  /** Makes an account and signs in with it: answers the steps a sign-in does. */
  register: {
    args: { server: string; email: string; name: string; password: string; inviteToken?: string }
    result: SignInStep
  }

  moveStatus: { args: None; result: MoveStatus }
  /** Starts the move, or goes on with one that stopped; `choice` answers the removal guard's question. */
  moveStart: { args: { choice?: 'keep' | 'remove' }; result: MoveStatus }
  /** The person doesn't move after all: the held sign-in is ended. */
  moveCancel: { args: None; result: MoveStatus }

  devices: { args: None; result: { devices: DeviceView[] } }
  signOutDevice: { args: { deviceId: string }; result: None }
  approvals: { args: None; result: { approvals: ApprovalView[] } }
  approve: { args: { id: string }; result: None }
  deny: { args: { id: string }; result: None }

  emergency: { args: None; result: { trusted: GrantView[]; grantors: GrantView[] } }
  emergencyInvite: {
    args: { email: string; kind: EmergencyKind; waitDays: number }
    result: EmergencyGrant
  }
  emergencyRevoke: { args: { id: string }; result: None }
  /** A step that takes no body: the contact accepts or asks, the grantor approves or refuses. */
  emergencyStep: {
    args: { id: string; step: 'accept' | 'initiate' | 'approve' | 'reject' }
    result: EmergencyGrant
  }
  /** What the grantor compares before confirming: the contact's fingerprint, 12 groups of 5 digits. */
  emergencyContact: {
    args: { id: string }
    result: { name: string; kind: EmergencyKind; waitDays: number; fingerprint: string }
  }
  /** Seals the root key to the contact, if their fingerprint is still the one shown. */
  emergencyConfirm: { args: { id: string; fingerprint: string }; result: EmergencyGrant }
  /** The contact's side once approved: fetches the sealed key and says whether it opens. */
  emergencyKey: {
    args: { id: string }
    result: { grantorId: string; kind: EmergencyKind; opens: boolean }
  }

  recoveryKit: { args: None; result: { kit: KitRecord | null } }
  /** Mails the one-time code that proves the owner, which replacing a kit and the recovery code take. */
  proofRequest: { args: None; result: None }
  /** Makes a kit and holds it in the core: its pieces are shown once. */
  kitMake: { args: None; result: { kitId: string; pieces: string[] } }
  kitCancel: { args: None; result: None }
  /** Keeps the kit made, once one piece is typed back; `proof` replaces an old kit. */
  kitKeep: { args: { piece: string; proof?: string }; result: { kit: KitRecord | null } }
  kitRemove: { args: { proof: string }; result: None }

  twoStep: { args: None; result: TwoStepView }
  totpBegin: { args: None; result: { secret: string; uri: string } }
  totpConfirm: { args: { code: string; proof?: string }; result: None }
  emailBegin: { args: { address: string }; result: None }
  emailConfirm: { args: { address: string; code: string; proof?: string }; result: None }
  emailOff: { args: { proof: string }; result: None }
  /** The account's recovery code, or null when it has none; `proof` is a fresh proof that isn't the code. */
  recoveryCode: { args: { proof?: string }; result: { code: string | null } }
}

export type AccountOp = keyof AccountOps
export type AccountRequest = { [K in AccountOp]: { op: K } & AccountOps[K]['args'] }[AccountOp]
export type AccountResult<K extends AccountOp = AccountOp> = AccountOps[K]['result']

/* ----------------------------------------------------------------------------------------------- */
/* Validating a request                                                                              */
/* ----------------------------------------------------------------------------------------------- */

type Check = (value: unknown) => boolean
interface Field {
  check: Check
  optional: boolean
}

const text =
  (max: number, min = 0): Check =>
  (value) =>
    typeof value === 'string' && value.length >= min && value.length <= max
const oneOf =
  (...allowed: readonly string[]): Check =>
  (value) =>
    typeof value === 'string' && allowed.includes(value)
const int =
  (min: number, max: number): Check =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
/** An id the server or the core made: a UUID, or a kit's id. */
const id = text(64, 1)
/** A server address: an http or https URL; the core refuses http before anything is sent. */
const address: Check = (value) => {
  if (!text(2048, 1)(value)) return false
  try {
    const { protocol } = new URL(value as string)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
const req = (check: Check): Field => ({ check, optional: false })
const opt = (check: Check): Field => ({ check, optional: true })

/** A proof or a code a person types: short, and never empty when it is asked for. */
const proof = text(256, 1)

const specs: { [K in AccountOp]: Record<string, Field> } = {
  register: {
    server: req(address),
    email: req(text(320, 3)),
    name: req(text(200)),
    password: req(text(4096, 1)),
    inviteToken: opt(text(512, 1)),
  },
  moveStatus: {},
  moveStart: { choice: opt(oneOf('keep', 'remove')) },
  moveCancel: {},
  devices: {},
  signOutDevice: { deviceId: req(id) },
  approvals: {},
  approve: { id: req(id) },
  deny: { id: req(id) },
  emergency: {},
  emergencyInvite: {
    email: req(text(320, 3)),
    kind: req(oneOf('view', 'takeover')),
    waitDays: req(int(1, 90)),
  },
  emergencyRevoke: { id: req(id) },
  emergencyStep: { id: req(id), step: req(oneOf('accept', 'initiate', 'approve', 'reject')) },
  emergencyContact: { id: req(id) },
  emergencyConfirm: { id: req(id), fingerprint: req(text(100, 1)) },
  emergencyKey: { id: req(id) },
  recoveryKit: {},
  proofRequest: {},
  kitMake: {},
  kitCancel: {},
  kitKeep: { piece: req(text(300, 1)), proof: opt(proof) },
  kitRemove: { proof: req(proof) },
  twoStep: {},
  totpBegin: {},
  totpConfirm: { code: req(text(16, 1)), proof: opt(proof) },
  emailBegin: { address: req(text(320, 3)) },
  emailConfirm: { address: req(text(320, 3)), code: req(text(16, 1)), proof: opt(proof) },
  emailOff: { proof: req(proof) },
  recoveryCode: { proof: opt(proof) },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A fresh request of the op's own fields, or null when the op isn't one or a field is missing, of the wrong kind or too big. */
export function parseAccountRequest(raw: unknown): AccountRequest | null {
  if (!isRecord(raw) || typeof raw.op !== 'string' || !Object.hasOwn(specs, raw.op)) return null
  const spec = specs[raw.op as AccountOp]
  const out: Record<string, unknown> = { op: raw.op }
  for (const [name, field] of Object.entries(spec)) {
    const value = Object.hasOwn(raw, name) ? raw[name] : undefined
    if (value === undefined) {
      if (field.optional) continue
      return null
    }
    if (!field.check(value)) return null
    out[name] = value
  }
  return out as unknown as AccountRequest
}

/** Every op, for the tests and the fake core. */
export const accountOps = Object.keys(specs) as AccountOp[]
