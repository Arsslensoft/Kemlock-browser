// @vitest-environment jsdom
// The unlock tab: adding a credential (the vault's password asked, and only it asked again when it is wrong), unlocking, and that
// Firefox is told why it is not offered, before anything is asked of the browser or the background (docs/plans/add-passkey-unlock.md).
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from '../popup/send'
import unlockEn from '../../locales/parts/unlock.en.json'
import {
  background,
  button,
  change,
  click,
  input,
  installChrome,
  mount,
  settle,
  text,
  unmountAll,
  type FakeChrome,
} from '../popup/testing'
import { AskError } from '../popup/send'
import { AddPage, UnlockPage } from './App'
import { toBase64url } from './ceremony'

vi.mock('../popup/send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('../popup/testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

const strings = unlockEn as Record<string, string>
const salt = toBase64url(new Uint8Array(32).fill(9))
const thirtyTwo = (fill: number): ArrayBuffer => new Uint8Array(32).fill(fill).buffer

/** The unlock page's strings on top of the popup's. */
function giveStrings(): void {
  const i18n = (
    globalThis as {
      chrome: { i18n: { getMessage: (name: string, subs?: string[]) => string } }
    }
  ).chrome.i18n
  const original = i18n.getMessage
  i18n.getMessage = (name, subs = []) => {
    const own = strings[name]
    if (own === undefined) return original(name, subs)
    const seen: string[] = []
    return own.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
      if (!seen.includes(placeholder)) seen.push(placeholder)
      return subs[seen.indexOf(placeholder)] ?? ''
    })
  }
}

const made = (prf: unknown) => ({
  rawId: new Uint8Array([1, 2, 3]).buffer,
  authenticatorAttachment: 'platform',
  response: { getTransports: () => ['internal'] },
  getClientExtensionResults: () => ({ prf }),
})

let fake: FakeChrome
let create: ReturnType<typeof vi.fn>
let get: ReturnType<typeof vi.fn>

beforeEach(() => {
  fake = installChrome()
  giveStrings()
  create = vi.fn(async () => made({ enabled: true }))
  get = vi.fn(async () => made({ results: { first: thirtyTwo(5) } }))
  Object.defineProperty(navigator, 'credentials', {
    value: { create, get },
    configurable: true,
  })
  vi.stubGlobal('PublicKeyCredential', {
    getClientCapabilities: async () => ({ 'extension:prf': true }),
  })
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  delete (navigator as { credentials?: unknown }).credentials
})

const addButton = (root: ParentNode) => button(root, strings.unlock_add!)

