// Words and small helpers the spaces' screens share (docs/plans/add-spaces.md).
import type { SpaceItemKind, SpaceRow } from '../shared/spaces-api'
import { errorMessage, hasMessage, t } from '../shared/ui/i18n'

/** What a failed request says, in words: the core's `space_*` codes by name, anything else as the popup says it. */
export function spaceError(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const name = `spaces_err_${code.replace(/^space_/, '')}`
  if (/^space_[\w]+$/.test(code) && hasMessage(name)) return t(name)
  return errorMessage(error)
}

/** The row's status in words: the role, or what the space is waiting for. */
export function statusText(row: Pick<SpaceRow, 'status'>): string {
  const name = `spaces_status_${row.status}`
  return hasMessage(name) ? t(name) : row.status
}

/** The order the kinds of item are listed in, and the string of each. */
export const kindOrder: readonly SpaceItemKind[] = [
  'login',
  'code',
  'backupCodes',
  'note',
  'card',
  'identity',
  'key',
]

export const kindText: Record<SpaceItemKind, string> = {
  login: 'spaces_kindLogin',
  code: 'spaces_kindCode',
  backupCodes: 'spaces_kindBackupCodes',
  note: 'spaces_kindNote',
  card: 'spaces_kindCard',
  identity: 'spaces_kindIdentity',
  key: 'spaces_kindKey',
}

/** A sync problem of a space in the app's words, or the popup's general line. */
export function problemText(problem: string): string {
  const name = `sync_problem_${problem}`
  return hasMessage(name) ? t(name) : t('popup_problemOther')
}

/** A fingerprint (12 groups of 5 digits) as rows of four groups. */
export function digitRows(digits: string): string[][] {
  const groups = digits.split(' ').filter((group) => group !== '')
  const rows: string[][] = []
  for (let start = 0; start < groups.length; start += 4) rows.push(groups.slice(start, start + 4))
  return rows
}

/** Whether the role name is one this popup words. */
export const roleText = (role: string): string => {
  const name = `spaces_role_${role}`
  return hasMessage(name) ? t(name) : role
}

/** A member's state in words (`spaces_member_*`). */
export const memberText = (status: string): string => {
  const name = `spaces_member_${status}`
  return hasMessage(name) ? t(name) : status
}
