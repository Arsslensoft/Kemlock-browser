// The vault's life in the browser (design decision 5): unlocked, its keys sealed by the core are kept
// in storage.session (memory only, trusted contexts only) so a stopped and restarted worker opens it
// again; locking clears them. Idle, screen lock and sleep end in `lock` too.
import type { CoreApi } from '../shared/api'
import type { ToContent } from '../shared/messages'
import type { AutoLock } from './autolock'
import { dropContentScripts } from './site-access'
import type { SyncScheduler } from './sync'
import type { TabStore } from './tabs'
import type { Toolbar } from './toolbar'

export const sessionKey = 'kemlock_session'

export class VaultSession {
  /** Set once, since the auto-lock needs `lock` and this needs the auto-lock. */
  autoLock: AutoLock | undefined

  constructor(
    private readonly core: CoreApi,
    private readonly toolbar: Toolbar,
    private readonly sync: SyncScheduler,
    private readonly tabs: TabStore,
  ) {}

  /** The worker started: takes the open vault back from the session, if there was one. */
  async restore(): Promise<void> {
    // The default already, said anyway: no content script may read the session
    await chrome.storage.session
      .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
      .catch(() => undefined)
    if ((await this.core.state()).unlocked) return this.sync.restored()
    const blob = (await chrome.storage.session.get(sessionKey))[sessionKey]
    if (typeof blob === 'string' && (await this.core.restoreSession(blob).catch(() => false))) {
      await this.sync.restored()
      return
    }
    await chrome.storage.session.remove(sessionKey)
    await this.toolbar.setIcon('locked')
  }

  /** The vault is open (created, unlocked): the session, the idle time, the icon and the first sync. */
  async opened(): Promise<void> {
    await chrome.storage.session.set({ [sessionKey]: await this.core.exportSession() })
    await this.autoLock?.unlocked()
    await this.toolbar.setIcon('unlocked')
    await this.sync.opened()
  }

  /** Locks at once: the keys, the alarms, every count and every open menu go. */
  async lock(): Promise<void> {
    const tabIds = await this.tabs.tabIds()
    try {
      await this.core.lock()
    } finally {
      await chrome.storage.session.remove(sessionKey)
      await this.autoLock?.locked()
      await this.sync.closed()
      await this.toolbar.setIcon('locked')
      await this.tabs.clearSecrets()
      await this.toolbar.clearBadges(await this.badgedTabs(tabIds))
      await this.closeMenus(tabIds)
    }
  }

  /** "Remove Kemlock from this browser": the vault, and everything the extension stored. */
  async removed(): Promise<void> {
    const tabIds = await this.tabs.tabIds()
    await this.core.removeVault()
    await this.autoLock?.locked()
    await this.sync.closed()
    await chrome.alarms.clearAll()
    await dropContentScripts().catch(() => undefined)
    await chrome.storage.local.clear()
    await chrome.storage.session.clear()
    await this.toolbar.setIcon('locked')
    await this.toolbar.clearBadges(await this.badgedTabs(tabIds))
    await this.closeMenus(tabIds)
  }

  /** Every tab that may show a count: those with frames, and the others the browser has. */
  private async badgedTabs(withFrames: number[]): Promise<number[]> {
    const open = await chrome.tabs.query({}).catch(() => [])
    return [
      ...new Set([...withFrames, ...open.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]))]),
    ]
  }

  private async closeMenus(tabIds: number[]): Promise<void> {
    const message: ToContent = { kind: 'closeMenus' }
    await Promise.all(
      tabIds.map((tabId) => chrome.tabs.sendMessage(tabId, message).catch(() => undefined)),
    )
  }
}
