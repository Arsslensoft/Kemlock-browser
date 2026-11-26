// Property-based tests of the message parsers, which read what other parts (and a page's
// scripts, through the content script) send: they never throw, give null or a fresh object of
// known fields, and read back what a well-formed sender wrote.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fillRefused, parseContentMessage, parseContextTarget, parsePageMessage } from './messages'

const numRuns = 200

/* ----------------------------------------------------------------------------------------------- */
/* Arbitraries                                                                                       */
/* ----------------------------------------------------------------------------------------------- */

type Args = Record<string, unknown>
type Spec = fc.Arbitrary<Args>

/** Arbitrary JSON-ish and exotic values, with keys that name prototypes and the parsers' own fields. */
const hostileKey = fc.oneof(
  fc.constantFrom(
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'hasOwnProperty',
    'kind',
    'fields',
    'fieldId',
    'id',
    'boxes',
    'rules',
    'step',
    'ok',
  ),
  fc.string({ maxLength: 8 }),
)
const anything = fc.anything({
  key: hostileKey,
  maxDepth: 3,
  withBigInt: true,
  withBoxedValues: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withNullPrototype: true,
  withObjectString: true,
  withSparseArray: true,
})
const dictionary = fc.dictionary(hostileKey, anything, { maxKeys: 6 })

/** Short strings (the limits are far above), some of them any code point, lone surrogates too. */
const free = fc.string({ unit: 'binary', maxLength: 40 })
const short = (min = 0) => fc.string({ minLength: min, maxLength: 20 })
const browserId = fc.integer({ min: 0, max: 2 ** 31 - 1 })

/** An http or https address of at most 2048 characters. */
const address = fc.webUrl().filter((url) => url.length <= 2048)

/** A record with these required and optional fields. An optional one is left out or given. */
const rec = (
  required: Record<string, fc.Arbitrary<unknown>>,
  optional: Record<string, fc.Arbitrary<unknown>> = {},
): Spec => fc.record({ ...required, ...optional }, { requiredKeys: Object.keys(required) }) as Spec

const fieldKinds = ['username', 'password', 'newPassword', 'code'] as const
const fieldId = short(1)

/** A field report: boxes only on a code field, as the parser wants. */
const fieldReport = fc.oneof(
  rec(
    { id: fieldId, kind: fc.constantFrom('username', 'password', 'newPassword') },
    { rules: short() },
  ),
  rec(
    { id: fieldId, kind: fc.constant('code') },
    { boxes: fc.integer({ min: 4, max: 10 }), rules: short() },
  ),
)
/** A card's or an identity's field, with what it asks for and its block (docs/plans/add-items.md). */
const cardPart = fc.constantFrom(
  'cardName',
  'cardNumber',
  'cardExp',
  'cardExpMonth',
  'cardExpYear',
  'cardCsc',
  'cardType',
)
const identityPart = fc.constantFrom(
  'title',
  'fullName',
  'givenName',
  'middleName',
  'familyName',
  'company',
  'email',
  'phone',
  'birthDate',
  'birthDay',
  'birthMonth',
  'birthYear',
  'street',
  'line1',
  'line2',
  'line3',
  'city',
  'region',
  'postalCode',
  'country',
  'countryName',
)
const formReport = fc.oneof(
  rec(
    { id: fieldId, kind: fc.constant('card'), part: cardPart },
    { group: short(1), rules: short(), focus: fc.boolean() },
  ),
  rec(
    { id: fieldId, kind: fc.constant('identity'), part: identityPart },
    { group: short(1), rules: short() },
  ),
)
const fieldReports = fc.uniqueArray(fc.oneof(fieldReport, formReport), {
  maxLength: 8,
  selector: (field) => field.id,
}) as fc.Arbitrary<Args[]>

const contentArgs: Record<string, Spec> = {
  fields: fieldReports.map((fields) => ({ fields })),
  sent: rec({ username: free, password: free }, { newPassword: free }),
  openMenu: rec({ fieldId }),
  frame: rec({}),
  identitySent: rec({
    given: short(),
    family: short(),
    full: short(),
    email: short(),
    phone: short(),
    company: short(),
    line1: short(),
    city: short(),
    postalCode: short(),
    country: short(),
  }),
  cardSent: rec({
    number: short(),
    holder: short(),
    expiry: short(),
    month: short(),
    year: short(),
    code: fc.string({ maxLength: 16 }),
  }),
}

