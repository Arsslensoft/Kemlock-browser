// @vitest-environment jsdom
// The setup tab rendered over a mocked `ask`: the steps of the specs, as a person goes through them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { ask } from './send'
import { makeGetMessage } from './testkit'

vi.mock('./send', () => ({ ask: vi.fn() }))

const root = join(import.meta.dirname, '..', '..')
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>
const messages = { ...read('locales/parts/setup.en.json'), ...read('locales/app/en.json') }

type Handler = (args: Record<string, unknown>) => unknown
let handlers: Record<string, Handler>
let container: HTMLElement
let request: ReturnType<typeof vi.fn>
let createTab: ReturnType<typeof vi.fn>

const existing = { exists: true, unlocked: true, wrongPasswords: 0 }

beforeEach(() => {
  handlers = { popup: () => ({ state: existing }) }
  vi.mocked(ask).mockReset()
  vi.mocked(ask).mockImplementation(((kind: string, args?: Record<string, unknown>) => {
    const handler = handlers[kind]
    if (handler === undefined) throw new Error(`unexpected ask ${kind}`)
    return Promise.resolve(handler(args ?? {}))
  }) as never)
  request = vi.fn(() => Promise.resolve(true))
  createTab = vi.fn()
  vi.stubGlobal('chrome', {
    i18n: { getMessage: makeGetMessage(messages), getUILanguage: () => 'en' },
    permissions: { request },
    tabs: { create: createTab },
    action: { openPopup: vi.fn(() => Promise.resolve()) },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  window.history.replaceState(null, '', '#')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const settle = () =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  })

const open = async () => {
  // Rendered inside act so Preact's effects (App's boot, the heading's focus) run now, not on the
  // next animation frame or its 100 ms fallback timer
  await act(() => {
    render(<App />, container)
  })
  await settle()
}

const heading = () => container.querySelector('h1')?.textContent
const text = () => container.textContent ?? ''

const button = (label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').trim().startsWith(label),
  )
  if (found === undefined) throw new Error(`no button "${label}" in: ${text()}`)
  return found
}

const field = (label: string): HTMLInputElement => {
  const found = [...container.querySelectorAll('label')].find(
    (l) => l.htmlFor !== '' && l.textContent === label,
  )
  const input = found === undefined ? null : document.getElementById(found.htmlFor)
  if (input === null) throw new Error(`no field "${label}" in: ${text()}`)
  return input as HTMLInputElement
}

const radio = (label: string): HTMLInputElement => {
  const found = [...container.querySelectorAll('label.radio')].find((l) =>
    (l.textContent ?? '').startsWith(label),
  )
  const input = found?.querySelector('input')
  if (input === null || input === undefined) throw new Error(`no choice "${label}" in: ${text()}`)
  return input
}

const type = async (label: string, value: string) => {
  const input = field(label)
  await act(() => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = async (label: string) => {
  const target = button(label)
  await act(() => {
    target.click()
  })
  await settle()
}

const pick = async (label: string) => {
  const target = radio(label)
  await act(() => {
    target.click()
  })
  await settle()
}

/** From the place step to the sign-in form of `place`, at the address typed. */
const toForm = async (
  place: 'Kemlock Server' | 'WebDAV folder' | 'Vaultwarden',
  address: string,
) => {
  handlers.checkServer = () => ({ ok: true })
  await click(place)
  await type(place === 'WebDAV folder' ? 'Folder address' : 'Server address', address)
  await click('Continue')
  await click('Allow access to')
}

const second = (methods: string[], unsupported: string[] = []) => ({
  step: 'second',
  methods,
  unsupported,
})

describe('first run', () => {
  it('asks for the browser password twice, then offers the places, Kemlock Server first', async () => {
    handlers.popup = () => ({ state: { exists: false, unlocked: false, wrongPasswords: 0 } })
    handlers.createVault = () => undefined
    await open()
    expect(heading()).toBe('A password for this browser')
    expect(document.activeElement).toBe(container.querySelector('h1'))
    expect(text()).toContain('Step 1 of 4')

    await type('Browser password', 'Abcdefghijk1')
    await type('Type it again', 'Abcdefghijk2')
    expect(text()).toContain("The passwords don't match")
    expect(button('Create the vault').disabled).toBe(true)

    await type('Type it again', 'Abcdefghijk1')
    expect(text()).toContain('The passwords match')
    expect(button('Create the vault').disabled).toBe(false)

    await click('Create the vault')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('createVault', { password: 'Abcdefghijk1' })
    expect(heading()).toBe('Where does your phone sync?')
    const choices = [...container.querySelectorAll('.choice-title')].map((e) => e.textContent)
    expect(choices).toEqual(['Kemlock Server', 'WebDAV folder', 'Vaultwarden'])
    expect(text()).toContain('Settings › Sync')
  })

  it('does not make a vault from a weak password', async () => {
    handlers.popup = () => ({ state: { exists: false, unlocked: false, wrongPasswords: 0 } })
    await open()
    await type('Browser password', 'abc')
    await type('Type it again', 'abc')
    expect(button('Create the vault').disabled).toBe(true)
    expect(container.querySelector('.level-name')?.textContent).toBe('Weak')
  })
})

describe('the address and the access step', () => {
  it('refuses http, says only https, and asks for nothing', async () => {
    await open()
    await click('Vaultwarden')
    await type('Server address', 'http://vault.example')
    await click('Continue')
    expect(heading()).toBe('Address of Vaultwarden')
    expect(text()).toContain('Use an https:// address.')
    expect(request).not.toHaveBeenCalled()
  })

  it('asks the browser for the address before checking the server, and stays when refused', async () => {
    handlers.checkServer = () => ({ ok: true })
    request.mockResolvedValue(false)
    await open()
    await click('Vaultwarden')
    await type('Server address', 'https://vault.riverstudio.co')
    await click('Continue')
    expect(heading()).toBe('Allow access to vault.riverstudio.co')

    await click('Allow access to')
    expect(request).toHaveBeenCalledWith({ origins: ['https://vault.riverstudio.co/*'] })
    expect(heading()).toBe('Allow access to vault.riverstudio.co')
    expect(text()).toContain('Sync needs access to vault.riverstudio.co')
    expect(vi.mocked(ask)).not.toHaveBeenCalledWith('checkServer', expect.anything())

    request.mockResolvedValue(true)
    await click('Ask again')
    expect(heading()).toBe('Sign in to Vaultwarden')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('checkServer', {
      place: 'vaultwarden',
      server: 'https://vault.riverstudio.co',
    })
    expect(request.mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(ask).mock.invocationCallOrder.at(-1)!,
    )
  })

  it('stops at the address when the server is not a Vaultwarden, before any password', async () => {
    handlers.checkServer = () => ({ ok: false, problem: 'address' })
    await open()
    await click('Vaultwarden')
    await type('Server address', 'https://other.example')
    await click('Continue')
    await click('Allow access to')
    expect(heading()).toBe('Address of Vaultwarden')
    expect(text()).toContain('No Vaultwarden answers at that address.')
    expect(container.querySelector('input[type=password]')).toBeNull()
  })
})

describe('WebDAV', () => {
  it('joins with the passphrase typed on the form, and asks it again when it is wrong', async () => {
    await open()
    await toForm('WebDAV folder', 'https://dav.example/kemlock')
    expect(vi.mocked(ask)).not.toHaveBeenCalledWith('checkServer', expect.anything())
    expect(heading()).toBe('Sign in to the folder')

    handlers.signInWebdav = () => ({ step: 'passphrase' })
    handlers.answerStep = () => ({ step: 'error', problem: 'key' })
    await type('Username', 'me')
    await type('Password (or app password)', 'pw')
    await type('Sync passphrase', 'secret')
    await click('Sign in')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('signInWebdav', {
      folder: 'https://dav.example/kemlock',
      username: 'me',
      password: 'pw',
    })
    expect(vi.mocked(ask)).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'passphrase', passphrase: 'secret' },
    })
    expect(heading()).toBe("The folder's sync passphrase")
    expect(text()).toContain('That passphrase doesn’t open the sync file in this folder.')
    expect(text()).toContain('Nothing was stored.')

    handlers.answerStep = () => ({ step: 'firstSync', adds: 9, removes: 0 })
    await type('Sync passphrase', 'right')
    await click('Continue')
    expect(heading()).toBe('The first sync')
    expect(text()).toContain('items come to this browser')
    expect(text()).not.toContain('Logins aren')

    handlers.answerStep = () => ({
      step: 'done',
      status: { place: 'webdav', server: 'https://dav.example/kemlock', running: false },
    })
    await click('Start syncing')
    expect(heading()).toBe('Kemlock is ready')
    expect(text()).toContain('Pin Kemlock')
  })
})

