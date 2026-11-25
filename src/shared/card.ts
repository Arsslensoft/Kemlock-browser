// A card number and an expiry as people type them: the app's helpers (`mobile/lib/features/cards/card_number.dart`, and
// `payment_card.dart` in Kemlock-core), ported so the popup, the background and the content script read a card as the app does.

/** The brands the card page offers, as stored on a card: the names Bitwarden writes, so a brand crosses between the two. */
export const cardBrands = [
  'Visa',
  'Mastercard',
  'Amex',
  'Discover',
  'Diners Club',
  'JCB',
  'UnionPay',
  'Maestro',
] as const

/** The fewest and the most digits a card number may have. */
export const cardNumberMinDigits = 8
export const cardNumberMaxDigits = 19

/** The digits of a card number typed or pasted: spaces, dashes and every other character leave. */
export const cardDigits = (text: string): string => text.replace(/[^0-9]/g, '')

/** Whether [text] is only digits with the spaces and dashes people group a card number by. */
export const isCardNumberText = (text: string): boolean => /^[0-9 -]*$/.test(text)

/** A year from one or two digits as people type it: 29 is 2029, 2029 stays; null outside 0 to 99 and 1000 to 9999. */
export function cardYear(year: number | null | undefined): number | null {
  if (year === null || year === undefined || !Number.isInteger(year)) return null
  if (year >= 0 && year <= 99) return 2000 + year
  if (year >= 1000 && year <= 9999) return year
  return null
}

const month = (value: number): number | null =>
  Number.isInteger(value) && value >= 1 && value <= 12 ? value : null

/** A month and a year from "05/29", "5/2029", "05-29" or "0529", either part null when it isn't there or isn't valid. */
export function parseCardExpiry(text: string): { month: number | null; year: number | null } {
  const none = { month: null, year: null }
  const parts = text
    .trim()
    .split(/[\s/\-.]+/)
    .filter((part) => part !== '')
  if (parts.some((part) => !/^[0-9]+$/.test(part))) return none
  if (parts.length === 1 && parts[0].length === 4)
    // "0529": month then a two-digit year
    return { month: month(Number(parts[0].slice(0, 2))), year: cardYear(Number(parts[0].slice(2))) }
  if (parts.length === 1) return { month: month(Number(parts[0])), year: null }
  if (parts.length !== 2) return none
  return { month: month(Number(parts[0])), year: cardYear(Number(parts[1])) }
}

/** An expiry or "valid from" date as shown and typed: "05/2029", "2029" for a year alone, "05" for a month alone, else ''. */
export function monthYearText(m: number | undefined, y: number | undefined): string {
  if (m === undefined && y === undefined) return ''
  return [
    m === undefined ? undefined : String(m).padStart(2, '0'),
    y === undefined ? undefined : String(y),
  ]
    .filter((part): part is string => part !== undefined)
    .join('/')
}

/** Whether [text] is an expiry or "valid from" date people may have typed: empty, or a month and a year, or a month alone. */
export function cardDateOk(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return true
  const read = parseCardExpiry(trimmed)
  const count = trimmed.split(/[\s/\-.]+/).filter((part) => part !== '').length
  return count === 1 && trimmed.length <= 2
    ? read.month !== null
    : read.month !== null && read.year !== null
}

const prefix = (digits: string, length: number): number | null =>
  digits.length < length ? null : Number(digits.slice(0, length))
const within = (value: number | null, low: number, high: number): boolean =>
  value !== null && value >= low && value <= high

/** The brand offered for a card number from its leading digits (the IIN ranges), or null when none fits. */
export function cardBrandOf(digits: string): string | null {
  if (digits === '') return null
  const two = prefix(digits, 2)
  const three = prefix(digits, 3)
  const four = prefix(digits, 4)
  const six = prefix(digits, 6)
  if (two === 34 || two === 37) return 'Amex'
  if (digits.startsWith('4')) return 'Visa'
  if (within(two, 51, 55) || within(four, 2221, 2720)) return 'Mastercard'
  if (four === 6011 || within(three, 644, 649) || two === 65 || within(six, 622126, 622925))
    return 'Discover'
  if (two === 62) return 'UnionPay'
  if (within(three, 300, 305) || four === 3095 || two === 36 || two === 38 || two === 39)
    return 'Diners Club'
  if (within(four, 3528, 3589)) return 'JCB'
  const maestro = [5018, 5020, 5038, 5893, 6304, 6759, 6761, 6762, 6763]
  if (four !== null && maestro.includes(four)) return 'Maestro'
  return null
}

/** Whether [digits] pass the Luhn check. Anything but digits fails. */
export function luhnValid(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits)) return false
  let sum = 0
  let doubled = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48
    if (doubled) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubled = !doubled
  }
  return sum % 10 === 0
}

/** [digits] in groups: 4-6-5 for an Amex, fours for the rest. */
export function groupedCardNumber(digits: string): string {
  if (digits.length === 15 && (digits.startsWith('34') || digits.startsWith('37')))
    return `${digits.slice(0, 4)} ${digits.slice(4, 10)} ${digits.slice(10)}`
  const groups: string[] = []
  for (let i = 0; i < digits.length; i += 4) groups.push(digits.slice(i, i + 4))
  return groups.join(' ')
}

/** The number as shown until revealed: "•••• 1111". */
export const maskedCardNumber = (digits: string): string =>
  digits.length <= 4 ? digits : `•••• ${digits.slice(-4)}`

/** The last four digits of a number, or all of a shorter one. */
export const lastFourOf = (digits: string): string => digits.slice(-4)
