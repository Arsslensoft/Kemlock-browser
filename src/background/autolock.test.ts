import { describe, expect, it } from 'vitest'
import {
  AutoLock,
  beatAlarm,
  idleAlarm,
  idleChoices,
  type AutoLockHost,
  type AutoLockSettings,
  type IdleMinutes,
  type LockReason,
} from './autolock'

const minute = 60_000

/** The browser as the auto-lock sees it, with a clock the test moves. */
class FakeBrowser implements AutoLockHost {
  time = 1_800_000_000_000
  alarms = new Map<string, { at: number; period?: number }>()
  session = new Map<string, unknown>()

  now = () => this.time
  setAlarm = async (name: string, alarm: { when: number } | { periodInMinutes: number }) => {
    this.alarms.set(
      name,
      'when' in alarm
        ? { at: alarm.when }
        : { at: this.time + alarm.periodInMinutes * minute, period: alarm.periodInMinutes },
    )
  }
  clearAlarm = async (name: string) => {
    this.alarms.delete(name)
  }
  readSession = async (key: string) => structuredClone(this.session.get(key))
  writeSession = async (key: string, value: unknown) => {
    this.session.set(key, structuredClone(value))
  }
  removeSession = async (key: string) => {
    this.session.delete(key)
  }
}

interface Setup {
  browser: FakeBrowser
  autoLock: AutoLock
  locks: LockReason[]
  settings: AutoLockSettings
}

function setUp(settings: Partial<AutoLockSettings> = {}, browser = new FakeBrowser()): Setup {
  const s: AutoLockSettings = { idleMinutes: 5, lockOnSleep: true, ...settings }
  const locks: LockReason[] = []
  const autoLock = new AutoLock(
    browser,
    async () => s,
    async (reason) => {
      locks.push(reason)
    },
  )
  return { browser, autoLock, locks, settings: s }
}

/** Moves the clock as time passes while awake, firing each alarm when due. */
async function pass(setup: Setup, ms: number) {
  const end = setup.browser.time + ms
  for (;;) {
    const due = [...setup.browser.alarms]
      .filter(([, a]) => a.at <= end)
      .sort(([, a], [, b]) => a.at - b.at)[0]
    if (due === undefined) break
    const [name, alarm] = due
    setup.browser.time = alarm.at
    if (alarm.period)
      setup.browser.alarms.set(name, { at: alarm.at + alarm.period * minute, period: alarm.period })
    else setup.browser.alarms.delete(name)
    await setup.autoLock.alarm(name)
  }
  setup.browser.time = end
}

/** The computer sleeps for [ms]: no alarm fires until it wakes, then each overdue one fires once. */
async function sleep(setup: Setup, ms: number) {
  setup.browser.time += ms
  for (const [name, alarm] of [...setup.browser.alarms].sort(([, a], [, b]) => a.at - b.at)) {
    if (alarm.at > setup.browser.time || !setup.browser.alarms.has(name)) continue
    if (alarm.period)
      setup.browser.alarms.set(name, {
        at: setup.browser.time + alarm.period * minute,
        period: alarm.period,
      })
    else setup.browser.alarms.delete(name)
    await setup.autoLock.alarm(name)
  }
}

