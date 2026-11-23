// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { CodeView, LoginView } from '../shared/api'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  backup,
  background,
  button,
  change,
  choose,
  click,
  code,
  input,
  installChrome,
  login,
  message,
  mount,
  selectOf,
  submit,
  text,
  unlockedHandlers,
  unmountAll,
  type FakeChrome,
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

const orbitCode = code({ id: 'c1', loginId: 'l1' })
const spare = code({ id: 'c2', issuer: 'Spare', account: 'sam', websites: [] })
const orbitLogin = login({
  id: 'l1',
  codeId: 'c1',
  tags: ['Work'],
  previousPasswords: 2,
  passwordChangedAt: Date.parse('2026-10-01T12:00:00Z'),
})
const docs = login({
  id: 'l3',
  name: 'Docs',
  username: 'sam',
  websites: ['https://docs.example.org'],
  tags: ['Personal'],
  health: { reused: false, weak: false, withoutItsCode: true, ignored: false },
})

let fake: FakeChrome

const world = (over: Partial<World> = {}): World => ({
  codes: [orbitCode, spare] as CodeView[],
  logins: [orbitLogin, docs] as LoginView[],
  ...over,
})

/** Opens a login's page from the Logins list. */
async function openLogin(root: HTMLElement, name: string): Promise<void> {
  await click(button(root, 'Logins 2'))
  await click(button(root, `Open ${name}`))
}

beforeEach(() => {
  fake = installChrome()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

describe('a login’s page', () => {
  it('shows its websites, username, strength, change date and previous passwords, and hides its password', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      showPassword: (() => 'hunter2') as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Orbit Cloud')
    expect(text(root)).toContain('orbit-cloud.com')
    expect(text(root)).toContain('sam@example.com')
    expect(text(root)).toContain('Strong · changed')
    expect(text(root)).toContain(message('en', 'popup_previousCount', ['2']))
    expect(text(root)).toContain(message('en', 'popup_passwordHidden'))
    expect(text(root)).not.toContain('hunter2')

    await click(button(root, 'Show'))
    expect(text(root)).toContain('hunter2')
    expect(background.of('showPassword')[0]?.args).toEqual({ id: 'l1' })

    await click(button(root, message('en', 'popup_copyUsernameOf', ['Orbit Cloud'])))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'username', id: 'l1' })
  })

  it('lists the backup codes left, copies one and marks it used', async () => {
    let left = 8
    background.reset({
      ...unlockedHandlers(world()),
      backupCodes: (() => [backup({ left })]) as never,
      useBackupCode: (() => {
        left -= 1
      }) as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Orbit Cloud')
    expect(text(root)).toContain('8 of 10 left')

    await click(button(root, 'Copy a backup code of Orbit Cloud'))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'backupCode', id: 'c1' })
    await click(button(root, 'Mark a backup code of Orbit Cloud used'))
    expect(background.of('useBackupCode')[0]?.args).toEqual({ serviceId: 'c1' })
    expect(text(root)).toContain('7 of 10 left')
  })

  it('stops the “without its code” warning for a login', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      ignoreHealth: (() => undefined) as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Docs')
    expect(text(root)).toContain(message('en', 'popup_warnNoCode'))
    await click(button(root, 'Don’t warn for this login'))
    expect(background.of('ignoreHealth')[0]?.args).toEqual({ id: 'l3', ignored: true })
  })

  it('links a code to a login without one', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      linkCode: (() => undefined) as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Docs')
    await choose(selectOf(root, 'Link a code'), 'c2')
    expect(background.of('linkCode')[0]?.args).toEqual({ codeId: 'c2', loginId: 'l3' })
  })

  it('lists the sites remembered for it, with Forget', async () => {
    let remembered = ['id.orbitauth.net']
    background.reset({
      ...unlockedHandlers(world()),
      rememberedSites: (() => remembered) as never,
      forgetSite: (() => {
        remembered = []
      }) as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Orbit Cloud')
    expect(text(root)).toContain('id.orbitauth.net')
    await click(button(root, 'Forget id.orbitauth.net'))
    expect(background.of('forgetSite')[0]?.args).toEqual({
      loginId: 'l1',
      host: 'id.orbitauth.net',
    })
    expect(text(root)).not.toContain('id.orbitauth.net')
  })

  it('deletes a login only after confirming', async () => {
    let logins = [orbitLogin, docs]
    background.reset({
      ...unlockedHandlers(world()),
      logins: (() => logins) as never,
      deleteLogin: ((args: { id: string }) => {
        logins = logins.filter((item) => item.id !== args.id)
      }) as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Docs')
    await click(button(root, 'Delete login'))
    expect(text(root)).toContain(message('en', 'popup_deleteTitle'))
    expect(background.of('deleteLogin')).toHaveLength(0)

    await click(button(root, 'Delete'))
    expect(background.of('deleteLogin')[0]?.args).toEqual({ id: 'l3' })
    expect(button(root, 'Open Docs')).toBeNull()
  })

  it('offers no tool that asks for Premium on its backup codes', async () => {
    background.reset({
      ...unlockedHandlers(world({ backups: [backup()] })),
    })
    const root = await openPopup()
    await openLogin(root, 'Orbit Cloud')
    expect(text(root)).not.toMatch(/premium|upgrade|new codes|coverage|locked/i)
  })
})

describe('editing a login', () => {
  it('reads the password, saves the changes with the vault’s tags untouched and relinks the code', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      showPassword: (() => 'hunter2') as never,
      saveLogin: ((args: { id: string | null }) => ({ ...docs, id: args.id ?? 'new' })) as never,
      linkCode: (() => undefined) as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Docs')
    await click(button(root, 'Edit'))
    expect(background.of('showPassword').at(-1)?.args).toEqual({ id: 'l3' })
    expect(input(root, 'Password')!.value).toBe('hunter2')

    await change(input(root, 'Username or email'), 'new@example.com')
    await change(input(root, 'Password'), 'n3w-secret')
    await choose(selectOf(root, 'Two-step code'), 'c2')
    await submit(root.querySelector('form'))

    expect(background.of('saveLogin')[0]?.args).toMatchObject({
      id: 'l3',
      input: {
        name: 'Docs',
        username: 'new@example.com',
        password: 'n3w-secret',
        websites: ['https://docs.example.org'],
        tags: ['Personal'],
      },
    })
    expect(background.of('linkCode')[0]?.args).toEqual({ codeId: 'c2', loginId: 'l3' })
  })

  it('fills the password from Generate with the remembered choices', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      showPassword: (() => 'hunter2') as never,
      generate: (() => 'Gen3rated-Pass') as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Docs')
    await click(button(root, 'Edit'))
    await click(button(root, 'Generate'))
    expect(input(root, 'Password')!.value).toBe('Gen3rated-Pass')
    expect(background.of('generate')[0]?.args).toMatchObject({
      options: { mode: 'random', length: 20 },
    })
  })

  it('refuses a login with neither a username nor a password', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      saveLogin: (() => docs) as never,
    })
    const root = await openPopup()
    await openLogin(root, 'Docs')
    await click(button(root, 'Edit'))
    await change(input(root, 'Username or email'), '')
    await change(input(root, 'Password'), '')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(message('en', 'popup_needsSecret'))
    expect(background.of('saveLogin')).toHaveLength(0)
  })
})