describe('Kemlock Server', () => {
  it('shows the five words and polls the approval every two seconds until it is approved', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await open()
    await toForm('Kemlock Server', 'https://km.example')
    expect(heading()).toBe('Sign in to Kemlock Server')

    const approval = {
      step: 'approval',
      phrase: ['maple', 'river', 'stone', 'quiet', 'ember'],
      requestId: 'r1',
    }
    handlers.signInKemlock = () => approval
    await type('Email', 'me@km.example')
    await type('Master password', 'pw')
    await click('Sign in')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('signInKemlock', {
      server: 'https://km.example',
      email: 'me@km.example',
      password: 'pw',
    })
    expect(heading()).toBe('Approve this browser')
    expect([...container.querySelectorAll('.words li')].map((e) => e.textContent)).toEqual([
      'maple',
      'river',
      'stone',
      'quiet',
      'ember',
    ])
    expect(vi.mocked(ask)).not.toHaveBeenCalledWith('answerStep', expect.anything())

    let polls = 0
    handlers.answerStep = () =>
      ++polls < 2 ? approval : { step: 'firstSync', adds: 4, removes: 0 }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await settle()
    expect(vi.mocked(ask)).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'approval', requestId: 'r1' },
    })
    expect(polls).toBe(1)
    expect(heading()).toBe('Approve this browser')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await settle()
    expect(polls).toBe(2)
    expect(heading()).toBe('The first sync')

    // Leaving the step stops the polling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(polls).toBe(2)
  })

  it('asks the master password when no device can approve', async () => {
    await open()
    await toForm('Kemlock Server', 'https://km.example')
    handlers.signInKemlock = () => ({ step: 'masterPassword' })
    await type('Email', 'me@km.example')
    await type('Master password', 'pw')
    await click('Sign in')
    expect(heading()).toBe("Open your account's key")
    handlers.answerStep = () => ({ step: 'firstSync', adds: 1, removes: 0 })
    await type('Master password', 'pw2')
    await click('Continue')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'masterPassword', password: 'pw2' },
    })
    expect(heading()).toBe('The first sync')
  })
})

