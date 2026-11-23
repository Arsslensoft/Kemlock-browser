// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { Settings, SyncStatus } from '../shared/api'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  choose,
  click,
  installChrome,
  message,
  mount,
  selectOf,
  settings,
  switchOf,
  syncStatus,
  text,
  toggle,
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
let current: Settings
let status: SyncStatus | null

/** The popup over a vault whose settings and sync status the test can change. */
function setUp(over: { granted?: boolean } = {}) {
  current = settings()
  status = null
  background.reset({
    ...unlockedHandlers(),
    settings: (() => current) as never,
    saveSettings: ((args: { settings: Partial<Settings> }) => {
      current = { ...current, ...args.settings }
      return current
    }) as never,
    allSitesGranted: (() => over.granted ?? false) as never,
    syncStatus: (() => status) as never,
  })
}

async function openSettings() {
  const root = await openPopup()
  await click(button(root, 'Settings'))
  return root
}

beforeEach(() => {
  fake = installChrome()
})

afterEach(() => {
  unmountAll()
})

describe('the settings', () => {
  it('saves the auto-lock time and the clipboard seconds', async () => {
    setUp()
    const root = await openSettings()
    await choose(selectOf(root, 'Lock after'), '15')
    expect(background.of('saveSettings')[0]?.args).toEqual({ settings: { autoLockMinutes: 15 } })
    await choose(selectOf(root, 'Clear the clipboard after'), '60')
    expect(background.of('saveSettings')[1]?.args).toEqual({ settings: { clipboardSeconds: 60 } })
    expect(selectOf(root, 'Lock after')!.value).toBe('15')
  })

  it('saves each switch', async () => {
    setUp()
    const root = await openSettings()
    await toggle(switchOf(root, 'Lock when the computer sleeps'), false)
    await toggle(switchOf(root, 'Offer the code after the password'), false)
    await toggle(switchOf(root, 'Offer to save logins'), false)
    await toggle(switchOf(root, 'Check for breached passwords'), true)
    expect(background.of('saveSettings').map((call) => call.args.settings)).toEqual([
      { lockOnSleep: false },
      { codeAfterPassword: false },
      { offerToSave: false },
      { breachedPasswords: true },
    ])
  })

  it('asks for all sites from the switch’s own click, then turns the buttons on', async () => {
    setUp()
    const root = await openSettings()
    expect(switchOf(root, 'Button in sign-in and code fields')!.checked).toBe(false)
    await toggle(switchOf(root, 'Button in sign-in and code fields'), true)
    expect(fake.permissionRequests).toEqual([{ origins: ['<all_urls>'] }])
    expect(background.of('saveSettings')[0]?.args).toEqual({ settings: { buttonsOnPages: true } })
    expect(switchOf(root, 'Button in sign-in and code fields')!.checked).toBe(true)
    expect(text(root)).toContain(message('en', 'popup_accessAll'))
  })

  it('leaves the buttons off when all sites is refused', async () => {
    setUp()
    fake.grant = false
    const root = await openSettings()
    await toggle(switchOf(root, 'Button in sign-in and code fields'), true)
    expect(background.of('saveSettings')).toHaveLength(0)
    expect(text(root)).toContain(message('en', 'popup_accessRefused'))
  })

  it('can stop allowing all sites', async () => {
    setUp({ granted: true })
    current = settings({ buttonsOnPages: true })
    const root = await openSettings()
    expect(switchOf(root, 'Button in sign-in and code fields')!.checked).toBe(true)
    await click(button(root, 'Stop allowing all sites'))
    expect(fake.permissionRemovals).toEqual([{ origins: ['<all_urls>'] }])
    expect(background.of('saveSettings')[0]?.args).toEqual({ settings: { buttonsOnPages: false } })
  })

  it('sets up again, and removes Kemlock from this browser after confirming', async () => {
    setUp()
    let exists = true
    background.set({
      popup: (() => ({ state: vaultState({ exists }) })) as never,
      removeVault: (() => {
        exists = false
      }) as never,
    })
    const root = await openSettings()
    await click(button(root, 'Set up again'))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/setup/index.html?again'])

    await click(button(root, 'Remove Kemlock from this browser'))
    expect(background.of('removeVault')).toHaveLength(0)
    await click(button(root, 'Remove'))
    expect(background.of('removeVault')).toHaveLength(1)
    expect(fake.tabsCreated.at(-1)).toBe('chrome-extension://kemlock/src/setup/index.html')
  })

  it('shows no Premium anywhere', async () => {
    setUp()
    status = syncStatus({ place: 'vaultwarden', loginsNotSynced: true })
    const root = await openSettings()
    expect(text(root)).not.toMatch(/premium|upgrade|paywall|subscribe|purchase/i)
  })
})

