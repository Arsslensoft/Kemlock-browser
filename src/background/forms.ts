// The text a card or an identity gives each field of a form (docs/plans/add-items.md): what each part asks for, shaped to the format
// the field shows (its `maxlength`, the year its placeholder writes, whether it is a select or a text area), and, for a select, the
// other ways its options may be written (a month as 5, 05 or May; a country as FR, France). The page reports the format as plain
// tokens (src/content/formdom.ts), which only shape what is filled in: nothing a page says can make more than the item's own
// values go into a field.
import type { CardFull, CardPart, FormPart, IdentityFull, IdentityPart } from '../shared/api'
import { cardYear } from '../shared/card'
import { countryByCode, type Country } from '../shared/countries'

/** What a field shows of its format, as the content script reported it. */
export interface Shape {
  /** Its `maxlength`. */
  len?: number
  /** The digits of the year its placeholder writes. */
  year?: 2 | 4
  /** The separator its placeholder writes: a character, or '' for none. */
  sep?: string
  select: boolean
  area: boolean
  date: boolean
}

/** The format tokens of a field (`len:5;year:2;sep:/`, `select`), read leniently: an unknown token is ignored. */
export function parseShape(format: string | undefined): Shape {
  const shape: Shape = { select: false, area: false, date: false }
  for (const token of (format ?? '').split(';')) {
    const [name, value = ''] = token.trim().split(':')
    if (name === 'len' && /^\d{1,4}$/.test(value)) shape.len = Number(value)
    else if (name === 'year' && (value === '2' || value === '4')) shape.year = value === '2' ? 2 : 4
    else if (name === 'sep')
      shape.sep = value === 'n' ? '' : value === '/' || value === '-' ? value : undefined
    else if (name === 'select') shape.select = true
    else if (name === 'area') shape.area = true
    else if (name === 'date') shape.date = true
  }
  return shape
}

/** The text to put in a field, and the other texts that name the same for a select to choose among. */
export interface FieldValue {
  value: string
  alt?: string[]
}

const monthNames = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  fr: [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ],
}

const two = (n: number) => String(n).padStart(2, '0')

const brandNames: Record<string, string[]> = {
  Visa: ['VISA', 'visa'],
  Mastercard: ['MasterCard', 'Master Card', 'MC', 'mastercard'],
  Amex: ['American Express', 'AMEX', 'amex', 'AmericanExpress'],
  Discover: ['Discover Network', 'DISCOVER'],
  'Diners Club': ['Diners', 'DinersClub', 'Diners Club International'],
  JCB: ['jcb'],
  UnionPay: ['China UnionPay', 'Union Pay', 'CUP'],
  Maestro: ['maestro'],
}

const some = (value: string | undefined): FieldValue | undefined =>
  value === undefined || value === '' ? undefined : { value }

/** The month and year to put in a field, as the field writes a year. */
function yearText(year: number, shape: Shape, fallback: 2 | 4): string {
  const digits = shape.year ?? (shape.len === 2 ? 2 : shape.len === 4 ? 4 : fallback)
  return digits === 2 ? String(year).slice(-2) : String(year)
}

/** An expiry in one field: `05/29`, `05/2029`, `0529`, `05-29`, whichever the field writes, and the shortest that fits its length. */
function expiry(month: number, year: number, shape: Shape): FieldValue {
  const yy = shape.year === 4 ? String(year) : String(year).slice(-2)
  const sep = shape.sep ?? '/'
  const choices = [
    `${two(month)}${sep}${yy}`,
    `${two(month)}${yy}`,
    `${two(month)}${String(year).slice(-2)}`,
  ]
  const fits = choices.find((text) => shape.len === undefined || text.length <= shape.len)
  return {
    value: fits ?? choices[0],
    alt: [
      `${two(month)}/${String(year).slice(-2)}`,
      `${two(month)}/${year}`,
      `${month}/${year}`,
      `${two(month)} / ${String(year).slice(-2)}`,
    ],
  }
}