describe('Kemlock Server, by SSO or a passkey', () => {
  const toKemlockForm = async () => {
    await open()
    await toForm('Kemlock Server', 'https://km.example')
  }

  it('offers both next to the email and master password, only for Kemlock Server', async () => {
    await toKemlockForm()
    expect(button('Sign in with SSO')).toBeTruthy()
    expect(button('Use a passkey or security key')).toBeTruthy()
    expect(button('Sign in')).toBeTruthy()
  })

  it('signs in with SSO and goes on to the steps after it', async () => {
    await toKemlockForm()
    handlers.signInKemlockSso = () => ({ step: 'masterPassword' })
    await click('Sign in with SSO')
    // The email is optional: nothing typed, none sent
    expect(vi.mocked(ask)).toHaveBeenCalledWith('signInKemlockSso', {
      server: 'https://km.example',
    })
    expect(vi.mocked(ask)).not.toHaveBeenCalledWith('signInKemlock', expect.anything())
    expect(heading()).toBe("Open your account's key")

    handlers.answerStep = () => ({ step: 'firstSync', adds: 3, removes: 0 })
    await type('Master password', 'pw')
    await click('Continue')
    expect(heading()).toBe('The first sync')
    handlers.answerStep = () => ({
      step: 'done',
      status: { place: 'kemlock', server: 'https://km.example', running: false },
    })
    await click('Start syncing')
    expect(heading()).toBe('Kemlock is ready')
  })

  it('sends the typed email with a passkey, and waits for the approval', async () => {
    await toKemlockForm()
    handlers.signInKemlockPasskey = () => ({
      step: 'approval',
      phrase: ['maple', 'river', 'stone', 'quiet', 'ember'],
      requestId: 'r9',
    })
    await type('Email', ' me@km.example ')
    await click('Use a passkey or security key')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('signInKemlockPasskey', {
      server: 'https://km.example',
      email: 'me@km.example',
    })
    expect(heading()).toBe('Approve this browser')
  })

  it('says it is waiting for the window while it is open', async () => {
    await toKemlockForm()
    let finish: (step: unknown) => void = () => undefined
    handlers.signInKemlockSso = () => new Promise((resolve) => (finish = resolve))
    await click('Sign in with SSO')
    expect(text()).toContain('Finish signing in in the window that opened.')
    expect(button('Sign in with SSO').disabled).toBe(true)
    expect(button('Use a passkey or security key').disabled).toBe(true)
    await act(() => finish({ step: 'masterPassword' }))
    await settle()
    expect(heading()).toBe("Open your account's key")
  })

  it('names the id to add when the server does not list this extension', async () => {
    await toKemlockForm()
    handlers.signInKemlockSso = () => ({
      step: 'error',
      problem: 'ssoRedirect',
      message: 'abcdefgh',
    })
    await click('Sign in with SSO')
    expect(heading()).toBe('Sign in to Kemlock Server')
    expect(text()).toContain('KEMLOCK_BROWSER_EXTENSION_IDS')
    expect(text()).toContain('abcdefgh')
  })

  it('stays on the form with a word of its own when cancelled or it did not finish', async () => {
    await toKemlockForm()
    handlers.signInKemlockSso = () => ({ step: 'error', problem: 'cancelled' })
    await click('Sign in with SSO')
    expect(heading()).toBe('Sign in to Kemlock Server')
    expect(text()).toContain('The SSO sign-in was cancelled.')

    handlers.signInKemlockPasskey = () => ({ step: 'error', problem: 'cancelled' })
    await click('Use a passkey or security key')
    expect(text()).toContain('The passkey was not used.')

    handlers.signInKemlockPasskey = () => ({ step: 'error', problem: 'ssoFailed' })
    await click('Use a passkey or security key')
    expect(text()).toContain("The passkey page didn't give an answer.")

    handlers.signInKemlockSso = () => ({ step: 'error', problem: 'unsupported' })
    await click('Sign in with SSO')
    expect(text()).toContain("This server doesn't offer that way of signing in.")
  })

  it('shows the app words for the other problems, such as a session that ended', async () => {
    await toKemlockForm()
    handlers.signInKemlockSso = () => ({ step: 'error', problem: 'ssoRequired' })
    await click('Sign in with SSO')
    expect(heading()).toBe('Sign in to Kemlock Server')
    expect(container.querySelector('.problem')).not.toBeNull()
  })

  it('shows the failure when the background refuses', async () => {
    await toKemlockForm()
    handlers.signInKemlockPasskey = () => {
      throw new Error('boom')
    }
    await click('Use a passkey or security key')
    expect(text()).toContain('Something went wrong. Try again.')
  })
})

