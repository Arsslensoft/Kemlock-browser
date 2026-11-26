// Helpers for the tests of files: `installChrome` of testing.ts with the files strings added to its messages, a port for the keepalive,
// and fixtures. Nothing here is imported by the extension itself.
import { vi } from 'vitest'
import filesEn from '../../locales/parts/files.en.json'
import filesFr from '../../locales/parts/files.fr.json'
import type { AttachmentView, FileFull, FileView, NoteFull } from '../shared/api'
import { installChrome, message, type FakeChrome } from './testing'

const sets = { en: filesEn, fr: filesFr } as Record<'en' | 'fr', Record<string, string>>

/** A files message with its `{name}` placeholders filled in order of first appearance, as the browser does. */
export function filesMessage(
  lang: 'en' | 'fr',
  name: string,
  subs: (string | number)[] = [],
): string {
  const text = sets[lang][name]
  if (text === undefined) return message(lang, name, subs.map(String))
  const names: string[] = []
  return text.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
    if (!names.includes(placeholder)) names.push(placeholder)
    return String(subs[names.indexOf(placeholder)] ?? '')
  })
}

/** The port a page holds to keep the background alive. */
export interface FakePort {
  postMessage: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

export interface FilesChrome extends FakeChrome {
  /** The ports opened with `runtime.connect`, by name. */
  connects: string[]
  port: FakePort
}

/** A fake `chrome` whose messages include the files strings, and whose `runtime.connect` hands out one port. */
export function installFilesChrome(lang: 'en' | 'fr' = 'en'): FilesChrome {
  const fake = installChrome(lang)
  const chromeLike = (
    globalThis as unknown as {
      chrome: {
        i18n: { getMessage: unknown }
        runtime: Record<string, unknown>
      }
    }
  ).chrome
  chromeLike.i18n.getMessage = (name: string, subs?: string | string[]) =>
    filesMessage(lang, name, subs === undefined ? [] : Array.isArray(subs) ? subs : [subs])
  const port: FakePort = { postMessage: vi.fn(), disconnect: vi.fn() }
  const connects: string[] = []
  chromeLike.runtime['connect'] = (info: { name: string }) => {
    connects.push(info.name)
    return port
  }
  return Object.assign(fake, { connects, port })
}

export const fileView = (over: Partial<FileView> = {}): FileView => ({
  id: 'f1',
  name: 'Lease',
  fileName: 'lease.pdf',
  size: 2048,
  type: 'application/pdf',
  pinned: false,
  tags: [],
  order: 0,
  changedAt: 1,
  onServer: true,
  links: 0,
  ...over,
})

export const fileFull = (over: Partial<FileFull> = {}): FileFull => ({
  ...fileView(),
  notes: '',
  ...over,
})

export const attachment = (over: Partial<AttachmentView> = {}): AttachmentView => ({
  id: 'a1',
  name: 'scan.pdf',
  size: 2048,
  type: 'application/pdf',
  onServer: true,
  ...over,
})

/** A note with its text and attachments, as `revealNote` answers. */
export const noteWith = (over: Partial<NoteFull> = {}): NoteFull => ({
  id: 'n1',
  title: 'Wi-Fi',
  tags: [],
  order: 0,
  pinned: false,
  files: 1,
  changedAt: 1,
  fields: [],
  links: 0,
  text: 'the password is hunter2',
  attachments: [attachment()],
  ...over,
})

/** A file whose bytes this test gives, since jsdom's `Blob` may not read itself. */
export function fileOf(bytes: Uint8Array<ArrayBuffer>, name: string, type = 'text/plain'): File {
  const file = new File([bytes], name, { type })
  Object.defineProperty(file, 'size', { value: bytes.length, configurable: true })
  file.slice = ((start = 0, end = bytes.length) => ({
    arrayBuffer: async () => bytes.slice(start, end).buffer,
  })) as never
  return file
}
