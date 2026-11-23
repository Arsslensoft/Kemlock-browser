// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { rulesFromPattern, siteRulesOf } from './rules'

function inputs(html: string): HTMLInputElement[] {
  document.body.innerHTML = html
  return Array.from(document.querySelectorAll('input'))
}

describe('siteRulesOf', () => {
  it('says nothing for a field that states nothing', () => {
    expect(siteRulesOf(inputs('<input type="password">'))).toBeUndefined()
  })

  it('takes maxlength and minlength', () => {
    const fields = inputs('<input type="password" maxlength="16" minlength="8">')
    expect(siteRulesOf(fields)).toBe('minlength: 8; maxlength: 16')
  })

  it('takes the strictest of a password and its confirmation', () => {
    const fields = inputs(
      '<input type="password" maxlength="20" minlength="6"><input type="password" maxlength="16" minlength="8">',
    )
    expect(siteRulesOf(fields)).toBe('minlength: 8; maxlength: 16')
  })

  it("keeps the page's passwordrules and adds only what it leaves out", () => {
    const fields = inputs(
      '<input type="password" passwordrules="minlength: 12; required: lower;" maxlength="30" minlength="8">',
    )
    expect(siteRulesOf(fields)).toBe('minlength: 12; required: lower; maxlength: 30')
  })

  it('reads what a pattern plainly asks for', () => {
    const input = document.createElement('input')
    input.type = 'password'
    input.setAttribute('pattern', '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,20}')
    expect(siteRulesOf([input])).toBe(
      'required: upper; required: lower; required: digit; minlength: 8; maxlength: 20',
    )
  })
})

describe('rulesFromPattern', () => {
  it('finds a symbol class and an open length', () => {
    expect(rulesFromPattern('(?=.*[!@#$]).{10,}')).toEqual(['required: special', 'minlength: 10'])
  })

  it('says nothing of a pattern it does not understand', () => {
    expect(rulesFromPattern('[a-z]+')).toEqual([])
  })
})