describe('the sync card', () => {
  it('offers to set sync up when there is none', async () => {
    setUp()
    const root = await openSettings()
    expect(text(root)).toContain(message('en', 'popup_syncOff'))
    await click(button(root, 'Set up sync'))
    expect(fake.tabsCreated.at(-1)).toBe('chrome-extension://kemlock/src/setup/index.html?again')
  })

  it('shows where it syncs, the Vaultwarden logins line, and syncs now', async () => {
    setUp()
    status = syncStatus({
      place: 'vaultwarden',
      server: 'https://vault.example.com',
      account: 'sam@example.com',
      storage: 'sealed',
      home: 'Kemlock',
      deviceName: 'Kemlock · Chrome',
      lastSync: Date.parse('2026-11-20T10:00:00Z'),
      loginsNotSynced: true,
    })
    background.set({
      syncNow: (() => ({ ...status!, lastSync: Date.parse('2026-11-21T10:00:00Z') })) as never,
    })
    const root = await openSettings()
    const card = text(root)
    for (const value of [
      'Vaultwarden',
      'https://vault.example.com',
      'sam@example.com',
      'Sealed',
      'Kemlock · Chrome',
      message('en', 'popup_loginsNotSynced'),
    ])
      expect(card).toContain(value)

    await click(button(root, 'Sync now'))
    expect(background.of('syncNow')).toHaveLength(1)
  })

  it('says why sync stopped in the app’s words, English and French', async () => {
    setUp()
    status = syncStatus({ problem: 'homeMissing' })
    let root = await openSettings()
    expect(text(root)).toContain(message('en', 'sync_problem_homeMissing'))
    unmountAll()

    fake = installChrome('fr')
    root = await openSettings()
    expect(text(root)).toContain(message('fr', 'sync_problem_homeMissing'))
    expect(message('fr', 'sync_problem_homeMissing')).not.toBe(
      message('en', 'sync_problem_homeMissing'),
    )
  })

  it('opens setup to sign in again after a signed-out session', async () => {
    setUp()
    status = syncStatus({ place: 'vaultwarden', problem: 'signedOut' })
    const root = await openSettings()
    await click(button(root, 'Sign in again'))
    expect(fake.tabsCreated.at(-1)).toBe('chrome-extension://kemlock/src/setup/index.html?signin')
  })

  it('waits for confirmation when a sync would remove many entries', async () => {
    setUp()
    status = syncStatus({ problem: 'removals', pendingRemovals: 7 })
    background.set({ confirmRemovals: (() => syncStatus({ lastSync: Date.now() })) as never })
    const root = await openSettings()
    expect(text(root)).toContain(message('en', 'sync_problem_removals'))
    await click(button(root, 'Sync anyway'))
    expect(text(root)).toContain(message('en', 'popup_removalsTitle', ['7']))
    expect(background.of('confirmRemovals')).toHaveLength(0)
    await click(button(root, 'Sync anyway'))
    expect(background.of('confirmRemovals')).toHaveLength(1)
  })

  it('signs out only after confirming, and keeps nothing of the old sync on screen', async () => {
    setUp()
    status = syncStatus({ account: 'sam@example.com' })
    background.set({ signOut: (() => undefined) as never })
    const root = await openSettings()
    await click(button(root, 'Sign out'))
    expect(background.of('signOut')).toHaveLength(0)
    expect(text(root)).toContain(message('en', 'popup_signOutTitle'))
    await click(button(root, 'Sign out'))
    expect(background.of('signOut')).toHaveLength(1)
    expect(text(root)).toContain(message('en', 'popup_syncOff'))
  })
})
