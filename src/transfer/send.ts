// How the transfer tab asks the background: PageApi requests, `{ kind, ...args }` on runtime.sendMessage, answered with
// `Answer<T>` (src/shared/api.ts).
import type { Answer, PageApi } from '../shared/api'

/** The background refused or failed; `code` is its word for why ('locked', 'badPassword', 'importUnsupported', ...). */
export class AskError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'AskError'
    this.code = code
  }
}

/** The value the background answers with, or throws an AskError. */
export async function ask<K extends keyof PageApi>(
  kind: K,
  ...args: Parameters<PageApi[K]>
): Promise<Awaited<ReturnType<PageApi[K]>>> {
  let answer: Answer<Awaited<ReturnType<PageApi[K]>>> | undefined
  try {
    answer = (await chrome.runtime.sendMessage({ kind, ...(args[0] ?? {}) })) as
      Answer<Awaited<ReturnType<PageApi[K]>>> | undefined
  } catch {
    throw new AskError('failed')
  }
  if (answer === undefined || answer === null || typeof answer !== 'object' || !('ok' in answer))
    throw new AskError('failed')
  if (!answer.ok) throw new AskError(String(answer.error))
  return answer.value
}
