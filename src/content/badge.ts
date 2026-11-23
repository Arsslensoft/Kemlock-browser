// Kemlock's button inside a field (spec "The button opens a menu the page can't read"; the mockups' Parts: the
// favicon mark, 30px in a 44px field, faint until it is pointed at): a small
// button in a closed shadow root, fixed in the viewport over the field's right edge, which the
// controller moves as the page scrolls, resizes and changes. The page can't reach inside it, and a
// press counts only when it is a person's (`isTrusted`) on a button in plain view (decision 9).

import type { Box } from './place'

const hostStyle = `
:host {
  position: fixed !important;
  left: var(--kemlock-left, 0px) !important;
  top: var(--kemlock-top, 0px) !important;
  width: var(--kemlock-width, 20px) !important;
  height: var(--kemlock-height, 20px) !important;
  right: auto !important;
  bottom: auto !important;
  z-index: 2147483646 !important;
  display: var(--kemlock-show, block) !important;
  opacity: 1 !important;
  visibility: visible !important;
  filter: none !important;
  clip-path: none !important;
  mask: none !important;
  transform: none !important;
  mix-blend-mode: normal !important;
  pointer-events: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
}
button {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 27%;
  background: transparent;
  opacity: 0.7;
  cursor: pointer;
}
button:hover, button:focus-visible {
  opacity: 1;
  background: #eef3fd;
  box-shadow: 0 0 0 1px rgba(31, 111, 235, 0.35);
}
button:focus-visible { outline: 2px solid #5aa9ff; outline-offset: 1px; }
svg { width: 60%; height: 60%; display: block; }
`

const svgNs = 'http://www.w3.org/2000/svg'

function node(doc: Document, name: string, attributes: Record<string, string>): SVGElement {
  const element = doc.createElementNS(svgNs, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
  return element
}

/** The Kemlock mark the mockups put in a field: the gunmetal tile and the azure keyhole K (the favicon, src/shared/brand). */
function glyph(doc: Document): SVGElement {
  const svg = node(doc, 'svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' })
  // The favicon's steel tile in flat bands: a gradient in the page's own layers makes the browser report the
  // menu frame visible about 200ms late, and the click gate counts from that report
  const tile = node(doc, 'rect', { width: '100', height: '100', rx: '22.5', fill: '#1e2126' })
  const sheen = node(doc, 'path', {
    d: 'M0 50V22.5A22.5 22.5 0 0 1 22.5 0h55A22.5 22.5 0 0 1 100 22.5V50z',
    fill: '#3b4048',
  })
  const seam = node(doc, 'rect', { y: '47', width: '100', height: '6', fill: '#15181c' })
  const mark = node(doc, 'g', { transform: 'translate(-2 0)' })
  mark.append(
    node(doc, 'path', {
      fill: '#5AA9FF',
      'fill-rule': 'evenodd',
      d: 'M28 20h9a4 4 0 0 1 4 4v52a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z',
    }),
    node(doc, 'path', {
      d: 'M72 26L48 50l24 24',
      fill: 'none',
      stroke: '#5AA9FF',
      'stroke-width': '16',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  )
  svg.append(tile, sheen, seam, mark)
  return svg
}

export class Badge {
  readonly host: HTMLElement

  constructor(doc: Document, label: string, onPress: (event: MouseEvent) => void) {
    this.host = doc.createElement('div')
    const root = this.host.attachShadow({ mode: 'closed' })
    const style = doc.createElement('style')
    style.textContent = hostStyle
    const button = doc.createElement('button')
    button.type = 'button'
    button.tabIndex = -1
    button.setAttribute('aria-label', label)
    button.title = label
    button.append(glyph(doc))
    // Pressing it must not take the field's focus from it
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', onPress)
    root.append(style, button)
  }

  /** Puts the button at [box] in the viewport, or hides it when [box] is null. */
  place(box: Box | null): void {
    const style = this.host.style
    if (box === null) {
      style.setProperty('--kemlock-show', 'none')
      return
    }
    style.setProperty('--kemlock-show', 'block')
    style.setProperty('--kemlock-left', `${Math.round(box.left)}px`)
    style.setProperty('--kemlock-top', `${Math.round(box.top)}px`)
    style.setProperty('--kemlock-width', `${Math.round(box.width)}px`)
    style.setProperty('--kemlock-height', `${Math.round(box.height)}px`)
  }
}
