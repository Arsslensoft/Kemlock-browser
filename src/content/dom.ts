// Reads a frame's fields into the descriptions src/content/fields.ts takes
// (design decision 7): what each field says of itself, and whether the
// person can see it. Inside open shadow roots too.

import type { FieldDescription } from './fields'

/** Where things are on screen: the page's own, or a stand-in in the tests. */
export interface Geometry {
  rect(element: Element): { left: number; top: number; width: number; height: number }
  /** The elements at a point of the viewport, topmost first. */
  elementsAt(x: number, y: number): Element[]
  viewport(): { width: number; height: number }
}

export const pageGeometry = (doc: Document): Geometry => ({
  rect: (element) => element.getBoundingClientRect(),
  elementsAt: (x, y) => doc.elementsFromPoint(x, y),
  viewport: () => ({
    width: doc.defaultView?.innerWidth ?? 0,
    height: doc.defaultView?.innerHeight ?? 0,
  }),
})

// Inputs that never take text typed into them
const notText = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
])

/** Below this, with its ancestors', a field is faded out of sight. */
const leastOpacity = 0.1

/** Every text input of [root], in page order, inside open shadow roots too. */
function inputsOf(root: Document | ShadowRoot): HTMLInputElement[] {
  const out: HTMLInputElement[] = []
  const doc = root instanceof Document ? root : root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const element = node as Element
    if (element.localName === 'input' && !notText.has((element as HTMLInputElement).type))
      out.push(element as HTMLInputElement)
    if (element.shadowRoot) out.push(...inputsOf(element.shadowRoot))
  }
  return out
}

/** The element in focus, through open shadow roots. */
function focusedElement(doc: Document): Element | null {
  let active = doc.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

const text = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? ''

/** What [input] says of itself: its name and id, its placeholder, and what its labels and screen readers say. */
function wordsOf(input: HTMLInputElement): string[] {
  const root = input.getRootNode() as Document | ShadowRoot
  const labelled = (input.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => text(root.getElementById?.(id)?.textContent))
  return [
    input.getAttribute('name'),
    input.getAttribute('id'),
    input.getAttribute('placeholder'),
    input.getAttribute('aria-label'),
    ...Array.from(input.labels ?? [], (label) => text(label.textContent)),
    ...labelled,
  ].filter((word): word is string => word !== null && word.trim() !== '')
}

/** Whether the person can see [input]: on screen, shown, not faded out, and not covered at its centre. */
export function isVisible(input: Element, geometry: Geometry): boolean {
  const view = input.ownerDocument.defaultView
  if (view === null) return false
  const box = geometry.rect(input)
  if (box.width < 1 || box.height < 1) return false
  if (box.left + box.width <= 0 || box.top + box.height <= 0) return false
  const style = view.getComputedStyle(input)
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
  let opacity = 1
  for (let at: Element | null = input; at !== null; at = parentOf(at)) {
    const own = view.getComputedStyle(at)
    if (own.display === 'none') return false
    opacity *= Number.parseFloat(own.opacity || '1')
  }
  if (opacity <= leastOpacity) return false
  // On top at its centre, when the centre is in view
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  const { width, height } = geometry.viewport()
  if (x < 0 || y < 0 || x >= width || y >= height) return true
  const top = geometry.elementsAt(x, y)[0]
  return top === undefined || top === input || input.contains(top) || labelsOf(input).includes(top)
}

/** An element's parent, across a shadow root's boundary. */
function parentOf(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

const labelsOf = (element: Element): Element[] =>
  element instanceof HTMLInputElement ? Array.from(element.labels ?? []) : []

/** The frame's text inputs as the rules read them, each named by [nameOf]. */
export function readFields(
  doc: Document,
  nameOf: (input: HTMLInputElement) => string,
  geometry: Geometry = pageGeometry(doc),
): FieldDescription[] {
  const focused = focusedElement(doc)
  return inputsOf(doc).map((input) => {
    const maxLength = input.maxLength
    const inputMode = input.getAttribute('inputmode')?.toLowerCase()
    const rules = input.getAttribute('passwordrules')
    return {
      id: nameOf(input),
      tag: 'input',
      type: input.type,
      autocomplete: (input.getAttribute('autocomplete') ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
      ...(inputMode ? { inputMode } : {}),
      ...(maxLength > 0 ? { maxLength } : {}),
      words: wordsOf(input),
      ...(rules !== null ? { passwordRules: rules } : {}),
      visible: isVisible(input, geometry),
      focused: input === focused,
    }
  })
}

/** Names fields by the order the frame first showed them: f1, f2… Kept while the element lives. */
export function fieldNames(): (input: HTMLInputElement) => string {
  const names = new WeakMap<HTMLInputElement, string>()
  let next = 1
  return (input) => {
    let name = names.get(input)
    if (name === undefined) {
      name = `f${next++}`
      names.set(input, name)
    }
    return name
  }
}
