// @vitest-environment jsdom
// Needs the Preact JSX transform in vitest.config.ts (`oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } }`).
import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LoginView, MenuView } from '../shared/api'
import type { PasskeyPrompt } from '../shared/passkeys'
import contentEn from '../../locales/parts/content.en.json'
import passkeysEn from '../../locales/parts/passkeys.en.json'
import { App } from './App'
import type { Channel, Init } from './channel'
import type { Verdict } from './gate'
import { PasskeyApp } from './passkey-card'

const en: Record<string, string> = { ...contentEn, ...passkeysEn }

/** The browser's getMessage: placeholders filled in the order they first appear. */
function message(name: string, substitutions: string[] = []): string {
  const text = en[name]
  if (text === undefined) return ''
  const order: string[] = []
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (!order.includes(key)) order.push(key)
    return substitutions[order.indexOf(key)] ?? ''
  })
}

const prompt = (over: Partial<PasskeyPrompt> = {}): PasskeyPrompt => ({
  state: { exists: true, unlocked: true, wrongPasswords: 0, fileSync: 'readOnly' },
  kind: 'create',
  site: 'orbit-cloud.com',
  rpName: 'Orbit Cloud',
  host: 'orbit-cloud.com',
  crossOrigin: false,
  user: { name: 'sam@example.com', displayName: 'Sam' },
  choices: [],
  ...over,
})

const signIn = prompt({
  kind: 'get',
  user: undefined,
  choices: [
    { id: 'p1', name: 'Orbit Cloud', detail: 'Sam' },
    { id: 'p2', name: 'Orbit Cloud', detail: 'Alex' },
  ],
})

const init = (over: Partial<Init> = {}): Init => ({
  mode: 'passkey',
  tabId: 4,
  frameId: 0,
  fieldId: '',
  token: 'tok',
  ...over,
})

type Handler = (args: Record<string, unknown>) => unknown
let handlers: Record<string, Handler>
let sendMessage: ReturnType<typeof vi.fn>
let channel: {
  permit: Mock<Channel['permit']>
  size: Mock<Channel['size']>
  close: Mock<Channel['close']>
}

const mount = (options: Init = init()) =>
  render(<PasskeyApp channel={channel} init={options} />, document.body)

const sent = (kind: string) =>
  sendMessage.mock.calls.map(([m]) => m as { kind: string }).filter((m) => m.kind === kind)
const shown = () => document.body.textContent ?? ''
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!
/** A press of the pointer: what a person's click is, with a count of presses a key's click does not have. */
const press = (element: Element) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
/** A click a key makes (Space or Enter on a focused button), or a script's `click()`. */
const keyed = (element: Element) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-row]'))

beforeEach(() => {
  handlers = {}
  sendMessage = vi.fn(async (request: { kind: string }) => {
    const handler = handlers[request.kind]
    if (handler === undefined) return { ok: false, error: 'unsupported' }
    try {
      return { ok: true, value: handler(request) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  channel = {
    permit: vi.fn<Channel['permit']>(async (): Promise<Verdict> => ({ ok: true })),
    size: vi.fn<Channel['size']>(),
    close: vi.fn<Channel['close']>(),
  }
  vi.stubGlobal('chrome', { i18n: { getMessage: message }, runtime: { sendMessage } })
  document.body.innerHTML = ''
})

afterEach(() => {
  render(null, document.body)
  vi.unstubAllGlobals()
})

describe('saving a passkey', () => {
  it('says what the site asked for, and saves on the click the gate lets count', async () => {
    handlers.passkeyPrompt = () => prompt()
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_create_title))
    expect(sent('passkeyPrompt')).toEqual([{ kind: 'passkeyPrompt', tabId: 4, token: 'tok' }])
    expect(shown()).toContain('orbit-cloud.com')
    expect(shown()).toContain('Sam')
    expect(shown()).not.toContain(en.passkeys_asked_by)
    press(button(en.passkeys_save))
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(false))
    expect(channel.permit).toHaveBeenCalledTimes(1)
    expect(sent('passkeyAnswer')).toEqual([
      { kind: 'passkeyAnswer', tabId: 4, token: 'tok', action: 'save' },
    ])
  })

  it('does nothing when the gate refuses the click, and says why', async () => {
    handlers.passkeyPrompt = () => prompt()
    handlers.passkeyAnswer = () => undefined
    channel.permit.mockResolvedValue({ ok: false, why: 'covered' })
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_save))
    press(button(en.passkeys_save))
    await vi.waitFor(() => expect(shown()).toContain(en.menu_gate_covered))
    expect(sent('passkeyAnswer')).toEqual([])
    expect(channel.close).not.toHaveBeenCalled()
  })

  it('offers the other way out and the way to stay out, each through the gate', async () => {
    handlers.passkeyPrompt = () => prompt()
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_other))
    press(button(en.passkeys_other))
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledTimes(1))
    expect(sent('passkeyAnswer')[0]).toMatchObject({ action: 'other' })
    expect(channel.permit).toHaveBeenCalledTimes(1)
  })

  it('says it could not finish when the background refuses, and can be tried again', async () => {
    handlers.passkeyPrompt = () => prompt()
    handlers.passkeyAnswer = () => {
      throw new Error('unknownField')
    }
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_save))
    press(button(en.passkeys_save))
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_failed))
    expect(channel.close).not.toHaveBeenCalled()
    expect((button(en.passkeys_save) as HTMLButtonElement).disabled).toBe(false)
  })

  it('names the frame that asks when it is of another site', async () => {
    handlers.passkeyPrompt = () => prompt({ crossOrigin: true, host: 'pay.example.net' })
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_asked_by))
    expect(shown()).toContain('pay.example.net')
  })

  it('shows the site’s words as text, never as markup', async () => {
    handlers.passkeyPrompt = () =>
      prompt({ user: { name: '<img src=x onerror=alert(1)>', displayName: '<b>Sam</b>' } })
    mount()
    await vi.waitFor(() => expect(shown()).toContain('<b>Sam</b>'))
    // The card's own wordmark is the one picture; nothing the site named became one
    expect(document.querySelector('img:not([alt="Kemlock"])')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
  })
})

