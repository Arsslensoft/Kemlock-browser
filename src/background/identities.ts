// Saving an identity after an address form was sent (docs/plans/add-items.md), as a card is saved after a checkout (cards.ts): what
// the form's identity fields said becomes a pending identity; when the next page has loaded the vault says whether it holds that
// person already, and the prompt offers to save them if not. There is no secret in it, but it is kept the same way: in memory-only
// session storage for five minutes, dropped when the vault locks.
import type { CoreApi, PendingSave } from '../shared/api'
import { countryStored } from '../shared/countries'
import { isNeverSave } from './prefs'
import { keepMs, type PendingIdentity } from './tabs'

/** What the content script says a form held in its identity fields (ContentApi.identitySent). */
export interface IdentitySentArgs {
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

const clip = (text: string, length: number): string => text.trim().slice(0, length)

/** The whole name a pending identity goes by. */
export const nameOfPending = (pending: PendingIdentity): string =>
  pending.full !== ''
    ? pending.full
    : [pending.given, pending.family].filter((part) => part !== '').join(' ')

/**
 * The pending identity a sent form makes, or null when it is not a person's details: a name, and an email address or a street, are
 * needed (the page checked too, and a page's word is not taken).
 */
export function pendingIdentityOf(
  sent: IdentitySentArgs,
  frame: { frameId: number; address: string; host: string },
  at: number,
): PendingIdentity | null {
  const pending: PendingIdentity = {
    given: clip(sent.given, 256),
    family: clip(sent.family, 256),
    full: clip(sent.full, 512),
    email: clip(sent.email, 320),
    phone: clip(sent.phone, 128),
    company: clip(sent.company, 512),
    line1: clip(sent.line1, 512),
    city: clip(sent.city, 256),
    postalCode: clip(sent.postalCode, 64),
    country: clip(sent.country, 256),
    ...frame,
    at,
  }
  const named = nameOfPending(pending) !== ''
  return named && (pending.email.includes('@') || pending.line1 !== '') ? pending : null
}

/** What the prompt says of a pending identity. */
export function identityOffer(pending: PendingIdentity): PendingSave {
  const address = [
    pending.line1,
    [pending.postalCode, pending.city].filter((part) => part !== '').join(' '),
  ]
    .filter((part) => part !== '')
    .join(', ')
  return {
    site: pending.host,
    username: '',
    identity: {
      name: nameOfPending(pending),
      ...(pending.email === '' ? {} : { email: pending.email }),
      ...(address === '' ? {} : { address }),
    },
  }
}

/**
 * What the vault says to a sent identity: null when nothing is to be asked (the vault holds that person already, by email or by
 * name and postal code; the offer is off; the host is one never to ask on; the identity is stale), else the offer.
 */
export async function offerForIdentity(
  core: CoreApi,
  pending: PendingIdentity,
  now: number,
): Promise<PendingSave | null> {
  if (now - pending.at > keepMs) return null
  if (!(await core.state()).unlocked) return null
  if (!(await core.settings()).offerToSave || (await isNeverSave(pending.host))) return null
  const email = pending.email.toLowerCase()
  const name = nameOfPending(pending).toLowerCase()
  for (const held of await core.identities()) {
    if (email !== '' && held.email?.toLowerCase() === email) return null
    if (
      email === '' &&
      (held.fullName ?? held.name).toLowerCase() === name &&
      (held.address?.postalCode ?? '') === pending.postalCode
    )
      return null
  }
  return identityOffer(pending)
}

/** Saves the pending identity as a new identity, named by the person's name. */
export async function saveIdentityFrom(core: CoreApi, pending: PendingIdentity): Promise<void> {
  const whole = nameOfPending(pending)
  // A form with one name field gives the family name its last word
  const cut = whole.lastIndexOf(' ')
  const split = pending.given === '' && pending.family === '' && cut > 0
  const given = split ? whole.slice(0, cut) : pending.given
  const family = split ? whole.slice(cut + 1) : pending.family
  const lines = pending.line1 === '' ? [] : [pending.line1]
  const country = pending.country === '' ? '' : countryStored(pending.country)
  await core.saveIdentity(null, {
    name: whole,
    ...(given === '' ? {} : { givenName: given }),
    ...(family === '' ? {} : { familyName: family }),
    ...(pending.company === '' ? {} : { company: pending.company }),
    ...(pending.email === '' ? {} : { email: pending.email }),
    ...(pending.phone === '' ? {} : { phone: pending.phone }),
    address: {
      lines,
      ...(pending.city === '' ? {} : { city: pending.city }),
      ...(pending.postalCode === '' ? {} : { postalCode: pending.postalCode }),
      ...(country === '' ? {} : { country }),
    },
  })
}
