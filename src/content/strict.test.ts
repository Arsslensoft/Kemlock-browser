// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fieldNames, type Geometry } from './dom'
import { fillFormEntry } from './form-fill'
import { scanFrame } from './scan'
import { withForms } from './scan-forms'
import { inReach, strictlyVisible, type Box } from './strict'

const normal: Box = { left: 10, top: 10, width: 200, height: 30 }

/** A layout for jsdom: every element a box in view, unless a test gives it another. */
function layout(boxes: Map<Element, Box> = new Map()): Geometry {
  return {
    rect: (element) => boxes.get(element) ?? normal,
    elementsAt: () => [],
    viewport: () => ({ width: 1280, height: 800 }),
  }
}

/** Styles an element as a page's stylesheet could, which jsdom's own computed styles can't all say. */
function styled(id: string, extra: Record<string, string>) {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((
    element: Element,
    pseudo?: string | null,
  ) => {
    const style = real(element, pseudo)
    if (element.id !== id) return style
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: extra.opacity ?? style.opacity,
      position: extra.position ?? style.position,
      overflowX: extra['overflow-x'] ?? '',
      overflowY: extra['overflow-y'] ?? '',
      getPropertyValue: (name: string) => extra[name] ?? style.getPropertyValue(name),
    } as unknown as CSSStyleDeclaration
  }) as typeof window.getComputedStyle)
}

const $ = (selector: string) => document.querySelector(selector) as HTMLInputElement

const checkout = `
  <form>
    <input id="holder" name="holder" autocomplete="cc-name">
    <input id="number" name="number" autocomplete="cc-number">
    <input id="cvc" name="cvc" autocomplete="cc-csc" maxlength="4">
  </form>`