describe('Vaultwarden', () => {
  const homes = [
    { id: 'h1', name: 'Kemlock', storage: 'sealed', items: 22 },
    { id: 'h2', name: 'Spare', storage: 'plain', items: 1 },
  ]

  const toHomes = async () => {
    await open()
    await toForm('Vaultwarden', 'https://vault.example')
    handlers.signInVaultwarden = () => ({ step: 'homes', homes })
    await type('Email', 'me@vault.example')
    await type('Master password', 'pw')
    await click('Sign in')
  }

  it('lists the homes with storage and counts, warns about a plain one, and joins the one picked', async () => {
    await toHomes()
    expect(heading()).toBe('Join your Kemlock home')
    expect(text()).toContain('Kemlock, sealed, 22 items')
    expect(text()).toContain('Spare, plain, 1 item')
    expect(button('Continue').disabled).toBe(true)

    await pick('Kemlock, sealed')
    expect(text()).toContain('its passphrase comes next')
    await pick('Spare')
    expect(text()).toContain('both factors')
    expect(text()).toContain('No passphrase is asked')

    handlers.answerStep = () => ({ step: 'firstSync', adds: 9, removes: 0 })
    await click('Continue')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'homes', homeId: 'h2' },
    })
    expect(heading()).toBe('The first sync')
    expect(text()).toContain("Logins aren't synced with Vaultwarden yet")
  })

  it('asks a sealed home for its passphrase and says when it is wrong', async () => {
    await toHomes()
    await pick('Kemlock, sealed')
    handlers.answerStep = () => ({ step: 'passphrase' })
    await click('Continue')
    expect(heading()).toBe("The home's passphrase")
    handlers.answerStep = () => ({ step: 'error', problem: 'key' })
    await type('Sync passphrase', 'nope')
    await click('Continue')
    expect(heading()).toBe("The home's passphrase")
    expect(text()).toContain('Nothing was stored.')
  })

  it('says to turn sync on in the phone when there is no home, and offers no way to make one', async () => {
    await open()
    await toForm('Vaultwarden', 'https://vault.example')
    handlers.signInVaultwarden = () => ({ step: 'homes', homes: [] })
    await type('Email', 'me@vault.example')
    await type('Master password', 'pw')
    await click('Sign in')
    expect(heading()).toBe('No Kemlock home yet')
    expect(text()).toContain('Turn on Vaultwarden sync in Kemlock on your phone first')
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '')
    expect(labels.some((label) => /create|make|new/i.test(label))).toBe(false)
  })

  it('offers an email code by sending it, and remembers the browser by default', async () => {
    await open()
    await toForm('Vaultwarden', 'https://vault.example')
    handlers.signInVaultwarden = () => second(['authenticator', 'email'], ['duo'])
    await type('Email', 'me@vault.example')
    await type('Master password', 'pw')
    await click('Sign in')
    expect(heading()).toBe('Second step')
    expect(text()).toContain('Not available in the browser: Duo.')

    handlers.answerStep = () => second(['authenticator', 'email'], ['duo'])
    await pick('Email code')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'second', method: 'email', code: '', remember: true },
    })
    expect(text()).toContain('The code was sent')
    expect(button('Send it again')).toBeTruthy()

    handlers.answerStep = () => ({ step: 'masterPassword' })
    await type('Email code', '123456')
    await click('Continue')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'second', method: 'email', code: '123456', remember: true },
    })
  })

  it('offers the API key when only Duo is left', async () => {
    await open()
    await toForm('Vaultwarden', 'https://vault.example')
    handlers.signInVaultwarden = () => second([], ['duo'])
    await type('Email', 'me@vault.example')
    await type('Master password', 'pw')
    await click('Sign in')
    expect(text()).toContain("Duo can't be done in the browser")
    expect(field('Personal API key').type).toBe('password')
  })

  it('names the address to use before any security key is asked', async () => {
    await open()
    await toForm('Vaultwarden', 'https://vault.example')
    handlers.signInVaultwarden = () => second(['securityKey', 'authenticator'])
    await type('Email', 'me@vault.example')
    await type('Master password', 'pw')
    await click('Sign in')

    await pick('Security key')
    handlers.securityKeyChallenge = () => ({
      domain: 'https://vw.example',
      path: '/webauthn-fallback-connector.html',
      data: 'abc',
    })
    await click('Use my security key')
    expect(text()).toContain('https://vw.example')
    expect(createTab).not.toHaveBeenCalled()

    await click('Use that address')
    expect(heading()).toBe('Address of Vaultwarden')
    expect(field('Server address').value).toBe('https://vw.example')
  })

  it('offers the other methods when the server has no page for a key', async () => {
    await open()
    await toForm('Vaultwarden', 'https://vault.example')
    handlers.signInVaultwarden = () => second(['securityKey', 'authenticator'])
    await type('Email', 'me@vault.example')
    await type('Master password', 'pw')
    await click('Sign in')

    await pick('Security key')
    handlers.securityKeyChallenge = () => null
    await click('Use my security key')
    expect(text()).toContain("This server can't ask a security key from the browser")
    expect(createTab).not.toHaveBeenCalled()
    expect(() => radio('Security key')).toThrow()
    expect(field('Authenticator code')).toBeTruthy()
  })
})

