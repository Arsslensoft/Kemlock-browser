// Sends in the background (docs/plans/add-sends.md): what the popup and the Sends tab may ask, over the core. The core holds every key; this
// only checks who asks, keeps the vault's idle time, and puts what is copied on the clipboard that clears itself (decision 14): the
// owner's link goes from the core to the clipboard and to no page, and so does a received text on Copy.
import type { CoreApi, PageApi, PageRequest } from '../shared/api'
import {
  sendDraftKeepMs,
  sendNameMaxLength,
  sendsKeepAlivePort,
  type SendDraft,
  type SendResult,
} from '../shared/sends'
import type { ClipboardManager } from './clipboard'
import { BackgroundError } from './errors'
import { identifySender, type ExtensionPage, type Identity, type PageSender } from './senders'

/** The page requests this file answers. */
export type SendsKind =
  | 'sends'
  | 'sendGet'
  | 'sendCopyLink'
  | 'sendStageFile'
  | 'sendMake'
  | 'sendUpdate'
  | 'sendDelete'
  | 'sendOpen'
  | 'sendDownload'
  | 'sendReadFile'
  | 'sendCopyText'
  | 'sendClose'
  | 'sendFromNote'
  | 'sendTakeDraft'
  | 'sendSaveAsNote'

export type SendsHandlers = {
  [K in SendsKind]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<PageApi[K]>
}

/** What the background gives these handlers of its own. */
export interface SendsDeps {
  core: CoreApi
  clipboard: ClipboardManager
  /** The vault must be open (throws `noVault` or `locked`). */
  needOpen(): Promise<void>
  /** Kemlock was used: the idle time starts over. */
  touch(): Promise<void>
  /** The seconds the clipboard keeps what was copied (the setting). */
  clipboardSeconds(): Promise<number>
  /** A change was made to the vault: sync follows it. */
  changed(): Promise<void>
  /** The time, in milliseconds. */
  now(): number
  /** Asks to be called when the vault locks or goes, to let go of what it holds in memory. */
  onLock(forget: () => void): void
}

/** The note drafts the popup left for the Sends tab: held in memory only, taken once, kept two minutes, gone when the vault locks. */
interface Held {
  draft: SendDraft
  at: number
  /** Deletes the draft when its time is up, whether or not the tab asked. */
  timer: ReturnType<typeof setTimeout>
}

/** The name the note of a received Send has when the Send has none. */
const receivedNoteName = (): string => {
  let named = ''
  try {
    named = chrome.i18n.getMessage('sends_receivedNoteTitle')
  } catch {
    // No strings here: the English words below
  }
  return named === '' ? 'Received Send' : named
}

/** The popup lists, shows, copies, changes and deletes Sends; the Sends tab also makes them and opens a received one. */
const owners: readonly ExtensionPage[] = ['popup', 'sends']
const tabOnly: readonly ExtensionPage[] = ['sends']
const popupOnly: readonly ExtensionPage[] = ['popup']