// Added by item format: an item is named by its kind and an entry id; a field row and a website rule
const itemKinds = [
  'login',
  'note',
  'file',
  'otp',
  'backup-codes',
  'card',
  'identity',
  'contact',
  'ssh-key',
  'pgp-key',
  'certificate',
  'passkey',
  'key',
  'key-otp',
] as const
const itemRef = rec({ kind: fc.constantFrom(...itemKinds), id: short(1) })
const fieldRow = rec(
  { name: short(), kind: fc.constantFrom('text', 'hidden', 'boolean') },
  {
    origin: fc.integer({ min: 0, max: 99 }),
    value: free,
    keepValue: fc.constant(true),
    adminField: short(1),
  },
)
const siteRule = rec({
  uri: short(1),
  match: fc.constantFrom('default', 'domain', 'host', 'startsWith', 'exact', 'regex', 'never'),
})
const itemExtras = {
  fields: fc.array(fieldRow, { maxLength: 4 }),
  links: fc.array(itemRef, { maxLength: 4 }),
}
const stagedFile = rec({ handle: short(1), name: short(1) }, { type: short() })
const base64 = fc.stringMatching(/^[A-Za-z0-9+/]{0,200}$/)

const loginInput = rec(
  { name: free, username: free, password: free, websites: fc.array(short(1), { maxLength: 4 }) },
  {
    note: free,
    tags: fc.array(short(1), { maxLength: 4 }),
    websiteRules: fc.array(siteRule, { maxLength: 4 }),
    ...itemExtras,
  },
)
const generatorOptions = rec(
  { mode: fc.constantFrom('random', 'passphrase') },
  {
    length: fc.integer({ min: 8, max: 128 }),
    lowercase: fc.boolean(),
    uppercase: fc.boolean(),
    digits: fc.boolean(),
    symbols: fc.boolean(),
    words: fc.integer({ min: 3, max: 20 }),
    separator: fc.string({ maxLength: 8 }),
    capitalize: fc.boolean(),
    includeNumber: fc.boolean(),
    siteRules: free,
    avoidLookAlikes: fc.boolean(),
  },
)
const settingsPatch = rec(
  {},
  {
    autoLockMinutes: fc.constantFrom(1, 5, 15, 60),
    lockOnSleep: fc.boolean(),
    codeAfterPassword: fc.boolean(),
    buttonsOnPages: fc.boolean(),
    breachedPasswords: fc.boolean(),
    offerToSave: fc.boolean(),
    clipboardSeconds: fc.constantFrom(10, 30, 60, 120),
  },
)
const stepAnswer = fc.oneof(
  rec({
    step: fc.constant('second'),
    method: fc.constantFrom(
      'authenticator',
      'email',
      'yubikey',
      'securityKey',
      'duo',
      'apiKey',
      'recoveryCode',
    ),
    code: free,
    remember: fc.boolean(),
  }),
  rec({ step: fc.constant('securityKey'), assertion: free, remember: fc.boolean() }),
  rec({ step: fc.constant('approval'), requestId: short(1) }),
  rec({ step: fc.constant('masterPassword'), password: free }),
  rec({ step: fc.constant('homes'), homeId: short(1) }),
  rec({ step: fc.constant('passphrase'), passphrase: free }),
  rec({ step: fc.constant('firstSync'), go: fc.boolean() }),
  rec({ step: fc.constant('recoveryKit'), pieces: fc.array(short(1), { maxLength: 3 }) }),
)
const ids = fc.array(short(1), { maxLength: 4 })