describe('adding a code', () => {
  const tab = {
    tabId: 4,
    address: 'https://docs.example.org/security',
    match: { site: 'example.org', logins: ['l3'], codes: [] },
  }

  it('says when the page shows no code, and adds nothing', async () => {
    background.reset({
      ...unlockedHandlers(world({ tab })),
      addCodeFromTab: (() => null) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Add a code'))
    await click(button(root, 'Scan this page'))
    expect(background.of('addCodeFromTab')[0]?.args).toEqual({ tabId: 4 })
    expect(text(root)).toContain(message('en', 'popup_noCodeFound'))
  })

  it('adds the code found, then offers to link it to the site’s login', async () => {
    const added = code({ id: 'new', issuer: 'Docs', account: 'sam', websites: ['example.org'] })
    background.reset({
      ...unlockedHandlers(world({ tab })),
      addCodeFromTab: (() => added) as never,
      linkCode: (() => undefined) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Add a code'))
    await click(button(root, 'Scan this page'))
    expect(text(root)).toContain('Added Docs · sam')

    await click(button(root, 'Link to the Docs login'))
    expect(background.of('linkCode')[0]?.args).toEqual({ codeId: 'new', loginId: 'l3' })
    expect(text(root)).toContain(message('en', 'popup_codeLinkedTo', ['Docs']))
  })

  it('adds a pasted otpauth link', async () => {
    const link = 'otpauth://totp/Orbit:sam?secret=JBSWY3DPEHPK3PXP&issuer=Orbit'
    background.reset({
      ...unlockedHandlers(world()),
      addCodeFromLink: (() => code({ id: 'o', issuer: 'Orbit', account: 'sam' })) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Add a code'))
    await change(input(root, 'Paste an otpauth:// link'), link)
    await submit(root.querySelectorAll('form')[0] ?? null)
    expect(background.of('addCodeFromLink')[0]?.args).toEqual({ otpauth: link })
    expect(text(root)).toContain('Added Orbit · sam')
  })

  it('names the account already holding a code, and adds nothing', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      addCodeFromLink: (() => {
        throw new Error('That code is already the Orbit Cloud account.')
      }) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Add a code'))
    await change(input(root, 'Paste an otpauth:// link'), 'otpauth://totp/x?secret=AAAA')
    await submit(root.querySelectorAll('form')[0] ?? null)
    expect(text(root)).toContain('That code is already the Orbit Cloud account.')
    expect(text(root)).not.toContain('Added')
  })
})

describe('password health', () => {
  it('lists reused, weak and without-code logins, and stops a warning', async () => {
    const linear = login({ id: 'l2', name: 'Linear' })
    background.reset({
      ...unlockedHandlers(world({ logins: [orbitLogin, linear, docs] })),
      health: (() => ({
        reused: ['l1', 'l2'],
        weak: [],
        withoutItsCode: ['l3'],
        breached: ['l1'],
      })) as never,
      ignoreHealth: (() => undefined) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Logins 3'))
    await click(
      [...root.querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Password health'),
      ) ?? null,
    )
    expect(text(root)).toContain('Passwords used twice · 2')
    expect(text(root)).toContain('Without their code · 1')
    expect(text(root)).not.toContain('Weak passwords')
    expect(text(root)).toContain(message('en', 'popup_breachOff'))
    expect(text(root)).not.toContain('Seen in data breaches')

    await click(button(root, message('en', 'popup_dontWarnOf', ['Docs'])))
    expect(background.of('ignoreHealth')[0]?.args).toEqual({ id: 'l3', ignored: true })
  })
})

describe('the generator', () => {
  const open = async () => {
    const root = await openPopup()
    await click(button(root, 'Generate a password'))
    return root
  }

  it('opens at the app’s defaults and copies the password it made', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      generate: (() => 'Xy7!made-password') as never,
    })
    const root = await open()
    expect(text(root)).toContain('Length: 20')
    expect(root.querySelector('output')?.textContent).toBe('Xy7!made-password')
    expect(background.of('generate')[0]?.args).toEqual({
      options: {
        mode: 'random',
        length: 20,
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
        avoidLookAlikes: true,
      },
    })
    await click(button(root, 'Copy'))
    expect(background.of('copy')[0]?.args).toEqual({
      what: 'generated',
      id: 'generator',
      value: 'Xy7!made-password',
    })
  })

  it('remembers the length in this browser, and opens at it later', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      generate: (() => 'abc') as never,
    })
    let root = await open()
    await change(input(root, 'Length: 20'), '32')
    expect(background.of('generate').at(-1)?.args).toMatchObject({ options: { length: 32 } })
    expect(fake.storage['kemlock_popup_generator']).toMatchObject({ length: 32, mode: 'random' })
    unmountAll()

    root = await open()
    expect(text(root)).toContain('Length: 32')
  })

  it('makes a passphrase of the app’s defaults', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      generate: (() => 'alpha-bravo-charlie-delta-echo') as never,
    })
    const root = await open()
    await click(root.querySelector('input[type="radio"][value="passphrase"]'))
    expect(text(root)).toContain('Words: 5')
    expect(background.of('generate').at(-1)?.args).toEqual({
      options: {
        mode: 'passphrase',
        words: 5,
        separator: '-',
        capitalize: false,
        includeNumber: false,
      },
    })
  })
})

describe('recently generated passwords', () => {
  it('lists them with their site, copies one and saves it as a login', async () => {
    const at = Date.parse('2026-11-20T09:30:00Z')
    background.reset({
      ...unlockedHandlers(world()),
      generate: (() => 'abc') as never,
      recentPasswords: (() => [
        { value: 'pw-recent-1', at, site: 'https://id.example.com' },
      ]) as never,
      saveLogin: (() => docs) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Generate a password'))
    await click(button(root, 'Recently generated'))
    expect(text(root)).toContain('id.example.com')
    expect(text(root)).not.toContain('pw-recent-1')

    await click(button(root, 'Copy the password of id.example.com'))
    expect(background.of('copy')[0]?.args).toEqual({
      what: 'generated',
      id: String(at),
      value: 'pw-recent-1',
    })

    await click(button(root, 'Save the password of id.example.com as a login'))
    expect(input(root, 'Password')!.value).toBe('pw-recent-1')
    await submit(root.querySelector('form'))
    expect(background.of('saveLogin')[0]?.args).toMatchObject({
      id: null,
      input: {
        name: 'id.example.com',
        password: 'pw-recent-1',
        websites: ['https://id.example.com'],
      },
    })
  })
})
