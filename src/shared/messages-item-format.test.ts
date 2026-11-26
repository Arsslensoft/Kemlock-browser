// The item format's requests as the parser takes them (docs/plans/add-item-format.md): custom fields, links, a login's website rules,
// the code and backup codes' own details, File items, and the pieces of a file, with every size bounded.
import { describe, expect, it } from 'vitest'
import { parsePageMessage } from './messages'

const ref = { kind: 'login', id: 'b3a1c4de-0000-4000-8000-000000000001' }

describe('the fields and links of an input', () => {
  const login = { name: 'Orbit', username: 'sam', password: 'p', websites: ['orbit.example'] }

  it('are kept as the known members only, on every kind of input', () => {
    const fields = [
      { origin: 0, name: 'Pin', kind: 'hidden', keepValue: true, adminField: 'f1', extra: 1 },
      { name: 'Done', kind: 'boolean', value: 'true' },
    ]
    const links = [{ kind: 'note', id: 'note-1', extra: 1 }]
    const wanted = {
      fields: [
        { origin: 0, name: 'Pin', kind: 'hidden', keepValue: true, adminField: 'f1' },
        { name: 'Done', kind: 'boolean', value: 'true' },
      ],
      links: [{ kind: 'note', id: 'note-1' }],
    }
    expect(
      parsePageMessage({ kind: 'saveLogin', id: null, input: { ...login, fields, links } }),
    ).toEqual({ kind: 'saveLogin', id: null, input: { ...login, ...wanted } })
    expect(
      parsePageMessage({
        kind: 'saveNote',
        id: 'n',
        input: { title: 't', text: '', fields, links },
      }),
    ).toEqual({ kind: 'saveNote', id: 'n', input: { title: 't', text: '', ...wanted } })
    expect(
      parsePageMessage({ kind: 'saveCard', id: null, input: { name: 'c', fields, links } }),
    ).toEqual({ kind: 'saveCard', id: null, input: { name: 'c', ...wanted } })
    expect(
      parsePageMessage({ kind: 'saveIdentity', id: null, input: { name: 'i', fields, links } }),
    ).toEqual({ kind: 'saveIdentity', id: null, input: { name: 'i', ...wanted } })
    expect(
      parsePageMessage({
        kind: 'saveContact',
        id: null,
        name: 'Ada',
        company: 'Lovelace Ltd',
        ...wanted,
      }),
    ).toEqual({ kind: 'saveContact', id: null, name: 'Ada', company: 'Lovelace Ltd', ...wanted })
  })

  it('leave a missing fields or links missing, and an empty one empty', () => {
    expect(parsePageMessage({ kind: 'saveLogin', id: null, input: login })).toEqual({
      kind: 'saveLogin',
      id: null,
      input: login,
    })
    expect(
      parsePageMessage({ kind: 'saveLogin', id: null, input: { ...login, fields: [], links: [] } }),
    ).toEqual({ kind: 'saveLogin', id: null, input: { ...login, fields: [], links: [] } })
  })

  it('refuse more than 100 rows, a name over 200 characters and a value over 10,000', () => {
    const row = { name: 'a', kind: 'text', value: '' }
    const save = (fields: unknown) =>
      parsePageMessage({ kind: 'saveLogin', id: null, input: { ...login, fields } })
    expect(save(Array.from({ length: 100 }, () => row))).not.toBeNull()
    expect(save(Array.from({ length: 101 }, () => row))).toBeNull()
    expect(save([{ ...row, name: 'n'.repeat(200) }])).not.toBeNull()
    expect(save([{ ...row, name: 'n'.repeat(201) }])).toBeNull()
    expect(save([{ ...row, value: 'v'.repeat(10_000) }])).not.toBeNull()
    expect(save([{ ...row, value: 'v'.repeat(10_001) }])).toBeNull()
  })

  it('refuse a field of another kind, a keepValue that is not true and an origin that is no index', () => {
    const save = (field: unknown) =>
      parsePageMessage({ kind: 'saveLogin', id: null, input: { ...login, fields: [field] } })
    expect(save({ name: 'a', kind: 'linked' })).toBeNull()
    expect(save({ name: 'a', kind: 'checkbox' })).toBeNull()
    expect(save({ name: 'a', kind: 'hidden', keepValue: false })).toBeNull()
    expect(save({ name: 'a', kind: 'text', origin: -1 })).toBeNull()
    expect(save({ name: 'a', kind: 'text', origin: 1.5 })).toBeNull()
    expect(save({ kind: 'text' })).toBeNull()
  })

  it('refuse more than 100 links, a kind that is not an item’s and an id that is empty or long', () => {
    const save = (links: unknown) =>
      parsePageMessage({ kind: 'saveNote', id: null, input: { title: 't', text: '', links } })
    expect(
      save(Array.from({ length: 100 }, (_, i) => ({ kind: 'note', id: `n${i}` }))),
    ).not.toBeNull()
    expect(save(Array.from({ length: 101 }, (_, i) => ({ kind: 'note', id: `n${i}` })))).toBeNull()
    expect(save([{ kind: 'secret', id: 'x' }])).toBeNull()
    expect(save([{ kind: 'note', id: '' }])).toBeNull()
    expect(save([{ kind: 'note', id: 'x'.repeat(101) }])).toBeNull()
    expect(save([{ kind: 'note', id: 'x'.repeat(100) }])).not.toBeNull()
  })
})

