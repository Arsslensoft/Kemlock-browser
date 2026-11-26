// pageState: whether the vault is open, for the extension's own pages that ask again when they come to the front (`useVaultLock`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultState } from '../shared/api'
import { content, harness, menuFrame, popup, setup, useClock, type Harness } from './test/harness'

const tab = (page: string) => ({
  id: 'kemlockid',
  url: `chrome-extension://kemlockid/src/${page}/index.html`,
  origin: 'chrome-extension://kemlockid',
})

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

describe('pageState', () => {
  it('says whether the vault is open to each of the extension’s pages that hold what they decrypt', async () => {
    for (const sender of [
      popup,
      setup,
      tab('account'),
      tab('unlock'),
      tab('sends'),
      tab('keys'),
      tab('transfer'),
      tab('files'),
    ])
      expect(await h.ok<VaultState>({ kind: 'pageState' }, sender)).toMatchObject({
        exists: true,
        unlocked: true,
      })
    await h.ok({ kind: 'lock' })
    expect(await h.ok<VaultState>({ kind: 'pageState' }, tab('sends'))).toMatchObject({
      unlocked: false,
    })
  })

  it('answers neither the menu frame in a web page nor a content script', async () => {
    expect(await h.send({ kind: 'pageState' }, menuFrame)).toEqual({ ok: false, error: 'refused' })
    expect(await h.send({ kind: 'pageState' }, content('https://orbit-cloud.com/'))).toEqual({
      ok: false,
      error: 'refused',
    })
  })

  it('starts nobody’s idle time over', async () => {
    const spy = vi.spyOn(h.bg as unknown as { touch: () => Promise<void> }, 'touch')
    await h.ok({ kind: 'pageState' }, tab('sends'))
    expect(spy).not.toHaveBeenCalled()
  })
})
