// @vitest-environment jsdom
import { h, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from '../popup/send'
import {
  fileOf,
  fileFull,
  filesMessage,
  installFilesChrome,
  noteWith,
} from '../popup/files-testing'
import {
  background,
  button,
  change,
  click,
  input,
  mount,
  settle,
  submit,
  switchOf,
  text,
  toggle,
  unmountAll,
  vaultState,
} from '../popup/testing'
import { itemFileChunkBytes, itemFilesKeepAlivePort } from '../shared/item-files'
import { ToastProvider } from '../shared/ui/components'
import { FilesTab } from './app'
import { routeFromHash } from './route'
import { toBase64 } from '../sends/files'

vi.mock('../popup/send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('../popup/testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

const t = (name: string, ...subs: (string | number)[]) => filesMessage('en', name, subs)
const mountTab = (node: ComponentChildren = h(FilesTab, null)) =>
  mount(h(ToastProvider, null, node))

let fake: ReturnType<typeof installFilesChrome>

beforeEach(() => {
  fake = installFilesChrome()
  background.reset()
  location.hash = ''
})

afterEach(() => {
  unmountAll()
  location.hash = ''
})

/** The handlers of a tab over Kemlock Server (or not), with the staging and the saves a test cares about. */
function handlers(
  over: Record<string, unknown> = {},
  fileSync: 'kemlock' | 'readOnly' = 'kemlock',
) {
  return {
    pageState: () => vaultState({ fileSync }),
    stageItemFile: (args: { data: string; handle?: string }) => ({
      handle: args.handle ?? 'h1',
      length: args.data.length,
    }),
    releaseStaged: () => undefined,
    saveFile: (args: { input: { name: string } }) => ({ id: 'f9', name: args.input.name }),
    revealFile: () => fileFull({ notes: 'the flat' }),
    revealNote: () => noteWith({ attachments: [] }),
    addAttachments: () => noteWith(),
    ...over,
  } as never
}

/** Chooses [files] as the browser's file picker would. */
async function pick(root: HTMLElement, ...files: File[]): Promise<void> {
  const box = root.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(box, 'files', { value: files, configurable: true })
  await act(() => {
    box.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

const bytes = (length: number, fill = 7) => new Uint8Array(new ArrayBuffer(length)).fill(fill)

describe('the address’s hash', () => {
  it('names the page and what it works on', () => {
    expect(routeFromHash('#newFile')).toEqual({ name: 'newFile' })
    expect(routeFromHash('#replace/abc-123_x')).toEqual({ name: 'replace', id: 'abc-123_x' })
    expect(routeFromHash('#attach/9f1c4b6e-aaaa-bbbb-cccc-0123456789ab')).toEqual({
      name: 'attach',
      noteId: '9f1c4b6e-aaaa-bbbb-cccc-0123456789ab',
    })
  })

  it('is a new file for a hash that names no page', () => {
    for (const hash of ['', '#', '#other', '#newFile/x'])
      expect(routeFromHash(hash), hash).toEqual({ name: 'newFile' })
  })

  it('is invalid, never a new file, for a replace or attach that names no item', () => {
    const bad = ['#replace/', '#replace/a b', '#attach/<script>', '#attach/']
    for (const hash of [...bad, `#replace/${'a'.repeat(101)}`])
      expect(routeFromHash(hash), hash).toEqual({ name: 'invalid' })
  })

  it('says so, and offers no form, for an address that names no item', async () => {
    location.hash = '#replace/a b'
    background.reset(handlers())
    const root = await mountTab()
    expect(text(root)).toContain(t('files_badAddress'))
    expect(root.querySelector('form')).toBeNull()
  })
})

describe('the files tab', () => {
  it('says to unlock in the toolbar while the vault is locked, and tries again', async () => {
    let unlocked = false
    background.reset(handlers({ pageState: () => vaultState({ unlocked, fileSync: 'kemlock' }) }))
    const root = await mountTab()
    expect(text(root)).toContain(t('files_lockedTitle'))
    expect(root.querySelector('form')).toBeNull()
    unlocked = true
    await click(button(root, t('files_tryAgain')))
    expect(root.querySelector('form')).not.toBeNull()
  })

  it('goes when the vault locks, with what was chosen', async () => {
    background.reset(handlers())
    const root = await mountTab()
    await pick(root, fileOf(bytes(10), 'lease.pdf'))
    expect(text(root)).toContain('lease.pdf')
    background.set({ pageState: (() => vaultState({ unlocked: false })) as never })
    await act(() => {
      fake.lock()
    })
    await settle()
    expect(text(root)).toContain(t('files_lockedTitle'))
    expect(text(root)).not.toContain('lease.pdf')
  })

  it('says what files need with another sync, and shows no form', async () => {
    background.reset(handlers({}, 'readOnly'))
    const root = await mountTab()
    expect(text(root)).toContain(t('files_needSync'))
    expect(root.querySelector('form')).toBeNull()
  })
})

describe('a new file', () => {
  it('stages the file and saves the item, naming it after the file until the person types a name', async () => {
    background.reset(handlers())
    const root = await mountTab()
    await pick(root, fileOf(bytes(2000), 'lease.pdf', 'application/pdf'))
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('lease.pdf')
    await change(input(root, 'Name'), 'Flat lease')
    await change(input(root, 'Notes'), 'the flat on Rue Haute')
    await toggle(switchOf(root, 'Pin to the top'), true)
    await submit(root.querySelector('form'))
    expect(background.of('stageItemFile').map((call) => call.args)).toEqual([
      { data: toBase64(bytes(2000)) },
    ])
    expect(background.of('saveFile')[0]?.args).toEqual({
      id: null,
      input: {
        name: 'Flat lease',
        notes: 'the flat on Rue Haute',
        pinned: true,
        staged: { handle: 'h1', name: 'lease.pdf', type: 'application/pdf' },
      },
    })
    expect(text(root)).toContain(t('files_saved', 'Flat lease'))
    // Another file starts the form over
    await click(button(root, t('files_addAnother')))
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('')
  })

  it('sends a file over a mebibyte in pieces, the first starting the staging and the rest naming it', async () => {
    background.reset(handlers())
    const root = await mountTab()
    const size = itemFileChunkBytes * 2 + 5
    await pick(root, fileOf(bytes(size), 'video.mp4', ''))
    await submit(root.querySelector('form'))
    const calls = background
      .of('stageItemFile')
      .map((call) => call.args as { data: string; handle?: string })
    expect(calls).toHaveLength(3)
    expect(calls.map((call) => call.handle)).toEqual([undefined, 'h1', 'h1'])
    expect(calls[2]!.data).toBe(toBase64(bytes(5)))
    // A file with no media type is saved without one
    expect(background.of('saveFile')[0]?.args).toMatchObject({
      input: { staged: { handle: 'h1', name: 'video.mp4' } },
    })
    expect(JSON.stringify(background.of('saveFile')[0]?.args)).not.toContain('"type"')
  })

  it('holds the background with a port while it works, and lets it go after', async () => {
    let finish: () => void = () => undefined
    background.reset(
      handlers({
        saveFile: () =>
          new Promise((resolve) => {
            finish = () => resolve({ id: 'f9', name: 'lease.pdf' })
          }),
      }),
    )
    const root = await mountTab()
    expect(fake.connects).toEqual([])
    await pick(root, fileOf(bytes(10), 'lease.pdf'))
    await submit(root.querySelector('form'))
    expect(fake.connects).toEqual([itemFilesKeepAlivePort])
    expect(fake.port.disconnect).not.toHaveBeenCalled()
    expect(text(root)).toContain(t('files_sealing'))
    finish()
    await settle()
    expect(fake.port.disconnect).toHaveBeenCalled()
  })

  it('lets go of what it staged when the core refuses a piece, and says why', async () => {
    let piece = 0
    background.reset(
      handlers({
        stageItemFile: () => {
          piece += 1
          if (piece === 2) throw new Error('tooLarge')
          return { handle: 'h1', length: 1 }
        },
      }),
    )
    const root = await mountTab()
    await pick(root, fileOf(bytes(itemFileChunkBytes + 1), 'big.bin', ''))
    await submit(root.querySelector('form'))
    expect(background.of('releaseStaged')[0]?.args).toEqual({ handle: 'h1' })
    expect(background.of('saveFile')).toHaveLength(0)
    expect(text(root)).toContain(t('files_error_tooLarge'))
  })

  it('says what Kemlock Server sync is when the core says it is not there', async () => {
    background.reset(
      handlers({
        saveFile: () => {
          throw new Error('unavailable')
        },
      }),
    )
    const root = await mountTab()
    await pick(root, fileOf(bytes(10), 'lease.pdf'))
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('files_needSync'))
    // The form stays, so the person can try again
    expect(root.querySelector('form')).not.toBeNull()
  })

  it('refuses an empty file and a file over 50 MiB, and a form with no file or no name', async () => {
    background.reset(handlers())
    const root = await mountTab()
    await pick(root, fileOf(bytes(0), 'empty.txt'))
    expect(text(root)).toContain(t('files_errorEmpty', 'empty.txt'))
    const huge = fileOf(bytes(1), 'huge.iso')
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 + 1, configurable: true })
    await pick(root, huge)
    expect(text(root)).toContain(t('files_errorTooBig', 'huge.iso', '50.0 MB'))
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('files_errorNoFile'))
    await pick(root, fileOf(bytes(10), 'a.txt'))
    await change(input(root, 'Name'), ' ')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('files_nameNeeded'))
    expect(background.of('stageItemFile')).toHaveLength(0)
  })
})

