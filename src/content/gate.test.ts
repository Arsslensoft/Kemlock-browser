// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Geometry } from './dom'
import {
  coverOver,
  onTopAt,
  otherTopLayer,
  plainAt,
  plainView,
  samplePoints,
  signatureOf,
} from './gate'

let host: HTMLElement
let other: HTMLElement

/** A layout for jsdom: the host is a box in view, and [topmost] says what is on top at a point. */
function layout(topmost: (x: number, y: number) => Element = () => host): Geometry {
  return {
    rect: () => ({ left: 100, top: 100, width: 320, height: 200 }),
    elementsAt: (x, y) => [topmost(x, y)],
    viewport: () => ({ width: 1280, height: 800 }),
  }
}

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  document.body.removeAttribute('style')
  document.body.innerHTML = '<div id="host"></div><div id="other"></div>'
  host = document.getElementById('host')!
  other = document.getElementById('other')!
})

describe('plainView', () => {
  it('accepts a menu that is shown, opaque, sized, in view and on top', () => {
    expect(plainView(host, layout())).toEqual({ ok: true })
  })

  it('refuses a menu its own style fades', () => {
    host.style.opacity = '0'
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'faded' })
  })

  it('refuses a menu faded by the page around it, up to html', () => {
    document.body.style.opacity = '0.5'
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'faded' })
    document.body.style.opacity = '1'
    document.documentElement.style.opacity = '0.2'
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'faded' })
  })

  it('refuses a hidden menu or a hidden ancestor', () => {
    host.style.visibility = 'hidden'
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'hidden' })
    host.style.visibility = 'visible'
    document.body.style.display = 'none'
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'hidden' })
  })

  it('refuses a menu with no size, or partly out of the viewport', () => {
    const tiny: Geometry = { ...layout(), rect: () => ({ left: 0, top: 0, width: 10, height: 10 }) }
    expect(plainView(host, tiny)).toEqual({ ok: false, why: 'tiny' })
    const off: Geometry = {
      ...layout(),
      rect: () => ({ left: 1200, top: 100, width: 320, height: 200 }),
    }
    expect(plainView(host, off)).toEqual({ ok: false, why: 'clipped' })
  })

  it('refuses a menu with another element over any part of it', () => {
    // Over the lower right corner only
    const geometry = layout((x, y) => (x > 400 && y > 280 ? other : host))
    expect(plainView(host, geometry)).toEqual({ ok: false, why: 'covered' })
  })

  it('refuses a menu that is no longer in the page', () => {
    host.remove()
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'detached' })
  })
})

describe('plainAt', () => {
  it('counts a click on the menu', () => {
    expect(plainAt(host, 250, 200, layout())).toEqual({ ok: true })
  })

  it('refuses a click where something else is on top', () => {
    const geometry = layout((x, y) => (x === 250 && y === 200 ? other : host))
    expect(plainAt(host, 250, 200, geometry)).toEqual({ ok: false, why: 'covered' })
  })

  it('refuses a click on a menu the page faded', () => {
    host.style.opacity = '0'
    expect(plainAt(host, 250, 200, layout())).toEqual({ ok: false, why: 'faded' })
  })
})