const reported = (geometry: Geometry) => {
  const names = fieldNames()
  const found = scanFrame(document, names, geometry)
  const scan = withForms(found, document, names, geometry)
  return { ...scan, parts: scan.reports.map((report) => report.part) }
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('strictlyVisible', () => {
  const visible = (boxes: Map<Element, Box>) => strictlyVisible($('#number'), layout(boxes))

  it('takes a field of a usual size in the page', () => {
    document.body.innerHTML = checkout
    expect(visible(new Map())).toBe(true)
  })

  it('refuses a field under 8 by 8 pixels, which a person can’t use', () => {
    document.body.innerHTML = checkout
    expect(visible(new Map([[$('#number'), { ...normal, width: 1, height: 1 }]]))).toBe(false)
    expect(visible(new Map([[$('#number'), { ...normal, width: 7, height: 30 }]]))).toBe(false)
    expect(visible(new Map([[$('#number'), { ...normal, width: 8, height: 8 }]]))).toBe(true)
  })

  it('refuses a field parked off the page, to the right, below, to the left or above', () => {
    document.body.innerHTML = checkout
    for (const left of [-5000])
      expect(visible(new Map([[$('#number'), { ...normal, left }]]))).toBe(false)
    expect(visible(new Map([[$('#number'), { ...normal, left: 9000 }]]))).toBe(false)
    expect(visible(new Map([[$('#number'), { ...normal, top: 9000 }]]))).toBe(false)
    expect(visible(new Map([[$('#number'), { ...normal, top: -5000 }]]))).toBe(false)
  })

  it('refuses a field that is nearly transparent, with its ancestors counted', () => {
    document.body.innerHTML = '<div id="wrap" style="opacity: 0.3"><input id="number"></div>'
    expect(visible(new Map())).toBe(false)
    document.body.innerHTML = '<div id="wrap" style="opacity: 0.6"><input id="number"></div>'
    expect(visible(new Map())).toBe(true)
    // 0.11 is visible to the sign-in rules and not to these
    document.body.innerHTML = '<input id="number" style="opacity: 0.11">'
    expect(visible(new Map())).toBe(false)
  })

  it('refuses a field an ancestor clips away: a clip path, a clip, a filter, a mask', () => {
    for (const rule of [
      { 'clip-path': 'inset(100%)' },
      { clip: 'rect(0, 0, 0, 0)', position: 'absolute' },
      { filter: 'opacity(0)' },
      { 'mask-image': 'linear-gradient(transparent, transparent)' },
    ] as Record<string, string>[]) {
      vi.restoreAllMocks()
      document.body.innerHTML = '<div id="wrap"><input id="number"></div>'
      styled('wrap', rule)
      expect(visible(new Map()), JSON.stringify(rule)).toBe(false)
    }
  })

  it('refuses a field in an overflow box with no size, or with none of the field in it', () => {
    document.body.innerHTML = '<div id="wrap"><input id="number"></div>'
    styled('wrap', { 'overflow-x': 'hidden', 'overflow-y': 'hidden' })
    const wrap = $('#wrap')
    expect(visible(new Map([[wrap, { left: 10, top: 10, width: 0, height: 0 }]]))).toBe(false)
    expect(visible(new Map([[wrap, { left: 900, top: 10, width: 100, height: 100 }]]))).toBe(false)
    expect(visible(new Map([[wrap, { left: 0, top: 0, width: 400, height: 300 }]]))).toBe(true)
  })
})

describe('inReach', () => {
  const element = () => $('#number')

  it('is a field in the viewport', () => {
    document.body.innerHTML = checkout
    expect(inReach(element(), layout())).toBe(true)
  })

  it('is not a field out of it, unless it is near the field the person clicked', () => {
    document.body.innerHTML = checkout
    const below = layout(new Map([[element(), { ...normal, top: 1500 }]]))
    expect(inReach(element(), below)).toBe(false)
    expect(inReach(element(), below, { left: 10, top: 1100, width: 200, height: 30 })).toBe(true)
    expect(inReach(element(), below, { left: 10, top: 10, width: 200, height: 30 })).toBe(false)
  })
})

describe('a card the page hid a field of', () => {
  it('is not reported with that field: one pixel, off the page, or faded', () => {
    document.body.innerHTML = checkout
    for (const [name, box] of [
      ['one pixel', { ...normal, width: 1, height: 1 }],
      ['off to the right', { ...normal, left: 9000 }],
    ] as const) {
      const boxes = new Map<Element, Box>([[$('#number'), box]])
      expect(reported(layout(boxes)).parts, name).toEqual(['cardName', 'cardCsc'])
    }
    $('#number').style.opacity = '0.3'
    expect(reported(layout()).parts).toEqual(['cardName', 'cardCsc'])
  })

  it('is not filled into a field that became hidden after it was reported', () => {
    document.body.innerHTML = checkout
    const boxes = new Map<Element, Box>()
    const geometry = layout(boxes)
    const { registry } = reported(geometry)
    const number = [...registry.values()].find((entry) => entry.part === 'cardNumber')!
    boxes.set($('#number'), { ...normal, width: 1, height: 1 })
    expect(fillFormEntry(number, '4111111111111111', [], geometry)).toBe(false)
    boxes.set($('#number'), { ...normal, left: 9000 })
    expect(fillFormEntry(number, '4111111111111111', [], geometry)).toBe(false)
    boxes.delete($('#number'))
    $('#number').style.opacity = '0.4'
    expect(fillFormEntry(number, '4111111111111111', [], geometry)).toBe(false)
    $('#number').style.opacity = '1'
    expect(fillFormEntry(number, '4111111111111111', [], geometry)).toBe(true)
    expect($('#number').value).toBe('4111111111111111')
  })

  it('is filled only in the viewport, or near the field the person clicked', () => {
    document.body.innerHTML = checkout
    const boxes = new Map<Element, Box>()
    const geometry = layout(boxes)
    const { registry } = reported(geometry)
    const number = [...registry.values()].find((entry) => entry.part === 'cardNumber')!
    // A long page: the field is inside its extent, only out of the viewport
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 3000,
      configurable: true,
    })
    try {
      boxes.set($('#number'), { ...normal, top: 1500 })
      expect(fillFormEntry(number, '4111111111111111', [], geometry)).toBe(false)
      expect(
        fillFormEntry(number, '4111111111111111', [], geometry, { ...normal, top: 1300 }),
      ).toBe(true)
    } finally {
      delete (document.documentElement as { scrollHeight?: number }).scrollHeight
    }
  })
})
