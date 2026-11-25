// What the tools say when the core refuses because what a page showed is not what the vault holds any more.
import { errorMessage, t } from '../../shared/ui/i18n'

/** The core's word for "this changed since you looked": a sync, or another page, got there first. */
export const staleWord = 'stale'

export const isStale = (error: unknown): boolean =>
  error instanceof Error && error.message === staleWord

/** What went wrong, in words: a change since the page looked is told as that, anything else as the popup tells it. */
export const toolsError = (error: unknown): string =>
  isStale(error) ? t('tools_stale') : errorMessage(error)

/** The same for the text a `useLoad` kept of an error. */
export const toolsLoadError = (text: string): string =>
  text === staleWord ? t('tools_stale') : text
