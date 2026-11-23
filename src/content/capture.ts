// Seeing a sign-in, sign-up or password change being sent (design decision 10): which values a form
// holds in the fields the rules found, and when a press on a button counts as sending it. The pair
// goes to the background at once, which decides whether to ask. Nothing here reads a field that
// isn't a login field, and nothing is kept: a value is read when the form is sent.

import type { Registry } from './scan'

/** What a form was sent with; `''` for what the form has no field for. */
export interface Sent {
  username: string
  /** The current password: a sign-in's, or the old one on a change form. */
  password: string
  /** A new password, from a sign-up or change form. */
  newPassword?: string
}

/** The registered fields that belong to [scope]: the form, or the whole frame for a form-less page. */
function within(scope: ParentNode | null, element: HTMLInputElement): boolean {
  if (scope === null) return true
  if (scope instanceof HTMLFormElement) return element.form === scope || scope.contains(element)
  return scope.contains(element)
}

/**
 * The values of the login fields in [scope] (a form, or an element holding a form-less sign-in).
 * Null when there is nothing worth sending: no password and no username, or empty values.
 */
export function readSent(registry: Registry, scope: ParentNode | null): Sent | null {
  let username = ''
  let password = ''
  let newPassword = ''
  for (const entry of registry.values()) {
    const input = entry.elements[0]
    if (input === undefined || !within(scope, input)) continue
    if (entry.kind === 'username') username = username || input.value
    else if (entry.kind === 'password') password = password || input.value
    else if (entry.kind === 'newPassword') newPassword = newPassword || input.value
  }
  if (password === '' && newPassword === '' && username === '') return null
  // A username alone is a sign-in's first step: only worth sending when a field says it is one
  return newPassword === '' ? { username, password } : { username, password, newPassword }
}

/** Whether a press on [target] may be a form being sent: a button or a submit, not a link or a field. */
export function sendsForm(target: Element): HTMLElement | null {
  const button = target.closest(
    'button, input[type=submit], input[type=button], input[type=image], [role=button]',
  )
  if (!(button instanceof HTMLElement)) return null
  if (button instanceof HTMLButtonElement && button.type === 'reset') return null
  return button
}

/** The form a button belongs to, if any. */
export function formOf(button: HTMLElement): HTMLFormElement | null {
  if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) return button.form
  return button.closest('form')
}

/** The same values twice in a row are one send. */
export function sameSent(a: Sent | null, b: Sent | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.username === b.username &&
    a.password === b.password &&
    (a.newPassword ?? '') === (b.newPassword ?? '')
  )
}
