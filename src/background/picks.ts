// "Always suggest here": the items the person picked on a host, remembered in this browser and never
// synced. The core seals them in the vault (`rememberPick` and the rest): there is no copy anywhere a
// page's script could read or write, and a locked core has none.
import type { CoreApi } from '../shared/api'

export function picksOn(core: CoreApi, host: string): Promise<string[]> {
  return core.picks(host)
}

export function rememberPick(core: CoreApi, host: string, itemId: string): Promise<void> {
  return core.rememberPick(host, itemId)
}

/** The hosts an item was picked on. */
export function pickedHosts(core: CoreApi, itemId: string): Promise<string[]> {
  return core.pickedHosts(itemId)
}

export function forgetPick(core: CoreApi, host: string, itemId: string): Promise<void> {
  return core.forgetPick(host, itemId)
}
