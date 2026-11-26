// File items and note attachments through the real router over the fake core (docs/plans/add-item-format.md): staging in pieces, saving
// and attaching, opening to read in pieces, who may ask, and what only a vault that syncs with Kemlock Server may do.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileFull, FileView, NoteFull, NoteView, Opened } from '../shared/api'
import { itemFileChunkBytes, itemFilesKeepAlivePort } from '../shared/item-files'
import { acceptItemFilesPort } from './item-files'
import {
  content,
  harness,
  menuFrame,
  popup,
  self,
  setup,
  useClock,
  type Harness,
} from './test/harness'

/** The files tab, as the browser reports a message from it. */
const filesTab = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/files/index.html',
  origin: 'chrome-extension://kemlockid',
}
const sendsTab = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/sends/index.html',
  origin: 'chrome-extension://kemlockid',
}

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const syncsWithKemlock = () => {
  h.core.disk.sync = { place: 'kemlock', server: 'https://kem.example', running: false }
}

const toBase64 = (bytes: Uint8Array): string => {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}
const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
const bytesOf = (length: number, seed = 1): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (i * 7 + seed) % 256)

/** Stages a file from the files tab in pieces of the chunk size, and answers its handle. */
const stage = async (bytes: Uint8Array): Promise<string> => {
  let handle: string | undefined
  for (let at = 0; at < Math.max(bytes.length, 1); at += itemFileChunkBytes) {
    const piece = bytes.subarray(at, at + itemFileChunkBytes)
    const staged = await h.ok<{ handle: string; length: number }>(
      { kind: 'stageItemFile', data: toBase64(piece), ...(handle === undefined ? {} : { handle }) },
      filesTab,
    )
    handle = staged.handle
  }
  return handle!
}
const saveFile = (id: string | null, input: object, sender: chrome.runtime.MessageSender = filesTab) =>
  h.send<FileView>({ kind: 'saveFile', id, input }, sender)
const makeFile = async (name = 'Passport', bytes = bytesOf(100)): Promise<FileView> => {
  const handle = await stage(bytes)
  const saved = await saveFile(null, { name, staged: { handle, name: 'passport.pdf', type: 'application/pdf' } })
  if (!saved.ok) throw new Error(`not saved: ${saved.error}`)
  return saved.value
}
const saveNote = () =>
  h.ok<NoteView>({ kind: 'saveNote', id: null, input: { title: 'Contract', text: 'text' } })
/** Reads an opened file whole, as the popup does, and closes it. */
const download = async (opened: Opened, sender: chrome.runtime.MessageSender = popup): Promise<Uint8Array> => {
  const pieces: Uint8Array[] = []
  for (let index = 0; ; index += 1) {
    const piece = await h.ok<string>({ kind: 'readOpened', handle: opened.handle, index }, sender)
    if (piece === '') break
    pieces.push(fromBase64(piece))
  }
  await h.ok({ kind: 'closeOpened', handle: opened.handle }, sender)
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
  let at = 0
  for (const piece of pieces) {
    out.set(piece, at)
    at += piece.length
  }
  return out
}