describe('signing in with a passkey', () => {
  it('lists the passkeys, and signs with the one clicked', async () => {
    handlers.passkeyPrompt = () => signIn
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(shown()).toContain(en.passkeys_get_title)
    expect(rows()[0]!.textContent).toContain('Sam')
    expect(rows()[1]!.textContent).toContain('Alex')
    // The title says what is asked; no button saves
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      en.passkeys_save,
    )
    press(rows()[1]!)
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(false))
    expect(sent('passkeyAnswer')).toEqual([
      { kind: 'passkeyAnswer', tabId: 4, token: 'tok', action: 'use', passkeyId: 'p2' },
    ])
  })

  it('stays out of the way of the site on request', async () => {
    handlers.passkeyPrompt = () => signIn
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_never))
    press(button(en.passkeys_never))
    await vi.waitFor(() => expect(sent('passkeyAnswer')).toHaveLength(1))
    expect(sent('passkeyAnswer')[0]).toMatchObject({ action: 'never' })
  })
})

describe('the keyboard', () => {
  it('takes none by itself: nothing in the card is focused when it opens', async () => {
    handlers.passkeyPrompt = () => prompt()
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_save))
    expect(document.activeElement).toBe(document.body)
    document.body.innerHTML = ''
    render(null, document.body)
    handlers.passkeyPrompt = () => signIn
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(document.activeElement).toBe(document.body)
  })

  it('does not save or sign on a key the person never moved to the card for', async () => {
    handlers.passkeyPrompt = () => prompt()
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_save))
    keyed(button(en.passkeys_save))
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_click))
    expect(channel.permit).not.toHaveBeenCalled()
    expect(sent('passkeyAnswer')).toEqual([])
    // A key says no without any of that
    keyed(button(en.passkeys_other))
    await vi.waitFor(() => expect(sent('passkeyAnswer')).toHaveLength(1))
    expect(sent('passkeyAnswer')[0]).toMatchObject({ action: 'other' })
  })

  it('does not sign on a key either, until the person tabs into the card', async () => {
    handlers.passkeyPrompt = () => signIn
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    keyed(rows()[0]!)
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_click))
    expect(sent('passkeyAnswer')).toEqual([])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    keyed(rows()[0]!)
    await vi.waitFor(() => expect(sent('passkeyAnswer')).toHaveLength(1))
    expect(sent('passkeyAnswer')[0]).toMatchObject({ action: 'use', passkeyId: 'p1' })
  })

  it('counts an arrow key as moving into the card, and another key as nothing', async () => {
    handlers.passkeyPrompt = () => prompt()
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_save))
    for (const key of ['Enter', ' ', 'a', 'Shift'])
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    keyed(button(en.passkeys_save))
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_click))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    keyed(button(en.passkeys_save))
    await vi.waitFor(() => expect(sent('passkeyAnswer')).toHaveLength(1))
  })
})

describe('the card’s secret', () => {
  it('is what it asks and answers under, and without one nothing is asked', async () => {
    handlers.passkeyPrompt = () => prompt()
    mount(init({ token: undefined }))
    await vi.waitFor(() => expect(shown()).toContain(en.menu_failed))
    expect(sent('passkeyPrompt')).toEqual([])
  })
})

