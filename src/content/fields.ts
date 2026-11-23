// Which fields of a frame want a one-time code, and which are a sign-in,
// sign-up or change-password form's (design decision 7): the rules of the
// Android app's FieldFinder.kt, ported to the fields a web page has, and
// held to the same cases (test/fixtures/autofill/fields.json, the app's). The
// rules read descriptions only; src/content/dom.ts builds them from the page.
//
// What Android alone has is left out: apps' autofill hints, Chrome's own
// predictions, and frames from other sites inside one screen, as the
// background judges each frame by the sender the browser reports.

/** A field of the frame, as the rules read it. */
export interface FieldDescription {
  /** The content script's own name for the field. */
  id: string
  /** The element's tag, lower case: `input`, `textarea`, `select`… */
  tag: string
  /** `type`, lower case; `text` when the element sets none. */
  type: string
  /** The `autocomplete` tokens, lower case. */
  autocomplete: string[]
  /** `inputmode`, lower case, when set. */
  inputMode?: string
  /** The most characters it takes (`maxlength`), when it says. */
  maxLength?: number
  /** What it says of itself: name, id, placeholder, labels, what a screen reader reads. */
  words: string[]
  /** Its `passwordrules`, when it states them. */
  passwordRules?: string
  /** On screen, and not hidden, faded or covered (dom.ts decides). */
  visible: boolean
  /** The field the person is in. */
  focused: boolean
}

/** A field to fill: the whole code, or the character at [character] of a row of boxes. */
export interface CodeField {
  id: string
  character: number | null
}

export type LoginRole = 'username' | 'password' | 'newPassword'

export interface LoginFields {
  username: string | null
  password: string | null
  /** A new password and its confirmation, in page order. */
  newPasswords: string[]
  /** What the field the person is in is for, when it is one of these. */
  focused: LoginRole | null
  /** The fewest characters a new password field takes, when they say. */
  newPasswordMaxLength: number | null
  /** The rules a new password field states in `passwordrules`. */
  newPasswordRules: string | null
}

// Words that may mean a one-time code, in English and French, on a short or
// numeric field; so does the word code itself, as one word of a name.
const codeWords =
  /(?:verification|verify|authenticat|security[-_ ]?code|auth[-_ ]?code|passcode|code de s[ée]curit[ée]|token)/i

// Words that say so on their own, taken as whole words of the name.
const strongWords = new Set(['otp', 'totp', '2fa', 'tfa', 'mfa', 'onetime', 'twofactor', '2step'])
const strongPairs = new Set([
  'one time',
  'two factor',
  'verification code',
  'code verification',
  'authentication code',
  'auth code',
])
const wordBreak = /(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})|[^\p{L}\p{N}]+/u

// Codes these fields want aren't one-time codes.
const otherCodes = new RegExp(
  '(?:zip|postal|post[-_ ]?code|promo|coupon|voucher|discount|gift|referral|invite|invitation|country|area|phone|captcha|' +
    'card|cvv|cvc|security[-_ ]?question|pin[-_ ]?code|bar[-_ ]?code|qr|source[-_ ]?code|code[-_ ]?postal|parrainage|' +
    'recovery|backup|secours)',
  'i',
)

const newOnlyWords = new Set(['new', 'nouveau', 'nouvelle'])
const confirmWords = new Set(['confirm', 'confirmation', 'repeat', 'retype', 'confirmer'])
const searchWords = new Set(['search', 'query', 'recherche', 'rechercher'])

const codeTypes = new Set(['text', 'number', 'tel'])

const isInput = (field: FieldDescription) => field.tag === 'input'

/** The words of a name, lower case: `twoFactorCode` and `two_factor-code` are both two, factor, code. */
export function splitWords(words: string): string[] {
  return words
    .split(wordBreak)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase().replace(/é/g, 'e'))
}

const wordsOf = (field: FieldDescription) => field.words.join(' ')

