// @vitest-environment jsdom
import { h, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Ask from './ask'
import type * as Files from './files'
import { installSendsChrome, sendsMessage } from '../popup/sends-testing'
import {
  background,
  button,
  change,
  click,
  input,
  mount,
  settle,
  submit,
  text,
  unmountAll,
  type FakeChrome,
} from '../popup/testing'
import type { ReceivedSendView, SendResult, SendsListing } from '../shared/sends'
import { sendChunkBytes, sendFileLimit, sendsKeepAlivePort } from '../shared/sends'
import { ToastProvider } from '../shared/ui/components'
import { App } from './App'
import { AskError } from './ask'
import { saveBlob } from './files'
import { NewSend } from './new-send'
import { OpenSend } from './open-send'

vi.mock('./ask', async (importActual) => {
  const actual = await importActual<typeof Ask>()
  const { background } = await import('../popup/testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

// A download is a click on a link to a blob, which jsdom has no way to follow
vi.mock('./files', async (importActual) => ({
  ...(await importActual<typeof Files>()),
  saveBlob: vi.fn(),
}))

const ok = <T,>(value: T): SendResult<T> => ({ ok: true, value })
const available: SendsListing = { available: true, sends: [], foreign: [] }
const link = `https://kem.example.com/#/send/${'A'.repeat(22)}/${'B'.repeat(43)}`

let fake: FakeChrome

const mountTab = (node: ComponentChildren) => mount(h(ToastProvider, null, node))

beforeEach(() => {
  fake = installSendsChrome()
  background.reset()
  vi.mocked(saveBlob).mockClear()
})

afterEach(() => {
  unmountAll()
})

/** Chooses [file] as the browser's file picker would. */
async function pick(root: HTMLElement, file: File): Promise<void> {
  const box = root.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(box, 'files', { value: [file], configurable: true })
  await act(() => {
    box.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

/** A file whose bytes this test gives, since jsdom's `Blob` may not read itself. */
function fileOf(bytes: Uint8Array<ArrayBuffer>, name: string, type = 'text/plain'): File {
  const file = new File([bytes], name, { type })
  file.slice = (() => ({ arrayBuffer: async () => bytes.buffer })) as never
  return file
}

describe('New Send', () => {
  it('says where Sends are when the vault syncs elsewhere, and shows no form', async () => {
    background.reset({ sends: (() => ok({ available: false, place: 'webdav' })) as never })
    const root = await mountTab(h(NewSend, null))
    expect(text(root)).toContain(sendsMessage('en', 'sends_otherPlace', ['WebDAV']))
    expect(root.querySelector('form')).toBeNull()
    await click(button(root, 'Set up sync'))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/setup/index.html#again'])
  })

  it('says why the list did not load, and tries again', async () => {
    let tries = 0
    background.reset({
      sends: (() => {
        tries += 1
        return tries === 1 ? { ok: false, problem: 'network' } : ok(available)
      }) as never,
    })
    const root = await mountTab(h(NewSend, null))
    expect(text(root)).toContain(sendsMessage('en', 'sends_errorNetwork'))
    await click(button(root, 'Try again'))
    expect(root.querySelector('form')).not.toBeNull()
  })

  it('makes a text Send with the options as the app’s defaults, then copies the link without showing it', async () => {
    background.reset({
      sends: (() => ok(available)) as never,
      sendMake: (() => ok({ id: 's1' })) as never,
      sendCopyLink: (() => ok(null)) as never,
    })
    const root = await mountTab(h(NewSend, null))
    await change(input(root, 'Name'), 'Wi-Fi')
    await change(input(root, 'Text to send'), 'the password is on the fridge')
    await submit(root.querySelector('form'))
    expect(background.of('sendMake')[0]?.args).toEqual({
      input: {
        kind: 'text',
        name: 'Wi-Fi',
        text: 'the password is on the fridge',
        notes: '',
        deleteInDays: 7,
        hideEmail: false,
      },
    })
    expect(text(root)).toContain(sendsMessage('en', 'sends_linkTitle'))
    expect(text(root)).not.toContain('https://')
    // What was typed is gone with the form
    expect(text(root)).not.toContain('the password is on the fridge')
    await click(button(root, 'Copy link'))
    expect(background.of('sendCopyLink')[0]?.args).toEqual({ id: 's1' })
    expect(text(document.body)).toContain('Link copied')
    await click(button(root, 'Make another Send'))
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('')
  })

  it('carries a password, a limit and an early expiry to the core', async () => {
    background.reset({
      sends: (() => ok(available)) as never,
      sendMake: (() => ok({ id: 's1' })) as never,
    })
    const root = await mountTab(h(NewSend, null))
    await change(input(root, 'Name'), 'Code')
    await change(input(root, 'Text to send'), 'x')
    await change(input(root, 'Password'), 'hunter2')
    await click(root.querySelector('input[role="switch"]'))
    await change(input(root, 'Number of opens'), '3')
    await submit(root.querySelector('form'))
    const sent = background.of('sendMake')[0]?.args.input as Record<string, unknown>
    expect(sent).toMatchObject({ password: 'hunter2', maxAccess: 3, deleteInDays: 7 })
  })

  it('asks for what is missing, before asking the core', async () => {
    background.reset({
      sends: (() => ok(available)) as never,
      sendMake: (() => ok({ id: 's' })) as never,
    })
    const root = await mountTab(h(NewSend, null))
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_errorNoName'))
    await change(input(root, 'Name'), 'Wi-Fi')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_errorNoText'))
    expect(background.of('sendMake')).toHaveLength(0)
  })

  it('shows the server’s refusal in its words and keeps what was typed', async () => {
    background.reset({
      sends: (() => ok(available)) as never,
      sendMake: (() => ({ ok: false, problem: 'policy', detail: 'Remove Send' })) as never,
    })
    const root = await mountTab(h(NewSend, null))
    await change(input(root, 'Name'), 'Wi-Fi')
    await change(input(root, 'Text to send'), 'secret')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain('Your server doesn’t allow this: Remove Send')
    expect((input(root, 'Text to send') as HTMLInputElement).value).toBe('secret')
  })

  it('gives a file to the core in pieces before it makes the Send, naming it after the file', async () => {
    const bytes = new TextEncoder().encode('hello file') as Uint8Array<ArrayBuffer>
    background.reset({
      sends: (() => ok(available)) as never,
      sendStageFile: (() => ok({ handle: 'h1', length: bytes.length })) as never,
      sendMake: (() => ok({ id: 's2' })) as never,
    })
    const root = await mountTab(h(NewSend, null))
    await click(button(root, 'File'))
    await pick(root, fileOf(bytes, 'note.txt'))
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('note.txt')
    expect(text(root)).toContain('note.txt, 10 B')
    await submit(root.querySelector('form'))
    // The first piece names no file: the core answers the handle every later call, and the Send, name
    expect(background.of('sendStageFile')[0]?.args).toEqual({ data: btoa('hello file') })
    expect(background.of('sendMake')[0]?.args).toEqual({
      input: {
        kind: 'file',
        name: 'note.txt',
        mime: 'text/plain',
        notes: '',
        deleteInDays: 7,
        hideEmail: false,
        handle: 'h1',
        size: 10,
      },
    })
    expect(background.calls.map((call) => call.kind)).toEqual([
      'sends',
      'sendStageFile',
      'sendMake',
    ])
  })

  it('names the pieces after the first by the handle, and holds the background meanwhile', async () => {
    const bytes = new Uint8Array(sendChunkBytes + 5) as Uint8Array<ArrayBuffer>
    const port = { postMessage: vi.fn(), disconnect: vi.fn() }
    const connect = vi.fn(() => port)
    Object.assign(globalThis.chrome.runtime, { connect })
    background.reset({
      sends: (() => ok(available)) as never,
      sendStageFile: ((args: { handle?: string }) =>
        ok({
          handle: 'h1',
          length: args.handle === undefined ? sendChunkBytes : bytes.length,
        })) as never,
      sendMake: (() => ok({ id: 's2' })) as never,
    })
    const root = await mountTab(h(NewSend, null))
    await click(button(root, 'File'))
    const file = fileOf(bytes, 'big.bin')
    file.slice = ((from: number, to: number) => ({
      arrayBuffer: async () => bytes.slice(from, to).buffer,
    })) as never
    await pick(root, file)
    await submit(root.querySelector('form'))
    expect(background.of('sendStageFile').map((call) => call.args.handle)).toEqual([
      undefined,
      'h1',
    ])
    expect(background.of('sendMake')[0]?.args).toMatchObject({
      input: { handle: 'h1', size: sendChunkBytes + 5 },
    })
    // The background was held while the file went up, and let go after
    expect(connect).toHaveBeenCalledWith({ name: sendsKeepAlivePort })
    expect(port.disconnect).toHaveBeenCalled()
  })

  it('says the file is lost when the core no longer holds it', async () => {
    const bytes = new TextEncoder().encode('hello file') as Uint8Array<ArrayBuffer>
    background.reset({
      sends: (() => ok(available)) as never,
      sendStageFile: (() => ok({ handle: 'h1', length: bytes.length })) as never,
      sendMake: (() => ({ ok: false, problem: 'lost' })) as never,
    })
    const root = await mountTab(h(NewSend, null))
    await click(button(root, 'File'))
    await pick(root, fileOf(bytes, 'note.txt'))
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_lostFile'))
  })

  it('cuts a file’s own name to what a Send takes', async () => {
    background.reset({ sends: (() => ok(available)) as never })
    const root = await mountTab(h(NewSend, null))
    await click(button(root, 'File'))
    await pick(root, fileOf(new Uint8Array(3) as Uint8Array<ArrayBuffer>, `${'n'.repeat(600)}.txt`))
    expect((input(root, 'Name') as HTMLInputElement).value).toHaveLength(512)
  })

  it('refuses a file over the limit before reading it, and one with nothing in it', async () => {
    background.reset({ sends: (() => ok(available)) as never })
    const root = await mountTab(h(NewSend, null))
    await click(button(root, 'File'))
    const big = new File([], 'big.bin')
    Object.defineProperty(big, 'size', { value: sendFileLimit + 1 })
    await pick(root, big)
    expect(text(root)).toContain('That file is over 50 MB')
    await pick(root, new File([], 'empty.txt'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_errorEmptyFile'))
    expect(background.of('sendStageFile')).toHaveLength(0)
  })
})

describe('Open a Send', () => {
  const text1 = (over: Partial<ReceivedSendView> = {}): ReceivedSendView => ({
    handle: 'h1',
    kind: 'text',
    name: 'Wi-Fi',
    text: 'the password is on the fridge',
    tooBig: false,
    deletionAt: Date.parse('2026-12-01T12:00:00Z'),
    senderEmail: 'sam@example.com',
    host: 'kem.example.com',
    ...over,
  })

  async function paste(root: HTMLElement, value = link) {
    await change(input(root, 'Send link'), value)
    await submit(root.querySelector('form'))
  }

  it('asks the browser for the link’s server, then the core for the Send, and shows its text', async () => {
    background.reset({ sendOpen: (() => ok(text1())) as never })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    expect(fake.permissionRequests).toEqual([{ origins: ['https://kem.example.com/*'] }])
    expect(background.of('sendOpen')[0]?.args).toEqual({ link })
    expect(text(root)).toContain('the password is on the fridge')
    expect(text(root)).toContain(sendsMessage('en', 'sends_from', ['sam@example.com']))
    expect(text(root)).not.toContain(link)
  })

  it('copies the text through the background and closes, letting the core go of it', async () => {
    background.reset({
      sendOpen: (() => ok(text1())) as never,
      sendCopyText: (() => undefined) as never,
      sendClose: (() => undefined) as never,
    })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    await click(button(root, 'Copy'))
    expect(background.of('sendCopyText').map((call) => call.args)).toEqual([{ handle: 'h1' }])
    expect(text(document.body)).toContain('Copied')
    await click(button(root, 'Close'))
    expect(background.of('sendClose').map((call) => call.args)).toEqual([{ handle: 'h1' }])
    expect(text(root)).not.toContain('the password is on the fridge')
    expect(input(root, 'Send link')).not.toBeNull()
  })

  it('does not ask the core when the person refuses access to the server', async () => {
    fake.grant = false
    background.reset({ sendOpen: (() => ok(text1())) as never })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_accessRefused', ['kem.example.com']))
    expect(background.of('sendOpen')).toHaveLength(0)
  })

  it('asks for the password when the Send has one, and sends it with the same link', async () => {
    const answers: SendResult<ReceivedSendView>[] = [
      { ok: false, problem: 'passwordRequired' },
      { ok: false, problem: 'wrongPassword' },
      ok(text1()),
    ]
    background.reset({ sendOpen: (() => answers.shift()) as never })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_passwordTitle'))
    await change(input(root, 'Password'), 'nope')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_wrongPassword'))
    await change(input(root, 'Password'), 'hunter2')
    await submit(root.querySelector('form'))
    expect(background.of('sendOpen').map((call) => call.args)).toEqual([
      { link },
      { link, password: 'nope' },
      { link, password: 'hunter2' },
    ])
    expect(text(root)).toContain('the password is on the fridge')
  })

  it('waits after too many tries, and says how long', async () => {
    background.reset({
      sendOpen: (() => ({ ok: false, problem: 'rateLimited', seconds: 30 })) as never,
    })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_tooMany', [30]))
    expect(button(root, 'Open')?.disabled).toBe(true)
  })

  it('says a closed Send is not available, with the open that may have been spent', async () => {
    background.reset({ sendOpen: (() => ({ ok: false, problem: 'notFound' })) as never })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    expect(text(root)).toContain(sendsMessage('en', 'sends_notAvailable'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_notAvailableHint'))
  })

  it('says what is not a Send link before asking anyone, and sends a Bitwarden Send to a browser tab', async () => {
    background.reset({ sendOpen: (() => ({ ok: false, problem: 'bitwarden' })) as never })
    const root = await mountTab(h(OpenSend, null))
    await paste(root, 'hello')
    expect(text(root)).toContain(sendsMessage('en', 'sends_notASend'))
    expect(fake.permissionRequests).toEqual([])
    expect(background.of('sendOpen')).toHaveLength(0)
    const bitwarden = `https://vault.bitwarden.example/#/send/${'A'.repeat(22)}/${'B'.repeat(22)}`
    await paste(root, bitwarden)
    expect(text(root)).toContain(sendsMessage('en', 'sends_bitwarden'))
    await click(button(root, 'Open in a browser tab'))
    expect(fake.tabsCreated).toEqual([bitwarden])
  })

  it('sends the core and the permission only the link it found, not the message around it', async () => {
    background.reset({ sendOpen: (() => ok(text1())) as never })
    const root = await mountTab(h(OpenSend, null))
    const other = `https://evil.example/#/send/${'C'.repeat(22)}/${'D'.repeat(43)}`
    await paste(root, `Here you go: <${link}>. Not this one: ${other}`)
    expect(background.of('sendOpen').map((call) => call.args)).toEqual([{ link }])
    expect(fake.permissionRequests).toEqual([{ origins: ['https://kem.example.com/*'] }])
  })

  it('refuses a link whose key goes on, and what is too long, before asking anyone', async () => {
    background.reset({ sendOpen: (() => ok(text1())) as never })
    const root = await mountTab(h(OpenSend, null))
    await paste(root, `${link}EXTRA`)
    expect(text(root)).toContain(sendsMessage('en', 'sends_notASend'))
    await paste(root, `${link} ${'x'.repeat(8200)}`)
    expect(text(root)).toContain(sendsMessage('en', 'sends_inputTooLong'))
    expect(background.of('sendOpen')).toHaveLength(0)
    expect(fake.permissionRequests).toEqual([])
  })

  it('holds the background while a Send is open, and lets go when it is closed', async () => {
    const port = { postMessage: vi.fn(), disconnect: vi.fn() }
    const connect = vi.fn(() => port)
    Object.assign(globalThis.chrome.runtime, { connect })
    background.reset({
      sendOpen: (() => ok(text1())) as never,
      sendClose: (() => undefined) as never,
    })
    const root = await mountTab(h(OpenSend, null))
    expect(connect).not.toHaveBeenCalled()
    await paste(root)
    expect(connect).toHaveBeenCalledWith({ name: sendsKeepAlivePort })
    await click(button(root, 'Close'))
    expect(port.disconnect).toHaveBeenCalled()
  })

  it('says to open the link again when the core no longer holds the Send', async () => {
    background.reset({
      sendOpen: (() => ok(text1())) as never,
      sendCopyText: (() => {
        throw new AskError('notFound')
      }) as never,
    })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    await click(button(root, 'Copy'))
    expect(text(document.body)).toContain(sendsMessage('en', 'sends_lostReceived'))
  })

  it('shows a file Send’s name, type and size, and fetches it only when saved', async () => {
    const bytes = new TextEncoder().encode('hello file')
    const pieces = [btoa('hello file'), '']
    background.reset({
      sendOpen: (() =>
        ok(
          text1({
            kind: 'file',
            name: '../scan.txt',
            text: undefined,
            mime: 'text/plain',
            size: bytes.length,
          }),
        )) as never,
      sendDownload: (() => ok({ size: bytes.length })) as never,
      sendReadFile: ((args: { index: number }) => pieces[args.index] ?? '') as never,
    })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    expect(text(root)).toContain('text/plain, 10 B')
    expect(text(root)).toContain(sendsMessage('en', 'sends_fileUses'))
    expect(background.of('sendDownload')).toHaveLength(0)
    await click(button(root, 'Save the file'))
    expect(background.of('sendDownload')[0]?.args).toEqual({ handle: 'h1' })
    expect(background.of('sendReadFile').map((call) => call.args)).toEqual([
      { handle: 'h1', index: 0 },
      { handle: 'h1', index: 1 },
    ])
    const [blob, name] = vi.mocked(saveBlob).mock.calls[0]!
    expect(name).toBe('scan.txt')
    expect(blob.type).toBe('text/plain')
    expect(blob.size).toBe(bytes.length)
  })

  it('offers no Save for a file over what Kemlock downloads', async () => {
    background.reset({
      sendOpen: (() =>
        ok(
          text1({
            kind: 'file',
            name: 'big.bin',
            text: undefined,
            mime: 'x/y',
            size: sendFileLimit + 1,
            tooBig: true,
          }),
        )) as never,
    })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    expect(text(root)).toContain('This file is over 50 MB')
    expect(button(root, 'Save the file')).toBeNull()
  })

  it('shows the problem of a file that does not download, and lets the core go of the Send when the page goes', async () => {
    background.reset({
      sendOpen: (() =>
        ok(text1({ kind: 'file', name: 'a.bin', text: undefined, mime: 'x/y', size: 3 }))) as never,
      sendDownload: (() => ({ ok: false, problem: 'notFound' })) as never,
      sendClose: (() => undefined) as never,
    })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    await click(button(root, 'Save the file'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_notAvailable'))
    expect(saveBlob).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    expect(background.of('sendClose').map((call) => call.args)[0]).toEqual({ handle: 'h1' })
  })

  it('says the Send is lost, not closed, when a download finds the core without it', async () => {
    background.reset({
      sendOpen: (() =>
        ok(text1({ kind: 'file', name: 'a.bin', text: undefined, mime: 'x/y', size: 3 }))) as never,
      sendDownload: (() => ({ ok: false, problem: 'lost' })) as never,
    })
    const root = await mountTab(h(OpenSend, null))
    await paste(root)
    await click(button(root, 'Save the file'))
    expect(text(root)).toContain(sendsMessage('en', 'sends_lostReceived'))
  })
})

describe('when the vault locks', () => {
  const state = (unlocked: boolean) => ({ exists: true, unlocked, wrongPasswords: 0 })
  const lockIt = async () => {
    await act(() => {
      fake.lock()
    })
    await settle()
  }

  it('clears what was typed for a new Send, and says that Kemlock is locked', async () => {
    background.reset({ sends: (() => ok(available)) as never })
    const root = await mountTab(h(App, null))
    await change(input(root, 'Name'), 'Wi-Fi')
    await change(input(root, 'Text to send'), 'the password is on the fridge')
    await lockIt()
    expect(text(root)).toContain(sendsMessage('en', 'sends_lockedTitle'))
    expect(text(root)).not.toContain('the password is on the fridge')
    expect(root.querySelector('form')).toBeNull()
    expect(root.querySelector('textarea')).toBeNull()
  })

  it('takes a received Send down and lets the core go of it', async () => {
    background.reset({
      sendOpen: (() =>
        ok({
          handle: 'h1',
          kind: 'text',
          name: 'Wi-Fi',
          text: 'the password is on the fridge',
          tooBig: false,
          deletionAt: Date.parse('2026-12-01T12:00:00Z'),
          host: 'kem.example.com',
        })) as never,
      sendClose: (() => undefined) as never,
    })
    window.location.hash = '#open'
    const root = await mountTab(h(App, null))
    await change(input(root, 'Send link'), link)
    await submit(root.querySelector('form'))
    expect(text(root)).toContain('the password is on the fridge')
    await lockIt()
    expect(text(root)).not.toContain('the password is on the fridge')
    expect(text(root)).toContain(sendsMessage('en', 'sends_lockedTitle'))
    expect(background.of('sendClose').map((call) => call.args)).toEqual([{ handle: 'h1' }])
    window.location.hash = ''
  })

  it('comes back to the pages only when the background says the vault is open', async () => {
    let unlocked = false
    background.reset({
      sends: (() => ok(available)) as never,
      pageState: (() => state(unlocked)) as never,
    })
    const root = await mountTab(h(App, null))
    await lockIt()
    await click(button(root, sendsMessage('en', 'sends_lockedRetry')))
    expect(text(root)).toContain(sendsMessage('en', 'sends_lockedTitle'))
    unlocked = true
    await click(button(root, sendsMessage('en', 'sends_lockedRetry')))
    expect(text(root)).not.toContain(sendsMessage('en', 'sends_lockedTitle'))
    expect(root.querySelector('form')).not.toBeNull()
  })

  it('locks a tab that missed the message when it comes to the front and the vault is not open', async () => {
    background.reset({
      sends: (() => ok(available)) as never,
      pageState: (() => state(false)) as never,
    })
    const root = await mountTab(h(App, null))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(text(root)).toContain(sendsMessage('en', 'sends_lockedTitle'))
  })
})

describe('from a note', () => {
  const draft = { name: 'Wi-Fi', text: 'the password is on the fridge' }
  const noteSend: ReceivedSendView = {
    handle: 'h1',
    kind: 'text',
    name: 'Wi-Fi',
    text: 'the password is on the fridge',
    tooBig: false,
    deletionAt: Date.parse('2026-12-01T12:00:00Z'),
    host: 'kem.example.com',
  }

  afterEach(() => {
    window.history.replaceState(null, '', '#')
  })

  it('opens New Send with the note’s title and text, taken from the background with the token of the address', async () => {
    window.history.replaceState(null, '', '#new:abc-123')
    background.reset({
      sends: (() => ok(available)) as never,
      sendTakeDraft: (() => draft) as never,
    })
    const root = await mountTab(h(App, null))
    expect(background.of('sendTakeDraft').map((call) => call.args)).toEqual([{ token: 'abc-123' }])
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('Wi-Fi')
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe(draft.text)
    // The token leaves the address, and the text was never in it
    expect(window.location.hash).toBe('#new')
    expect(window.location.href).not.toContain('fridge')
  })

  it('asks for the draft once, even when the person goes to Open a Send and back', async () => {
    window.history.replaceState(null, '', '#new:abc-123')
    background.reset({
      sends: (() => ok(available)) as never,
      sendTakeDraft: (() => draft) as never,
    })
    const root = await mountTab(h(App, null))
    await click(button(root, 'Open a Send'))
    await click(button(root, 'New Send'))
    expect(background.of('sendTakeDraft')).toHaveLength(1)
  })

  it('says so when the draft is gone, and leaves the form empty', async () => {
    window.history.replaceState(null, '', '#new:abc-123')
    background.reset({
      sends: (() => ok(available)) as never,
      sendTakeDraft: (() => null) as never,
    })
    const root = await mountTab(h(App, null))
    expect(text(root)).toContain(sendsMessage('en', 'sends_draftGone'))
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('')
  })

  it('asks for no draft when the tab is opened plainly', async () => {
    background.reset({ sends: (() => ok(available)) as never })
    await mountTab(h(App, null))
    expect(background.of('sendTakeDraft')).toHaveLength(0)
  })

  it('makes the note’s text a text Send like any other', async () => {
    window.history.replaceState(null, '', '#new:abc-123')
    background.reset({
      sends: (() => ok(available)) as never,
      sendTakeDraft: (() => draft) as never,
      sendMake: (() => ok({ id: 's1' })) as never,
    })
    const root = await mountTab(h(App, null))
    await submit(root.querySelector('form'))
    expect(background.of('sendMake')[0]?.args).toMatchObject({
      input: { kind: 'text', name: 'Wi-Fi', text: draft.text },
    })
  })

  it('saves a received text Send as a note, sending the core only the handle and the name', async () => {
    window.location.hash = '#open'
    background.reset({
      sendOpen: (() => ok(noteSend)) as never,
      sendSaveAsNote: (() => ({ id: 'n1' })) as never,
      sendClose: (() => undefined) as never,
    })
    const root = await mountTab(h(App, null))
    await change(input(root, 'Send link'), link)
    await submit(root.querySelector('form'))
    await click(button(root, sendsMessage('en', 'sends_saveNote')))
    expect(background.of('sendSaveAsNote').map((call) => call.args)).toEqual([{ handle: 'h1' }])
    expect(text(document.body)).toContain(sendsMessage('en', 'sends_noteSaved'))
    // Once: a second tap would make a second note
    expect(button(root, sendsMessage('en', 'sends_saveNote'))?.disabled).toBe(true)
  })

  it('says a text too long for a note, in the words of the note', async () => {
    window.location.hash = '#open'
    background.reset({
      sendOpen: (() => ok(noteSend)) as never,
      sendSaveAsNote: (() => {
        throw new AskError('invalid')
      }) as never,
      sendClose: (() => undefined) as never,
    })
    const root = await mountTab(h(App, null))
    await change(input(root, 'Send link'), link)
    await submit(root.querySelector('form'))
    await click(button(root, sendsMessage('en', 'sends_saveNote')))
    expect(text(root)).toContain(sendsMessage('en', 'sends_noteTooLong'))
    expect(button(root, sendsMessage('en', 'sends_saveNote'))?.disabled).toBe(false)
  })

  it('offers no Save as a note for a file Send', async () => {
    window.location.hash = '#open'
    background.reset({
      sendOpen: (() =>
        ok({ ...noteSend, kind: 'file', text: undefined, mime: 'x/y', size: 3 })) as never,
      sendClose: (() => undefined) as never,
    })
    const root = await mountTab(h(App, null))
    await change(input(root, 'Send link'), link)
    await submit(root.querySelector('form'))
    expect(button(root, sendsMessage('en', 'sends_saveNote'))).toBeNull()
  })
})
