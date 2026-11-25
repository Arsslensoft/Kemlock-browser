// When sync runs (design decision 12): an alarm every five minutes while the vault is unlocked, on
// unlock, ten seconds after a change made in the browser, and Sync now. A problem stops the runs
// that nobody asked for, and puts the warning dot on the toolbar icon.
import type { CoreApi, SyncStatus } from '../shared/api'
import { approvalsAlarm } from './account'
import type { Toolbar } from './toolbar'

export const syncAlarm = 'kemlock-sync'
export const syncSoonAlarm = 'kemlock-sync-soon'
const dueKey = 'kemlock_sync_due'
const everyMinutes = 5
const afterChangeMs = 10_000
/** Problems that may pass by themselves, so the five-minute run tries again; the others wait for the person. */
const passing = new Set(['network', 'server'])

export class SyncScheduler {
  private running: Promise<SyncStatus | null> | undefined

  constructor(
    private readonly core: CoreApi,
    private readonly toolbar: Toolbar,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The vault opened: the five-minute alarm, and a run now (not waited for). */
  async opened(): Promise<void> {
    await chrome.alarms.create(syncAlarm, { periodInMinutes: everyMinutes })
    await chrome.alarms.create(approvalsAlarm, { periodInMinutes: 1 })
    void this.run()
  }

  /** The vault is open again after the worker was stopped: the alarm is still there. */
  async restored(): Promise<void> {
    await chrome.alarms.create(syncAlarm, { periodInMinutes: everyMinutes })
    await chrome.alarms.create(approvalsAlarm, { periodInMinutes: 1 })
    await this.showIcon()
  }

  /** The vault locked: no sync while it is. */
  async closed(): Promise<void> {
    await chrome.alarms.clear(syncAlarm)
    await chrome.alarms.clear(syncSoonAlarm)
    await chrome.alarms.clear(approvalsAlarm)
    await chrome.storage.session.remove(dueKey)
  }

  /** Something changed in the browser: sync in ten seconds. */
  async changed(): Promise<void> {
    const due = this.now() + afterChangeMs
    await chrome.storage.session.set({ [dueKey]: due })
    // A timer for the ten seconds, and an alarm for a worker stopped meanwhile (never sooner than
    // half a minute)
    setTimeout(() => void this.runDue(), afterChangeMs)
    await chrome.alarms.create(syncSoonAlarm, { when: due })
  }

  async alarm(name: string): Promise<void> {
    if (name === syncAlarm) await this.run()
    else if (name === syncSoonAlarm) await this.runDue()
  }

  private async runDue(): Promise<void> {
    const due = (await chrome.storage.session.get(dueKey))[dueKey]
    if (typeof due !== 'number' || this.now() < due - 500) return
    await chrome.storage.session.remove(dueKey)
    await chrome.alarms.clear(syncSoonAlarm)
    await this.run()
  }

  /**
   * One run at a time. `asked` is Sync now (or a sign-in): it runs even after a problem. Null when
   * the vault is locked or sync isn't set up.
   */
  run(asked = false): Promise<SyncStatus | null> {
    this.running ??= this.runOnce(asked).finally(() => {
      this.running = undefined
    })
    return this.running
  }

  /** Waits for the run in progress, if any. */
  async idle(): Promise<void> {
    await this.running?.catch(() => undefined)
  }

  private async runOnce(asked: boolean): Promise<SyncStatus | null> {
    const state = await this.core.state()
    if (!state.unlocked) return null
    const status = await this.core.syncStatus()
    if (status === null) return null
    if (!asked && status.problem !== undefined && !passing.has(status.problem)) {
      await this.toolbar.setIcon('sync-stopped')
      return status
    }
    let result: SyncStatus
    try {
      result = await this.core.syncNow()
    } catch {
      result = { ...status, running: false, problem: 'network' }
    }
    await this.toolbar.setIcon(result.problem === undefined ? 'unlocked' : 'sync-stopped')
    return result
  }

  /** The icon for an open vault: with the dot while sync is stopped. */
  async showIcon(): Promise<void> {
    const status = await this.core.syncStatus().catch(() => null)
    await this.toolbar.setIcon(status?.problem === undefined ? 'unlocked' : 'sync-stopped')
  }
}
