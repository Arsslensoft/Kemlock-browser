import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sendsKeepAlivePort,
  type ReceivedSendView,
  type SendDetail,
  type SendResult,
  type SendsListing,
} from '../shared/sends'
import { fromBase64, toBase64 } from '../sends/files'
import { acceptSendsPort } from './sends'
import {
  content,
  harness,
  menuFrame,
  popup,
  self,
  setup,
  until,
  useClock,
  type Harness,
} from './test/harness'

/** The Sends tab, as the browser reports a message from it. */
const sendsTab = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/sends/index.html',
  origin: 'chrome-extension://kemlockid',
}

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

/** The vault syncs with Kemlock Server (the fake's Sends are on that place only). */
const syncsWithKemlock = () => {
  h.core.disk.sync = { place: 'kemlock', server: 'https://kem.example', running: false }
}
const fromTab = <T>(message: object) => h.ok<SendResult<T>>(message, sendsTab)
const listing = async () => {
  const result = await fromTab<SendsListing>({ kind: 'sends' })
  if (!result.ok || !result.value.available) throw new Error('no list')
  return result.value
}

/** Starts a staged file, or adds to the one under [handle]; the handle it answers. */
const stage = async (bytes: Uint8Array, handle?: string): Promise<string> => {
  const result = await fromTab<{ handle: string; length: number }>({
    kind: 'sendStageFile',
    data: toBase64(bytes),
    ...(handle === undefined ? {} : { handle }),
  })
  if (!result.ok) throw new Error('not staged')
  return result.value.handle
}

/** Opens a link and gives the handle of the Send it opened. */
const openHandle = async (link: string): Promise<string> => {
  const result = await fromTab<ReceivedSendView>({ kind: 'sendOpen', link })
  if (!result.ok) throw new Error('not opened')
  return result.value.handle
}

const text = {
  kind: 'text',
  name: 'Wi-Fi',
  text: 'the password is on the fridge',
  notes: 'for the guests',
  deleteInDays: 7,
  hideEmail: false,
}

describe('who may ask for Sends', () => {
  const asks = [
    { kind: 'sends' },
    { kind: 'sendGet', id: 's1' },
    { kind: 'sendCopyLink', id: 's1' },
    { kind: 'sendUpdate', id: 's1', patch: {} },
    { kind: 'sendDelete', id: 's1' },
  ]
  const tabOnly = [
    { kind: 'sendStageFile', data: 'AAAA' },
    { kind: 'sendMake', input: text },
    { kind: 'sendOpen', link: 'https://kem.example/#/send/x/y' },
    { kind: 'sendDownload', handle: 'h1' },
    { kind: 'sendReadFile', handle: 'h1', index: 0 },
    { kind: 'sendCopyText', handle: 'h1' },
    { kind: 'sendClose', handle: 'h1' },
  ]

  it('is the popup and the Sends tab for the list, a Send’s page and its changes', async () => {
    syncsWithKemlock()
    for (const message of asks) {
      expect(await h.send(message, popup)).not.toEqual({ ok: false, error: 'refused' })
      expect(await h.send(message, sendsTab)).not.toEqual({ ok: false, error: 'refused' })
    }
  })

  it('is the Sends tab alone for making a Send and opening one', async () => {
    for (const message of tabOnly)
      expect(await h.send(message, popup)).toEqual({ ok: false, error: 'refused' })
  })

  it('is no other page, no menu frame and no web page', async () => {
    const page = content('https://evil.example/')
    for (const message of [...asks, ...tabOnly]) {
      expect(await h.send(message, setup)).toEqual({ ok: false, error: 'refused' })
      expect(await h.send(message, menuFrame)).toEqual({ ok: false, error: 'refused' })
      expect(await h.send(message, page)).toEqual({ ok: false, error: 'refused' })
    }
  })

  it('needs the vault open', async () => {
    await h.ok({ kind: 'lock' })
    for (const message of [...asks, ...tabOnly.filter((m) => m.kind !== 'sendClose')])
      expect(await h.send(message, sendsTab)).toEqual({ ok: false, error: 'locked' })
  })
})

describe('where Sends are', () => {
  it('say so when the vault syncs with no Kemlock Server', async () => {
    expect(await fromTab({ kind: 'sends' })).toEqual({
      ok: true,
      value: { available: false, place: null },
    })
    h.core.disk.sync = { place: 'webdav', server: 'https://dav.example', running: false }
    expect(await fromTab({ kind: 'sends' })).toEqual({
      ok: true,
      value: { available: false, place: 'webdav' },
    })
    h.core.disk.sync = { place: 'vaultwarden', server: 'https://vw.example', running: false }
    expect(await h.ok({ kind: 'sends' }, popup)).toEqual({
      ok: true,
      value: { available: false, place: 'vaultwarden' },
    })
  })

  it('refuse to make one, and name the place', async () => {
    h.core.disk.sync = { place: 'webdav', server: 'https://dav.example', running: false }
    expect(await fromTab({ kind: 'sendMake', input: text })).toEqual({
      ok: false,
      problem: 'noSync',
      place: 'webdav',
    })
  })
})

