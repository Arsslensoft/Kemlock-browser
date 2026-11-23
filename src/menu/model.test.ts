import { describe, expect, it } from 'vitest'
import { tileHue, tileLetter } from './model'

describe('the tile of an item', () => {
  it("takes the mockups' hue from the name, whatever its case", () => {
    expect(tileHue('Orbit Cloud')).toBe(tileHue('orbit cloud'))
    expect(tileHue('Orbit Cloud')).toBe(304)
    expect(tileHue('Proton')).toBe(349)
    expect(tileHue('Linear')).toBe(100)
  })

  it('shows the first letter in capitals, and a mark for no name', () => {
    expect(tileLetter('orbit cloud')).toBe('O')
    expect(tileLetter('  éclair')).toBe('É')
    expect(tileLetter('')).toBe('?')
  })
})