/** Whether the words of a name say one-time code by a word that can mean nothing else. */
function saysOneTimeCode(split: string[]): boolean {
  if (split.some((word) => strongWords.has(word))) return true
  for (let i = 0; i + 1 < split.length; i++)
    if (strongPairs.has(`${split[i]} ${split[i + 1]}`)) return true
  for (let i = 0; i + 2 < split.length; i++)
    if (split[i] === 'code' && split[i + 1] === 'de' && split[i + 2] === 'verification') return true
  return false
}

const maxLengthOf = (field: FieldDescription) =>
  field.maxLength !== undefined && field.maxLength > 0 ? field.maxLength : -1

/** A text, number or phone field: not an email address or a password. */
function mayHoldACode(field: FieldDescription): boolean {
  return isInput(field) && codeTypes.has(field.type)
}

function looksLikeCode(field: FieldDescription): boolean {
  if (!mayHoldACode(field)) return false
  const words = wordsOf(field)
  if (otherCodes.test(words)) return false
  const split = splitWords(words)
  if (saysOneTimeCode(split)) return true
  const max = maxLengthOf(field)
  const short = max >= 1 && max <= 10
  const numeric = field.type === 'number' || field.type === 'tel' || field.inputMode === 'numeric'
  return (short || numeric) && (codeWords.test(words) || split.includes('code'))
}

/** One box of a row of one-character boxes, which a code is typed into a character at a time. */
function looksLikeBox(field: FieldDescription): boolean {
  return maxLengthOf(field) === 1 && mayHoldACode(field) && !otherCodes.test(wordsOf(field))
}

/** One field for the whole code, or a character in each of a row of one-character boxes. */
function fieldsOf(found: FieldDescription[]): CodeField[] {
  const boxes = found.filter((field) => maxLengthOf(field) === 1)
  if (boxes.length >= 4 && boxes.length <= 10)
    return boxes.map((field, character) => ({ id: field.id, character }))
  return [{ id: found[0].id, character: null }]
}

/**
 * The code fields of a frame: by `autocomplete="one-time-code"`, else a
 * narrow guess from what the field says, else a row of four to ten
 * one-character boxes. [manual] is a fill the person asked for on a field
 * (the right-click menu): with no code field found, that field is filled.
 */
export function findCodeFields(fields: FieldDescription[], manual = false): CodeField[] {
  const usable = fields.filter((field) => field.visible)
  const explicit = usable.filter((field) => field.autocomplete.includes('one-time-code'))
  const guessed = usable.filter((field) => !explicit.includes(field) && looksLikeCode(field))
  const boxes = usable.filter(
    (field) => !explicit.includes(field) && !guessed.includes(field) && looksLikeBox(field),
  )
  if (explicit.length > 0) return fieldsOf(explicit)
  if (guessed.length > 0) return fieldsOf(guessed)
  if (boxes.length >= 4 && boxes.length <= 10)
    return boxes.map((field, character) => ({ id: field.id, character }))
  const focused = usable.find((field) => field.focused)
  if (manual && focused !== undefined) return [{ id: focused.id, character: null }]
  return []
}

interface LoginCandidate {
  field: FieldDescription
  role: LoginRole | null
  outright: boolean
  confirmation: boolean
  current: boolean
}

/** What [field] is for on a login form, a text field that may be its username (role null), or null. */
function loginCandidate(field: FieldDescription): LoginCandidate | null {
  if (!isInput(field)) return null
  if (field.autocomplete.includes('one-time-code')) return null
  const split = splitWords(wordsOf(field))
  const confirms =
    split.some((word) => confirmWords.has(word)) && !split.some((word) => newOnlyWords.has(word))
  const saysNew = confirms || split.some((word) => newOnlyWords.has(word))
  const candidate = (
    role: LoginRole | null,
    outright: boolean,
    current = false,
  ): LoginCandidate => ({
    field,
    role,
    outright,
    confirmation: role === 'newPassword' && confirms,
    current,
  })
  if (field.autocomplete.includes('new-password')) return candidate('newPassword', true)
  if (field.autocomplete.includes('current-password')) return candidate('password', true, true)
  if (field.autocomplete.includes('username') || field.autocomplete.includes('email'))
    return candidate('username', true)
  if (field.type === 'password') return candidate(saysNew ? 'newPassword' : 'password', false)
  if (field.type === 'email') return candidate('username', false)
  // A plain text field may be the username before a password, unless it is a code or a search
  if (field.type !== 'text') return null
  if (split.some((word) => searchWords.has(word)) || looksLikeCode(field)) return null
  return candidate(null, false)
}

