// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fieldNames, type Geometry } from './dom'
import { scanFrame, signatureOfReports } from './scan'

const geometry: Geometry = {
  rect: () => ({ left: 10, top: 10, width: 200, height: 30 }),
  elementsAt: () => [],
  viewport: () => ({ width: 1280, height: 800 }),
}

function scan(html: string) {
  document.body.innerHTML = html
  return scanFrame(document, fieldNames(), geometry)
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('scanFrame', () => {
  it('reports a sign-in form as a username and a password', () => {
    const { reports } = scan(`
      <input name="email" autocomplete="username">
      <input type="password" name="pw" autocomplete="current-password">`)
    expect(reports).toEqual([
      { id: 'f1', kind: 'username' },
      { id: 'f2', kind: 'password' },
    ])
  })

  it('reports a sign-up form: every new-password field, the confirmation too', () => {
    const { reports, newPasswords } = scan(`
      <input name="email" type="email">
      <input type="password" autocomplete="new-password" maxlength="16">
      <input type="password" autocomplete="new-password" aria-label="Confirm password">`)
    expect(reports.map((r) => r.kind)).toEqual(['username', 'newPassword', 'newPassword'])
    expect(newPasswords).toHaveLength(2)
  })

  it('reports a code field, and six one-character boxes as one code', () => {
    const one = scan('<input name="otp" autocomplete="one-time-code">')
    expect(one.reports).toEqual([{ id: 'f1', kind: 'code' }])
    const six = scan(Array.from({ length: 6 }, () => '<input maxlength="1">').join(''))
    expect(six.reports).toEqual([{ id: 'f1', kind: 'code', boxes: 6 }])
    expect(six.registry.get('f1')?.elements).toHaveLength(6)
  })

  it('reports no button for a recovery code field', () => {
    const { reports } = scan('<input name="recovery_code" maxlength="8" inputmode="numeric">')
    expect(reports).toEqual([])
  })

  it('leaves a field the person cannot see out of the report', () => {
    const { reports } = scan(`
      <input type="password" style="opacity: 0" autocomplete="current-password">
      <input name="email" autocomplete="username"><input type="password" name="pw">`)
    expect(reports.map((r) => r.kind)).toEqual(['username', 'password'])
  })

  it('names fields by the elements behind them', () => {
    const { registry } = scan('<input name="email" autocomplete="username">')
    expect(registry.get('f1')?.elements[0].name).toBe('email')
  })

  it('signs a report so an unchanged frame says nothing again', () => {
    const a = scan('<input name="email" autocomplete="username">').reports
    const b = scan('<input name="email" autocomplete="username">').reports
    expect(signatureOfReports(a)).toBe(signatureOfReports(b))
    expect(signatureOfReports(a)).not.toBe(signatureOfReports([]))
  })
})
