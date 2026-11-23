// The toolbar icon says the state (browser-popup spec): grey while locked, azure while unlocked, the
// count of the site's matching logins and codes, an orange "!" on a look-alike, and the icon with
// an orange dot while sync is stopped. Nothing of an item shows while locked.

export type IconState = 'locked' | 'unlocked' | 'sync-stopped'

/** The count's background, and the look-alike warning's. */
export const countColor = '#1559C7'
export const warningColor = '#9A4A06'

/** What the badge of one tab shows. */
export type BadgeState = { count: number } | { lookAlike: true } | null

const sizes = [16, 24, 32] as const

export class Toolbar {
  private icon: IconState | undefined

  get state(): IconState | undefined {
    return this.icon
  }

  async setIcon(state: IconState): Promise<void> {
    if (this.icon === state) return
    this.icon = state
    const path = Object.fromEntries(sizes.map((size) => [size, `icons/${state}-${size}.png`]))
    await chrome.action.setIcon({ path })
  }

  /** A tab's badge: blue count, orange "!", or nothing. */
  async setBadge(tabId: number, badge: BadgeState): Promise<void> {
    const text =
      badge === null ? '' : 'lookAlike' in badge ? '!' : badge.count > 0 ? String(badge.count) : ''
    await chrome.action.setBadgeText({ tabId, text })
    if (text === '' || badge === null) return
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: 'lookAlike' in badge ? warningColor : countColor,
    })
  }

  /** Locking: no tab shows a count. */
  async clearBadges(tabIds: Iterable<number>): Promise<void> {
    await Promise.all([...tabIds].map((tabId) => this.setBadge(tabId, null).catch(() => undefined)))
    await chrome.action.setBadgeText({ text: '' })
  }
}
