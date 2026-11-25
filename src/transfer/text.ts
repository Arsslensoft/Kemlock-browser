// The transfer tab's strings: the browser's messages (locales/parts/transfer.<lang>.json), with a plural by the language's rule.
import type { TransferFormat, TransferKind } from '../shared/transfer'
import { hasMessage, t } from '../shared/ui/i18n'
import { AskError } from './send'

/** What went wrong, in words: the background's word by its name in the strings, else a general line. */
export function errorLine(error: unknown): string {
  const code = error instanceof AskError ? error.code : 'failed'
  const name = `transfer_error_${code}`
  return hasMessage(name) ? t(name) : t('transfer_error_failed')
}

/** `<name>_one` or `<name>_other` by the language's plural rule, given the count as the first substitution. */
export function tCount(name: string, count: number): string {
  let language = 'en'
  try {
    language = chrome.i18n.getUILanguage()
  } catch {
    // The page's own language, English
  }
  let form = count === 1 ? 'one' : 'other'
  try {
    form = new Intl.PluralRules(language).select(count) === 'one' ? 'one' : 'other'
  } catch {
    // An unknown language: English's rule above
  }
  return t(`${name}_${form}`, count)
}

/** What a kind of item is called. */
export const kindLabel = (kind: TransferKind): string => t(`transfer_kind_${kind}`)

/** What a format is called, with the app that made it when a Credential Exchange file names one. */
export function formatLabel(format: TransferFormat, exporter?: string): string {
  const name = t(`transfer_format_${format}`)
  return format === 'cxf' && exporter !== undefined && exporter !== ''
    ? t('transfer_format_from', name, exporter)
    : name
}