describe('a credential the vault holds', () => {
  it('is said on the card, which offers to close it and not to save', async () => {
    handlers.passkeyPrompt = () => prompt({ alreadyHeld: true })
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_already))
    // The title still says what the site asked; no button saves
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      en.passkeys_save,
    )
    press(button(en.passkeys_close))
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(false))
    expect(sent('passkeyAnswer')).toEqual([
      { kind: 'passkeyAnswer', tabId: 4, token: 'tok', action: 'dismiss' },
    ])
  })
})

describe('the card', () => {
  it('asks for the vault’s password while it is locked, and shows the passkeys once it opens', async () => {
    let unlocked = false
    handlers.passkeyPrompt = () =>
      unlocked
        ? signIn
        : prompt({
            kind: 'get',
            state: { exists: true, unlocked: false, wrongPasswords: 2 },
            choices: [],
          })
    handlers.unlock = () => {
      unlocked = true
      return { ok: true, wrongPasswords: 0 }
    }
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_locked_title))
    expect(shown()).toContain(en.passkeys_other)
    expect(shown()).not.toContain(en.passkeys_get_title)
    const password = document.querySelector<HTMLInputElement>('input[type=password]')!
    password.value = 'correct horse'
    password.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(button(en.menu_unlock).disabled).toBe(false))
    button(en.menu_unlock).click()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(sent('passkeyPrompt')).toHaveLength(2)
  })

  it('goes when the request is over', async () => {
    handlers.passkeyPrompt = () => null
    mount()
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(false))
  })

  it('says so when it cannot be had', async () => {
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_failed))
  })

  it('takes Escape as a no, and tells the page it was not allowed', async () => {
    handlers.passkeyPrompt = () => prompt()
    handlers.passkeyAnswer = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.passkeys_save))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(true))
    expect(sent('passkeyAnswer')).toEqual([
      { kind: 'passkeyAnswer', tabId: 4, token: 'tok', action: 'cancel' },
    ])
  })

  it('reports its height to the content script', async () => {
    handlers.passkeyPrompt = () => prompt()
    mount()
    await vi.waitFor(() => expect(channel.size).toHaveBeenCalled())
  })
})

describe('a field’s menu for a conditional request', () => {
  const login = (id: string, name: string, username: string): LoginView => ({
    id,
    name,
    username,
    websites: [],
    websiteRules: [],
    fields: [],
    links: 0,
    tags: [],
    order: 0,
    hasPassword: true,
    strength: 3,
    previousPasswords: 0,
    health: { reused: false, weak: false, withoutItsCode: false, ignored: false },
  })
  const view = (over: Partial<MenuView> = {}): MenuView => ({
    state: { exists: true, unlocked: true, wrongPasswords: 0, fileSync: 'readOnly' },
    match: { site: 'orbit-cloud.com', logins: ['l1'], codes: [] },
    logins: [login('l1', 'Orbit Cloud', 'alice')],
    codes: [],
    field: { kind: 'username' },
    passkeys: [{ id: 'p1', name: 'Orbit Cloud', detail: 'Sam' }],
    ...over,
  })
  const menuInit = init({ mode: 'menu', fieldId: 'f1' })
  const mountMenu = () => render(<App channel={channel} init={menuInit} />, document.body)

  it('lists the passkeys above the logins, and answers the request with the one picked', async () => {
    handlers.menu = () => view()
    handlers.passkeyChoose = () => undefined
    mountMenu()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[0]!.textContent).toContain('Sam')
    expect(rows()[0]!.textContent).toContain(en.passkeys_kind)
    expect(rows()[1]!.textContent).toContain('alice')
    rows()[0]!.click()
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(true))
    expect(sent('passkeyChoose')).toEqual([
      { kind: 'passkeyChoose', tabId: 4, frameId: 0, fieldId: 'f1', passkeyId: 'p1' },
    ])
  })

  it('is the whole list for a site that has only passkeys, with no word of there being no login', async () => {
    handlers.menu = () =>
      view({ match: { site: 'orbit-cloud.com', logins: [], codes: [], passkeys: ['p1'] } })
    mountMenu()
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    expect(shown()).not.toContain(contentEn.menu_empty_logins)
    expect(shown()).not.toContain(contentEn.menu_unknown_site)
  })

  it('lists none in a field that wants a code', async () => {
    handlers.menu = () =>
      view({ field: { kind: 'code' }, match: { site: 'orbit-cloud.com', logins: [], codes: [] } })
    mountMenu()
    await vi.waitFor(() => expect(shown()).toContain(contentEn.menu_empty_codes))
    expect(shown()).not.toContain('Sam')
  })

  it('refuses a click the gate refuses', async () => {
    handlers.menu = () => view()
    channel.permit.mockResolvedValue({ ok: false, why: 'wait' })
    mountMenu()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    rows()[0]!.click()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_gate_wait))
    expect(sent('passkeyChoose')).toEqual([])
  })
})