describe('adding a credential', () => {
  it('makes it, asks for the vault password, and sends both', async () => {
    background.reset({
      passkeyUnlockPrepare: () => ({ salt, exclude: [] }),
      addPasskeyUnlock: () => ({ credentials: [] }),
    })
    const root = await mount(h(AddPage, null))
    expect(addButton(root)!.disabled).toBe(true)
    await change(input(root, 'Name'), 'Work laptop')
    await change(input(root, strings.unlock_passwordLabel!), 'correct horse')
    await click(addButton(root))
    expect(create).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)
    expect(background.of('addPasskeyUnlock')[0]?.args).toEqual({
      name: 'Work laptop',
      password: 'correct horse',
      credentialId: 'AQID',
      prfOutput: toBase64url(thirtyTwo(5)),
      attachment: 'platform',
      transports: ['internal'],
    })
    expect(text(root)).toContain('Added Work laptop')
  })

  it('asks only the password again when it is wrong, and does not make a second credential', async () => {
    let tries = 0
    background.reset({
      passkeyUnlockPrepare: () => ({ salt, exclude: [] }),
      addPasskeyUnlock: () => {
        tries += 1
        if (tries === 1) throw new AskError('wrongPassword')
        return { credentials: [] }
      },
    })
    const root = await mount(h(AddPage, null))
    await change(input(root, strings.unlock_passwordLabel!), 'nope')
    await click(addButton(root))
    expect(text(root)).toContain(strings.unlock_errorWrongPassword)
    expect(text(root)).toContain(strings.unlock_madeAlready)
    expect(create).toHaveBeenCalledTimes(1)
    await change(input(root, strings.unlock_passwordLabel!), 'correct horse')
    await click(addButton(root))
    expect(create).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)
    const sent = background.of('addPasskeyUnlock')
    expect(sent).toHaveLength(2)
    expect(sent[0]?.args).toMatchObject({ password: 'nope', credentialId: 'AQID' })
    expect(sent[1]?.args).toMatchObject({ password: 'correct horse', credentialId: 'AQID' })
    expect(text(root)).toContain('Added ')
  })

  it('needs a password before it can be pressed', async () => {
    background.reset({ passkeyUnlockPrepare: () => ({ salt, exclude: [] }) })
    const root = await mount(h(AddPage, null))
    expect(addButton(root)!.disabled).toBe(true)
    await change(input(root, strings.unlock_passwordLabel!), 'x')
    expect(addButton(root)!.disabled).toBe(false)
  })

  it('says a locked vault must be opened first', async () => {
    background.reset({
      passkeyUnlockPrepare: () => {
        throw new AskError('locked')
      },
    })
    const root = await mount(h(AddPage, null))
    expect(text(root)).toContain(strings.unlock_errorLocked)
    await change(input(root, strings.unlock_passwordLabel!), 'x')
    expect(addButton(root)!.disabled).toBe(true)
  })

  it('stops when the vault locks while the browser’s prompt is open, and adds nothing', async () => {
    let finish: (credential: ReturnType<typeof made>) => void = () => undefined
    create.mockImplementation(
      () =>
        new Promise<ReturnType<typeof made>>((resolve) => {
          finish = resolve
        }),
    )
    background.reset({
      passkeyUnlockPrepare: () => ({ salt, exclude: [] }),
      addPasskeyUnlock: () => ({ credentials: [] }),
    })
    const root = await mount(h(AddPage, null))
    await change(input(root, strings.unlock_passwordLabel!), 'correct horse')
    await click(addButton(root))
    expect(create).toHaveBeenCalledTimes(1)

    // The vault locks while the prompt is still open; then the person answers it
    await act(() => {
      fake.lock()
    })
    finish(made({ enabled: true }))
    await settle()

    expect(background.of('addPasskeyUnlock')).toHaveLength(0)
    expect(text(root)).toContain(strings.unlock_errorLocked)
    expect((input(root, strings.unlock_passwordLabel!) as HTMLInputElement).value).toBe('')
    expect(addButton(root)!.disabled).toBe(true)
  })

  it('wipes the password typed and the credential made when the vault locks, and says why', async () => {
    background.reset({
      passkeyUnlockPrepare: () => ({ salt, exclude: [] }),
      addPasskeyUnlock: () => {
        throw new AskError('wrongPassword')
      },
    })
    const root = await mount(h(AddPage, null))
    await change(input(root, strings.unlock_passwordLabel!), 'nope')
    await click(addButton(root))
    expect(text(root)).toContain(strings.unlock_madeAlready)

    await act(() => {
      fake.lock()
    })
    await settle()

    expect((input(root, strings.unlock_passwordLabel!) as HTMLInputElement).value).toBe('')
    expect(text(root)).not.toContain(strings.unlock_madeAlready)
    expect(text(root)).toContain(strings.unlock_errorLocked)
  })

  it('keeps a credential that was added before the vault locked', async () => {
    background.reset({
      passkeyUnlockPrepare: () => ({ salt, exclude: [] }),
      addPasskeyUnlock: () => ({ credentials: [] }),
    })
    const root = await mount(h(AddPage, null))
    await change(input(root, strings.unlock_passwordLabel!), 'correct horse')
    await click(addButton(root))
    expect(text(root)).toContain('Added ')
    await act(() => {
      fake.lock()
    })
    await settle()
    expect(text(root)).toContain('Added ')
  })

  it('goes on once the vault is open again: the page asks when it gets the focus', async () => {
    let open = true
    background.reset({
      passkeyUnlockPrepare: () => ({ salt, exclude: [] }),
      addPasskeyUnlock: () => ({ credentials: [] }),
      pageState: () => ({ exists: true, unlocked: open, wrongPasswords: 0 }),
    })
    const root = await mount(h(AddPage, null))
    await change(input(root, strings.unlock_passwordLabel!), 'correct horse')
    open = false
    await act(() => {
      fake.lock()
    })
    await settle()
    expect(text(root)).toContain(strings.unlock_errorLocked)
    await change(input(root, strings.unlock_passwordLabel!), 'correct horse')
    expect(addButton(root)!.disabled).toBe(true)

    // Still locked: coming back changes nothing
    await act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await settle()
    expect(addButton(root)!.disabled).toBe(true)

    open = true
    await act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await settle()
    expect(addButton(root)!.disabled).toBe(false)
    await click(addButton(root))
    expect(background.of('addPasskeyUnlock')).toHaveLength(1)
    expect(text(root)).toContain('Added ')
  })

  it('reports success when the lock lands after the core added the credential', async () => {
    background.reset({
      passkeyUnlockPrepare: () => ({ salt, exclude: [] }),
      addPasskeyUnlock: () => {
        // The credential is written, and the vault locks before the answer reaches the page
        fake.lock()
        return { credentials: [] }
      },
    })
    const root = await mount(h(AddPage, null))
    await change(input(root, strings.unlock_passwordLabel!), 'correct horse')
    await click(addButton(root))
    expect(text(root)).toContain('Added ')
    expect(text(root)).not.toContain(strings.unlock_errorLocked)
  })

  it('says in Firefox why it is not offered, and asks the background and the browser nothing', async () => {
    vi.stubGlobal('__BROWSER__', 'firefox')
    background.reset({})
    const root = await mount(h(AddPage, null))
    expect(text(root)).toContain(strings.unlock_unsupportedFirefox)
    expect(addButton(root)).toBeNull()
    expect(background.calls).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })

  it('says a browser without PRF has none, and offers nothing', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      getClientCapabilities: async () => ({ 'extension:prf': false }),
    })
    background.reset({})
    const root = await mount(h(AddPage, null))
    expect(text(root)).toContain(strings.unlock_unsupported)
    expect(addButton(root)).toBeNull()
    expect(background.calls).toEqual([])
  })
})