describe('a login’s website rules', () => {
  const login = { name: 'Orbit', username: 'sam', password: 'p', websites: [] }
  const save = (websiteRules: unknown) =>
    parsePageMessage({ kind: 'saveLogin', id: null, input: { ...login, websiteRules } })

  it('take each rule of the app and keep the known members', () => {
    for (const match of ['default', 'domain', 'host', 'startsWith', 'exact', 'regex', 'never'])
      expect(save([{ uri: 'orbit.example', match, x: 1 }])).toEqual({
        kind: 'saveLogin',
        id: null,
        input: { ...login, websiteRules: [{ uri: 'orbit.example', match }] },
      })
  })

  it('refuse more than 50 rules, an address over 2,000 characters, an empty one and a rule that is not one', () => {
    const rule = { uri: 'a.example', match: 'host' }
    expect(save(Array.from({ length: 50 }, () => rule))).not.toBeNull()
    expect(save(Array.from({ length: 51 }, () => rule))).toBeNull()
    expect(save([{ ...rule, uri: 'u'.repeat(2000) }])).not.toBeNull()
    expect(save([{ ...rule, uri: 'u'.repeat(2001) }])).toBeNull()
    // A blank row, which an editor shows until it is typed in, passes: the core drops it
    expect(save([{ ...rule, uri: '' }])).not.toBeNull()
    expect(save([{ ...rule, match: 'prefix' }])).toBeNull()
    expect(save([{ uri: 'a.example' }])).toBeNull()
  })
})

describe('the field and link requests', () => {
  it('keep the known fields only', () => {
    expect(parsePageMessage({ kind: 'customFieldDefs' })).toEqual({ kind: 'customFieldDefs' })
    expect(parsePageMessage({ kind: 'customFieldDefs', refresh: true, x: 1 })).toEqual({
      kind: 'customFieldDefs',
      refresh: true,
    })
    expect(
      parsePageMessage({ kind: 'revealField', ref: { ...ref, x: 1 }, index: 3, y: 1 }),
    ).toEqual({ kind: 'revealField', ref, index: 3 })
    expect(parsePageMessage({ kind: 'revealFields', ref })).toEqual({ kind: 'revealFields', ref })
    expect(parsePageMessage({ kind: 'linkedItems', ref })).toEqual({ kind: 'linkedItems', ref })
    expect(parsePageMessage({ kind: 'setLinks', ref, refs: [ref] })).toEqual({
      kind: 'setLinks',
      ref,
      refs: [ref],
    })
  })

  it('take a candidates query of 200 characters, for an item or for a new one', () => {
    expect(parsePageMessage({ kind: 'linkCandidates', ref, query: 'q'.repeat(200) })).not.toBeNull()
    expect(parsePageMessage({ kind: 'linkCandidates', ref: null, query: '' })).toEqual({
      kind: 'linkCandidates',
      ref: null,
      query: '',
    })
    expect(parsePageMessage({ kind: 'linkCandidates', ref, query: 'q'.repeat(201) })).toBeNull()
    expect(parsePageMessage({ kind: 'linkCandidates', query: '' })).toBeNull()
  })

  it('refuse a ref that is not an item, a missing index and more than 100 links to set', () => {
    expect(parsePageMessage({ kind: 'revealField', ref, index: -1 })).toBeNull()
    expect(parsePageMessage({ kind: 'revealField', ref })).toBeNull()
    expect(parsePageMessage({ kind: 'revealField', ref: { kind: 'login' }, index: 0 })).toBeNull()
    expect(parsePageMessage({ kind: 'revealField', ref: 'login', index: 0 })).toBeNull()
    expect(
      parsePageMessage({ kind: 'setLinks', ref, refs: Array.from({ length: 101 }, () => ref) }),
    ).toBeNull()
  })

  it('copy a field by its ref and index', () => {
    expect(
      parsePageMessage({ kind: 'copy', what: 'field', id: ref.id, ref, index: 2, extra: 1 }),
    ).toEqual({ kind: 'copy', what: 'field', id: ref.id, ref, index: 2 })
    expect(parsePageMessage({ kind: 'copy', what: 'fields', id: ref.id })).toBeNull()
  })
})

