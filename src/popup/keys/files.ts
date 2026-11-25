// Files in and out of the keys screens: reading a chosen file as base64 for the core, saving text or bytes as a download, and
// the keys tab that holds the screens when a file dialog or a long job would close the popup.
import { maxFileBytes } from '../../shared/keys-api'

export { maxFileBytes }

const chunk = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += chunk)
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}

/** A file the person chose, as the core takes it: its name and its bytes in base64. */
export interface PickedFile {
  name: string
  size: number
  base64: string
}

/** Reads [file]; null when it is over what the tools take (the caller says so). */
export async function readFile(file: File): Promise<PickedFile | null> {
  if (file.size > maxFileBytes) return null
  return {
    name: file.name,
    size: file.size,
    base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  }
}

/** The file's text, for a pasted-key box that a key file fills (a key is text, and under 1 MB). */
export async function readText(file: File): Promise<string | null> {
  if (file.size > 1024 * 1024) return null
  return file.text()
}

/** Saves [content] as a file the browser downloads. */
export function download(name: string, content: string | Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // The browser starts the download before this runs
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Whether these screens are in the keys tab (a page of the whole window) and not in the toolbar popup. */
export function inKeysTab(): boolean {
  return typeof location !== 'undefined' && location.pathname.endsWith('/src/keys/index.html')
}

/** Opens the keys tab, at a screen by its hash (`#tools/encrypt`); the popup closes when a tab opens. */
export function openKeysTab(hash = ''): void {
  const url = chrome.runtime.getURL(`src/keys/index.html${hash === '' ? '' : `#${hash}`}`)
  void chrome.tabs.create({ url })
}
