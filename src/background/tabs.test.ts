import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'
import { TabStore, type FrameRecord, type PendingLogin } from './tabs'

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
})
afterEach(() => mock.uninstall())

const frame: FrameRecord = {
  url: 'https://a.example/',
  origin: 'https://a.example',
  address: 'https://a.example/',
  fields: [],
}
const pending: PendingLogin = {
  username: 'u',
  password: 'p',
  frameId: 0,
  address: 'https://a.example/',
  host: 'a.example',
  at: 1,
}

describe('TabStore', () => {
  it('keeps each tab apart, in session storage', async () => {
    const tabs = new TabStore()
    await tabs.update(1, (s) => void (s.frames[0] = frame))
    await tabs.update(2, (s) => void (s.pending = pending))
    expect(Object.keys((await tabs.get(1)).frames)).toEqual(['0'])
    expect((await tabs.get(2)).pending?.username).toBe('u')
    expect((await tabs.get(3)).frames).toEqual({})
    expect((await tabs.tabIds()).sort()).toEqual([1, 2])
    expect(mock.session.has('kemlock_tabs')).toBe(true)
  })

  it('does not lose a change when several come together', async () => {
    const tabs = new TabStore()
    await Promise.all(
      [0, 1, 2, 3, 4].map((id) =>
        tabs.update(1, (s) => void (s.frames[id] = { ...frame, url: `https://a.example/${id}` })),
      ),
    )
    expect(Object.keys((await tabs.get(1)).frames)).toHaveLength(5)
  })

  it('forgets frames, secrets and tabs', async () => {
    const tabs = new TabStore()
    await tabs.update(1, (s) => {
      s.frames[0] = frame
      s.menu = { frameId: 0, fieldId: 'f', at: 1 }
      s.pending = pending
    })
    await tabs.forgetFrames(1)
    expect(await tabs.get(1)).toMatchObject({ frames: {}, pending: { username: 'u' } })
    await tabs.update(1, (s) => void (s.frames[0] = frame))
    await tabs.clearSecrets()
    expect(await tabs.get(1)).toEqual({ frames: { 0: frame } })
    await tabs.remove(1)
    expect(await tabs.tabIds()).toEqual([])
    await tabs.update(5, (s) => void (s.frames[0] = frame))
    await tabs.clear()
    expect(await tabs.tabIds()).toEqual([])
  })
})