// Added by unlock: a credential's id and a 32-byte PRF output, base64url
const credentialId = fc.stringMatching(/^[A-Za-z0-9_-]{1,100}$/)
const prfOutput = fc.stringMatching(/^[A-Za-z0-9_-]{43}$/)
const noteInput = rec(
  { title: free, text: free },
  { pinned: fc.boolean(), tags: fc.array(short(1), { maxLength: 4 }), ...itemExtras },
)
const cardInput = rec(
  { name: free },
  {
    cardholder: free,
    number: short(),
    brand: short(),
    expMonth: fc.integer({ min: 1, max: 12 }),
    expYear: fc.integer({ min: 0, max: 9999 }),
    code: fc.string({ maxLength: 16 }),
    pin: fc.string({ maxLength: 16 }),
    validFromMonth: fc.integer({ min: 1, max: 12 }),
    validFromYear: fc.integer({ min: 0, max: 9999 }),
    note: free,
    tags: fc.array(short(1), { maxLength: 4 }),
    pinned: fc.boolean(),
    fromAutofill: fc.boolean(),
    ...itemExtras,
  },
)
const identityInput = rec(
  { name: free },
  {
    title: short(),
    givenName: short(),
    familyName: short(),
    email: short(),
    phone: short(),
    birthDate: short(),
    address: rec(
      {},
      { lines: fc.array(short(), { maxLength: 3 }), city: short(), country: short() },
    ),
    documents: fc.array(
      rec({ type: short(1), number: short(1) }, { id: short(1), expiresOn: short() }),
      {
        maxLength: 3,
      },
    ),
    note: free,
    pinned: fc.boolean(),
    ...itemExtras,
  },
)

