// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { CardFull, IdentityFull, NoteFull } from '../shared/api'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  card,
  change,
  click,
  identity,
  input,
  installChrome,
  message,
  mount,
  note,
  settle,
  submit,
  text,
  unlockedHandlers,
  unmountAll,
  type World,
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

const wifi = note({ id: 'n1', title: 'Wi-Fi', files: 2 })
const pinnedNote = note({ id: 'n2', title: 'Recovery', pinned: true, order: 1 })
const visa = card({ id: 'k1' })
const old = card({
  id: 'k2',
  name: 'Old Amex',
  brand: 'Amex',
  lastFour: '0005',
  expired: true,
  order: 1,
  hasCode: false,
})
const me = identity({
  id: 'i1',
  phone: '+33 6 12 34 56 78',
  address: { lines: ['1 Orbit Way'], city: 'Lyon', postalCode: '69001', country: 'FR' },
})

const world = (over: Partial<World> = {}): World => ({
  codes: [],
  logins: [],
  notes: [wifi, pinnedNote],
  cards: [visa, old],
  identities: [me],
  ...over,
})

const visaFull: CardFull = {
  ...visa,
  number: '4111111111111111',
  code: '123',
  pin: '',
}

const passport = {
  id: 'd1',
  type: 'passport',
  issuingCountry: 'FR',
  expiresOn: '2020-01-01',
  expired: true,
  hasNumber: true,
}

const meFull: IdentityFull = {
  ...me,
  documents: [{ ...passport, number: 'X1234567' }],
}

const wifiFull: NoteFull = {
  ...wifi,
  text: 'the password is hunter2',
  attachments: [{ id: 'a1', name: 'scan.pdf', size: 2048, onServer: true }],
}

beforeEach(() => {
  installChrome()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

const tab = {
  tabId: 7,
  address: 'https://shop.example.com/pay',
  match: { site: 'example.com', logins: [], codes: [] },
}

describe('Home', () => {
  it('has a tab for each kind, each with its count', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    for (const label of ['Codes 0', 'Logins 0', 'Notes 2', 'Cards 2', 'Identities 1'])
      expect(button(root, label), label).not.toBeNull()
  })

  it('lists notes with the pinned first, and opens one', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await click(button(root, 'Notes 2'))
    expect([...root.querySelectorAll('.list .item .name')].map((el) => el.textContent)).toEqual([
      'Recovery',
      'Wi-Fi',
    ])
    expect(text(root)).toContain(t('items_files', '2'))
    await click(button(root, 'Open Wi-Fi'))
    expect(background.of('revealNote')[0]?.args).toEqual({ id: 'n1' })
  })

  it('lists cards by brand, last four digits and expiry, and copies the number without showing it', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await click(button(root, 'Cards 2'))
    expect(text(root)).toContain('Visa •••• 1111 · 05/2029')
    expect(text(root)).toContain(t('items_expired'))
    expect(text(root)).not.toContain('4111')
    await click(button(root, t('items_copyCardNumberOf', 'Everyday Visa')))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'cardNumber', id: 'k1' })
  })

  it('lists identities by email, and copies it', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await click(button(root, 'Identities 1'))
    expect(text(root)).toContain('sam@example.com')
    await click(button(root, t('items_copyEmailOf', 'Me')))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'email', id: 'i1' })
  })

  it('says what is missing, with a button to start one', async () => {
    background.reset(unlockedHandlers(world({ cards: [] })))
    const root = await openPopup()
    await click(button(root, 'Cards 0'))
    expect(text(root)).toContain(t('items_none_cards').split('. ')[0] + '.')
    await click(button(root, t('items_new_cards')))
    expect(text(root)).toContain(t('items_newCard'))
  })

  it('searches every kind at once, and says when nothing matches', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await change(input(root, t('popup_searchLabel')), 'visa')
    expect(text(root)).toContain(t('items_cards'))
    expect(text(root)).toContain('Everyday Visa')
    expect(text(root)).not.toContain('Old Amex')
    expect(text(root)).not.toContain(t('items_notes'))
    await change(input(root, t('popup_searchLabel')), 'lyon')
    expect(text(root)).toContain(t('items_identities'))
    expect(text(root)).not.toContain(t('items_cards'))
    await change(input(root, t('popup_searchLabel')), 'zzzz')
    expect(text(root)).toContain(message('en', 'popup_nothingMatches', ['zzzz']))
  })

  it('finds a note by its title and not by its text', async () => {
    background.reset(unlockedHandlers(world()))
    const root = await openPopup()
    await change(input(root, t('popup_searchLabel')), 'wi-fi')
    expect(text(root)).toContain('Wi-Fi')
    await change(input(root, t('popup_searchLabel')), 'hunter2')
    expect(text(root)).toContain(message('en', 'popup_nothingMatches', ['hunter2']))
  })
})