describe('a code’s and backup codes’ own details', () => {
  it('are saved with a name, websites, a note, fields and links', () => {
    const input = {
      name: 'Orbit',
      websites: ['orbit.example'],
      note: 'n',
      pinned: true,
      fields: [{ name: 'a', kind: 'text', value: 'b' }],
      links: [ref],
      secret: 'JBSWY3DP',
    }
    const { secret: _secret, ...kept } = input
    expect(parsePageMessage({ kind: 'saveCode', id: 'code-1', input })).toEqual({
      kind: 'saveCode',
      id: 'code-1',
      input: kept,
    })
    const { pinned: _pinned, secret: _s, ...backup } = input
    expect(parsePageMessage({ kind: 'saveBackupCodes', serviceId: 'orbit', input })).toEqual({
      kind: 'saveBackupCodes',
      serviceId: 'orbit',
      input: backup,
    })
  })

  it('refuse more than 50 websites and a name or note over their bounds', () => {
    const save = (input: unknown) => parsePageMessage({ kind: 'saveCode', id: 'c', input })
    expect(save({ websites: Array.from({ length: 50 }, () => 'a.example') })).not.toBeNull()
    expect(save({ websites: Array.from({ length: 51 }, () => 'a.example') })).toBeNull()
    expect(save({ websites: [''] })).toBeNull()
    expect(save({ name: 'n'.repeat(513) })).toBeNull()
    expect(save({ note: 'n'.repeat(20_001) })).toBeNull()
  })
})

