// The menu asks the background what only an extension page may ask (src/shared/api.ts, PageApi).

import type { PageApi } from '../shared/api'

type Args<K extends keyof PageApi> = Parameters<PageApi[K]> extends [infer A] ? [A] : []

/** A request to the background; throws with the background's error when it answers with one. */
export async function ask<K extends keyof PageApi>(
  kind: K,
  ...args: Args<K>
): Promise<Awaited<ReturnType<PageApi[K]>>> {
  const answer = (await chrome.runtime.sendMessage({
    kind,
    ...((args[0] as object | undefined) ?? {}),
  })) as { ok: true; value: unknown } | { ok: false; error: string } | undefined
  if (answer === undefined) throw new Error('no answer')
  if (!answer.ok) throw new Error(answer.error)
  return answer.value as Awaited<ReturnType<PageApi[K]>>
}
