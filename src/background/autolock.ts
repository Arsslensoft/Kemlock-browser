// When the open vault locks by itself (browser-vault spec): after the
// chosen time without Kemlock being used, when the screen locks, and when
// the computer sleeps. Times live in storage.session, so a background that
// the browser stopped and woke again still knows them (design decision 5).

/** The idle times the person can choose, in minutes. */
export const idleChoices = [1, 5, 15, 60] as const
export type IdleMinutes = (typeof idleChoices)[number]
export const defaultIdleMinutes: IdleMinutes = 5

export interface AutoLockSettings {
  idleMinutes: IdleMinutes
  /** "Lock when the computer sleeps", on by default. */
  lockOnSleep: boolean
}

export const defaultAutoLockSettings: AutoLockSettings = {
  idleMinutes: defaultIdleMinutes,
  lockOnSleep: true,
}

export type LockReason = 'idle' | 'screen' | 'sleep'

/** What the browser gives the auto-lock: a clock, alarms and session storage. */
export interface AutoLockHost {
  now(): number
  /** An alarm at a time, or one each so many minutes. */
  setAlarm(name: string, alarm: { when: number } | { periodInMinutes: number }): Promise<void>
  clearAlarm(name: string): Promise<void>
  readSession(key: string): Promise<unknown>
  writeSession(key: string, value: unknown): Promise<void>
  removeSession(key: string): Promise<void>
}

/** The alarm for the idle time, set again on each use. */
export const idleAlarm = 'kemlock-idle'
/** The alarm each minute that notices a sleep: it fires late after one. */
export const beatAlarm = 'kemlock-beat'
const stateKey = 'kemlock_autolock'
const minute = 60_000
/** A beat this late means the computer slept: it is due each minute. */
const sleepGap = 2.5 * minute

interface Times {
  lastUse: number
  lastBeat: number
}

const isTimes = (value: unknown): value is Times =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Times).lastUse === 'number' &&
  typeof (value as Times).lastBeat === 'number'

export class AutoLock {
  constructor(
    private readonly host: AutoLockHost,
    private readonly settings: () => Promise<AutoLockSettings>,
    private readonly lock: (reason: LockReason) => Promise<void>,
  ) {}

  /** The vault opened: the idle time starts, and the beat. */
  async unlocked(): Promise<void> {
    const now = this.host.now()
    await this.host.writeSession(stateKey, { lastUse: now, lastBeat: now } satisfies Times)
    await this.host.setAlarm(beatAlarm, { periodInMinutes: 1 })
    await this.schedule(now)
  }

  /** Kemlock was used (the popup, the menu, a fill): the idle time starts over. */
  async used(): Promise<void> {
    const times = await this.times()
    if (times === null) return
    const now = this.host.now()
    await this.host.writeSession(stateKey, { ...times, lastUse: now })
    await this.schedule(now)
  }

  /** The vault locked, by itself or not: nothing more to watch. */
  async locked(): Promise<void> {
    await this.host.clearAlarm(idleAlarm)
    await this.host.clearAlarm(beatAlarm)
    await this.host.removeSession(stateKey)
  }

  /** An alarm went off. */
  async alarm(name: string): Promise<void> {
    const times = await this.times()
    if (times === null) return
    const now = this.host.now()
    const { idleMinutes, lockOnSleep } = await this.settings()
    if (name === beatAlarm) {
      if (lockOnSleep && now - times.lastBeat > sleepGap) return this.lockFor('sleep')
      await this.host.writeSession(stateKey, { ...times, lastBeat: now })
    }
    if (now - times.lastUse >= idleMinutes * minute) return this.lockFor('idle')
    if (name === idleAlarm) await this.schedule(times.lastUse)
  }

  /** The system's idle state changed: `locked` is a locked screen. */
  async idleState(state: string): Promise<void> {
    if (state !== 'locked' || (await this.times()) === null) return
    if ((await this.settings()).lockOnSleep) await this.lockFor('screen')
  }

  private async lockFor(reason: LockReason): Promise<void> {
    await this.locked()
    await this.lock(reason)
  }

  private async schedule(lastUse: number): Promise<void> {
    const { idleMinutes } = await this.settings()
    await this.host.setAlarm(idleAlarm, { when: lastUse + idleMinutes * minute })
  }

  private async times(): Promise<Times | null> {
    const value = await this.host.readSession(stateKey)
    return isTimes(value) ? value : null
  }
}

/** The browser's alarms and session storage, for the auto-lock. */
export const chromeAutoLockHost: AutoLockHost = {
  now: () => Date.now(),
  setAlarm: (name, alarm) => chrome.alarms.create(name, alarm),
  clearAlarm: async (name) => {
    await chrome.alarms.clear(name)
  },
  readSession: async (key) => (await chrome.storage.session.get(key))[key],
  writeSession: (key, value) => chrome.storage.session.set({ [key]: value }),
  removeSession: (key) => chrome.storage.session.remove(key),
}

/**
 * Hands the browser's alarms and idle changes to [autoLock]. The listeners
 * are added at the background's start, as a woken service worker must.
 */
export function listenForAutoLock(autoLock: AutoLock): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === idleAlarm || alarm.name === beatAlarm) void autoLock.alarm(alarm.name)
  })
  chrome.idle.onStateChanged.addListener((state) => void autoLock.idleState(state))
}
