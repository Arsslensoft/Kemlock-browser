// @vitest-environment jsdom
// Needs the Preact JSX transform in vitest.config.ts (`oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } }`).
import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CodeView, LoginView, MenuView, PendingSave } from '../shared/api'
import { App, ignoredText } from './App'
import type { Channel, Init } from './channel'
import type { Verdict } from './gate'
import enMessages from '../../locales/parts/content.en.json'

const en: Record<string, string> = enMessages

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

const code = (id: string, issuer: string, account: string, onSecurityKey = false): CodeView => ({
  id,
  issuer,
  account,
  type: 'totp',
  digits: 6,
  period: 30,
  tags: [],
  order: 0,
  onSecurityKey,
  websites: [],
  ownWebsites: [],
  fields: [],
  links: 0,
})

const view = (over: Partial<MenuView> = {}): MenuView => ({
  state: { exists: true, unlocked: true, wrongPasswords: 0, fileSync: 'readOnly' },
  match: { site: 'orbit-cloud.com', logins: [], codes: [] },
  logins: [],
  codes: [],
  field: { kind: 'username' },
  ...over,
})

const init = (over: Partial<Init> = {}): Init => ({
  mode: 'menu',
  tabId: 4,
  frameId: 0,
  fieldId: 'f1',
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

function mount(options: Init = init()) {
  render(<App channel={channel} init={options} />, document.body)
}

const sent = (kind: string) =>
  sendMessage.mock.calls.map(([m]) => m as { kind: string }).filter((m) => m.kind === kind)

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-row]'))
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!
const shown = () => document.body.textContent ?? ''

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
  vi.stubGlobal('chrome', {
    i18n: { getMessage: message },
    runtime: { sendMessage },
  })
  document.body.innerHTML = ''
})

afterEach(() => {
  render(null, document.body)
  vi.unstubAllGlobals()
})

describe('the list for a field', () => {
  const orbit = view({
    match: { site: 'orbit-cloud.com', logins: ['l1', 'l2'], codes: [] },
    logins: [login('l1', 'Orbit Cloud', 'alice'), login('l2', 'Orbit Cloud', 'bob')],
  })

  it('lists each matching login by name and username', async () => {
    handlers.menu = () => orbit
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[0].textContent).toContain('Orbit Cloud')
    expect(rows()[0].textContent).toContain('alice')
    expect(rows()[1].textContent).toContain('bob')
    expect(sent('menu')[0]).toEqual({ kind: 'menu', tabId: 4, frameId: 0, fieldId: 'f1' })
  })

  it('fills the login picked, after the gate lets the click count', async () => {
    handlers.menu = () => orbit
    handlers.fill = () => undefined
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    rows()[1].click()
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(true))
    expect(channel.permit).toHaveBeenCalledTimes(1)
    expect(sent('fill')).toEqual([
      { kind: 'fill', tabId: 4, frameId: 0, fieldId: 'f1', loginId: 'l2' }, // no picked: the background checks the site
    ])
  })

  it('ignores a click the gate refuses, and says why', async () => {
    handlers.menu = () => orbit
    handlers.fill = () => undefined
    channel.permit.mockResolvedValue({ ok: false, why: 'wait' })
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    rows()[0].click()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_gate_wait))
    expect(sent('fill')).toEqual([])
    expect(channel.close).not.toHaveBeenCalled()
  })

  it('has a sentence for each reason a click is ignored', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: message } })
    expect(ignoredText('faded')).toBe(en.menu_gate_faded)
    expect(ignoredText('covered')).toBe(en.menu_gate_covered)
    expect(ignoredText('hidden')).toBe(en.menu_gate_hidden)
    expect(ignoredText('silent')).toBe(en.menu_gate_hidden)
  })

  it('lists the codes for a code field, and leaves one on a security key unfillable', async () => {
    handlers.menu = () =>
      view({
        field: { kind: 'code' },
        match: { site: 'orbit-cloud.com', logins: [], codes: ['c1', 'c2'] },
        codes: [code('c1', 'Orbit Cloud', 'alice'), code('c2', 'Orbit Bank', 'alice', true)],
      })
    handlers.fill = () => undefined
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[1].getAttribute('aria-disabled')).toBe('true')
    expect(rows()[1].textContent).toContain(en.menu_kept_on_key)
    rows()[1].click()
    rows()[0].click()
    await vi.waitFor(() => expect(sent('fill')).toHaveLength(1))
    expect(sent('fill')[0]).toMatchObject({ codeId: 'c1' })
  })

  it('says so when the view cannot be had', async () => {
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_failed))
  })
})

