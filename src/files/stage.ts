// A file going to the core, a piece at a time: a message is JSON, so bytes go as base64, and the core holds the staged bytes under a
// handle until the item is saved. Nothing here keeps a file: each piece is read from the chosen file, sent, and let go of.
import { toBase64 } from '../sends/files'
import { itemFileChunkBytes } from '../shared/item-files'

/** What the core says of a file being staged: the handle only this tab has, and how many bytes it holds. */
export interface Staged {
  handle: string
  length: number
}

/**
 * Gives [file] to the core, [itemFileChunkBytes] at a time, the first piece starting a new staging, whose handle every other piece names.
 * A piece the core refuses ends it: what went up before is let go of ([release]) and the refusal is thrown. [progress] hears how many
 * bytes have gone.
 */
export async function stageBlob(
  file: Blob,
  stage: (data: string, handle: string | undefined) => Promise<Staged>,
  progress?: (sent: number, total: number) => void,
  release?: (handle: string) => Promise<unknown>,
): Promise<Staged> {
  let sent = 0
  let handle: string | undefined
  let last: Staged
  try {
    do {
      const piece = new Uint8Array(await file.slice(sent, sent + itemFileChunkBytes).arrayBuffer())
      last = await stage(toBase64(piece), handle)
      handle = last.handle
      sent += piece.length
      progress?.(sent, file.size)
    } while (sent < file.size)
  } catch (failure) {
    if (handle !== undefined) await release?.(handle)
    throw failure
  }
  return last
}