describe('a File item', () => {
  beforeEach(syncsWithKemlock)

  it('is staged in pieces, saved, listed, revealed, and read back piece by piece', async () => {
    const bytes = bytesOf(itemFileChunkBytes * 2 + 5)
    const file = await makeFile('Passport', bytes)
    expect(file).toMatchObject({
      name: 'Passport',
      fileName: 'passport.pdf',
      type: 'application/pdf',
      size: bytes.length,
      pinned: false,
      onServer: true,
      links: 0,
    })
    expect(await h.ok<FileView[]>({ kind: 'files' })).toEqual([file])
    expect(await h.ok<FileFull>({ kind: 'revealFile', id: file.id })).toMatchObject({
      id: file.id,
      notes: '',
    })
    // Staging is over: the bytes are in the vault now, and the staged copy is gone
    expect(h.core.fileStore.held().staged).toBe(0)

    const opened = await h.ok<Opened>({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } })
    expect(opened).toMatchObject({ size: bytes.length, name: 'passport.pdf', type: 'application/pdf' })
    expect(await download(opened)).toEqual(bytes)
    // A file that was closed is let go
    expect(await h.send({ kind: 'readOpened', handle: opened.handle, index: 0 })).toEqual({
      ok: false,
      error: 'lost',
    })
  })

  it('has its details changed without a file, and its file replaced with one', async () => {
    const file = await makeFile('Passport', bytesOf(10))
    const renamed = await saveFile(
      file.id,
      { name: 'Passport 2030', notes: 'Renew', pinned: true, tags: ['id'] },
      popup,
    )
    expect(renamed).toMatchObject({ ok: true, value: { name: 'Passport 2030', pinned: true, size: 10 } })
    expect(await h.ok<FileFull>({ kind: 'revealFile', id: file.id })).toMatchObject({ notes: 'Renew' })

    const handle = await stage(bytesOf(30, 9))
    const replaced = await saveFile(file.id, {
      name: 'Passport 2030',
      staged: { handle, name: 'new.pdf' },
    })
    expect(replaced).toMatchObject({ ok: true, value: { fileName: 'new.pdf', size: 30 } })
    const opened = await h.ok<Opened>({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } })
    expect(await download(opened)).toEqual(bytesOf(30, 9))
  })

  it('needs a file for a new item, and a name', async () => {
    expect(await saveFile(null, { name: 'Empty' }, popup)).toEqual({ ok: false, error: 'invalid' })
    const handle = await stage(bytesOf(3))
    expect(await saveFile(null, { name: ' ', staged: { handle, name: 'a' } })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })

  it('is linked to other items on both ends', async () => {
    const note = await saveNote()
    const handle = await stage(bytesOf(3))
    const saved = await saveFile(null, {
      name: 'Scan',
      links: [{ kind: 'note', id: note.id }],
      staged: { handle, name: 'scan.png' },
    })
    expect(saved).toMatchObject({ ok: true, value: { links: 1 } })
    expect((await h.ok<NoteView[]>({ kind: 'notes' }))[0].links).toBe(1)
  })

  it('is deleted with its bytes, and its links', async () => {
    const note = await saveNote()
    const file = await makeFile()
    await h.ok({ kind: 'setLinks', ref: { kind: 'file', id: file.id }, refs: [{ kind: 'note', id: note.id }] })
    await h.ok({ kind: 'deleteFile', id: file.id })
    expect(await h.ok<FileView[]>({ kind: 'files' })).toEqual([])
    expect((await h.ok<NoteView[]>({ kind: 'notes' }))[0].links).toBe(0)
    expect(await h.send({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } })).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('tells sync of what changes it, and of nothing that only reads', async () => {
    const spy = vi.spyOn(h.bg['d'].sync, 'changed')
    const file = await makeFile()
    expect(spy).toHaveBeenCalledTimes(1)
    await h.ok({ kind: 'files' })
    await h.ok({ kind: 'revealFile', id: file.id })
    await download(await h.ok<Opened>({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } }))
    expect(spy).toHaveBeenCalledTimes(1)
    await saveFile(file.id, { name: 'Renamed' }, popup)
    await h.ok({ kind: 'deleteFile', id: file.id })
    expect(spy).toHaveBeenCalledTimes(3)
  })
})

