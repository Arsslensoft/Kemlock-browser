import { describe, expect, it } from 'vitest'
import { markDifference } from './diff'

describe('markDifference', () => {
  it('marks the digit that stands for a letter', () => {
    const { a, b } = markDifference('orbit-c1oud.com', 'orbit-cloud.com')
    expect(a).toEqual([
      { text: 'orbit-c', marked: false },
      { text: '1', marked: true },
      { text: 'oud.com', marked: false },
    ])
    expect(b.find((part) => part.marked)?.text).toBe('l')
  })

  it('marks letters that are not in the other', () => {
    const { a, b } = markDifference('orbit-cloud.com', 'orbit-cloud.co')
    expect(a.find((part) => part.marked)?.text).toBe('m')
    expect(b.some((part) => part.marked)).toBe(false)
  })

  it('marks everything of unrelated names', () => {
    const { a } = markDifference('abc', 'xyz')
    expect(a).toEqual([{ text: 'abc', marked: true }])
  })
})
