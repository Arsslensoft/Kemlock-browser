// The fake core's notes, cards and identities (docs/plans/add-items.md): the same views, validation and keeping of unedited fields
// as core/lib/src/vault_items.dart, over plain objects. Like the rest of the fake, it follows `CoreApi`'s contract, not the app's
// formats.
import type {
  CardFull,
  CardInput,
  CardView,
  IdentityDocumentFull,
  IdentityFull,
  IdentityInput,
  IdentityView,
  NoteFull,
  NoteInput,
  NoteView,
} from '../../shared/api'
import { cardDigits, cardNumberMaxDigits, cardNumberMinDigits, cardYear, isCardNumberText } from '../../shared/card'

/** A note as the fake keeps it: whole, with its files by name. */
export type StoredNote = NoteFull

/** What the fake's disk holds of these kinds. */
export interface ItemsDisk {
  notes: StoredNote[]
  cards: CardFull[]
  identities: IdentityFull[]
  nextId: number
}

export const emptyItems = (): ItemsDisk => ({ notes: [], cards: [], identities: [], nextId: 1 })

const noteTextLimit = 10_000

/** Epoch ms to the first of the month after the expiry, for "expired". */
const expiredAt = (month: number | undefined, year: number | undefined, now: number): boolean => {
  if (year === undefined) return false
  const today = new Date(now)
  if (today.getUTCFullYear() !== year) return today.getUTCFullYear() > year
  return month !== undefined && today.getUTCMonth() + 1 > month
}

const clean = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T

export class FakeItems {
  constructor(
    private readonly disk: () => ItemsDisk,
    private readonly now: () => number,
    private readonly fail: (word: string) => Error,
  ) {}

  private id(prefix: string): string {
    const items = this.disk()
    return `${prefix}-${items.nextId++}`
  }

  private text(value: string | undefined, what: string): string | undefined {
    const trimmed = (value ?? '').trim()
    if (trimmed.length > 2048) throw this.fail(`${what}TooLong`)
    return trimmed === '' ? undefined : trimmed
  }

  private find<T extends { id: string }>(list: T[], id: string): T {
    const found = list.find((item) => item.id === id)
    if (found === undefined) throw this.fail('notFound')
    return found
  }

  /* Notes ----------------------------------------------------------------------------------- */

  private noteView(note: StoredNote): NoteView {
    const { text: _text, attachments: _files, ...view } = note
    return { ...view, order: this.disk().notes.indexOf(note), files: note.attachments.length }
  }

  async notes(): Promise<NoteView[]> {
    return this.disk().notes.map((note) => this.noteView(note))
  }

  async revealNote(id: string): Promise<NoteFull> {
    const note = this.find(this.disk().notes, id)
    return structuredClone({ ...note, order: this.disk().notes.indexOf(note) })
  }

  async saveNote(id: string | null, input: NoteInput): Promise<NoteView> {
    const { notes } = this.disk()
    const title = (input.title ?? '').trim()
    if (title === '') throw this.fail('invalid')
    if (input.text.length > noteTextLimit) throw this.fail('invalid')
    const now = this.now()
    if (id === null) {
      const note: StoredNote = {
        id: this.id('note'),
        title,
        text: input.text,
        tags: [...(input.tags ?? [])],
        order: notes.length,
        pinned: input.pinned === true,
        files: 0,
        changedAt: now,
        attachments: [],
      }
      notes.push(note)
      return this.noteView(note)
    }
    const note = this.find(notes, id)
    note.title = title
    note.text = input.text
    if (input.tags !== undefined) note.tags = [...input.tags]
    if (input.pinned !== undefined) note.pinned = input.pinned
    note.changedAt = now
    return this.noteView(note)
  }

  async deleteNote(id: string): Promise<void> {
    const items = this.disk()
    items.notes = items.notes.filter((note) => note !== this.find(items.notes, id))
  }

  /* Cards ----------------------------------------------------------------------------------- */

  private cardView(card: CardFull): CardView {
    const { number, code, pin, ...view } = card
    return {
      ...view,
      ...(number === '' ? {} : { lastFour: number.slice(-4) }),
      order: this.disk().cards.indexOf(card),
      expired: expiredAt(card.expMonth, card.expYear, this.now()),
      hasNumber: number !== '',
      hasCode: code !== '',
      hasPin: pin !== '',
    }
  }

  async cards(): Promise<CardView[]> {
    return this.disk().cards.map((card) => this.cardView(card))
  }

  async revealCard(id: string): Promise<CardFull> {
    const card = this.find(this.disk().cards, id)
    return structuredClone({ ...card, order: this.disk().cards.indexOf(card) })
  }

