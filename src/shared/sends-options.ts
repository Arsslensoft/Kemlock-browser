// The options of a Send as the forms hold them, and how they become what the core takes (`NewSendInput`, `SendPatch`). The checks that
// matter are the core's own (Kemlock-core's `SendsService` refuses a deletion over 30 days, an expiry after it, an open limit under 1);
// these keep a form from offering what it would refuse.
import {
  sendDeleteDayChoices,
  type NewSendInput,
  type SendDetail,
  type SendKind,
  type SendPatch,
} from './sends'

export const dayMs = 24 * 3600_000

/** The form's state. `'keep'` is for an edit: the date the Send has stays. */
export interface OptionsDraft {
  deleteDays: number | 'keep'
  expiry: 'never' | 'keep' | number
  limited: boolean
  /** Typed, so it may be anything until it is checked. */
  maxAccess: string
  password: string
  passwordMode: 'keep' | 'change' | 'remove'
  hideEmail: boolean
  notes: string
}

/** A new Send: deleted in 7 days, no early expiry, no limit, no password, the email shown. */
export const newDraft = (): OptionsDraft => ({
  deleteDays: 7,
  expiry: 'never',
  limited: false,
  maxAccess: '',
  password: '',
  passwordMode: 'change',
  hideEmail: false,
  notes: '',
})

/** An edit starts from the Send as it is. */
export const draftOf = (send: SendDetail): OptionsDraft => ({
  deleteDays: 'keep',
  expiry: send.expiresAt === undefined ? 'never' : 'keep',
  limited: send.maxAccess !== undefined,
  maxAccess: send.maxAccess === undefined ? '' : String(send.maxAccess),
  password: '',
  passwordMode: send.hasPassword ? 'keep' : 'change',
  hideEmail: send.hideEmail,
  notes: send.notes ?? '',
})

/** The "Deletes after" choices, 1 to 30 days. */
export const deleteChoices: readonly number[] = sendDeleteDayChoices

/** The "Link stops working" choices, in days, for a Send deleted [deleteMs] from now: those that come before it. */
export function expiryChoices(deleteMs: number): number[] {
  return sendDeleteDayChoices.filter((days) => days * dayMs < deleteMs)
}

/**
 * How far ahead the Send is deleted once the draft is applied, in ms: the days chosen, or, while the date is kept, what is left of it
 * (a Send made 25 days ago is deleted in 5, not 30).
 */
export function deleteInMs(
  draft: OptionsDraft,
  was: Pick<SendDetail, 'deletionAt'> | undefined,
  now: number,
): number {
  if (draft.deleteDays !== 'keep') return draft.deleteDays * dayMs
  return Math.max(0, (was?.deletionAt ?? now) - now)
}

/** Whether the early expiry the Send has still comes before the deletion the draft gives it. */
export function keepsExpiry(
  draft: OptionsDraft,
  was: Pick<SendDetail, 'deletionAt' | 'expiresAt'> | undefined,
  now: number,
): boolean {
  return was?.expiresAt !== undefined && was.expiresAt <= now + deleteInMs(draft, was, now)
}

/**
 * The draft with an expiry that comes after its deletion put back to "not before it is deleted": a number of days that no longer
 * fits, or the date the Send has when the deletion now comes before it.
 */
export function fitExpiry(
  draft: OptionsDraft,
  was: Pick<SendDetail, 'deletionAt' | 'expiresAt'> | undefined,
  now: number,
): OptionsDraft {
  if (typeof draft.expiry === 'number')
    return draft.expiry * dayMs < deleteInMs(draft, was, now)
      ? draft
      : { ...draft, expiry: 'never' }
  if (draft.expiry === 'keep' && !keepsExpiry(draft, was, now)) return { ...draft, expiry: 'never' }
  return draft
}

/** The open limit typed: a whole number from [min], else null. */
export function parseMaxAccess(text: string, min = 1): number | null {
  const typed = text.trim()
  if (!/^\d{1,9}$/.test(typed)) return null
  const value = Number(typed)
  return value >= min ? value : null
}

/** What a new Send's form gives the core, or `maxAccess` when the open limit isn't a number from 1. */
export function newSendInput(
  fields: { kind: SendKind; name: string; text?: string; mime?: string },
  draft: OptionsDraft,
  now: number,
): NewSendInput | 'maxAccess' {
  let maxAccess: number | undefined
  if (draft.limited) {
    const parsed = parseMaxAccess(draft.maxAccess)
    if (parsed === null) return 'maxAccess'
    maxAccess = parsed
  }
  const days = draft.deleteDays === 'keep' ? 7 : draft.deleteDays
  return {
    kind: fields.kind,
    name: fields.name.trim(),
    ...(fields.kind === 'text' ? { text: fields.text ?? '' } : {}),
    ...(fields.kind === 'file' && fields.mime !== undefined && fields.mime !== ''
      ? { mime: fields.mime }
      : {}),
    notes: draft.notes,
    deleteInDays: days,
    ...(typeof draft.expiry === 'number' ? { expiresAt: now + draft.expiry * dayMs } : {}),
    ...(maxAccess === undefined ? {} : { maxAccess }),
    ...(draft.password === '' ? {} : { password: draft.password }),
    hideEmail: draft.hideEmail,
  }
}

/**
 * What an edit changes, from the Send as it was and the form: only what differs. `maxAccess` when the open limit isn't a number from
 * the opens used so far. A file Send's name never goes (its file and name can't change).
 */
export function sendPatch(
  was: SendDetail,
  fields: { name: string; text?: string },
  draft: OptionsDraft,
  now: number,
): SendPatch | 'maxAccess' {
  const patch: SendPatch = {}
  if (was.kind === 'text') {
    if (fields.name.trim() !== was.name) patch.name = fields.name.trim()
    if (fields.text !== undefined && fields.text !== was.text) patch.text = fields.text
  }
  if (draft.notes !== (was.notes ?? '')) patch.notes = draft.notes
  if (draft.deleteDays !== 'keep') patch.deletionAt = now + draft.deleteDays * dayMs
  if (draft.expiry === 'never') {
    if (was.expiresAt !== undefined) patch.expiresAt = null
  } else if (typeof draft.expiry === 'number') {
    patch.expiresAt = now + draft.expiry * dayMs
  }
  if (draft.limited) {
    const parsed = parseMaxAccess(draft.maxAccess, Math.max(1, was.accessCount))
    if (parsed === null) return 'maxAccess'
    if (parsed !== was.maxAccess) patch.maxAccess = parsed
  } else if (was.maxAccess !== undefined) {
    patch.maxAccess = null
  }
  if (draft.hideEmail !== was.hideEmail) patch.hideEmail = draft.hideEmail
  if (draft.passwordMode === 'remove' && was.hasPassword) patch.removePassword = true
  else if (draft.passwordMode === 'change' && draft.password !== '')
    patch.newPassword = draft.password
  return patch
}
