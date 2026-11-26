// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  change,
  click,
  code,
  input,
  installChrome,
  login,
  message,
  mount,
  syncStatus,
  text,
  unlockedHandlers,
  unmountAll,
  vaultState,
  type FakeChrome,
} from './testing'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('./testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

const openPopup = () => mount(h(ToastProvider, null, h(App, null)))

let fake: FakeChrome

beforeEach(() => {
  fake = installChrome()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

describe('Home says where the vault syncs', () => {
  it('names the place and when it last synced at the foot, and when the vault locks', async () => {
    background.reset({
      ...unlockedHandlers({ codes: [code()], logins: [login()] }),
      syncStatus: (() => syncStatus({ place: 'kemlock', lastSync: Date.now() - 120_000 })) as never,
    })
    const root = await openPopup()
    expect(root.querySelector('footer')?.textContent).toContain('Kemlock Server · synced 2 min ago')
    expect(root.querySelector('footer')?.textContent).toContain('Locks after 5 min idle')
    expect(root.querySelector('.sync-banner')).toBeNull()
    // The place is kept for the lock screen
    expect(fake.storage['kemlock_sync_place']).toBe('kemlock')
  })

  it('puts a banner above the lists when sync stopped, in the app’s words, with Sign in again', async () => {
    background.reset({
      ...unlockedHandlers({ codes: [code()], logins: [login()] }),
      syncStatus: (() => syncStatus({ place: 'kemlock', problem: 'sessionEnded' })) as never,
    })
    const root = await openPopup()
    const banner = root.querySelector('.sync-banner')!
    expect(banner.textContent).toContain(message('en', 'sync_problem_sessionEnded'))
    expect(root.querySelector('footer')?.textContent).toContain('Kemlock Server · sync stopped')
    await click(button(banner, 'Sign in again'))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/setup/index.html#signin'])
  })

  it('offers Sync now for a problem that may pass, and shows the status it answers with', async () => {
    let status = syncStatus({ place: 'kemlock', problem: 'network' })
    background.reset({
      ...unlockedHandlers({ codes: [code()], logins: [login()] }),
      syncStatus: (() => status) as never,
      syncNow: (() => {
        status = syncStatus({ place: 'kemlock', lastSync: Date.now() })
        return status
      }) as never,
    })
    const root = await openPopup()
    expect(text(root.querySelector('.sync-banner')!)).not.toContain('Sign in again')
    await click(button(root, 'Sync now'))
    expect(background.of('syncNow')).toHaveLength(1)
    expect(root.querySelector('.sync-banner')).toBeNull()
    expect(root.querySelector('footer')?.textContent).toContain('synced just now')
  })

  it('says how many a removal guard would take, and points to Settings to Review', async () => {
    background.reset({
      ...unlockedHandlers({ codes: [code()], logins: [login()] }),
      syncStatus: (() =>
        syncStatus({ problem: 'removals', pendingRemovals: 6, scopeSize: 22 })) as never,
    })
    const root = await openPopup()
    expect(root.querySelector('.sync-banner')?.textContent).toContain(
      'This sync would remove 6 of 22 items.',
    )
    await click(button(root, 'Review'))
    expect(text(root)).toContain(message('en', 'popup_sectionLock'))
  })

  it('says Vaultwarden keeps logins in this browser, on the Logins list', async () => {
    background.reset({
      ...unlockedHandlers({ codes: [code()], logins: [login()] }),
      syncStatus: (() => syncStatus({ place: 'vaultwarden', loginsNotSynced: true })) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Logins 1'))
    expect(root.querySelector('[role="note"]')?.textContent).toBe(
      message('en', 'popup_loginsNotSynced'),
    )
    expect(message('en', 'popup_loginsNotSynced')).toMatch(/Kemlock Server and WebDAV/)
  })
})

describe('an empty vault', () => {
  it('invites to add a code, a login, and to set up sync when it doesn’t sync', async () => {
    background.reset(unlockedHandlers({ codes: [], logins: [] }))
    const root = await openPopup()
    expect(text(root)).toContain('No MFA codes yet.')
    expect(root.querySelector('footer')).toBeNull()
    await click(button(root, 'Set up sync'))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/setup/index.html#again'])

    await click(button(root, 'Logins 0'))
    expect(text(root)).toContain('No logins yet.')
    await click(button(root, 'New login'))
    expect(text(root)).toContain(message('en', 'popup_newLogin'))
    expect(input(root, 'Name')).not.toBeNull()
  })
})

describe('the lock screen', () => {
  it('names where the vault syncs, as last seen while it was open', async () => {
    fake.storage['kemlock_sync_place'] = 'webdav'
    background.reset({ popup: () => ({ state: vaultState({ unlocked: false }) }) })
    const root = await openPopup()
    expect(root.querySelector('.lock-pill')?.textContent).toBe('Syncs with WebDAV')
  })

  it('says nothing of it when it never synced', async () => {
    background.reset({ popup: () => ({ state: vaultState({ unlocked: false }) }) })
    const root = await openPopup()
    expect(root.querySelector('.lock-pill')).toBeNull()
    await change(input(root, 'Password for this browser'), 'x')
    expect(button(root, 'Show')).not.toBeNull()
  })
})
