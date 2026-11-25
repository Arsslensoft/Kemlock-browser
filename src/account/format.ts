// Words for what the page shows: how long ago, what kind a device is, how a date reads.
import { hasMessage, t } from '../shared/ui/i18n'
import { ageOf } from './model'

function language(): string {
  try {
    return chrome.i18n.getUILanguage()
  } catch {
    return 'en'
  }
}

/** "5 minutes ago", as the browser's language says it. */
export function relativeAge(seconds: number): string {
  const { unit, count } = ageOf(seconds)
  try {
    return new Intl.RelativeTimeFormat(language(), { numeric: 'auto' }).format(-count, unit)
  } catch {
    return `${count} ${unit}`
  }
}

/** A time in milliseconds since the epoch: "5 minutes ago" for a recent one, a date for an older one. */
export function lastSeen(ms: number | null | undefined, now: number): string {
  if (ms === null || ms === undefined) return t('account_never')
  const seconds = Math.max(0, (now - ms) / 1000)
  if (seconds < 7 * 86_400) return relativeAge(seconds)
  return new Intl.DateTimeFormat(language(), { dateStyle: 'medium' }).format(new Date(ms))
}

/** A date from the server's own RFC 3339 text. */
export function dateOf(text: string): string {
  const ms = Date.parse(text)
  if (Number.isNaN(ms)) return text
  return new Intl.DateTimeFormat(language(), { dateStyle: 'medium' }).format(new Date(ms))
}

/** What a device kind is called: the server's `kemlock-android`, `kemlock-browser`, and the others. */
export function kindName(kind: string): string {
  const name = `account_kind_${kind.replace(/^kemlock-/, '').replace(/[^a-z0-9]/gi, '')}`
  return hasMessage(name) ? t(name) : t('account_kind_other')
}