describe('attachments', () => {
  beforeEach(syncsWithKemlock)

  it('are staged, attached to a note with their size and hash, read back, and removed', async () => {
    const note = await saveNote()
    const first = bytesOf(1000, 2)
    const second = bytesOf(5, 3)
    const attached = await h.ok<NoteFull>(
      {
        kind: 'addAttachments',
        noteId: note.id,
        files: [
          { handle: await stage(first), name: 'a.txt', type: 'text/plain' },
          { handle: await stage(second), name: 'b.bin' },
        ],
      },
      filesTab,
    )
    expect(attached.files).toBe(2)
    expect(attached.attachments).toMatchObject([
      { name: 'a.txt', size: 1000, type: 'text/plain', onServer: true },
      { name: 'b.bin', size: 5, onServer: true },
    ])
    expect(attached.attachments[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(attached.attachments[1].type).toBeUndefined()
    expect(h.core.fileStore.held().staged).toBe(0)

    const opened = await h.ok<Opened>({
      kind: 'openItemFile',
      ref: { kind: 'note', id: note.id },
      attachmentId: attached.attachments[0].id,
    })
    expect(opened).toMatchObject({ name: 'a.txt', size: 1000, type: 'text/plain' })
    expect(await download(opened)).toEqual(first)

    const removed = await h.ok<NoteFull>({
      kind: 'removeAttachment',
      noteId: note.id,
      attachmentId: attached.attachments[0].id,
    })
    expect(removed.attachments.map((file) => file.name)).toEqual(['b.bin'])
    expect((await h.ok<NoteView[]>({ kind: 'notes' }))[0].files).toBe(1)
    expect(
      await h.send({
        kind: 'openItemFile',
        ref: { kind: 'note', id: note.id },
        attachmentId: attached.attachments[0].id,
      }),
    ).toEqual({ ok: false, error: 'notFound' })
  })

  it('are removed from the popup too, which may not attach', async () => {
    const note = await saveNote()
    const attached = await h.ok<NoteFull>(
      {
        kind: 'addAttachments',
        noteId: note.id,
        files: [{ handle: await stage(bytesOf(4)), name: 'a.txt' }],
      },
      filesTab,
    )
    expect(
      await h.send({
        kind: 'addAttachments',
        noteId: note.id,
        files: [{ handle: 'whatever', name: 'b.txt' }],
      }),
    ).toEqual({ ok: false, error: 'refused' })
    await h.ok({ kind: 'removeAttachment', noteId: note.id, attachmentId: attached.attachments[0].id })
    expect((await h.ok<NoteFull>({ kind: 'revealNote', id: note.id })).attachments).toEqual([])
  })

  it('are at most 100 to a note', async () => {
    const note = await saveNote()
    for (let round = 0; round < 25; round += 1) {
      const files = []
      for (let i = 0; i < 4; i += 1)
        files.push({ handle: await stage(bytesOf(2, i)), name: `f${round}-${i}.txt` })
      await h.ok({ kind: 'addAttachments', noteId: note.id, files }, filesTab)
    }
    expect((await h.ok<NoteFull>({ kind: 'revealNote', id: note.id })).attachments).toHaveLength(100)
    const handle = await stage(bytesOf(2))
    expect(
      await h.send(
        { kind: 'addAttachments', noteId: note.id, files: [{ handle, name: 'one-more.txt' }] },
        filesTab,
      ),
    ).toEqual({ ok: false, error: 'tooMany' })
  })

  it('are refused for a note that is not there, and for a handle that was not staged', async () => {
    const handle = await stage(bytesOf(2))
    expect(
      await h.send(
        { kind: 'addAttachments', noteId: 'nope', files: [{ handle, name: 'a.txt' }] },
        filesTab,
      ),
    ).toEqual({ ok: false, error: 'notFound' })
    const note = await saveNote()
    expect(
      await h.send(
        { kind: 'addAttachments', noteId: note.id, files: [{ handle: 'gone', name: 'a.txt' }] },
        filesTab,
      ),
    ).toEqual({ ok: false, error: 'lost' })
  })
})

describe('staging', () => {
  beforeEach(syncsWithKemlock)

  it('answers a handle and the bytes staged so far, and lets a file go', async () => {
    const first = await h.ok<{ handle: string; length: number }>(
      { kind: 'stageItemFile', data: toBase64(bytesOf(10)) },
      filesTab,
    )
    expect(first.length).toBe(10)
    const second = await h.ok<{ handle: string; length: number }>(
      { kind: 'stageItemFile', data: toBase64(bytesOf(5)), handle: first.handle },
      filesTab,
    )
    expect(second).toEqual({ handle: first.handle, length: 15 })
    await h.ok({ kind: 'releaseStaged', handle: first.handle }, filesTab)
    expect(h.core.fileStore.held().staged).toBe(0)
    expect(
      await h.send({ kind: 'stageItemFile', data: 'AAAA', handle: first.handle }, filesTab),
    ).toEqual({ ok: false, error: 'lost' })
  })

  it('holds four files at a time', async () => {
    for (let i = 0; i < 4; i += 1) await stage(bytesOf(2, i))
    expect(await h.send({ kind: 'stageItemFile', data: 'AAAA' }, filesTab)).toEqual({
      ok: false,
      error: 'tooMany',
    })
  })

  it('stops a file at 50 MiB', async () => {
    const piece = toBase64(new Uint8Array(itemFileChunkBytes))
    const first = await h.ok<{ handle: string }>({ kind: 'stageItemFile', data: piece }, filesTab)
    for (let i = 1; i < 50; i += 1)
      await h.ok({ kind: 'stageItemFile', data: piece, handle: first.handle }, filesTab)
    expect(
      await h.send({ kind: 'stageItemFile', data: 'AAAA', handle: first.handle }, filesTab),
    ).toEqual({ ok: false, error: 'tooLarge' })
  })

  it('holds nothing once the vault locks', async () => {
    const handle = await stage(bytesOf(3))
    const file = await makeFile()
    const opened = await h.ok<Opened>({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } })
    await h.ok({ kind: 'lock' })
    expect(h.core.fileStore.held()).toEqual({ staged: 0, opened: 0 })
    await h.ok({ kind: 'unlock', password: 'correct horse' })
    expect(
      await h.send({ kind: 'saveFile', id: null, input: { name: 'x', staged: { handle, name: 'x' } } }, filesTab),
    ).toEqual({ ok: false, error: 'lost' })
    expect(await h.send({ kind: 'readOpened', handle: opened.handle, index: 0 })).toEqual({
      ok: false,
      error: 'lost',
    })
  })
})

describe('without Kemlock Server', () => {
  it('lists the files and does nothing else with them', async () => {
    syncsWithKemlock()
    const file = await makeFile()
    const note = await saveNote()
    const attached = await h.ok<NoteFull>(
      {
        kind: 'addAttachments',
        noteId: note.id,
        files: [{ handle: await stage(bytesOf(4)), name: 'a.txt' }],
      },
      filesTab,
    )
    h.core.disk.sync = { place: 'webdav', server: 'https://dav.example', running: false }
    expect(await h.ok<FileView[]>({ kind: 'files' })).toHaveLength(1)
    expect((await h.ok<NoteFull>({ kind: 'revealNote', id: note.id })).attachments).toHaveLength(1)
    const unavailable = { ok: false, error: 'unavailable' }
    expect(await h.send({ kind: 'stageItemFile', data: 'AAAA' }, filesTab)).toEqual(unavailable)
    expect(await h.send({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } })).toEqual(
      unavailable,
    )
    expect(
      await h.send({
        kind: 'openItemFile',
        ref: { kind: 'note', id: note.id },
        attachmentId: attached.attachments[0].id,
      }),
    ).toEqual(unavailable)
    expect(
      await h.send({ kind: 'removeAttachment', noteId: note.id, attachmentId: attached.attachments[0].id }),
    ).toEqual(unavailable)
    expect(
      await h.send(
        { kind: 'addAttachments', noteId: note.id, files: [{ handle: 'h', name: 'b.txt' }] },
        filesTab,
      ),
    ).toEqual(unavailable)
    // A File item's details are still its own to edit
    expect(await saveFile(file.id, { name: 'Renamed' }, popup)).toMatchObject({ ok: true })
  })

  it('refuses a file with the item when the vault stopped syncing in between', async () => {
    syncsWithKemlock()
    const handle = await stage(bytesOf(4))
    h.core.disk.sync = null
    expect(await saveFile(null, { name: 'x', staged: { handle, name: 'x.txt' } })).toEqual({
      ok: false,
      error: 'unavailable',
    })
  })

  it('goes by the fileSync switch when a test sets it', async () => {
    h.core.fileSync = 'kemlock'
    expect(await h.ok<{ fileSync: string }>({ kind: 'pageState' })).toMatchObject({ fileSync: 'kemlock' })
    expect(await makeFile()).toMatchObject({ onServer: true })
    h.core.fileSync = 'readOnly'
    expect(await h.ok<{ fileSync: string }>({ kind: 'pageState' })).toMatchObject({ fileSync: 'readOnly' })
  })
})

