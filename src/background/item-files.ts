// File items and note attachments in the background (docs/plans/add-item-format.md): what the popup and the files tab may ask over
// the core. Only a vault that syncs with Kemlock Server holds file bytes, and the core holds them only while they are staged or
// opened: a file goes up in pieces of 1 MiB through `stageItemFile` and is sealed and uploaded when the item is saved, and comes
// down through `openItemFile` and `readOpened`. The core holds every key; this checks who asks, keeps the vault's idle time and
// tells sync that something changed. The files tab keeps the worker alive with a port, as the Sends tab does, and the popup holds one
// while it downloads; a page whose port closes mid-transfer has the handles it made let go, so they do not fill the core's four.
import type { CoreApi, PageApi, PageRequest } from '../shared/api'
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

/** The page a message or a port is from, as one key: its name, its tab and its frame. */
const keyOf = (sender: PageSender): string =>
  `${sender.page}:${sender.tabId ?? ''}:${sender.frameId ?? ''}`

/** The most handles of a kind remembered for a page (the core holds four of each). */
const rememberedMost = 8

/**
 * The staged and opened handles each page made, and the ports each holds open. When the last port of a page closes (the tab or the popup
 * went away, mid-transfer or not) the handles it still holds are let go, so a closed popup or tab cannot fill the core's room for files.
 */
export class ItemFileHandles {
  constructor(private readonly core: Pick<CoreApi, 'releaseStaged' | 'closeOpened'>) {}

  private readonly staged = new Map<string, Set<string>>()
  private readonly opened = new Map<string, Set<string>>()
  private readonly ports = new Map<string, number>()

  private remember(of: Map<string, Set<string>>, sender: PageSender, handle: string): void {
    const key = keyOf(sender)
    const held = of.get(key) ?? new Set<string>()
    held.delete(handle)
    held.add(handle)
    // The core drops its oldest of a kind past four, so the oldest need not be remembered either
    while (held.size > rememberedMost) held.delete(held.values().next().value!)
    of.set(key, held)
  }

  private forget(of: Map<string, Set<string>>, handle: string): void {
    for (const held of of.values()) held.delete(handle)
  }

  /** The sender staged this file. */
  stagedBy(sender: PageSender, handle: string): void {
    this.remember(this.staged, sender, handle)
  }

  /** The file was released, or went into an item. */
  unstaged(handle: string): void {
    this.forget(this.staged, handle)
  }

  /** The sender opened this file for reading. */
  openedBy(sender: PageSender, handle: string): void {
    this.remember(this.opened, sender, handle)
  }

  /** The file was closed. */
  closed(handle: string): void {
    this.forget(this.opened, handle)
  }

  /** How many handles a page is remembered to hold, for the tests. */
  heldBy(sender: PageSender): { staged: number; opened: number } {
    const key = keyOf(sender)
    return { staged: this.staged.get(key)?.size ?? 0, opened: this.opened.get(key)?.size ?? 0 }
  }

  /** A page holds one more port. */
  connected(sender: PageSender): void {
    const key = keyOf(sender)
    this.ports.set(key, (this.ports.get(key) ?? 0) + 1)
  }

  /** A port of the page closed; with the last one, what the page made is let go. Never throws. */
  async disconnected(sender: PageSender): Promise<void> {
    const key = keyOf(sender)
    const left = (this.ports.get(key) ?? 1) - 1
    if (left > 0) {
      this.ports.set(key, left)
      return
    }
    this.ports.delete(key)
    const staged = [...(this.staged.get(key) ?? [])]
    const opened = [...(this.opened.get(key) ?? [])]
    this.staged.delete(key)
    this.opened.delete(key)
    for (const handle of staged) await this.core.releaseStaged(handle).catch(() => undefined)
    for (const handle of opened) await this.core.closeOpened(handle).catch(() => undefined)
  }
}

