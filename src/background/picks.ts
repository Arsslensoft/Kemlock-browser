// "Always suggest here": the items the person picked on a host, remembered in this browser and never
// synced. The core keeps them sealed where it can (`rememberPick` and the rest); a core without them
// leaves the background an index in storage.local (hosts and item ids, nothing of an item).
import type { CoreApi } from '../shared/api'

const indexKey = 'kemlock_picks'
type Index = Record<string, string[]>

async function readIndex(): Promise<Index> {
  const stored = (await chrome.storage.local.get(indexKey))[indexKey]
  return typeof stored === 'object' && stored !== null ? (stored as Index) : {}
}

export async function picksOn(core: CoreApi, host: string): Promise<string[]> {
  if (core.picks !== undefined) return core.picks(host)
  return [...((await readIndex())[host] ?? [])]
}

export async function rememberPick(core: CoreApi, host: string, itemId: string): Promise<void> {
  if (core.rememberPick !== undefined) return core.rememberPick(host, itemId)
  const index = await readIndex()
  const ids = (index[host] ??= [])
  if (!ids.includes(itemId)) ids.push(itemId)
  await chrome.storage.local.set({ [indexKey]: index })
}

/** The hosts an item was picked on. */
export async function pickedHosts(core: CoreApi, itemId: string): Promise<string[]> {
  if (core.pickedHosts !== undefined) return core.pickedHosts(itemId)
  return Object.entries(await readIndex())
    .filter(([, ids]) => ids.includes(itemId))
    .map(([host]) => host)
    .sort()
}

export async function forgetPick(core: CoreApi, host: string, itemId: string): Promise<void> {
  if (core.forgetPick !== undefined) return core.forgetPick(host, itemId)
  const index = await readIndex()
  index[host] = (index[host] ?? []).filter((id) => id !== itemId)
  if (index[host].length === 0) delete index[host]
  await chrome.storage.local.set({ [indexKey]: index })
}