describe('what the page draws over the menu, that elementsFromPoint cannot see', () => {
  const hostBox = { left: 100, top: 100, width: 320, height: 200 }
  /** The host's box, and [box] for the page's overlay. */
  function boxes(overlay: Element, box = hostBox): Geometry {
    return {
      rect: (element) => (element === overlay ? box : hostBox),
      elementsAt: () => [host],
      viewport: () => ({ width: 1280, height: 800 }),
    }
  }
  const decoy = () => {
    const el = document.createElement('div')
    el.style.cssText = 'position: fixed; pointer-events: none; opacity: 1'
    document.body.append(el)
    return el
  }
  /** jsdom has no top layer: the elements marked data-open count as open. */
  const open = (selector: string, element: Element) =>
    element.hasAttribute('data-open') && (selector === ':popover-open' || selector === ':modal')
  let matches: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return open(selector, this)
    })
  })
  afterEach(() => matches.mockRestore())

  it('refuses a menu when the page has a popover open, or a modal dialog', () => {
    const popover = document.createElement('div')
    popover.setAttribute('popover', 'manual')
    document.body.append(popover)
    expect(plainView(host, layout())).toEqual({ ok: true })
    popover.setAttribute('data-open', '')
    expect(otherTopLayer(host)).toEqual([popover])
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'covered' })
    popover.remove()
    const dialog = document.createElement('dialog')
    dialog.setAttribute('data-open', '')
    document.body.append(dialog)
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'covered' })
    expect(plainAt(host, 250, 200, layout())).toEqual({ ok: false, why: 'covered' })
  })

  it('does not count our own hosts as the page covering the menu', () => {
    const badge = document.createElement('div')
    badge.setAttribute('popover', 'manual')
    badge.setAttribute('data-open', '')
    document.body.append(badge)
    expect(plainView(host, layout())).toEqual({ ok: false, why: 'covered' })
    expect(plainView(host, layout(), undefined, new Set([badge]))).toEqual({ ok: true })
    host.setAttribute('data-open', '')
    expect(plainView(host, layout(), undefined, new Set([badge]))).toEqual({ ok: true })
  })

  it('refuses a menu with a fixed or absolute element over it that lets presses through', () => {
    const overlay = decoy()
    expect(coverOver(host, boxes(overlay))).toBe(true)
    expect(plainView(host, boxes(overlay))).toEqual({ ok: false, why: 'covered' })
    overlay.style.position = 'absolute'
    expect(coverOver(host, boxes(overlay))).toBe(true)
  })

  it('lets a click-through overlay be over a menu on the top layer, and not one off it', () => {
    const overlay = decoy()
    // Off the top layer (no popover support, or showPopover failed): the overlay covers it
    expect(coverOver(host, boxes(overlay))).toBe(true)
    expect(plainView(host, boxes(overlay))).toEqual({ ok: false, why: 'covered' })
    // On the top layer: only another top-layer element can paint over it
    host.setAttribute('data-open', '')
    expect(coverOver(host, boxes(overlay))).toBe(false)
    expect(plainView(host, boxes(overlay))).toEqual({ ok: true })
    // ...and another popover of the page still does
    const popover = document.createElement('div')
    popover.setAttribute('popover', 'manual')
    popover.setAttribute('data-open', '')
    document.body.append(popover)
    expect(coverOver(host, boxes(overlay))).toBe(true)
  })

  it('lets the menu be when the overlay is elsewhere, static, taking presses, or not shown', () => {
    const overlay = decoy()
    expect(coverOver(host, boxes(overlay, { left: 900, top: 500, width: 100, height: 100 }))).toBe(
      false,
    )
    // Touching at an edge is not over
    expect(coverOver(host, boxes(overlay, { left: 420, top: 100, width: 100, height: 100 }))).toBe(
      false,
    )
    overlay.style.pointerEvents = 'auto'
    expect(coverOver(host, boxes(overlay))).toBe(false)
    overlay.style.pointerEvents = 'none'
    overlay.style.position = 'static'
    expect(coverOver(host, boxes(overlay))).toBe(false)
    overlay.style.position = 'fixed'
    overlay.style.opacity = '0'
    expect(coverOver(host, boxes(overlay))).toBe(false)
    overlay.style.opacity = '1'
    overlay.style.display = 'none'
    expect(coverOver(host, boxes(overlay))).toBe(false)
    overlay.style.display = 'block'
    expect(coverOver(host, boxes(overlay))).toBe(true)
  })

  it('does not mistake the menu, what is in it, or an ancestor of it for the page', () => {
    host.style.cssText = 'position: fixed; pointer-events: none'
    const inside = document.createElement('div')
    inside.style.cssText = 'position: fixed; pointer-events: none'
    host.append(inside)
    document.body.style.cssText = 'position: absolute; pointer-events: none'
    const geometry: Geometry = { ...layout(), rect: () => hostBox }
    expect(coverOver(host, geometry)).toBe(false)
  })

  it('finds an overlay inside an open shadow root', () => {
    const shadowHost = document.createElement('div')
    document.body.append(shadowHost)
    const inner = document.createElement('div')
    inner.style.cssText = 'position: fixed; pointer-events: none'
    shadowHost.attachShadow({ mode: 'open' }).append(inner)
    expect(coverOver(host, boxes(inner))).toBe(true)
  })
})

describe('helpers', () => {
  it('samples the corners and the middle', () => {
    expect(samplePoints({ left: 0, top: 0, width: 100, height: 40 })).toHaveLength(5)
  })

  it('finds what is on top at a point', () => {
    expect(onTopAt(host, 1, 1, layout())).toBe(true)
    expect(
      onTopAt(
        host,
        1,
        1,
        layout(() => other),
      ),
    ).toBe(false)
  })

  it('names a position, so a move is noticed', () => {
    const a = signatureOf({ left: 1.2, top: 2, width: 3, height: 4 })
    expect(signatureOf({ left: 1.4, top: 2, width: 3, height: 4 })).toBe(a)
    expect(signatureOf({ left: 5, top: 2, width: 3, height: 4 })).not.toBe(a)
  })
})
