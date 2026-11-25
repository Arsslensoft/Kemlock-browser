// What the account page works out from what the background answers, with no page in it, so it is tested alone.
import type {
  ApprovalView,
  EmergencyGrant,
  EmergencyState,
  MoveStatus,
  TwoStepView,
} from '../shared/account'

/** Whole days left of a wait, from the grant's due time (the server's RFC 3339 text); 0 when it has passed, null without one. */
export function daysLeft(dueAt: string | null, now: number): number | null {
  if (dueAt === null) return null
  const due = Date.parse(dueAt)
  if (Number.isNaN(due)) return null
  return Math.max(0, Math.ceil((due - now) / 86_400_000))
}

/** How long ago, in the coarsest whole unit that isn't zero, in the names Intl.RelativeTimeFormat takes. */
export function ageOf(seconds: number): {
  unit: 'second' | 'minute' | 'hour' | 'day'
  count: number
} {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return { unit: 'second', count: s }
  if (s < 3600) return { unit: 'minute', count: Math.floor(s / 60) }
  if (s < 86_400) return { unit: 'hour', count: Math.floor(s / 3600) }
  return { unit: 'day', count: Math.floor(s / 86_400) }
}

/** A Recovery Kit piece with its long share in groups of four, for print and for reading aloud (the web vault's `displayPiece`). */
export function displayPiece(text: string): string {
  const parts = text.split('-')
  if (parts.length !== 5) return text
  parts[3] = parts[3].match(/.{1,4}/g)?.join(' ') ?? ''
  return parts.join('-')
}

/** A piece as it is compared: upper case, no spaces. */
export function normalizePiece(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase()
}

/** Whether what was typed is one of the pieces, ignoring case and spaces. */
export function isOneOf(typed: string, pieces: readonly string[]): boolean {
  const wanted = normalizePiece(typed)
  return wanted !== '' && pieces.some((piece) => normalizePiece(piece) === wanted)
}

/** The secret of an authenticator app in groups of four, easier to type from a screen. */
export function groupSecret(secret: string): string {
  return secret
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim()
}

/** What the person can do with a grant they made, by its state. */
export function grantorActions(state: EmergencyState): ('confirm' | 'approve' | 'reject')[] {
  switch (state) {
    case 'accepted':
      return ['confirm']
    case 'recovery-initiated':
      return ['approve', 'reject']
    default:
      return []
  }
}

/** What the person can do with a grant that names them, by its state. */
export function contactAction(state: EmergencyState): 'accept' | 'ask' | 'key' | null {
  switch (state) {
    case 'invited':
      return 'accept'
    case 'confirmed':
    case 'rejected':
      return 'ask'
    case 'approved':
      return 'key'
    default:
      return null
  }
}

/** Whether a request may be approved here: the core worked out its words and the server's agree. */
export function canApprove(approval: ApprovalView): boolean {
  return approval.canApprove && approval.agrees && approval.phrase !== null
}

/** Whether a second step is on, so a change needs a fresh proof. */
export function otherStepOn(view: TwoStepView, method: string): boolean {
  return view.methods.some((entry) => entry.enabled && entry.method !== method)
}

/** Whether any second step is on. */
export function anyStepOn(view: TwoStepView): boolean {
  return view.methods.some((entry) => entry.enabled)
}

/** The move's progress as a fraction of its current step, or null when it has no count. */
export function moveFraction(status: MoveStatus): number | null {
  return status.total > 0 ? Math.min(1, status.done / status.total) : null
}

/** The order the move's steps go in, for "step 2 of 5". */
export const moveSteps = ['sync', 'copy', 'files', 'check', 'oldStore'] as const

/** Where a step stands in the order: 1 to 5, or 0 for the end. */
export function moveStepNumber(step: MoveStatus['step']): number {
  if (step === undefined || step === 'done') return 0
  return moveSteps.indexOf(step) + 1
}

/** The grants of a list that wait on the person: a contact to confirm, or a request to answer. */
export function waitingOnMe(grants: { grant: EmergencyGrant }[]): number {
  return grants.filter(
    ({ grant }) => grant.state === 'accepted' || grant.state === 'recovery-initiated',
  ).length
}