/** Every page request's arguments, by kind: what a well-formed page sends. */
const pageArgs: Record<string, Spec> = {
  popup: rec({}, { tabId: browserId }),
  createVault: rec({ password: free }),
  unlock: rec({ password: free }),
  lock: rec({}),
  removeVault: rec({}),
  codes: rec({}),
  liveCodes: rec({ ids }),
  nextHotp: rec({ id: short(1) }),
  logins: rec({}),
  saveLogin: rec({ id: fc.option(short(1), { nil: null }), input: loginInput }),
  deleteLogin: rec({ id: short(1) }),
  ignoreHealth: rec({ id: short(1), ignored: fc.boolean() }),
  showPassword: rec({ id: short(1) }),
  backupCodes: rec({}),
  health: rec({}),
  generate: rec({ options: generatorOptions }),
  recentPasswords: rec({}),
  copy: rec(
    {
      what: fc.constantFrom('username', 'password', 'code', 'backupCode', 'generated'),
      id: short(),
    },
    { value: free },
  ),
  fill: rec(
    { tabId: browserId },
    {
      frameId: browserId,
      fieldId,
      loginId: short(1),
      codeId: short(1),
      newPassword: short(1),
      remember: fc.boolean(),
      picked: fc.boolean(),
    },
  ),
  addCodeFromLink: rec({ otpauth: short(1) }, { website: short(1), linkTo: short(1) }),
  addCodeFromTab: rec({ tabId: browserId }, { linkTo: short(1) }),
  readCodeFromTab: rec({ tabId: browserId }),
  linkCode: rec({ codeId: short(1), loginId: fc.option(short(1), { nil: null }) }),
  nextCodes: rec({ ids }),
  useBackupCode: rec({ serviceId: short(1) }),
  rememberedSites: rec({ loginId: short(1) }),
  forgetSite: rec({ loginId: short(1), host: short(1) }),
  syncStatus: rec({}),
  signInKemlock: rec({ server: address, email: short(1), password: free }),
  signInKemlockSso: rec({ server: address }, { email: short() }),
  signInKemlockPasskey: rec({ server: address }, { email: short() }),
  signInWebdav: rec({ folder: address, username: free, password: free }),
  signInVaultwarden: rec({ server: address, email: short(1), password: free }),
  answerStep: rec({ answer: stepAnswer }),
  checkServer: rec({ place: fc.constantFrom('kemlock', 'vaultwarden'), server: address }),
  securityKeyChallenge: rec({}),
  syncNow: rec({}),
  confirmRemovals: rec({}),
  keepRemovals: rec({}),
  signOut: rec({}),
  settings: rec({}),
  saveSettings: rec({ settings: settingsPatch }),
  allSitesGranted: rec({}),
  menu: rec({ tabId: browserId, frameId: browserId, fieldId }),
  pendingSave: rec({ tabId: browserId }),
  // Added by unlock (begin)
  passkeyUnlockInfo: rec({}),
  passkeyUnlockPrepare: rec({}),
  addPasskeyUnlock: rec(
    { name: short(1), password: free, credentialId, prfOutput },
    {
      rpId: short(1),
      attachment: fc.constantFrom('platform', 'cross-platform'),
      transports: fc.array(short(1), { maxLength: 4 }),
    },
  ),
  renamePasskeyUnlock: rec({ id: short(1), name: short(1) }),
  removePasskeyUnlock: rec({ id: short(1) }),
  unlockWithPasskey: rec({ credentialId, prfOutput }),
  // Added by unlock (end)
  account: rec({
    request: fc.constantFrom(
      { op: 'devices' },
      { op: 'approve', id: 'request-1' },
      { op: 'emergencyInvite', email: 'a@b.c', kind: 'view', waitDays: 7 },
    ),
  }),
  answerSave: rec(
    { tabId: browserId, save: fc.boolean() },
    { never: fc.boolean(), card: fc.boolean(), identity: fc.boolean() },
  ),
  notes: rec({}),
  revealNote: rec({ id: short(1) }),
  saveNote: rec({ id: fc.option(short(1), { nil: null }), input: noteInput }),
  deleteNote: rec({ id: short(1) }),
  cards: rec({}),
  revealCard: rec({ id: short(1) }),
  saveCard: rec({ id: fc.option(short(1), { nil: null }), input: cardInput }),
  deleteCard: rec({ id: short(1) }),
  identities: rec({}),
  revealIdentity: rec({ id: short(1) }),
  saveIdentity: rec({ id: fc.option(short(1), { nil: null }), input: identityInput }),
  deleteIdentity: rec({ id: short(1) }),
  showSecret: rec(
    { what: fc.constantFrom('cardNumber', 'cardCode', 'cardPin', 'documentNumber'), id: short(1) },
    { documentId: short(1) },
  ),
  // Added by item format (begin)
  customFieldDefs: rec({}, { refresh: fc.boolean() }),
  revealField: rec({ ref: itemRef, index: fc.integer({ min: 0, max: 9999 }) }),
  revealFields: rec({ ref: itemRef }),
  linkedItems: rec({ ref: itemRef }),
  linkCandidates: rec({ ref: fc.option(itemRef, { nil: null }), query: short() }),
  setLinks: rec({ ref: itemRef, refs: fc.array(itemRef, { maxLength: 4 }) }),
  saveCode: rec({
    id: short(1),
    input: rec(
      {},
      {
        name: short(),
        websites: fc.array(short(1), { maxLength: 4 }),
        note: free,
        pinned: fc.boolean(),
        ...itemExtras,
      },
    ),
  }),
  saveBackupCodes: rec({
    serviceId: short(1),
    input: rec(
      {},
      { name: short(), websites: fc.array(short(1), { maxLength: 4 }), note: free, ...itemExtras },
    ),
  }),
  files: rec({}),
  revealFile: rec({ id: short(1) }),
  deleteFile: rec({ id: short(1) }),
  saveFile: rec({
    id: fc.option(short(1), { nil: null }),
    input: rec(
      { name: short() },
      {
        notes: free,
        pinned: fc.boolean(),
        tags: fc.array(short(1), { maxLength: 4 }),
        links: fc.array(itemRef, { maxLength: 4 }),
        staged: stagedFile,
      },
    ),
  }),
  stageItemFile: rec({ data: base64 }, { handle: short(1) }),
  releaseStaged: rec({ handle: short(1) }),
  addAttachments: rec({ noteId: short(1), files: fc.array(stagedFile, { maxLength: 4 }) }),
  removeAttachment: rec({ noteId: short(1), attachmentId: short(1) }),
  openItemFile: rec({ ref: itemRef }, { attachmentId: short(1) }),
  readOpened: rec({ handle: short(1), index: fc.integer({ min: 0, max: 100 }) }),
  closeOpened: rec({ handle: short(1) }),
  // Added by item format (end)
}

const contextTarget = fc.oneof(
  rec(
    { fieldId, kind: fc.constantFrom('username', 'password', 'newPassword') },
    { rules: short() },
  ),
  rec(
    { fieldId, kind: fc.constant('code') },
    { boxes: fc.integer({ min: 4, max: 10 }), rules: short() },
  ),
)

