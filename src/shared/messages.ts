// The messages the extension's parts send each other (design decision 4).
// Each part's messages are parsed into fresh objects of known fields, with
// their sizes bounded, so nothing a sender adds, like an address, reaches
// the background's handlers.
import type {
  ContentApi,
  ContentRequest,
  PageApi,
  PageRequest,
  SecondMethod,
  StepAnswer,
} from './api'

/** A field the content script found, by decision 7's rules. */
export type FieldKind = 'username' | 'password' | 'newPassword' | 'code'

export interface FieldReport {
  /** The content script's own name for the field, unique in its frame. */
  id: string
  kind: FieldKind
  /** For a code split across one-character boxes: how many (4 to 10). */
  boxes?: number
  /** The field's site rules (maxlength, minlength, passwordrules), for a new password. */
  rules?: string
}

/**
 * What a content script may ask. It never names a site: the background
 * answers for the frame the browser says sent it.
 */
export type ContentMessage = ContentRequest

/** What only the extension's own pages may ask. */
export type PageMessage = PageRequest

/** What the background sends one frame of a tab. */
export type ToContent =
  /**
   * `origin` is the frame's origin the background matched the item against: the content script
   * refuses to fill when its own origin is another (the page may have gone elsewhere since), and
   * answers `{ ok: false }`.
   */
  | { kind: 'fill'; fieldId: string; value: string; origin: string }
  /** Opens the menu on a field by itself (the code after the password, decision 9 still holds). */
  | { kind: 'openMenu'; fieldId: string }
  /** Locking closes every open Kemlock menu. */
  | { kind: 'closeMenus' }
  /** The right-click menu was used: which editable field was it opened on? */
  | { kind: 'contextTarget' }
  /** A form was sent and the next page has loaded: show "Save to Kemlock?" if one is due. */
  | { kind: 'savePrompt' }

/** What a frame answers `contextTarget` with: the field it registered, or null. */
export interface ContextTarget {
  fieldId: string
  kind: FieldKind
  boxes?: number
  rules?: string
}

export const fieldKinds: readonly FieldKind[] = ['username', 'password', 'newPassword', 'code']
const maxFields = 200
const maxIdLength = 64
const maxRulesLength = 512

/* ----------------------------------------------------------------------------------------------- */
/* Small parsers: each gives the value, or `bad`                                                     */
/* ----------------------------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const bad = Symbol('invalid')
type Bad = typeof bad
type Parser<T> = (value: unknown) => T | Bad

const text =
  (max: number, min = 0): Parser<string> =>
  (value) =>
    typeof value === 'string' && value.length >= min && value.length <= max ? value : bad
const id = text(128, 1)
const fieldId = text(maxIdLength, 1)
const bool: Parser<boolean> = (value) => (typeof value === 'boolean' ? value : bad)
const int =
  (min: number, max: number): Parser<number> =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? value
      : bad
const browserId = int(0, 2 ** 31 - 1)
const oneOf =
  <T extends string | number>(...allowed: readonly T[]): Parser<T> =>
  (value) =>
    allowed.includes(value as T) ? (value as T) : bad
const list =
  <T>(item: Parser<T>, max: number): Parser<T[]> =>
  (value) => {
    if (!Array.isArray(value) || value.length > max) return bad
    const out: T[] = []
    for (const element of value) {
      const parsed = item(element)
      if (parsed === bad) return bad
      out.push(parsed as T)
    }
    return out
  }
const nullable =
  <T>(item: Parser<T>): Parser<T | null> =>
  (value) =>
    value === null ? null : item(value)

interface Field {
  parse: Parser<unknown>
  optional: boolean
}
const req = (parse: Parser<unknown>): Field => ({ parse, optional: false })
const opt = (parse: Parser<unknown>): Field => ({ parse, optional: true })

/** A fresh object of the spec's fields only, or `bad` when one is missing or wrong. */
function shape<T>(raw: unknown, spec: Record<string, Field>): T | Bad {
  if (!isRecord(raw)) return bad
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(spec)) {
    const value = Object.hasOwn(raw, key) ? raw[key] : undefined
    if (value === undefined) {
      if (field.optional) continue
      return bad
    }
    const parsed = field.parse(value)
    if (parsed === bad) return bad
    out[key] = parsed
  }
  return out as T
}
const obj =
  <T>(spec: Record<string, Field>): Parser<T> =>
  (value) =>
    shape<T>(value, spec)

