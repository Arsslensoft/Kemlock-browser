import { describe, expect, it } from 'vitest'
import type { ApprovalView, TwoStepView } from '../shared/account'
import {
  ageOf,
  anyStepOn,
  canApprove,
  contactAction,
  daysLeft,
  displayPiece,
  grantorActions,
  groupSecret,
  isOneOf,
  moveFraction,
  moveStepNumber,
  normalizePiece,
  otherStepOn,
  waitingOnMe,
} from './model'

const approval = (extra: Partial<ApprovalView> = {}): ApprovalView => ({
  id: 'r',
  deviceName: 'Kemlock · Firefox',
  deviceKind: 'kemlock-browser',
  ip: '203.0.113.0',
  phrase: ['a', 'b', 'c', 'd', 'e'],
  agrees: true,
  canApprove: true,
  ageSeconds: 3,
  createdAt: 0,
  expiresAt: 1,
  ...extra,
})

describe('the wait of a grant', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  it('counts whole days left, rounding up, never below zero', () => {
    expect(daysLeft('2026-11-27T12:00:00Z', now)).toBe(3)
    expect(daysLeft('2026-11-24T13:00:00Z', now)).toBe(1)
    expect(daysLeft('2026-11-20T00:00:00Z', now)).toBe(0)
  })
  it('has none without a due time, or with one that is no date', () => {
    expect(daysLeft(null, now)).toBeNull()
    expect(daysLeft('soon', now)).toBeNull()
  })
})

describe('ageOf', () => {
  it('takes the coarsest whole unit', () => {
    expect(ageOf(5)).toEqual({ unit: 'second', count: 5 })
    expect(ageOf(59)).toEqual({ unit: 'second', count: 59 })
    expect(ageOf(60)).toEqual({ unit: 'minute', count: 1 })
    expect(ageOf(7300)).toEqual({ unit: 'hour', count: 2 })
    expect(ageOf(3 * 86_400 + 5)).toEqual({ unit: 'day', count: 3 })
    expect(ageOf(-4)).toEqual({ unit: 'second', count: 0 })
  })
})

describe('Recovery Kit pieces', () => {
  const share = 'ABCDEFGHJKLMNPQRSTUVWXYZ234567ABCDEFGHJKLMNPQRSTUVWX'
  const piece = `BMCKIT1-ABCD2345-231-${share}-WXYZ`
  it('are shown with the share in groups of four, as the web vault shows them', () => {
    expect(share).toHaveLength(52)
    expect(displayPiece(piece)).toBe(
      'BMCKIT1-ABCD2345-231-ABCD EFGH JKLM NPQR STUV WXYZ 2345 67AB CDEF GHJK LMNP QRST UVWX-WXYZ',
    )
    expect(displayPiece('not a piece')).toBe('not a piece')
  })
  it('are compared without case or spaces', () => {
    expect(normalizePiece(' bmckit1-abcd 2345\n')).toBe('BMCKIT1-ABCD2345')
    expect(isOneOf(displayPiece(piece).toLowerCase(), [piece])).toBe(true)
    expect(isOneOf('', [piece])).toBe(false)
    expect(isOneOf('BMCKIT1', [piece])).toBe(false)
  })
})

describe('what a person can do', () => {
  it('with a contact they made, by its state', () => {
    expect(grantorActions('accepted')).toEqual(['confirm'])
    expect(grantorActions('recovery-initiated')).toEqual(['approve', 'reject'])
    expect(grantorActions('invited')).toEqual([])
    expect(grantorActions('confirmed')).toEqual([])
  })
  it('with a grant that names them, by its state', () => {
    expect(contactAction('invited')).toBe('accept')
    expect(contactAction('confirmed')).toBe('ask')
    expect(contactAction('rejected')).toBe('ask')
    expect(contactAction('approved')).toBe('key')
    expect(contactAction('recovery-initiated')).toBeNull()
  })
  it('counts the grants that wait on them', () => {
    const grant = (state: string) => ({ grant: { state } as never })
    expect(waitingOnMe([grant('accepted'), grant('confirmed'), grant('recovery-initiated')])).toBe(
      2,
    )
  })
})

describe('an approval', () => {
  it('can be approved only when the core worked out the words and the server agrees', () => {
    expect(canApprove(approval())).toBe(true)
    expect(canApprove(approval({ agrees: false }))).toBe(false)
    expect(canApprove(approval({ phrase: null }))).toBe(false)
    expect(canApprove(approval({ canApprove: false }))).toBe(false)
  })
})

describe('second steps', () => {
  const view = (...on: string[]): TwoStepView => ({
    methods: on.map((method) => ({ method: method as never, enabled: true })),
    recoveryCodes: on.length > 0,
    email: null,
    emailOffered: true,
  })
  it('ask for a proof when another one is on', () => {
    expect(otherStepOn(view(), 'totp')).toBe(false)
    expect(otherStepOn(view('totp'), 'totp')).toBe(false)
    expect(otherStepOn(view('email'), 'totp')).toBe(true)
    expect(anyStepOn(view())).toBe(false)
    expect(anyStepOn(view('email'))).toBe(true)
  })
  it('group a secret in fours', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(groupSecret('jbsw y3dp')).toBe('jbsw y3dp')
  })
})

describe('the move', () => {
  it('numbers its steps and counts its progress', () => {
    expect(moveStepNumber('sync')).toBe(1)
    expect(moveStepNumber('oldStore')).toBe(5)
    expect(moveStepNumber('done')).toBe(0)
    expect(moveStepNumber(undefined)).toBe(0)
    const status = { offered: true, held: false, running: true, done: 3, total: 4, finished: false }
    expect(moveFraction(status)).toBe(0.75)
    expect(moveFraction({ ...status, total: 0 })).toBeNull()
    expect(moveFraction({ ...status, done: 9 })).toBe(1)
  })
})
