// Saving a card after a checkout (docs/plans/add-items.md), on the pattern of saving a login (design decision 10): what a sent form's
// card fields said becomes a pending card; when the next page has loaded the vault says whether it already holds that card, and
// the prompt offers to save it if not. The card is read again from what is pending when the person says yes, never from the prompt.
import type { CoreApi, PendingSave } from '../shared/api'
import {
  cardBrandOf,
  cardDigits,
  cardYear,
  luhnValid,
  monthYearText,
  parseCardExpiry,
} from '../shared/card'
import { isNeverSave } from './prefs'
import { keepMs, type PendingCard } from './tabs'

/** What the content script says a form held in its card fields (ContentApi.cardSent). */
export interface CardSentArgs {
  number: string
  holder: string
  expiry: string
  month: string
  year: string
  code: string
}

/** A month from the text of a field: one or two digits, 1 to 12. */
const monthOf = (text: string): number | undefined => {
  const month = /^\d{1,2}$/.test(text.trim()) ? Number(text) : Number.NaN
  return month >= 1 && month <= 12 ? month : undefined
}

/**
 * The pending card a sent form makes, or null when it is not a card worth offering: the number must be 12 to 19 digits that pass the
 * Luhn check (the page checked too, and a page's word is not taken). The expiry is read from the one field, else from the month and
 * the year fields.
 */
export function pendingCardOf(
  sent: CardSentArgs,
  frame: { frameId: number; address: string; host: string },
  at: number,
): PendingCard | null {
  const number = cardDigits(sent.number)
  if (number.length < 12 || number.length > 19 || !luhnValid(number)) return null
  const expiry = parseCardExpiry(sent.expiry)
  const month = expiry.month ?? monthOf(sent.month)
  const year =
    expiry.year ??
    cardYear(/^\d{2}(\d{2})?$/.test(sent.year.trim()) ? Number(sent.year) : null) ??
    undefined
  const brand = cardBrandOf(number)
  return {
    number,
    holder: sent.holder.trim().slice(0, 256),
    ...(month === undefined ? {} : { month }),
    ...(year === undefined ? {} : { year }),
    code: /^\d{3,4}$/.test(sent.code.trim()) ? sent.code.trim() : '',
    ...(brand === null ? {} : { brand }),
    ...frame,
    at,
  }
}

/** What the prompt says of a pending card: never its number or code. */
export function cardOffer(pending: PendingCard): PendingSave {
  const expiry = monthYearText(pending.month, pending.year)
  return {
    site: pending.host,
    username: '',
    card: {
      ...(pending.brand === undefined ? {} : { brand: pending.brand }),
      lastFour: pending.number.slice(-4),
      ...(pending.holder === '' ? {} : { holder: pending.holder }),
      ...(expiry === '' ? {} : { expiry }),
    },
  }
}

/**
 * What the vault says to a sent card: null when nothing is to be asked (the vault holds that card already, the offer is off, the host
 * is one never to ask on, or the card is stale), else the offer.
 */
export async function offerForCard(
  core: CoreApi,
  pending: PendingCard,
  now: number,
): Promise<PendingSave | null> {
  if (now - pending.at > keepMs) return null
  if (!(await core.state()).unlocked) return null
  if (!(await core.settings()).offerToSave || (await isNeverSave(pending.host))) return null
  const lastFour = pending.number.slice(-4)
  for (const card of await core.cards()) {
    if (card.lastFour !== lastFour) continue
    if ((await core.revealCard(card.id)).number === pending.number) return null
  }
  return cardOffer(pending)
}

/** Saves the pending card as a new card, named by its brand and last four digits. */
export async function saveCard(core: CoreApi, pending: PendingCard): Promise<void> {
  const brand = pending.brand ?? chrome.i18n.getMessage('items_cardNameDefault')
  await core.saveCard(null, {
    name: `${brand} •••• ${pending.number.slice(-4)}`,
    ...(pending.holder === '' ? {} : { cardholder: pending.holder }),
    number: pending.number,
    ...(pending.brand === undefined ? {} : { brand: pending.brand }),
    ...(pending.month === undefined ? {} : { expMonth: pending.month }),
    ...(pending.year === undefined ? {} : { expYear: pending.year }),
    ...(pending.code === '' ? {} : { code: pending.code }),
    fromAutofill: true,
  })
}
