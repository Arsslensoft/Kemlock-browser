import { describe, expect, it } from 'vitest'
import {
  cardBrandOf,
  cardBrands,
  cardDateOk,
  cardDigits,
  cardYear,
  groupedCardNumber,
  isCardNumberText,
  luhnValid,
  maskedCardNumber,
  monthYearText,
  parseCardExpiry,
} from './card'

// The app's own cases (mobile/test/features/cards/card_number_test.dart and the card sheet's)
describe("the app's card helpers", () => {
  it('offer each brand from the test numbers of its range', () => {
    const numbers: Record<string, string> = {
      '4111111111111111': 'Visa',
      '4012888888881881': 'Visa',
      '5555555555554444': 'Mastercard',
      '2223003122003222': 'Mastercard',
      '378282246310005': 'Amex',
      '341111111111111': 'Amex',
      '6011111111111117': 'Discover',
      '6445644564456445': 'Discover',
      '6500000000000002': 'Discover',
      '30569309025904': 'Diners Club',
      '38520000023237': 'Diners Club',
      '3530111333300000': 'JCB',
      '6200000000000005': 'UnionPay',
      '6759649826438453': 'Maestro',
    }
    for (const [number, brand] of Object.entries(numbers))
      expect(cardBrandOf(number), number).toBe(brand)
  })

  it('offer a brand from the leading digits typed so far, and none for an unknown range', () => {
    expect(cardBrandOf('4')).toBe('Visa')
    expect(cardBrandOf('37')).toBe('Amex')
    expect(cardBrandOf('5')).toBeNull()
    expect(cardBrandOf('')).toBeNull()
    expect(cardBrandOf('9999999999999999')).toBeNull()
    for (const brand of [
      'Visa',
      'Mastercard',
      'Amex',
      'Discover',
      'Diners Club',
      'JCB',
      'UnionPay',
      'Maestro',
    ])
      expect(cardBrands).toContain(brand)
  })

  it('check the Luhn digit', () => {
    expect(luhnValid('4111111111111111')).toBe(true)
    expect(luhnValid('378282246310005')).toBe(true)
    expect(luhnValid('4111111111111112')).toBe(false)
    expect(luhnValid('4111 1111')).toBe(false)
    expect(luhnValid('')).toBe(false)
  })

  it('group and mask a number', () => {
    expect(groupedCardNumber('4111111111111111')).toBe('4111 1111 1111 1111')
    expect(groupedCardNumber('378282246310005')).toBe('3782 822463 10005')
    expect(groupedCardNumber('411111111')).toBe('4111 1111 1')
    expect(maskedCardNumber('4111111111111111')).toBe('•••• 1111')
    expect(maskedCardNumber('123')).toBe('123')
  })

  it('keep a number as digits', () => {
    expect(cardDigits('4111-1111 1111-1111')).toBe('4111111111111111')
    expect(isCardNumberText('4111-1111 1111')).toBe(true)
    expect(isCardNumberText('4111a')).toBe(false)
  })

  it('read years and expiries as people type them', () => {
    expect(cardYear(29)).toBe(2029)
    expect(cardYear(2029)).toBe(2029)
    expect(cardYear(500)).toBeNull()
    expect(parseCardExpiry('05/29')).toEqual({ month: 5, year: 2029 })
    expect(parseCardExpiry('5/2029')).toEqual({ month: 5, year: 2029 })
    expect(parseCardExpiry('05-29')).toEqual({ month: 5, year: 2029 })
    expect(parseCardExpiry('0529')).toEqual({ month: 5, year: 2029 })
    expect(parseCardExpiry('13/29')).toEqual({ month: null, year: 2029 })
    expect(parseCardExpiry('05')).toEqual({ month: 5, year: null })
    expect(parseCardExpiry('x')).toEqual({ month: null, year: null })
    expect(parseCardExpiry('1/2/3')).toEqual({ month: null, year: null })
  })

  it('show dates, and judge what was typed', () => {
    expect(monthYearText(5, 2029)).toBe('05/2029')
    expect(monthYearText(undefined, 2029)).toBe('2029')
    expect(monthYearText(5, undefined)).toBe('05')
    expect(monthYearText(undefined, undefined)).toBe('')
    expect(cardDateOk('')).toBe(true)
    expect(cardDateOk('05/29')).toBe(true)
    expect(cardDateOk('05')).toBe(true)
    expect(cardDateOk('2029')).toBe(false)
    expect(cardDateOk('13/29')).toBe(false)
  })
})