describe('a card’s page', () => {
  const open = async (
    extra: Parameters<typeof background.reset>[0] = {},
    w: Partial<World> = {},
  ) => {
    background.reset({
      ...unlockedHandlers(world(w)),
      showSecret: ((args: { what: string }) =>
        args.what === 'cardNumber' ? '4111111111111111' : '123') as never,
      deleteCard: (() => undefined) as never,
      ...extra,
    })
    const root = await openPopup()
    await click(button(root, 'Cards 2'))
    await click(button(root, 'Open Everyday Visa'))
    return root
  }

  it('hides the number and the code until they are shown, one at a time', async () => {
    const root = await open()
    expect(text(root)).toContain('•••• 1111')
    expect(text(root)).not.toContain('4111 1111')
    expect(text(root)).toContain('Sam Rivera')
    expect(text(root)).toContain('05/2029')
    expect(background.of('showSecret')).toHaveLength(0)

    await click(button(root, t('items_showNumber')))
    expect(text(root)).toContain('4111 1111 1111 1111')
    expect(background.of('showSecret')[0]?.args).toEqual({ what: 'cardNumber', id: 'k1' })
    // The code is still hidden
    expect(text(root)).not.toContain('123')
    await click(button(root, t('items_showCode')))
    expect(background.of('showSecret')[1]?.args).toEqual({ what: 'cardCode', id: 'k1' })
    await click(button(root, t('items_hideCode')))
    expect(text(root)).not.toContain('123')
  })

  it('copies the number, the code and the cardholder through the background', async () => {
    const root = await open()
    await click(button(root, t('items_copyCardNumber')))
    await click(button(root, t('items_copyCode')))
    await click(button(root, t('items_copyCardholder')))
    expect(background.of('copy').map((call) => call.args)).toEqual([
      { what: 'cardNumber', id: 'k1' },
      { what: 'cardCode', id: 'k1' },
      { what: 'cardholder', id: 'k1' },
    ])
  })

  it('fills the tab in front, and says where', async () => {
    const root = await open({
      popup: (() => ({ state: { exists: true, unlocked: true, wrongPasswords: 0 }, tab })) as never,
      fill: (() => undefined) as never,
    })
    await click(button(root, t('items_fillCardOf', 'Everyday Visa')))
    expect(background.of('fill')[0]?.args).toEqual({ tabId: 7, cardId: 'k1' })
    expect(text(root)).toContain(t('items_cardFilledOn', 'example.com'))
  })

  it('says why a frame or an http page was not filled', async () => {
    const root = await open({
      popup: (() => ({ state: { exists: true, unlocked: true, wrongPasswords: 0 }, tab })) as never,
      fill: (() => {
        throw new Error('confirm')
      }) as never,
    })
    await click(button(root, t('items_fillCardOf', 'Everyday Visa')))
    expect(text(root)).toContain(t('items_errorConfirm'))
  })

  it('deletes after the question, and not before', async () => {
    const root = await open()
    await click(button(root, t('items_deleteCard')))
    expect(background.of('deleteCard')).toHaveLength(0)
    expect(text(root)).toContain(t('items_deleteCardTitle'))
    await click(button(root, message('en', 'popup_delete')))
    expect(background.of('deleteCard')[0]?.args).toEqual({ id: 'k1' })
  })
})