describe('who may ask', () => {
  beforeEach(syncsWithKemlock)

  const refused = { ok: false, error: 'refused' }

  it('leaves staging, attaching and saving a file to the files tab', async () => {
    const handle = await stage(bytesOf(3))
    for (const sender of [popup, setup, menuFrame, sendsTab, content('https://evil.example/')]) {
      expect(await h.send({ kind: 'stageItemFile', data: 'AAAA' }, sender)).toEqual(refused)
      expect(await h.send({ kind: 'releaseStaged', handle }, sender)).toEqual(refused)
      expect(
        await h.send({ kind: 'saveFile', id: null, input: { name: 'x', staged: { handle, name: 'x' } } }, sender),
      ).toEqual(refused)
      expect(
        await h.send({ kind: 'addAttachments', noteId: 'n', files: [{ handle, name: 'x' }] }, sender),
      ).toEqual(refused)
    }
  })

  it('lets the popup and the files tab open, read and close a file, and remove an attachment', async () => {
    const file = await makeFile()
    for (const sender of [popup, filesTab]) {
      const opened = await h.ok<Opened>(
        { kind: 'openItemFile', ref: { kind: 'file', id: file.id } },
        sender,
      )
      expect(await h.ok<string>({ kind: 'readOpened', handle: opened.handle, index: 0 }, sender)).not.toBe('')
      await h.ok({ kind: 'closeOpened', handle: opened.handle }, sender)
    }
    for (const sender of [setup, menuFrame, sendsTab, content('https://evil.example/')]) {
      expect(await h.send({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } }, sender)).toEqual(refused)
      expect(await h.send({ kind: 'readOpened', handle: 'h', index: 0 }, sender)).toEqual(refused)
      expect(await h.send({ kind: 'closeOpened', handle: 'h' }, sender)).toEqual(refused)
      expect(await h.send({ kind: 'removeAttachment', noteId: 'n', attachmentId: 'a' }, sender)).toEqual(refused)
    }
  })

  it('lets the popup, the setup tab and the files tab list and change File items', async () => {
    const file = await makeFile()
    for (const sender of [popup, setup, filesTab]) {
      expect(await h.send({ kind: 'files' }, sender)).toMatchObject({ ok: true })
      expect(await h.send({ kind: 'revealFile', id: file.id }, sender)).toMatchObject({ ok: true })
    }
    for (const sender of [menuFrame, sendsTab, content('https://evil.example/')]) {
      expect(await h.send({ kind: 'files' }, sender)).toEqual(refused)
      expect(await h.send({ kind: 'revealFile', id: file.id }, sender)).toEqual(refused)
      expect(await h.send({ kind: 'deleteFile', id: file.id }, sender)).toEqual(refused)
      expect(await h.send({ kind: 'saveFile', id: file.id, input: { name: 'x' } }, sender)).toEqual(refused)
    }
  })

  it('needs the vault open', async () => {
    const file = await makeFile()
    await h.ok({ kind: 'lock' })
    expect(await h.send({ kind: 'files' })).toEqual({ ok: false, error: 'locked' })
    expect(await h.send({ kind: 'stageItemFile', data: 'AAAA' }, filesTab)).toEqual({ ok: false, error: 'locked' })
    expect(await h.send({ kind: 'openItemFile', ref: { kind: 'file', id: file.id } })).toEqual({
      ok: false,
      error: 'locked',
    })
  })

  it('answers the files tab whether the vault is open, and what files may do', async () => {
    expect(await h.ok({ kind: 'pageState' }, filesTab)).toMatchObject({
      unlocked: true,
      fileSync: 'kemlock',
    })
    await h.ok({ kind: 'lock' })
    expect(await h.ok({ kind: 'pageState' }, filesTab)).toMatchObject({ unlocked: false })
  })
})

