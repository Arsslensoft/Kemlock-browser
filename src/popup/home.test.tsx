// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  backup,
  button,
  change,
  click,
  code,
  input,
  installChrome,
  login,
  message,
  mount,
  settle,
  text,
  unlockedHandlers,
  unmountAll,
  vaultState,
  type World,
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

const proton = code({
  id: 'c2',
  issuer: 'Proton',
  account: 'sam',
  order: 0,
  onSecurityKey: true,
  websites: [],
})
const orbit = code({ id: 'c1', order: 1, tags: ['Work'], backupCodesLeft: 8 })
const counter = code({
  id: 'c3',
  issuer: 'Ledger',
  account: 'sam',
  type: 'hotp',
  order: 2,
  websites: [],
})

const orbitLogin = login({
  id: 'l1',
  order: 0,
  tags: ['Work'],
  codeId: 'c1',
  health: { reused: true, weak: false, withoutItsCode: false, ignored: false },
})
const linear = login({
  id: 'l2',
  name: 'Linear',
  username: 'sam@linear.example',
  websites: ['https://linear.app'],
  order: 1,
  health: { reused: true, weak: false, withoutItsCode: false, ignored: false },
})
const docs = login({
  id: 'l3',
  name: 'Docs',
  username: 'sam',
  websites: ['https://docs.example.org'],
  order: 2,
  health: { reused: false, weak: false, withoutItsCode: true, ignored: false },
})

const world = (over: Partial<World> = {}): World => ({
  codes: [orbit, counter, proton],
  logins: [docs, linear, orbitLogin],
  ...over,
})

const names = (root: HTMLElement) =>
  [...root.querySelectorAll('.list .item .name')].map((element) => element.textContent)

beforeEach(() => {
  installChrome()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

describe('the Codes list', () => {
  it('follows the vault order, and names a code kept on a security key without computing it', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    expect(names(root)).toEqual(['Proton', 'Orbit Cloud', 'Ledger'])
    expect(text(root)).toContain('123 456')
    expect(text(root)).toContain(message('en', 'popup_onSecurityKey'))
    const row = [...root.querySelectorAll('li.item')].find((item) =>
      item.textContent?.includes('Proton'),
    )!
    expect(row.querySelector('button')).toBeNull()
    const asked = background.of('liveCodes').flatMap((call) => call.args.ids as string[])
    expect(asked).toContain('c1')
    expect(asked).not.toContain('c2')
  })

  it('shows the tags as filters and the backup codes as a page of their own', async () => {
    background.reset(unlockedHandlers(world({ backups: [backup()] })))
    const root = await openPopup()
    expect(text(root)).toContain('Work')
    const link = root.querySelector('button.link-card')
    expect(link?.textContent).toContain('8 of 10 left · Orbit Cloud')
    await click(link)
    expect(root.querySelector('article[aria-label="Orbit Cloud"]')).not.toBeNull()
    expect(text(root)).toContain(message('en', 'popup_backupCount', ['8', '10']))
    // The list itself changes nothing: its tools are on pages of their own
    expect(root.querySelectorAll('[draggable="true"]')).toHaveLength(0)
    expect(root.querySelectorAll('input[type="text"], textarea')).toHaveLength(0)
  })

  it('asks for live codes again every second and turns warning in the last five seconds', async () => {
    let remaining = 20_000
    background.reset(
      unlockedHandlers(
        world({
          live: (id) => ({ id, code: '123456', expiresAt: Date.now() + remaining }),
        }),
      ),
    )
    const root = await openPopup()
    expect(root.querySelector('.code.warn')).toBeNull()
    expect(text(root)).not.toContain('next 654 321')
    const before = background.of('liveCodes').length

    remaining = 4_000
    await new Promise<void>((resolve) => setTimeout(resolve, 1_150))
    await settle()

    expect(background.of('liveCodes').length).toBeGreaterThan(before)
    expect(root.querySelector('.code.warn')).not.toBeNull()
    expect(text(root)).toContain('next 654 321')
    expect(background.of('nextCodes').flatMap((call) => call.args.ids as string[])).toContain('c1')
  })

  it('shows the next HOTP code when its button is clicked', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      nextHotp: ((args: { id: string }) => ({ id: args.id, code: '999999' })) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Next code for Ledger'))
    expect(background.of('nextHotp')[0]?.args).toEqual({ id: 'c3' })
    expect(text(root)).toContain('999 999')
  })

  it('copies a code through the background', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await click(button(root, 'Copy the code of Orbit Cloud'))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'code', id: 'c1' })
    expect(text(root)).toContain(message('en', 'popup_copiedCode'))
  })

  it('filters by the vault’s tags', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await click(button(root, 'Work'))
    expect(names(root)).toEqual(['Orbit Cloud'])
    await click(button(root, 'Logins 3'))
    expect(names(root)).toEqual(['Orbit Cloud'])
    await click(button(root, 'All'))
    expect(names(root)).toEqual(['Orbit Cloud', 'Linear', 'Docs'])
  })
})

