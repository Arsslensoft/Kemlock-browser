// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Geometry } from './dom'
import { fillEntry, longestValue, setValue } from './fill'
import type { Registered } from './scan'

const geometry: Geometry = {
  rect: () => ({ left: 10, top: 10, width: 200, height: 30 }),
  elementsAt: () => [],
  viewport: () => ({ width: 1280, height: 800 }),
}

/** What the browser itself holds in a field, whatever the page did to its `value`. */
const nativeValue = (input: HTMLInputElement) =>
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(input) as string

const entry = (...elements: HTMLInputElement[]): Registered => ({
  id: 'f1',
  kind: 'code',
  elements,
})

const $ = (selector: string) => document.querySelector(selector) as HTMLInputElement

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('setValue', () => {
  it('sets the value through the element, then fires input and change', () => {
    document.body.innerHTML = '<input name="user">'
    const input = $('[name=user]')
    const seen: string[] = []
    input.addEventListener('input', (event) =>
      seen.push(`input:${nativeValue(input)}:${event.bubbles}`),
    )
    input.addEventListener('change', () => seen.push(`change:${nativeValue(input)}`))
    setValue(input, 'alice@example.com')
    expect(nativeValue(input)).toBe('alice@example.com')
    expect(seen).toEqual(['input:alice@example.com:true', 'change:alice@example.com'])
  })

  it("gets past a page that took over the field's own value property", () => {
    document.body.innerHTML = '<input name="user">'
    const input = $('[name=user]')
    // What a framework's value tracker does: an own property that records sets and keeps its own copy
    let tracked = ''
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => tracked,
      set: (value: string) => {
        tracked = `tracked:${value}`
      },
    })
    let heardAtInput = ''
    input.addEventListener('input', () => (heardAtInput = nativeValue(input)))
    setValue(input, 'secret')
    // The page's own setter never ran, so its tracker still believes the field is empty and sees a change
    expect(tracked).toBe('')
    expect(heardAtInput).toBe('secret')
    expect(nativeValue(input)).toBe('secret')
  })
})

describe('fillEntry', () => {
  it('fills a visible field', () => {
    document.body.innerHTML = '<input name="otp">'
    const input = $('[name=otp]')
    expect(fillEntry(entry(input), '123456', geometry)).toBe(true)
    expect(nativeValue(input)).toBe('123456')
  })

  it('puts one character in each box of a code, in order', () => {
    document.body.innerHTML = Array.from({ length: 6 }, () => '<input maxlength="1">').join('')
    const boxes = Array.from(document.querySelectorAll('input'))
    expect(fillEntry(entry(...boxes), '482913', geometry)).toBe(true)
    expect(boxes.map(nativeValue)).toEqual(['4', '8', '2', '9', '1', '3'])
  })

  it('leaves the last boxes empty for a shorter code', () => {
    document.body.innerHTML = Array.from({ length: 6 }, () => '<input maxlength="1">').join('')
    const boxes = Array.from(document.querySelectorAll('input'))
    fillEntry(entry(...boxes), '1234', geometry)
    expect(boxes.map(nativeValue)).toEqual(['1', '2', '3', '4', '', ''])
  })

  it('never fills a field the page faded out', () => {
    document.body.innerHTML = '<input name="pw" style="opacity: 0">'
    const input = $('[name=pw]')
    expect(fillEntry(entry(input), 'hunter2', geometry)).toBe(false)
    expect(nativeValue(input)).toBe('')
  })

  it('never fills a hidden field or one that was taken out of the page', () => {
    document.body.innerHTML = '<input name="a" style="display: none"><input name="b">'
    const [a, b] = [$('[name=a]'), $('[name=b]')]
    expect(fillEntry(entry(a), 'x', geometry)).toBe(false)
    b.remove()
    expect(fillEntry(entry(b), 'x', geometry)).toBe(false)
  })

  it('fills no box when one of them is hidden', () => {
    document.body.innerHTML =
      '<input maxlength="1"><input maxlength="1" style="visibility: hidden">'
    const boxes = Array.from(document.querySelectorAll('input'))
    expect(fillEntry(entry(...boxes), '12', geometry)).toBe(false)
    expect(boxes.map(nativeValue)).toEqual(['', ''])
  })

  it('leaves a field the page made read-only or disabled alone', () => {
    document.body.innerHTML = '<input name="a" readonly><input name="b" disabled>'
    expect(fillEntry(entry($('[name=a]')), 'x', geometry)).toBe(false)
    expect(fillEntry(entry($('[name=b]')), 'x', geometry)).toBe(false)
  })

  it('refuses an empty value and a huge one', () => {
    document.body.innerHTML = '<input name="a">'
    expect(fillEntry(entry($('[name=a]')), '', geometry)).toBe(false)
    expect(fillEntry(entry($('[name=a]')), 'x'.repeat(longestValue + 1), geometry)).toBe(false)
  })
})
