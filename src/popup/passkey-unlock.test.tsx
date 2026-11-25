// @vitest-environment jsdom
// Unlocking with a passkey, Windows Hello or a security key, in the popup: the button over the password form, and Settings › Security
// (docs/plans/add-passkey-unlock.md). The tests give the popup its own strings and a browser that has, or hasn't, PRF.
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import unlockEn from '../../locales/parts/unlock.en.json'
import type { PasskeyUnlockInfo } from '../shared/api'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  change,
  click,
  installChrome,
  message,
  mount,
  submit,
  text,
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

const strings = unlockEn as Record<string, string>
const openPopup = () => mount(h(ToastProvider, null, h(App, null)))

let fake: FakeChrome

/** The popup's own strings, and the unlock page's on top. */
function giveStrings(): void {
  const i18n = (
    globalThis as { chrome: { i18n: { getMessage: (n: string, s?: string[]) => string } } }
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

/** A browser with WebAuthn, and with or without the PRF extension (`undefined`: it can't say). */
function browserWith(prf: boolean | undefined): void {
  Object.defineProperty(navigator, 'credentials', { value: {}, configurable: true })
  vi.stubGlobal('PublicKeyCredential', {
    getClientCapabilities: async () => (prf === undefined ? {} : { 'extension:prf': prf }),
  })
}

const slot = (over: Partial<PasskeyUnlockInfo['credentials'][number]> = {}) => ({
  id: 's1',
  credentialId: 'AQID',
  name: 'Windows Hello',
  addedAt: Date.parse('2026-11-20T10:00:00Z'),
  attachment: 'platform',
  transports: ['internal'],
  ...over,
})

const lockedWith = (info: PasskeyUnlockInfo) => {
  background.reset({
    popup: () => ({ state: vaultState({ unlocked: false }) }),
    passkeyUnlockInfo: () => info,
  })
}

beforeEach(() => {
  fake = installChrome()
  giveStrings()
  browserWith(true)
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  delete (navigator as { credentials?: unknown }).credentials
})

describe('the lock screen', () => {
  it('offers the passkey first, with the password form under it, and opens the unlock tab', async () => {
    lockedWith({ credentials: [slot()], salt: 'abc' })
    const root = await openPopup()
    const unlock = button(root, strings.unlock_button!)
    expect(unlock).not.toBeNull()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
    expect(text(root)).toContain(strings.unlock_orPassword)
    // The button comes before the password field
    const order = unlock!.compareDocumentPosition(root.querySelector('input[type="password"]')!)
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await click(unlock)
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/unlock/index.html#unlock'])
  })

  it('offers nothing in Firefox, even with a credential in storage, and the password form is all there is', async () => {
    vi.stubGlobal('__BROWSER__', 'firefox')
    lockedWith({ credentials: [slot()], salt: 'abc' })
    const root = await openPopup()
    expect(button(root, strings.unlock_button!)).toBeNull()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('offers nothing when no credential is set up', async () => {
    lockedWith({ credentials: [] })
    const root = await openPopup()
    expect(button(root, strings.unlock_button!)).toBeNull()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('offers nothing in a browser without PRF, and the password form is all there is', async () => {
    browserWith(false)
    lockedWith({ credentials: [slot()], salt: 'abc' })
    const root = await openPopup()
    expect(button(root, strings.unlock_button!)).toBeNull()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('offers it where the browser can’t say whether it has PRF, since making a credential checks', async () => {
    browserWith(undefined)
    lockedWith({ credentials: [slot()], salt: 'abc' })
    const root = await openPopup()
    expect(button(root, strings.unlock_button!)).not.toBeNull()
  })

  it('says why the password is needed instead, with no button', async () => {
    lockedWith({ credentials: [slot()], salt: 'abc', passwordRequired: 'tries' })
    let root = await openPopup()
    expect(button(root, strings.unlock_button!)).toBeNull()
    expect(text(root)).toContain(strings.unlock_passwordTries)
    unmountAll()
    lockedWith({ credentials: [slot()], salt: 'abc', passwordRequired: 'days' })
    root = await openPopup()
    expect(text(root)).toContain(strings.unlock_passwordDays)
  })

  it('is the password form as it was when the background can’t say', async () => {
    background.reset({ popup: () => ({ state: vaultState({ unlocked: false }) }) })
    const root = await openPopup()
    expect(button(root, strings.unlock_button!)).toBeNull()
    expect(root.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('still counts and shows wrong passwords as before', async () => {
    background.reset({
      popup: () => ({ state: vaultState({ unlocked: false, wrongPasswords: 2 }) }),
      passkeyUnlockInfo: () => ({ credentials: [slot()], salt: 'abc' }),
      unlock: () => ({ ok: false, wrongPasswords: 3 }),
    })
    const root = await openPopup()
    expect(text(root)).toContain(message('en', 'popup_wrongCount', ['2']))
    await change(root.querySelector('input[type="password"]'), 'nope')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(message('en', 'popup_wrongPassword'))
    expect(text(root)).toContain('3 wrong tries')
  })
})

describe('Settings › Security', () => {
  let info: PasskeyUnlockInfo

  async function openSettings() {
    info = {
      credentials: [
        slot(),
        slot({
          id: 's2',
          credentialId: 'BAUG',
          name: 'YubiKey',
          attachment: 'cross-platform',
          lastUsedAt: Date.parse('2026-11-22T10:00:00Z'),
        }),
      ],
      salt: 'abc',
    }
    background.reset({
      ...unlockedHandlers(),
      passkeyUnlockInfo: () => info,
      renamePasskeyUnlock: ((args: { id: string; name: string }) => {
        info = {
          ...info,
          credentials: info.credentials.map((c) =>
            c.id === args.id ? { ...c, name: args.name } : c,
          ),
        }
        return info
      }) as never,
      removePasskeyUnlock: ((args: { id: string }) => {
        info = { ...info, credentials: info.credentials.filter((c) => c.id !== args.id) }
        return info
      }) as never,
    })
    const root = await openPopup()
    await click(button(root, message('en', 'popup_settings')))
    return root
  }

  it('lists each credential by name, with what it is, and adds in the unlock tab', async () => {
    const root = await openSettings()
    expect(text(root)).toContain(strings.unlock_sectionSecurity)
    expect(text(root)).toContain('Windows Hello')
    expect(text(root)).toContain('This device · added')
    expect(text(root)).toContain('YubiKey')
    expect(text(root)).toContain('Security key · added')
    expect(text(root)).toContain('· used')
    await click(button(root, strings.unlock_add!))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/unlock/index.html#add'])
  })

  it('renames one', async () => {
    const root = await openSettings()
    await click(button(root, 'Rename YubiKey'))
    const field = root.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(field.value).toBe('YubiKey')
    await change(field, 'Work key')
    await submit(root.querySelector('form'))
    expect(background.of('renamePasskeyUnlock')[0]?.args).toEqual({ id: 's2', name: 'Work key' })
    expect(text(root)).toContain('Work key')
    expect(text(root)).not.toContain('YubiKey')
  })

  it('asks before it removes one, and keeps the other', async () => {
    const root = await openSettings()
    await click(button(root, 'Remove Windows Hello'))
    expect(text(root)).toContain('Remove Windows Hello?')
    expect(text(root)).toContain(strings.unlock_removeBody)
    await click(button(root, strings.unlock_cancel!))
    expect(background.of('removePasskeyUnlock')).toHaveLength(0)
    await click(button(root, 'Remove Windows Hello'))
    await click(button(root, strings.unlock_remove!))
    expect(background.of('removePasskeyUnlock')[0]?.args).toEqual({ id: 's1' })
    // The row's own button went with it (the section's description names Windows Hello as a kind, not this credential)
    const labels = [...root.querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent,
    )
    expect(labels).not.toContain('Remove Windows Hello')
    expect(text(root)).toContain('YubiKey')
  })

  it('says there are none yet, with the way to add one', async () => {
    const root = await openSettings()
    await click(button(root, 'Remove Windows Hello'))
    await click(button(root, strings.unlock_remove!))
    await click(button(root, 'Remove YubiKey'))
    await click(button(root, strings.unlock_remove!))
    expect(text(root)).toContain(strings.unlock_none)
    expect(button(root, strings.unlock_add!)).not.toBeNull()
  })

  it('says plainly that the browser can’t, and offers nothing, when it has no PRF', async () => {
    browserWith(false)
    const root = await openSettings()
    expect(text(root)).toContain(strings.unlock_unsupported)
    expect(button(root, strings.unlock_add!)).toBeNull()
  })

  it('says why it is not offered in Firefox, with nothing to press, whatever WebAuthn it has', async () => {
    vi.stubGlobal('__BROWSER__', 'firefox')
    const root = await openSettings()
    expect(text(root)).toContain(strings.unlock_unsupportedFirefox)
    expect(button(root, strings.unlock_add!)).toBeNull()
    expect(button(root, 'Rename Windows Hello')).toBeNull()
  })
})
