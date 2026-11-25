// Notes, cards and identities as the popup's lists show them: searching, the order (pinned first, then the vault's own), and the
// short lines under a name. Pure, so the lists' tests need no page.
import type { CardView, IdentityView, NoteView } from '../shared/api'
import { monthYearText } from '../shared/card'
import { countryLabel } from '../shared/countries'

const contains = (haystack: (string | undefined)[], needle: string): boolean =>
  haystack.some((text) => text !== undefined && text.toLowerCase().includes(needle))

const query = (text: string) => text.trim().toLowerCase()

/** Pinned first, each group in the vault's own order, as the app lists them. */
export function pinnedFirst<T extends { pinned: boolean; order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order)
}

/** Search a note by its title (its text is never in a list). An empty query matches. */
export function noteMatches(note: NoteView, text: string): boolean {
  const needle = query(text)
  return needle === '' || contains([note.title], needle)
}

/** Search a card by name, cardholder, brand or last four digits. */
export function cardMatches(card: CardView, text: string): boolean {
  const needle = query(text)
  return needle === '' || contains([card.name, card.cardholder, card.brand, card.lastFour], needle)
}

/** Search an identity by name, the person's names, company, email or phone. */
export function identityMatches(identity: IdentityView, text: string): boolean {
  const needle = query(text)
  return (
    needle === '' ||
    contains(
      [
        identity.name,
        identity.fullName,
        identity.company,
        identity.email,
        identity.phone,
        identity.address?.city,
      ],
      needle,
    )
  )
}

/** "Visa •••• 1111 · 05/2029": what tells a card apart in a row. */
export function cardLine(card: CardView): string {
  const number =
    card.lastFour === undefined
      ? ''
      : `${card.brand === undefined ? '' : `${card.brand} `}•••• ${card.lastFour}`
  const expiry = monthYearText(card.expMonth, card.expYear)
  return [number, expiry].filter((part) => part !== '').join(' · ')
}

/** The line under an identity's name: its email, else its company, else its phone. */
export const identityLine = (identity: IdentityView): string =>
  identity.email ?? identity.company ?? identity.phone ?? ''

/** An address as lines to read: the street lines, then "postal code city", the region and the country. */
export function addressLines(
  address: NonNullable<IdentityView['address']>,
  language: string,
): string[] {
  return [
    ...address.lines,
    [address.postalCode, address.city]
      .filter((part) => part !== undefined && part !== '')
      .join(' '),
    address.region ?? '',
    address.country === undefined ? '' : countryLabel(address.country, language),
  ].filter((line) => line.trim() !== '')
}

/** Whether [text] is empty or a real calendar day written yyyy-mm-dd (the app's rule for birth dates and documents). */
export function dateOk(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return true
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (found === null) return false
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** A yyyy-mm-dd date as the browser's language writes it ("2 April 1990"); the text itself when it is not one. */
export function dateText(text: string, language: string): string {
  if (!dateOk(text) || text.trim() === '') return text
  const [year, month, day] = text.split('-').map(Number)
  return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}