describe('the Logins list', () => {
  it('shows health tags and the counts row, and a click copies the password', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await click(button(root, 'Logins 3'))
    expect(names(root)).toEqual(['Orbit Cloud', 'Linear', 'Docs'])
    expect(text(root)).toContain('Password health')
    expect(text(root)).toContain('2 reused · 1 without its code')
    expect(root.querySelectorAll('.item .sub.warn-text')).toHaveLength(3)
    expect(text(root)).toContain('Without its code')

    await click(button(root, 'Copy the password of Linear'))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'password', id: 'l2' })
    expect(background.of('showPassword')).toHaveLength(0)
  })

  it('shows Breached only while the breach switch is on', async () => {
    const breached = login({
      id: 'l4',
      name: 'Old',
      health: { reused: false, weak: false, withoutItsCode: false, ignored: false, breached: true },
    })
    background.reset(unlockedHandlers(world({ logins: [breached] })))
    let root = await openPopup()
    await click(button(root, 'Logins 1'))
    expect(text(root)).not.toContain('Breached')
    unmountAll()

    background.reset(
      unlockedHandlers(
        world({
          logins: [breached],
          settings: {
            autoLockMinutes: 5,
            lockOnSleep: true,
            codeAfterPassword: true,
            buttonsOnPages: false,
            breachedPasswords: true,
            offerToSave: true,
            clipboardSeconds: 30,
          },
        }),
      ),
    )
    root = await openPopup()
    await click(button(root, 'Logins 1'))
    expect(text(root)).toContain('Breached')
  })
})

describe('search', () => {
  it('matches names, usernames, accounts and websites in both lists, whatever the case', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    const search = input(root, 'Search codes and logins')

    await change(search, 'ORBIT')
    expect(names(root)).toEqual(['Orbit Cloud', 'Orbit Cloud'])
    expect(root.querySelectorAll('.list-title')).toHaveLength(2)

    await change(search, 'linear.app')
    expect(names(root)).toEqual(['Linear'])

    await change(search, 'sam@linear')
    expect(names(root)).toEqual(['Linear'])

    await change(search, 'zzz')
    expect(names(root)).toEqual([])
    expect(text(root)).toContain(message('en', 'popup_nothingMatches', ['zzz']))
  })
})

describe('the site in front', () => {
  const tab = {
    tabId: 7,
    address: 'https://orbit-cloud.com/login',
    match: { site: 'orbit-cloud.com', logins: ['l1'], codes: ['c1'] },
  }

  it('opens on a card with the login and its code, and Fill acts on the tab', async () => {
    background.reset({
      ...unlockedHandlers(world({ tab })),
      showPassword: (() => 'hunter2') as never,
    })
    const root = await openPopup()
    const card = root.querySelector<HTMLElement>('article.card')!
    expect(card).not.toBeNull()
    expect(text(card)).toContain('Orbit Cloud')
    expect(text(card)).toContain('sam@example.com')
    expect(text(card)).toContain('123 456')
    expect(text(card)).not.toContain('hunter2')

    await click(button(card, 'Fill login'))
    expect(background.of('fill')[0]?.args).toEqual({ tabId: 7, loginId: 'l1' })
    await click(button(card, 'Fill code'))
    expect(background.of('fill')[1]?.args).toEqual({ tabId: 7, codeId: 'c1' })

    await click(button(card, 'Show the password of Orbit Cloud'))
    expect(background.of('showPassword')[0]?.args).toEqual({ id: 'l1' })
    expect(text(card)).toContain('hunter2')
    await click(button(card, 'Hide the password of Orbit Cloud'))
    expect(text(card)).not.toContain('hunter2')

    await click(button(card, 'Copy the password of Orbit Cloud'))
    expect(background.of('copy').at(-1)?.args).toEqual({ what: 'password', id: 'l1' })
  })

  it('gives every match its own card', async () => {
    const second = login({ id: 'l9', name: 'Orbit Admin', websites: ['https://orbit-cloud.com'] })
    background.reset(
      unlockedHandlers(
        world({
          logins: [orbitLogin, second],
          tab: { ...tab, match: { ...tab.match, logins: ['l1', 'l9'] } },
        }),
      ),
    )
    const root = await openPopup()
    expect(root.querySelectorAll('article.card')).toHaveLength(2)
  })

  it('warns when the address looks like a known site', async () => {
    background.reset(
      unlockedHandlers(
        world({
          tab: {
            tabId: 7,
            address: 'https://orbit-c1oud.com',
            match: {
              site: 'orbit-c1oud.com',
              logins: [],
              codes: [],
              lookAlikeOf: 'orbit-cloud.com',
            },
          },
        }),
      ),
    )
    const root = await openPopup()
    const alert = root.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(message('en', 'popup_lookAlikeTitle', ['orbit-cloud.com']))
    expect(root.querySelectorAll('article.card')).toHaveLength(0)
  })

  it('hints at the picker on a site the vault knows nothing of', async () => {
    background.reset(
      unlockedHandlers(
        world({
          tab: {
            tabId: 7,
            address: 'https://example.org',
            match: { site: 'example.org', logins: [], codes: [] },
          },
        }),
      ),
    )
    const root = await openPopup()
    expect(text(root)).toContain(message('en', 'popup_unknownSite', ['example.org']))
  })

  it('opens on the lists, without a card, when nothing matches', async () => {
    background.reset(
      unlockedHandlers(
        world({
          tab: { tabId: 7, address: 'about:blank', match: { site: '', logins: [], codes: [] } },
        }),
      ),
    )
    const root = await openPopup()
    expect(root.querySelectorAll('article.card')).toHaveLength(0)
    expect(names(root)).toContain('Orbit Cloud')
  })
})

describe('locking now', () => {
  it('locks and shows the lock screen', async () => {
    let unlocked = true
    background.reset({
      ...unlockedHandlers(world()),
      popup: () => ({ state: vaultState({ unlocked }) }),
      lock: (() => {
        unlocked = false
      }) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Lock now'))
    expect(background.of('lock')).toHaveLength(1)
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
    expect(text(root)).not.toContain('Orbit Cloud')
  })
})
