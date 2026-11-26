// File items and note attachments in the background (docs/plans/add-item-format.md): what the popup and the files tab may ask over
// the core. Only a vault that syncs with Kemlock Server holds file bytes, and the core holds them only while they are staged or
// opened: a file goes up in pieces of 1 MiB through `stageItemFile` and is sealed and uploaded when the item is saved, and comes
// down through `openItemFile` and `readOpened`. The core holds every key; this checks who asks, keeps the vault's idle time and
// tells sync that something changed. The files tab keeps the worker alive with a port, as the Sends tab does.
import type { PageApi, PageRequest } from '../shared/api'
import { itemFilesKeepAlivePort } from '../shared/item-files'
import type { ItemAccess } from './items'
import { identifySender, type ExtensionPage, type Identity, type PageSender } from './senders'

/** The page requests this file answers. */
export type ItemFilesKind =
  | 'files'
  | 'revealFile'
  | 'deleteFile'
  | 'saveFile'
  | 'stageItemFile'
  | 'releaseStaged'
  | 'addAttachments'
  | 'removeAttachment'
  | 'openItemFile'
  | 'readOpened'
  | 'closeOpened'

export type ItemFilesHandlers = {
  [K in ItemFilesKind]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<PageApi[K]>
}

/** Reading and changing a File item's details: the popup, the setup tab and the files tab. */
const everywhere: readonly ExtensionPage[] = ['popup', 'setup', 'files']
/** Choosing a file and sending its bytes: the files tab alone, which holds the keepalive port. */
const tabOnly: readonly ExtensionPage[] = ['files']
/** Reading a file the core opened, and removing an attachment: the popup downloads, and the files tab works over files. */
const popupAndTab: readonly ExtensionPage[] = ['popup', 'files']

export function itemFileHandlers(a: ItemAccess): ItemFilesHandlers {
  const { core } = a
  /** Who may ask, the vault open and the idle time started over. */
  const begin = async (sender: PageSender, allowed: readonly ExtensionPage[]): Promise<void> => {
    a.check(sender, allowed)
    await a.needOpen()
    await a.touch()
  }
  return {
    files: async (_message, sender) => {
      await begin(sender, everywhere)
      return core.files()
    },
    revealFile: async ({ id }, sender) => {
      await begin(sender, everywhere)
      return core.revealFile(id)
    },
    deleteFile: async ({ id }, sender) => {
      await begin(sender, everywhere)
      await core.deleteFile(id)
      await a.changed()
    },
    saveFile: async ({ id, input }, sender) => {
      // Changing a file's details is anyone's; one that carries a file is the files tab's, which holds the keepalive port
      await begin(sender, input.staged === undefined ? everywhere : tabOnly)
      const saved = await core.saveFile(id, input)
      await a.changed()
      return saved
    },
    stageItemFile: async ({ data, handle }, sender) => {
      await begin(sender, tabOnly)
      return core.stageItemFile(data, handle ?? null)
    },
    releaseStaged: async ({ handle }, sender) => {
      a.check(sender, tabOnly)
      await core.releaseStaged(handle)
    },
    addAttachments: async ({ noteId, files }, sender) => {
      await begin(sender, tabOnly)
      const note = await core.addAttachments(noteId, files)
      await a.changed()
      return note
    },
    removeAttachment: async ({ noteId, attachmentId }, sender) => {
      await begin(sender, popupAndTab)
      const note = await core.removeAttachment(noteId, attachmentId)
      await a.changed()
      return note
    },
    openItemFile: async ({ ref, attachmentId }, sender) => {
      await begin(sender, popupAndTab)
      return core.openItemFile(ref, attachmentId)
    },
    readOpened: async ({ handle, index }, sender) => {
      await begin(sender, popupAndTab)
      return core.readOpened(handle, index)
    },
    closeOpened: async ({ handle }, sender) => {
      // As Sends' close: letting go of a handle needs no open vault (a locked core holds nothing)
      a.check(sender, popupAndTab)
      await core.closeOpened(handle)
    },
  }
}

/**
 * A port from the files tab, which holds one open (and pings it) while a file is staged, uploading or being read in it: a message on
 * a port starts the worker's idle time over, so what the core holds for the tab is not lost to a worker the browser stopped. Only
 * the files tab, by what the browser reports of it, is kept: any other connection is closed. Nothing is read from what it sends.
 */
export function acceptItemFilesPort(port: chrome.runtime.Port, self: Identity): void {
  const sender =
    port.name === itemFilesKeepAlivePort && port.sender !== undefined
      ? identifySender(port.sender, self)
      : null
  if (sender === null || sender.from !== 'page' || sender.page !== 'files') {
    port.disconnect()
    return
  }
  port.onMessage.addListener(() => undefined)
}
