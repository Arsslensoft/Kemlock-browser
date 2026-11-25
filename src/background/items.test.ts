import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CardFull,
  CardView,
  IdentityFull,
  IdentityView,
  NoteFull,
  NoteView,
} from '../shared/api'
import { content, harness, menuFrame, setup, useClock, type Harness } from './test/harness'

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const visa = {
  name: 'Everyday Visa',
  cardholder: 'Sam Rivera',
  number: '4111 1111 1111 1111',
  brand: 'Visa',
  expMonth: 5,
  expYear: 2029,
  code: '123',
  pin: '9876',
}

const me = {
  name: 'Me',
  givenName: 'Sam',
  familyName: 'Rivera',
  email: 'sam@example.com',
  phone: '+33 6 12 34 56 78',
  address: { lines: ['1 Orbit Way'], city: 'Lyon', postalCode: '69001', country: 'FR' },
  documents: [{ type: 'passport', number: 'X1234567', expiresOn: '2040-01-01' }],
}

describe('notes', () => {
  it('are saved, listed by title, revealed with their text, edited and deleted', async () => {
    const saved = await h.ok<NoteView>({
      kind: 'saveNote',
      id: null,
      input: { title: 'Wi-Fi', text: 'hunter2', pinned: true },
    })
    expect(saved).toMatchObject({ title: 'Wi-Fi', pinned: true, files: 0 })
    const listed = await h.ok<NoteView[]>({ kind: 'notes' })
    expect(listed.map((note) => note.title)).toEqual(['Wi-Fi'])
    expect(JSON.stringify(listed)).not.toContain('hunter2')
    const full = await h.ok<NoteFull>({ kind: 'revealNote', id: saved.id })
    expect(full.text).toBe('hunter2')

    await h.ok({ kind: 'saveNote', id: saved.id, input: { title: 'Wi-Fi 2', text: 'new' } })
    expect((await h.ok<NoteFull>({ kind: 'revealNote', id: saved.id })).text).toBe('new')
    // A save that names no pin keeps it
    expect((await h.ok<NoteView[]>({ kind: 'notes' }))[0].pinned).toBe(true)

    await h.ok({ kind: 'deleteNote', id: saved.id })
    expect(await h.ok<NoteView[]>({ kind: 'notes' })).toEqual([])
    expect(await h.send({ kind: 'revealNote', id: saved.id })).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('copy their text through the clipboard', async () => {
    const saved = await h.ok<NoteView>({
      kind: 'saveNote',
      id: null,
      input: { title: 'Code', text: 'open sesame' },
    })
    await h.ok({ kind: 'copy', what: 'noteText', id: saved.id })
    expect(h.clipboard.text).toBe('open sesame')
  })
})

describe('cards', () => {
  it('are saved, listed with the last four digits and no secret, and revealed whole', async () => {
    const saved = await h.ok<CardView>({ kind: 'saveCard', id: null, input: visa })
    expect(saved).toMatchObject({ name: 'Everyday Visa', lastFour: '1111', hasCode: true })
    const listed = JSON.stringify(await h.ok<CardView[]>({ kind: 'cards' }))
    for (const secret of ['4111111111111111', '"123"', '9876']) expect(listed).not.toContain(secret)
    const full = await h.ok<CardFull>({ kind: 'revealCard', id: saved.id })
    expect(full).toMatchObject({ number: '4111111111111111', code: '123', pin: '9876' })
  })

  it('show and copy one hidden field at a time', async () => {
    const saved = await h.ok<CardView>({ kind: 'saveCard', id: null, input: visa })
    for (const [what, value] of [
      ['cardNumber', '4111111111111111'],
      ['cardCode', '123'],
      ['cardPin', '9876'],
    ] as const) {
      expect(await h.ok({ kind: 'showSecret', what, id: saved.id })).toBe(value)
      await h.ok({ kind: 'copy', what, id: saved.id })
      expect(h.clipboard.text).toBe(value)
    }
    await h.ok({ kind: 'copy', what: 'cardholder', id: saved.id })
    expect(h.clipboard.text).toBe('Sam Rivera')
  })

  it('are refused for a number that is not one, and nothing is saved', async () => {
    expect(
      await h.send({ kind: 'saveCard', id: null, input: { ...visa, number: '41x1' } }),
    ).toMatchObject({ ok: false })
    // The parser holds a month to 1 to 12 before the core sees it
    expect(await h.send({ kind: 'saveCard', id: null, input: { ...visa, expMonth: 13 } })).toEqual({
      ok: false,
      error: 'malformed',
    })
    expect(await h.ok<CardView[]>({ kind: 'cards' })).toEqual([])
  })

  it('are deleted', async () => {
    const saved = await h.ok<CardView>({ kind: 'saveCard', id: null, input: visa })
    await h.ok({ kind: 'deleteCard', id: saved.id })
    expect(await h.ok<CardView[]>({ kind: 'cards' })).toEqual([])
  })
})

describe('identities', () => {
  it('are saved, listed with no document number, and revealed whole', async () => {
    const saved = await h.ok<IdentityView>({ kind: 'saveIdentity', id: null, input: me })
    expect(saved).toMatchObject({ name: 'Me', fullName: 'Sam Rivera', email: 'sam@example.com' })
    expect(JSON.stringify(await h.ok<IdentityView[]>({ kind: 'identities' }))).not.toContain(
      'X1234567',
    )
    const full = await h.ok<IdentityFull>({ kind: 'revealIdentity', id: saved.id })
    expect(full.documents[0]).toMatchObject({ type: 'passport', number: 'X1234567' })
  })

  it("show and copy a document's number, and copy the email and phone", async () => {
    const saved = await h.ok<IdentityView>({ kind: 'saveIdentity', id: null, input: me })
    const documentId = saved.documents[0].id
    const args = { what: 'documentNumber', id: saved.id, documentId } as const
    expect(await h.ok({ kind: 'showSecret', ...args })).toBe('X1234567')
    await h.ok({ kind: 'copy', ...args })
    expect(h.clipboard.text).toBe('X1234567')
    await h.ok({ kind: 'copy', what: 'email', id: saved.id })
    expect(h.clipboard.text).toBe('sam@example.com')
    await h.ok({ kind: 'copy', what: 'phone', id: saved.id })
    expect(h.clipboard.text).toBe('+33 6 12 34 56 78')
    // A document the identity doesn't hold has no number to show
    expect(await h.send({ kind: 'showSecret', what: 'documentNumber', id: saved.id })).toEqual({
      ok: false,
      error: 'failed',
    })
  })

  it('are deleted', async () => {
    const saved = await h.ok<IdentityView>({ kind: 'saveIdentity', id: null, input: me })
    await h.ok({ kind: 'deleteIdentity', id: saved.id })
    expect(await h.ok<IdentityView[]>({ kind: 'identities' })).toEqual([])
  })
})

describe('who may ask', () => {
  it('the lists, the reveals and the saves answer the popup and the setup tab, never a page or the menu', async () => {
    const saved = await h.ok<CardView>({ kind: 'saveCard', id: null, input: visa })
    const asks = [
      { kind: 'notes' },
      { kind: 'cards' },
      { kind: 'identities' },
      { kind: 'revealCard', id: saved.id },
      { kind: 'showSecret', what: 'cardNumber', id: saved.id },
      { kind: 'saveNote', id: null, input: { title: 't', text: 'x' } },
      { kind: 'deleteCard', id: saved.id },
    ]
    for (const ask of asks) {
      expect(await h.send(ask, setup), JSON.stringify(ask)).not.toEqual({
        ok: false,
        error: 'refused',
      })
      expect(await h.send(ask, menuFrame), JSON.stringify(ask)).toEqual({
        ok: false,
        error: 'refused',
      })
      expect(await h.send(ask, content('https://orbit-cloud.com/')), JSON.stringify(ask)).toEqual({
        ok: false,
        error: 'refused',
      })
    }
  })

  it('answer locked while the vault is shut', async () => {
    await h.ok({ kind: 'lock' })
    for (const kind of ['notes', 'cards', 'identities'])
      expect(await h.send({ kind })).toEqual({ ok: false, error: 'locked' })
    expect(await h.send({ kind: 'revealCard', id: 'x' })).toEqual({ ok: false, error: 'locked' })
  })
})

describe('what a change does', () => {
  it('tells sync, as a login does', async () => {
    const calls = h.core.calls.length
    await h.ok({ kind: 'saveNote', id: null, input: { title: 'a', text: 'b' } })
    expect(h.core.calls.slice(calls)).toContain('saveNote')
    // Sync follows a change shortly
    expect(h.mock.alarms.has('kemlock-sync-soon')).toBe(true)
  })
})
