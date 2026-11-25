import { describe, expect, it } from 'vitest'
import type { CardFull, IdentityFull } from '../shared/api'
import { cardValue, formValues, identityValue, parseShape } from './forms'

const card: CardFull = {
  id: 'k',
  name: 'Visa',
  cardholder: 'Sam Rivera',
  brand: 'Amex',
  lastFour: '0005',
  expMonth: 3,
  expYear: 2031,
  expired: false,
  hasNumber: true,
  hasCode: true,
  hasPin: false,
  tags: [],
  order: 0,
  pinned: false,
  changedAt: 1,
  number: '378282246310005',
  code: '1234',
  pin: '',
}

const person: IdentityFull = {
  id: 'i',
  name: 'Me',
  givenName: 'Sam',
  familyName: 'Rivera',
  fullName: 'Sam Rivera',
  email: 'sam@example.com',
  birthDate: '1990-04-02',
  address: { lines: ['1 Orbit Way'], city: 'Lyon', country: 'Atlantis' },
  documents: [],
  tags: [],
  order: 0,
  pinned: false,
  changedAt: 1,
}

const shape = (format: string) => parseShape(format)

describe('parseShape', () => {
  it('reads the tokens a field reports, and ignores what it does not know', () => {
    expect(parseShape('len:5;year:2;sep:/')).toEqual({
      len: 5,
      year: 2,
      sep: '/',
      select: false,
      area: false,
      date: false,
    })
    expect(parseShape('sep:n;select')).toMatchObject({ sep: '', select: true })
    expect(parseShape('area')).toMatchObject({ area: true })
    expect(parseShape('date')).toMatchObject({ date: true })
    expect(parseShape('len:99999;year:3;sep:x;nonsense;;')).toEqual({
      select: false,
      area: false,
      date: false,
    })
    expect(parseShape(undefined)).toEqual({ select: false, area: false, date: false })
  })
})

describe('a card’s values', () => {
  it('gives the number as digits, the holder, the code and the brand with the names a select may use', () => {
    expect(cardValue(card, 'cardNumber', shape(''))).toEqual({ value: '378282246310005' })
    expect(cardValue(card, 'cardName', shape(''))).toEqual({ value: 'Sam Rivera' })
    expect(cardValue(card, 'cardCsc', shape(''))).toEqual({ value: '1234' })
    expect(cardValue(card, 'cardType', shape('select'))?.alt).toContain('American Express')
  })

  it('writes the month as two digits, with the others a select may use', () => {
    expect(cardValue(card, 'cardExpMonth', shape(''))).toEqual({
      value: '03',
      alt: ['3', 'March', 'mars'],
    })
  })

  it('writes the year in the digits the field asks for', () => {
    expect(cardValue(card, 'cardExpYear', shape(''))?.value).toBe('2031')
    expect(cardValue(card, 'cardExpYear', shape('year:2'))?.value).toBe('31')
    expect(cardValue(card, 'cardExpYear', shape('len:2'))?.value).toBe('31')
    expect(cardValue(card, 'cardExpYear', shape('len:4'))?.value).toBe('2031')
    expect(cardValue(card, 'cardExpYear', shape('select'))?.alt).toEqual(['2031', '31'])
  })

  it('writes the expiry the way the field shows it, shortened to fit', () => {
    expect(cardValue(card, 'cardExp', shape(''))?.value).toBe('03/31')
    expect(cardValue(card, 'cardExp', shape('year:4;sep:/'))?.value).toBe('03/2031')
    expect(cardValue(card, 'cardExp', shape('year:4;sep:-'))?.value).toBe('03-2031')
    expect(cardValue(card, 'cardExp', shape('year:2;sep:n'))?.value).toBe('0331')
    expect(cardValue(card, 'cardExp', shape('len:4'))?.value).toBe('0331')
    // Four digits of year in a field of six still fit without a separator
    expect(cardValue(card, 'cardExp', shape('len:6;year:4;sep:/'))?.value).toBe('032031')
  })

  it('has nothing for what the card lacks', () => {
    const bare = {
      ...card,
      cardholder: undefined,
      brand: undefined,
      expMonth: undefined,
      expYear: undefined,
      code: '',
    }
    for (const part of [
      'cardName',
      'cardType',
      'cardExp',
      'cardExpMonth',
      'cardExpYear',
      'cardCsc',
    ] as const)
      expect(cardValue(bare, part, shape('')), part).toBeUndefined()
  })
})

