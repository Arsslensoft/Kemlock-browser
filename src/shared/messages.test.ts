import { describe, expect, it } from 'vitest'
import { parseContentMessage, parsePageMessage } from './messages'

describe('parseContentMessage', () => {
  it('keeps the known fields only', () => {
    expect(
      parseContentMessage({
        kind: 'fields',
        url: 'https://bank.example',
        fields: [
          { id: 'user', kind: 'username', label: 'Email' },
          { id: 'otp', kind: 'code', boxes: 6 },
        ],
      }),
    ).toEqual({
      kind: 'fields',
      fields: [
        { id: 'user', kind: 'username' },
        { id: 'otp', kind: 'code', boxes: 6 },
      ],
    })
    expect(parseContentMessage({ kind: 'suggestions', origin: 'https://bank.example' })).toEqual({
      kind: 'suggestions',
    })
  })

  it('refuses what is not a field report', () => {
    const field = { id: 'f', kind: 'password' }
    for (const raw of [
      null,
      'fields',
      [],
      { kind: 'fill', fieldId: 'f', value: 'x' },
      { kind: 'fields' },
      { kind: 'fields', fields: [{ ...field, kind: 'creditCard' }] },
      { kind: 'fields', fields: [{ ...field, id: '' }] },
      { kind: 'fields', fields: [{ ...field, id: 'x'.repeat(65) }] },
      { kind: 'fields', fields: [field, field] },
      { kind: 'fields', fields: [{ ...field, boxes: 6 }] },
      { kind: 'fields', fields: [{ id: 'c', kind: 'code', boxes: 3 }] },
      { kind: 'fields', fields: [{ id: 'c', kind: 'code', boxes: 11 }] },
      { kind: 'fields', fields: [{ id: 'c', kind: 'code', boxes: 6.5 }] },
      {
        kind: 'fields',
        fields: Array.from({ length: 201 }, (_, i) => ({ ...field, id: `f${i}` })),
      },
    ]) {
      expect(parseContentMessage(raw), JSON.stringify(raw)?.slice(0, 80)).toBeNull()
    }
  })

  it('takes up to 200 fields', () => {
    const fields = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, kind: 'password' }))
    expect(parseContentMessage({ kind: 'fields', fields })).toEqual({ kind: 'fields', fields })
  })
})

describe('parsePageMessage', () => {
  it('reads the pages messages', () => {
    expect(parsePageMessage({ kind: 'state', extra: 1 })).toEqual({ kind: 'state' })
    expect(parsePageMessage({ kind: 'lock' })).toEqual({ kind: 'lock' })
    expect(parsePageMessage({ kind: 'unlock', password: 'correct horse' })).toEqual({
      kind: 'unlock',
      password: 'correct horse',
    })
  })

  it('refuses an unlock without a password, and what is not a page message', () => {
    expect(parsePageMessage({ kind: 'unlock' })).toBeNull()
    expect(parsePageMessage({ kind: 'unlock', password: 1234 })).toBeNull()
    expect(parsePageMessage({ kind: 'suggestions' })).toBeNull()
    expect(parsePageMessage(undefined)).toBeNull()
  })
})
