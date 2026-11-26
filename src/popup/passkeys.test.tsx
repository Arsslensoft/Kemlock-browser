// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { PasskeyView } from '../shared/passkeys'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  change,
  click,
  input,
  installChrome,
  login,
  message,
  mount,
  settings,
  switchOf,
  text,
  toggle,
  unlockedHandlers,
  unmountAll,
  type FakeChrome,
  type World,
} from './testing'
import {
  byOrder,
  loginsOfPasskey,
  passkeyMatches,
  passkeysOfWebsites,
  sameSite,
} from './passkey-format'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('./testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

const openPopup = () => mount(h(ToastProvider, null, h(App, null)))

const made = Date.parse('2026-10-01T12:00:00Z')
const passkey = (over: Partial<PasskeyView> = {}): PasskeyView => ({
  id: 'k1',
  credentialId: 'AAECAwQFBgcICQoLDA0ODw',
  rpId: 'orbit-cloud.com',
  rpName: 'Orbit Cloud',
  userName: 'sam@example.com',
  userDisplayName: 'Sam',
  name: 'Orbit Cloud',
  createdAt: made,
  changedAt: made,
  order: 0,
  ...over,
})
const orbit = passkey()
const harbor = passkey({
  id: 'k2',
  rpId: 'harbornotes.app',
  rpName: undefined,
  name: 'harbornotes.app',
  userName: 'sam@harbor.test',
  userDisplayName: undefined,
  order: 1,
})
const date = (ms: number) => new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(ms)

let fake: FakeChrome
let held: PasskeyView[]

const setUp = (world: World = {}, extra: Record<string, unknown> = {}) => {
  held = [orbit, harbor]
  background.reset({
    ...unlockedHandlers(world),
    passkeys: (() => held) as never,
    deletePasskey: ((args: { id: string }) => {
      held = held.filter((p) => p.id !== args.id)
    }) as never,
    ...extra,
  })
}

beforeEach(() => {
  fake = installChrome()
})
afterEach(() => {
  unmountAll()
})

describe('the Passkeys list on Home', () => {
  it('is a third tab once the vault holds a passkey, with the site, the account and the date', async () => {
    setUp()
    const root = await openPopup()
    expect(button(root, 'Passkeys 2')).not.toBeNull()
    await click(button(root, 'Passkeys 2'))
    expect(text(root)).toContain('Orbit Cloud')
    expect(text(root)).toContain('Sam · orbit-cloud.com')
    expect(text(root)).toContain(date(made))
    // A passkey that has no name of its site is listed by its domain, with its account
    expect(text(root)).toContain('harbornotes.app')
    expect(text(root)).toContain('sam@harbor.test')
    expect(root.querySelectorAll('ul.list > li')).toHaveLength(2)
    expect(root.querySelector('[role=tabpanel]')?.id).toBe('panel-passkeys')
  })

  it('is no tab at all when there is none', async () => {
    setUp()
    held = []
    const root = await openPopup()
    expect(button(root, 'MFA codes 0')).not.toBeNull()
    expect(text(root)).not.toContain(message('en', 'passkeys_tab'))
  })

  it('goes back to the codes when the last passkey is deleted', async () => {
    setUp()
    held = [orbit]
    const root = await openPopup()
    await click(button(root, 'Passkeys 1'))
    await click(button(root, message('en', 'passkeys_openOf', ['Orbit Cloud'])))
    await click(button(root, message('en', 'passkeys_deleteLabel')))
    await click(button(root, 'Delete'))
    expect(button(root, 'Passkeys 0')).toBeNull()
    expect(button(root, 'MFA codes 0')?.getAttribute('aria-selected')).toBe('true')
  })

  it('is searched with the codes and the logins, by site, name or account', async () => {
    setUp()
    const root = await openPopup()
    const search = input(root, 'Search MFA codes and logins')
    await change(search, 'harbor')
    expect(root.querySelectorAll('.list-title')).toHaveLength(1)
    expect(text(root)).toContain(message('en', 'passkeys_tab'))
    expect(text(root)).toContain('sam@harbor.test')
    expect(text(root)).not.toContain('Sam · orbit-cloud.com')
    await change(search, 'SAM@EXAMPLE')
    expect(text(root)).toContain('Orbit Cloud')
    await change(search, 'nothing like it')
    expect(text(root)).toContain(message('en', 'popup_nothingMatches', ['nothing like it']))
  })
})

describe('a passkey’s page', () => {
  const open = async (name = 'Orbit Cloud', world: World = {}) => {
    setUp(world)
    const root = await openPopup()
    await click(button(root, 'Passkeys 2'))
    await click(button(root, message('en', 'passkeys_openOf', [name])))
    return root
  }

  it('shows what it is for and when it was made, and never the key', async () => {
    const root = await open()
    expect(text(root)).toContain('orbit-cloud.com')
    expect(text(root)).toContain('sam@example.com')
    expect(text(root)).toContain('Sam')
    expect(text(root)).toContain(message('en', 'passkeys_created'))
    expect(text(root)).toContain(message('en', 'passkeys_keyNote'))
    expect(text(root)).not.toContain('MIG')
    // Unchanged since it was made: no second date
    expect(text(root)).not.toContain(message('en', 'passkeys_changed'))
  })

  it('says when it was changed, if it was', async () => {
    held = []
    setUp()
    held = [passkey({ changedAt: made + 86_400_000 * 3 })]
    const root = await openPopup()
    await click(button(root, 'Passkeys 1'))
    await click(button(root, message('en', 'passkeys_openOf', ['Orbit Cloud'])))
    expect(text(root)).toContain(message('en', 'passkeys_changed'))
  })

  it('opens the site in a tab', async () => {
    const root = await open()
    await click(button(root, message('en', 'passkeys_openSite', ['orbit-cloud.com'])))
    expect(fake.tabsCreated).toEqual(['https://orbit-cloud.com/'])
  })

  it('links to the login of that site, which opens', async () => {
    const orbitLogin = login({
      id: 'l1',
      name: 'Orbit Cloud login',
      websites: ['https://app.orbit-cloud.com'],
    })
    const other = login({ id: 'l2', name: 'Docs', websites: ['https://docs.example.org'] })
    const root = await open('Orbit Cloud', { logins: [orbitLogin, other] })
    expect(text(root)).toContain(message('en', 'passkeys_logins'))
    expect(text(root)).toContain('Orbit Cloud login')
    expect(text(root)).not.toContain('Docs')
    await click(button(root, message('en', 'popup_openLogin', ['Orbit Cloud login'])))
    expect(text(root)).toContain(message('en', 'popup_websites'))
    expect(text(root)).toContain('app.orbit-cloud.com')
  })

  it('has no link to a login when there is none for the site', async () => {
    const root = await open()
    expect(text(root)).not.toContain(message('en', 'passkeys_logins'))
  })

  it('is deleted only after the question, and then the list is without it', async () => {
    const root = await open()
    await click(button(root, message('en', 'passkeys_deleteLabel')))
    expect(text(root)).toContain(message('en', 'passkeys_deleteTitle'))
    expect(text(root)).toContain(
      message('en', 'passkeys_deleteBody', ['sam@example.com', 'orbit-cloud.com']),
    )
    await click(button(root, 'Cancel'))
    expect(background.of('deletePasskey')).toHaveLength(0)
    await click(button(root, message('en', 'passkeys_deleteLabel')))
    await click(button(root, 'Delete'))
    expect(background.of('deletePasskey')[0]?.args).toEqual({ id: 'k1' })
    // Back on Home, with the passkey gone
    expect(text(root)).not.toContain('Sam · orbit-cloud.com')
    expect(button(root, 'Passkeys 1')).not.toBeNull()
  })

  it('says so when it is gone from the vault meanwhile', async () => {
    // The list Home showed held it; by the time its page asks, another device has deleted it
    let asked = 0
    setUp({}, { passkeys: (() => (++asked === 1 ? [orbit, harbor] : [harbor])) as never })
    const root = await openPopup()
    await click(button(root, 'Passkeys 2'))
    await click(button(root, message('en', 'passkeys_openOf', ['Orbit Cloud'])))
    expect(text(root)).toContain(message('en', 'passkeys_gone'))
    await click(button(root, message('en', 'popup_back')))
    expect(button(root, 'Passkeys 1')).not.toBeNull()
  })
})

describe('the site in front', () => {
  const tab = (passkeys: string[]) => ({
    tabId: 7,
    address: 'https://orbit-cloud.com/signin',
    match: { site: 'orbit-cloud.com', logins: [], codes: [], passkeys },
  })

  it('shows its passkeys under On this site, with no word of there being nothing for it', async () => {
    setUp({ tab: tab(['k1']) })
    const root = await openPopup()
    const section = root.querySelector('section.site')!
    expect(section.textContent).toContain('Orbit Cloud')
    expect(section.textContent).toContain(message('en', 'passkeys_passkeyOf', ['Sam']))
    expect(section.textContent).not.toContain(
      message('en', 'popup_unknownSite', ['orbit-cloud.com']),
    )
    expect(section.textContent).not.toContain('harbornotes.app')
    await click(button(root, message('en', 'passkeys_openOf', ['Orbit Cloud'])))
    expect(text(root)).toContain(message('en', 'passkeys_website'))
  })

  it('shows none for a site with none', async () => {
    setUp({
      tab: {
        tabId: 7,
        address: 'https://docs.example.org/',
        match: { site: 'example.org', logins: [], codes: [] },
      },
    })
    const root = await openPopup()
    expect(root.querySelector('article.card')).toBeNull()
  })
})

describe('a login’s page', () => {
  it('lists the passkeys of its site, and opens one', async () => {
    const orbitLogin = login({ id: 'l1', websites: ['https://orbit-cloud.com'] })
    setUp({ logins: [orbitLogin] })
    const root = await openPopup()
    await click(button(root, 'Logins 1'))
    await click(button(root, message('en', 'popup_openLogin', ['Orbit Cloud'])))
    expect(text(root)).toContain(message('en', 'passkeys_tab'))
    expect(text(root)).toContain('Sam · orbit-cloud.com')
    expect(text(root)).not.toContain('sam@harbor.test')
    await click(button(root, message('en', 'passkeys_openOf', ['Orbit Cloud'])))
    expect(text(root)).toContain(message('en', 'passkeys_keyNote'))
  })

  it('has no Passkeys part when its site has none', async () => {
    const docs = login({ id: 'l3', name: 'Docs', websites: ['https://docs.example.org'] })
    setUp({ logins: [docs] })
    const root = await openPopup()
    await click(button(root, 'Logins 1'))
    await click(button(root, message('en', 'popup_openLogin', ['Docs'])))
    expect(text(root)).not.toContain(message('en', 'passkeys_tab'))
  })
})

describe('the settings for passkeys', () => {
  const tab = {
    tabId: 7,
    address: 'https://orbit-cloud.com/signin',
    match: { site: 'orbit-cloud.com', logins: [], codes: [] },
  }
  let current = settings()
  let here = false
  const both = { origins: ['<all_urls>'], permissions: ['webNavigation'] }
  const openSettings = async (granted: boolean) => {
    fake.held = granted
    current = settings()
    here = false
    setUp(
      { tab },
      {
        settings: (() => current) as never,
        saveSettings: ((args: { settings: Partial<typeof current> }) => {
          current = { ...current, ...args.settings }
          return current
        }) as never,
        passkeyHere: (() => here) as never,
        passkeyHereSet: ((args: { off: boolean }) => {
          here = args.off
        }) as never,
      },
    )
    const root = await openPopup()
    await click(button(root, message('en', 'popup_settings')))
    return root
  }
  const provider = message('en', 'passkeys_provider')

  it('turns the provider off and on, with the access held', async () => {
    const root = await openSettings(true)
    expect(switchOf(root, provider)!.checked).toBe(true)
    await toggle(switchOf(root, provider), false)
    expect(background.of('saveSettings')[0]?.args).toEqual({ settings: { passkeys: false } })
    expect(switchOf(root, provider)!.checked).toBe(false)
    await toggle(switchOf(root, provider), true)
    expect(background.of('saveSettings')[1]?.args).toEqual({ settings: { passkeys: true } })
    expect(fake.permissionRequests).toEqual([])
  })

  it('asks for all sites and the frame list in one request from its own click, and then turns on', async () => {
    const root = await openSettings(false)
    expect(switchOf(root, provider)!.checked).toBe(false)
    await toggle(switchOf(root, provider), true)
    expect(fake.permissionRequests).toEqual([both])
    expect(background.of('saveSettings')[0]?.args).toEqual({ settings: { passkeys: true } })
  })

  it('leaves it off when all sites is refused', async () => {
    fake.grant = false
    const root = await openSettings(false)
    await toggle(switchOf(root, provider), true)
    expect(background.of('saveSettings')).toHaveLength(0)
    expect(text(root)).toContain(message('en', 'popup_accessRefused'))
  })

  it('keeps Kemlock out of the site in front on request, and back in', async () => {
    const root = await openSettings(true)
    const site = message('en', 'passkeys_onHere', ['orbit-cloud.com'])
    expect(switchOf(root, site)!.checked).toBe(true)
    await toggle(switchOf(root, site), false)
    expect(background.of('passkeyHereSet')[0]?.args).toEqual({ host: 'orbit-cloud.com', off: true })
    expect(switchOf(root, site)!.checked).toBe(false)
    await toggle(switchOf(root, site), true)
    expect(background.of('passkeyHereSet')[1]?.args).toEqual({
      host: 'orbit-cloud.com',
      off: false,
    })
  })

  it('has no switch for a site when the provider is off, or no page is in front', async () => {
    const root = await openSettings(true)
    await toggle(switchOf(root, provider), false)
    expect(text(root)).not.toContain(message('en', 'passkeys_onHere', ['orbit-cloud.com']))
  })
})

describe('the helpers', () => {
  it('match a search by site, name, account and label', () => {
    expect(passkeyMatches(orbit, '')).toBe(true)
    expect(passkeyMatches(orbit, ' ORBIT ')).toBe(true)
    expect(passkeyMatches(orbit, 'sam@example')).toBe(true)
    expect(passkeyMatches(orbit, 'sam')).toBe(true)
    expect(passkeyMatches(orbit, 'harbor')).toBe(false)
    expect(passkeyMatches({ ...harbor, label: 'Notes' }, 'notes')).toBe(true)
  })

  it('call a host a passkey’s site when it is the relying party, under it, or above it', () => {
    expect(sameSite('orbit-cloud.com', 'orbit-cloud.com')).toBe(true)
    expect(sameSite('accounts.orbit-cloud.com', 'orbit-cloud.com')).toBe(true)
    expect(sameSite('orbit-cloud.com', 'login.orbit-cloud.com')).toBe(true)
    expect(sameSite('www.orbit-cloud.com', 'orbit-cloud.com')).toBe(true)
    expect(sameSite('evilorbit-cloud.com', 'orbit-cloud.com')).toBe(false)
    expect(sameSite('orbit-cloud.com.evil.io', 'orbit-cloud.com')).toBe(false)
  })

  it('pick the passkeys of a login’s sites, and the logins of a passkey’s', () => {
    expect(passkeysOfWebsites([orbit, harbor], ['https://app.orbit-cloud.com'])).toEqual([orbit])
    expect(passkeysOfWebsites([orbit, harbor], [])).toEqual([])
    const a = login({ id: 'a', websites: ['orbit-cloud.com'] })
    const b = login({ id: 'b', websites: ['https://harbornotes.app/x'] })
    expect(loginsOfPasskey([a, b], harbor)).toEqual([b])
  })

  it('order by the vault’s order', () => {
    expect(byOrder([harbor, orbit])).toEqual([orbit, harbor])
  })
})
