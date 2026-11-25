// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { SendDetail, SendResult, SendsListing } from '../shared/sends'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  foreignSend,
  installSendsChrome,
  sendDetail,
  sendsMessage,
  sendView,
} from './sends-testing'
import {
  background,
  button,
  change,
  choose,
  click,
  input,
  mount,
  selectOf,
  submit,
  switchOf,
  text,
  toggle,
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
const ok = <T,>(value: T): SendResult<T> => ({ ok: true, value })
const available = (
  over: Partial<Extract<SendsListing, { available: true }>> = {},
): SendsListing => ({
  available: true,
  sends: [sendView()],
  foreign: [],
  ...over,
})

let fake: FakeChrome
let detail: SendDetail

/** The handlers of an unlocked vault that syncs with Kemlock Server, over [listing]. */
function withSends(listing: SendsListing | (() => SendsListing)) {
  background.reset({
    ...unlockedHandlers(),
    sends: (() => ok(typeof listing === 'function' ? listing() : listing)) as never,
    sendGet: (() => ok(detail)) as never,
    sendCopyLink: (() => ok(null)) as never,
    sendUpdate: (() => ok(null)) as never,
    sendDelete: (() => ok(null)) as never,
  })
}

/** Home's card for Sends, which says what Sends are in its second line. */
const entry = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Sends')) ?? null

async function openSends(root: HTMLElement) {
  await click(entry(root))
}

beforeEach(() => {
  fake = installSendsChrome()
  detail = sendDetail()
})

afterEach(() => {
  unmountAll()
})

describe('the Sends list', () => {
  it('is a card on Home, and lists each Send with its kind, status and opens', async () => {
    withSends(available())
    const root = await openPopup()
    expect(text(entry(root)!)).toContain(sendsMessage('en', 'sends_subtitle'))
    await openSends(root)
    expect(text(root)).toContain('Wi-Fi')
    expect(text(root)).toContain('Text · Active · Opens: 1 of 3')
  })

  it('shows what a Send is when there is none, and New Send opens the tab', async () => {
    withSends(available({ sends: [] }))
    const root = await openPopup()
    await openSends(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_emptyTitle'))
    await click(button(root, 'New Send'))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/sends/index.html#new'])
  })

  it('opens the page where a link is pasted, in the tab', async () => {
    withSends(available())
    const root = await openPopup()
    await openSends(root)
    await click(
      [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Open a Send')) ??
        null,
    )
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/sends/index.html#open'])
  })

  it('says where Sends are when the vault syncs somewhere else, and offers no New Send', async () => {
    withSends({ available: false, place: 'webdav' })
    const root = await openPopup()
    await openSends(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_otherPlace', ['WebDAV']))
    expect(button(root, 'New Send')?.disabled).toBe(true)
    await click(button(root, 'Set up sync'))
    expect(fake.tabsCreated.at(-1)).toContain('src/setup/index.html')
  })

  it('says it too when the vault syncs nowhere', async () => {
    withSends({ available: false, place: null })
    const root = await openPopup()
    await openSends(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_needsKemlock'))
  })

  it('says why the list did not load, with the server’s own problem', async () => {
    background.reset({
      ...unlockedHandlers(),
      sends: (() => ({ ok: false, problem: 'sessionEnded' })) as never,
    })
    const root = await openPopup()
    await openSends(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_sessionEnded'))
    expect(button(root, 'Try again')).not.toBeNull()
  })

  it('lists a Send a Bitwarden app made apart, and deletes it after asking', async () => {
    withSends(available({ sends: [], foreign: [foreignSend()] }))
    const root = await openPopup()
    await openSends(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_foreignNote'))
    expect(text(root)).toContain('Text Send')
    await click(button(root, 'Delete Text Send'))
    expect(background.of('sendDelete')).toHaveLength(0)
    await click(button(root, 'Delete'))
    expect(background.of('sendDelete')[0]?.args).toEqual({ id: 'f1' })
  })
})

describe('a Send’s page', () => {
  async function openSend(): Promise<HTMLElement> {
    const root = await openPopup()
    await openSends(root)
    await click(button(root, 'Details of Wi-Fi'))
    return root
  }

  it('shows its state, keeps its text hidden until asked, and its notes', async () => {
    withSends(available())
    const root = await openSend()
    expect(text(root)).toContain('Opens: 1 of 3')
    expect(text(root)).toContain('for the guests')
    expect(text(root)).not.toContain('the password is on the fridge')
    await click(button(root, 'Show text'))
    expect(text(root)).toContain('the password is on the fridge')
    await click(button(root, 'Hide'))
    expect(text(root)).not.toContain('the password is on the fridge')
  })

  it('copies the link through the background, which holds it, and says it clears itself', async () => {
    withSends(available())
    const root = await openSend()
    await click(button(root, 'Copy link'))
    expect(background.of('sendCopyLink')[0]?.args).toEqual({ id: 's1' })
    expect(text(document.body)).toContain('Link copied')
    expect(text(document.body)).toContain('Clipboard clears in 30 s')
  })

  it('turns off and on again, changing only that', async () => {
    withSends(available())
    const root = await openSend()
    await toggle(switchOf(root, 'On'), false)
    expect(background.of('sendUpdate').at(-1)?.args).toEqual({
      id: 's1',
      patch: { disabled: true },
    })
  })

  it('asks before deleting, then deletes and goes back to the list', async () => {
    withSends(available())
    const root = await openSend()
    await click(button(root, 'Delete Wi-Fi'))
    expect(background.of('sendDelete')).toHaveLength(0)
    await click(button(root, 'Delete'))
    expect(background.of('sendDelete')[0]?.args).toEqual({ id: 's1' })
    expect(text(root)).toContain('Text · Active')
  })

  it('edits only what changed: the name, and how long it lasts', async () => {
    withSends(available())
    const root = await openSend()
    await click(button(root, 'Edit'))
    await change(input(root, 'Name'), 'Guest Wi-Fi')
    await choose(selectOf(root, 'Deletes after'), '14')
    await submit(root.querySelector('form'))
    const call = background.of('sendUpdate').at(-1)
    expect(call?.args.id).toBe('s1')
    const patch = call?.args.patch as Record<string, unknown>
    expect(Object.keys(patch).sort()).toEqual(['deletionAt', 'name'])
    expect(patch.name).toBe('Guest Wi-Fi')
    expect(patch.deletionAt as number).toBeGreaterThan(Date.now() + 13.9 * 86_400_000)
    expect(patch.deletionAt as number).toBeLessThan(Date.now() + 14.1 * 86_400_000)
  })

  it('refuses an open limit under the opens used, before asking', async () => {
    detail = sendDetail({ accessCount: 2, maxAccess: 5 })
    withSends(available())
    const root = await openSend()
    await click(button(root, 'Edit'))
    await change(input(root, 'Number of opens'), '1')
    await submit(root.querySelector('form'))
    expect(background.of('sendUpdate')).toHaveLength(0)
    expect(text(root)).toContain(sendsMessage('en', 'sends_errorMaxAccessFrom', [2]))
  })

  it('keeps a file Send’s file and name as they are, and says so', async () => {
    detail = sendDetail({ kind: 'file', name: 'scan.pdf', text: undefined })
    withSends(available())
    const root = await openSend()
    await click(button(root, 'Edit'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_editFileNote'))
    expect(input(root, 'Name')).toBeNull()
  })

  it('shows the password options only when there is a password, and removes it on request', async () => {
    detail = sendDetail({ hasPassword: true })
    withSends(available())
    const root = await openSend()
    expect(text(root)).toContain('Protected by a password')
    await click(button(root, 'Edit'))
    await choose(selectOf(root, 'Password'), 'remove')
    await submit(root.querySelector('form'))
    expect(background.of('sendUpdate').at(-1)?.args.patch).toEqual({ removePassword: true })
  })

  it('shows the server’s refusal of an edit, and stays on the form', async () => {
    withSends(available())
    background.set({
      sendUpdate: (() => ({
        ok: false,
        problem: 'policy',
        detail: 'Always show the sender’s email',
      })) as never,
    })
    const root = await openSend()
    await click(button(root, 'Edit'))
    await change(input(root, 'Name'), 'Other')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain('Your server doesn’t allow this: Always show the sender’s email')
    expect(root.querySelector('form')).not.toBeNull()
  })

  it('offers only Delete for a Send whose name does not open here', async () => {
    detail = sendDetail({ readable: false, name: undefined, notes: undefined, text: undefined })
    withSends(available({ sends: [sendView({ readable: false, name: undefined })] }))
    const root = await openPopup()
    await openSends(root)
    await click(button(root, 'Details of Can’t be read in this browser'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_unreadable'))
    expect(button(root, 'Edit')).toBeNull()
    expect(button(root, 'Copy link')).toBeNull()
    expect(button(root, 'Delete Can’t be read in this browser')).not.toBeNull()
  })
})

describe('in French', () => {
  it('says Sends in French, with the counts and states of the list', async () => {
    fake = installSendsChrome('fr')
    withSends(available())
    const root = await openPopup()
    await click(
      [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Envois')) ?? null,
    )
    expect(text(root)).toContain('Texte · Actif · Ouvertures : 1 sur 3')
    expect(fake.tabsCreated).toEqual([])
  })
})
