// Property-based tests of the field rules, which read what a page says of its own fields (names,
// ids, placeholders, labels): they never throw, change nothing they are given, and name only
// fields that were given them.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { findCodeFields, findLoginFields, splitWords, type FieldDescription } from './fields'

const numRuns = 200

/** Words a field may say of itself: the ones the rules look for, and anything at all. */
const word = fc.oneof(
  fc.constantFrom(
    'otp',
    'code',
    'verification code',
    'twoFactorCode',
    'two_factor-code',
    'Code de sécurité',
    'token',
    'new password',
    'confirm',
    'repeat',
    'search',
    'zip',
    'postal code',
    'username',
    'email',
    'password',
    'İstanbul',
    'ÉCOLE',
  ),
  fc.string({ maxLength: 20 }),
  fc.string({ unit: 'binary', maxLength: 20 }),
)

const description = fc.record(
  {
    id: fc.string({ minLength: 1, maxLength: 12 }),
    tag: fc.constantFrom('input', 'input', 'input', 'textarea', 'select', 'button'),
    type: fc.constantFrom('text', 'password', 'email', 'number', 'tel', 'search', 'hidden', 'url'),
    autocomplete: fc.array(
      fc.constantFrom(
        'one-time-code',
        'new-password',
        'current-password',
        'username',
        'email',
        'off',
        'on',
      ),
      { maxLength: 3 },
    ),
    inputMode: fc.constantFrom('numeric', 'text', 'none', 'tel'),
    maxLength: fc.integer({ min: -2, max: 300 }),
    words: fc.array(word, { maxLength: 4 }),
    passwordRules: fc.oneof(
      fc.constantFrom('', '   ', 'minlength: 8; maxlength: 16', 'required: lower'),
      fc.string({ maxLength: 20 }),
    ),
    visible: fc.boolean(),
    focused: fc.boolean(),
  },
  {
    requiredKeys: ['id', 'tag', 'type', 'autocomplete', 'words', 'visible', 'focused'],
  },
) as fc.Arbitrary<FieldDescription>

/** The fields of a frame, each with a name of its own, as dom.ts gives them. */
const fieldList = fc.uniqueArray(description, { maxLength: 12, selector: (field) => field.id })

const visible = (fields: FieldDescription[]) => fields.filter((field) => field.visible)
const idsOf = (fields: FieldDescription[]) => new Set(fields.map((field) => field.id))

describe('splitWords', () => {
  it('never throws, and gives words with something in them, lower case, with no space', () => {
    for (const unit of ['grapheme-ascii', 'binary'] as const) {
      fc.assert(
        fc.property(fc.string({ unit, maxLength: 60 }), (name) => {
          for (const part of splitWords(name)) {
            expect(part.length).toBeGreaterThan(0)
            expect(part).not.toMatch(/\s/)
            expect(part).not.toContain('é')
          }
        }),
        { numRuns },
      )
    }
  })

  it('splits two names apart at a space, so the words of both are those of each', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 30 }),
        fc.string({ unit: 'binary', maxLength: 30 }),
        (a, b) => {
          expect(splitWords(`${a} ${b}`)).toEqual([...splitWords(a), ...splitWords(b)])
        },
      ),
      { numRuns },
    )
  })

  it('breaks a name on its separators and its capitals', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{2,6}$/), { minLength: 1, maxLength: 4 }),
        fc.constantFrom('_', '-', ' ', '.', '  ', '__'),
        (parts, separator) => {
          expect(splitWords(parts.join(separator))).toEqual(parts)
          const camel = parts.map((part, i) =>
            i === 0 ? part : part[0].toUpperCase() + part.slice(1),
          )
          expect(splitWords(camel.join(''))).toEqual(parts)
        },
      ),
      { numRuns },
    )
  })
})

describe('findCodeFields', () => {
  it('never throws, changes nothing it is given, and says the same twice', () => {
    fc.assert(
      fc.property(fieldList, fc.boolean(), (fields, manual) => {
        const before = structuredClone(fields)
        const found = findCodeFields(fields, manual)
        expect(fields).toEqual(before)
        expect(findCodeFields(fields, manual)).toEqual(found)
      }),
      { numRuns },
    )
  })

  it('names only the visible fields it was given, each once', () => {
    fc.assert(
      fc.property(fieldList, fc.boolean(), (fields, manual) => {
        const given = idsOf(visible(fields))
        const found = findCodeFields(fields, manual)
        const named = found.map((field) => field.id)
        expect(new Set(named).size).toBe(named.length)
        for (const id of named) expect(given.has(id)).toBe(true)
      }),
      { numRuns },
    )
  })

  it('gives one field for the whole code, or four to ten characters in order', () => {
    fc.assert(
      fc.property(fieldList, fc.boolean(), (fields, manual) => {
        const found = findCodeFields(fields, manual)
        if (found.length === 0) return
        if (found.length === 1 && found[0].character === null) return
        expect(found.length).toBeGreaterThanOrEqual(4)
        expect(found.length).toBeLessThanOrEqual(10)
        expect(found.map((field) => field.character)).toEqual(found.map((_, i) => i))
      }),
      { numRuns },
    )
  })

  it('judges the visible fields only', () => {
    fc.assert(
      fc.property(fieldList, fc.boolean(), (fields, manual) => {
        expect(findCodeFields(fields, manual)).toEqual(findCodeFields(visible(fields), manual))
        expect(
          findCodeFields(
            fields.map((field) => ({ ...field, visible: false })),
            manual,
          ),
        ).toEqual([])
      }),
      { numRuns },
    )
  })

  it('answers a field that says one-time-code, and only those that do', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        const explicit = visible(fields).filter((field) =>
          field.autocomplete.includes('one-time-code'),
        )
        if (explicit.length === 0) return
        const found = findCodeFields(fields)
        expect(found.length).toBeGreaterThan(0)
        const said = idsOf(explicit)
        for (const field of found) expect(said.has(field.id)).toBe(true)
      }),
      { numRuns },
    )
  })

  it('answers a lone one-time-code field of any kind with the whole code', () => {
    fc.assert(
      fc.property(description, (field) => {
        const lone = { ...field, visible: true, autocomplete: ['one-time-code'] }
        expect(findCodeFields([lone])).toEqual([{ id: lone.id, character: null }])
      }),
      { numRuns },
    )
  })

  it('only adds the field the person is in when asked to, and only when it found nothing', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        const found = findCodeFields(fields)
        const manual = findCodeFields(fields, true)
        if (found.length > 0) {
          expect(manual).toEqual(found)
          return
        }
        const focused = visible(fields).find((field) => field.focused)
        expect(manual).toEqual(focused === undefined ? [] : [{ id: focused.id, character: null }])
      }),
      { numRuns },
    )
  })
})