  async saveCard(id: string | null, input: CardInput): Promise<CardView> {
    const { cards } = this.disk()
    const name = this.text(input.name, 'name')
    const holder = this.text(input.cardholder, 'cardholder')
    const numberText = input.number ?? ''
    if (!isCardNumberText(numberText)) throw this.fail('invalid')
    const digits = cardDigits(numberText)
    if (digits !== '' && (digits.length < cardNumberMinDigits || digits.length > cardNumberMaxDigits))
      throw this.fail('invalid')
    if (name === undefined || (digits === '' && holder === undefined)) throw this.fail('invalid')
    const year = input.expYear === undefined ? undefined : (cardYear(input.expYear) ?? undefined)
    if (input.expYear !== undefined && year === undefined) throw this.fail('invalid')
    const fromYear =
      input.validFromYear === undefined ? undefined : (cardYear(input.validFromYear) ?? undefined)
    if (input.validFromYear !== undefined && fromYear === undefined) throw this.fail('invalid')
    const fields = clean({
      name,
      cardholder: holder,
      brand: this.text(input.brand, 'brand'),
      expMonth: input.expMonth,
      expYear: year,
      validFromMonth: input.validFromMonth,
      validFromYear: fromYear,
      note: this.text(input.note, 'note'),
    })
    const secrets = { number: digits, code: input.code ?? '', pin: input.pin ?? '' }
    if (id === null) {
      const card: CardFull = {
        id: this.id('card'),
        ...fields,
        ...secrets,
        name,
        tags: [...(input.tags ?? [])],
        order: cards.length,
        pinned: input.pinned === true,
        expired: false,
        hasNumber: false,
        hasCode: false,
        hasPin: false,
        changedAt: this.now(),
      }
      cards.push(card)
      return this.cardView(card)
    }
    const card = this.find(cards, id)
    for (const key of [
      'cardholder',
      'brand',
      'expMonth',
      'expYear',
      'validFromMonth',
      'validFromYear',
      'note',
    ] as const)
      delete card[key]
    Object.assign(card, fields, secrets)
    if (input.tags !== undefined) card.tags = [...input.tags]
    if (input.pinned !== undefined) card.pinned = input.pinned
    card.changedAt = this.now()
    return this.cardView(card)
  }

  async deleteCard(id: string): Promise<void> {
    const items = this.disk()
    items.cards = items.cards.filter((card) => card !== this.find(items.cards, id))
  }

  /* Identities ------------------------------------------------------------------------------ */

  private identityView(identity: IdentityFull): IdentityView {
    const now = this.now()
    const today = new Date(now).toISOString().slice(0, 10)
    return {
      ...identity,
      order: this.disk().identities.indexOf(identity),
      documents: identity.documents.map(({ number, ...document }) => ({
        ...document,
        hasNumber: number !== '',
        expired: document.expiresOn !== undefined && document.expiresOn < today,
      })),
    }
  }

  async identities(): Promise<IdentityView[]> {
    return this.disk().identities.map((identity) => this.identityView(identity))
  }

  async revealIdentity(id: string): Promise<IdentityFull> {
    const identity = this.find(this.disk().identities, id)
    return structuredClone({ ...identity, order: this.disk().identities.indexOf(identity) })
  }

  async saveIdentity(id: string | null, input: IdentityInput): Promise<IdentityView> {
    const { identities } = this.disk()
    const name = this.text(input.name, 'name')
    if (name === undefined) throw this.fail('invalid')
    const lines = (input.address?.lines ?? []).map((line) => line.trim()).filter((line) => line !== '')
    if (lines.length > 3) throw this.fail('invalid')
    const address = clean({
      city: this.text(input.address?.city, 'city'),
      region: this.text(input.address?.region, 'region'),
      postalCode: this.text(input.address?.postalCode, 'postalCode'),
      country: this.text(input.address?.country, 'country'),
    })
    const hasAddress = lines.length > 0 || Object.keys(address).length > 0
    const given = this.text(input.givenName, 'givenName')
    const middle = this.text(input.middleName, 'middleName')
    const family = this.text(input.familyName, 'familyName')
    const details = clean({
      title: this.text(input.title, 'title'),
      givenName: given,
      middleName: middle,
      familyName: family,
      fullName: [given, middle, family].filter((part) => part !== undefined).join(' ') || undefined,
      company: this.text(input.company, 'company'),
      email: this.text(input.email, 'email'),
      phone: this.text(input.phone, 'phone'),
      username: this.text(input.username, 'username'),
      birthDate: this.text(input.birthDate, 'birthDate'),
      note: this.text(input.note, 'note'),
      ...(hasAddress ? { address: { lines, ...address } } : {}),
    })
    if (Object.keys(details).filter((key) => key !== 'fullName').length === 0)
      throw this.fail('invalid')
    const held = id === null ? undefined : this.find(identities, id)
    const documents: IdentityDocumentFull[] | undefined = input.documents?.map((document) => {
      if (document.number.trim() === '') throw this.fail('invalid')
      const existing = held?.documents.find((candidate) => candidate.id === document.id)
      return {
        ...clean({
          issuingCountry: this.text(document.issuingCountry, 'issuingCountry'),
          issuingAuthority: this.text(document.issuingAuthority, 'issuingAuthority'),
          issuedOn: this.text(document.issuedOn, 'issuedOn'),
          expiresOn: this.text(document.expiresOn, 'expiresOn'),
        }),
        id: existing?.id ?? this.id('document'),
        type: document.type,
        number: document.number.trim(),
        expired: false,
        hasNumber: true,
      }
    })
    if (held === undefined) {
      const identity: IdentityFull = {
        id: this.id('identity'),
        ...details,
        name,
        documents: documents ?? [],
        tags: [...(input.tags ?? [])],
        order: identities.length,
        pinned: input.pinned === true,
        changedAt: this.now(),
      }
      identities.push(identity)
      return this.identityView(identity)
    }
    for (const key of [
      'title',
      'givenName',
      'middleName',
      'familyName',
      'fullName',
      'company',
      'email',
      'phone',
      'username',
      'birthDate',
      'address',
      'note',
    ] as const)
      delete held[key]
    Object.assign(held, details, { name })
    if (documents !== undefined) held.documents = documents
    if (input.tags !== undefined) held.tags = [...input.tags]
    if (input.pinned !== undefined) held.pinned = input.pinned
    held.changedAt = this.now()
    return this.identityView(held)
  }

  async deleteIdentity(id: string): Promise<void> {
    const items = this.disk()
    items.identities = items.identities.filter((identity) => identity !== this.find(items.identities, id))
  }
}