export function sendsHandlers(deps: SendsDeps): SendsHandlers {
  const { core, clipboard } = deps
  const drafts = new Map<string, Held>()
  /** The names of the text Sends the tab has open, by handle: the note made of one is named after it, whatever the page says. */
  const received = new Map<string, string>()
  const forgetDrafts = () => {
    for (const held of drafts.values()) clearTimeout(held.timer)
    drafts.clear()
  }
  deps.onLock(() => {
    forgetDrafts()
    received.clear()
  })

  const allow = (sender: PageSender, pages: readonly ExtensionPage[]): void => {
    if (!pages.includes(sender.page)) throw new BackgroundError('refused')
  }
  /** Who may ask, the vault open and the idle time started over. */
  const begin = async (sender: PageSender, pages: readonly ExtensionPage[]): Promise<void> => {
    allow(sender, pages)
    await deps.needOpen()
    await deps.touch()
  }

  return {
    sends: async (_message, sender) => {
      await begin(sender, owners)
      return core.sendsList()
    },
    sendGet: async ({ id }, sender) => {
      await begin(sender, owners)
      return core.sendsGet(id)
    },
    sendCopyLink: async ({ id }, sender): Promise<SendResult<null>> => {
      await begin(sender, owners)
      const link = await core.sendsLink(id)
      if (!link.ok) return link
      await clipboard.copy(link.value, await deps.clipboardSeconds())
      return { ok: true, value: null }
    },
    sendStageFile: async ({ data, handle }, sender) => {
      await begin(sender, tabOnly)
      return core.sendsStageFile(data, handle ?? null)
    },
    sendMake: async ({ input }, sender): Promise<SendResult<{ id: string }>> => {
      await begin(sender, tabOnly)
      const made = await core.sendsMake(input)
      // The link stays here: the page asks for it to be copied
      return made.ok ? { ok: true, value: { id: made.value.id } } : made
    },
    sendUpdate: async ({ id, patch }, sender) => {
      await begin(sender, owners)
      return core.sendsUpdate(id, patch)
    },
    sendDelete: async ({ id }, sender) => {
      await begin(sender, owners)
      return core.sendsDelete(id)
    },
    sendOpen: async ({ link, password }, sender) => {
      await begin(sender, tabOnly)
      const opened = await core.sendsOpen(link, password)
      if (opened.ok && opened.value.kind === 'text')
        received.set(opened.value.handle, opened.value.name)
      return opened
    },
    sendDownload: async ({ handle }, sender) => {
      await begin(sender, tabOnly)
      return core.sendsDownload(handle)
    },
    sendReadFile: async ({ handle, index }, sender) => {
      await begin(sender, tabOnly)
      return core.sendsReadFile(handle, index)
    },
    sendCopyText: async ({ handle }, sender) => {
      await begin(sender, tabOnly)
      await clipboard.copy(await core.sendsReceivedText(handle), await deps.clipboardSeconds())
    },
    sendClose: async ({ handle }, sender) => {
      allow(sender, tabOnly)
      received.delete(handle)
      await core.sendsClose(handle)
    },
    sendFromNote: async ({ id }, sender): Promise<SendResult<{ token: string }>> => {
      await begin(sender, popupOnly)
      // Sends are Kemlock Server's: where the vault syncs with another place (or none), there is nothing to send to
      const status = await core.syncStatus()
      if (status === null || status.place !== 'kemlock')
        return { ok: false, problem: 'noSync', place: status === null ? null : status.place }
      const note = await core.revealNote(id)
      const now = deps.now()
      const token = crypto.randomUUID()
      // A draft is deleted when its two minutes are up, whether or not the tab came for it
      const timer = setTimeout(() => drafts.delete(token), sendDraftKeepMs)
      drafts.set(token, {
        draft: { name: note.title.slice(0, sendNameMaxLength), text: note.text },
        at: now,
        timer,
      })
      return { ok: true, value: { token } }
    },
    sendTakeDraft: async ({ token }, sender) => {
      await begin(sender, tabOnly)
      const held = drafts.get(token)
      // Once: whoever asks next, with this token or another, finds nothing
      drafts.delete(token)
      if (held === undefined) return null
      clearTimeout(held.timer)
      return deps.now() - held.at > sendDraftKeepMs ? null : held.draft
    },
    sendSaveAsNote: async ({ handle }, sender) => {
      await begin(sender, tabOnly)
      // The text comes from the core, which holds the received Send under the handle, and the title from the Send's own name as
      // the background saw it open: the page names neither
      const text = await core.sendsReceivedText(handle)
      const title =
        (received.get(handle) ?? '').trim().slice(0, sendNameMaxLength) || receivedNoteName()
      const saved = await core.saveNote(null, { title, text })
      await deps.changed()
      return { id: saved.id }
    },
  }
}

/**
 * A port from the Sends tab, which holds one open (and pings it) while a Send is open in it or a file is going up: a message on a port
 * starts the worker's idle time over, so what the core holds for the tab is not lost to a worker the browser stopped. Only the Sends
 * tab, by what the browser reports of it, is kept: any other connection is closed. Nothing is read from what it sends.
 */
export function acceptSendsPort(port: chrome.runtime.Port, self: Identity): void {
  const sender =
    port.name === sendsKeepAlivePort && port.sender !== undefined
      ? identifySender(port.sender, self)
      : null
  if (sender === null || sender.from !== 'page' || sender.page !== 'sends') {
    port.disconnect()
    return
  }
  port.onMessage.addListener(() => undefined)
}
