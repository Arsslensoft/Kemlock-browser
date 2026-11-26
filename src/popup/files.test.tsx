// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SendsFiles from '../sends/files'
import type * as Send from './send'
import { saveBlob } from '../sends/files'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import { EditFile } from './file-edit'
import { itemFilesKeepAlivePort } from '../shared/item-files'
import { attachment, fileFull, fileView, filesMessage, installFilesChrome, noteWith } from './files-testing'
import {
  background,
  button,
  change,
  click,
  input,
  note,
  settle,
  submit,
  switchOf,
  syncStatus,
  text,
  toggle,
  unlockedHandlers,
  unmountAll,
  vaultState,
  mount,
  type World,
} from './testing'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('./testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

// A download is a click on a link to a blob, which jsdom has no way to follow
vi.mock('../sends/files', async (importActual) => ({
  ...(await importActual<typeof SendsFiles>()),
  saveBlob: vi.fn(),
}))

// The sections and the picker of custom fields and links are another change's: here they are stand-ins
vi.mock('./item-extras', async () => {
  const { h } = await import('preact')
  return {
    FieldsSection: () => null,
    LinksSection: () => null,
    FieldsEditor: () => null,
    useItemExtras: () => ({
      fieldsProps: { kind: 'note', item: null, value: [], fields: [], onChange: () => undefined },
      linkProps: { item: null, value: [], onChange: () => undefined },
      loading: false,
      problem: undefined,
      members: () => ({}),
      reset: () => undefined,
    }),
    LinkPicker: (props: {
      value: unknown[]
      disabled?: boolean
      onChange: (next: unknown[]) => void
    }) =>
      h(
        'button',
        {
          type: 'button',
          disabled: props.disabled === true,
          onClick: () => props.onChange([...props.value, { kind: 'note', id: 'n9' }]),
        },
        `Pick a link (${props.value.length})`,
      ),
  }
})
vi.mock('./code-edit', () => ({ CodeEditPage: () => null, BackupEditPage: () => null }))

const t = (name: string, ...subs: (string | number)[]) => filesMessage('en', name, subs)
const openPopup = () => mount(h(ToastProvider, null, h(App, null)))

const withServer = syncStatus({ place: 'kemlock', server: 'https://kem.example.com', fileSync: 'kemlock' })
const withoutServer = syncStatus({ fileSync: 'readOnly' })

let fake: ReturnType<typeof installFilesChrome>

beforeEach(() => {
  fake = installFilesChrome()
  background.reset()
  vi.mocked(saveBlob).mockClear()
})

afterEach(() => {
  unmountAll()
})

const world = (over: Partial<World> = {}): World => ({
  codes: [],
  logins: [],
  notes: [],
  cards: [],
  identities: [],
  state: vaultState({ fileSync: 'kemlock' }),
  ...over,
})

/** The handlers of a vault with a file in it, over Kemlock Server unless a test says otherwise. */
function handlers(over: Record<string, unknown> = {}, sync = withServer, w = world()) {
  return {
    ...unlockedHandlers(w),
    syncStatus: () => sync,
    files: () => [fileView()],
    revealFile: () => fileFull({ notes: 'the flat on Rue Haute' }),
    saveFile: (args: { id: string | null }) => fileView({ id: args.id ?? 'f2' }),
    deleteFile: () => undefined,
    linkedItems: () => [],
    ...over,
  } as never
}

async function openFile(over: Record<string, unknown> = {}, sync = withServer) {
  background.reset(handlers(over, sync))
  const root = await openPopup()
  await click(button(root, 'Files 1'))
  await click(button(root, t('files_open', 'Lease')))
  return root
}

describe('Home', () => {
  it('has a Files tab with its count, and lists each file with its kind and size', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Files 1'))
    expect(text(root)).toContain('Lease')
    expect(text(root)).toContain('PDF · 2 KB')
  })

  it('puts the pinned files first and says which are not uploaded yet', async () => {
    background.reset(
      handlers({
        files: () => [
          fileView({ id: 'f1', name: 'Receipt', order: 0, onServer: false }),
          fileView({ id: 'f2', name: 'Passport scan', order: 1, pinned: true }),
        ],
      }),
    )
    const root = await openPopup()
    await click(button(root, 'Files 2'))
    const names = [...root.querySelectorAll('#panel-files .name')].map((name) => name.textContent)
    expect(names).toEqual(['Passport scan', 'Receipt'])
    expect(text(root)).toContain(t('files_notUploaded'))
  })

  it('finds a file by its name or its file’s name in a search', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await change(root.querySelector('input[type="search"]'), 'lease.pdf')
    expect(text(root)).toContain('Lease')
    await change(root.querySelector('input[type="search"]'), 'nothing like it')
    expect(text(root)).not.toContain('PDF · 2 KB')
  })

  it('offers New file where the vault syncs with Kemlock Server, which opens the files tab', async () => {
    background.reset(handlers({ files: () => [] }))
    const root = await openPopup()
    await click(button(root, 'Files 0'))
    expect(text(root)).toContain('No files yet.')
    await click(button(root, t('files_new')))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/files/index.html#newFile'])
  })

  it('has no Files tab with another sync and no file', async () => {
    background.reset(handlers({ files: () => [] }, withoutServer))
    const root = await openPopup()
    expect(button(root, 'Files 0')).toBeNull()
  })

  it('lists the files read-only with another sync, and says what they need', async () => {
    background.reset(handlers({}, withoutServer))
    const root = await openPopup()
    await click(button(root, 'Files 1'))
    expect(text(root)).toContain('Lease')
    expect(text(root)).toContain(t('files_needSync'))
    expect(button(root, t('files_new'))).toBeNull()
  })
})

