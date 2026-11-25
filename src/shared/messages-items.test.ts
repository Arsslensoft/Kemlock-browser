import { describe, expect, it } from 'vitest'
import { parseContentMessage, parseContextTarget, parsePageMessage } from './messages'

describe('the field reports of cards and identities', () => {
  it('keep what a field asks for, its block and the format it shows', () => {
    expect(
      parseContentMessage({
        kind: 'fields',
        fields: [
          { id: 'n', kind: 'card', part: 'cardNumber', group: '1', rules: 'len:19', label: 'x' },
          { id: 'g', kind: 'identity', part: 'givenName', group: '2:shipping' },
        ],
      }),
    ).toEqual({
      kind: 'fields',
      fields: [
        { id: 'n', kind: 'card', part: 'cardNumber', group: '1', rules: 'len:19' },
        { id: 'g', kind: 'identity', part: 'givenName', group: '2:shipping' },
      ],
    })
  })

  it('refuse a card field with no part, with another kind’s part, or with one that is not a part', () => {
    const field = { id: 'n', kind: 'card', part: 'cardNumber' }
    for (const bad of [
      { ...field, part: undefined },
      { ...field, part: 'givenName' },
      { ...field, part: 'cvv' },
      { ...field, kind: 'identity' },
      { id: 'g', kind: 'identity', part: 'cardNumber' },
      { id: 'g', kind: 'identity' },
      // A sign-in or code field has no part or block
      { id: 'u', kind: 'username', part: 'email' },
      { id: 'u', kind: 'username', group: '1' },
      { ...field, group: '' },
      { ...field, group: 'x'.repeat(33) },
      { ...field, boxes: 6 },
    ])
      expect(parseContentMessage({ kind: 'fields', fields: [bad] }), JSON.stringify(bad)).toBeNull()
  })

  it('are read back in a right-click target, under the same rules', () => {
    expect(
      parseContextTarget({
        fieldId: 'n',
        kind: 'card',
        part: 'cardNumber',
        group: '1',
        rules: 'len:5',
      }),
    ).toEqual({ fieldId: 'n', kind: 'card', part: 'cardNumber', group: '1', rules: 'len:5' })
    expect(parseContextTarget({ fieldId: 'n', kind: 'card' })).toBeNull()
    expect(parseContextTarget({ fieldId: 'n', kind: 'card', part: 'email' })).toBeNull()
    expect(parseContextTarget({ fieldId: 'u', kind: 'username', part: 'cardNumber' })).toBeNull()
  })
})

describe('an identity sent', () => {
  const sent = {
    kind: 'identitySent',
    given: 'Sam',
    family: 'Rivera',
    full: '',
    email: 'sam@example.com',
    phone: '',
    company: '',
    line1: '1 Orbit Way',
    city: 'Lyon',
    postalCode: '69001',
    country: 'France',
  }

  it('is a content script’s, as text of bounded size', () => {
    expect(parseContentMessage({ ...sent, url: 'https://evil.example' })).toEqual(sent)
    expect(parsePageMessage(sent)).toBeNull()
    for (const bad of [
      { ...sent, email: undefined },
      { ...sent, given: 7 },
      { ...sent, email: 'x'.repeat(321) },
      { ...sent, postalCode: 'x'.repeat(65) },
    ])
      expect(parseContentMessage(bad)).toBeNull()
  })
})

describe('the answer to a save prompt', () => {
  it('may say which offer it answers, as a flag and nothing else', () => {
    expect(
      parsePageMessage({ kind: 'answerSave', tabId: 7, save: true, card: true, extra: 1 }),
    ).toEqual({ kind: 'answerSave', tabId: 7, save: true, card: true })
    expect(
      parsePageMessage({ kind: 'answerSave', tabId: 7, save: false, identity: true, never: true }),
    ).toEqual({ kind: 'answerSave', tabId: 7, save: false, identity: true, never: true })
    expect(parsePageMessage({ kind: 'answerSave', tabId: 7, save: true, card: 'yes' })).toBeNull()
  })
})

describe('a field the person is in', () => {
  it('is said only of a card or identity field', () => {
    expect(
      parseContentMessage({
        kind: 'fields',
        fields: [{ id: 'n', kind: 'card', part: 'cardNumber', group: '1', focus: true }],
      }),
    ).toEqual({
      kind: 'fields',
      fields: [{ id: 'n', kind: 'card', part: 'cardNumber', group: '1', focus: true }],
    })
    expect(
      parseContentMessage({ kind: 'fields', fields: [{ id: 'u', kind: 'username', focus: true }] }),
    ).toBeNull()
  })
})

