// The item format's fields, links, website rules and a code's or backup codes' own details, through the real router over the fake core
// (docs/plans/add-item-format.md).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BackupCodeView,
  CodeView,
  CustomFieldDefs,
  FieldView,
  ItemRef,
  LinkedItemView,
  LoginView,
  NoteView,
} from '../shared/api'
import type { ContactView } from '../shared/keys-api'
import { content, harness, menuFrame, popup, setup, useClock, type Harness } from './test/harness'

const filesTab = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/files/index.html',
  origin: 'chrome-extension://kemlockid',
}
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

const login = async (): Promise<LoginView> => (await h.ok<LoginView[]>({ kind: 'logins' }))[0]
const code = async (): Promise<CodeView> => (await h.ok<CodeView[]>({ kind: 'codes' }))[0]
const loginRef = async (): Promise<ItemRef> => ({ kind: 'login', id: (await login()).id })
const saveNote = (input: object = {}) =>
  h.ok<NoteView>({
    kind: 'saveNote',
    id: null,
    input: { title: 'Wi-Fi', text: 'hunter2', ...input },
  })
const noteRef = (note: NoteView): ItemRef => ({ kind: 'note', id: note.id })
const linked = (ref: ItemRef) => h.ok<LinkedItemView[]>({ kind: 'linkedItems', ref })

