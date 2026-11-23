// Where Kemlock's button and menu frame go, as pure functions of boxes in the viewport, so they can
// be tested without a layout.

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** The button's side, in pixels, for a field of height [height]: 30 in the mockups' 44, never more than the field has. */
export const badgeSize = (height: number) =>
  Math.max(14, Math.min(30, Math.max(18, Math.round(height - 14)), height - 2))

/** The fields narrower than this get no button: it would sit on what the person types. */
export const narrowestField = 90

/**
 * The button's box inside [field], at its right edge and centred up and down. For a code in boxes
 * ([afterLast]), the button sits just past the last box, which has no room for it.
 */
export function placeBadge(field: Box, afterLast = false): Box | null {
  const side = badgeSize(field.height)
  if (!afterLast && field.width < narrowestField) return null
  if (field.height < 14) return null
  const top = field.top + (field.height - side) / 2
  const left = afterLast ? field.left + field.width + 4 : field.left + field.width - side - 6
  return { left, top, width: side, height: side }
}

/** The box that holds a code's boxes: from the first to the last. */
export function boundsOf(boxes: Box[]): Box {
  const left = Math.min(...boxes.map((b) => b.left))
  const top = Math.min(...boxes.map((b) => b.top))
  const right = Math.max(...boxes.map((b) => b.left + b.width))
  const bottom = Math.max(...boxes.map((b) => b.top + b.height))
  return { left, top, width: right - left, height: bottom - top }
}

const gap = 4
const margin = 4

/**
 * The menu frame's box: under [field] and aligned with its left edge, above it when there is no room
 * below and more above, always inside the viewport.
 */
export function placeMenu(field: Box, size: Size, viewport: Size): Box {
  const width = Math.min(size.width, viewport.width - 2 * margin)
  const height = Math.min(size.height, viewport.height - 2 * margin)
  const below = viewport.height - (field.top + field.height) - gap - margin
  const above = field.top - gap - margin
  let top: number
  if (height <= below || below >= above) top = field.top + field.height + gap
  else top = field.top - gap - height
  top = Math.max(margin, Math.min(top, viewport.height - height - margin))
  const left = Math.max(margin, Math.min(field.left, viewport.width - width - margin))
  return { left, top, width, height }
}

/** The save prompt's box: the top right corner of the page. */
export function placePrompt(size: Size, viewport: Size): Box {
  const width = Math.min(size.width, viewport.width - 2 * margin)
  const height = Math.min(size.height, viewport.height - 2 * margin)
  return { left: Math.max(margin, viewport.width - width - 16), top: 16, width, height }
}
