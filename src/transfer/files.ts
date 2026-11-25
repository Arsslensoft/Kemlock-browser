// Files in and out of the transfer tab: a chosen file as the base64 the background takes, and an export saved through a Blob URL.
// The export's text lives in this page and nowhere else; it is dropped as soon as the download starts.

/**
 * The largest file the tab reads: 40 MiB, which is 54 MiB of base64, under the 64 MiB a message may be in Chrome. The core and the
 * parser refuse a larger one too.
 */
export const maxFileBytes = 40 * 1024 * 1024

/**
 * The most images read for QR codes at once, the most bytes of each, and of all together (as data URLs they are a third larger, and
 * go in one message).
 */
export const maxImages = 40
export const maxImageBytes = 16 * 1024 * 1024
export const maxImagesBytes = 32 * 1024 * 1024

/** [bytes] as base64 text, a piece at a time (one call of `String.fromCharCode` can't take a large file's bytes). */
export function toBase64(bytes: Uint8Array): string {
  let text = ''
  const piece = 0x8000
  for (let at = 0; at < bytes.length; at += piece)
    text += String.fromCharCode(...bytes.subarray(at, at + piece))
  return btoa(text)
}

/** A file's bytes as base64. */
export async function readBase64(file: Blob): Promise<string> {
  return toBase64(new Uint8Array(await file.arrayBuffer()))
}

/** A picture as a data URL, which the core decodes to find the QR code in it. */
export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable'))
    reader.onerror = () => reject(new Error('unreadable'))
    reader.readAsDataURL(file)
  })
}

/** What saving a file left behind: the address of its Blob, until [revoke] forgets it. */
export interface Saved {
  /** Saves it again (the download may have been blocked). */
  again(): void
  /** Forgets the file: its address stops working. */
  revoke(): void
}

/**
 * Saves [text] as a file named [name], through a Blob URL and a link, which the browser's download takes. The address is forgotten
 * after [keepMs] (a minute), or by [Saved.revoke].
 */
export function download(name: string, mime: string, text: string, keepMs = 60_000): Saved {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  let live = true
  const click = () => {
    if (!live) return
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }
  const revoke = () => {
    if (!live) return
    live = false
    URL.revokeObjectURL(url)
    clearTimeout(timer)
  }
  const timer = setTimeout(revoke, keepMs)
  click()
  return { again: click, revoke }
}

/**
 * The path of a QR code's dark modules as SVG path data: a rectangle a row-run wide for each run of dark modules, in the units
 * of one module, with a quiet zone of [quiet] modules around the code (a reader needs it, and so does a person's eye).
 */
export function modulesPath(size: number, modules: string, quiet = 4): string {
  const parts: string[] = []
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (modules[y * size + x] !== '1') {
        x++
        continue
      }
      const start = x
      while (x < size && modules[y * size + x] === '1') x++
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`)
    }
  }
  return parts.join('')
}