/** A well-formed message of one of the kinds, from the table of that parser's. */
const messageOf = (table: Record<string, Spec>) =>
  fc
    .constantFrom(...Object.keys(table))
    .chain((kind) => table[kind].map((args): Args => ({ kind, ...args })))

/** A message of a known kind with arguments that may be anything. */
const garbageOf = (table: Record<string, Spec>) =>
  fc
    .tuple(fc.constantFrom(...Object.keys(table)), dictionary)
    .map(([kind, rest]): Args => ({ ...rest, kind }))

/** Extra properties a sender may add: none of the message's own names. */
const extrasFor = (names: Iterable<string>) => {
  const known = new Set([...names, 'kind'])
  return fc
    .dictionary(
      fc.oneof(
        fc.constantFrom('__proto__', 'constructor', 'origin', 'url', 'host'),
        short(1).map((key) => `x-${key}`),
      ),
      anything,
      { maxKeys: 4 },
    )
    .map((extra) => Object.fromEntries(Object.entries(extra).filter(([key]) => !known.has(key))))
}

/** The property names a message may keep, by kind: those of its arguments' table, plus the kind. */
const keysOf = (message: Args) => Object.keys(message)

/** Nothing the parsers read may have added to what every object inherits. */
const prototypeIsClean = () => Object.keys(Object.prototype).length === 0

describe('parseContentMessage', () => {
  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.oneof(anything, garbageOf(contentArgs)), (raw) => {
        const parsed = parseContentMessage(raw)
        expect(parsed === null || typeof parsed === 'object').toBe(true)
      }),
      { numRuns },
    )
  })

  it('refuses a kind that is not one of its own, the prototype names included', () => {
    const names = Object.getOwnPropertyNames(Object.prototype)
    fc.assert(
      fc.property(
        fc.constantFrom(...names, 'FIELDS', ' fields', 'fields '),
        dictionary,
        (kind, rest) => {
          expect(parseContentMessage({ ...rest, kind })).toBeNull()
        },
      ),
      { numRuns },
    )
  })

  it('gives null or a fresh object of its kind with the known fields only', () => {
    fc.assert(
      fc.property(garbageOf(contentArgs), (raw) => {
        const parsed = parseContentMessage(raw)
        if (parsed === null) return
        expect(parsed).not.toBe(raw)
        expect(parsed.kind).toBe(raw.kind)
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
        expect(Object.hasOwn(parsed, '__proto__')).toBe(false)
        expect(parseContentMessage(parsed)).toEqual(parsed)
      }),
      { numRuns },
    )
  })

  it('reads back a well-formed message, and drops what a sender adds', () => {
    fc.assert(
      fc.property(
        messageOf(contentArgs).chain((message) =>
          extrasFor(keysOf(message)).map((extra) => ({ message, extra })),
        ),
        ({ message, extra }) => {
          expect(parseContentMessage(message)).toEqual(message)
          const sent = parseContentMessage({ ...extra, ...message })
          expect(sent).toEqual(message)
          expect(Object.keys(sent as object).sort()).toEqual(Object.keys(message).sort())
        },
      ),
      { numRuns },
    )
  })

  it('keeps nothing of a field report but its known fields', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fieldReport, { minLength: 1, maxLength: 6, selector: (f) => f.id }),
        fc.dictionary(fc.constantFrom('label', 'name', 'origin', 'url', 'value'), free),
        (fields, extra) => {
          const sent = { kind: 'fields', fields: fields.map((field) => ({ ...extra, ...field })) }
          const parsed = parseContentMessage(sent) as { fields: Args[] } | null
          expect(parsed).toEqual({ kind: 'fields', fields })
          parsed?.fields.forEach((field, i) => expect(field).not.toBe(sent.fields[i]))
        },
      ),
      { numRuns },
    )
  })

  it('refuses field reports that break a rule: a repeated id, boxes on a non-code field, a size', () => {
    fc.assert(
      fc.property(
        fieldReport,
        fc.constantFrom('username', 'password', 'newPassword'),
        fc.integer({ min: 4, max: 10 }),
        (field, kind, boxes) => {
          expect(parseContentMessage({ kind: 'fields', fields: [field, field] })).toBeNull()
          expect(
            parseContentMessage({ kind: 'fields', fields: [{ id: 'a', kind, boxes }] }),
          ).toBeNull()
          expect(
            parseContentMessage({ kind: 'fields', fields: [{ id: 'a'.repeat(65), kind }] }),
          ).toBeNull()
          expect(
            parseContentMessage({
              kind: 'fields',
              fields: [{ id: 'a', kind: 'code', boxes: boxes + 7 }],
            }),
          ).toBeNull()
          expect(
            parseContentMessage({
              kind: 'fields',
              fields: [{ id: 'a', kind: 'code', boxes: boxes + 0.5 }],
            }),
          ).toBeNull()
        },
      ),
      { numRuns },
    )
  })

  it('is not changed by a prototype-pollution key in the message', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value)
        for (const text of [
          `{"kind":"openMenu","fieldId":"a","__proto__":${json}}`,
          `{"__proto__":${json},"kind":"sent","username":"u","password":"p"}`,
          `{"kind":"openMenu","fieldId":"a","constructor":${json}}`,
          `{"kind":"fields","fields":[{"id":"a","kind":"code","__proto__":${json}}]}`,
        ]) {
          const parsed = parseContentMessage(JSON.parse(text))
          expect(parsed).not.toBeNull()
          expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
          expect(Object.hasOwn(parsed as object, '__proto__')).toBe(false)
          expect(Object.hasOwn(parsed as object, 'constructor')).toBe(false)
          expect(prototypeIsClean()).toBe(true)
        }
      }),
      { numRuns },
    )
  })
})

