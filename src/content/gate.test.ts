// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Geometry } from './dom'
import { onTopAt, plainAt, plainView, samplePoints, signatureOf } from './gate'

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
