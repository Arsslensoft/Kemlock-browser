// A stricter test of what the person can see, for the fields a card or an identity fills (docs/plans/add-items.md): a page can hide
// a field from the person by many means that `isVisible` lets through (one pixel, far off the page, clipped away, almost
// transparent), and a card or an identity is more than a login's one value to hand to a field nobody can see. A field must be at
// least 8 by 8 pixels, inside the page's own extent, not clipped by any ancestor, and at least half opaque, and a fill reaches
// only fields in the viewport or near the field the person clicked.
import { isVisible, parentOf, type Geometry } from './dom'

/** The smallest a field may be drawn, in pixels, each way. */
export const leastFieldSize = 8

/** The least opacity a field may have, its ancestors' included. */
export const leastFieldOpacity = 0.5

/** How far from the clicked field a field may be to be filled with it when it is out of the viewport, in pixels. */
export const nearField = 600

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const none = (value: string | undefined) => !value || value === 'none' || value === 'auto'

/** Whether [outer] and [inner] share any area. */
const overlaps = (outer: Box, inner: Box): boolean =>
  inner.left < outer.left + outer.width &&
  inner.left + inner.width > outer.left &&
  inner.top < outer.top + outer.height &&
  inner.top + inner.height > outer.top

/**
 * Whether [element] is plainly in the person's sight: shown and uncovered (`isVisible`), at least 8 by 8 pixels, inside the page's
 * scroll extent and not off its top or left, with no ancestor that clips it away (a `clip-path`, a legacy `clip`, a filter or a
 * mask, or an `overflow: hidden` box with no size or none of the field in it), and at least half opaque all the way up.
 */
export function strictlyVisible(element: Element, geometry: Geometry): boolean {
  if (!isVisible(element, geometry)) return false
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (view === null) return false
  const box = geometry.rect(element)
  if (box.width < leastFieldSize || box.height < leastFieldSize) return false
  // In page coordinates: not off the top or the left, nor beyond the far edges of the page
  const { width, height } = geometry.viewport()
  const pageLeft = box.left + (view.scrollX || 0)
  const pageTop = box.top + (view.scrollY || 0)
  const extentWidth = Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth ?? 0, width)
  const extentHeight = Math.max(
    doc.documentElement.scrollHeight,
    doc.body?.scrollHeight ?? 0,
    height,
  )
  if (pageLeft + box.width <= 0 || pageTop + box.height <= 0) return false
  if (pageLeft >= extentWidth || pageTop >= extentHeight) return false
  let opacity = 1
  for (let at: Element | null = element; at !== null; at = parentOf(at)) {
    const style = view.getComputedStyle(at)
    opacity *= Number.parseFloat(style.opacity || '1')
    if (!none(style.getPropertyValue('clip-path')) || !none(style.getPropertyValue('filter')))
      return false
    const mask =
      style.getPropertyValue('mask-image') || style.getPropertyValue('-webkit-mask-image')
    if (!none(mask)) return false
    if (at !== element) {
      const absolute = style.position === 'absolute' || style.position === 'fixed'
      if (absolute && !none(style.getPropertyValue('clip'))) return false
      const clips =
        ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY)
      if (clips) {
        const own = geometry.rect(at)
        if (own.width < 1 || own.height < 1 || !overlaps(own, box)) return false
      }
    }
  }
  return opacity >= leastFieldOpacity
}

/**
 * Whether a fill may reach [element]: it is in the viewport, or within [nearField] pixels of [anchor], the field the person clicked.
 * Nothing farther is filled, so a field the person never saw cannot be handed their details because a page parked it far away.
 */
export function inReach(element: Element, geometry: Geometry, anchor?: Box): boolean {
  const box = geometry.rect(element)
  const { width, height } = geometry.viewport()
  if (overlaps({ left: 0, top: 0, width, height }, box)) return true
  if (anchor === undefined) return false
  return overlaps(
    {
      left: anchor.left - nearField,
      top: anchor.top - nearField,
      width: anchor.width + 2 * nearField,
      height: anchor.height + 2 * nearField,
    },
    box,
  )
}