describe('parsePageMessage', () => {
  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.oneof(anything, garbageOf(pageArgs)), (raw) => {
        const parsed = parsePageMessage(raw)
        expect(parsed === null || typeof parsed === 'object').toBe(true)
      }),
      { numRuns },
    )
  })

  it('refuses a kind that is not one of its own, the prototype names included', () => {
    const names = Object.getOwnPropertyNames(Object.prototype)
    fc.assert(
      fc.property(fc.constantFrom(...names, 'Lock', ' lock', 'lock '), dictionary, (kind, rest) => {
        expect(parsePageMessage({ ...rest, kind })).toBeNull()
      }),
      { numRuns },
    )
  })

  it('gives null or a fresh object of its kind that reads back as itself', () => {
    fc.assert(
      fc.property(garbageOf(pageArgs), (raw) => {
        const parsed = parsePageMessage(raw)
        if (parsed === null) return
        expect(parsed).not.toBe(raw)
        expect(parsed.kind).toBe(raw.kind)
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
        expect(Object.hasOwn(parsed, '__proto__')).toBe(false)
        expect(parsePageMessage(parsed)).toEqual(parsed)
      }),
      { numRuns },
    )
  })

  it('reads back a well-formed message of every kind', () => {
    fc.assert(
      fc.property(messageOf(pageArgs), (message) => {
        expect(parsePageMessage(message)).toEqual(message)
      }),
      { numRuns: 1000 },
    )
  })

  it('drops what a sender adds', () => {
    fc.assert(
      fc.property(
        messageOf(pageArgs).chain((message) =>
          extrasFor(keysOf(message)).map((extra) => ({ message, extra })),
        ),
        ({ message, extra }) => {
          const parsed = parsePageMessage({ ...extra, ...message })
          expect(parsed).toEqual(message)
          expect(Object.keys(parsed as object).sort()).toEqual(Object.keys(message).sort())
        },
      ),
      { numRuns },
    )
  })

  it('refuses an address that is not http or https', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ftp', 'file', 'javascript', 'data', 'chrome-extension', 'ws'),
        short(1),
        (scheme, rest) => {
          const server = `${scheme}://${rest}`
          expect(parsePageMessage({ kind: 'checkServer', place: 'kemlock', server })).toBeNull()
          expect(
            parsePageMessage({ kind: 'signInKemlock', server, email: 'a@b.c', password: 'p' }),
          ).toBeNull()
        },
      ),
      { numRuns },
    )
  })

  it('is not changed by a prototype-pollution key in the message', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value)
        for (const text of [
          `{"kind":"lock","__proto__":${json}}`,
          `{"__proto__":${json},"kind":"unlock","password":"p"}`,
          `{"kind":"answerStep","answer":{"step":"firstSync","go":true,"__proto__":${json}}}`,
          `{"kind":"saveSettings","settings":{"lockOnSleep":true,"__proto__":${json},"constructor":${json}}}`,
        ]) {
          const parsed = parsePageMessage(JSON.parse(text))
          expect(parsed).not.toBeNull()
          expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
          expect(Object.hasOwn(parsed as object, '__proto__')).toBe(false)
          expect(prototypeIsClean()).toBe(true)
        }
      }),
      { numRuns },
    )
  })
})

