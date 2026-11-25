import { describe, expect, it } from 'vitest'
import { accountOps, parseAccountRequest } from './account'
import { parsePageMessage } from './messages'

describe('parseAccountRequest', () => {
  it('reads each op with its own fields and nothing else', () => {
    expect(parseAccountRequest({ op: 'devices', extra: 1 })).toEqual({ op: 'devices' })
    expect(parseAccountRequest({ op: 'approve', id: 'abc', origin: 'https://evil' })).toEqual({
      op: 'approve',
      id: 'abc',
    })
    expect(parseAccountRequest({ op: 'kitKeep', piece: 'BMCKIT1-X', proof: undefined })).toEqual({
      op: 'kitKeep',
      piece: 'BMCKIT1-X',
    })
    expect(parseAccountRequest({ op: 'moveStart', choice: 'keep' })).toEqual({
      op: 'moveStart',
      choice: 'keep',
    })
  })

  it('refuses what is not an op of the account', () => {
    for (const raw of [
      null,
      'devices',
      [],
      {},
      { op: 7 },
      { op: 'toString' },
      { op: '__proto__' },
      { op: 'constructor' },
      { op: 'approve' },
    ])
      expect(parseAccountRequest(raw), JSON.stringify(raw)).toBeNull()
  })

  it('refuses a field of the wrong kind or size', () => {
    expect(parseAccountRequest({ op: 'approve', id: '' })).toBeNull()
    expect(parseAccountRequest({ op: 'approve', id: 'x'.repeat(65) })).toBeNull()
    expect(parseAccountRequest({ op: 'moveStart', choice: 'maybe' })).toBeNull()
    expect(
      parseAccountRequest({ op: 'emergencyInvite', email: 'a@b.c', kind: 'view', waitDays: 0 }),
    ).toBeNull()
    expect(
      parseAccountRequest({ op: 'emergencyInvite', email: 'a@b.c', kind: 'view', waitDays: 1.5 }),
    ).toBeNull()
    expect(
      parseAccountRequest({ op: 'emergencyInvite', email: 'a@b.c', kind: 'owner', waitDays: 7 }),
    ).toBeNull()
    expect(parseAccountRequest({ op: 'emergencyStep', id: 'g', step: 'delete' })).toBeNull()
    expect(parseAccountRequest({ op: 'kitRemove', proof: '' })).toBeNull()
  })

  it('takes an https or http address for a registration, and nothing else', () => {
    const base = { op: 'register', email: 'sam@example.com', name: '', password: 'p' }
    expect(parseAccountRequest({ ...base, server: 'https://km.example' })).not.toBeNull()
    // The core refuses http before anything is sent; the parser only keeps out what is no address
    expect(parseAccountRequest({ ...base, server: 'http://km.example' })).not.toBeNull()
    expect(parseAccountRequest({ ...base, server: 'ftp://km.example' })).toBeNull()
    expect(parseAccountRequest({ ...base, server: 'javascript:alert(1)' })).toBeNull()
    expect(parseAccountRequest({ ...base, server: 'not a url' })).toBeNull()
  })

  it('knows every op the core answers', () => {
    expect(accountOps.length).toBeGreaterThan(25)
    expect(new Set(accountOps).size).toBe(accountOps.length)
  })
})

describe('the account page message', () => {
  it('carries a request the parser accepts, and no other field', () => {
    expect(
      parsePageMessage({ kind: 'account', request: { op: 'devices', x: 1 }, extra: true }),
    ).toEqual({ kind: 'account', request: { op: 'devices' } })
    expect(parsePageMessage({ kind: 'account', request: { op: 'nope' } })).toBeNull()
    expect(parsePageMessage({ kind: 'account' })).toBeNull()
  })

  it('takes the answers of the recovery steps of a sign-in', () => {
    expect(
      parsePageMessage({
        kind: 'answerStep',
        answer: { step: 'recoveryKit', pieces: ['a', 'b'] },
      }),
    ).toMatchObject({ answer: { step: 'recoveryKit', pieces: ['a', 'b'] } })
    expect(
      parsePageMessage({
        kind: 'answerStep',
        answer: { step: 'recoveryKit', pieces: ['a', 'b', 'c', 'd'] },
      }),
    ).toBeNull()
    expect(
      parsePageMessage({
        kind: 'answerStep',
        answer: { step: 'second', method: 'recoveryCode', code: 'ABCD', remember: false },
      }),
    ).not.toBeNull()
  })
})
