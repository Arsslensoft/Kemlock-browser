// Reads a frame's inputs, selects and text areas into the descriptions src/content/forms.ts takes: what each says of itself, what
// format it shows, which form it is in, and whether the person can see it. Inside open shadow roots too.
import { pageGeometry, parentOf, type FieldElement, type Geometry } from './dom'
import { sectionOf, type FormDescription } from './forms'
import { strictlyVisible } from './strict'

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

const text = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? ''

/** Every input, select and text area of [root] that can take a value, in page order, inside open shadow roots too. */
function controlsOf(root: Document | ShadowRoot): FieldElement[] {
  const out: FieldElement[] = []
  const doc = root instanceof Document ? root : root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const element = node as Element
    const tag = element.localName
    if (tag === 'input' && !notText.has((element as HTMLInputElement).type))
      out.push(element as HTMLInputElement)
    else if (tag === 'select' || tag === 'textarea') out.push(element as FieldElement)
    if (element.shadowRoot) out.push(...controlsOf(element.shadowRoot))
  }
  return out
}

/** What [element] says of itself: its name and id, placeholder, title and what its labels and screen readers say. */
function wordsOf(element: FieldElement): string[] {
  const root = element.getRootNode() as Document | ShadowRoot
  const labelled = (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => text(root.getElementById?.(id)?.textContent))
  return [
    element.getAttribute('name'),
    element.getAttribute('id'),
    element.getAttribute('placeholder'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    ...Array.from(element.labels ?? [], (label) => text(label.textContent)),
    ...labelled,
  ].filter((word): word is string => word !== null && word.trim() !== '')
}

/** The element in focus, through open shadow roots. */
function focusedElement(doc: Document): Element | null {
  let active = doc.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

/**
 * What a field shows of the format it wants, as `;`-joined tokens: `len:5` (its `maxlength`), `year:2` or `year:4` and `sep:/`,
 * `sep:-` or `sep:n` (none) from what its placeholder shows, and `select`, `area` or `date` for what it is. The background shapes
 * an expiry or a date to it; nothing here can make it fill more than it was asked to.
 */
export function formatOf(element: FieldElement): string {
  if (element instanceof HTMLSelectElement) return 'select'
  if (element instanceof HTMLTextAreaElement) return 'area'
  if (element.type === 'date') return 'date'
  const tokens: string[] = []
  if (element.maxLength > 0) tokens.push(`len:${element.maxLength}`)
  const shape =
    `${element.getAttribute('placeholder') ?? ''} ${element.getAttribute('aria-label') ?? ''}`.toLowerCase()
  if (/(?:y{4}|a{4}|j{4})/.test(shape)) tokens.push('year:4')
  else if (/\b(?:yy|aa)\b|(?:mm|mois)\s*(?:yy|aa)/.test(shape)) tokens.push('year:2')
  if (shape.includes('/')) tokens.push('sep:/')
  else if (shape.includes('-')) tokens.push('sep:-')
  else if (/\b(?:mm|mois)\s*(?:yy|aa)/.test(shape)) tokens.push('sep:n')
  return tokens.join(';')
}

const containers = 'fieldset, section, article, dialog, [role="group"], [role="form"]'

/** The nearest fieldset, section or group a field with no form sits in, within a few levels; null when there is none. */
function containerOf(element: Element): Element | null {
  let at = parentOf(element)
  for (let level = 0; at !== null && level < 6; level += 1) {
    if (at.matches(containers)) return at
    at = parentOf(at)
  }
  return null
}

/**
 * The block a field is in: its form's number in the frame (or, with no form, its fieldset's or section's), and its
 * `autocomplete` section (`2:shipping`). Fields with neither are block 0.
 */
function groupOf(element: FieldElement, blocks: Map<Element, number>, tokens: string[]): string {
  const owner = element.form ?? containerOf(element)
  let at = 0
  if (owner !== null) {
    if (!blocks.has(owner)) blocks.set(owner, blocks.size + 1)
    at = blocks.get(owner) ?? 0
  }
  const section = sectionOf(tokens)
  return (section === '' ? String(at) : `${at}:${section}`).slice(0, 32)
}

/** The frame's controls as the rules read them, each named by [nameOf]. */
export function readFormFields(
  doc: Document,
  nameOf: (element: FieldElement) => string,
  geometry: Geometry = pageGeometry(doc),
): FormDescription[] {
  const focused = focusedElement(doc)
  const forms = new Map<Element, number>()
  return controlsOf(doc).map((element) => {
    const tag = element.localName
    const maxLength = element instanceof HTMLSelectElement ? -1 : element.maxLength
    const inputMode = element.getAttribute('inputmode')?.toLowerCase()
    const autocomplete = (element.getAttribute('autocomplete') ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    return {
      id: nameOf(element),
      tag,
      type: element instanceof HTMLInputElement ? element.type : tag,
      autocomplete,
      ...(inputMode ? { inputMode } : {}),
      ...(maxLength > 0 ? { maxLength } : {}),
      words: wordsOf(element),
      // A card or an identity is handed only to a field the person plainly sees (src/content/strict.ts)
      visible: strictlyVisible(element, geometry),
      focused: element === focused,
      group: groupOf(element, forms, autocomplete),
      format: formatOf(element),
    }
  })
}
