// What the keys screens hold: the vault's keys and contacts as the background shows them (no secret).
import type { ContactView, KeyView } from '../../shared/keys-api'
import { errorMessage, hasMessage, t } from '../../shared/ui/i18n'
import { ask } from '../send'

export interface KeysData {
  keys: KeyView[]
  contacts: ContactView[]
  /** Asks the background again, after a change. */
  reload: () => Promise<void>
}

export async function loadKeys(): Promise<Pick<KeysData, 'keys' | 'contacts'>> {
  const [keys, contacts] = await Promise.all([ask('keys'), ask('contacts')])
  return { keys, contacts }
}

/** The word of an error, for a screen that acts on one (a passphrase to ask for). */
export const wordOf = (error: unknown): string => (error instanceof Error ? error.message : '')

/** A failure that a passphrase mends: a key that needs one (a PGP key protected in part says so only when it is used), or a wrong one. */
export const wantsPassphrase = (error: unknown): boolean =>
  wordOf(error) === 'pgpPassphraseNeeded' || wordOf(error) === 'pgpWrongPassphrase'

/**
 * What went wrong, in words: the core's code words (`keyPassphraseNeeded`, `pgpNoKeyOpensIt`, ...) by their messages, the
 * background's by the popup's own.
 */
export function keysError(error: unknown): string {
  const word = wordOf(error)
  const name = `keys_error_${word}`
  return /^\w{1,60}$/.test(word) && hasMessage(name) ? t(name) : errorMessage(error)
}
