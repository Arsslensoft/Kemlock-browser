import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lockedMessage } from '../shared/vault-lock'
import { harness, useClock, type Harness } from './test/harness'

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

describe('telling the pages the vault locked', () => {
  it('broadcasts it when the vault locks, so a page wipes what it holds', async () => {
    h.mock.runtimeMessages.length = 0
    await h.ok({ kind: 'lock' })
    expect(h.mock.runtimeMessages).toContainEqual(lockedMessage)
    expect(h.mock.runtimeMessages.filter((m) => 'kemlock' in (m as object))).toHaveLength(1)
  })

  it('broadcasts it when the vault is removed from the browser', async () => {
    h.mock.runtimeMessages.length = 0
    await h.ok({ kind: 'removeVault' })
    expect(h.mock.runtimeMessages).toContainEqual(lockedMessage)
  })

  it('says nothing while the vault stays open', async () => {
    expect(h.mock.runtimeMessages).not.toContainEqual(lockedMessage)
  })
})
