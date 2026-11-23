// The popup's one way to the background: PageApi requests over runtime.sendMessage.
import type { Answer, PageApi } from '../shared/api'

/** The background refused or failed; the message is its code or its words. */
export class AskError extends Error {}

/** Fired on the window when the background says the vault is locked, so the popup shows the lock screen. */
export const lockedEvent = 'kemlock:locked'

type Args<K extends keyof PageApi> = Parameters<PageApi[K]>
type Result<K extends keyof PageApi> = Awaited<ReturnType<PageApi[K]>>

export async function ask<K extends keyof PageApi>(kind: K, ...args: Args<K>): Promise<Result<K>> {
  const body = { ...(((args as unknown[])[0] ?? {}) as object), kind }
  let answer: Answer<Result<K>> | undefined
  try {
    answer = (await chrome.runtime.sendMessage(body)) as Answer<Result<K>> | undefined
  } catch (error) {
    throw new AskError(error instanceof Error ? error.message : 'failed')
  }
  if (answer === undefined || answer === null) throw new AskError('failed')
  if (!answer.ok) {
    if (answer.error === 'locked') window.dispatchEvent(new Event(lockedEvent))
    throw new AskError(answer.error)
  }
  return answer.value
}
