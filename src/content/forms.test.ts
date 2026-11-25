import { describe, expect, it } from 'vitest'
import { findFormFields, sectionOf, type FormDescription } from './forms'

let next = 0
/** A visible text input with nothing to say, in the form `1`. */
const field = (over: Partial<FormDescription> = {}): FormDescription => ({
  id: `f${++next}`,
  tag: 'input',
  type: 'text',
  autocomplete: [],
  words: [],
  visible: true,
  focused: false,
  group: '1',
  format: '',
  ...over,
})

const parts = (fields: FormDescription[], taken: string[] = []) =>
  findFormFields(fields, new Set(taken)).map((found) => `${found.kind}:${found.part}`)

describe('a card form', () => {
  it('is found by the autocomplete tokens of the standard', () => {
    const fields = [
      field({ autocomplete: ['cc-name'] }),
      field({ autocomplete: ['cc-number'] }),
      field({ autocomplete: ['cc-exp'] }),
      field({ autocomplete: ['cc-exp-month'] }),
      field({ autocomplete: ['cc-exp-year'] }),
      field({ autocomplete: ['cc-csc'] }),
      field({ autocomplete: ['cc-type'], tag: 'select', type: 'select' }),
    ]
    expect(parts(fields)).toEqual([
      'card:cardName',
      'card:cardNumber',
      'card:cardExp',
      'card:cardExpMonth',
      'card:cardExpYear',
      'card:cardCsc',
      'card:cardType',
    ])
  })

  it('is found by names, ids, placeholders and labels, in English and in French', () => {
    const fields = [
      field({ words: ['card_number', 'Card number'] }),
      field({ words: ['cardHolder'] }),
      field({ words: ['exp_month', 'Expiry month'], tag: 'select', type: 'select' }),
      field({ words: ['exp_year'], tag: 'select', type: 'select' }),
      field({ words: ['cvv', 'Security code'], type: 'password' }),
    ]
    expect(parts(fields)).toEqual([
      'card:cardNumber',
      'card:cardName',
      'card:cardExpMonth',
      'card:cardExpYear',
      'card:cardCsc',
    ])
    expect(
      parts([
        field({ words: ['Numéro de carte'] }),
        field({ words: ['Nom du titulaire'] }),
        field({ words: ['Date d’expiration', 'MM/AA'] }),
        field({ words: ['Cryptogramme'] }),
      ]),
    ).toEqual(['card:cardNumber', 'card:cardName', 'card:cardExp', 'card:cardCsc'])
  })

  it('may be one field in a frame of its own, a payment provider’s, when it says outright what it is', () => {
    expect(parts([field({ autocomplete: ['cc-number'] })])).toEqual(['card:cardNumber'])
    expect(parts([field({ autocomplete: ['cc-csc'] })])).toEqual(['card:cardCsc'])
  })

  it('is not a form of two guessed fields with no number in them', () => {
    expect(parts([field({ words: ['exp_month'] }), field({ words: ['exp_year'] })])).toEqual([])
  })

  it('is not a gift card’s, a promotion’s, or a password field’s', () => {
    expect(parts([field({ words: ['gift card number'] })])).toEqual([])
    expect(parts([field({ words: ['promo code'] })])).toEqual([])
    expect(parts([field({ type: 'password', words: ['password'] })])).toEqual([])
  })

  it('does not take a field the sign-in rules took, or one the person can’t see', () => {
    const one = field({ autocomplete: ['cc-number'] })
    expect(parts([one], [one.id])).toEqual([])
    expect(parts([field({ autocomplete: ['cc-number'], visible: false })])).toEqual([])
  })

  it('does not take a number field too narrow to hold a card number, or a code field too wide', () => {
    expect(parts([field({ words: ['card number'], maxLength: 4 })])).toEqual([])
    expect(
      parts([field({ words: ['card number'] }), field({ words: ['cvv'], maxLength: 40 })]),
    ).toEqual(['card:cardNumber'])
  })

  it('keeps the first field of each part, as the form lists them', () => {
    const first = field({ autocomplete: ['cc-number'] })
    const second = field({ autocomplete: ['cc-number'] })
    expect(findFormFields([first, second]).map((found) => found.id)).toEqual([first.id])
  })

  it('carries the field’s format on, and what block it is in', () => {
    const [found] = findFormFields([
      field({ autocomplete: ['cc-exp'], format: 'len:5;year:2;sep:/', group: '3' }),
    ])
    expect(found).toMatchObject({
      part: 'cardExp',
      format: 'len:5;year:2;sep:/',
      group: '3',
      explicit: true,
    })
  })
})

