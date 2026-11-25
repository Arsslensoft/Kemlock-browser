// A file crossing between this page and the core, a piece at a time: a message is JSON, so bytes go as base64, and the core holds the
// whole file (docs/plans/add-sends.md, design 8). Nothing here keeps a file: the pieces are passed on as they are read.
import { sendChunkBytes, type SendResult } from '../shared/sends'

/** Bytes as base64. */
export function toBase64(bytes: Uint8Array): string {
  let text = ''
  // String.fromCharCode takes its arguments on the stack: a few thousand at a time
  for (let at = 0; at < bytes.length; at += 0x2000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x2000))
  return btoa(text)
}

/** Base64 as bytes. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** What the core says of a file being staged: the handle only this tab has, and how many bytes it holds. */
export interface Staged {
  handle: string
  length: number
}

/**
 * Gives [file] to the core, [sendChunkBytes] at a time, the first piece starting a new staging, whose handle every other piece names. Stops at the first piece the core
 * refuses and says why. [progress] hears how many bytes have gone.
 */
export async function stageFile(
  file: Blob,
  stage: (data: string, handle: string | undefined) => Promise<SendResult<Staged>>,
  progress?: (sent: number, total: number) => void,
  release?: (handle: string) => Promise<unknown>,
): Promise<SendResult<Staged>> {
  let sent = 0
  let handle: string | undefined
  let last: SendResult<Staged>
  do {
    const piece = new Uint8Array(await file.slice(sent, sent + sendChunkBytes).arrayBuffer())
    last = await stage(toBase64(piece), handle)
    if (!last.ok) {
      // What went up before the refusal is let go of, not left in the core
      if (handle !== undefined) await release?.(handle)
      return last
    }
    handle = last.value.handle
    sent += piece.length
    progress?.(sent, file.size)
  } while (sent < file.size)
  return last
}

/** The file the core holds, read a piece at a time until it answers an empty one. */
export async function readFile(
  piece: (index: number) => Promise<string>,
  type = 'application/octet-stream',
): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  for (let index = 0; ; index += 1) {
    const data = await piece(index)
    if (data === '') break
    parts.push(fromBase64(data))
  }
  return new Blob(parts, { type })
}

/** Hands [blob] to the browser's downloads as [name]. The blob's address is let go a little later. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