describe('making a Send', () => {
  beforeEach(syncsWithKemlock)

  it('answers its id and never its link', async () => {
    const made = await fromTab<{ id: string }>({ kind: 'sendMake', input: text })
    expect(made).toEqual({ ok: true, value: { id: expect.any(String) } })
    const [stored] = h.core.sends.sends
    expect(JSON.stringify(made)).not.toContain(stored!.key)
    const list = await listing()
    expect(list.sends).toHaveLength(1)
    expect(list.sends[0]).toMatchObject({ name: 'Wi-Fi', kind: 'text', status: 'active' })
    expect(JSON.stringify(list)).not.toContain(stored!.key)
    const detail = await h.ok<SendResult<SendDetail>>({ kind: 'sendGet', id: stored!.id }, popup)
    expect(detail.ok && detail.value.text).toBe('the password is on the fridge')
    expect(JSON.stringify(detail)).not.toContain(stored!.key)
  })

  it('copies the link through the clipboard that clears itself, and answers no link', async () => {
    const made = await fromTab<{ id: string }>({ kind: 'sendMake', input: text })
    const id = made.ok ? made.value.id : ''
    const done = await h.ok<SendResult<null>>({ kind: 'sendCopyLink', id }, popup)
    expect(done).toEqual({ ok: true, value: null })
    const [stored] = h.core.sends.sends
    expect(h.clipboard.text).toBe(h.core.sends.linkOf(stored!))
    expect(JSON.stringify(done)).not.toContain(stored!.key)
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => h.clipboard.text === '')
    expect(h.clipboard.text).toBe('')
  })

  it('refuses what the core refuses, in its words', async () => {
    expect(await fromTab({ kind: 'sendMake', input: { ...text, name: ' ' } })).toEqual({
      ok: false,
      problem: 'invalid',
      reason: 'noName',
    })
    expect(await fromTab({ kind: 'sendMake', input: { ...text, text: '' } })).toEqual({
      ok: false,
      problem: 'invalid',
      reason: 'noText',
    })
    expect(
      await fromTab({
        kind: 'sendMake',
        input: { ...text, expiresAt: Date.now() + 8 * 86_400_000 },
      }),
    ).toEqual({ ok: false, problem: 'invalid', reason: 'expiry' })
    expect(h.core.sends.sends).toHaveLength(0)
  })

  it('makes a file Send from the pieces the tab gave, under the handle the core gave it', async () => {
    const bytes = Uint8Array.from({ length: 2000 }, (_, i) => i & 0xff)
    const handle = await stage(bytes.subarray(0, 1500))
    expect(await stage(bytes.subarray(1500), handle)).toBe(handle)
    const made = await fromTab<{ id: string }>({
      kind: 'sendMake',
      input: {
        kind: 'file',
        name: 'scan.bin',
        mime: 'application/octet-stream',
        notes: '',
        deleteInDays: 3,
        hideEmail: false,
        handle,
        size: 2000,
      },
    })
    expect(made.ok).toBe(true)
    const [stored] = h.core.sends.sends
    expect(stored).toMatchObject({ kind: 'file', name: 'scan.bin' })
    expect([...stored!.file!]).toEqual([...bytes])
    // What was staged is let go: the handle opens nothing again
    expect(await fromTab({ kind: 'sendStageFile', data: 'AAAA', handle })).toEqual({
      ok: false,
      problem: 'lost',
    })
  })

  it('refuses a file Send whose staged bytes are not the size the page counted, or whose handle is not known', async () => {
    const handle = await stage(new Uint8Array(100))
    const input = (over: object) => ({
      kind: 'file',
      name: 'a',
      notes: '',
      deleteInDays: 3,
      hideEmail: false,
      handle,
      size: 100,
      ...over,
    })
    expect(await fromTab({ kind: 'sendMake', input: input({ handle: 'nope' }) })).toEqual({
      ok: false,
      problem: 'lost',
    })
    expect(await fromTab({ kind: 'sendMake', input: input({ size: 99 }) })).toEqual({
      ok: false,
      problem: 'lost',
    })
    expect(h.core.sends.sends).toHaveLength(0)
  })

  it('keeps two tabs’ files apart: each has its own handle, and the file made is the one it staged', async () => {
    const one = await stage(Uint8Array.from({ length: 10 }, () => 1))
    const two = await stage(Uint8Array.from({ length: 10 }, () => 2))
    expect(one).not.toBe(two)
    const input = (handle: string, name: string) => ({
      kind: 'file',
      name,
      notes: '',
      deleteInDays: 3,
      hideEmail: false,
      handle,
      size: 10,
    })
    await fromTab({ kind: 'sendMake', input: input(two, 'second') })
    await fromTab({ kind: 'sendMake', input: input(one, 'first') })
    const files = Object.fromEntries(h.core.sends.sends.map((send) => [send.name, send.file![0]]))
    expect(files).toEqual({ first: 1, second: 2 })
  })

  it('lets go of a staged file when its tab closes it, and of a text Send’s', async () => {
    const closed = await stage(new Uint8Array(5))
    await h.ok({ kind: 'sendClose', handle: closed }, sendsTab)
    expect(await fromTab({ kind: 'sendStageFile', data: 'AAAA', handle: closed })).toEqual({
      ok: false,
      problem: 'lost',
    })
    const left = await stage(new Uint8Array(5))
    await fromTab({ kind: 'sendMake', input: { ...text, handle: left } })
    expect(await fromTab({ kind: 'sendStageFile', data: 'AAAA', handle: left })).toEqual({
      ok: false,
      problem: 'lost',
    })
  })

  it('says the file is lost when the worker stopped meanwhile', async () => {
    const handle = await stage(new Uint8Array(5))
    // A stopped worker wakes with nothing held: the core is new, and the handle is not known
    h.core.sends.unload()
    expect(await fromTab({ kind: 'sendStageFile', data: 'AAAA', handle })).toEqual({
      ok: false,
      problem: 'lost',
    })
  })

  it('edits, turns off, and deletes', async () => {
    const made = await fromTab<{ id: string }>({ kind: 'sendMake', input: text })
    const id = made.ok ? made.value.id : ''
    expect(
      await h.ok({ kind: 'sendUpdate', id, patch: { name: 'Guest Wi-Fi', disabled: true } }, popup),
    ).toEqual({ ok: true, value: null })
    expect((await listing()).sends[0]).toMatchObject({
      name: 'Guest Wi-Fi',
      status: 'off',
      disabled: true,
    })
    expect(await h.ok({ kind: 'sendDelete', id }, popup)).toEqual({ ok: true, value: null })
    expect((await listing()).sends).toEqual([])
    expect(await h.ok({ kind: 'sendGet', id }, popup)).toEqual({ ok: false, problem: 'notFound' })
  })
})

