// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import { lockedEvent } from './send'
import {
  background,
  button,
  change,
  click,
  code,
  input,
  installChrome,
  message,
  mount,
  settle,
  submit,
  text,
  unlockedHandlers,
  unmountAll,
  vaultState,
  type FakeChrome,
} from './testing'
import { act } from 'preact/test-utils'

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

describe('the lock screen', () => {
  it('says there is no vault, and Set up opens the setup tab', async () => {
    background.reset({ popup: () => ({ state: vaultState({ exists: false, unlocked: false }) }) })
    const root = await openPopup()
    expect(text(root)).toContain(message('en', 'popup_noVault'))
    await click(button(root, 'Set up Kemlock'))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/setup/index.html'])
  })

  it('shows nothing of the vault while locked, only the wrong tries and when', async () => {
    background.reset({
      ...unlockedHandlers({ codes: [], logins: [] }),
      popup: () => ({
        state: vaultState({
          unlocked: false,
          wrongPasswords: 3,
          lastWrongAt: Date.parse('2026-11-20T10:00:00Z'),
        }),
      }),
    })
    const root = await openPopup()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
    expect(text(root)).toContain('3 wrong tries since the vault last opened. The last was')
    for (const kind of ['codes', 'logins', 'liveCodes', 'backupCodes'] as const)
      expect(background.of(kind)).toHaveLength(0)
  })

  it('says a forgotten password is recovered through sync', async () => {
    background.reset({ popup: () => ({ state: vaultState({ unlocked: false }) }) })
    const root = await openPopup()
    expect(text(root)).toContain(message('en', 'popup_forgot'))
  })

  it('counts a wrong password, then opens with the right one and says so once', async () => {
    let unlocked = false
    let wrong = 0
    background.reset({
      ...unlockedHandlers(),
      popup: () => ({ state: vaultState({ unlocked, wrongPasswords: 0 }) }),
      unlock: ((args: { password: string }) => {
        if (args.password === 'right') {
          unlocked = true
          return { ok: true, wrongPasswords: 0 }
        }
        wrong += 1
        return { ok: false, wrongPasswords: wrong }
      }) as never,
    })
    const root = await openPopup()
    const field = input(root, 'Password for this browser')

    await change(field, 'nope')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(message('en', 'popup_wrongPassword'))
    expect(text(root)).toContain('1 wrong try since the vault last opened')

    await change(input(root, 'Password for this browser'), 'right')
    await submit(root.querySelector('form'))
    expect(background.of('unlock').map((call) => call.args.password)).toEqual(['nope', 'right'])
    expect(root.querySelector('input[type="password"]')).toBeNull()
    expect(text(root)).toContain(message('en', 'popup_wrongBefore', ['1']))
  })

  it('removes Kemlock from the browser only after confirming', async () => {
    let exists = true
    background.reset({
      popup: () => ({ state: vaultState({ exists, unlocked: false }) }),
      removeVault: (() => {
        exists = false
      }) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Remove Kemlock from this browser'))
    expect(background.of('removeVault')).toHaveLength(0)
    expect(text(root)).toContain(message('en', 'popup_removeTitle'))

    await click(button(root, 'Remove'))
    expect(background.of('removeVault')).toHaveLength(1)
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/setup/index.html'])
    expect(text(root)).toContain(message('en', 'popup_noVault'))
  })

  it('goes back to the lock screen when the background says it locked', async () => {
    let unlocked = true
    background.reset({
      ...unlockedHandlers(),
      popup: () => ({ state: vaultState({ unlocked }) }),
    })
    const root = await openPopup()
    expect(root.querySelector('input[type="password"]')).toBeNull()
    unlocked = false
    await act(() => {
      window.dispatchEvent(new Event(lockedEvent))
    })
    await settle()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('shows the lock screen at once when the background broadcasts that the vault locked', async () => {
    let unlocked = true
    background.reset({
      ...unlockedHandlers({ codes: [code({ issuer: 'Orbit Cloud' })] }),
      popup: () => ({ state: vaultState({ unlocked }) }),
    })
    const root = await openPopup()
    expect(text(root)).toContain('Orbit Cloud')
    // The page does not wait for the answer to its next question: the broadcast alone replaces what it showed
    background.reset({
      ...unlockedHandlers({ codes: [code({ issuer: 'Orbit Cloud' })] }),
      popup: () => new Promise(() => undefined) as never,
    })
    unlocked = false
    await act(() => {
      fake.lock()
    })
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
    expect(text(root)).not.toContain('Orbit Cloud')
  })

  it('asks the background when it comes to the front, and locks if the vault is not open', async () => {
    let unlocked = true
    background.reset({
      ...unlockedHandlers({ codes: [code({ issuer: 'Orbit Cloud' })] }),
      popup: () => ({ state: vaultState({ unlocked }) }),
      pageState: () => vaultState({ unlocked }),
    })
    const root = await openPopup()
    unlocked = false
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('speaks French in a French browser', async () => {
    fake = installChrome('fr')
    background.reset({ popup: () => ({ state: vaultState({ unlocked: false }) }) })
    const root = await openPopup()
    expect(button(root, 'Déverrouiller')).not.toBeNull()
    expect(text(root)).toContain(message('fr', 'popup_forgot'))
  })
})
