// Strings come from the browser's _locales (locales/parts/setup.<lang>.json and the app's
// sync_problem_* words); a missing name shows as itself, which a test catches.

/** The message with its substitutions, in the order their `{names}` first appear in the text. */
export function t(name: string, ...subs: (string | number)[]): string {
  const text = chrome.i18n.getMessage(name, subs.map(String))
  return text === '' || text === undefined ? name : text
}

/** The message if the locale has it, else null. */
export function maybe(name: string): string | null {
  const text = chrome.i18n.getMessage(name)
  return text === '' || text === undefined ? null : text
}

/** `<name>_one` or `<name>_other` by the language's plural rule, given the count as {count}. */
export function tCount(name: string, count: number): string {
  const lang = chrome.i18n.getUILanguage?.() || 'en'
  let form = count === 1 ? 'one' : 'other'
  try {
    form = new Intl.PluralRules(lang).select(count) === 'one' ? 'one' : 'other'
  } catch {
    // an unknown language: English's rule above
  }
  return t(`${name}_${form}`, count)
}

/** A sync problem in the app's words (sync_problem_*), or the background's own message. */
export function problemText(problem: string, message?: string): string {
  return maybe(`sync_problem_${problem}`) ?? message ?? t('setup_error_unknown')
}
