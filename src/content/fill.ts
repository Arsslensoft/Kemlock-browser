// Putting a value in a field (design decision 4, steps 4 and 5): only a field the frame registered,
// still the same element, connected, visible and editable; set through the element's own value
// setter, which a page's framework can't have replaced, then the events a person's typing would
// have fired. A code in boxes takes one character each. Hidden fields never take a value (spec).

import { isVisible, pageGeometry, type Geometry } from './dom'
import type { Registered } from './scan'

/** The value setter of HTMLInputElement, taken once, before a page script could change it. */
const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

/** The most characters any fill takes, so a message can't push a page a megabyte. */
export const longestValue = 4096

/** Sets [input]'s value as typing would, for frameworks that watch `input` and `change`. */
export function setValue(input: HTMLInputElement, value: string): void {
  if (nativeSetter !== undefined) nativeSetter.call(input, value)
  else input.value = value
  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: value,
      inputType: 'insertReplacementText',
    }),
  )
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const canTakeText = (input: HTMLInputElement) => !input.disabled && !input.readOnly

/**
 * Fills [entry] with [value]: its one element, or one character into each of its boxes in order.
 * False, with nothing written, when any element of the entry is gone, hidden, covered or locked.
 */
export function fillEntry(entry: Registered, value: string, geometry?: Geometry): boolean {
  if (value.length === 0 || value.length > longestValue) return false
  const { elements } = entry
  if (elements.length === 0) return false
  for (const element of elements) {
    if (!element.isConnected || !canTakeText(element)) return false
    if (!isVisible(element, geometry ?? pageGeometry(element.ownerDocument))) return false
  }
  if (elements.length === 1) {
    setValue(elements[0], value)
    return true
  }
  const characters = Array.from(value)
  elements.forEach((element, i) => {
    if (i < characters.length) setValue(element, characters[i])
  })
  return true
}
