// File items and note attachments for `FakeCore` (docs/plans/add-item-format.md), all in memory. It follows `CoreApi`'s contract, not the
// formats: a vault with file sync (`fileSync` is `kemlock`) stages a file in pieces, saves it as a File item or attaches it to a note, and
// opens it again a piece at a time; any other vault lists the files it has and does nothing else with them (`unavailable`). The bytes of
// a file are kept beside the disk and never in it, as a file is kept on the server and not in the vault.
import type {
  AttachmentView,
  FileFull,
  FileInput,
  FileSync,
  FileView,
  ItemRef,
  NoteFull,
  Opened,
  StagedAttachment,
} from '../../shared/api'
import {
  itemFileChunkBytes,
  maxAttachmentBytes,
  maxAttachments,
} from '../../shared/item-files'
import type { FakeExtras } from './fake-extras'
import { blobsOf, type ItemsDisk, type StoredFile, type StoredNote } from './fake-items'

/** What a fake's error says: the background passes its message on as the word the page shows. */
class FilesFakeError extends Error {
  constructor(word: string) {
    super(word)
    this.name = 'KemlockError'
  }
}

/** What `FakeFiles` takes from its `FakeCore`. */
export interface FakeFilesHost {
  /** Throws `locked` or `noVault`. */
  need(): void
  /** Whether files go up and down: the vault syncs with Kemlock Server (or a test says so). */
  fileSync(): FileSync
  now(): number
  items(): ItemsDisk
  extras: FakeExtras
  revealNote(id: string): Promise<NoteFull>
}

/** The most staged files, and the most opened ones, the core holds at once. */
const maxHeld = 4
/** The longest name of a staged file. */
const maxFileNameLength = 255