/* ----------------------------------------------------------------------------------------------- */
/* Values the requests carry                                                                         */
/* ----------------------------------------------------------------------------------------------- */

const password = text(4096)
const secondMethods: readonly SecondMethod[] = [
  'authenticator',
  'email',
  'yubikey',
  'securityKey',
  'duo',
  'apiKey',
]

const loginInput = obj({
  name: req(text(512)),
  username: req(text(1024)),
  password: req(password),
  websites: req(list(text(2048, 1), 50)),
  note: opt(text(20_000)),
  tags: opt(list(text(100, 1), 50)),
})

const generatorOptions = obj({
  mode: req(oneOf('random', 'passphrase')),
  length: opt(int(8, 128)),
  lowercase: opt(bool),
  uppercase: opt(bool),
  digits: opt(bool),
  symbols: opt(bool),
  words: opt(int(3, 20)),
  separator: opt(text(8)),
  capitalize: opt(bool),
  includeNumber: opt(bool),
  siteRules: opt(text(2000)),
  avoidLookAlikes: opt(bool),
})

const settingsPatch = obj({
  autoLockMinutes: opt(oneOf(1, 5, 15, 60)),
  lockOnSleep: opt(bool),
  codeAfterPassword: opt(bool),
  buttonsOnPages: opt(bool),
  breachedPasswords: opt(bool),
  offerToSave: opt(bool),
  clipboardSeconds: opt(oneOf(10, 30, 60, 120)),
})

const stepAnswer: Parser<StepAnswer> = (value) => {
  if (!isRecord(value)) return bad
  const spec = (step: string, fields: Record<string, Field>) =>
    shape<StepAnswer>(value, { step: req(oneOf(step)), ...fields })
  switch (value.step) {
    case 'second':
      return spec('second', {
        method: req(oneOf(...secondMethods)),
        code: req(text(2048)),
        remember: req(bool),
      })
    case 'securityKey':
      return spec('securityKey', { assertion: req(text(200_000)), remember: req(bool) })
    case 'approval':
      return spec('approval', { requestId: req(id) })
    case 'masterPassword':
      return spec('masterPassword', { password: req(password) })
    case 'homes':
      return spec('homes', { homeId: req(id) })
    case 'passphrase':
      return spec('passphrase', { passphrase: req(password) })
    case 'firstSync':
      return spec('firstSync', { go: req(bool) })
    default:
      return bad
  }
}

const anyText = text(2048, 1)
/** A server or folder address: https only, since the password goes to it (the setup tab says `insecure` for http). */
const address: Parser<string> = (value) => {
  const typed = anyText(value)
  if (typed === bad) return bad
  try {
    return new URL(typed).protocol === 'https:' ? typed : bad
  } catch {
    return bad
  }
}
const otpauth = text(4096, 1)

