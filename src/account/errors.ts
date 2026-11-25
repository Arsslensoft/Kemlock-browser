// What a failure says: the one code word the background or the core gave, in the account page's words.
import { hasMessage, t } from '../shared/ui/i18n'
import { codeOf } from './send'

/** The codes that mean the page can't be used as it stands: it shows a way forward instead of its panels. */
export const gateCodes: ReadonlySet<string> = new Set([
  'locked',
  'noVault',
  'notKemlock',
  'sessionEnded',
])

/** The words for [code], from `account_error_<code>`; a code the page has no words for says that something went wrong. */
export function describe(code: string): string {
  const name = `account_error_${code}`
  return hasMessage(name) ? t(name) : t('account_error_failed')
}

/** [work] with its failure put in the page's words, for `useLoad`, which shows an error's message as it is. */
export async function described<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    throw new Error(describe(codeOf(error)), { cause: error })
  }
}
