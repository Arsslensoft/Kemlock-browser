import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCore } from './core/fake'
import { SyncScheduler, syncAlarm, syncSoonAlarm } from './sync'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'
import { useClock } from './test/harness'
import { Toolbar } from './toolbar'

let mock: ChromeMock
let core: FakeCore
let sync: SyncScheduler
const syncRuns = () => core.calls.filter((call) => call === 'syncNow').length

beforeEach(async () => {
  mock = installChromeMock()
  useClock()
  core = new FakeCore({ sample: true })
  await core.unlock('correct horse')
  await core.signInKemlock({ server: 'https://k.example', email: 'a@b.c', password: 'p' })
  sync = new SyncScheduler(core, new Toolbar())
})
afterEach(() => {
  vi.useRealTimers()
  mock.uninstall()
})

describe('SyncScheduler', () => {
  it('syncs on opening and every five minutes while unlocked, and not once locked', async () => {
    await sync.opened()
    await sync.idle()
    expect(syncRuns()).toBe(1)
    expect(mock.alarms.get(syncAlarm)).toEqual({ periodInMinutes: 5 })
    await sync.alarm(syncAlarm)
    expect(syncRuns()).toBe(2)
    await core.lock()
    await sync.closed()
    expect(mock.alarms.has(syncAlarm)).toBe(false)
    await sync.alarm(syncAlarm)
    expect(syncRuns()).toBe(2)
  })

  it('syncs ten seconds after a change, once for several', async () => {
    await sync.changed()
    await vi.advanceTimersByTimeAsync(4_000)
    await sync.changed()
    await vi.advanceTimersByTimeAsync(9_000)
    expect(syncRuns()).toBe(0)
    await vi.advanceTimersByTimeAsync(2_000)
    await sync.idle()
    expect(syncRuns()).toBe(1)
    // The first change's timer finds nothing due any more
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncRuns()).toBe(1)
    expect(mock.alarms.has(syncSoonAlarm)).toBe(false)
  })

  it('syncs from the alarm when the timer was lost with a stopped worker', async () => {
    await sync.changed()
    vi.setSystemTime(Date.now() + 31_000)
    await new SyncScheduler(core, new Toolbar()).alarm(syncSoonAlarm)
    expect(syncRuns()).toBe(1)
  })

  it('puts the warning dot on the icon while stopped, and takes it off', async () => {
    core.syncProblem = 'signedOut'
    await sync.run(true)
    expect(mock.icons.at(-1)).toBe('icons/sync-stopped-16.png')
    core.syncProblem = undefined
    await sync.run(true)
    expect(mock.icons.at(-1)).toBe('icons/unlocked-16.png')
  })

  it('does not go on by itself after a problem that needs the person, but Sync now does', async () => {
    core.syncProblem = 'signedOut'
    await sync.run(true)
    core.syncProblem = undefined
    const before = syncRuns()
    await sync.alarm(syncAlarm)
    expect(syncRuns()).toBe(before)
    await sync.run(true)
    expect(syncRuns()).toBe(before + 1)
  })

  it('tries again by itself after a network problem', async () => {
    const real = core.syncNow.bind(core)
    core.syncNow = async () => {
      throw new Error('offline')
    }
    expect(await sync.run(true)).toMatchObject({ problem: 'network' })
    core.syncNow = real
    await sync.run(true)
    expect((await core.syncStatus())?.problem).toBeUndefined()
  })

  it('runs one at a time, and not at all when locked or not set up', async () => {
    const first = sync.run()
    expect(sync.run()).toBe(first)
    await first
    await core.signOut()
    expect(await sync.run(true)).toBeNull()
    await core.lock()
    expect(await sync.run(true)).toBeNull()
  })
})