describe('a File item’s page', () => {
  it('shows the file, its notes and the actions that need Kemlock Server', async () => {
    const root = await openFile()
    expect(text(root)).toContain('lease.pdf')
    expect(text(root)).toContain('PDF')
    expect(text(root)).toContain('2 KB')
    expect(text(root)).toContain('the flat on Rue Haute')
    for (const label of [
      t('files_downloadNamed', 'lease.pdf'),
      t('files_copyName'),
      t('files_replace'),
      t('files_delete'),
      'Edit',
    ])
      expect(button(root, label), label).not.toBeNull()
  })

  it('downloads the file piece by piece, saves it under its name and lets the core go of it', async () => {
    const root = await openFile({
      openItemFile: () => ({ handle: 'o1', size: 10, name: 'lease.pdf', type: 'application/pdf' }),
      readOpened: (args: { index: number }) => (args.index === 0 ? 'aGVsbG8=' : args.index === 1 ? 'd29ybGQ=' : ''),
      closeOpened: () => undefined,
    })
    await click(button(root, t('files_downloadNamed', 'lease.pdf')))
    expect(background.of('openItemFile')[0]?.args).toEqual({ ref: { kind: 'file', id: 'f1' } })
    expect(background.of('readOpened').map((call) => call.args)).toEqual([
      { handle: 'o1', index: 0 },
      { handle: 'o1', index: 1 },
      { handle: 'o1', index: 2 },
    ])
    expect(background.of('closeOpened')[0]?.args).toEqual({ handle: 'o1' })
    const [blob, name] = vi.mocked(saveBlob).mock.calls[0]!
    expect(name).toBe('lease.pdf')
    expect(blob.size).toBe(10)
    // The popup held a port to the background for the download, and let it go after
    expect(fake.connects).toEqual([itemFilesKeepAlivePort])
    expect(fake.port.disconnect).toHaveBeenCalledTimes(1)
  })

  it('holds the port while the download runs, and lets it go when the download fails', async () => {
    const root = await openFile({
      openItemFile: () => ({ handle: 'o1', size: 10, name: 'lease.pdf' }),
      readOpened: () => {
        throw new Error('failed')
      },
      closeOpened: () => undefined,
    })
    expect(fake.connects).toEqual([])
    await click(button(root, t('files_downloadNamed', 'lease.pdf')))
    expect(fake.connects).toEqual([itemFilesKeepAlivePort])
    expect(fake.port.disconnect).toHaveBeenCalledTimes(1)
  })

  it('offers Download but no change on a file in a space the account may only read', async () => {
    const root = await openFile({ revealFile: () => fileFull({ space: { canEdit: false } }) })
    expect(button(root, t('files_downloadNamed', 'lease.pdf'))).not.toBeNull()
    for (const label of [t('files_replace'), t('files_delete'), 'Edit'])
      expect(button(root, label), label).toBeNull()
  })

  it('says it failed, and still lets the core go of the file', async () => {
    const root = await openFile({
      openItemFile: () => ({ handle: 'o1', size: 10, name: 'lease.pdf' }),
      readOpened: () => {
        throw new Error('failed')
      },
      closeOpened: () => undefined,
    })
    await click(button(root, t('files_downloadNamed', 'lease.pdf')))
    expect(text(root)).toContain('Something went wrong')
    expect(background.of('closeOpened')).toHaveLength(1)
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('cannot download a file the server doesn’t hold yet', async () => {
    const root = await openFile({ revealFile: () => fileFull({ onServer: false }) })
    expect(button(root, t('files_downloadNamed', 'lease.pdf'))?.disabled).toBe(true)
    expect(text(root)).toContain(t('files_notUploadedYet'))
  })

  it('copies the file’s name', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const root = await openFile()
    await click(button(root, t('files_copyName')))
    expect(writeText).toHaveBeenCalledWith('lease.pdf')
    expect(text(document.body)).toContain(t('files_copiedName'))
  })

  it('opens the files tab to replace the file', async () => {
    const root = await openFile()
    await click(button(root, t('files_replace')))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/files/index.html#replace/f1'])
  })

  it('asks before it deletes, then deletes and goes back', async () => {
    const root = await openFile()
    await click(button(root, t('files_delete')))
    expect(text(root)).toContain(t('files_deleteTitle'))
    expect(background.of('deleteFile')).toHaveLength(0)
    await click(button(root, 'Delete'))
    expect(background.of('deleteFile')[0]?.args).toEqual({ id: 'f1' })
  })

  it('has no way to change or download it with another sync, and says so', async () => {
    const root = await openFile({}, withoutServer)
    expect(text(root)).toContain(t('files_needSync'))
    for (const label of [t('files_downloadNamed', 'lease.pdf'), t('files_replace'), t('files_delete'), 'Edit'])
      expect(button(root, label), label).toBeNull()
    expect(button(root, t('files_copyName'))).not.toBeNull()
  })
})

describe('a File item’s edit page', () => {
  it('saves the name, notes and pin, and leaves the links it was not asked to change', async () => {
    const root = await openFile()
    await click(button(root, 'Edit'))
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('Lease')
    await change(input(root, 'Name'), 'Flat lease')
    await toggle(switchOf(root, 'Pin to the top'), true)
    await submit(root.querySelector('form'))
    expect(background.of('saveFile')[0]?.args).toEqual({
      id: 'f1',
      input: { name: 'Flat lease', notes: 'the flat on Rue Haute', pinned: true },
    })
    // The file's page replaces the edit page
    expect(text(root)).toContain('lease.pdf')
  })

  it('sends the links once the person changes them', async () => {
    const root = await openFile()
    await click(button(root, 'Edit'))
    await click(button(root, 'Pick a link (0)'))
    await submit(root.querySelector('form'))
    expect(background.of('saveFile')[0]?.args).toMatchObject({
      input: { links: [{ kind: 'note', id: 'n9' }] },
    })
  })

  it('waits for the links it holds before it lets one be picked or the file be saved', async () => {
    let answer: (value: unknown[]) => void = () => undefined
    const root = await openFile({
      linkedItems: () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    })
    await click(button(root, 'Edit'))
    expect(button(root, 'Pick a link (0)')?.disabled).toBe(true)
    expect(button(root, 'Save')?.disabled).toBe(true)
    answer([{ ref: { kind: 'login', id: 'l1' }, name: 'Orbit' }])
    await settle()
    expect(button(root, 'Pick a link (1)')?.disabled).toBe(false)
    expect(button(root, 'Save')?.disabled).toBe(false)
    // One pick adds to the link it held: it does not replace it
    await click(button(root, 'Pick a link (1)'))
    await submit(root.querySelector('form'))
    expect(background.of('saveFile')[0]?.args).toMatchObject({
      input: {
        links: [
          { kind: 'login', id: 'l1' },
          { kind: 'note', id: 'n9' },
        ],
      },
    })
  })

  it('does not save, and says why, when the links it holds could not be read', async () => {
    const root = await openFile({
      linkedItems: () => {
        throw new Error('failed')
      },
    })
    await click(button(root, 'Edit'))
    expect(button(root, 'Pick a link (0)')?.disabled).toBe(true)
    expect(button(root, 'Save')?.disabled).toBe(true)
    expect(root.querySelector('.notice, [role="alert"]')).not.toBeNull()
  })

  it('refuses a file without a name', async () => {
    const root = await openFile()
    await click(button(root, 'Edit'))
    await change(input(root, 'Name'), '  ')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('files_nameNeeded'))
    expect(background.of('saveFile')).toHaveLength(0)
  })

  it('starts a new file in the files tab, where the file is chosen', async () => {
    background.reset(handlers())
    const root = await mount(
      h(ToastProvider, null, h(EditFile, { id: null, onBack: () => undefined, onSaved: () => undefined })),
    )
    expect(text(root)).toContain(t('files_chooseInTab'))
    await click(button(root, t('files_choose')))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/files/index.html#newFile'])
  })

  it('says what files need with another sync, and offers nothing to change', async () => {
    background.reset(handlers({}, withoutServer))
    const root = await mount(
      h(ToastProvider, null, h(EditFile, { id: 'f1', onBack: () => undefined, onSaved: () => undefined })),
    )
    expect(text(root)).toContain(t('files_needSync'))
    expect(root.querySelector('form')).toBeNull()
  })
})