describe('an unknown site', () => {
  const unknown = view({
    match: { site: 'id.orbitauth.net', logins: [], codes: [] },
    logins: [login('l1', 'Orbit Cloud', 'alice'), login('l2', 'Harbor Notes', 'bob')],
  })

  it('says it does not know the site, and lists every login with search', async () => {
    handlers.menu = () => unknown
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_unknown_site))
    expect(rows().filter((r) => r.tagName === 'BUTTON')).toHaveLength(2)
    const search = document.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = 'harbor'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0].textContent).toContain('Harbor Notes')
  })

  it('shows the address it fills, then fills with "Always suggest here"', async () => {
    handlers.menu = () => unknown
    handlers.fill = () => undefined
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    rows()[0].click()
    await vi.waitFor(() => expect(shown()).toContain('id.orbitauth.net'))
    expect(shown()).toContain(message('menu_confirm_title', ['Orbit Cloud']))
    const always = document.querySelector<HTMLInputElement>('input[type=checkbox]')!
    always.click()
    button(en.menu_fill).click()
    await vi.waitFor(() => expect(sent('fill')).toHaveLength(1))
    expect(sent('fill')[0]).toEqual({
      kind: 'fill',
      tabId: 4,
      frameId: 0,
      fieldId: 'f1',
      loginId: 'l1',
      remember: true,
      picked: true,
    })
  })

  it('fills nothing until the address was confirmed', async () => {
    handlers.menu = () => unknown
    handlers.fill = () => undefined
    mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    rows()[0].click()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_confirm_address))
    expect(sent('fill')).toEqual([])
    expect(channel.permit).not.toHaveBeenCalled()
  })
})

describe('the look-alike guard', () => {
  const lookalike = view({
    match: { site: 'orbit-c1oud.com', logins: [], codes: [], lookAlikeOf: 'orbit-cloud.com' },
    logins: [login('l1', 'Orbit Cloud', 'alice')],
  })

  it('says it is not the known site, with the difference marked', async () => {
    handlers.menu = () => lookalike
    mount()
    await vi.waitFor(() =>
      expect(shown()).toContain(message('menu_guard_title', ['orbit-cloud.com'])),
    )
    const marks = Array.from(document.querySelectorAll('mark')).map((m) => m.textContent)
    expect(marks).toEqual(['1', 'l'])
    expect(rows()).toHaveLength(0)
  })

  it("makes Don't fill the main action", async () => {
    handlers.menu = () => lookalike
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_dont_fill))
    const dont = button(en.menu_dont_fill)
    expect(dont.className).toContain('primary')
    dont.click()
    expect(channel.close).toHaveBeenCalledWith(true)
  })

  it('needs the login picked and the address confirmed, with no "Always suggest here"', async () => {
    handlers.menu = () => lookalike
    handlers.fill = () => undefined
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_pick_anyway))
    button(en.menu_pick_anyway).click()
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    rows()[0].click()
    await vi.waitFor(() => expect(shown()).toContain('orbit-c1oud.com'))
    expect(document.querySelector('input[type=checkbox]')).toBeNull()
    button(en.menu_fill).click()
    await vi.waitFor(() => expect(sent('fill')).toHaveLength(1))
    expect(sent('fill')[0]).not.toHaveProperty('remember')
    expect(sent('fill')[0]).toMatchObject({ picked: true })
  })
})

describe('a locked vault', () => {
  it('asks for the password in the menu, then lists', async () => {
    let unlocked = false
    handlers.menu = () =>
      unlocked
        ? view({
            match: { site: 'orbit-cloud.com', logins: ['l1'], codes: [] },
            logins: [login('l1', 'Orbit Cloud', 'alice')],
          })
        : view({
            state: { exists: true, unlocked: false, wrongPasswords: 0, fileSync: 'readOnly' },
          })
    handlers.unlock = (args) => {
      unlocked = args.password === 'correct horse'
      return { ok: unlocked, wrongPasswords: unlocked ? 0 : 1 }
    }
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_locked_title))
    const field = document.querySelector<HTMLInputElement>('input[type=password]')!
    const submit = async (password: string) => {
      field.value = password
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.waitFor(() => expect(button(en.menu_unlock).disabled).toBe(false))
      document
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }
    await submit('wrong')
    await vi.waitFor(() => expect(shown()).toContain(en.menu_wrong))
    await submit('correct horse')
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    expect(sent('unlock').map((m) => (m as unknown as { password: string }).password)).toEqual([
      'wrong',
      'correct horse',
    ])
  })

  it('points to setup when there is no vault', async () => {
    handlers.menu = () =>
      view({ state: { exists: false, unlocked: false, wrongPasswords: 0, fileSync: 'readOnly' } })
    mount()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_no_vault))
  })
})

