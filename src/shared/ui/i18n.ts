// Strings come from the browser's _locales (locales/parts/*.json and locales/app/*.json).

/** A message by its name, with its numbered placeholders; the name itself when it is missing. */
export function t(name: string, ...substitutions: (string | number)[]): string {
  const text = chrome.i18n.getMessage(name, substitutions.map(String))
  return text === '' || text === undefined ? name : text
}

/** True when the browser has a message of this name. */
export function hasMessage(name: string): boolean {
  const text = chrome.i18n.getMessage(name)
  return text !== '' && text !== undefined
}

/** A sync problem in the app's words (sync_problem_*), or a general line for one the app lacks. */
export function problemMessage(problem: string): string {
  const name = `sync_problem_${problem}`
  return hasMessage(name) ? t(name) : t('popup_problemOther')
}

function language(): string {
  try {
    return chrome.i18n.getUILanguage()
  } catch {
    return 'en'
  }
}

/** A date, as the browser's language writes it. */
export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(language(), { dateStyle: 'medium' }).format(new Date(ms))
}

/** A date and time, as the browser's language writes them. */
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(language(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ms),
  )
}

const knownErrors: Record<string, string> = {
  refused: 'popup_errorRefused',
  malformed: 'popup_errorFailed',
  unsupported: 'popup_errorFailed',
  failed: 'popup_errorFailed',
  locked: 'popup_errorLocked',
  // A card or an identity won't fill a frame or an http page without the person's confirmation in the field's menu
  confirm: 'items_errorConfirm',
  insecure: 'items_errorInsecure',
  unverified: 'items_errorUnverified',
}

/** What went wrong, in words: the background's codes by name, anything else as it said it. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (text === '') return t('popup_errorFailed')
  const known = knownErrors[text]
  return known === undefined ? text : t(known)
}
