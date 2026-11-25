// @vitest-environment jsdom
// The transfer tab rendered over a mocked `ask`: the steps a person goes through to import a file and to export the vault.
import type * as SendModule from './send'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExportInfo,
  QrExport,
  TransferCounts,
  TransferOpened,
  TransferPlan,
  TransferPreview,
} from '../shared/transfer'
import { ToastProvider } from '../shared/ui/components'
import { lockChannel, type LockChannel } from '../shared/vault-lock-testing'
import { flushFrames, frameStubs, makeGetMessage } from '../setup/testkit'
import { App, panelOf } from './App'
import { ask, AskError } from './send'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof SendModule>()
  return { ...actual, ask: vi.fn() }
})

const root = join(import.meta.dirname, '..', '..')
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>
const messages = { ...read('locales/parts/transfer.en.json'), ...read('locales/app/en.json') }

type Handler = (args: Record<string, unknown>) => unknown
let handlers: Record<string, Handler>
let container: HTMLElement
let downloads: { name: string; href: string }[]
let created: Blob[]
let revoked: string[]
let channel: LockChannel

const zero = (): TransferCounts => ({
  codes: 0,
  backupServices: 0,
  logins: 0,
  notes: 0,
  passkeys: 0,
  keys: 0,
  cards: 0,
  identities: 0,
  contacts: 0,
  keyAccounts: 0,
})
const counts = (over: Partial<TransferCounts>): TransferCounts => ({ ...zero(), ...over })

const exportInfo: ExportInfo = {
  counts: counts({ codes: 2, logins: 3, notes: 1 }),
  spaceItems: 0,
  attachedFiles: 0,
  cxf: {
    sendable: { logins: 3, codes: 2, passkeys: 0, notes: 1, cards: 0, identities: 0, keys: 0 },
    leftOut: {},
  },
}

const opened = (over: Partial<TransferOpened> = {}): TransferOpened => ({
  token: 'tok',
  format: 'csv',
  encrypted: false,
  archiveFiles: 0,
  ...over,
})
const preview = (over: Partial<TransferPreview> = {}): TransferPreview => ({
  format: 'csv',
  held: counts({ logins: 2 }),
  skipped: 0,
  skips: [],
  notices: [],
  units: [],
  samples: [{ kind: 'login', name: 'GitHub', detail: 'me' }],
  attachedFiles: 0,
  spaceItems: 0,
  ...over,
})
const plan = (over: Partial<TransferPlan> = {}): TransferPlan => ({
  adding: counts({ logins: 1 }),
  held: counts({ logins: 2 }),
  duplicates: counts({ logins: 1 }),
  canImport: true,
  contacts: [],
  ...over,
})

beforeEach(() => {
  handlers = { transferExportInfo: () => exportInfo }
  vi.mocked(ask).mockReset()
  vi.mocked(ask).mockImplementation(((kind: string, args?: Record<string, unknown>) => {
    const handler = handlers[kind]
    if (handler === undefined) return Promise.reject(new Error(`unexpected ask ${kind}`))
    try {
      return Promise.resolve(handler(args ?? {}))
    } catch (failure) {
      return Promise.reject(failure)
    }
  }) as never)
  channel = lockChannel()
  vi.stubGlobal('chrome', {
    i18n: { getMessage: makeGetMessage(messages), getUILanguage: () => 'en' },
    runtime: channel.runtime,
  })
  for (const [name, value] of Object.entries(frameStubs())) vi.stubGlobal(name, value)
  downloads = []
  created = []
  revoked = []
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob)
        return `blob:kemlock/${created.length}`
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url)
      },
    }),
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, href: this.href })
  })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  vi.useRealTimers()
  await act(() => {
    render(null, container)
  })
  await flushFrames()
  container.remove()
  window.history.replaceState(null, '', '#')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const settle = () =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  })

async function open(hash = '#import') {
  window.history.replaceState(null, '', hash)
  await act(() => {
    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
      container,
    )
  })
  await settle()
}

const text = () => container.textContent ?? ''
const calls = (kind: string) => vi.mocked(ask).mock.calls.filter((call) => call[0] === kind)

const button = (label: string | RegExp): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((b) =>
    typeof label === 'string'
      ? (b.textContent ?? '').trim().startsWith(label)
      : label.test(b.textContent ?? ''),
  )
  if (found === undefined)
    throw new Error(`no button "${String(label)}" in: ${text().slice(0, 400)}`)
  return found
}

