// Sends and notes in the background: "Send this note" (the popup asks the background to hold a note's text for the Sends tab, which takes
// it once under a token) and "Save as a note" (a received text Send becomes a note, the text going from the core to the note and through
// no page).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteView } from '../shared/api'
import type { SendDraft, SendResult } from '../shared/sends'
import { sendDraftKeepMs, sendNameMaxLength } from '../shared/sends'
import { content, harness, menuFrame, popup, setup, useClock, type Harness } from './test/harness'

const sendsTab = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/sends/index.html',
  origin: 'chrome-extension://kemlockid',
}
const keysTab = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/keys/index.html',
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

const syncsWithKemlock = () => {
  h.core.disk.sync = { place: 'kemlock', server: 'https://kem.example', running: false }
}
const makeNote = (title: string, text: string) =>
  h.ok<NoteView>({ kind: 'saveNote', id: null, input: { title, text } }, popup)
const fromNote = (id: string) =>
  h.ok<SendResult<{ token: string }>>({ kind: 'sendFromNote', id }, popup)
const take = (token: string) => h.ok<SendDraft | null>({ kind: 'sendTakeDraft', token }, sendsTab)
const draftOf = async (id: string): Promise<string> => {
  const made = await fromNote(id)
  if (!made.ok) throw new Error('no draft')
  return made.value.token
}

describe('Send this note', () => {
  it('is the popup’s to ask, and no other page’s, menu frame’s or web page’s', async () => {
    syncsWithKemlock()
    const note = await makeNote('Wi-Fi', 'on the fridge')
    for (const sender of [sendsTab, keysTab, setup, menuFrame, content('https://evil.example/')])
      expect(await h.send({ kind: 'sendFromNote', id: note.id }, sender)).toEqual({
        ok: false,
        error: 'refused',
      })
  })

  it('names the place the vault syncs with instead, and holds nothing, where Sends are not', async () => {
    const note = await makeNote('Wi-Fi', 'on the fridge')
    expect(await fromNote(note.id)).toEqual({ ok: false, problem: 'noSync', place: null })
    h.core.disk.sync = { place: 'webdav', server: 'https://dav.example', running: false }
    expect(await fromNote(note.id)).toEqual({ ok: false, problem: 'noSync', place: 'webdav' })
  })

  it('answers a token and never the text, and the Sends tab takes the title and text once', async () => {
    syncsWithKemlock()
    const note = await makeNote('Wi-Fi', 'the password is on the fridge')
    const made = await fromNote(note.id)
    expect(made.ok).toBe(true)
    expect(JSON.stringify(made)).not.toContain('fridge')
    const token = await draftOf(note.id)
    expect(await take(token)).toEqual({ name: 'Wi-Fi', text: 'the password is on the fridge' })
    // Once: the next ask, with this token or any other, finds nothing
    expect(await take(token)).toBeNull()
    expect(await take('some-other-token')).toBeNull()
  })

  it('keeps the longest title a note takes, which is what a Send’s name takes', async () => {
    syncsWithKemlock()
    // A note's title and a Send's name share the 512 limit, so a title always fits whole
    const note = await makeNote('t'.repeat(sendNameMaxLength), 'text')
    const draft = await take(await draftOf(note.id))
    expect(draft?.name).toHaveLength(sendNameMaxLength)
  })

  it('is taken by the Sends tab only', async () => {
    syncsWithKemlock()
    const note = await makeNote('Wi-Fi', 'text')
    const token = await draftOf(note.id)
    for (const sender of [popup, keysTab, setup, menuFrame, content('https://evil.example/')])
      expect(await h.send({ kind: 'sendTakeDraft', token }, sender)).toEqual({
        ok: false,
        error: 'refused',
      })
    // Refused asks took nothing
    expect(await take(token)).toEqual({ name: 'Wi-Fi', text: 'text' })
  })

  describe('its timer', () => {
    /** The timers set for a draft: the ones with its two minutes as their delay. */
    const draftTimers = (set: { mock: { calls: unknown[][]; results: { value: unknown }[] } }) =>
      set.mock.calls.flatMap((call, index) =>
        call[1] === sendDraftKeepMs ? [set.mock.results[index]!.value] : [],
      )

    it('deletes the draft when its two minutes are up, whether or not the tab came', async () => {
      syncsWithKemlock()
      const set = vi.spyOn(globalThis, 'setTimeout')
      const note = await makeNote('Wi-Fi', 'text')
      const token = await draftOf(note.id)
      expect(draftTimers(set)).toHaveLength(1)
      // Nobody asks: the timer fires and the draft is gone, which the first ask afterwards finds
      await vi.advanceTimersByTimeAsync(sendDraftKeepMs)
      expect(await take(token)).toBeNull()
    })

    it('is cleared when the tab takes the draft, and by a lock', async () => {
      syncsWithKemlock()
      const set = vi.spyOn(globalThis, 'setTimeout')
      const clear = vi.spyOn(globalThis, 'clearTimeout')
      const note = await makeNote('Wi-Fi', 'text')
      const first = await draftOf(note.id)
      const [firstTimer] = draftTimers(set)
      expect(await take(first)).not.toBeNull()
      expect(clear).toHaveBeenCalledWith(firstTimer)

      await draftOf(note.id)
      const secondTimer = draftTimers(set)[1]
      expect(secondTimer).toBeDefined()
      await h.ok({ kind: 'lock' }, popup)
      expect(clear).toHaveBeenCalledWith(secondTimer)
    })
  })

  it('is kept two minutes, and gone after', async () => {
    syncsWithKemlock()
    const note = await makeNote('Wi-Fi', 'text')
    const token = await draftOf(note.id)
    await vi.advanceTimersByTimeAsync(sendDraftKeepMs + 1000)
    expect(await take(token)).toBeNull()
  })

  it('is let go of when the vault locks, and not given back by the next unlock', async () => {
    syncsWithKemlock()
    const note = await makeNote('Wi-Fi', 'text')
    const token = await draftOf(note.id)
    await h.ok({ kind: 'lock' }, popup)
    expect(await h.send({ kind: 'sendTakeDraft', token }, sendsTab)).toEqual({
      ok: false,
      error: 'locked',
    })
    await h.ok({ kind: 'unlock', password: 'correct horse' }, popup)
    expect(await take(token)).toBeNull()
  })

  it('says a note that is not there is not there', async () => {
    syncsWithKemlock()
    expect(await h.send({ kind: 'sendFromNote', id: 'nope' }, popup)).toMatchObject({
      ok: false,
    })
  })
})