describe('adding and editing a card', () => {
  it('saves the digits, the brand the number offers, the expiry and the code', async () => {
    background.reset({
      ...unlockedHandlers(world({ cards: [] })),
      saveCard: ((args: { input: { name: string } }) =>
        card({ id: 'k9', name: args.input.name })) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Cards 0'))
    await click(button(root, t('items_new_cards')))
    await change(input(root, t('items_fieldName')), 'Work card')
    await change(input(root, t('items_fieldNumber')), '4111 1111 1111 1111')
    await change(input(root, t('items_fieldExpiry')), '05/29')
    await change(input(root, t('items_fieldCode')), '123')
    expect(text(root)).toContain(t('items_brandOffered', 'Visa'))
    await submit(root.querySelector('form'))
    expect(background.of('saveCard')[0]?.args).toEqual({
      id: null,
      input: {
        name: 'Work card',
        number: '4111111111111111',
        brand: 'Visa',
        expMonth: 5,
        expYear: 2029,
        code: '123',
        pinned: false,
      },
    })
  })

  it('refuses a number that is not one, and says so, before anything is sent', async () => {
    background.reset(unlockedHandlers(world({ cards: [] })))
    const root = await openPopup()
    await click(button(root, 'Cards 0'))
    await click(button(root, t('items_new_cards')))
    await change(input(root, t('items_fieldName')), 'x')
    await change(input(root, t('items_fieldNumber')), '41x1')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('items_numberDigits'))
    expect(background.of('saveCard')).toHaveLength(0)
  })

  it('warns about a number that fails the Luhn check, and still saves it', async () => {
    background.reset({
      ...unlockedHandlers(world({ cards: [] })),
      saveCard: (() => card()) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Cards 0'))
    await click(button(root, t('items_new_cards')))
    await change(input(root, t('items_fieldName')), 'x')
    await change(input(root, t('items_fieldNumber')), '4111111111111112')
    expect(text(root)).toContain(t('items_numberLuhn'))
    await submit(root.querySelector('form'))
    expect(background.of('saveCard')).toHaveLength(1)
  })

  it('reads the whole card first, and sends back what it did not change', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      revealCard: (() => visaFull) as never,
      saveCard: (() => visa) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Cards 2'))
    await click(button(root, 'Open Everyday Visa'))
    await click(button(root, message('en', 'popup_edit')))
    expect(background.of('revealCard')[0]?.args).toEqual({ id: 'k1' })
    expect(input(root, t('items_fieldNumber'))?.value).toBe('4111 1111 1111 1111')
    await change(input(root, t('items_fieldName')), 'Everyday Visa 2')
    await submit(root.querySelector('form'))
    expect(background.of('saveCard')[0]?.args).toEqual({
      id: 'k1',
      input: {
        name: 'Everyday Visa 2',
        cardholder: 'Sam Rivera',
        number: '4111111111111111',
        brand: 'Visa',
        expMonth: 5,
        expYear: 2029,
        code: '123',
        pinned: false,
      },
    })
  })
})

describe('an identity’s page', () => {
  const open = async () => {
    background.reset({
      ...unlockedHandlers(world({ identities: [{ ...me, documents: [passport] }] })),
      showSecret: (() => 'X1234567') as never,
    })
    const root = await openPopup()
    await click(button(root, 'Identities 1'))
    await click(button(root, 'Open Me'))
    return root
  }

  it('shows the details and the address, and the document without its number', async () => {
    const root = await open()
    expect(text(root)).toContain('Sam Rivera')
    expect(text(root)).toContain('1 Orbit Way')
    expect(text(root)).toContain('69001 Lyon')
    expect(text(root)).toContain('France')
    expect(text(root)).toContain(t('items_doc_passport'))
    expect(text(root)).toContain(t('items_expired'))
    expect(text(root)).not.toContain('X1234567')
  })

  it('shows and copies a document’s number on a click', async () => {
    const root = await open()
    await click(button(root, t('items_showDocumentNumber')))
    expect(text(root)).toContain('X1234567')
    expect(background.of('showSecret')[0]?.args).toEqual({
      what: 'documentNumber',
      id: 'i1',
      documentId: 'd1',
    })
    await click(button(root, t('items_copyDocumentNumber')))
    expect(background.of('copy')[0]?.args).toEqual({
      what: 'documentNumber',
      id: 'i1',
      documentId: 'd1',
    })
    await click(button(root, t('items_copyPhone')))
    expect(background.of('copy')[1]?.args).toEqual({ what: 'phone', id: 'i1' })
  })
})

describe('adding and editing an identity', () => {
  it('saves a country typed by name as its code, and the documents as the list says', async () => {
    background.reset({
      ...unlockedHandlers(world({ identities: [] })),
      saveIdentity: (() => identity()) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Identities 0'))
    await click(button(root, t('items_new_identities')))
    await change(input(root, t('items_fieldName')), 'Home')
    await change(input(root, t('items_fieldEmail')), 'sam@example.com')
    await change(input(root, t('items_fieldLine1')), '1 Orbit Way')
    await change(input(root, t('items_fieldCity')), 'Lyon')
    await change(input(root, t('items_fieldCountry')), 'France')
    await click(button(root, t('items_documentAdd')))
    await change(input(root, t('items_fieldDocumentNumber')), 'X1234567')
    await submit(root.querySelector('form'))
    const sent = background.of('saveIdentity')[0]?.args as {
      id: null
      input: Record<string, unknown>
    }
    expect(sent.id).toBeNull()
    expect(sent.input).toMatchObject({
      name: 'Home',
      email: 'sam@example.com',
      address: { lines: ['1 Orbit Way'], city: 'Lyon', country: 'FR' },
      documents: [{ type: 'passport', number: 'X1234567' }],
    })
  })

  it('needs a detail besides the name, and a date that is one', async () => {
    background.reset(unlockedHandlers(world({ identities: [] })))
    const root = await openPopup()
    await click(button(root, 'Identities 0'))
    await click(button(root, t('items_new_identities')))
    await change(input(root, t('items_fieldName')), 'Empty')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('items_identityNeedsDetail'))
    await change(input(root, t('items_fieldBirthDate')), '1990-02-30')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('items_dateFormat'))
    expect(background.of('saveIdentity')).toHaveLength(0)
  })

  it('reads the whole identity first, and keeps its documents', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      revealIdentity: (() => meFull) as never,
      saveIdentity: (() => me) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Identities 1'))
    await click(button(root, 'Open Me'))
    await click(button(root, message('en', 'popup_edit')))
    await change(input(root, t('items_fieldName')), 'Me again')
    await submit(root.querySelector('form'))
    const sent = background.of('saveIdentity')[0]?.args as {
      id: string
      input: { documents: unknown[] }
    }
    expect(sent.id).toBe('i1')
    expect(sent.input.documents).toEqual([
      {
        id: 'd1',
        type: 'passport',
        number: 'X1234567',
        issuingCountry: 'FR',
        expiresOn: '2020-01-01',
      },
    ])
  })
})

describe('a note’s page', () => {
  const open = async () => {
    background.reset({
      ...unlockedHandlers(world()),
      revealNote: (() => wifiFull) as never,
      saveNote: (() => wifi) as never,
      deleteNote: (() => undefined) as never,
    })
    const root = await openPopup()
    await click(button(root, 'Notes 2'))
    await click(button(root, 'Open Wi-Fi'))
    return root
  }

  it('shows the text and the files by name and size', async () => {
    const root = await open()
    expect(text(root)).toContain('the password is hunter2')
    expect(text(root)).toContain('scan.pdf')
    expect(text(root)).toContain(t('items_sizeKb', '2'))
  })

  it('copies the text through the background', async () => {
    const root = await open()
    await click(button(root, t('items_copyText')))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'noteText', id: 'n1' })
  })

  it('is edited after its text is read, and refuses an empty title or too long a text', async () => {
    const root = await open()
    await click(button(root, message('en', 'popup_edit')))
    expect(input(root, t('items_fieldTitle'))?.value).toBe('Wi-Fi')
    await change(input(root, t('items_fieldTitle')), '  ')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('items_noteNeedsTitle'))
    expect(background.of('saveNote')).toHaveLength(0)
    await change(input(root, t('items_fieldTitle')), 'Wi-Fi 2')
    await submit(root.querySelector('form'))
    expect(background.of('saveNote')[0]?.args).toEqual({
      id: 'n1',
      input: { title: 'Wi-Fi 2', text: 'the password is hunter2', pinned: false },
    })
  })

  it('counts the characters against the app’s limit', async () => {
    const root = await open()
    await click(button(root, message('en', 'popup_edit')))
    await change(root.querySelector('textarea'), 'x'.repeat(10_005))
    await settle()
    expect(text(root)).toContain(t('items_noteTooLong', '5'))
    await submit(root.querySelector('form'))
    expect(background.of('saveNote')).toHaveLength(0)
  })

  it('deletes after the question', async () => {
    const root = await open()
    await click(button(root, t('items_deleteNote')))
    await click(button(root, message('en', 'popup_delete')))
    expect(background.of('deleteNote')[0]?.args).toEqual({ id: 'n1' })
  })
})