describe('a replacement file', () => {
  it('puts the new file under the item and keeps its name, notes and pin', async () => {
    location.hash = '#replace/f1'
    background.reset(
      handlers({ revealFile: () => fileFull({ notes: 'the flat', pinned: true, tags: ['home'] }) }),
    )
    const root = await mountTab()
    expect(text(root)).toContain(t('files_replacing', 'Lease'))
    await pick(root, fileOf(bytes(30), 'lease-v2.pdf', 'application/pdf'))
    await submit(root.querySelector('form'))
    expect(background.of('saveFile')[0]?.args).toEqual({
      id: 'f1',
      input: {
        name: 'Lease',
        notes: 'the flat',
        pinned: true,
        tags: ['home'],
        staged: { handle: 'h1', name: 'lease-v2.pdf', type: 'application/pdf' },
      },
    })
    expect(text(root)).toContain(t('files_replaced', 'Lease'))
  })
})

describe('files for a note', () => {
  beforeEach(() => {
    location.hash = '#attach/n1'
  })

  it('says which note it adds to, and how many files it holds', async () => {
    background.reset(handlers({ revealNote: () => noteWith({ attachments: [] }) }))
    const root = await mountTab()
    expect(text(root)).toContain(t('files_attaching', 'Wi-Fi'))
    expect(text(root)).toContain(t('files_noteHoldsNone', 100))
  })

  it('stages each file and adds them to the note four at a time', async () => {
    let handles = 0
    background.reset(
      handlers({
        stageItemFile: () => ({ handle: `h${(handles += 1)}`, length: 1 }),
      }),
    )
    const root = await mountTab()
    const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.png']
    await pick(
      root,
      ...names.map((name) =>
        fileOf(bytes(8), name, name.endsWith('png') ? 'image/png' : 'text/plain'),
      ),
    )
    for (const name of names) expect(text(root)).toContain(name)
    await submit(root.querySelector('form'))
    const calls = background.of('addAttachments').map((call) => call.args)
    expect(calls).toEqual([
      {
        noteId: 'n1',
        files: [
          { handle: 'h1', name: 'a.txt', type: 'text/plain' },
          { handle: 'h2', name: 'b.txt', type: 'text/plain' },
          { handle: 'h3', name: 'c.txt', type: 'text/plain' },
          { handle: 'h4', name: 'd.txt', type: 'text/plain' },
        ],
      },
      { noteId: 'n1', files: [{ handle: 'h5', name: 'e.png', type: 'image/png' }] },
    ])
    expect(text(root)).toContain(t('files_attached', 'Wi-Fi', 5))
  })

  it('takes a chosen file out before it is sent', async () => {
    background.reset(handlers())
    const root = await mountTab()
    await pick(root, fileOf(bytes(8), 'a.txt'), fileOf(bytes(8), 'b.txt'))
    await click(button(root, t('files_removeNamed', 'a.txt')))
    expect(text(root)).not.toContain('a.txt')
    await submit(root.querySelector('form'))
    expect(background.of('addAttachments')[0]?.args).toMatchObject({
      files: [{ name: 'b.txt' }],
    })
  })

  it('lets go of the group it staged when the core refuses it, keeps the files and tries again', async () => {
    let refuse = true
    background.reset(
      handlers({
        addAttachments: () => {
          if (refuse) throw new Error('tooMany')
          return noteWith()
        },
      }),
    )
    const root = await mountTab()
    await pick(root, fileOf(bytes(8), 'a.txt'), fileOf(bytes(8), 'b.txt'))
    await submit(root.querySelector('form'))
    expect(background.of('releaseStaged').length).toBeGreaterThan(0)
    expect(text(root)).toContain(t('files_error_tooMany'))
    expect(text(root)).toContain('a.txt')
    refuse = false
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('files_attached', 'Wi-Fi', 2))
  })

  it('takes no more files than the note has room for', async () => {
    background.reset(
      handlers({
        revealNote: () =>
          noteWith({
            attachments: Array.from({ length: 99 }, (_, index) => ({
              id: `a${index}`,
              name: `f${index}`,
              size: 1,
              onServer: true,
            })),
          }),
      }),
    )
    const root = await mountTab()
    await pick(root, fileOf(bytes(8), 'a.txt'), fileOf(bytes(8), 'b.txt'))
    expect(text(root)).toContain('a.txt')
    expect(text(root)).not.toContain('b.txt')
    expect(text(root)).toContain(t('files_errorTooMany', 100))
  })
})
