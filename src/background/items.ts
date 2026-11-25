// What the extension's pages ask of notes, cards and identities (docs/plans/add-items.md): the lists, the reveal for an edit page,
// saving and deleting, one hidden field at a time for a page that shows it, and the text a copy puts on the clipboard. The core
// does the work; this checks the sender and the vault, and tells sync that something changed.
import type { CoreApi, ItemSecret, PageApi, PageRequest } from '../shared/api'
import { BackgroundError } from './errors'
import type { ExtensionPage, PageSender } from './senders'

export type ItemKind =
  | 'notes'
  | 'revealNote'
  | 'saveNote'
  | 'deleteNote'
  | 'cards'
  | 'revealCard'
  | 'saveCard'
  | 'deleteCard'
  | 'identities'
  | 'revealIdentity'
  | 'saveIdentity'
  | 'deleteIdentity'
  | 'showSecret'

export type ItemHandlers = {
  [K in ItemKind]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<PageApi[K]>
}

/** What the handlers need of the background: the core, and the steps every request takes. */
export interface ItemAccess {
  core: CoreApi
  /** Throws unless the sender is one of the pages that may ask. */
  check(sender: PageSender, allowed: readonly ExtensionPage[]): void
  /** The vault must be open to go on. */
  needOpen(): Promise<void>
  /** Kemlock was used: the idle time starts over. */
  touch(): Promise<void>
  /** Something changed in the browser: sync follows shortly. */
  changed(): Promise<void>
}

const pages: readonly ExtensionPage[] = ['popup', 'setup']

/** The item requests of the popup and the setup tab. */
export function itemHandlers(a: ItemAccess): ItemHandlers {
  const { core } = a
  const read = async (sender: PageSender): Promise<void> => {
    a.check(sender, pages)
    await a.needOpen()
    await a.touch()
  }
  const write = async (sender: PageSender): Promise<void> => {
    a.check(sender, pages)
    await a.needOpen()
  }
  return {
    notes: async (_message, sender) => {
      await read(sender)
      return core.notes()
    },
    revealNote: async ({ id }, sender) => {
      await read(sender)
      return core.revealNote(id)
    },
    saveNote: async ({ id, input }, sender) => {
      await write(sender)
      const saved = await core.saveNote(id, input)
      await a.changed()
      return saved
    },
    deleteNote: async ({ id }, sender) => {
      await write(sender)
      await core.deleteNote(id)
      await a.changed()
    },
    cards: async (_message, sender) => {
      await read(sender)
      return core.cards()
    },
    revealCard: async ({ id }, sender) => {
      await read(sender)
      return core.revealCard(id)
    },
    saveCard: async ({ id, input }, sender) => {
      await write(sender)
      const saved = await core.saveCard(id, input)
      await a.changed()
      return saved
    },
    deleteCard: async ({ id }, sender) => {
      await write(sender)
      await core.deleteCard(id)
      await a.changed()
    },
    identities: async (_message, sender) => {
      await read(sender)
      return core.identities()
    },
    revealIdentity: async ({ id }, sender) => {
      await read(sender)
      return core.revealIdentity(id)
    },
    saveIdentity: async ({ id, input }, sender) => {
      await write(sender)
      const saved = await core.saveIdentity(id, input)
      await a.changed()
      return saved
    },
    deleteIdentity: async ({ id }, sender) => {
      await write(sender)
      await core.deleteIdentity(id)
      await a.changed()
    },
    showSecret: async ({ what, id, documentId }, sender) => {
      await read(sender)
      const text = await secretText(core, what, id, documentId)
      if (text === undefined) throw new BackgroundError('failed')
      return text
    },
  }
}

/** One hidden field of an item: a card's number, security code or PIN, or the number of one of an identity's documents. */
export async function secretText(
  core: CoreApi,
  what: ItemSecret,
  id: string,
  documentId?: string,
): Promise<string | undefined> {
  if (what === 'documentNumber') {
    const identity = await core.revealIdentity(id)
    return identity.documents.find((document) => document.id === documentId)?.number
  }
  const card = await core.revealCard(id)
  return what === 'cardNumber' ? card.number : what === 'cardCode' ? card.code : card.pin
}

/** What a copy of an item's field puts on the clipboard, or undefined when the item has none. */
export async function copyText(
  core: CoreApi,
  what: string,
  id: string,
  documentId?: string,
): Promise<string | undefined> {
  switch (what) {
    case 'cardNumber':
    case 'cardCode':
    case 'cardPin':
    case 'documentNumber':
      return secretText(core, what, id, documentId)
    case 'cardholder':
      return (await core.revealCard(id)).cardholder
    case 'email':
      return (await core.revealIdentity(id)).email
    case 'phone':
      return (await core.revealIdentity(id)).phone
    case 'noteText':
      return (await core.revealNote(id)).text
    default:
      return undefined
  }
}

/** The copy requests that are for notes, cards and identities. */
export const itemCopies: ReadonlySet<string> = new Set([
  'cardNumber',
  'cardCode',
  'cardPin',
  'cardholder',
  'email',
  'phone',
  'documentNumber',
  'noteText',
])