describe('the file requests', () => {
  it('keep the known fields only', () => {
    expect(parsePageMessage({ kind: 'files' })).toEqual({ kind: 'files' })
    expect(parsePageMessage({ kind: 'revealFile', id: 'f', x: 1 })).toEqual({
      kind: 'revealFile',
      id: 'f',
    })
    expect(parsePageMessage({ kind: 'deleteFile', id: 'f' })).toEqual({
      kind: 'deleteFile',
      id: 'f',
    })
    expect(
      parsePageMessage({
        kind: 'saveFile',
        id: null,
        input: {
          name: 'Passport',
          notes: 'n',
          pinned: true,
          tags: ['id'],
          links: [ref],
          staged: { handle: 'h', name: 'passport.pdf', type: 'application/pdf', x: 1 },
          y: 1,
        },
      }),
    ).toEqual({
      kind: 'saveFile',
      id: null,
      input: {
        name: 'Passport',
        notes: 'n',
        pinned: true,
        tags: ['id'],
        links: [ref],
        staged: { handle: 'h', name: 'passport.pdf', type: 'application/pdf' },
      },
    })
    expect(parsePageMessage({ kind: 'openItemFile', ref, attachmentId: 'a' })).toEqual({
      kind: 'openItemFile',
      ref,
      attachmentId: 'a',
    })
    expect(parsePageMessage({ kind: 'closeOpened', handle: 'h' })).toEqual({
      kind: 'closeOpened',
      handle: 'h',
    })
    expect(parsePageMessage({ kind: 'releaseStaged', handle: 'h' })).toEqual({
      kind: 'releaseStaged',
      handle: 'h',
    })
  })

  it('take a piece of a file up to 1 MiB in base64, with or without a handle', () => {
    const data = 'A'.repeat(1_398_104)
    expect(parsePageMessage({ kind: 'stageItemFile', data })).toEqual({
      kind: 'stageItemFile',
      data,
    })
    expect(parsePageMessage({ kind: 'stageItemFile', data, handle: 'h' })).toEqual({
      kind: 'stageItemFile',
      data,
      handle: 'h',
    })
    expect(parsePageMessage({ kind: 'stageItemFile', data: 'A'.repeat(1_398_105) })).toBeNull()
    expect(parsePageMessage({ kind: 'stageItemFile', data: 'AAAA', handle: '' })).toBeNull()
    expect(
      parsePageMessage({ kind: 'stageItemFile', data: 'AAAA', handle: 'h'.repeat(65) }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'stageItemFile' })).toBeNull()
  })

  it('attach at most 100 staged files, each named', () => {
    const file = { handle: 'h', name: 'a.txt' }
    expect(parsePageMessage({ kind: 'addAttachments', noteId: 'n', files: [file] })).toEqual({
      kind: 'addAttachments',
      noteId: 'n',
      files: [file],
    })
    expect(
      parsePageMessage({
        kind: 'addAttachments',
        noteId: 'n',
        files: Array.from({ length: 101 }, () => file),
      }),
    ).toBeNull()
    expect(
      parsePageMessage({ kind: 'addAttachments', noteId: 'n', files: [{ handle: 'h', name: '' }] }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'removeAttachment', noteId: 'n', attachmentId: 'a' })).toEqual({
      kind: 'removeAttachment',
      noteId: 'n',
      attachmentId: 'a',
    })
  })

  it('read pieces of an opened file by a whole index, 100 at most', () => {
    expect(parsePageMessage({ kind: 'readOpened', handle: 'h', index: 0 })).not.toBeNull()
    expect(parsePageMessage({ kind: 'readOpened', handle: 'h', index: 100 })).not.toBeNull()
    expect(parsePageMessage({ kind: 'readOpened', handle: 'h', index: 101 })).toBeNull()
    expect(parsePageMessage({ kind: 'readOpened', handle: 'h', index: -1 })).toBeNull()
    expect(parsePageMessage({ kind: 'readOpened', handle: 'h', index: 0.5 })).toBeNull()
    expect(parsePageMessage({ kind: 'readOpened', index: 0 })).toBeNull()
  })

  it('refuse a File item with no name text or a staged file with no handle or name', () => {
    const save = (input: unknown) => parsePageMessage({ kind: 'saveFile', id: null, input })
    expect(save({})).toBeNull()
    expect(save({ name: 'a', staged: { name: 'f' } })).toBeNull()
    expect(save({ name: 'a', staged: { handle: 'h', name: '' } })).toBeNull()
    expect(
      save({ name: 'a', staged: { handle: 'h', name: 'f', type: 't'.repeat(256) } }),
    ).toBeNull()
    // A staged file's name is at most 255 characters
    expect(save({ name: 'a', staged: { handle: 'h', name: 'f'.repeat(255) } })).not.toBeNull()
    expect(save({ name: 'a', staged: { handle: 'h', name: 'f'.repeat(256) } })).toBeNull()
    expect(
      parsePageMessage({
        kind: 'addAttachments',
        noteId: 'n',
        files: [{ handle: 'h', name: 'f'.repeat(256) }],
      }),
    ).toBeNull()
  })

  it('name a linked item by any kind of 1 to 40 lower-case letters, digits and dashes, so one the core holds round-trips', () => {
    const save = (kind: unknown) =>
      parsePageMessage({
        kind: 'setLinks',
        ref: { kind: 'login', id: 'l' },
        refs: [{ kind, id: 'x' }],
      })
    for (const kind of ['key', 'key-otp', 'ssh-key', 'a-later-kind', 'k'.repeat(40)])
      expect(save(kind), kind).not.toBeNull()
    for (const kind of ['', 'K', 'a b', 'a_b', 'k'.repeat(41), 7, null])
      expect(save(kind), String(kind)).toBeNull()
  })
})

describe('a contact with no key', () => {
  it('is saved with a null id and its details', () => {
    expect(
      parsePageMessage({
        kind: 'saveContact',
        id: null,
        name: 'Ada',
        company: 'c',
        email: 'ada@example.org',
        phone: '+44',
        address: '1 Orbit Way',
        note: 'n',
      }),
    ).toEqual({
      kind: 'saveContact',
      id: null,
      name: 'Ada',
      company: 'c',
      email: 'ada@example.org',
      phone: '+44',
      address: '1 Orbit Way',
      note: 'n',
    })
    expect(parsePageMessage({ kind: 'saveContact', id: 'c1', checked: true })).toEqual({
      kind: 'saveContact',
      id: 'c1',
      checked: true,
    })
    expect(parsePageMessage({ kind: 'saveContact', name: 'Ada' })).toBeNull()
    expect(
      parsePageMessage({ kind: 'saveContact', id: null, address: 'a'.repeat(2049) }),
    ).toBeNull()
  })
})