describe('the idle time', () => {
  for (const idleMinutes of idleChoices) {
    it(`locks after ${idleMinutes} minute(s) without Kemlock being used`, async () => {
      const setup = setUp({ idleMinutes: idleMinutes as IdleMinutes })
      await setup.autoLock.unlocked()
      await pass(setup, idleMinutes * minute - 1000)
      expect(setup.locks).toEqual([])
      await pass(setup, 1000)
      expect(setup.locks).toEqual(['idle'])
    })
  }

  it('starts over when Kemlock is used', async () => {
    const setup = setUp({ idleMinutes: 5 })
    await setup.autoLock.unlocked()
    await pass(setup, 4 * minute)
    await setup.autoLock.used()
    await pass(setup, 4 * minute)
    expect(setup.locks).toEqual([])
    await setup.autoLock.used()
    await pass(setup, 4 * minute + 59_000)
    expect(setup.locks).toEqual([])
    await pass(setup, 1000)
    expect(setup.locks).toEqual(['idle'])
  })

  it('takes a new setting at the next use', async () => {
    const setup = setUp({ idleMinutes: 60 })
    await setup.autoLock.unlocked()
    await pass(setup, 10 * minute)
    setup.settings.idleMinutes = 1
    await setup.autoLock.used()
    await pass(setup, minute)
    expect(setup.locks).toEqual(['idle'])
  })

  it('keeps counting across a background the browser stopped and woke', async () => {
    const first = setUp({ idleMinutes: 15 })
    await first.autoLock.unlocked()
    await pass(first, 10 * minute)
    // A new background, as after the service worker was stopped: only storage.session remains
    const woken = setUp({ idleMinutes: 15 }, first.browser)
    await pass(woken, 5 * minute)
    expect(woken.locks).toEqual(['idle'])
  })
})

describe('a locked screen', () => {
  it('locks the vault', async () => {
    const setup = setUp()
    await setup.autoLock.unlocked()
    await setup.autoLock.idleState('locked')
    expect(setup.locks).toEqual(['screen'])
  })

  it("doesn't lock it while locking on sleep is off", async () => {
    const setup = setUp({ lockOnSleep: false })
    await setup.autoLock.unlocked()
    await setup.autoLock.idleState('locked')
    expect(setup.locks).toEqual([])
  })

  it("isn't the system being idle, which isn't Kemlock's idle time", async () => {
    const setup = setUp()
    await setup.autoLock.unlocked()
    await setup.autoLock.idleState('idle')
    await setup.autoLock.idleState('active')
    expect(setup.locks).toEqual([])
  })
})

describe('a sleep', () => {
  it('locks the vault when the computer wakes, however short the idle time left', async () => {
    const setup = setUp({ idleMinutes: 60 })
    await setup.autoLock.unlocked()
    await pass(setup, 2 * minute)
    await sleep(setup, 10 * minute)
    expect(setup.locks).toEqual(['sleep'])
  })

  it('leaves it to the idle time while locking on sleep is off', async () => {
    const setup = setUp({ idleMinutes: 15, lockOnSleep: false })
    await setup.autoLock.unlocked()
    await sleep(setup, 10 * minute)
    expect(setup.locks).toEqual([])
    await pass(setup, 5 * minute)
    expect(setup.locks).toEqual(['idle'])
  })

  it('locks at once on waking past the idle time, even with locking on sleep off', async () => {
    const setup = setUp({ idleMinutes: 5, lockOnSleep: false })
    await setup.autoLock.unlocked()
    await sleep(setup, 30 * minute)
    expect(setup.locks).toEqual(['idle'])
  })
})

describe('once locked', () => {
  it('watches nothing more until the vault opens again', async () => {
    const setup = setUp({ idleMinutes: 1 })
    await setup.autoLock.unlocked()
    await pass(setup, minute)
    expect(setup.locks).toEqual(['idle'])
    expect(setup.browser.alarms.size).toBe(0)
    expect(setup.browser.session.size).toBe(0)
    await setup.autoLock.used()
    await setup.autoLock.idleState('locked')
    await setup.autoLock.alarm(idleAlarm)
    await setup.autoLock.alarm(beatAlarm)
    expect(setup.locks).toEqual(['idle'])
  })

  it('locks once, whatever comes first', async () => {
    const setup = setUp({ idleMinutes: 1 })
    await setup.autoLock.unlocked()
    await setup.autoLock.idleState('locked')
    await pass(setup, 5 * minute)
    expect(setup.locks).toEqual(['screen'])
  })

  it('sets nothing when the vault locks by hand', async () => {
    const setup = setUp()
    await setup.autoLock.unlocked()
    await setup.autoLock.locked()
    await pass(setup, 60 * minute)
    expect(setup.locks).toEqual([])
    expect(setup.browser.alarms.size).toBe(0)
  })
})