describe('an identity form', () => {
  it('is found by the autocomplete tokens, an address in a block of its own', () => {
    const fields = [
      field({ autocomplete: ['given-name'] }),
      field({ autocomplete: ['additional-name'] }),
      field({ autocomplete: ['family-name'] }),
      field({ autocomplete: ['organization'] }),
      field({ autocomplete: ['email'] }),
      field({ autocomplete: ['tel'] }),
      field({ autocomplete: ['street-address'], tag: 'textarea', type: 'textarea' }),
      field({ autocomplete: ['address-line1'] }),
      field({ autocomplete: ['address-line2'] }),
      field({ autocomplete: ['address-level2'] }),
      field({ autocomplete: ['address-level1'] }),
      field({ autocomplete: ['postal-code'] }),
      field({ autocomplete: ['country'], tag: 'select', type: 'select' }),
      field({ autocomplete: ['bday'] }),
    ]
    expect(parts(fields)).toEqual([
      'identity:givenName',
      'identity:middleName',
      'identity:familyName',
      'identity:company',
      'identity:email',
      'identity:phone',
      'identity:street',
      'identity:line1',
      'identity:line2',
      'identity:city',
      'identity:region',
      'identity:postalCode',
      'identity:country',
      'identity:birthDate',
    ])
  })

  it('is found by names, ids, placeholders and labels, in English and in French', () => {
    expect(
      parts([
        field({ words: ['first_name'] }),
        field({ words: ['lastName'] }),
        field({ words: ['address1', 'Street address'] }),
        field({ words: ['city'] }),
        field({ words: ['zip'] }),
        field({ words: ['phone'] }),
      ]),
    ).toEqual([
      'identity:givenName',
      'identity:familyName',
      'identity:line1',
      'identity:city',
      'identity:postalCode',
      'identity:phone',
    ])
    expect(
      parts([
        field({ words: ['Prénom'] }),
        field({ words: ['Nom'] }),
        field({ words: ['Adresse'] }),
        field({ words: ['Code postal'] }),
        field({ words: ['Ville'] }),
        field({ words: ['Pays'], tag: 'select', type: 'select' }),
      ]),
    ).toEqual([
      'identity:givenName',
      // A bare Nom beside a prénom is the family name
      'identity:familyName',
      'identity:line1',
      'identity:postalCode',
      'identity:city',
      'identity:countryName',
    ])
  })

  it('is a full name when no given name is asked for', () => {
    expect(
      parts([
        field({ words: ['name'] }),
        field({ words: ['email'], type: 'email' }),
        field({ words: ['phone'], type: 'tel' }),
      ]),
    ).toEqual(['identity:fullName', 'identity:email', 'identity:phone'])
  })

  it('is not a lone email, and not a login’s username or a search', () => {
    expect(parts([field({ autocomplete: ['email'] })])).toEqual([])
    expect(parts([field({ words: ['username'] }), field({ words: ['search'] })])).toEqual([])
    expect(parts([field({ words: ['first_name'] })])).toEqual([])
  })

  it('keeps the first field of each part: a second email is a confirmation', () => {
    const email = field({ autocomplete: ['email'] })
    const confirm = field({ words: ['confirm email'] })
    const name = field({ autocomplete: ['given-name'] })
    expect(findFormFields([name, email, confirm]).map((found) => found.id)).toEqual([
      name.id,
      email.id,
    ])
  })

  it('is two blocks when the fields name a shipping and a billing address', () => {
    const fields = [
      field({ autocomplete: ['shipping', 'given-name'], group: '1:shipping' }),
      field({ autocomplete: ['shipping', 'postal-code'], group: '1:shipping' }),
      field({ autocomplete: ['billing', 'given-name'], group: '1:billing' }),
      field({ autocomplete: ['billing', 'postal-code'], group: '1:billing' }),
    ]
    const found = findFormFields(fields)
    expect(found.map((f) => `${f.group}:${f.part}`)).toEqual([
      '1:shipping:givenName',
      '1:shipping:postalCode',
      '1:billing:givenName',
      '1:billing:postalCode',
    ])
  })

  it('is told from a birth month, which is not an expiry month', () => {
    expect(
      parts([
        field({ words: ['birth_month'], tag: 'select', type: 'select' }),
        field({ words: ['birth_year'] }),
      ]),
    ).toEqual(['identity:birthMonth', 'identity:birthYear'])
  })

  it('does not take a field the sign-in rules took', () => {
    const email = field({ autocomplete: ['email'] })
    const given = field({ autocomplete: ['given-name'] })
    expect(findFormFields([given, email], new Set([email.id])).map((f) => f.id)).toEqual([given.id])
  })
})

describe('a field the sign-in rules guessed was a username', () => {
  it('may be a card’s and never an identity’s', () => {
    const number = field({ words: ['cardnumber'] })
    const name = field({ words: ['name'] })
    const given = field({ words: ['first name'] })
    const found = findFormFields([given, name, number], new Set(), new Set([name.id, number.id]))
    expect(found.map((f) => `${f.kind}:${f.part}`)).toEqual(['card:cardNumber'])
    // And it does not make an identity form by being counted in one
    expect(findFormFields([given, name], new Set(), new Set([name.id])).map((f) => f.id)).toEqual(
      [],
    )
  })
})

describe('sectionOf', () => {
  it('names the shipping, billing and section tokens of an autocomplete value', () => {
    expect(sectionOf(['shipping', 'street-address'])).toBe('shipping')
    expect(sectionOf(['section-blue', 'billing', 'cc-number'])).toBe('section-blue-billing')
    expect(sectionOf(['cc-number'])).toBe('')
  })
})