/** The value a card gives a field that asks for [part]; undefined when the card has nothing for it. */
export function cardValue(card: CardFull, part: CardPart, shape: Shape): FieldValue | undefined {
  switch (part) {
    case 'cardName':
      return some(card.cardholder)
    case 'cardNumber':
      return some(card.number)
    case 'cardCsc':
      return some(card.code)
    case 'cardType':
      return card.brand === undefined || card.brand === ''
        ? undefined
        : { value: card.brand, alt: brandNames[card.brand] ?? [] }
    case 'cardExp':
      return card.expMonth === undefined || card.expYear === undefined
        ? undefined
        : expiry(card.expMonth, cardYear(card.expYear) ?? card.expYear, shape)
    case 'cardExpMonth':
      return card.expMonth === undefined
        ? undefined
        : {
            value: two(card.expMonth),
            alt: [
              String(card.expMonth),
              monthNames.en[card.expMonth - 1],
              monthNames.fr[card.expMonth - 1],
            ],
          }
    case 'cardExpYear': {
      if (card.expYear === undefined) return undefined
      const year = cardYear(card.expYear) ?? card.expYear
      return { value: yearText(year, shape, 4), alt: [String(year), String(year).slice(-2)] }
    }
  }
}

const countryNames = (country: Country): string[] => [country.en, country.fr]

/** A yyyy-mm-dd date's parts, or undefined when it is not one. */
function dateParts(
  text: string | undefined,
): { year: number; month: number; day: number } | undefined {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '')
  return found === null
    ? undefined
    : { year: Number(found[1]), month: Number(found[2]), day: Number(found[3]) }
}

/** The value an identity gives a field that asks for [part]; undefined when it has nothing for it. */
export function identityValue(
  identity: IdentityFull,
  part: IdentityPart,
  shape: Shape,
): FieldValue | undefined {
  const lines = identity.address?.lines ?? []
  switch (part) {
    case 'title':
      return some(identity.title)
    case 'fullName':
      return some(identity.fullName ?? identity.name)
    case 'givenName':
      return some(identity.givenName)
    case 'middleName':
      return some(identity.middleName)
    case 'familyName':
      return some(identity.familyName)
    case 'company':
      return some(identity.company)
    case 'email':
      return some(identity.email)
    case 'phone':
      return some(identity.phone)
    case 'birthDate':
      return some(identity.birthDate)
    case 'birthDay': {
      const date = dateParts(identity.birthDate)
      return date === undefined ? undefined : { value: two(date.day), alt: [String(date.day)] }
    }
    case 'birthMonth': {
      const date = dateParts(identity.birthDate)
      return date === undefined
        ? undefined
        : {
            value: two(date.month),
            alt: [String(date.month), monthNames.en[date.month - 1], monthNames.fr[date.month - 1]],
          }
    }
    case 'birthYear': {
      const date = dateParts(identity.birthDate)
      return date === undefined
        ? undefined
        : {
            value: yearText(date.year, shape, 4),
            alt: [String(date.year), String(date.year).slice(-2)],
          }
    }
    case 'street':
      return lines.length === 0 ? undefined : { value: lines.join(shape.area ? '\n' : ', ') }
    case 'line1':
      return some(lines[0])
    case 'line2':
      return some(lines[1])
    case 'line3':
      return some(lines[2])
    case 'city':
      return some(identity.address?.city)
    case 'region':
      return some(identity.address?.region)
    case 'postalCode':
      return some(identity.address?.postalCode)
    case 'country':
    case 'countryName': {
      const stored = identity.address?.country
      if (stored === undefined || stored === '') return undefined
      const country = countryByCode(stored)
      if (country === undefined) return { value: stored }
      // A select offers a name or a code, and a field that asks for the code (country) takes it; one that asks for the name takes the name
      return part === 'country' && !shape.select
        ? { value: country.code, alt: countryNames(country) }
        : { value: country.en, alt: [country.code, country.fr] }
    }
  }
}

/** A field a frame reported: what it is, what it asks for, and the format it shows. */
export interface ReportedForm {
  id: string
  part: FormPart
  rules?: string
}

/** Every value a card or an identity gives the fields [fields], by field; a field the item has nothing for is left out. */
export function formValues(
  item: { card: CardFull } | { identity: IdentityFull },
  fields: ReportedForm[],
): { fieldId: string; value: string; alt?: string[] }[] {
  const out: { fieldId: string; value: string; alt?: string[] }[] = []
  for (const field of fields) {
    const shape = parseShape(field.rules)
    const found =
      'card' in item
        ? cardValue(item.card, field.part as CardPart, shape)
        : identityValue(item.identity, field.part as IdentityPart, shape)
    if (found === undefined) continue
    out.push({
      fieldId: field.id,
      value: found.value,
      ...(found.alt === undefined || found.alt.length === 0 ? {} : { alt: found.alt }),
    })
  }
  return out
}