describe('setting up again', () => {
  it('unlocks a locked vault first and counts the wrong passwords', async () => {
    handlers.popup = () => ({ state: { exists: true, unlocked: false, wrongPasswords: 2 } })
    let ok = false
    handlers.unlock = () => ({ ok, wrongPasswords: ok ? 0 : 3 })
    await open()
    expect(heading()).toBe("Unlock this browser's vault")
    expect(text()).toContain('2 wrong tries')
    await type('Browser password', 'bad')
    await click('Unlock')
    expect(text()).toContain('3 wrong tries')
    ok = true
    await type('Browser password', 'good')
    await click('Unlock')
    expect(heading()).toBe('Where does your phone sync?')
    expect(text()).toContain('Step 1 of 3')
  })

  it('removes Kemlock from the browser after a confirmation, then offers setup again', async () => {
    window.history.replaceState(null, '', '#remove')
    handlers.removeVault = () => undefined
    await open()
    expect(heading()).toBe('Remove Kemlock from this browser?')
    expect(vi.mocked(ask)).not.toHaveBeenCalled()
    expect(text()).toContain("Your phone and your sync place aren't touched")

    await click('Remove Kemlock from this browser')
    expect(vi.mocked(ask)).toHaveBeenCalledWith('removeVault')
    expect(heading()).toBe('Kemlock was removed from this browser')
    await click('Set up again')
    expect(heading()).toBe('A password for this browser')
  })
})
