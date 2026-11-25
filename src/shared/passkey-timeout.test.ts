import { describe, expect, it } from 'vitest'
import { timeoutOf } from '../background/passkey-request'
import {
  defaultTimeoutMs,
  longestTimeoutMs,
  modalTimeout,
  shortestTimeoutMs,
} from './passkey-timeout'

describe('how long a request waits for the person', () => {
  it('is two minutes by default, and what the page asked within half a minute and ten', () => {
    expect(defaultTimeoutMs).toBe(120_000)
    expect(modalTimeout(undefined)).toBe(120_000)
    expect(modalTimeout(1)).toBe(shortestTimeoutMs)
    expect(modalTimeout(45_000)).toBe(45_000)
    expect(modalTimeout(99_999_999)).toBe(longestTimeoutMs)
  })

  it('is one rule for the page script and the background', () => {
    for (const asked of [undefined, 0, 10_000, 90_000, 700_000])
      expect(timeoutOf(asked, false)).toBe(modalTimeout(asked))
  })
})
