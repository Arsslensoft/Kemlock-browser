// Which fields of a frame ask for a payment card, and which for a person's details and address (docs/plans/add-items.md): the
// `autocomplete` tokens of the HTML standard first, then what the field says of itself (its name, id, placeholder and labels,
// in English and French), in the way src/content/fields.ts reads a sign-in form. The rules read descriptions only; formdom.ts
// builds them from the page. A form is only reported when it is one: a card needs a field that says outright it is a card
// field or a card number, an identity needs two fields or one that is plainly an address or a name.
import type { CardPart, FormPart, IdentityPart } from '../shared/api'
import { splitWords, type FieldDescription } from './fields'

/** A field of the frame, as these rules read it. */
export interface FormDescription extends FieldDescription {
  /** The form it is in, and its autocomplete section when it has one (`2:shipping`): fields of one block share it. */
  group: string
  /** What the field shows of its format (`len:5;year:2;sep:/`, `select`, `area`, `date`), for the text filled in. */
  format: string
}

/** A field these rules found: what it asks for, whether it said so outright, and its block. */
export interface FormField {
  id: string
  kind: 'card' | 'identity'
  part: FormPart
  group: string
  /** An `autocomplete` token said so, rather than the field's words. */
  explicit: boolean
  format: string
  /** The field the person is in. */
  focused: boolean
}

const cardTokens: Record<string, CardPart> = {
  'cc-name': 'cardName',
  'cc-number': 'cardNumber',
  'cc-exp': 'cardExp',
  'cc-exp-month': 'cardExpMonth',
  'cc-exp-year': 'cardExpYear',
  'cc-csc': 'cardCsc',
  'cc-type': 'cardType',
}

const identityTokens: Record<string, IdentityPart> = {
  'honorific-prefix': 'title',
  name: 'fullName',
  'given-name': 'givenName',
  'additional-name': 'middleName',
  'family-name': 'familyName',
  organization: 'company',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  bday: 'birthDate',
  'bday-day': 'birthDay',
  'bday-month': 'birthMonth',
  'bday-year': 'birthYear',
  'street-address': 'street',
  'address-line1': 'line1',
  'address-line2': 'line2',
  'address-line3': 'line3',
  'address-level2': 'city',
  'address-level1': 'region',
  'postal-code': 'postalCode',
  country: 'country',
  'country-name': 'countryName',
}

/** What an `autocomplete` value is for: the last token that names a field (the others are sections and shipping or billing). */
function tokenPart(tokens: string[]): { kind: 'card' | 'identity'; part: FormPart } | null {
  for (const token of [...tokens].reverse()) {
    const card = cardTokens[token]
    if (card !== undefined) return { kind: 'card', part: card }
    const identity = identityTokens[token]
    if (identity !== undefined) return { kind: 'identity', part: identity }
  }
  return null
}

/** The sections an `autocomplete` value names, for the block a field is in (`shipping`, `billing`, `section-x`). */
export function sectionOf(tokens: string[]): string {
  return tokens
    .filter((token) => token === 'shipping' || token === 'billing' || token.startsWith('section-'))
    .join('-')
}

/* ----------------------------------------------------------------------------------------------- */
/* What a field says of itself                                                                       */
/* ----------------------------------------------------------------------------------------------- */

