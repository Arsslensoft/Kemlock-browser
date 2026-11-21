import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findCodeFields, findLoginFields, splitWords, type FieldDescription } from './fields'

// The cases FieldFinder.kt is held to, read here as the extension reads a
// web field (design decision 7).

interface FieldNode {
  id?: string
  autofillHints?: string[]
  htmlTag?: string
  htmlAttributes?: Record<string, string>
  idEntry?: string
  hint?: string
  contentDescription?: string
  inputType?: number
  maxLength?: number
  visible?: boolean
  isText?: boolean
  focused?: boolean
  webDomain?: string
  value?: string
  children?: FieldNode[]
}

interface FieldCase {
  name: string
  androidOnly?: string
  find: 'code' | 'login'
  manual?: boolean
  screen: FieldNode[]
  expect: Record<string, unknown>
}

const cases = (
  JSON.parse(
    readFileSync(
      new URL('../../../mobile/test/fixtures/autofill/fields.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: FieldCase[] }
).cases

/** Android's input type as the HTML type it stands for, for a view that isn't a web field. */
function typeOf(node: FieldNode): string {
  if (node.htmlTag !== undefined) return (node.htmlAttributes?.type ?? 'text').toLowerCase()
  const inputType = node.inputType ?? 0x1
  const kind = inputType & 0xf
  const variation = inputType & 0xff0
  if (kind === 0x1) {
    if ([0x80, 0xe0, 0x90].includes(variation)) return 'password'
    if ([0x20, 0xd0].includes(variation)) return 'email'
    return 'text'
  }
  if (kind === 0x2) return variation === 0x10 ? 'password' : 'number'
  if (kind === 0x3) return 'tel'
  return 'datetime'
}

/** A screen's fields in page order, each as the extension describes a web field. */
function describeScreen(screen: FieldNode[]): FieldDescription[] {
  const out: FieldDescription[] = []
  const walk = (node: FieldNode) => {
    if (node.id !== undefined && node.isText !== false) {
      const attributes = node.htmlAttributes ?? {}
      const maxLength = node.maxLength ?? -1
      const attributeMax = Number.parseInt(attributes.maxlength ?? '', 10)
      out.push({
        id: node.id,
        tag: (node.htmlTag ?? 'input').toLowerCase(),
        type: typeOf(node),
        autocomplete: (attributes.autocomplete ?? '').toLowerCase().split(' ').filter(Boolean),
        inputMode: attributes.inputmode?.toLowerCase(),
        maxLength:
          maxLength > 0 ? maxLength : Number.isNaN(attributeMax) ? undefined : attributeMax,
        words: [
          node.idEntry,
          node.hint,
          node.contentDescription,
          attributes.name,
          attributes.id,
          attributes.placeholder,
          attributes['aria-label'],
          attributes.label,
        ].filter((word): word is string => word !== undefined),
        passwordRules: attributes.passwordrules,
        visible: node.visible !== false,
        focused: node.focused === true,
      })
    }
    for (const child of node.children ?? []) walk(child)
  }
  screen.forEach(walk)
  return out
}

describe('the shared field cases', () => {
  it('are there, some for Android only', () => {
    expect(cases.length).toBeGreaterThan(40)
    expect(cases.some((c) => c.androidOnly)).toBe(true)
    expect(cases.some((c) => !c.androidOnly && c.find === 'code')).toBe(true)
    expect(cases.some((c) => !c.androidOnly && c.find === 'login')).toBe(true)
  })

  for (const c of cases.filter((c) => !c.androidOnly)) {
    it(c.name, () => {
      const fields = describeScreen(c.screen)
      if (c.find === 'code') {
        const found = findCodeFields(fields, c.manual === true)
        const expected = (c.expect.fields as [string, number | null][]).map(([id, character]) => ({
          id,
          character,
        }))
        expect(found).toEqual(expected)
      } else {
        const { webDomain: _, ...expected } = c.expect
        expect(findLoginFields(fields)).toEqual({
          ...expected,
          focused: expected.focused === null ? null : camel(expected.focused as string),
        })
      }
    })
  }
})

/** Kotlin's NEW_PASSWORD as the port's newPassword. */
const camel = (name: string) =>
  name.toLowerCase().replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())

describe('splitWords', () => {
  it('splits names at case changes, dashes, underscores and spaces', () => {
    expect(splitWords('twoFactorCode')).toEqual(['two', 'factor', 'code'])
    expect(splitWords('two_factor-code')).toEqual(['two', 'factor', 'code'])
    expect(splitWords('OTPCode')).toEqual(['otp', 'code'])
    expect(splitWords('Code de vérification')).toEqual(['code', 'de', 'verification'])
  })
})