/** Each page request's arguments, as a spec. A method with none has `{}`. */
type PageSpecs = { [K in keyof PageApi]: Record<string, Field> }
const pageSpecs: PageSpecs = {
  popup: { tabId: opt(browserId) },
  createVault: { password: req(password) },
  unlock: { password: req(password) },
  lock: {},
  removeVault: {},
  codes: {},
  liveCodes: { ids: req(list(id, 500)) },
  nextHotp: { id: req(id) },
  logins: {},
  saveLogin: { id: req(nullable(id)), input: req(loginInput) },
  deleteLogin: { id: req(id) },
  ignoreHealth: { id: req(id), ignored: req(bool) },
  showPassword: { id: req(id) },
  backupCodes: {},
  health: {},
  generate: { options: req(generatorOptions) },
  recentPasswords: {},
  copy: {
    what: req(oneOf('username', 'password', 'code', 'backupCode', 'generated')),
    id: req(text(128)),
    value: opt(text(4096)),
  },
  fill: {
    tabId: req(browserId),
    frameId: opt(browserId),
    fieldId: opt(fieldId),
    loginId: opt(id),
    codeId: opt(id),
    newPassword: opt(text(1024, 1)),
    remember: opt(bool),
    picked: opt(bool),
  },
  addCodeFromLink: { otpauth: req(otpauth), website: opt(text(253, 1)), linkTo: opt(id) },
  addCodeFromTab: { tabId: req(browserId), linkTo: opt(id) },
  readCodeFromTab: { tabId: req(browserId) },
  linkCode: { codeId: req(id), loginId: req(nullable(id)) },
  nextCodes: { ids: req(list(id, 500)) },
  useBackupCode: { serviceId: req(id) },
  rememberedSites: { loginId: req(id) },
  forgetSite: { loginId: req(id), host: req(text(253, 1)) },
  syncStatus: {},
  signInKemlock: { server: req(address), email: req(text(320, 1)), password: req(password) },
  signInKemlockSso: { server: req(address), email: opt(text(320)) },
  signInKemlockPasskey: { server: req(address), email: opt(text(320)) },
  signInWebdav: { folder: req(address), username: req(text(1024)), password: req(password) },
  signInVaultwarden: { server: req(address), email: req(text(320, 1)), password: req(password) },
  answerStep: { answer: req(stepAnswer) },
  checkServer: { place: req(oneOf('kemlock', 'vaultwarden')), server: req(address) },
  securityKeyChallenge: {},
  syncNow: {},
  confirmRemovals: {},
  keepRemovals: {},
  signOut: {},
  settings: {},
  saveSettings: { settings: req(settingsPatch) },
  allSitesGranted: {},
  menu: { tabId: req(browserId), frameId: req(browserId), fieldId: req(fieldId) },
  pendingSave: { tabId: req(browserId) },
  answerSave: { tabId: req(browserId), save: req(bool), never: opt(bool) },
}

const fieldReport = obj<FieldReport>({
  id: req(fieldId),
  kind: req(oneOf(...fieldKinds)),
  boxes: opt(int(4, 10)),
  rules: opt(text(maxRulesLength)),
})

/** A field report, or `bad`: boxes belong to a code field only. */
function parseField(raw: unknown): FieldReport | Bad {
  const field = fieldReport(raw)
  if (field === bad) return bad
  if (field.boxes !== undefined && field.kind !== 'code') return bad
  return field
}

const contentSpecs: { [K in keyof ContentApi]: Record<string, Field> } = {
  fields: {
    fields: req((value) => {
      const fields = list(parseField, maxFields)(value)
      if (fields === bad) return bad
      return new Set(fields.map((field) => field.id)).size === fields.length ? fields : bad
    }),
  },
  sent: { username: req(text(1024)), password: req(password), newPassword: opt(password) },
  openMenu: { fieldId: req(fieldId) },
  frame: {},
}

const isKind = <S extends object>(specs: S, kind: unknown): kind is keyof S =>
  typeof kind === 'string' && Object.hasOwn(specs, kind)

/** A content script's message, or null when it isn't one. */
export function parseContentMessage(raw: unknown): ContentMessage | null {
  if (!isRecord(raw) || !isKind(contentSpecs, raw.kind)) return null
  const args = shape<object>(raw, contentSpecs[raw.kind])
  return args === bad ? null : ({ kind: raw.kind, ...args } as ContentMessage)
}

/** An extension page's message, or null when it isn't one. */
export function parsePageMessage(raw: unknown): PageMessage | null {
  if (!isRecord(raw) || !isKind(pageSpecs, raw.kind)) return null
  const args = shape<object>(raw, pageSpecs[raw.kind])
  return args === bad ? null : ({ kind: raw.kind, ...args } as PageMessage)
}

/** What a frame answered `contextTarget` with, or null when it isn't one. */
export function parseContextTarget(raw: unknown): ContextTarget | null {
  if (raw === null || raw === undefined) return null
  const target = shape<ContextTarget>(raw, {
    fieldId: req(fieldId),
    kind: req(oneOf(...fieldKinds)),
    boxes: opt(int(4, 10)),
    rules: opt(text(maxRulesLength)),
  })
  if (target === bad || (target.boxes !== undefined && target.kind !== 'code')) return null
  return target
}

/** Whether a frame said it could not fill (an answer that says nothing counts as filled). */
export function fillRefused(raw: unknown): boolean {
  return isRecord(raw) && raw.ok === false
}
