// Kemlock's button inside a field (spec "The button opens a menu the page can't read"): a small
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
  border-radius: 50%;
  background: #1f6feb;
  cursor: pointer;
}
button:hover, button:focus-visible { background: #1559c7; }
button:focus-visible { outline: 2px solid #5aa9ff; outline-offset: 1px; }
svg { width: 62%; height: 62%; display: block; }
`

const svgNs = 'http://www.w3.org/2000/svg'

function glyph(doc: Document): SVGElement {
  const svg = doc.createElementNS(svgNs, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const shackle = doc.createElementNS(svgNs, 'path')
  shackle.setAttribute('d', 'M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5')
  shackle.setAttribute('fill', 'none')
  shackle.setAttribute('stroke', '#ffffff')
  shackle.setAttribute('stroke-width', '2.4')
  shackle.setAttribute('stroke-linecap', 'round')
  const body = doc.createElementNS(svgNs, 'rect')
  body.setAttribute('x', '5')
  body.setAttribute('y', '10')
  body.setAttribute('width', '14')
  body.setAttribute('height', '10.5')
  body.setAttribute('rx', '2.4')
  body.setAttribute('fill', '#ffffff')
  svg.append(shackle, body)
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
