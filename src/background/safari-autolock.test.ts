// A browser with no idle API (Safari) locks on a locked screen from the beat of the auto-lock, by asking the host.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AutoLock,
  beatAlarm,
  idleAlarm,
  type AutoLockHost,
  type AutoLockSettings,
  type LockReason,
} from './autolock'
import { createBackground } from './background'
import { FakeCore } from './core/fake'
import { route } from './router'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'
import { MemoryClipboard, popup, self } from './test/harness'

const minute = 60_000

class FakeHost implements AutoLockHost {
  time = 1_800_000_000_000
  session = new Map<string, unknown>()
  alarms = new Set<string>()
  asked = 0
  locked: boolean | Error = false
  now = () => this.time
  setAlarm = async (name: string) => {
    this.alarms.add(name)
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
  screenLocked = async () => {
    this.asked += 1
    if (this.locked instanceof Error) throw this.locked
    return this.locked
  }
}

async function setUp(settings: Partial<AutoLockSettings> = {}) {
  const host = new FakeHost()
  const locks: LockReason[] = []
  const autoLock = new AutoLock(
    host,
    async () => ({ idleMinutes: 60, lockOnSleep: true, ...settings }),
    async (reason) => {
      locks.push(reason)
    },
  )
  await autoLock.unlocked()
  return { host, autoLock, locks }
}

/** The next minute's beat, with the machine awake all along. */
async function beat(setup: Awaited<ReturnType<typeof setUp>>) {
  setup.host.time += minute
  await setup.autoLock.alarm(beatAlarm)
}

describe('the screen lock where the browser has no idle API', () => {
  it('locks at the first beat after the screen locked', async () => {
    const setup = await setUp()
    await beat(setup)
    expect(setup.locks).toEqual([])
    setup.host.locked = true
    await beat(setup)
    expect(setup.locks).toEqual(['screen'])
    // Locking stopped the beat and forgot the times, as it does for any lock
    expect(setup.host.alarms.has(beatAlarm)).toBe(false)
    expect(setup.host.session.size).toBe(0)
  })

  it('does nothing when the person keeps the vault open through a sleep and a lock', async () => {
    const setup = await setUp({ lockOnSleep: false })
    setup.host.locked = true
    await beat(setup)
    expect(setup.locks).toEqual([])
    expect(setup.host.asked).toBe(0)
  })

  it('asks at the beat only, not at the idle alarm', async () => {
    const setup = await setUp()
    setup.host.locked = true
    setup.host.time += minute
    await setup.autoLock.alarm(idleAlarm)
    expect(setup.host.asked).toBe(0)
    expect(setup.locks).toEqual([])
  })

  it('goes on when the host cannot say', async () => {
    const setup = await setUp()
    setup.host.locked = new Error('the app did not answer')
    await beat(setup)
    expect(setup.locks).toEqual([])
    expect(setup.host.asked).toBe(1)
  })

  it('still locks for the idle time and for a sleep, which need no host', async () => {
    const idle = await setUp({ idleMinutes: 1 })
    await beat(idle)
    expect(idle.locks).toEqual(['idle'])
    const slept = await setUp()
    slept.host.time += 10 * minute
    await slept.autoLock.alarm(beatAlarm)
    expect(slept.locks).toEqual(['sleep'])
    expect(slept.host.asked).toBe(0)
  })

  it('is left out with no screenLocked: the other browsers hear it from idle', async () => {
    const host = new FakeHost()
    const bare: AutoLockHost = { ...host, screenLocked: undefined }
    const locks: LockReason[] = []
    const autoLock = new AutoLock(
      bare,
      async () => ({ idleMinutes: 60, lockOnSleep: true }),
      async (reason) => {
        locks.push(reason)
      },
    )
    await autoLock.unlocked()
    host.time += minute
    await autoLock.alarm(beatAlarm)
    expect(locks).toEqual([])
  })
})

describe('the background given a screenLocked', () => {
  let mock: ChromeMock
  beforeEach(() => {
    mock = installChromeMock()
  })
  afterEach(() => mock.uninstall())

  async function open(screenLocked?: () => Promise<boolean>) {
    const core = new FakeCore({ sample: true, now: () => Date.now() })
    const bg = await createBackground(core, {
      now: () => Date.now(),
      clipboard: new MemoryClipboard(),
      ...(screenLocked === undefined ? {} : { screenLocked }),
    })
    const unlock = { kind: 'unlock', password: 'correct horse' }
    const answer = await route(unlock, popup, self, bg.handlers)
    expect(answer.ok).toBe(true)
    expect((await core.state()).unlocked).toBe(true)
    return { bg, core }
  }

  it('locks the vault at the beat after the screen locked', async () => {
    let locked = false
    const { bg, core } = await open(async () => locked)
    await bg.onAlarm({ name: beatAlarm })
    expect((await core.state()).unlocked).toBe(true)
    locked = true
    await bg.onAlarm({ name: beatAlarm })
    expect((await core.state()).unlocked).toBe(false)
  })

  it('keeps the vault open at the beat with no screenLocked, as Chrome and Firefox do', async () => {
    const { bg, core } = await open()
    await bg.onAlarm({ name: beatAlarm })
    expect((await core.state()).unlocked).toBe(true)
  })
})