const click = async (element: Element) => {
  await act(() => {
    ;(element as HTMLElement).click()
  })
  await settle()
}

const field = (label: string): HTMLInputElement => {
  const found = [...container.querySelectorAll('label')].find((l) =>
    (l.textContent ?? '').startsWith(label),
  )
  const id = found?.getAttribute('for')
  const input = id === null || id === undefined ? null : document.getElementById(id)
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field "${label}"`)
  return input
}

const type = async (label: string, value: string) => {
  const input = field(label)
  await act(() => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Chooses [file] in the page's file input. */
async function chooseFile(file: File, which: 'file' | 'images' = 'file') {
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')]
  const input = which === 'file' ? inputs[0]! : inputs[1]!
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

const csvFile = () =>
  new File(['name,url,username,password\nGitHub,https://github.com,me,pw\n'], 'logins.csv', {
    type: 'text/csv',
  })

describe('panelOf', () => {
  it('is Export for #export and Import for anything else', () => {
    expect(panelOf('#export')).toBe('export')
    expect(panelOf('#import')).toBe('import')
    expect(panelOf('')).toBe('import')
    expect(panelOf('#other')).toBe('import')
  })
})

describe('opening the tab', () => {
  it('asks for the password when the vault is locked, and shows the panels once it is open', async () => {
    let locked = true
    handlers.transferExportInfo = () => {
      if (locked) throw new AskError('locked')
      return exportInfo
    }
    handlers.transferUnlock = ({ password }) => {
      if (password !== 'right') return { ok: false, wrongPasswords: 2 }
      locked = false
      return { ok: true, wrongPasswords: 2 }
    }
    await open()
    expect(text()).toContain('Unlock Kemlock')

    await type('Kemlock password', 'wrong')
    await click(button('Unlock'))
    expect(text()).toContain('That is not the password.')
    expect(text()).toContain('2 wrong passwords')

    await type('Kemlock password', 'right')
    await click(button('Unlock'))
    expect(text()).not.toContain('Unlock Kemlock')
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(text()).toContain('Choose what to import')
  })

  it('says so when there is no vault', async () => {
    handlers.transferExportInfo = () => {
      throw new AskError('noVault')
    }
    await open()
    expect(text()).toContain('no Kemlock vault in this browser')
  })

  it('opens on Export for #export, and the tabs switch the panel and the address', async () => {
    await open('#export')
    expect(text()).toContain('How to export')

    await click(container.querySelector('#tab-import')!)
    expect(text()).toContain('Choose what to import')
    expect(location.hash).toBe('#import')
  })
})

describe('import', () => {
  it('opens a CSV, shows what it holds against the vault, and merges it', async () => {
    handlers.transferOpen = () => opened()
    handlers.transferPreview = () => preview()
    handlers.transferPlan = () => plan()
    handlers.transferApply = () => ({ added: counts({ logins: 1 }), replaced: false })
    await open()

    await chooseFile(csvFile())

    expect(calls('transferOpen')[0]![1]).toEqual({
      data: btoa('name,url,username,password\nGitHub,https://github.com,me,pw\n'),
    })
    expect(text()).toContain('CSV file of logins')
    const rows = [...container.querySelectorAll('table.counts tbody tr')].map((tr) =>
      (tr.textContent ?? '').trim(),
    )
    expect(rows).toEqual(['Logins211'])
    expect(text()).toContain('GitHub')
    await click(button('Import 1 item'))
    expect(calls('transferApply')[0]![1]).toEqual({
      token: 'tok',
      options: { mode: 'merge', excluded: [], keepChecks: false },
    })
    expect(text()).toContain('Imported. It is in the vault now.')
    expect(text()).toContain('sync carries')
  })

  it('says how many items it left alone in a space the account can only read', async () => {
    handlers.transferOpen = () => opened()
    handlers.transferPreview = () => preview()
    handlers.transferPlan = () => plan()
    handlers.transferApply = () => ({ added: counts({ logins: 1 }), replaced: true, skipped: 2 })
    await open()

    await chooseFile(csvFile())
    await click(button('Import 1 item'))

    expect(text()).toContain(
      '2 items were left as they are: they are in a space you can only read.',
    )
  })

  it('asks for the password of an encrypted file, and tries again after a wrong one', async () => {
    handlers.transferOpen = () => opened({ format: 'kemlock', encrypted: true })
    handlers.transferPreview = ({ password }) => {
      if (password !== 'secret') throw new AskError('importBadPassword')
      return preview({ format: 'kemlock' })
    }
    handlers.transferPlan = () => plan()
    await open()

    await chooseFile(new File(['{}'], 'export.json'))
    expect(text()).toContain('This file is encrypted')
    expect(calls('transferPreview')).toHaveLength(0)

    await type('Password of the file', 'nope')
    await click(button('Open'))
    expect(text()).toContain('does not open the file')
    expect(text()).toContain('This file is encrypted')

    await type('Password of the file', 'secret')
    await click(button('Open'))
    expect(text()).toContain('What it holds')
    expect(text()).not.toContain('This file is encrypted')
  })

  describe('with a Recovery Kit', () => {
    const encrypted = () => {
      handlers.transferOpen = () => opened({ format: 'kemlock', encrypted: true })
      handlers.transferPlan = () => plan()
    }

    it('opens an encrypted export with two pieces instead of its password', async () => {
      encrypted()
      handlers.transferPreviewKit = ({ pieces }) => {
        if ((pieces as string[])[1] === 'BMCKIT1-TYPO') throw new AskError('importKitChecksum')
        return preview({ format: 'kemlock' })
      }
      await open()
      await chooseFile(csvFile())
      expect(text()).toContain('This file is encrypted')

      await click(button('Use a Recovery Kit instead'))
      expect(text()).toContain('Open it with a Recovery Kit')
      expect(button('Open with the kit').disabled).toBe(true)
      await type('First piece', ' BMCKIT1-ONE ')
      await type('Second piece', 'BMCKIT1-TYPO')
      await click(button('Open with the kit'))
      // The file stays open for another try, with the pieces still to correct
      expect(text()).toContain('A piece has a typo')
      expect(field('First piece').value).toBe(' BMCKIT1-ONE ')

      await type('Second piece', 'BMCKIT1-TWO')
      await click(button('Open with the kit'))
      expect(calls('transferPreviewKit')[1]![1]).toEqual({
        token: 'tok',
        pieces: ['BMCKIT1-ONE', 'BMCKIT1-TWO'],
      })
      expect(calls('transferPreview')).toHaveLength(0)
      expect(text()).toContain('GitHub')
      // The pieces are not on the page once the file is open
      expect(container.innerHTML).not.toContain('BMCKIT1')
    })

    it('goes back to the password, and clears the pieces', async () => {
      encrypted()
      await open()
      await chooseFile(csvFile())
      await click(button('Use a Recovery Kit instead'))
      await type('First piece', 'BMCKIT1-ONE')
      await click(button('Use the file’s password instead'))
      expect(text()).toContain('Password of the file')
      await click(button('Use a Recovery Kit instead'))
      expect(field('First piece').value).toBe('')
    })

    it('says a file without a kit has none, and goes back to the password', async () => {
      encrypted()
      handlers.transferPreviewKit = () => {
        throw new AskError('importNoKit')
      }
      await open()
      await chooseFile(csvFile())
      await click(button('Use a Recovery Kit instead'))
      await type('First piece', 'BMCKIT1-ONE')
      await type('Second piece', 'BMCKIT1-TWO')
      await click(button('Open with the kit'))
      expect(text()).toContain('exported without a Recovery Kit')
      expect(text()).toContain('Password of the file')
    })

    it('is offered for Kemlock’s own file only, not another app’s or the QR codes’', async () => {
      handlers.transferOpen = () => opened({ format: 'aegis', encrypted: true })
      await open()
      await chooseFile(csvFile())
      expect(text()).toContain('This file is encrypted')
      expect(text()).not.toContain('Use a Recovery Kit instead')
    })

    it('goes to the unlock screen when the vault locks as the pieces are sent', async () => {
      encrypted()
      handlers.transferPreviewKit = () => {
        throw new AskError('locked')
      }
      await open()
      await chooseFile(csvFile())
      await click(button('Use a Recovery Kit instead'))
      await type('First piece', 'BMCKIT1-ONE')
      await type('Second piece', 'BMCKIT1-TWO')
      handlers.transferExportInfo = () => {
        throw new AskError('locked')
      }
      await click(button('Open with the kit'))
      expect(text()).toContain('Unlock Kemlock')
      expect(text()).not.toContain('BMCKIT1')
    })
  })

  it('says why a file cannot be read, in the words the core gave, and goes back to the start', async () => {
    handlers.transferOpen = () => {
      throw new AskError('importUnsupported')
    }
    await open()

    await chooseFile(new File(['hello'], 'x.txt'))

    expect(text()).toContain('Kemlock cannot read this.')
    expect(text()).toContain('Choose what to import')
  })

  it('reads QR codes from pictures and from nothing else mixed in', async () => {
    handlers.transferOpenQr = () => opened({ format: 'google', codesRead: 1, imagesUnread: 1 })
    handlers.transferPreview = () =>
      preview({ format: 'google', held: counts({ codes: 3 }), samples: [] })
    handlers.transferPlan = () =>
      plan({ adding: counts({ codes: 3 }), held: counts({ codes: 3 }), duplicates: zero() })
    await open()

    await chooseFile(new File(['x'], 'shot.png', { type: 'image/png' }), 'images')
    // A picture is read by a FileReader, which answers on a later task than the page's own steps
    await vi.waitFor(() => expect(calls('transferOpenQr')).toHaveLength(1))
    await settle()
    expect((calls('transferOpenQr')[0]![1] as { images: string[] }).images[0]).toMatch(
      /^data:image\/png;base64,/,
    )
    expect(text()).toContain('Google Authenticator transfer')
    expect(text()).toContain('1 picture held no QR code')
    expect(text()).toContain('Import 3 items')
  })

  it('reloads what an export holds once an import has changed the vault', async () => {
    handlers.transferOpen = () => opened()
    handlers.transferPreview = () => preview()
    handlers.transferPlan = () => plan()
    handlers.transferApply = () => ({ added: counts({ logins: 1 }), replaced: false })
    await open()
    await chooseFile(csvFile())
    expect(calls('transferExportInfo')).toHaveLength(1)

    await click(button('Import 1 item'))

    expect(calls('transferExportInfo')).toHaveLength(2)
    expect(text()).toContain('Imported. It is in the vault now.')
  })

  it('says how many items come from shared spaces and come in as the person’s own', async () => {
    handlers.transferOpen = () => opened()
    handlers.transferPreview = () => preview({ spaceItems: 2 })
    handlers.transferPlan = () => plan()
    await open()

    await chooseFile(csvFile())

    expect(text()).toContain('2 items come from shared spaces')
    expect(text()).toContain('come in as your own')
  })

  it('refuses pictures that are too many bytes together, without sending them', async () => {
    await open()
    const big = () => {
      const file = new File(['x'], 'shot.png', { type: 'image/png' })
      Object.defineProperty(file, 'size', { value: 12 * 1024 * 1024 })
      return file
    }
    const input = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    Object.defineProperty(input, 'files', { value: [big(), big(), big()], configurable: true })

    await act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()

    expect(calls('transferOpenQr')).toHaveLength(0)
    expect(text()).toContain('32 MiB in all')
  })

  it('refuses a file over the limit without sending it', async () => {
    await open()
    const big = new File(['x'], 'big.json')
    Object.defineProperty(big, 'size', { value: 41 * 1024 * 1024 })

    await chooseFile(big)

    expect(calls('transferOpen')).toHaveLength(0)
    expect(text()).toContain('larger than Kemlock reads (40 MiB)')
  })

  it('lists what a Credential Exchange file leaves out, lets a place be left out, and plans again', async () => {
    handlers.transferOpen = () => opened({ format: 'cxf', exporter: 'Apple Passwords' })
    handlers.transferPreview = () =>
      preview({
        format: 'cxf',
        exporter: 'Apple Passwords',
        held: counts({ logins: 3, passkeys: 1 }),
        units: [
          { id: 'u1', name: 'jane', shared: false, count: 3 },
          { id: 'u2', name: 'Family', shared: true, count: 1 },
        ],
        skips: [{ title: 'Home wifi', reason: 'wifi' }],
        notices: [{ title: 'GitHub passkey', reason: 'passkeyExtras' }],
        cuts: { items: 2, credentials: 0, urls: 0, collections: 0, values: 0 },
      })
    handlers.transferPlan = () =>
      plan({
        adding: counts({ logins: 3, passkeys: 1 }),
        held: counts({ logins: 3, passkeys: 1 }),
        duplicates: zero(),
      })
    await open()

    await chooseFile(new File(['{}'], 'cxf.json'))

    expect(text()).toContain('Credential Exchange file from Apple Passwords')
    expect(text()).toContain('Home wifi')
    expect(text()).toContain('Kemlock does not keep Wi-Fi networks')
    expect(text()).toContain('GitHub passkey: imported without its extra secrets')
    expect(text()).toContain('2 items were left out')
    expect(text()).toContain('shared with others')
    const before = calls('transferPlan').length
    const family = [...container.querySelectorAll<HTMLInputElement>('.unit input')][1]!
    await click(family)
    expect(calls('transferPlan').length).toBeGreaterThan(before)
    expect(calls('transferPlan').at(-1)![1]).toMatchObject({ options: { excluded: ['u2'] } })
  })

  it('needs a second step to replace the vault’s codes', async () => {
    handlers.transferOpen = () => opened({ format: 'uris' })
    handlers.transferPreview = () =>
      preview({ format: 'uris', held: counts({ codes: 2 }), samples: [] })
    handlers.transferPlan = ({ options }) =>
      plan({
        adding: counts({ codes: (options as { mode: string }).mode === 'replace' ? 2 : 1 }),
        held: counts({ codes: 2 }),
        duplicates: counts({ codes: 1 }),
      })
    handlers.transferApply = () => ({ added: counts({ codes: 2 }), replaced: true })
    await open()
    await chooseFile(new File(['otpauth://totp/a?secret=ABC'], 'links.txt'))

    await click(container.querySelector('input[type="radio"][name="mode"]:not(:checked)')!)

    expect(text()).toContain('Replacing puts the codes of this file in place')
    expect(button('Replace and import').disabled).toBe(true)
    await click(container.querySelector('input[role="switch"]')!)
    expect(button('Replace and import').disabled).toBe(false)
    await click(button('Replace and import'))
    expect(calls('transferApply')[0]![1]).toMatchObject({ options: { mode: 'replace' } })
    expect(text()).toContain('replaced the codes of the vault')
  })

  it('drops the opened file when it is cancelled', async () => {
    handlers.transferOpen = () => opened()
    handlers.transferPreview = () => preview()
    handlers.transferPlan = () => plan()
    handlers.transferCancel = () => undefined
    await open()
    await chooseFile(csvFile())

    await click(button('Cancel'))

    expect(calls('transferCancel')[0]![1]).toEqual({ token: 'tok' })
    expect(text()).toContain('Choose what to import')
  })

  it('goes to the unlock screen when the vault locks while it is open', async () => {
    handlers.transferOpen = () => {
      throw new AskError('locked')
    }
    await open()
    handlers.transferExportInfo = () => {
      throw new AskError('locked')
    }

    await chooseFile(csvFile())

    expect(text()).toContain('Unlock Kemlock')
  })
})

describe('export', () => {
  it('writes an encrypted file once both passwords are typed and the vault’s is given, and saves it', async () => {
    handlers.transferExport = () => ({
      name: 'kemlock-export-2026-11-24T09-00-00.json',
      mime: 'application/json',
      text: '{"encrypted":true}',
      counts: counts({ codes: 2, logins: 3 }),
      leftOut: [],
      spaceItems: 0,
      attachedFiles: 0,
    })
    await open('#export')
    expect(button('Export and save').disabled).toBe(true)

    await type('Password of the file', 'transfer pw')
    await type('Type it again', 'transfer pX')
    expect(text()).toContain('The passwords do not match.')
    await type('Type it again', 'transfer pw')
    await type('Your Kemlock password', 'my vault')
    expect(button('Export and save').disabled).toBe(false)
    await click(button('Export and save'))

    expect(calls('transferExport')[0]![1]).toEqual({
      format: 'encrypted',
      password: 'my vault',
      exportPassword: 'transfer pw',
    })
    expect(downloads).toEqual([
      { name: 'kemlock-export-2026-11-24T09-00-00.json', href: 'blob:kemlock/1' },
    ])
    expect(await created[0]!.text()).toBe('{"encrypted":true}')
    expect(text()).toContain('Exported as kemlock-export-2026-11-24T09-00-00.json')
    // The passwords are not kept in the page
    expect(
      container.querySelectorAll<HTMLInputElement>('input[type="password"]').length,
    ).toBeGreaterThan(0)
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="password"]'))
      expect(input.value).toBe('')
    // Saving again goes to the same address
    await click(button('Save again'))
    expect(downloads).toHaveLength(2)
  })

  it('asks the person to say they know a plain file is not encrypted, as the app does', async () => {
    handlers.transferExport = () => ({
      name: 'kemlock-logins.csv',
      mime: 'text/csv',
      text: 'x',
      counts: counts({ logins: 3 }),
      leftOut: [],
      spaceItems: 0,
      attachedFiles: 0,
    })
    await open('#export')

    await click([...container.querySelectorAll<HTMLInputElement>('input[name="format"]')][2]!)
    expect(text()).toContain('A CSV file is not encrypted')
    await type('Your Kemlock password', 'my vault')
    expect(button('Export and save').disabled).toBe(true)

    await click(container.querySelector('input[role="switch"]')!)
    await click(button('Export and save'))

    expect(calls('transferExport')[0]![1]).toEqual({ format: 'csv', password: 'my vault' })
    expect(downloads[0]!.name).toBe('kemlock-logins.csv')
  })

  it('names the kinds a Credential Exchange export sends, and sends the ones ticked', async () => {
    handlers.transferExport = () => ({
      name: 'kemlock-credentials.json',
      mime: 'application/json',
      text: '{}',
      counts: counts({ logins: 3 }),
      leftOut: [{ title: 'Old code', reason: 'notTotp' }],
      spaceItems: 0,
      attachedFiles: 0,
    })
    await open('#export')
    await click([...container.querySelectorAll<HTMLInputElement>('input[name="format"]')][4]!)

    const boxes = [...container.querySelectorAll<HTMLInputElement>('.unit input')]
    // Passkeys, cards, identities and keys have nothing to send, so they cannot be ticked
    expect(boxes.map((box) => box.disabled)).toEqual([false, false, true, false, true, true, true])
    await click(boxes[1]!)
    await click(container.querySelector('input[role="switch"]')!)
    await type('Your Kemlock password', 'my vault')
    await click(button('Export and save'))

    expect(calls('transferExport')[0]![1]).toEqual({
      format: 'cxf',
      password: 'my vault',
      kinds: ['logins', 'notes'],
    })
    expect(text()).toContain('Old code')
  })

  it('shows what a wrong vault password says, and keeps what else was typed', async () => {
    handlers.transferExport = () => {
      throw new AskError('badPassword')
    }
    await open('#export')
    await type('Password of the file', 'transfer pw')
    await type('Type it again', 'transfer pw')
    await type('Your Kemlock password', 'wrong')

    await click(button('Export and save'))

    expect(text()).toContain('That is not your Kemlock password.')
    expect(downloads).toHaveLength(0)
    expect(field('Your Kemlock password').value).toBe('')
    expect(field('Password of the file').value).toBe('transfer pw')
  })

  it('tells what stays out: the items of shared spaces and the attached files', async () => {
    handlers.transferExportInfo = () => ({ ...exportInfo, spaceItems: 2, attachedFiles: 1 })
    await open('#export')

    expect(text()).toContain('2 items of shared spaces stay out of every export')
    expect(text()).toContain('1 attached file is not in any export')
  })

  it('draws QR codes on the screen, one at a time, and hides them', async () => {
    const code = {
      size: 21,
      modules: Array.from({ length: 441 }, (_, i) => (i % 2 === 0 ? '1' : '0')).join(''),
    }
    const qr: QrExport = {
      codes: [code, code],
      exported: 12,
      backupServices: 0,
      leftOut: [{ title: 'Steam', reason: 'steam' }],
    }
    handlers.transferExportQr = () => qr
    await open('#export')
    await click([...container.querySelectorAll<HTMLInputElement>('input[name="format"]')][5]!)
    await click(container.querySelector('input[role="switch"]')!)
    await type('Your Kemlock password', 'my vault')

    await click(button('Show the QR codes'))

    expect(calls('transferExportQr')[0]![1]).toEqual({ format: 'google', password: 'my vault' })
    const image = container.querySelector('svg.qr')!
    expect(image.getAttribute('aria-label')).toBe('QR code 1 of 2')
    expect(image.querySelector('path')!.getAttribute('d')).toMatch(/^M4 4h1v1h-1z/)
    expect(text()).toContain('Steam: a Steam code has no place in this format')
    await click(button('Next'))
    expect(container.querySelector('svg.qr')!.getAttribute('aria-label')).toBe('QR code 2 of 2')
    await click(button('Hide the codes'))
    expect(container.querySelector('svg.qr')).toBeNull()
  })

  it('takes the QR codes off the screen after two minutes', async () => {
    vi.useFakeTimers()
    const code = { size: 21, modules: '0'.repeat(441) }
    handlers.transferExportQr = () => ({
      codes: [code],
      exported: 1,
      backupServices: 0,
      leftOut: [],
    })
    await open('#export')
    await click([...container.querySelectorAll<HTMLInputElement>('input[name="format"]')][5]!)
    await click(container.querySelector('input[role="switch"]')!)
    await type('Your Kemlock password', 'my vault')
    await click(button('Show the QR codes'))
    expect(container.querySelector('svg.qr')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(121_000)
    })

    expect(container.querySelector('svg.qr')).toBeNull()
  })

  it('gives each new set of QR codes its own two minutes', async () => {
    vi.useFakeTimers()
    const code = { size: 21, modules: '0'.repeat(441) }
    handlers.transferExportQr = () => ({
      codes: [code],
      exported: 1,
      backupServices: 0,
      leftOut: [],
    })
    await open('#export')
    await click([...container.querySelectorAll<HTMLInputElement>('input[name="format"]')][5]!)
    const show = async () => {
      await click(container.querySelector('input[role="switch"]')!)
      await type('Your Kemlock password', 'my vault')
      await click(button('Show the QR codes'))
    }
    const wait = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })

    await show()
    await wait(100_000)
    // A second set, 100 seconds into the first: its two minutes start now
    await show()
    await wait(100_000)
    expect(container.querySelector('svg.qr')).not.toBeNull()

    await wait(30_000)
    expect(container.querySelector('svg.qr')).toBeNull()
  })
})

describe('when the vault locks', () => {
  const lockIt = async () => {
    handlers.transferExportInfo = () => {
      throw new AskError('locked')
    }
    await act(() => {
      channel.lock()
    })
    await settle()
  }

  it('drops an opened file and goes back to the password step', async () => {
    handlers.transferOpen = () => opened()
    handlers.transferPreview = () => preview()
    handlers.transferPlan = () => plan()
    await open()
    await chooseFile(csvFile())
    expect(text()).toContain('GitHub')

    await lockIt()

    expect(text()).toContain('Unlock Kemlock')
    expect(text()).not.toContain('GitHub')
    expect(container.querySelector('table.counts')).toBeNull()
  })

  it('takes the QR codes off the screen', async () => {
    const code = { size: 21, modules: '0'.repeat(441) }
    handlers.transferExportQr = () => ({
      codes: [code],
      exported: 1,
      backupServices: 0,
      leftOut: [],
    })
    await open('#export')
    await click([...container.querySelectorAll<HTMLInputElement>('input[name="format"]')][5]!)
    await click(container.querySelector('input[role="switch"]')!)
    await type('Your Kemlock password', 'my vault')
    await click(button('Show the QR codes'))
    expect(container.querySelector('svg.qr')).not.toBeNull()

    await lockIt()

    expect(container.querySelector('svg.qr')).toBeNull()
    expect(text()).toContain('Unlock Kemlock')
  })

  it('lets go of the exported file’s address', async () => {
    handlers.transferExport = () => ({
      name: 'kemlock-export-2026-11-24T09-00-00.json',
      mime: 'application/json',
      text: '{"encrypted":true}',
      counts: counts({ codes: 2, logins: 3 }),
      leftOut: [],
      spaceItems: 0,
      attachedFiles: 0,
    })
    await open('#export')
    await type('Password of the file', 'transfer pw')
    await type('Type it again', 'transfer pw')
    await type('Your Kemlock password', 'my vault')
    await click(button('Export and save'))
    expect(created).toHaveLength(1)
    expect(revoked).toEqual([])

    await lockIt()

    expect(revoked).toEqual(['blob:kemlock/1'])
    expect(text()).toContain('Unlock Kemlock')
  })

  it('asks again when the tab comes to the front and the vault is not open', async () => {
    handlers.pageState = () => ({ exists: true, unlocked: false, wrongPasswords: 0 })
    await open()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(text()).toContain('Unlock Kemlock')
  })

  it('listens only while it is open, and only to the extension', async () => {
    await open()
    expect(channel.listening()).toBe(1)
    await act(() => {
      channel.send({ kemlock: 'locked' }, { id: 'kemlock', url: 'https://evil.example/' })
    })
    await settle()
    expect(text()).toContain('Choose what to import')
    await act(() => {
      render(null, container)
    })
    expect(channel.listening()).toBe(0)
  })
})
