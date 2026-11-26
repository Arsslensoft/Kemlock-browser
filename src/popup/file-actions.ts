// What the pages of files share: how a file is described (size, kind), saving one to the downloads, opening the files tab, and what is
// said when the core refuses. Files are Kemlock Server's: with another sync they are listed and left alone (`fileSync`).
import { useState } from 'preact/hooks'
import type { FileSync, ItemRef, SyncStatus } from '../shared/api'
import { holdBackground } from '../files/keepalive'
import { readFile, saveBlob } from '../sends/files'
import { errorMessage, hasMessage, t } from '../shared/ui/i18n'
import { ask } from './send'
import { useSyncStatus } from './sync-state'

/** The most a file holds, as the app limits it: 50 MiB. */
export const itemFileLimit = 50 * 1024 * 1024

/** How many files a note holds. */
export const noteFileLimit = 100

/** A file's size as the app shows it. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return t('items_sizeBytes', bytes)
  if (bytes < 1024 * 1024) return t('items_sizeKb', Math.max(1, Math.round(bytes / 1024)))
  return t('items_sizeMb', (bytes / (1024 * 1024)).toFixed(1))
}

const kindsByExtension: Record<string, string> = {
  txt: 'text',
  md: 'text',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
}

/**
 * What kind of file it is, in a word ("Text", "PDF", "Image", "Audio", "Video"); any other file by its extension in capitals ("ZIP"),
 * or by its media type's subtype when it has no extension. Empty when nothing says.
 */
export function fileKind(file: { name: string; type?: string }): string {
  const media = file.type ?? ''
  if (media === 'application/pdf') return 'PDF'
  if (media === 'text/plain') return t('files_kind_text')
  const family = media.split('/')[0] ?? ''
  if (family === 'image' || family === 'audio' || family === 'video')
    return t(`files_kind_${family}`)
  const extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : ''
  const known = kindsByExtension[extension]
  if (known === 'pdf') return 'PDF'
  if (known !== undefined) return t(`files_kind_${known}`)
  const subtype = media.split('/')[1]?.split(/[;+]/)[0] ?? ''
  const label = extension.length > 0 && extension.length <= 5 ? extension : subtype
  return label === '' ? '' : label.toUpperCase()
}

/** "PDF · 2.4 MB": the kind and the size, whichever are known. */
export function fileDetail(file: { name: string; type?: string; size?: number }): string {
  return [fileKind(file), file.size === undefined ? '' : fileSize(file.size)]
    .filter((part) => part !== '')
    .join(' · ')
}

/** What the core said when a file would not go, in words: its codes by name, anything else as the popup says errors. */
export function fileError(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (code === 'unavailable') return t('files_needSync')
  const name = `files_error_${code}`
  return code !== '' && hasMessage(name) ? t(name) : errorMessage(error)
}

/**
 * Saves the file of [ref] (a File item, or a note's attachment) to the downloads: the background opens it, the pieces are read one at
 * a time into a blob, the browser saves the blob under the file's name, and the background lets the file go. A port is held open
 * to the background while it runs: the background closes what the file's pieces were read from if the popup goes away first.
 */
export async function downloadItemFile(
  ref: ItemRef,
  attachmentId: string | undefined,
  fallbackName: string,
): Promise<void> {
  const release = holdBackground()
  try {
    const opened = await ask(
      'openItemFile',
      attachmentId === undefined ? { ref } : { ref, attachmentId },
    )
    try {
      const blob = await readFile((index) => ask('readOpened', { handle: opened.handle, index }))
      saveBlob(blob, opened.name === '' ? fallbackName : opened.name)
    } finally {
      await ask('closeOpened', { handle: opened.handle }).catch(() => undefined)
    }
  } finally {
    release()
  }
}

/** Opens the files tab, at its page by the hash (`newFile`, `replace/<id>`, `attach/<noteId>`); the popup closes when it opens. */
export function openFilesTab(hash: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`src/files/index.html#${hash}`) })
}

/** What files can do under [sync] (the sync status; null when the vault doesn't sync): 'kemlock' only with Kemlock Server. */
export const fileSyncOf = (sync: SyncStatus | null): FileSync => sync?.fileSync ?? 'readOnly'

/**
 * Whether files can be changed from here: 'kemlock' when the vault syncs with Kemlock Server, 'readOnly' otherwise (a file is listed
 * and left alone). Undefined while it is still being asked.
 */
export function useFileSync(): FileSync | undefined {
  const [sync] = useSyncStatus()
  return sync === undefined ? undefined : fileSyncOf(sync)
}

/** Downloads for a page: [busy] is the attachment being fetched now ('' for a File item's own), [failed] why the last one did not. */
export function useDownload(ref: ItemRef) {
  const [busy, setBusy] = useState<string | undefined>()
  const [failed, setFailed] = useState<string | undefined>()
  const download = async (attachmentId: string | undefined, name: string) => {
    setBusy(attachmentId ?? '')
    setFailed(undefined)
    try {
      await downloadItemFile(ref, attachmentId, name)
    } catch (error) {
      setFailed(fileError(error))
    } finally {
      setBusy(undefined)
    }
  }
  return { busy, failed, download }
}
