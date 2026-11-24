import { describe, expect, it } from 'vitest'
import { badgeSize, boundsOf, placeBadge, placeMenu, placePrompt } from './place'

const viewport = { width: 1000, height: 700 }

describe('placeBadge', () => {
  it('sits inside the field at its right edge, centred up and down', () => {
    const box = placeBadge({ left: 100, top: 200, width: 300, height: 40 })!
    expect(box.width).toBe(badgeSize(40))
    expect(box.left + box.width).toBe(100 + 300 - 6)
    expect(box.top + box.height / 2).toBe(220)
  })

  it('gives a field that is too narrow or too short no button', () => {
    expect(placeBadge({ left: 0, top: 0, width: 60, height: 30 })).toBeNull()
    expect(placeBadge({ left: 0, top: 0, width: 200, height: 10 })).toBeNull()
  })

  it('puts the button past the last box of a code in boxes', () => {
    const box = placeBadge({ left: 100, top: 50, width: 200, height: 40 }, true)!
    expect(box.left).toBe(304)
  })

  it('bounds a row of boxes from the first to the last', () => {
    expect(
      boundsOf([
        { left: 10, top: 10, width: 20, height: 30 },
        { left: 40, top: 12, width: 20, height: 30 },
      ]),
    ).toEqual({ left: 10, top: 10, width: 50, height: 32 })
  })
})

describe('placeMenu', () => {
  const size = { width: 320, height: 200 }

  it('opens under the field, aligned with its left edge', () => {
    const box = placeMenu({ left: 50, top: 100, width: 300, height: 30 }, size, viewport)
    expect(box).toEqual({ left: 50, top: 134, width: 320, height: 200 })
  })

  it('opens above when there is no room below and more above', () => {
    const box = placeMenu({ left: 50, top: 600, width: 300, height: 30 }, size, viewport)
    expect(box.top).toBe(600 - 4 - 200)
  })

  it('stays inside the viewport', () => {
    const box = placeMenu({ left: 900, top: 100, width: 300, height: 30 }, size, viewport)
    expect(box.left + box.width).toBeLessThanOrEqual(viewport.width - 4)
    const narrow = placeMenu({ left: 0, top: 0, width: 100, height: 30 }, size, {
      width: 200,
      height: 700,
    })
    expect(narrow.width).toBe(192)
  })
})

describe('placePrompt', () => {
  it('sits at the top right', () => {
    expect(placePrompt({ width: 340, height: 170 }, viewport)).toEqual({
      left: 1000 - 340 - 16,
      top: 16,
      width: 340,
      height: 170,
    })
  })
})