function random(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const concat = (pieces: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
  let at = 0
  for (const piece of pieces) {
    out.set(piece, at)
    at += piece.length
  }
  return out
}

export class FakeFiles {
  constructor(private readonly host: FakeFilesHost) {}

  /** The files being staged, by handle: the pieces so far. */
  private readonly staged = new Map<string, Uint8Array[]>()
  /** The files opened for reading, by handle. */
  private readonly opened = new Map<string, Uint8Array>()
  /**
   * A test's way to make an upload fail for the files it names (the server refuses one, the network drops): such a file is not
   * attached, and is answered in `failed`, as the real core does when only some went up.
   */
  refuseUpload: (file: StagedAttachment) => boolean = () => false

  /** How many files are staged and how many are open, for the tests. */
  held(): { staged: number; opened: number } {
    return { staged: this.staged.size, opened: this.opened.size }
  }

  /** The vault locked or went: nothing is held. */
  unload(): void {
    this.staged.clear()
    this.opened.clear()
  }

  private begin(): ItemsDisk {
    this.host.need()
    return this.host.items()
  }

  /** Files go up and down only with Kemlock Server. */
  private serverOnly(): void {
    if (this.host.fileSync() !== 'kemlock') throw new FilesFakeError('unavailable')
  }

  private size(handle: string): number {
    return (this.staged.get(handle) ?? []).reduce((sum, piece) => sum + piece.length, 0)
  }

  /* File items ------------------------------------------------------------------------------ */

  private view(file: StoredFile): FileView {
    const { notes: _notes, ...view } = file
    return {
      ...view,
      order: this.host.items().files.indexOf(file),
      links: this.host.extras.view({ kind: 'file', id: file.id }).links,
    }
  }

  private find(id: string): StoredFile {
    const file = this.begin().files.find((held) => held.id === id)
    if (file === undefined) throw new FilesFakeError('notFound')
    return file
  }

  async files(): Promise<FileView[]> {
    return this.begin().files.map((file) => this.view(file))
  }

  async revealFile(id: string): Promise<FileFull> {
    const file = this.find(id)
    return structuredClone({ ...this.view(file), notes: file.notes })
  }

  async deleteFile(id: string): Promise<void> {
    const items = this.begin()
    const file = this.find(id)
    items.files = items.files.filter((held) => held !== file)
    blobsOf(items).delete(id)
    this.host.extras.forget({ kind: 'file', id })
  }

  async saveFile(id: string | null, input: FileInput): Promise<FileView> {
    const items = this.begin()
    const name = input.name.trim()
    if (name === '') throw new FilesFakeError('invalid')
    if (input.staged !== undefined) {
      this.serverOnly()
      if (input.staged.name.trim() === '' || input.staged.name.length > maxFileNameLength)
        throw new FilesFakeError('invalid')
    }
    if (id === null && input.staged === undefined) throw new FilesFakeError('invalid')
    const staged = input.staged === undefined ? undefined : this.staged.get(input.staged.handle)
    if (input.staged !== undefined && staged === undefined) throw new FilesFakeError('lost')
    const held = id === null ? undefined : this.find(id)
    if (held === undefined) this.host.extras.check('file', { links: input.links })
    else this.host.extras.validate({ kind: 'file', id: held.id }, { links: input.links })
    const file: StoredFile = held ?? {
      id: `file-${items.nextId++}`,
      name,
      notes: '',
      pinned: false,
      tags: [],
      onServer: true,
      changedAt: this.host.now(),
    }
    file.name = name
    if (input.notes !== undefined) file.notes = input.notes
    if (input.pinned !== undefined) file.pinned = input.pinned
    if (input.tags !== undefined) file.tags = [...input.tags]
    file.changedAt = this.host.now()
    if (input.staged !== undefined && staged !== undefined) {
      const bytes = concat(staged)
      blobsOf(items).set(file.id, bytes)
      file.fileName = input.staged.name
      file.size = bytes.length
      if (input.staged.type === undefined) delete file.type
      else file.type = input.staged.type
      file.onServer = true
      this.staged.delete(input.staged.handle)
    }
    if (held === undefined) items.files.push(file)
    const failures = this.host.extras.apply({ kind: 'file', id: file.id }, { links: input.links })
    return { ...this.view(file), ...(failures.length > 0 ? { linkFailures: failures } : {}) }
  }

  /* Staging --------------------------------------------------------------------------------- */

  async stageItemFile(
    data: string,
    handle: string | null,
  ): Promise<{ handle: string; length: number }> {
    this.begin()
    this.serverOnly()
    // A piece over 1 MiB is not one the core takes (`invalid`)
    if (data.length > Math.ceil(itemFileChunkBytes / 3) * 4) throw new FilesFakeError('invalid')
    let piece: Uint8Array
    try {
      piece = fromBase64(data)
    } catch {
      throw new FilesFakeError('invalid')
    }
    if (piece.length > itemFileChunkBytes) throw new FilesFakeError('invalid')
    if (handle !== null && !this.staged.has(handle)) throw new FilesFakeError('lost')
    // A fifth file pushes the oldest out, and the new one is answered a handle
    if (handle === null)
      while (this.staged.size >= maxHeld) this.staged.delete(this.staged.keys().next().value!)
    const held = handle ?? random(22)
    if (this.size(held) + piece.length > maxAttachmentBytes) {
      // Over 50 MiB the file is dropped: its next piece is a handle nobody holds
      this.staged.delete(held)
      throw new FilesFakeError('tooLarge')
    }
    const pieces = this.staged.get(held) ?? []
    pieces.push(piece)
    this.staged.set(held, pieces)
    return { handle: held, length: this.size(held) }
  }

  /** Letting go of a file needs no open vault: a lock let go of every one already. */
  async releaseStaged(handle: string): Promise<void> {
    this.staged.delete(handle)
  }

  /* Attachments ----------------------------------------------------------------------------- */

  private note(id: string): StoredNote {
    const note = this.begin().notes.find((held) => held.id === id)
    if (note === undefined) throw new FilesFakeError('notFound')
    return note
  }

  async addAttachments(noteId: string, files: StagedAttachment[]): Promise<NoteFull> {
    const items = this.begin()
    this.serverOnly()
    if (files.length === 0) throw new FilesFakeError('invalid')
    if (files.length > maxAttachments) throw new FilesFakeError('tooMany')
    for (const file of files)
      if (file.name.trim() === '' || file.name.length > maxFileNameLength)
        throw new FilesFakeError('invalid')
    const note = this.note(noteId)
    if (note.attachments.length + files.length > maxAttachments) throw new FilesFakeError('tooMany')
    const made: { view: AttachmentView; bytes: Uint8Array; handle: string }[] = []
    const failed: string[] = []
    for (const file of files) {
      const pieces = this.staged.get(file.handle)
      if (pieces === undefined) throw new FilesFakeError('lost')
      if (this.refuseUpload(file)) {
        failed.push(file.handle)
        continue
      }
      const bytes = concat(pieces)
      made.push({
        handle: file.handle,
        bytes,
        view: {
          id: crypto.randomUUID(),
          name: file.name,
          size: bytes.length,
          ...(file.type === undefined ? {} : { type: file.type }),
          sha256: await sha256Of(bytes),
          onServer: true,
        },
      })
    }
    // None went up: the call fails, and every file stays staged
    if (made.length === 0) throw new FilesFakeError('failed')
    for (const { view, bytes, handle } of made) {
      note.attachments.push(view)
      blobsOf(items).set(view.id, bytes)
      this.staged.delete(handle)
    }
    note.files = note.attachments.length
    note.changedAt = this.host.now()
    const full = await this.host.revealNote(noteId)
    // Some went up and some did not: the note, with the handles of those that did not (they stay staged)
    return failed.length === 0 ? full : { ...full, failed }
  }

  async removeAttachment(noteId: string, attachmentId: string): Promise<NoteFull> {
    const items = this.begin()
    this.serverOnly()
    const note = this.note(noteId)
    if (!note.attachments.some((file) => file.id === attachmentId))
      throw new FilesFakeError('notFound')
    note.attachments = note.attachments.filter((file) => file.id !== attachmentId)
    note.files = note.attachments.length
    note.changedAt = this.host.now()
    blobsOf(items).delete(attachmentId)
    return this.host.revealNote(noteId)
  }

  /* Reading --------------------------------------------------------------------------------- */

  async openItemFile(ref: ItemRef, attachmentId?: string): Promise<Opened> {
    const items = this.begin()
    this.serverOnly()
    let key: string
    let name: string
    let type: string | undefined
    if (ref.kind === 'file') {
      const file = this.find(ref.id)
      if (file.fileName === undefined) throw new FilesFakeError('failed')
      key = file.id
      name = file.fileName
      type = file.type
    } else if (ref.kind === 'note' && attachmentId !== undefined) {
      const attachment = this.note(ref.id).attachments.find((held) => held.id === attachmentId)
      if (attachment === undefined) throw new FilesFakeError('notFound')
      key = attachment.id
      name = attachment.name
      type = attachment.type
    } else throw new FilesFakeError('invalid')
    const bytes = blobsOf(items).get(key)
    // A file the server has but this fake was never given: the download fails as an unreachable one does
    if (bytes === undefined) throw new FilesFakeError('failed')
    // A fifth open file closes the oldest
    while (this.opened.size >= maxHeld) this.opened.delete(this.opened.keys().next().value!)
    const handle = random(22)
    this.opened.set(handle, bytes)
    return { handle, size: bytes.length, name, ...(type === undefined ? {} : { type }) }
  }

  async readOpened(handle: string, index: number): Promise<string> {
    this.begin()
    const bytes = this.opened.get(handle)
    if (bytes === undefined) throw new FilesFakeError('lost')
    const start = index * itemFileChunkBytes
    return start >= bytes.length ? '' : toBase64(bytes.slice(start, start + itemFileChunkBytes))
  }

  async closeOpened(handle: string): Promise<void> {
    this.opened.delete(handle)
  }
}