describe('unlocking', () => {
  const info = {
    credentials: [
      {
        id: 's1',
        credentialId: 'AQID',
        name: 'Laptop',
        addedAt: 0,
        transports: ['internal'],
      },
    ],
    salt,
  }

  it('asks the credentials, sends the answer, and says the vault is open', async () => {
    background.reset({
      passkeyUnlockInfo: () => info,
      unlockWithPasskey: () => ({ ok: true, wrongPasswords: 0 }),
    })
    const root = await mount(h(UnlockPage, null))
    expect(background.of('unlockWithPasskey')[0]?.args).toEqual({
      credentialId: 'AQID',
      prfOutput: toBase64url(thirtyTwo(5)),
    })
    expect(text(root)).toContain(strings.unlock_done)
  })

  it('says it did not open, and offers to try again or to use the password', async () => {
    background.reset({
      passkeyUnlockInfo: () => info,
      unlockWithPasskey: () => ({ ok: false, wrongPasswords: 0, reason: 'stale' }),
    })
    const root = await mount(h(UnlockPage, null))
    expect(text(root)).toContain(strings.unlock_errorStale)
    expect(button(root, strings.unlock_tryAgain!)).not.toBeNull()
    expect(button(root, strings.unlock_usePassword!)).not.toBeNull()
  })

  it('asks for the password instead when the background says it is needed, and never asks the browser', async () => {
    background.reset({ passkeyUnlockInfo: () => ({ ...info, passwordRequired: 'days' }) })
    const root = await mount(h(UnlockPage, null))
    expect(text(root)).toContain(strings.unlock_passwordDays)
    expect(get).not.toHaveBeenCalled()
  })

  it('does the same when the tries run out as it asks', async () => {
    let asked = 0
    background.reset({
      passkeyUnlockInfo: () => {
        asked += 1
        return asked === 1 ? info : { ...info, passwordRequired: 'tries' }
      },
      unlockWithPasskey: () => {
        throw new AskError('passwordRequired')
      },
    })
    const root = await mount(h(UnlockPage, null))
    expect(text(root)).toContain(strings.unlock_passwordTries)
  })

  it('says in Firefox why it is not offered, and asks the background and the browser nothing', async () => {
    vi.stubGlobal('__BROWSER__', 'firefox')
    background.reset({})
    const root = await mount(h(UnlockPage, null))
    expect(text(root)).toContain(strings.unlock_unsupportedFirefox)
    expect(background.calls).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  it('says a dismissed prompt was cancelled', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    background.reset({ passkeyUnlockInfo: () => info })
    const root = await mount(h(UnlockPage, null))
    expect(text(root)).toContain(strings.unlock_errorCancelled)
    expect(background.of('unlockWithPasskey')).toHaveLength(0)
  })
})
