// @vitest-environment jsdom
// "Send this note" on a note's page: only where the vault syncs with Kemlock Server, through the background (which holds the text), and
// into the Sends tab with a token and never the text.
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { NoteFull } from '../shared/api'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  click,
  installChrome,
  message,
  mount,
  note,
  syncStatus,
  text,
  unlockedHandlers,
  unmountAll,
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

const openPopup = () => mount(h(ToastProvider, null, h(App, null)))
const t = (name: string, ...subs: string[]) => message('en', name, subs)

const wifi = note({ id: 'n1', title: 'Wi-Fi' })
const wifiFull: NoteFull = { ...wifi, text: 'the password is hunter2', attachments: [] }

let fake: FakeChrome
beforeEach(() => {
  fake = installChrome()
  background.reset()
})
afterEach(() => {
  unmountAll()
})

const open = async (extra: Parameters<typeof background.reset>[0] = {}, fullNote = wifiFull) => {
  background.reset({
    ...unlockedHandlers({ codes: [], logins: [], notes: [wifi] }),
    revealNote: (() => fullNote) as never,
    ...extra,
  })
  const root = await openPopup()
  await click(button(root, 'Notes 1'))
  await click(button(root, 'Open Wi-Fi'))
  return root
}

describe('Send this note', () => {
  it('opens the Sends tab with the token the background gave, and puts no text in the address', async () => {
    const root = await open({
      syncStatus: (() => syncStatus({ place: 'kemlock' })) as never,
      sendFromNote: (() => ({ ok: true, value: { token: 'tok-1' } })) as never,
    })
    await click(button(root, t('sends_sendNote')))
    expect(background.of('sendFromNote').map((call) => call.args)).toEqual([{ id: 'n1' }])
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/sends/index.html#new:tok-1'])
    expect(fake.tabsCreated.join()).not.toContain('hunter2')
  })

  it('is not offered where the vault syncs with another place, or with none', async () => {
    let root = await open({ syncStatus: (() => syncStatus({ place: 'webdav' })) as never })
    expect(button(root, t('sends_sendNote'))).toBeNull()
    unmountAll()
    root = await open({ syncStatus: (() => null) as never })
    expect(button(root, t('sends_sendNote'))).toBeNull()
  })

  it('is not offered for a note with no text', async () => {
    const root = await open(
      { syncStatus: (() => syncStatus({ place: 'kemlock' })) as never },
      { ...wifiFull, text: '' },
    )
    expect(button(root, t('sends_sendNote'))).toBeNull()
  })

  it('says why when the background refuses, and opens nothing', async () => {
    const root = await open({
      syncStatus: (() => syncStatus({ place: 'kemlock' })) as never,
      sendFromNote: (() => ({ ok: false, problem: 'noSync', place: 'webdav' })) as never,
    })
    await click(button(root, t('sends_sendNote')))
    expect(text(document.body)).toContain(t('sends_otherPlace', t('popup_placeWebdav')))
    expect(fake.tabsCreated).toEqual([])
  })
})
