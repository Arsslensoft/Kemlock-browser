// Seeing a card or an identity being sent (docs/plans/add-items.md, "Save this card to Kemlock?"), on the pattern of
// src/content/capture.ts: which values a form holds in the fields the rules found, and when a press on a button counts as sending
// it. The values go to the background at once, which decides whether to ask. Only a number that is plainly a card number is read at
// all, only a form with a name and an email or an address is an identity, nothing is kept, and a value is read when the form is sent.
import { cardDigits, luhnValid } from '../shared/card'
import { sendsForm, formOf } from './capture'
import { isVisible, type FieldElement, type Geometry } from './dom'
import type { Registry } from './scan'

/** What a form was sent with in its card fields; `''` for what it has no field for. */
export interface CardSent {
  number: string
  holder: string
  expiry: string
  month: string
  year: string
  code: string
}

/** Whether [element] is in [scope]: the form, or the whole frame for a form-less page. */
function within(scope: ParentNode | null, element: FieldElement): boolean {
  if (scope === null) return true
  if (scope instanceof HTMLFormElement) return element.form === scope || scope.contains(element)
  return scope.contains(element)
}

/** A select's value as a month or a year reads: its value when that is a number, else the number its words begin with. */
function numberOf(element: FieldElement): string {
  if (!(element instanceof HTMLSelectElement)) return element.value.trim()
  const value = element.value.trim()
  if (/^\d{1,4}$/.test(value)) return value
  return /^\d{1,4}/.exec(element.selectedOptions[0]?.text.trim() ?? '')?.[0] ?? ''
}

/** The values of the card fields in [scope]. Null unless there is a card number in them that passes the Luhn check. */
export function readCard(registry: Registry, scope: ParentNode | null): CardSent | null {
  const sent: CardSent = { number: '', holder: '', expiry: '', month: '', year: '', code: '' }
  for (const entry of registry.values()) {
    if (entry.kind !== 'card') continue
    const element = entry.elements[0]
    if (element === undefined || !within(scope, element)) continue
    switch (entry.part) {
      case 'cardNumber':
        sent.number ||= cardDigits(element.value)
        break
      case 'cardName':
        sent.holder ||= element.value.trim()
        break
      case 'cardExp':
        sent.expiry ||= element.value.trim()
        break
      case 'cardExpMonth':
        sent.month ||= numberOf(element)
        break
      case 'cardExpYear':
        sent.year ||= numberOf(element)
        break
      case 'cardCsc':
        sent.code ||= element.value.trim()
        break
      default:
        break
    }
  }
  return sent.number.length >= 12 && sent.number.length <= 19 && luhnValid(sent.number)
    ? sent
    : null
}

const sameCard = (a: CardSent, b: CardSent): boolean =>
  a.number === b.number && a.expiry === b.expiry && a.month === b.month && a.year === b.year

/** What a form was sent with in its identity fields; `''` for what it has no field for. */
export interface IdentitySent {
  given: string
  family: string
  full: string
  email: string
  phone: string
  company: string
  line1: string
  city: string
  postalCode: string
  country: string
}

/** A select's chosen option as the person reads it (its words), else a field's own text. */
function wordsOf(element: FieldElement): string {
  if (element instanceof HTMLSelectElement)
    return (element.selectedOptions[0]?.text ?? element.value).trim()
  return element.value.trim()
}

/**
 * The values of the identity fields in [scope]. Null unless there is a name in them and an email or a street: a form that is not
 * plainly a person's details is not offered.
 */
