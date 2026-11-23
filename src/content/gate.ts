// What makes the menu "in plain view" from the page's side (design decision 9; spec "A click counts
// only on a menu in plain view"): the host element and every ancestor up to html are shown, opaque,
// unclipped and unfiltered, the host has a size, lies inside the viewport, and nothing is on top of
// it at the points the person could press. The menu's own frame adds IntersectionObserver v2 and
// the half-second delay (src/menu/gate.ts).

import { parentOf, type Geometry } from './dom'

/** Why a menu is not in plain view. */
export type NotPlain = 'detached' | 'hidden' | 'faded' | 'tiny' | 'clipped' | 'covered'

export type Plain = { ok: true } | { ok: false; why: NotPlain }

/** Opacity below this counts as faded: the menu is meant to be seen as drawn. */
const leastOpacity = 0.99

/** The smallest a menu frame may be drawn, in pixels. */
export const leastSize = { width: 120, height: 40 }

const off = (value: string | undefined) => !value || value === 'none'

/** Whether the element or an ancestor is hidden, faded, clipped, masked or filtered. */
function styleVerdict(element: Element): NotPlain | null {
  const view = element.ownerDocument.defaultView
  if (view === null) return 'detached'
  let opacity = 1
  for (let at: Element | null = element; at !== null; at = parentOf(at)) {
    const style = view.getComputedStyle(at)
    if (style.display === 'none') return 'hidden'
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return 'hidden'
    opacity *= Number.parseFloat(style.opacity || '1')
    if (!off(style.getPropertyValue('clip-path')) || !off(style.getPropertyValue('filter')))
      return 'clipped'
    const mask =
      style.getPropertyValue('mask-image') || style.getPropertyValue('-webkit-mask-image')
    if (!off(mask)) return 'clipped'
  }
  return opacity < leastOpacity ? 'faded' : null
}

/** Where a person could press on [host]: its corners, pulled in a little, and its centre. */
export function samplePoints(rect: {
  left: number
  top: number
  width: number
  height: number
}): [number, number][] {
  const inset = Math.min(4, rect.width / 4, rect.height / 4)
  const left = rect.left + inset
  const right = rect.left + rect.width - inset
  const top = rect.top + inset
  const bottom = rect.top + rect.height - inset
  return [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
  ]
}

/** Whether the topmost element at a point of the viewport is [host] (or inside it). */
export function onTopAt(host: Element, x: number, y: number, geometry: Geometry): boolean {
  const top = geometry.elementsAt(x, y)[0]
  return top === host || (top !== undefined && host.contains(top))
}

/**
 * Whether [host] is in plain view: shown, opaque, big enough, inside the viewport, and on top at
 * its corners and centre. [needSize] is the smallest it may be (a button has less than a menu).
 */
export function plainView(
  host: Element,
  geometry: Geometry,
  needSize: { width: number; height: number } = leastSize,
): Plain {
  if (!host.isConnected) return { ok: false, why: 'detached' }
  const style = styleVerdict(host)
  if (style !== null) return { ok: false, why: style }
  const rect = geometry.rect(host)
  if (rect.width < needSize.width || rect.height < needSize.height)
    return { ok: false, why: 'tiny' }
  const { width, height } = geometry.viewport()
  if (
    rect.left < 0 ||
    rect.top < 0 ||
    rect.left + rect.width > width ||
    rect.top + rect.height > height
  )
    return { ok: false, why: 'clipped' }
  for (const [x, y] of samplePoints(rect))
    if (!onTopAt(host, x, y, geometry)) return { ok: false, why: 'covered' }
  return { ok: true }
}

/** A click at [x], [y] (viewport pixels) counts only when the point is on [host] and it is in plain view. */
export function plainAt(
  host: Element,
  x: number,
  y: number,
  geometry: Geometry,
  needSize?: { width: number; height: number },
): Plain {
  const plain = plainView(host, geometry, needSize)
  if (!plain.ok) return plain
  return onTopAt(host, x, y, geometry) ? plain : { ok: false, why: 'covered' }
}

/** A string that changes when the host moves or is resized, so the menu restarts its delay. */
export function signatureOf(rect: { left: number; top: number; width: number; height: number }) {
  return [rect.left, rect.top, rect.width, rect.height].map((n) => Math.round(n)).join(',')
}
