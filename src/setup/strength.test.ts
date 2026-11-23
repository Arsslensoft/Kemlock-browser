import { describe, expect, it } from 'vitest'
import { canMakeVault, passwordScore, passwordStrength } from './strength'

describe("the app's strength meter", () => {
  it('counts the five checks', () => {
    expect(passwordScore('').score).toBe(0)
    expect(passwordScore('Abc1!').passed).toEqual([false, true, true, true, true])
    expect(passwordScore('Abcdefghij1!').score).toBe(5)
  })

  it('never calls a short password more than fair', () => {
    expect(passwordStrength('Abc1!')).toEqual({ level: 2, bars: 2 })
    expect(passwordStrength('abcdefghijkl')).toEqual({ level: 2, bars: 2 })
  })

  it('lights every bar for a long password that passes every check', () => {
    expect(passwordStrength('Abcdefghij1!')).toEqual({ level: 4, bars: 5 })
    expect(passwordStrength('abcdefghijklmnop')).toEqual({ level: 2, bars: 2 })
  })

  it('wants twelve characters, three checks and the two typed alike', () => {
    expect(canMakeVault('Abcdefghijk1', 'Abcdefghijk1')).toBe(true)
    expect(canMakeVault('Abcdefghijk1', 'Abcdefghijk2')).toBe(false)
    expect(canMakeVault('Abcdefghijk1', '')).toBe(false)
    expect(canMakeVault('abcdefghijkl', 'abcdefghijkl')).toBe(false)
    expect(canMakeVault('Abc1!', 'Abc1!')).toBe(false)
  })
})
