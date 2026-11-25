// Putting a card's or an identity's value in a field (design decision 4, steps 4 and 5, for fields that are not a plain input):
// only a field the frame registered, still the same element, connected, in view and editable; a text through the element's own
// value setter, then the events a person's typing would fire; a select by choosing the option the value names, by its value or
// its words, in either language for a country and a month.
import { countryNamed } from '../shared/countries'
import { pageGeometry, type Geometry } from './dom'
import { longestValue, setValue } from './fill'
import type { Registered } from './scan'
import { inReach, strictlyVisible, type Box } from './strict'

const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
const areaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

const fold = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The most values a fill may offer a select to choose from, and the longest each may be. */
export const mostAlternatives = 12
export const longestAlternative = 100

/**
 * The option of [select] that [value] names, or any of [alt] as a second choice: by its value or its words exactly, then by its
 * words beginning with it ("05 - May" for 05), then a country by either name or its code. An option with no value (the "Choose…"
 * one) and a disabled one are never chosen.
 */
export function chooseOption(
  select: HTMLSelectElement,
  value: string,
  alt: readonly string[] = [],
): HTMLOptionElement | undefined {
  const wanted = [value, ...alt].map(fold).filter((text) => text !== '')
  const options = Array.from(select.options).filter(
    (option) => !option.disabled && option.value !== '',
  )
  for (const want of wanted) {
    const exact = options.find(
      (option) => fold(option.value) === want || fold(option.text) === want,
    )
    if (exact !== undefined) return exact
  }
  // "05 - May" begins with 05, but "050" does not
  const begins = (text: string, want: string): boolean =>
    text.startsWith(want) && !/[a-z0-9]/.test(text.charAt(want.length))
  for (const want of wanted) {
    const found = options.find(
      (option) => begins(fold(option.text), want) || begins(fold(option.value), want),
    )
    if (found !== undefined) return found
  }
  // "May" is in "05 - May" and in "République française (France)", whole word and not "maybe"
  const holds = (text: string, want: string): boolean => {
    for (let at = text.indexOf(want); at >= 0; at = text.indexOf(want, at + 1)) {
      const edge = (char: string) => !/[a-z0-9]/.test(char)
      if (edge(text.charAt(at - 1)) && edge(text.charAt(at + want.length))) return true
    }
    return false
  }
  for (const want of wanted) {
    if (want.length < 3) continue
    const found = options.find((option) => holds(fold(option.text), want))
    if (found !== undefined) return found
  }
  for (const want of wanted) {
    const country = countryNamed(want)
    if (country === undefined) continue
    const found = options.find(
      (option) =>
        countryNamed(option.text)?.code === country.code ||
        countryNamed(option.value)?.code === country.code,
    )
    if (found !== undefined) return found
  }
  return undefined
}

/** Sets a text area's or a select's value as typing or choosing would, for frameworks that watch `input` and `change`. */
function setOther(element: HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const setter = element instanceof HTMLSelectElement ? selectSetter : areaSetter
  if (setter !== undefined) setter.call(element, value)
  else element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Fills the field of [entry] (a card's or an identity's) with [value], or, for a select, with the option [value] or [alt] names.
 * False, with nothing written, when the field is gone, hidden, covered or locked, or no option fits.
 */
export function fillFormEntry(
  entry: Registered,
  value: string,
  alt: readonly string[] = [],
  geometry?: Geometry,
  near?: Box,
): boolean {
  if (value.length === 0 || value.length > longestValue) return false
  const element = entry.elements[0]
  if (element === undefined || !element.isConnected || element.disabled) return false
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.readOnly
  )
    return false
  // Seen plainly, and in the viewport or near the field the person clicked: never a field a page hid or parked far away
  const place = geometry ?? pageGeometry(element.ownerDocument)
  if (!strictlyVisible(element, place) || !inReach(element, place, near)) return false
  if (element instanceof HTMLSelectElement) {
    const option = chooseOption(element, value, alt)
    if (option === undefined) return false
    setOther(element, option.value)
    return true
  }
  if (element instanceof HTMLTextAreaElement) setOther(element, value)
  else setValue(element, value)
  return true
}