describe('new-password suggestions', () => {
  const suggestion = view({
    field: { kind: 'newPassword' },
    suggestions: ['Zq7!kT2#mRw9&vLx', 'tulip-ocean-brick-lamp-seven'],
  })

  it('offers a strong password and a passphrase, and fills the one picked', async () => {
    handlers.menu = () => suggestion
    handlers.fill = () => undefined
    mount(init({ siteRules: 'maxlength: 16' }))
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[0].textContent).toContain(en.menu_suggest_strong)
    expect(rows()[0].textContent).toContain('Zq7!kT2#mRw9&vLx')
    rows()[0].click()
    await vi.waitFor(() => expect(sent('fill')).toHaveLength(1))
    expect(sent('fill')[0]).toEqual({
      kind: 'fill',
      tabId: 4,
      frameId: 0,
      fieldId: 'f1',
      newPassword: 'Zq7!kT2#mRw9&vLx',
    })
    expect(channel.close).toHaveBeenCalledWith(true)
  })

  it("suggests others with the site's rules", async () => {
    handlers.menu = () => suggestion
    handlers.generate = (args) => {
      const mode = (args.options as { mode: string }).mode
      return mode === 'random' ? 'Another16Chars!!' : 'new-words-here'
    }
    mount(init({ siteRules: 'maxlength: 16' }))
    await vi.waitFor(() => expect(rows()).toHaveLength(2))
    button(en.menu_suggest_again).click()
    await vi.waitFor(() => expect(rows()[0].textContent).toContain('Another16Chars!!'))
    expect(sent('generate')[0]).toMatchObject({
      options: { mode: 'random', siteRules: 'maxlength: 16' },
    })
  })
})

describe('the save prompt', () => {
  const prompt = init({ mode: 'save', fieldId: '' })

  it('asks "Save to Kemlock?" with the site and username, and saves after the gate', async () => {
    handlers.pendingSave = (): PendingSave => ({ site: 'harbornotes.app', username: 'sam' })
    handlers.answerSave = () => undefined
    mount(prompt)
    await vi.waitFor(() => expect(shown()).toContain(en.menu_save_title))
    expect(shown()).toContain('harbornotes.app')
    expect(shown()).toContain('sam')
    button(en.menu_save).click()
    await vi.waitFor(() => expect(sent('answerSave')).toHaveLength(1))
    expect(sent('answerSave')[0]).toEqual({ kind: 'answerSave', tabId: 4, save: true })
    expect(channel.permit).toHaveBeenCalledTimes(1)
    expect(channel.close).toHaveBeenCalledWith(false)
  })

  it('asks "Update in Kemlock?" for a changed password', async () => {
    handlers.pendingSave = (): PendingSave => ({
      site: 'github.com',
      username: 'octo',
      updateOf: 'l9',
    })
    mount(prompt)
    await vi.waitFor(() => expect(shown()).toContain(en.menu_update_title))
    expect(button(en.menu_update)).toBeDefined()
  })

  it('saves nothing when the gate refuses the click', async () => {
    handlers.pendingSave = (): PendingSave => ({ site: 'harbornotes.app', username: 'sam' })
    handlers.answerSave = () => undefined
    channel.permit.mockResolvedValue({ ok: false, why: 'covered' })
    mount(prompt)
    await vi.waitFor(() => expect(shown()).toContain(en.menu_save_title))
    button(en.menu_save).click()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_gate_covered))
    expect(sent('answerSave')).toEqual([])
  })

  it('answers Not now and Never for this site without a save', async () => {
    handlers.pendingSave = (): PendingSave => ({ site: 'harbornotes.app', username: 'sam' })
    handlers.answerSave = () => undefined
    mount(prompt)
    await vi.waitFor(() => expect(shown()).toContain(en.menu_save_title))
    button(en.menu_never).click()
    await vi.waitFor(() => expect(sent('answerSave')).toHaveLength(1))
    expect(sent('answerSave')[0]).toEqual({
      kind: 'answerSave',
      tabId: 4,
      save: false,
      never: true,
    })
  })

  it('lets Not now and Never for this site answer only after the gate, and says why when it refuses', async () => {
    handlers.pendingSave = (): PendingSave => ({ site: 'harbornotes.app', username: 'sam' })
    handlers.answerSave = () => undefined
    channel.permit.mockResolvedValue({ ok: false, why: 'covered' })
    mount(prompt)
    await vi.waitFor(() => expect(shown()).toContain(en.menu_save_title))
    button(en.menu_not_now).click()
    await vi.waitFor(() => expect(shown()).toContain(en.menu_gate_covered))
    button(en.menu_never).click()
    await vi.waitFor(() => expect(channel.permit).toHaveBeenCalledTimes(2))
    expect(sent('answerSave')).toEqual([])
    expect(channel.close).not.toHaveBeenCalled()
  })

  it('answers Not now through the gate', async () => {
    handlers.pendingSave = (): PendingSave => ({ site: 'harbornotes.app', username: 'sam' })
    handlers.answerSave = () => undefined
    mount(prompt)
    await vi.waitFor(() => expect(shown()).toContain(en.menu_save_title))
    button(en.menu_not_now).click()
    await vi.waitFor(() => expect(sent('answerSave')).toHaveLength(1))
    expect(sent('answerSave')[0]).toEqual({ kind: 'answerSave', tabId: 4, save: false })
    expect(channel.permit).toHaveBeenCalledTimes(1)
  })

  it('closes itself when nothing is pending', async () => {
    handlers.pendingSave = () => null
    mount(prompt)
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledWith(false))
  })
})
