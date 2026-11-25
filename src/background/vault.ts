// The vault's life in the browser (design decision 5): unlocked, its keys sealed by the core are kept
// in storage.session (memory only, trusted contexts only) so a stopped and restarted worker opens it
// again; locking clears them. Idle, screen lock and sleep end in `lock` too.
import type { CoreApi } from '../shared/api'
import type { ToContent } from '../shared/messages'
import { broadcastLocked } from '../shared/vault-lock'
import type { AutoLock } from './autolock'
import { limitSessionToTrusted } from '../shared/capabilities'
import { dropPasskeyScripts } from './passkey-scripts'
import { dropContentScripts } from './site-access'
import type { SyncScheduler } from './sync'
import type { TabStore } from './tabs'
import type { Toolbar } from './toolbar'

export const sessionKey = 'kemlock_session'

/** The IndexedDB database the core keeps the sign-in's device keys in (core/lib/src/js/device_keys.dart). */
export const deviceKeysDatabase = 'kemlock-device-keys'

/** Deletes the device keys' database; it never fails, and never waits on a connection that stays open. */
function deleteDeviceKeys(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(deviceKeysDatabase)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

export class VaultSession {
  /** Set once, since the auto-lock needs `lock` and this needs the auto-lock. */
  autoLock: AutoLock | undefined
  /**
   * Whether the session storage is known to be closed to content scripts. Where it isn't (Safari), the open vault's keys are
   * not kept in it, and the vault locks when the background unloads.
   */
  private sessionKept = false
  /** Said when the vault has locked, after the menus closed: the passkey requests that waited for the person end here. */
  afterLock: (() => Promise<void>) | undefined
  /** What the background holds in memory that came out of the vault (the text of a note on its way to the Sends tab): let go on a lock. */
  readonly forgetters = new Set<() => void>()

  constructor(
    private readonly core: CoreApi,
    private readonly toolbar: Toolbar,
    private readonly sync: SyncScheduler,
    private readonly tabs: TabStore,
  ) {}

  /** The worker started: takes the open vault back from the session, if there was one. */
  async restore(): Promise<void> {
    // No content script may read the session. Where the browser can't promise it (Safari), nothing is kept in it
    this.sessionKept = await limitSessionToTrusted()
    if ((await this.core.state()).unlocked) return this.sync.restored()
    const blob = this.sessionKept
      ? (await chrome.storage.session.get(sessionKey))[sessionKey]
      : undefined
    if (typeof blob === 'string' && (await this.core.restoreSession(blob).catch(() => false))) {
      await this.sync.restored()
      return
    }
    await chrome.storage.session.remove(sessionKey)
    await this.toolbar.setIcon('locked')
  }

  /** The vault is open (created, unlocked): the session, the idle time, the icon and the first sync. */
  async opened(): Promise<void> {
    if (this.sessionKept)
      await chrome.storage.session.set({ [sessionKey]: await this.core.exportSession() })
    await this.autoLock?.unlocked()
    await this.toolbar.setIcon('unlocked')
    await this.sync.opened()
  }

  /** Locks at once: the keys, the alarms, every count and every open menu go. */
  async lock(): Promise<void> {
    const tabIds = await this.tabs.tabIds()
    for (const forget of this.forgetters) forget()
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
      await this.afterLock?.().catch(() => undefined)
      // Pages that hold decrypted text wipe it
      await broadcastLocked()
    }
  }

  /** "Remove Kemlock from this browser": signs out of sync, then the vault, the device keys and everything the extension stored. */
  async removed(): Promise<void> {
    const tabIds = await this.tabs.tabIds()
    for (const forget of this.forgetters) forget()
    // The server learns this device is gone while the keys to say so are still here; if it can't be reached, it goes on
    await this.core.signOut().catch(() => undefined)
    await this.core.removeVault()
    await deleteDeviceKeys()
    await this.autoLock?.locked()
    await this.sync.closed()
    await chrome.alarms.clearAll()
    await dropContentScripts().catch(() => undefined)
    await dropPasskeyScripts().catch(() => undefined)
    await chrome.storage.local.clear()
    await chrome.storage.session.clear()
    await this.toolbar.setIcon('locked')
    await this.toolbar.clearBadges(await this.badgedTabs(tabIds))
    await this.closeMenus(tabIds)
    await broadcastLocked()
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
