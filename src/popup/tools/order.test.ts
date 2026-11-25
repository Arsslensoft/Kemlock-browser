import { describe, expect, it } from 'vitest'
import { byPinnedThenOrder, dropped, moved } from './order'

const item = (id: string, order: number, pinned?: boolean) => ({
  id,
  order,
  ...(pinned === undefined ? {} : { pinned }),
})

describe('the order of a list', () => {
  it('puts the pinned items first, then goes by the vault’s order', () => {
    const items = [item('c', 2), item('p', 5, true), item('a', 0), item('q', 1, true)]
    expect(byPinnedThenOrder(items).map((i) => i.id)).toEqual(['q', 'p', 'a', 'c'])
    // The list given is left as it was
    expect(items.map((i) => i.id)).toEqual(['c', 'p', 'a', 'q'])
  })

  it('moves an item one place, inside its own section, and saves every id with the pinned first', () => {
    const items = [item('a', 0), item('b', 1), item('c', 2), item('p', 3, true), item('q', 4, true)]
    expect(moved(items, 'b', -1)).toEqual(['p', 'q', 'b', 'a', 'c'])
    expect(moved(items, 'b', 1)).toEqual(['p', 'q', 'a', 'c', 'b'])
    expect(moved(items, 'q', -1)).toEqual(['q', 'p', 'a', 'b', 'c'])
  })

  it('cannot move the first item up, the last down, or an item that is not there', () => {
    const items = [item('a', 0), item('b', 1), item('p', 2, true)]
    expect(moved(items, 'a', -1)).toBeNull()
    expect(moved(items, 'b', 1)).toBeNull()
    // The pinned item is alone in its section: it can't pass an item that isn't pinned
    expect(moved(items, 'p', 1)).toBeNull()
    expect(moved(items, 'p', -1)).toBeNull()
    expect(moved(items, 'nobody', 1)).toBeNull()
  })

  it('drops an item before another of its section, and not into the other section', () => {
    const items = [item('a', 0), item('b', 1), item('c', 2), item('p', 3, true)]
    expect(dropped(items, 'c', 'a')).toEqual(['p', 'c', 'a', 'b'])
    expect(dropped(items, 'a', 'c')).toEqual(['p', 'b', 'a', 'c'])
    expect(dropped(items, 'a', 'a')).toBeNull()
    expect(dropped(items, 'a', 'p')).toBeNull()
    expect(dropped(items, 'a', 'nobody')).toBeNull()
  })
})