describe('a note’s files', () => {
  const noteOne = note({ id: 'n1', title: 'Wi-Fi', files: 1 })

  async function openNote(over: Record<string, unknown> = {}, sync = withServer) {
    background.reset(
      handlers(
        {
          revealNote: () => noteWith(),
          removeAttachment: () => noteWith({ attachments: [], files: 0 }),
          ...over,
        },
        sync,
        world({ notes: [noteOne] }),
      ),
    )
    const root = await openPopup()
    await click(button(root, 'Notes 1'))
    await click(button(root, 'Open Wi-Fi'))
    return root
  }

  it('lists them with their kind and size', async () => {
    const root = await openNote()
    expect(text(root)).toContain('scan.pdf')
    expect(text(root)).toContain('PDF · 2 KB')
  })

  it('downloads one by its id', async () => {
    const root = await openNote({
      openItemFile: () => ({ handle: 'o1', size: 5, name: 'scan.pdf' }),
      readOpened: (args: { index: number }) => (args.index === 0 ? 'aGVsbG8=' : ''),
      closeOpened: () => undefined,
    })
    await click(button(root, t('files_downloadNamed', 'scan.pdf')))
    expect(background.of('openItemFile')[0]?.args).toEqual({
      ref: { kind: 'note', id: 'n1' },
      attachmentId: 'a1',
    })
    expect(vi.mocked(saveBlob).mock.calls[0]?.[1]).toBe('scan.pdf')
  })

  it('asks before it removes one, then removes it and shows the note without it', async () => {
    const root = await openNote()
    await click(button(root, t('files_removeNamed', 'scan.pdf')))
    expect(text(root)).toContain(t('files_removeTitle'))
    expect(background.of('removeAttachment')).toHaveLength(0)
    background.set({ revealNote: (() => noteWith({ attachments: [], files: 0 })) as never })
    await click(button(root, t('files_remove')))
    expect(background.of('removeAttachment')[0]?.args).toEqual({ noteId: 'n1', attachmentId: 'a1' })
    expect(text(root)).not.toContain('scan.pdf')
  })

  it('keeps Download but hides Remove and Add files in a space the account may only read', async () => {
    background.reset(
      handlers(
        { revealNote: () => noteWith() },
        withServer,
        world({
          notes: [note({ id: 'n1', title: 'Wi-Fi', files: 1, space: { canEdit: false } } as never)],
        }),
      ),
    )
    const root = await openPopup()
    await click(button(root, 'Notes 1'))
    await click(button(root, 'Open Wi-Fi'))
    expect(button(root, t('files_downloadNamed', 'scan.pdf'))).not.toBeNull()
    expect(button(root, t('files_removeNamed', 'scan.pdf'))).toBeNull()
    expect(button(root, t('files_addFiles'))).toBeNull()
  })

  it('opens the files tab to add files to the note', async () => {
    const root = await openNote()
    await click(button(root, t('files_addFiles')))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/files/index.html#attach/n1'])
  })

  it('offers no way to add at a hundred files', async () => {
    const root = await openNote({
      revealNote: () =>
        noteWith({
          attachments: Array.from({ length: 100 }, (_, index) =>
            attachment({ id: `a${index}`, name: `f${index}.txt` }),
          ),
        }),
    })
    expect(button(root, t('files_addFiles'))).toBeNull()
  })

  it('lists them and says what they need with another sync, with no way to open or change them', async () => {
    const root = await openNote({}, withoutServer)
    expect(text(root)).toContain('scan.pdf')
    expect(text(root)).toContain(t('files_needSync'))
    for (const label of [
      t('files_downloadNamed', 'scan.pdf'),
      t('files_removeNamed', 'scan.pdf'),
      t('files_addFiles'),
    ])
      expect(button(root, label), label).toBeNull()
  })

  it('says a file that is not on the server yet', async () => {
    const root = await openNote({
      revealNote: () => noteWith({ attachments: [attachment({ onServer: false })] }),
    })
    expect(text(root)).toContain(t('files_notUploaded'))
    expect(button(root, t('files_downloadNamed', 'scan.pdf'))?.disabled).toBe(true)
  })
})

describe('the files strings in French', () => {
  it('reach the pages', async () => {
    fake = installFilesChrome('fr')
    background.reset(handlers())
    const root = await openPopup()
    await settle()
    expect(button(root, 'Fichiers 1')).not.toBeNull()
  })
})