const nothing: LoginFields = {
  username: null,
  password: null,
  newPasswords: [],
  focused: null,
  newPasswordMaxLength: null,
  newPasswordRules: null,
}

/**
 * The login fields of a frame, by their autocomplete tokens, a password's
 * type, and words such as new and confirm beside a password. A username is
 * the field that says it is one, else the email or text field nearest before
 * the first password; a username alone counts only when the field says so
 * outright. Two passwords that say nothing are a new password and its
 * confirmation; three, the current one and the two new ones.
 */
export function findLoginFields(fields: FieldDescription[]): LoginFields {
  const candidates = fields
    .filter((field) => field.visible)
    .map(loginCandidate)
    .filter((candidate): candidate is LoginCandidate => candidate !== null)
  const focusedField = fields.find((field) => field.visible && field.focused)
  const roled = candidates.filter((candidate) => candidate.role !== null)
  const anchor =
    roled.find((c) => c.field === focusedField) ??
    roled.find((c) => c.role !== 'username') ??
    roled.find((c) => c.role === 'username' && c.outright)
  if (anchor === undefined) return nothing

  let passwords = candidates.filter((c) => c.role === 'password')
  let news = candidates.filter((c) => c.role === 'newPassword')
  // Passwords none of which says it is new: a sign-up form's two, or a change form's three
  if (news.length === 0 && passwords.length >= 2) {
    news = passwords.length === 2 ? passwords : passwords.slice(1)
    passwords = passwords.length === 2 ? [] : passwords.slice(0, 1)
  }
  // A sign-up form's password beside its confirmation is new too; a change form's current one says so
  if (
    passwords.length === 1 &&
    news.length > 0 &&
    news.every((c) => c.confirmation) &&
    !passwords[0].current
  ) {
    const beside = passwords[0]
    news = candidates.filter((c) => c === beside || news.includes(c))
    passwords = []
  }
  const firstPassword = candidates.findIndex((c) => passwords.includes(c) || news.includes(c))
  const before = firstPassword < 0 ? candidates : candidates.slice(0, firstPassword)
  const lastOf = (list: LoginCandidate[], test: (c: LoginCandidate) => boolean) =>
    [...list].reverse().find(test)
  const username =
    candidates.find((c) => c.role === 'username' && c.outright) ??
    (firstPassword >= 0 ? lastOf(before, (c) => c.role === 'username') : undefined) ??
    (firstPassword >= 0 ? lastOf(before, (c) => c.role === null) : undefined)

  const password = passwords[0]
  if (username === undefined && password === undefined && news.length === 0) return nothing
  let focused: LoginRole | null = null
  if (focusedField !== undefined) {
    if (username?.field === focusedField) focused = 'username'
    else if (password?.field === focusedField) focused = 'password'
    else if (news.some((c) => c.field === focusedField)) focused = 'newPassword'
  }
  const lengths = news.map((c) => maxLengthOf(c.field)).filter((length) => length > 0)
  const rules = news
    .map((c) => c.field.passwordRules)
    .find((r) => r !== undefined && r.trim() !== '')
  return {
    username: username?.field.id ?? null,
    password: password?.field.id ?? null,
    newPasswords: news.map((c) => c.field.id),
    focused,
    newPasswordMaxLength: lengths.length > 0 ? Math.min(...lengths) : null,
    newPasswordRules: rules ?? null,
  }
}