export function readIdentity(registry: Registry, scope: ParentNode | null): IdentitySent | null {
  const sent: IdentitySent = {
    given: '',
    family: '',
    full: '',
    email: '',
    phone: '',
    company: '',
    line1: '',
    city: '',
    postalCode: '',
    country: '',
  }
  for (const entry of registry.values()) {
    if (entry.kind !== 'identity') continue
    const element = entry.elements[0]
    if (element === undefined || !within(scope, element)) continue
    const value = wordsOf(element)
    switch (entry.part) {
      case 'givenName':
        sent.given ||= value
        break
      case 'familyName':
        sent.family ||= value
        break
      case 'fullName':
        sent.full ||= value
        break
      case 'email':
        sent.email ||= value
        break
      case 'phone':
        sent.phone ||= value
        break
      case 'company':
        sent.company ||= value
        break
      case 'line1':
      case 'street':
        sent.line1 ||= value
        break
      case 'city':
        sent.city ||= value
        break
      case 'postalCode':
        sent.postalCode ||= value
        break
      case 'country':
      case 'countryName':
        sent.country ||= value
        break
      default:
        break
    }
  }
  const named = sent.given !== '' || sent.family !== '' || sent.full !== ''
  return named && (sent.email.includes('@') || sent.line1 !== '') ? sent : null
}

const sameIdentity = (a: IdentitySent, b: IdentitySent): boolean =>
  a.email === b.email &&
  a.given === b.given &&
  a.family === b.family &&
  a.full === b.full &&
  a.line1 === b.line1

/** A press on a form's button that may be a send, until the page navigates or the form goes. */
interface Armed<T> {
  sent: T
  at: number
  form: HTMLFormElement | null
  elements: FieldElement[]
}

export const cardArmedForMs = 10_000
const sameSendMs = 3_000

/** Sees one kind of item being sent: what it reads, how two reads compare, and which registered fields are its own. */
export class Capture<T> {
  private armed: Armed<T> | null = null
  private last: { sent: T; at: number } | null = null

  constructor(
    private readonly kind: 'card' | 'identity',
    private readonly read: (registry: Registry, scope: ParentNode | null) => T | null,
    private readonly same: (a: T, b: T) => boolean,
    private readonly send: (sent: T) => void,
    private readonly geometry: () => Geometry,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private emit(sent: T | null): void {
    if (sent === null) return
    const now = this.now()
    if (this.last !== null && now - this.last.at < sameSendMs && this.same(this.last.sent, sent))
      return
    this.last = { sent, at: now }
    this.send(sent)
  }

  /** A form was submitted: send what its card fields hold. */
  submitted(event: Event, registry: Registry): void {
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    this.emit(this.read(registry, form))
    this.armed = null
  }

  /** A press on a button: a send, if the page then navigates or the form goes. */
  pressed(event: MouseEvent, registry: Registry, doc: Document): void {
    const target = event.composedPath()[0]
    if (!(target instanceof Element)) return
    const button = sendsForm(target)
    if (button === null) return
    const form = formOf(button)
    const sent = this.read(registry, form ?? doc)
    if (sent === null) return
    const elements = [...registry.values()]
      .filter((entry) => entry.kind === this.kind)
      .map((entry) => entry.elements[0])
      .filter((element) => form === null || element.form === form || form.contains(element))
    this.armed = { sent, at: this.now(), form, elements }
  }

  /** The page is leaving, or navigated: an armed press was a send. */
  navigated(): void {
    this.flush()
  }

  /** After a rescan: an armed press whose form is gone or hidden was a send. */
  afterScan(): void {
    const armed = this.armed
    if (armed === null) return
    if (this.now() - armed.at > cardArmedForMs) {
      this.armed = null
      return
    }
    const geometry = this.geometry()
    const gone =
      (armed.form !== null && !armed.form.isConnected) ||
      armed.elements.every((element) => !element.isConnected || !isVisible(element, geometry))
    if (gone && armed.elements.length > 0) this.flush()
  }

  private flush(): void {
    const armed = this.armed
    this.armed = null
    if (armed === null || this.now() - armed.at > cardArmedForMs) return
    this.emit(armed.sent)
  }
}

/** Sees a card being sent. */
export class CardCapture extends Capture<CardSent> {
  constructor(send: (sent: CardSent) => void, geometry: () => Geometry, now?: () => number) {
    super('card', readCard, sameCard, send, geometry, now)
  }
}

/** Sees an identity being sent. */
export class IdentityCapture extends Capture<IdentitySent> {
  constructor(send: (sent: IdentitySent) => void, geometry: () => Geometry, now?: () => number) {
    super('identity', readIdentity, sameIdentity, send, geometry, now)
  }
}