describe('findLoginFields', () => {
  it('never throws, changes nothing it is given, and says the same twice', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        const before = structuredClone(fields)
        const found = findLoginFields(fields)
        expect(fields).toEqual(before)
        expect(findLoginFields(fields)).toEqual(found)
      }),
      { numRuns },
    )
  })

  it('names only the visible input fields it was given, and none for a code, each in one role', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        const usable = visible(fields).filter(
          (field) => field.tag === 'input' && !field.autocomplete.includes('one-time-code'),
        )
        const given = idsOf(usable)
        const found = findLoginFields(fields)
        const named = [
          ...(found.username === null ? [] : [found.username]),
          ...(found.password === null ? [] : [found.password]),
          ...found.newPasswords,
        ]
        expect(new Set(named).size).toBe(named.length)
        for (const id of named) expect(given.has(id)).toBe(true)
      }),
      { numRuns },
    )
  })

  it('judges the visible fields only', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        expect(findLoginFields(fields)).toEqual(findLoginFields(visible(fields)))
        expect(findLoginFields(fields.map((field) => ({ ...field, visible: false })))).toEqual(
          findLoginFields([]),
        )
      }),
      { numRuns },
    )
  })

  it('says a field is the one the person is in only when it is, and says so when it is', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        const found = findLoginFields(fields)
        const inside = visible(fields).find((field) => field.focused)
        const roleOf = (id: string | undefined) =>
          id === undefined
            ? null
            : id === found.username
              ? 'username'
              : id === found.password
                ? 'password'
                : found.newPasswords.includes(id)
                  ? 'newPassword'
                  : null
        expect(found.focused).toBe(roleOf(inside?.id))
      }),
      { numRuns },
    )
  })

  it('reads the new password fields', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        const found = findLoginFields(fields)
        const news = found.newPasswords.map((id) => fields.find((field) => field.id === id))
        const lengths = news.flatMap((field) =>
          field?.maxLength !== undefined && field.maxLength > 0 ? [field.maxLength] : [],
        )
        expect(found.newPasswordMaxLength).toBe(lengths.length > 0 ? Math.min(...lengths) : null)
        const rules = news
          .map((field) => field?.passwordRules)
          .find((rule) => rule !== undefined && rule.trim() !== '')
        expect(found.newPasswordRules).toBe(rules ?? null)
        if (found.newPasswords.length === 0) {
          expect(found.newPasswordMaxLength).toBeNull()
          expect(found.newPasswordRules).toBeNull()
        }
      }),
      { numRuns },
    )
  })

  it('finds nothing, and says no more, when it names no field', () => {
    fc.assert(
      fc.property(fieldList, (fields) => {
        const found = findLoginFields(fields)
        if (found.username !== null || found.password !== null || found.newPasswords.length > 0)
          return
        expect(found).toEqual({
          username: null,
          password: null,
          newPasswords: [],
          focused: null,
          newPasswordMaxLength: null,
          newPasswordRules: null,
        })
      }),
      { numRuns },
    )
  })

  it('does not hand out one empty answer for the caller to change', () => {
    const first = findLoginFields([])
    first.newPasswords.push('changed')
    try {
      expect(findLoginFields([]).newPasswords).toEqual([])
    } finally {
      // Whatever the answer shares, the other tests of this file get it empty again
      first.newPasswords.length = 0
    }
  })

  it('answers a lone field that says what it is', () => {
    fc.assert(
      fc.property(description, (field) => {
        const lone = { ...field, tag: 'input', visible: true }
        expect(findLoginFields([{ ...lone, autocomplete: ['current-password'] }])).toMatchObject({
          username: null,
          password: lone.id,
          newPasswords: [],
        })
        expect(findLoginFields([{ ...lone, autocomplete: ['new-password'] }])).toMatchObject({
          username: null,
          password: null,
          newPasswords: [lone.id],
        })
        expect(findLoginFields([{ ...lone, autocomplete: ['username'] }])).toMatchObject({
          username: lone.id,
          password: null,
          newPasswords: [],
        })
      }),
      { numRuns },
    )
  })
})