describe('opening a Send', () => {
  it('shows a text Send, and copies its text through the clipboard that clears itself', async () => {
    const link = h.core.sends.plant({ name: 'Wi-Fi', text: 'the password is on the fridge' })
    const opened = await fromTab<ReceivedSendView>({ kind: 'sendOpen', link })
    expect(opened).toMatchObject({ ok: true, value: { kind: 'text', name: 'Wi-Fi' } })
    const handle = await openHandle(link)
    await h.ok({ kind: 'sendCopyText', handle }, sendsTab)
    expect(h.clipboard.text).toBe('the password is on the fridge')
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => h.clipboard.text === '')
    expect(h.clipboard.text).toBe('')
  })

  it('needs no account: a vault that syncs nowhere opens it', async () => {
    expect(h.core.disk.sync).toBeNull()
    const link = h.core.sends.plant({ name: 'a', text: 'b' })
    expect(await fromTab({ kind: 'sendOpen', link })).toMatchObject({ ok: true })
  })

  it('asks for the password, and counts the wrong ones', async () => {
    const link = h.core.sends.plant({ name: 'Code', text: 'x', password: 'hunter2' })
    expect(await fromTab({ kind: 'sendOpen', link })).toEqual({
      ok: false,
      problem: 'passwordRequired',
    })
    expect(await fromTab({ kind: 'sendOpen', link, password: 'nope' })).toEqual({
      ok: false,
      problem: 'wrongPassword',
    })
    expect(await fromTab({ kind: 'sendOpen', link, password: 'hunter2' })).toMatchObject({
      ok: true,
    })
  })

  it('says a closed Send is not there, and what is not a link is not one', async () => {
    const link = h.core.sends.plant({ name: 'a', text: 'b', disabled: true })
    expect(await fromTab({ kind: 'sendOpen', link })).toEqual({ ok: false, problem: 'notFound' })
    expect(await fromTab({ kind: 'sendOpen', link: 'hello' })).toEqual({
      ok: false,
      problem: 'badLink',
    })
    expect(
      await fromTab({
        kind: 'sendOpen',
        link: `https://kem.example/#/send/${'a'.repeat(22)}/${'b'.repeat(22)}`,
      }),
    ).toEqual({ ok: false, problem: 'bitwarden' })
  })

  it('downloads a file Send in pieces, once, and lets go on close', async () => {
    const file = Uint8Array.from({ length: 3000 }, (_, i) => (i * 3) & 0xff)
    const link = h.core.sends.plant({
      name: 'scan.bin',
      kind: 'file',
      mime: 'application/pdf',
      file,
    })
    const opened = await fromTab<ReceivedSendView>({ kind: 'sendOpen', link })
    expect(opened).toMatchObject({
      ok: true,
      value: { kind: 'file', name: 'scan.bin', mime: 'application/pdf', size: 3000, tooBig: false },
    })
    const handle = opened.ok ? opened.value.handle : ''
    expect(h.core.sends.sends[0]!.accessCount).toBe(0)
    expect(await fromTab({ kind: 'sendDownload', handle })).toEqual({
      ok: true,
      value: { size: 3000 },
    })
    await fromTab({ kind: 'sendDownload', handle })
    expect(h.core.sends.sends[0]!.accessCount).toBe(1)
    const piece = await h.ok<string>({ kind: 'sendReadFile', handle, index: 0 }, sendsTab)
    expect([...fromBase64(piece)]).toEqual([...file])
    expect(await h.ok<string>({ kind: 'sendReadFile', handle, index: 1 }, sendsTab)).toBe('')
    await h.ok({ kind: 'sendClose', handle }, sendsTab)
    expect(await h.send({ kind: 'sendReadFile', handle, index: 0 }, sendsTab)).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('keeps two tabs’ Sends apart: a handle opens only the Send it was given for', async () => {
    const first = await openHandle(h.core.sends.plant({ name: 'one', text: 'first secret' }))
    const second = await openHandle(h.core.sends.plant({ name: 'two', text: 'second secret' }))
    expect(first).not.toBe(second)
    await h.ok({ kind: 'sendCopyText', handle: first }, sendsTab)
    expect(h.clipboard.text).toBe('first secret')
    await h.ok({ kind: 'sendCopyText', handle: second }, sendsTab)
    expect(h.clipboard.text).toBe('second secret')
    // One tab closing its Send leaves the other's
    await h.ok({ kind: 'sendClose', handle: first }, sendsTab)
    expect(await h.send({ kind: 'sendCopyText', handle: first }, sendsTab)).toEqual({
      ok: false,
      error: 'notFound',
    })
    await h.ok({ kind: 'sendCopyText', handle: second }, sendsTab)
    expect(h.clipboard.text).toBe('second secret')
  })

  it('answers lost to a download of a Send the core no longer holds', async () => {
    const file = Uint8Array.from({ length: 10 }, () => 7)
    const handle = await openHandle(h.core.sends.plant({ name: 'a', kind: 'file', file }))
    h.core.sends.unload()
    expect(await fromTab({ kind: 'sendDownload', handle })).toEqual({ ok: false, problem: 'lost' })
  })

  it('lets go of what it holds when the vault locks', async () => {
    const link = h.core.sends.plant({ name: 'a', text: 'secret' })
    const handle = await openHandle(link)
    const staged = await stage(new Uint8Array(5))
    await h.ok({ kind: 'lock' }, popup)
    await h.ok({ kind: 'unlock', password: 'correct horse' }, popup)
    expect(await h.send({ kind: 'sendCopyText', handle }, sendsTab)).toEqual({
      ok: false,
      error: 'notFound',
    })
    expect(await fromTab({ kind: 'sendStageFile', data: 'AAAA', handle: staged })).toEqual({
      ok: false,
      problem: 'lost',
    })
  })
})

describe('the port the Sends tab holds', () => {
  const portFrom = (sender: object | undefined, name = sendsKeepAlivePort) => {
    const listeners: (() => void)[] = []
    return {
      port: {
        name,
        sender,
        disconnect: vi.fn(),
        onMessage: { addListener: (listener: () => void) => listeners.push(listener) },
      } as unknown as chrome.runtime.Port,
      listeners,
    }
  }

  it('is kept for the Sends tab, which then only has to ping it', () => {
    const { port, listeners } = portFrom(sendsTab)
    acceptSendsPort(port, self)
    expect(port.disconnect).not.toHaveBeenCalled()
    expect(listeners).toHaveLength(1)
  })

  it('is closed for any other page, a web page, another name, or no sender', () => {
    for (const sender of [popup, setup, menuFrame, content('https://evil.example/'), undefined]) {
      const { port, listeners } = portFrom(sender)
      acceptSendsPort(port, self)
      expect(port.disconnect).toHaveBeenCalledTimes(1)
      expect(listeners).toHaveLength(0)
    }
    const { port } = portFrom(sendsTab, 'something-else')
    acceptSendsPort(port, self)
    expect(port.disconnect).toHaveBeenCalledTimes(1)
    const other = portFrom({ ...sendsTab, id: 'another-extension' })
    acceptSendsPort(other.port, self)
    expect(other.port.disconnect).toHaveBeenCalledTimes(1)
  })
})