/** Reading and changing a File item's details: the popup, the setup tab and the files tab. */
const everywhere: readonly ExtensionPage[] = ['popup', 'setup', 'files']
/** Choosing a file and sending its bytes: the files tab alone, which holds the keepalive port. */
const tabOnly: readonly ExtensionPage[] = ['files']
/** Reading a file the core opened, and removing an attachment: the popup downloads, and the files tab works over files. */
const popupAndTab: readonly ExtensionPage[] = ['popup', 'files']

export function itemFileHandlers(
  a: ItemAccess,
  handles: ItemFileHandles = new ItemFileHandles(a.core),
): ItemFilesHandlers {
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
      // The core writes (and syncs) before it answers `failed`, so sync is told whether the call went through or not
      try {
        const saved = await core.saveFile(id, input)
        // The file went into the item: the core let its staged copy go
        if (input.staged !== undefined) handles.unstaged(input.staged.handle)
        return saved
      } finally {
        await a.changed()
      }
    },
    stageItemFile: async ({ data, handle }, sender) => {
      await begin(sender, tabOnly)
      const staged = await core.stageItemFile(data, handle ?? null)
      handles.stagedBy(sender, staged.handle)
      return staged
    },
    releaseStaged: async ({ handle }, sender) => {
      a.check(sender, tabOnly)
      await core.releaseStaged(handle)
      handles.unstaged(handle)
    },
    addAttachments: async ({ noteId, files }, sender) => {
      await begin(sender, tabOnly)
      // The core writes (and syncs) before it answers `failed`: sync is told whatever the answer is
      try {
        const note = await core.addAttachments(noteId, files)
        // The files that went up left staging; the ones in `failed` are still staged, and stay with this page
        const failed = new Set(note.failed ?? [])
        for (const file of files) if (!failed.has(file.handle)) handles.unstaged(file.handle)
        return note
      } finally {
        await a.changed()
      }
    },
    removeAttachment: async ({ noteId, attachmentId }, sender) => {
      await begin(sender, popupAndTab)
      const note = await core.removeAttachment(noteId, attachmentId)
      await a.changed()
      return note
    },
    openItemFile: async ({ ref, attachmentId }, sender) => {
      await begin(sender, popupAndTab)
      const opened = await core.openItemFile(ref, attachmentId)
      handles.openedBy(sender, opened.handle)
      return opened
    },
    readOpened: async ({ handle, index }, sender) => {
      await begin(sender, popupAndTab)
      return core.readOpened(handle, index)
    },
    closeOpened: async ({ handle }, sender) => {
      // As Sends' close: letting go of a handle needs no open vault (a locked core holds nothing)
      a.check(sender, popupAndTab)
      await core.closeOpened(handle)
      handles.closed(handle)
    },
  }
}

/**
 * A port from the files tab or the popup, which holds one open (and the files tab pings it) while a file is staged, uploading or being
 * read: a message on a port starts the worker's idle time over, so what the core holds for the page is not lost to a worker the browser
 * stopped. When the page's last port closes, the files it staged and opened are let go (`handles`). Only those two pages, by what the
 * browser reports of them, are kept: any other connection is closed. Nothing is read from what it sends. `handles` may still be
 * loading when the port arrives.
 */
export function acceptItemFilesPort(
  port: chrome.runtime.Port,
  self: Identity,
  handles: ItemFileHandles | Promise<ItemFileHandles>,
): void {
  const sender =
    port.name === itemFilesKeepAlivePort && port.sender !== undefined
      ? identifySender(port.sender, self)
      : null
  if (
    sender === null ||
    sender.from !== 'page' ||
    (sender.page !== 'files' && sender.page !== 'popup')
  ) {
    port.disconnect()
    return
  }
  const page: PageSender = sender
  const held = Promise.resolve(handles)
  void held.then((known) => known.connected(page)).catch(() => undefined)
  port.onMessage.addListener(() => undefined)
  port.onDisconnect.addListener(() => {
    void held.then((known) => known.disconnected(page)).catch(() => undefined)
  })
}
