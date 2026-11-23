// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  backup,
  background,
  button,
  click,
  code,
  installChrome,
  login,
  mount,
  syncStatus,
  text,
  unlockedHandlers,
  unmountAll,
  vaultState,
} from './testing'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('./testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

/** What a paywall, a Premium badge, or a backup-code coverage or "get new codes" tool would say. */
const premium =
  /premium|paywall|upgrade|subscri|purchase|get new codes|new backup codes|coverage|unlock more/i

const everything = (root: HTMLElement): string =>
  [
    text(root),
    ...[...root.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((element) => [
      element.getAttribute('aria-label') ?? '',
      element.getAttribute('title') ?? '',
      element.getAttribute('placeholder') ?? '',
    ]),
  ].join(' ')

beforeEach(() => {
  installChrome()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

describe('nothing in the popup asks for Premium', () => {
  it('renders every screen without a paywall, a Premium badge or a Premium tool', async () => {
    background.reset({
      ...unlockedHandlers({
        codes: [code({ id: 'c1' })],
        logins: [
          login({
            id: 'l1',
            codeId: 'c1',
            health: {
              reused: true,
              weak: true,
              withoutItsCode: false,
              ignored: false,
              breached: true,
            },
          }),
          login({
            id: 'l2',
            name: 'Docs',
            health: { reused: false, weak: false, withoutItsCode: true, ignored: false },
          }),
        ],
        backups: [backup()],
        tab: {
          tabId: 1,
          address: 'https://orbit-cloud.com',
          match: { site: 'orbit-cloud.com', logins: ['l1'], codes: ['c1'] },
        },
      }),
      health: (() => ({
        reused: ['l1'],
        weak: ['l1'],
        withoutItsCode: ['l2'],
        breached: ['l1'],
      })) as never,
      generate: (() => 'abc') as never,
      recentPasswords: (() => []) as never,
      showPassword: (() => 'pw') as never,
      syncStatus: (() => syncStatus({ place: 'vaultwarden', loginsNotSynced: true })) as never,
    })
    const root = await mount(h(ToastProvider, null, h(App, null)))
    const seen: string[] = [everything(root)]
    const visit = async (label: string, ...then: string[]) => {
      await click(button(root, label))
      seen.push(everything(root))
      for (const next of then) {
        await click(button(root, next))
        seen.push(everything(root))
      }
    }

    await click(button(root, 'Logins 2'))
    seen.push(everything(root))
    await click(
      [...root.querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Password health'),
      ) ?? null,
    )
    seen.push(everything(root))
    await click(button(root, 'Back'))
    await visit('Open Orbit Cloud', 'Edit', 'Back')
    await click(button(root, 'Back'))
    await visit('Add a code', 'Back')
    await visit('Generate a password', 'Recently generated', 'Back')
    await click(button(root, 'Back'))
    await visit('Settings', 'Back')

    expect(seen.length).toBeGreaterThan(8)
    for (const screen of seen) expect(screen).not.toMatch(premium)
  })

  it('renders the lock screen without it', async () => {
    background.reset({ popup: () => ({ state: vaultState({ unlocked: false }) }) })
    const root = await mount(h(ToastProvider, null, h(App, null)))
    expect(everything(root)).not.toMatch(premium)
  })

  it('has no Premium string in its own messages', async () => {
    const english = (await import('../../locales/parts/popup.en.json')).default
    const french = (await import('../../locales/parts/popup.fr.json')).default
    for (const text of [...Object.values(english), ...Object.values(french)])
      expect(text).not.toMatch(premium)
  })
})