describe('the port the files tab holds', () => {
  const portFrom = (sender: object | undefined, name = itemFilesKeepAlivePort) => {
    const listeners: (() => void)[] = []
    return {
      port: {
        name,
        sender,
        disconnect: vi.fn(),
        onMessage: { addListener: (listener: () => void) => listeners.push(listener) },
      } as unknown as chrome.runtime.Port,
      listeners,
    }
  }

  it('is kept for the files tab, which then only has to ping it', () => {
    const { port, listeners } = portFrom(filesTab)
    acceptItemFilesPort(port, self)
    expect(port.disconnect).not.toHaveBeenCalled()
    expect(listeners).toHaveLength(1)
  })

  it('is closed for any other page, a web page, another name, or no sender', () => {
    for (const sender of [popup, setup, menuFrame, sendsTab, content('https://evil.example/'), undefined]) {
      const { port, listeners } = portFrom(sender)
      acceptItemFilesPort(port, self)
      expect(port.disconnect).toHaveBeenCalledTimes(1)
      expect(listeners).toHaveLength(0)
    }
    const { port } = portFrom(filesTab, 'something-else')
    acceptItemFilesPort(port, self)
    expect(port.disconnect).toHaveBeenCalledTimes(1)
    const other = portFrom({ ...filesTab, id: 'another-extension' })
    acceptItemFilesPort(other.port, self)
    expect(other.port.disconnect).toHaveBeenCalledTimes(1)
  })
})