describe('custom fields', () => {
  it('are saved with an item, shown with no hidden value, and revealed one at a time', async () => {
    const note = await saveNote({
      fields: [
        { name: 'Router', kind: 'text', value: 'Orbit-5G' },
        { name: 'PIN', kind: 'hidden', value: '4321' },
        { name: 'Guest network', kind: 'boolean', value: 'true' },
      ],
    })
    expect(note.fields).toEqual([
      { index: 0, name: 'Router', kind: 'text', value: 'Orbit-5G', hasValue: true, editable: true },
      { index: 1, name: 'PIN', kind: 'hidden', hasValue: true, editable: true },
      {
        index: 2,
        name: 'Guest network',
        kind: 'boolean',
        value: 'true',
        hasValue: true,
        editable: true,
      },
    ])
    const listed = await h.ok<NoteView[]>({ kind: 'notes' })
    expect(JSON.stringify(listed)).not.toContain('4321')
    const ref = noteRef(note)
    expect(await h.ok({ kind: 'revealField', ref, index: 1 })).toBe('4321')
    expect(await h.ok({ kind: 'revealFields', ref })).toEqual([
      { index: 0, value: 'Orbit-5G' },
      { index: 1, value: '4321' },
      { index: 2, value: 'true' },
    ])
    expect(await h.send({ kind: 'revealField', ref, index: 9 })).toEqual({
      ok: false,
      error: 'notFound',
    })
    expect(
      await h.send({ kind: 'revealField', ref: { kind: 'note', id: 'nope' }, index: 0 }),
    ).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('are copied through the clipboard, hidden ones too, and only when the field is named', async () => {
    const note = await saveNote({ fields: [{ name: 'PIN', kind: 'hidden', value: '4321' }] })
    const ref = noteRef(note)
    await h.ok({ kind: 'copy', what: 'field', id: note.id, ref, index: 0 })
    expect(h.clipboard.text).toBe('4321')
    expect(await h.send({ kind: 'copy', what: 'field', id: note.id })).toEqual({
      ok: false,
      error: 'badRequest',
    })
    expect(await h.send({ kind: 'copy', what: 'field', id: note.id, ref })).toEqual({
      ok: false,
      error: 'badRequest',
    })
  })

  it('are kept when a save names none, kept in place when a row is edited, and removed when it is left out', async () => {
    const note = await saveNote({
      fields: [
        { name: 'A', kind: 'text', value: '1' },
        { name: 'PIN', kind: 'hidden', value: '4321' },
        { name: 'B', kind: 'text', value: '2' },
      ],
    })
    const ref = noteRef(note)
    const input = { title: 'Wi-Fi', text: 'hunter2' }
    // No `fields`: nothing changes
    expect((await h.ok<NoteView>({ kind: 'saveNote', id: note.id, input })).fields).toHaveLength(3)
    // The hidden field was not revealed: it keeps its value; A is renamed; B is left out; C is new
    const saved = await h.ok<NoteView>({
      kind: 'saveNote',
      id: note.id,
      input: {
        ...input,
        fields: [
          { origin: 0, name: 'A2', kind: 'text', value: '1' },
          { origin: 1, name: 'PIN', kind: 'hidden', keepValue: true },
          { name: 'C', kind: 'text', value: '3' },
        ],
      },
    })
    expect(saved.fields.map((f: FieldView) => f.name)).toEqual(['A2', 'PIN', 'C'])
    expect(await h.ok({ kind: 'revealField', ref, index: 1 })).toBe('4321')
    // An empty list removes the rows the browser can edit
    expect(
      (await h.ok<NoteView>({ kind: 'saveNote', id: note.id, input: { ...input, fields: [] } }))
        .fields,
    ).toEqual([])
  })

  it('drop a nameless row, and refuse a checkbox that is neither true nor false', async () => {
    const note = await saveNote({
      fields: [
        { name: '  ', kind: 'text', value: 'lost' },
        { name: 'Kept', kind: 'text', value: 'x' },
      ],
    })
    expect(note.fields.map((f: FieldView) => f.name)).toEqual(['Kept'])
    expect(
      await h.send({
        kind: 'saveNote',
        id: note.id,
        input: { title: 't', text: '', fields: [{ name: 'Box', kind: 'boolean', value: 'maybe' }] },
      }),
    ).toEqual({ ok: false, error: 'invalid' })
  })

  it('go with a login and a card', async () => {
    const l = await login()
    const saved = await h.ok<LoginView>({
      kind: 'saveLogin',
      id: l.id,
      input: {
        name: l.name,
        username: l.username,
        password: 'Orbit-Cloud-7731!',
        websites: l.websites,
        fields: [{ name: 'Security question', kind: 'text', value: 'Pet' }],
      },
    })
    expect(saved.fields).toHaveLength(1)
    const card = await h.ok<{ fields: FieldView[] }>({
      kind: 'saveCard',
      id: null,
      input: {
        name: 'Visa',
        cardholder: 'Sam',
        fields: [{ name: 'Bank', kind: 'text', value: 'Orbit Bank' }],
      },
    })
    expect(card.fields).toHaveLength(1)
  })

  it('tell sync when a save changes them', async () => {
    const spy = vi.spyOn(h.bg['d'].sync, 'changed')
    await saveNote({ fields: [{ name: 'A', kind: 'text', value: '1' }] })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('the administrator’s fields', () => {
  it('are none, with a person’s own allowed, off Kemlock Server', async () => {
    expect(await h.ok<CustomFieldDefs>({ kind: 'customFieldDefs' })).toEqual({
      fields: [],
      allowOwn: true,
    })
  })

  it('are the server’s, and whether people may add their own, with Kemlock Server', async () => {
    h.core.disk.sync = { place: 'kemlock', server: 'https://kem.example', running: false }
    h.core.adminFields = [{ id: 'f1', name: 'Customer id', type: 'text', kinds: ['login'] }]
    h.core.allowOwn = false
    expect(await h.ok<CustomFieldDefs>({ kind: 'customFieldDefs', refresh: true })).toEqual({
      fields: [{ id: 'f1', name: 'Customer id', type: 'text', kinds: ['login'] }],
      allowOwn: false,
    })
  })

  it('are asked for by the popup, the setup tab and the files tab only', async () => {
    for (const sender of [popup, setup, filesTab])
      expect(await h.send({ kind: 'customFieldDefs' }, sender)).toMatchObject({ ok: true })
    for (const sender of [menuFrame, sendsTab, content('https://evil.example/')])
      expect(await h.send({ kind: 'customFieldDefs' }, sender)).toEqual({
        ok: false,
        error: 'refused',
      })
    await h.ok({ kind: 'lock' })
    expect(await h.send({ kind: 'customFieldDefs' })).toEqual({ ok: false, error: 'locked' })
  })
})

describe('links', () => {
  it('are written on both ends, counted on both, and removed from both', async () => {
    const ref = await loginRef()
    const note = await saveNote()
    // The login's code is linked already: the links are the whole set, so it is named to stay
    const codeRef: ItemRef = { kind: 'otp', id: (await code()).id }
    expect(await h.ok({ kind: 'setLinks', ref, refs: [noteRef(note), codeRef] })).toEqual({
      linkFailures: [],
    })
    expect((await linked(ref)).map((item) => item.ref)).toContainEqual(noteRef(note))
    expect(await linked(noteRef(note))).toEqual([
      { ref, name: 'Orbit Cloud', detail: 'sam@example.com' },
    ])
    expect((await h.ok<NoteView[]>({ kind: 'notes' }))[0].links).toBe(1)
    // The login counts its linked code too
    expect((await login()).links).toBe(2)

    await h.ok({ kind: 'setLinks', ref, refs: [] })
    expect(await linked(noteRef(note))).toEqual([])
    expect((await login()).links).toBe(0)
  })

  it('are saved with an item, both ends of them', async () => {
    const note = await saveNote()
    const ref = await loginRef()
    const l = await login()
    const saved = await h.ok<LoginView>({
      kind: 'saveLogin',
      id: l.id,
      input: {
        name: l.name,
        username: l.username,
        password: 'Orbit-Cloud-7731!',
        websites: l.websites,
        links: [noteRef(note)],
      },
    })
    // The links are the whole set: the code the login had is not in it
    expect(saved.links).toBe(1)
    expect((await linked(noteRef(note))).map((item) => item.ref)).toEqual([ref])
    // No `links`: they stay
    await h.ok({
      kind: 'saveLogin',
      id: l.id,
      input: {
        name: l.name,
        username: l.username,
        password: 'Orbit-Cloud-7731!',
        websites: l.websites,
      },
    })
    expect((await login()).links).toBe(1)
  })

  it('count the link of a code and its login, which both items show', async () => {
    const ref = await loginRef()
    const codeRef: ItemRef = { kind: 'otp', id: (await code()).id }
    expect(await linked(ref)).toMatchObject([{ ref: codeRef, name: 'Orbit Cloud' }])
    expect(await linked(codeRef)).toMatchObject([{ ref, name: 'Orbit Cloud' }])
    expect((await code()).links).toBe(1)
    // Unlinking from the login clears the code's side too
    await h.ok({ kind: 'setLinks', ref, refs: [] })
    expect(await linked(codeRef)).toEqual([])
    expect((await code()).loginId).toBeUndefined()
  })

  it('name the item whose end could not be written, and show the link half made', async () => {
    const ref = await loginRef()
    const note = await saveNote()
    h.core.unwritable.add(`note:${note.id}`)
    expect(await h.ok({ kind: 'setLinks', ref, refs: [noteRef(note)] })).toEqual({
      linkFailures: ['Wi-Fi'],
    })
    expect(await linked(ref)).toContainEqual({
      ref: noteRef(note),
      name: 'Wi-Fi',
      halfMade: true,
    })
  })

  it('answer the candidates: not the item itself, matching the query, and 50 at most', async () => {
    const ref = await loginRef()
    for (let i = 0; i < 55; i += 1) await saveNote({ title: `Note ${i}` })
    const all = await h.ok<LinkedItemView[]>({ kind: 'linkCandidates', ref, query: '' })
    expect(all).toHaveLength(50)
    expect(all.map((item) => item.ref)).not.toContainEqual(ref)
    expect(
      await h.ok<LinkedItemView[]>({ kind: 'linkCandidates', ref: null, query: 'note 7' }),
    ).toMatchObject([{ name: 'Note 7' }])
    expect(
      await h.ok<LinkedItemView[]>({ kind: 'linkCandidates', ref: null, query: 'zzz' }),
    ).toEqual([])
  })

  it('leave nothing behind when an item is deleted', async () => {
    const ref = await loginRef()
    const note = await saveNote()
    await h.ok({ kind: 'setLinks', ref, refs: [noteRef(note)] })
    await h.ok({ kind: 'deleteNote', id: note.id })
    // The login's links were set to the note alone, which also let go of its code
    expect(await linked(ref)).toEqual([])
    expect(h.core.disk.items.extras).toEqual({})
  })

  it('refuse a link to an item that is not there, and tell sync of the write', async () => {
    const ref = await loginRef()
    expect(await h.send({ kind: 'setLinks', ref, refs: [{ kind: 'note', id: 'nope' }] })).toEqual({
      ok: false,
      error: 'notFound',
    })
    const note = await saveNote()
    const spy = vi.spyOn(h.bg['d'].sync, 'changed')
    await h.ok({ kind: 'setLinks', ref, refs: [noteRef(note)] })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('a login’s website rules', () => {
  const save = (id: string | null, input: object) =>
    h.send<LoginView>({
      kind: 'saveLogin',
      id,
      input: { name: 'Shop', username: 'sam', password: 'pw-1', websites: [], ...input },
    })

  it('are saved with each website and win over the plain list', async () => {
    const saved = await save(null, {
      websites: ['ignored.example'],
      websiteRules: [
        { uri: 'shop.example', match: 'host' },
        { uri: 'https://pay.example/', match: 'startsWith' },
        { uri: 'plain.example', match: 'default' },
        { uri: '^https://.*\\.shop\\.example', match: 'regex' },
      ],
    })
    if (!saved.ok) throw new Error('not saved')
    expect(saved.value.websites).toEqual([
      'shop.example',
      'https://pay.example/',
      'plain.example',
      '^https://.*\\.shop\\.example',
    ])
    expect(saved.value.websiteRules).toEqual([
      { uri: 'shop.example', match: 'host' },
      { uri: 'https://pay.example/', match: 'startsWith' },
      { uri: 'plain.example', match: 'default' },
      { uri: '^https://.*\\.shop\\.example', match: 'regex' },
    ])
  })

  it('stay with their website when a save names the websites only', async () => {
    const saved = await save(null, { websiteRules: [{ uri: 'shop.example', match: 'exact' }] })
    if (!saved.ok) throw new Error('not saved')
    const again = await save(saved.value.id, { websites: ['shop.example', 'new.example'] })
    if (!again.ok) throw new Error('not saved')
    expect(again.value.websiteRules).toEqual([
      { uri: 'shop.example', match: 'exact' },
      { uri: 'new.example', match: 'default' },
    ])
  })

  it('refuse a script address, any scheme but the web’s and an app’s, and a regex that does not compile', async () => {
    for (const rule of [
      { uri: 'javascript:alert(1)', match: 'default' },
      { uri: 'data:text/html,x', match: 'default' },
      { uri: 'ftp://files.example', match: 'domain' },
      { uri: 'https://', match: 'host' },
      { uri: 'two words', match: 'exact' },
      { uri: '(unclosed', match: 'regex' },
    ])
      expect(await save(null, { websiteRules: [rule] }), rule.uri).toEqual({
        ok: false,
        error: 'invalid',
      })
    expect(
      await save(null, {
        websiteRules: [
          { uri: 'localhost:8080', match: 'host' },
          { uri: 'androidapp://com.orbit.app', match: 'exact' },
        ],
      }),
    ).toMatchObject({ ok: true })
  })
})

describe('a code’s own details', () => {
  it('are a name, websites, a note, fields and links, and never the secret', async () => {
    const before = await code()
    const note = await saveNote()
    const saved = await h.ok<CodeView>({
      kind: 'saveCode',
      id: before.id,
      input: {
        name: 'Orbit sign-in',
        websites: ['orbit.example', 'orbit.example.org'],
        note: 'Use the phone',
        pinned: true,
        fields: [{ name: 'Recovery email', kind: 'text', value: 'sam@example.org' }],
        links: [noteRef(note), await loginRef()],
      },
    })
    expect(saved).toMatchObject({
      id: before.id,
      name: 'Orbit sign-in',
      issuer: before.issuer,
      account: before.account,
      note: 'Use the phone',
      pinned: true,
      ownWebsites: ['orbit.example', 'orbit.example.org'],
      links: 2,
    })
    expect(saved.fields).toHaveLength(1)
    expect(JSON.stringify(saved)).not.toContain('JBSWY3DPEHPK3PXP')
    // A save that names nothing changes nothing
    expect(await h.ok<CodeView>({ kind: 'saveCode', id: before.id, input: {} })).toMatchObject({
      name: 'Orbit sign-in',
      links: 2,
    })
  })

  it('show the websites of the login they are linked to, and say whose they are', async () => {
    const before = await code()
    const l = await login()
    const saved = await h.ok<CodeView>({
      kind: 'saveCode',
      id: before.id,
      input: { websites: ['own.example'] },
    })
    // The sample code is linked to its login (a link both items show)
    expect(saved.websites).toEqual(l.websites)
    expect(saved.ownWebsites).toEqual(['own.example'])
    expect(saved.websitesFrom).toEqual([{ kind: 'login', id: l.id }])
    await h.ok({ kind: 'setLinks', ref: { kind: 'otp', id: before.id }, refs: [] })
    const alone = await code()
    expect(alone.websites).toEqual(['own.example'])
    expect(alone.websitesFrom).toBeUndefined()
  })

  it('refuse a code that is not there, and tell sync', async () => {
    expect(await h.send({ kind: 'saveCode', id: 'nope', input: {} })).toEqual({
      ok: false,
      error: 'notFound',
    })
    const spy = vi.spyOn(h.bg['d'].sync, 'changed')
    await h.ok({ kind: 'saveCode', id: (await code()).id, input: { name: 'x' } })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('backup codes’ own details', () => {
  it('are a name, websites, fields and links', async () => {
    const note = await saveNote()
    const saved = await h.ok<BackupCodeView>({
      kind: 'saveBackupCodes',
      serviceId: 'orbit',
      input: {
        name: 'Orbit spares',
        websites: ['orbit.example'],
        fields: [{ name: 'Printed', kind: 'boolean', value: 'true' }],
        links: [noteRef(note)],
      },
    })
    expect(saved).toMatchObject({
      serviceId: 'orbit',
      name: 'Orbit spares',
      issuer: 'Orbit Cloud',
      websites: ['orbit.example'],
      total: 3,
      links: 1,
    })
    expect(saved.fields).toHaveLength(1)
    const listed = await h.ok<BackupCodeView[]>({ kind: 'backupCodes' })
    expect(listed[0]).toMatchObject({ name: 'Orbit spares', links: 1, websites: ['orbit.example'] })
    expect(await h.send({ kind: 'saveBackupCodes', serviceId: 'nope', input: {} })).toEqual({
      ok: false,
      error: 'notFound',
    })
  })
})

describe('a contact with no key', () => {
  it('is made with its details, links and fields, and holds nothing to encrypt to', async () => {
    const note = await saveNote()
    const made = await h.ok<ContactView>({
      kind: 'saveContact',
      id: null,
      name: 'Ada Lovelace',
      company: 'Analytical Engines',
      email: 'ada@example.org',
      phone: '+44 20 7946 0000',
      address: '12 St James Square',
      fields: [{ name: 'Birthday', kind: 'text', value: '10 December' }],
      links: [noteRef(note)],
    })
    expect(made).toMatchObject({
      name: 'Ada Lovelace',
      company: 'Analytical Engines',
      email: 'ada@example.org',
      phone: '+44 20 7946 0000',
      address: '12 St James Square',
      hasKey: false,
      source: 'manual',
      canEncrypt: false,
      links: 1,
    })
    expect(made.fields).toHaveLength(1)
    const edited = await h.ok<ContactView>({
      kind: 'saveContact',
      id: made.id,
      phone: '',
      company: 'Engines Ltd',
    })
    expect(edited.phone).toBeUndefined()
    expect(edited).toMatchObject({
      company: 'Engines Ltd',
      email: 'ada@example.org',
      hasKey: false,
    })
    expect(
      await h.send({ kind: 'pgpEncrypt', data: { text: 'hi' }, contactIds: [made.id], keyIds: [] }),
    ).toEqual({ ok: false, error: 'noKey' })
    expect(await h.send({ kind: 'contactPublic', id: made.id })).toEqual({
      ok: false,
      error: 'noKey',
    })
    expect(await h.send({ kind: 'saveContact', id: null, name: ' ' })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })
})