describe('Save as a note', () => {
  const received = async (text = 'the password is on the fridge', name = 'Wi-Fi') => {
    const link = h.core.sends.plant({ name, text })
    const opened = await h.ok<SendResult<{ handle: string }>>({ kind: 'sendOpen', link }, sendsTab)
    if (!opened.ok) throw new Error('not opened')
    return opened.value.handle
  }
  const notes = () => h.ok<NoteView[]>({ kind: 'notes' }, popup)

  it('makes a note of the received text, named as the Send is, through saveNote', async () => {
    const handle = await received()
    const spy = vi.spyOn(h.core, 'saveNote')
    const saved = await h.ok<{ id: string }>({ kind: 'sendSaveAsNote', handle }, sendsTab)
    expect(spy).toHaveBeenCalledWith(null, {
      title: 'Wi-Fi',
      text: 'the password is on the fridge',
    })
    const [held] = await notes()
    expect(held).toMatchObject({ id: saved.id, title: 'Wi-Fi' })
    const full = await h.ok<{ text: string }>({ kind: 'revealNote', id: saved.id }, popup)
    expect(full.text).toBe('the password is on the fridge')
  })

  it('takes the text and the title from the core and the Send, not from the page', async () => {
    const handle = await received('what the core holds')
    // Whatever else the page adds to the message is dropped before it gets here
    const saved = await h.ok<{ id: string }>(
      { kind: 'sendSaveAsNote', handle, title: 'what the page says', text: 'what the page says' },
      sendsTab,
    )
    const full = await h.ok<{ text: string; title: string }>(
      { kind: 'revealNote', id: saved.id },
      popup,
    )
    expect(full.text).toBe('what the core holds')
    expect(full.title).toBe('Wi-Fi')
  })

  it('cuts the Send’s name to what a Send’s name takes, and names a Send with none "Received Send"', async () => {
    const long = await received('text', 'n'.repeat(600))
    const cut = await h.ok<{ id: string }>({ kind: 'sendSaveAsNote', handle: long }, sendsTab)
    expect(
      (await h.ok<{ title: string }>({ kind: 'revealNote', id: cut.id }, popup)).title,
    ).toHaveLength(512)

    // The background's strings come from the extension's own locale, which the mock has to be given
    h.mock.messages.sends_receivedNoteTitle = 'Received Send'
    const bare = await received('text', '  ')
    const named = await h.ok<{ id: string }>({ kind: 'sendSaveAsNote', handle: bare }, sendsTab)
    expect((await h.ok<{ title: string }>({ kind: 'revealNote', id: named.id }, popup)).title).toBe(
      'Received Send',
    )
  })

  it('forgets a Send’s name when its tab closes it: the fallback names the note then', async () => {
    const handle = await received('text')
    await h.ok({ kind: 'sendClose', handle }, sendsTab)
    expect(await h.send({ kind: 'sendSaveAsNote', handle }, sendsTab)).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('tells sync about the new note', async () => {
    const handle = await received()
    const spy = vi.spyOn(h.bg['d'].sync, 'changed')
    await h.ok({ kind: 'sendSaveAsNote', handle }, sendsTab)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('is the Sends tab’s to ask, and needs the vault open', async () => {
    const handle = await received()
    for (const sender of [popup, keysTab, setup, menuFrame, content('https://evil.example/')])
      expect(await h.send({ kind: 'sendSaveAsNote', handle }, sender)).toEqual({
        ok: false,
        error: 'refused',
      })
    await h.ok({ kind: 'lock' }, popup)
    expect(await h.send({ kind: 'sendSaveAsNote', handle }, sendsTab)).toEqual({
      ok: false,
      error: 'locked',
    })
  })

  it('says a handle the core does not hold is not there, and makes no note', async () => {
    expect(await h.send({ kind: 'sendSaveAsNote', handle: 'gone' }, sendsTab)).toEqual({
      ok: false,
      error: 'notFound',
    })
    expect(await notes()).toEqual([])
  })
})