describe('an identity’s values', () => {
  it('gives the names, the email, the company and the full name', () => {
    expect(identityValue(person, 'givenName', shape(''))).toEqual({ value: 'Sam' })
    expect(identityValue(person, 'familyName', shape(''))).toEqual({ value: 'Rivera' })
    expect(identityValue(person, 'fullName', shape(''))).toEqual({ value: 'Sam Rivera' })
    expect(identityValue(person, 'email', shape(''))).toEqual({ value: 'sam@example.com' })
    expect(identityValue(person, 'phone', shape(''))).toBeUndefined()
    expect(identityValue({ ...person, fullName: undefined }, 'fullName', shape(''))).toEqual({
      value: 'Me',
    })
  })

  it('splits a birth date into a day, a month and a year, with what a select may use', () => {
    expect(identityValue(person, 'birthDate', shape('date'))).toEqual({ value: '1990-04-02' })
    expect(identityValue(person, 'birthDay', shape(''))).toEqual({ value: '02', alt: ['2'] })
    expect(identityValue(person, 'birthMonth', shape(''))).toEqual({
      value: '04',
      alt: ['4', 'April', 'avril'],
    })
    expect(identityValue(person, 'birthYear', shape('year:2'))?.value).toBe('90')
    expect(identityValue({ ...person, birthDate: 'soon' }, 'birthYear', shape(''))).toBeUndefined()
  })

  it('writes a street on one line, or one line to a line of a text area', () => {
    const two = { ...person, address: { lines: ['1 Orbit Way', 'Floor 2'] } }
    expect(identityValue(two, 'street', shape(''))?.value).toBe('1 Orbit Way, Floor 2')
    expect(identityValue(two, 'street', shape('area'))?.value).toBe('1 Orbit Way\nFloor 2')
    expect(identityValue(two, 'line1', shape(''))?.value).toBe('1 Orbit Way')
    expect(identityValue(two, 'line2', shape(''))?.value).toBe('Floor 2')
    expect(identityValue(two, 'line3', shape(''))).toBeUndefined()
  })

  it('writes a country as the code where the field asks for it, and as the name otherwise', () => {
    const france = { ...person, address: { lines: [], country: 'FR' } }
    expect(identityValue(france, 'country', shape(''))).toEqual({
      value: 'FR',
      alt: ['France', 'France'],
    })
    expect(identityValue(france, 'country', shape('select'))).toEqual({
      value: 'France',
      alt: ['FR', 'France'],
    })
    expect(identityValue(france, 'countryName', shape(''))?.value).toBe('France')
    // A country the list doesn't know is kept as it was typed
    expect(identityValue(person, 'country', shape(''))).toEqual({ value: 'Atlantis' })
  })
})

describe('formValues', () => {
  it('keeps the field of each value, and leaves out a field the item has nothing for', () => {
    const values = formValues({ card }, [
      { id: 'a', part: 'cardNumber' },
      { id: 'b', part: 'cardExp', rules: 'year:4;sep:/' },
      { id: 'c', part: 'cardType' },
    ])
    expect(values.map((value) => [value.fieldId, value.value])).toEqual([
      ['a', '378282246310005'],
      ['b', '03/2031'],
      ['c', 'Amex'],
    ])
    expect(values[0]).not.toHaveProperty('alt')
    expect(formValues({ identity: person }, [{ id: 'p', part: 'phone' }])).toEqual([])
  })

  it('shapes a value by what the page reported, and nothing a page says makes it fill more than the item holds', () => {
    // A page that reports a very long format is only read for the tokens it knows
    const hostile = 'len:4;year:2;sep:/;' + 'x'.repeat(400)
    expect(formValues({ card }, [{ id: 'e', part: 'cardExp', rules: hostile }])).toMatchObject([
      { value: '0331' },
    ])
  })
})