/** The field's words as one lower-case line: camel case, dashes and underscores split into words, accents left in. */
function lineOf(field: FormDescription): string {
  return field.words
    .map((word) => splitWords(word).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Words around a card number that are not one: a promotion or a gift card, a security question, a phone's area code
const notCard =
  /(?:gift|promo|coupon|voucher|discount|loyalty|member|points|reward|bar ?code|search)/

const cardRules: [CardPart, RegExp][] = [
  [
    'cardCsc',
    /\b(?:cvv2?|cvc2?|csc|cid|cvn|security code|security number|verification (?:code|value|number)|card (?:security|verification) |card code|code de s[eé]curit[eé]|cryptogramme|crypto visuel)\b/,
  ],
  // MM/YY in one field says so in its placeholder or its label
  ['cardExp', /\b(?:mm|mois)\s*(?:yy|yyyy|aa|aaaa)\b/],
  [
    'cardExpMonth',
    /\b(?:(?:exp\w*|valid\w*|card|cc)\s*(?:date\s*)?(?:month|mois|mm)|month|mois)\b/,
  ],
  [
    'cardExpYear',
    /\b(?:(?:exp\w*|valid\w*|card|cc)\s*(?:date\s*)?(?:year|ann[eé]e|yy|yyyy)|year|ann[eé]e)\b/,
  ],
  [
    'cardExp',
    /\b(?:expir\w*|exp date|exp|valid (?:thru|through|until|to)|valable jusqu|date d expiration|mm yy|mm yyyy)\b/,
  ],
  [
    'cardName',
    /\b(?:name on card|name as it appears|card ?holder\w*|holder name|cc name|nom (?:du|sur la|de la) (?:titulaire|carte)|titulaire)\b/,
  ],
  [
    'cardType',
    /\b(?:card type|card brand|type of card|credit card type|type de carte|marque de carte)\b/,
  ],
  [
    'cardNumber',
    /\b(?:card (?:number|num|no)|cc (?:number|num|no)|ccnumber|cardnumber|credit card|debit card|num[eé]ro de carte|n° de carte|pan)\b/,
  ],
]

const identityRules: [IdentityPart, RegExp][] = [
  ['birthDay', /\b(?:birth|dob|bday|naissance)\w*\s*(?:day|jour)\b/],
  ['birthMonth', /\b(?:birth|dob|bday|naissance)\w*\s*(?:month|mois)\b/],
  ['birthYear', /\b(?:birth|dob|bday|naissance)\w*\s*(?:year|ann[eé]e)\b/],
  ['birthDate', /\b(?:birth ?date|date of birth|birthday|dob|bday|date de naissance|naissance)\b/],
  ['postalCode', /\b(?:zip(?: ?code)?|postal(?: ?code)?|post ?code|postcode|code postal|cp)\b/],
  [
    'line2',
    /\b(?:address|adresse|addr|street)\s*(?:line\s*)?(?:2|two|deux)\b|\b(?:apartment|apt|suite|unit|flat|compl[eé]ment|b[aâ]timent)\b/,
  ],
  ['line3', /\b(?:address|adresse|addr|street)\s*(?:line\s*)?(?:3|three|trois)\b/],
  [
    'line1',
    /\b(?:address|adresse|addr|street|rue)\s*(?:line\s*)?(?:1|one|un)\b|^(?:street|street address|address|adresse|rue|address line|your address)$/,
  ],
  ['city', /\b(?:city|town|ville|commune|locality|suburb)\b/],
  ['region', /\b(?:state|province|region|r[eé]gion|county|d[eé]partement|prefecture)\b/],
  ['countryName', /\b(?:country|pays)\b/],
  [
    'company',
    /\b(?:company|organi[sz]ation|employer|soci[eé]t[eé]|entreprise|business name|org)\b/,
  ],
  ['givenName', /\b(?:first|given|fore)\s*name\b|\bfname\b|\bpr[eé]nom\b|\bgiven\b/],
  ['middleName', /\b(?:middle|additional)\s*name\b|\bmname\b|\bdeuxi[eè]me pr[eé]nom\b/],
  [
    'familyName',
    /\b(?:last|family|sur)\s*name\b|\blname\b|\bnom de famille\b|\bfamily\b|\bsurname\b/,
  ],
  ['title', /\b(?:salutation|civilit[eé]|honorific|title|gender|genre)\b/],
  ['phone', /\b(?:phone|tel|telephone|t[eé]l[eé]phone|mobile|cell|gsm|portable|fax)\b/],
  ['email', /\b(?:e ?mail|courriel|adresse e ?mail)\b/],
  [
    'fullName',
    /^(?:name|full name|your name|nom complet|nom et pr[eé]nom|pr[eé]nom et nom|nom|contact name)$|\bfull ?name\b/,
  ],
]

/** What a field's words ask for when no `autocomplete` token says. */
function wordsPart(field: FormDescription): { kind: 'card' | 'identity'; part: FormPart } | null {
  const line = lineOf(field)
  if (line === '') return null
  // A promotion's and a gift card's words are never a card's number, and a birth month is not an expiry month
  const rejectCard = notCard.test(line)
  const birth = /\b(?:birth|dob|bday|born|naissance)/.test(line)
  // A password field only ever asks for a security code
  const passwordOnly = field.type === 'password'
  for (const [part, test] of cardRules) {
    if (birth || (rejectCard && part === 'cardNumber')) continue
    if (passwordOnly && part !== 'cardCsc') continue
    if (test.test(line)) return { kind: 'card', part }
  }
  if (passwordOnly) return null
  if (
    /\b(?:user ?name|login|password|search|query|coupon|promo|captcha|subject|message|comment|job|position|card)\b/.test(
      line,
    )
  )
    return null
  for (const [part, test] of identityRules) if (test.test(line)) return { kind: 'identity', part }
  return null
}

/** The part a field asks for, by its `type` when its words are no help: an email, a phone, a date of birth. */
function typePart(
  field: FormDescription,
  line: string,
): { kind: 'identity'; part: IdentityPart } | null {
  if (field.type === 'tel') return { kind: 'identity', part: 'phone' }
  if (field.type === 'email') return { kind: 'identity', part: 'email' }
  if (field.type === 'date' && /birth|dob|bday|naissance/.test(line))
    return { kind: 'identity', part: 'birthDate' }
  return null
}

const inputTypes = new Set([
  'text',
  'tel',
  'email',
  'number',
  'password',
  'date',
  'search',
  'url',
  '',
])

/** A field's part: an `autocomplete` token, else its words, else its type. */
function partOf(
  field: FormDescription,
): { kind: 'card' | 'identity'; part: FormPart; explicit: boolean } | null {
  if (field.tag === 'input' && !inputTypes.has(field.type)) return null
  if (field.tag === 'input' && field.type === 'search') return null
  const token = tokenPart(field.autocomplete)
  if (token !== null) return { ...token, explicit: true }
  const words = wordsPart(field)
  if (words !== null) return { ...words, explicit: false }
  const typed = typePart(field, lineOf(field))
  return typed === null ? null : { ...typed, explicit: false }
}

/** What a place of the field says of its width: a card number has no use for a two-character box. */
function plausible(field: FormDescription, part: FormPart): boolean {
  const max = field.maxLength
  if (max === undefined) return true
  if (part === 'cardNumber') return max >= 12
  if (part === 'cardCsc') return max <= 8
  return true
}

/* ----------------------------------------------------------------------------------------------- */
/* The forms of a frame                                                                              */
/* ----------------------------------------------------------------------------------------------- */

/** The explicit identity parts that make an identity form on their own: an address or a name, not a lone email or a title. */
const plainlyIdentity = new Set<FormPart>([
  'givenName',
  'familyName',
  'middleName',
  'street',
  'line1',
  'postalCode',
  'company',
  'birthDate',
  'birthDay',
  'birthMonth',
  'birthYear',
  'phone',
])

/**
 * The card and identity fields of a frame. [taken] are the fields the sign-in and code rules took already: a field is one
 * thing, and a login's username stays a login's. [cardOnly] are fields the sign-in rules only guessed are a username: they may
 * be a card's, never an identity's. Fields that are not visible are not reported.
 */
export function findFormFields(
  fields: FormDescription[],
  taken: ReadonlySet<string> = new Set(),
  cardOnly: ReadonlySet<string> = new Set(),
): FormField[] {
  const found: FormField[] = []
  for (const field of fields) {
    if (!field.visible || taken.has(field.id)) continue
    const part = partOf(field)
    if (part === null || !plausible(field, part.part)) continue
    if (cardOnly.has(field.id) && part.kind !== 'card') continue
    found.push({
      id: field.id,
      kind: part.kind,
      part: part.part,
      group: field.group,
      explicit: part.explicit,
      format: field.format,
      focused: field.focused,
    })
  }
  // A block of fields is a card form or an identity form only when it plainly is one
  const blocks = new Map<string, FormField[]>()
  for (const field of found) {
    const key = `${field.kind}|${field.group}`
    blocks.set(key, [...(blocks.get(key) ?? []), field])
  }
  const kept: FormField[] = []
  for (const block of blocks.values()) {
    if (qualifies(block)) kept.push(...settle(block))
  }
  // In the page's order
  const order = new Map(fields.map((field, index) => [field.id, index]))
  return kept.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

/** Whether a block of one kind's fields is a form of it. */
function qualifies(block: FormField[]): boolean {
  if (block[0].kind === 'card') {
    // A field that says outright it is a card's, a card number, or three that look like one (a single field in a frame of
    // its own, a payment provider's, says so with its autocomplete)
    return block.some((field) => field.explicit || field.part === 'cardNumber') || block.length >= 3
  }
  const strong = block.filter((field) => field.explicit && plainlyIdentity.has(field.part))
  if (strong.length > 0) return true
  return (
    block.length >= 2 &&
    block.some((field) => plainlyIdentity.has(field.part) || field.part === 'fullName')
  )
}

/**
 * One field for each thing a block asks for, in the page's order: the first field of a part is the one; a second asking for the
 * same is another thing's (a confirmation of an email, a second phone) and left alone. A bare name beside a given name is the
 * family name: "Nom" and "Prénom".
 */
function settle(block: FormField[]): FormField[] {
  const out: FormField[] = []
  const seen = new Set<FormPart>()
  for (const field of block) {
    if (seen.has(field.part)) continue
    seen.add(field.part)
    out.push(field)
  }
  // A bare "Nom" or "Name" beside a given name is the family name
  const hasGiven = out.some((field) => field.part === 'givenName')
  return out.map((field) =>
    field.part === 'fullName' && !field.explicit && hasGiven
      ? { ...field, part: 'familyName' as const }
      : field,
  )
}