describe('parseContextTarget', () => {
  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(anything, (raw) => {
        const parsed = parseContextTarget(raw)
        expect(parsed === null || typeof parsed === 'object').toBe(true)
      }),
      { numRuns },
    )
  })

  it('answers null for no answer', () => {
    expect(parseContextTarget(null)).toBeNull()
    expect(parseContextTarget(undefined)).toBeNull()
  })

  it('reads back a well-formed target, and drops what a frame adds', () => {
    fc.assert(
      fc.property(
        contextTarget.chain((target) =>
          extrasFor(Object.keys(target)).map((extra) => ({ target, extra })),
        ),
        ({ target, extra }) => {
          expect(parseContextTarget(target)).toEqual(target)
          const parsed = parseContextTarget({ ...extra, ...target })
          expect(parsed).toEqual(target)
          expect(parsed).not.toBe(target)
          expect(Object.keys(parsed as object).sort()).toEqual(Object.keys(target).sort())
        },
      ),
      { numRuns },
    )
  })

  it('refuses boxes on a field that is not a code, and a target that is no object', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('username', 'password', 'newPassword'),
        fc.integer({ min: 4, max: 10 }),
        (kind, boxes) => {
          expect(parseContextTarget({ fieldId: 'a', kind, boxes })).toBeNull()
        },
      ),
      { numRuns },
    )
    fc.assert(
      fc.property(
        anything.filter((value) => typeof value !== 'object' || Array.isArray(value)),
        (raw) => {
          if (raw === undefined) return
          expect(parseContextTarget(raw)).toBeNull()
        },
      ),
      { numRuns },
    )
  })

  it('is not changed by a prototype-pollution key', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value)
        const parsed = parseContextTarget(
          JSON.parse(`{"fieldId":"a","kind":"code","__proto__":${json},"constructor":${json}}`),
        )
        expect(parsed).toEqual({ fieldId: 'a', kind: 'code' })
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
        expect(prototypeIsClean()).toBe(true)
      }),
      { numRuns },
    )
  })

  it('keeps the field kinds it knows only', () => {
    fc.assert(
      fc.property(
        fc.string().filter((kind) => !(fieldKinds as readonly string[]).includes(kind)),
        (kind) => {
          expect(parseContextTarget({ fieldId: 'a', kind })).toBeNull()
        },
      ),
      { numRuns },
    )
  })
})

describe('fillRefused', () => {
  it('never throws, and is false for anything that is not an object', () => {
    fc.assert(
      fc.property(anything, (raw) => {
        const refused = fillRefused(raw)
        expect(typeof refused).toBe('boolean')
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
          expect(refused).toBe(false)
      }),
      { numRuns },
    )
  })

  it('is true when the answer says ok is false, whatever else it says', () => {
    fc.assert(
      fc.property(dictionary, (rest) => {
        expect(fillRefused({ ...rest, ok: false })).toBe(true)
      }),
      { numRuns },
    )
  })

  it('is false for an answer that says ok is anything else, or nothing', () => {
    fc.assert(
      fc.property(
        dictionary,
        anything.filter((ok) => ok !== false),
        (rest, ok) => {
          expect(fillRefused({ ...rest, ok })).toBe(false)
          const { ok: _ok, ...without } = rest
          expect(fillRefused(without)).toBe(false)
        },
      ),
      { numRuns },
    )
  })

  it('is false for an array, even one with an ok property', () => {
    fc.assert(
      fc.property(fc.array(anything, { maxLength: 4 }), (list) => {
        expect(fillRefused(Object.assign(list, { ok: false }))).toBe(false)
      }),
      { numRuns },
    )
  })
})
