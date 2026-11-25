// How the lists are put in order: pinned first, then the vault's own order (the app's custom sort), and the moves the order
// tool makes, which are the app's (`move` of its Codes page): swap with a neighbour inside the pinned or the other section, and
// save every id, the pinned first.

export interface Ordered {
  id: string
  order: number
  pinned?: boolean
}

/** Pinned items first, then by the vault's order. */
export function byPinnedThenOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => Number(b.pinned === true) - Number(a.pinned === true) || a.order - b.order,
  )
}

/** The ids with the item swapped with its neighbour `delta` places on in its section, or null when it is at the end. */
export function moved<T extends Ordered>(
  items: readonly T[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const sorted = byPinnedThenOrder(items)
  const item = sorted.find((held) => held.id === id)
  if (item === undefined) return null
  const pinned = item.pinned === true
  const section = sorted.filter((held) => (held.pinned === true) === pinned)
  const index = section.findIndex((held) => held.id === id)
  const target = index + delta
  if (target < 0 || target >= section.length) return null
  const next = [...section]
  next[index] = next[target]!
  next[target] = item
  const rest = sorted.filter((held) => (held.pinned === true) !== pinned)
  return (pinned ? [...next, ...rest] : [...rest, ...next]).map((held) => held.id)
}

/** The ids with `id` put where `before` is (dragging), inside the same section; null when it can't go there. */
export function dropped<T extends Ordered>(
  items: readonly T[],
  id: string,
  before: string,
): string[] | null {
  if (id === before) return null
  const sorted = byPinnedThenOrder(items)
  const item = sorted.find((held) => held.id === id)
  const target = sorted.find((held) => held.id === before)
  if (item === undefined || target === undefined) return null
  if ((item.pinned === true) !== (target.pinned === true)) return null
  const ids = sorted.map((held) => held.id).filter((held) => held !== id)
  ids.splice(ids.indexOf(before), 0, id)
  return ids
}
