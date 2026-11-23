import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'
import { countColor, Toolbar, warningColor } from './toolbar'

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
})
afterEach(() => mock.uninstall())

describe('Toolbar', () => {
  it('sets the icon once per state', async () => {
    const toolbar = new Toolbar()
    await toolbar.setIcon('locked')
    await toolbar.setIcon('locked')
    await toolbar.setIcon('unlocked')
    await toolbar.setIcon('sync-stopped')
    expect(mock.icons).toEqual([
      'icons/locked-16.png',
      'icons/unlocked-16.png',
      'icons/sync-stopped-16.png',
    ])
    expect(toolbar.state).toBe('sync-stopped')
  })

  it('shows the count on blue, an orange "!" on a look-alike, and nothing for none', async () => {
    const toolbar = new Toolbar()
    await toolbar.setBadge(3, { count: 2 })
    expect(mock.badgeText.get(3)).toBe('2')
    expect(mock.badgeColor.get(3)).toBe(countColor)
    expect(countColor).toBe('#1559C7')
    await toolbar.setBadge(3, { lookAlike: true })
    expect(mock.badgeText.get(3)).toBe('!')
    expect(mock.badgeColor.get(3)).toBe(warningColor)
    expect(warningColor).toBe('#9A4A06')
    await toolbar.setBadge(3, { count: 0 })
    expect(mock.badgeText.get(3)).toBe('')
    await toolbar.setBadge(3, null)
    expect(mock.badgeText.get(3)).toBe('')
  })

  it('clears every tab', async () => {
    const toolbar = new Toolbar()
    await toolbar.setBadge(1, { count: 1 })
    await toolbar.setBadge(2, { count: 1 })
    await toolbar.clearBadges([1, 2])
    expect([mock.badgeText.get(1), mock.badgeText.get(2), mock.badgeText.get(-1)]).toEqual([
      '',
      '',
      '',
    ])
  })
})