describe('a card sent', () => {
  const sent = {
    kind: 'cardSent',
    number: '4111111111111111',
    holder: 'Sam',
    expiry: '05/29',
    month: '',
    year: '',
    code: '123',
  }

  it('is a content script’s, with the values as text and no more', () => {
    expect(parseContentMessage({ ...sent, url: 'https://evil.example' })).toEqual(sent)
    expect(parsePageMessage(sent)).toBeNull()
  })

  it('is refused when a value is missing, is not text or is too long', () => {
    for (const bad of [
      { ...sent, number: undefined },
      { ...sent, number: 4111111111111111 },
      { ...sent, number: 'x'.repeat(65) },
      { ...sent, code: '1'.repeat(17) },
      { ...sent, holder: 'x'.repeat(257) },
    ])
      expect(parseContentMessage(bad)).toBeNull()
  })
})

describe('the requests for notes, cards and identities', () => {
  it('read a note, a card and an identity as the pages send them, and drop what they add', () => {
    expect(
      parsePageMessage({
        kind: 'saveNote',
        id: null,
        input: { title: 'Wi-Fi', text: 'hunter2', pinned: true, extra: 1 },
        host: 'evil',
      }),
    ).toEqual({
      kind: 'saveNote',
      id: null,
      input: { title: 'Wi-Fi', text: 'hunter2', pinned: true },
    })
    expect(
      parsePageMessage({
        kind: 'saveCard',
        id: 'k1',
        input: {
          name: 'Visa',
          number: '4111 1111 1111 1111',
          expMonth: 5,
          expYear: 29,
          code: '123',
        },
      }),
    ).toEqual({
      kind: 'saveCard',
      id: 'k1',
      input: { name: 'Visa', number: '4111 1111 1111 1111', expMonth: 5, expYear: 29, code: '123' },
    })
    const identity = {
      name: 'Me',
      email: 'sam@example.com',
      address: { lines: ['1 Orbit Way'], city: 'Lyon' },
      documents: [{ id: 'd1', type: 'passport', number: 'X1' }],
    }
    expect(parsePageMessage({ kind: 'saveIdentity', id: null, input: identity })).toEqual({
      kind: 'saveIdentity',
      id: null,
      input: identity,
    })
  })

  it('refuse a month that is not one, a long address, a document with no number, and a too long note', () => {
    const card = { kind: 'saveCard', id: null, input: { name: 'Visa', expMonth: 13 } }
    expect(parsePageMessage(card)).toBeNull()
    expect(parsePageMessage({ ...card, input: { name: 'Visa', expMonth: 5.5 } })).toBeNull()
    expect(parsePageMessage({ ...card, input: { name: 'Visa', code: '1'.repeat(17) } })).toBeNull()
    const identity = { kind: 'saveIdentity', id: null, input: { name: 'Me' } }
    expect(
      parsePageMessage({
        ...identity,
        input: { name: 'Me', address: { lines: ['1', '2', '3', '4'] } },
      }),
    ).toBeNull()
    expect(
      parsePageMessage({
        ...identity,
        input: { name: 'Me', documents: [{ type: 'passport', number: '' }] },
      }),
    ).toBeNull()
    expect(
      parsePageMessage({
        kind: 'saveNote',
        id: null,
        input: { title: 't', text: 'x'.repeat(10_001) },
      }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'saveNote', id: null, input: { title: 't' } })).toBeNull()
  })

  it('name the hidden field to show or copy, from a short list', () => {
    expect(parsePageMessage({ kind: 'showSecret', what: 'cardCode', id: 'k1' })).toEqual({
      kind: 'showSecret',
      what: 'cardCode',
      id: 'k1',
    })
    expect(parsePageMessage({ kind: 'showSecret', what: 'password', id: 'k1' })).toBeNull()
    expect(
      parsePageMessage({ kind: 'copy', what: 'documentNumber', id: 'i1', documentId: 'd1' }),
    ).toEqual({ kind: 'copy', what: 'documentNumber', id: 'i1', documentId: 'd1' })
    expect(parsePageMessage({ kind: 'copy', what: 'noteText', id: 'n1' })).toMatchObject({
      what: 'noteText',
    })
    expect(parsePageMessage({ kind: 'fill', tabId: 7, cardId: 'k1', picked: true })).toEqual({
      kind: 'fill',
      tabId: 7,
      cardId: 'k1',
      picked: true,
    })
  })

  it('are not a content script’s to make', () => {
    for (const raw of [
      { kind: 'cards' },
      { kind: 'revealCard', id: 'k' },
      { kind: 'showSecret', what: 'cardPin', id: 'k' },
    ])
      expect(parseContentMessage(raw)).toBeNull()
  })
})
