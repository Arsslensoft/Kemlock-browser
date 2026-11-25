// Copying, and clearing the clipboard later only if it still holds the copied value (design
// decision 14). Chrome and Edge copy through the offscreen document (a service worker has no DOM);
// Firefox's event page has `navigator.clipboard` itself; Safari's page copies through the Mac app when it can, and else with its
// own editing commands. Safari's page can't read the clipboard back, so the Mac app clears it only if its change count is the one
// the copy left (docs/plans/add-safari.md).
import { copyText } from '../shared/dom-clipboard'
import { askNative, type NativeCall } from './native'

/** Where the clipboard is written and read from. */
export interface ClipboardBackend {
  /**
   * Writes the text, which will be cleared after `seconds` (an expiry the system may keep too; none when it is 0 or less). A
   * backend that can tell later whether the clipboard is still as this left it answers a token, for `clearIfUnchanged`.
   */
  write(text: string, seconds?: number): Promise<void | number>
  /** What the clipboard holds. A backend that can't read it rejects, and has `clearIfUnchanged` instead. */
  read(): Promise<string>
  /** Clears the clipboard if nothing has changed it since the write that answered `token`. */
  clearIfUnchanged?(token: number): Promise<void>
}

export const clipboardAlarm = 'kemlock-clipboard'
const recordKey = 'kemlock_clipboard'
const offscreenPath = 'src/offscreen/index.html'

/** Chrome and Edge: the offscreen document (src/offscreen), opened when it is first needed. */
export function offscreenBackend(): ClipboardBackend {
  let opening: Promise<void> | undefined
  const ensure = () => {
    opening ??= (async () => {
      const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      if (open.length > 0) return
      await chrome.offscreen.createDocument({
        url: offscreenPath,
        reasons: ['CLIPBOARD'],
        justification: chrome.i18n.getMessage('bgClipboardJustification'),
      })
    })().finally(() => {
      opening = undefined
    })
    return opening
  }
  const ask = async (message: object): Promise<{ ok: boolean; value?: string }> => {
    await ensure()
    const answer = (await chrome.runtime.sendMessage({ target: 'offscreen', ...message })) as
      { ok: boolean; value?: string } | undefined
    if (answer === undefined || !answer.ok) throw new Error('clipboard')
    return answer
  }
  return {
    write: async (text) => void (await ask({ kind: 'write', value: text })),
    read: async () => (await ask({ kind: 'read' })).value ?? '',
  }
}

/** Firefox: the event page's own clipboard (clipboardRead and clipboardWrite). */
export function directBackend(): ClipboardBackend {
  return {
    write: (text) => navigator.clipboard.writeText(text),
    read: () => navigator.clipboard.readText(),
  }
}

/** What a page has to write the clipboard with, each a try: its own API, then the editing commands. */
export interface PageClipboardParts {
  writeText?: (text: string) => Promise<void>
  copy: (text: string) => void
}

/** The page's own clipboard: `navigator.clipboard` where it allows a write, else `execCommand('copy')`. Reads nothing. */
export function pageBackend(
  parts: PageClipboardParts = {
    writeText: (text) => navigator.clipboard.writeText(text),
    copy: copyText,
  },
): ClipboardBackend {
  return {
    async write(text) {
      try {
        if (parts.writeText !== undefined) return await parts.writeText(text)
      } catch {
        // No click behind it: the editing commands next
      }
      parts.copy(text)
    },
    read: () => Promise.reject(new Error('clipboard unreadable')),
  }
}

/**
 * Safari: the Mac app's extension handler writes the system clipboard, with no click and with the entry marked as concealed for
 * clipboard managers, and answers the pasteboard's change count. It clears the clipboard later only if that count is still the
 * one the copy left, so something copied since is never erased, and nothing is ever read back. `page` is the fallback for a
 * build whose handler is not ours: it writes, and, with no count, a copy it made is left to the person.
 */
export function safariBackend(native: NativeCall | null, page: ClipboardBackend): ClipboardBackend {
  return {
    async write(text, seconds) {
      if (native !== null) {
        try {
          const args = seconds === undefined ? { value: text } : { value: text, seconds }
          return (await askNative(native, 'write', args)).count
        } catch {
          // Not our handler, or it failed: the page tries
        }
      }
      return page.write(text)
    },
    read: () => Promise.reject(new Error('clipboard unreadable')),
    async clearIfUnchanged(token) {
      if (native === null) return
      await askNative(native, 'clear', { count: token })
    },
  }
}

async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface Copied {
  digest: string
  due: number
  /** What the backend answered the write: a later clear is of the clipboard only if it is still as it left it. */
  token?: number
}

export class ClipboardManager {
  constructor(
    private readonly backend: ClipboardBackend,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Copies, and clears after `seconds` if nothing else was copied meanwhile. Only a digest of the
   * value (and the write's token, where the backend gives one) is kept, in memory-only session storage, to compare with later.
   */
  async copy(value: string, seconds: number): Promise<void> {
    const token = await this.backend.write(value, seconds)
    const due = this.now() + seconds * 1000
    await chrome.storage.session.set({
      [recordKey]: {
        digest: await digest(value),
        due,
        ...(typeof token === 'number' ? { token } : {}),
      } satisfies Copied,
    })
    // A timer for the short delays, since an alarm is never sooner than half a minute; the alarm
    // is for when the worker has been stopped meanwhile.
    setTimeout(() => void this.clear(), seconds * 1000)
    await chrome.alarms.create(clipboardAlarm, { when: due })
  }

  /** Empties the clipboard if it still holds what was copied last, and it is time. */
  async clear(): Promise<void> {
    const stored = (await chrome.storage.session.get(recordKey))[recordKey] as Copied | undefined
    if (stored === undefined || this.now() < stored.due - 500) return
    await chrome.storage.session.remove(recordKey)
    await chrome.alarms.clear(clipboardAlarm)
    try {
      // A backend that can't read (Safari's) clears by the token it gave: the clipboard's own count of changes
      if (stored.token !== undefined && this.backend.clearIfUnchanged !== undefined)
        await this.backend.clearIfUnchanged(stored.token)
      else if ((await digest(await this.backend.read())) === stored.digest)
        await this.backend.write('')
    } catch {
      // The clipboard can't be read or cleared (no focus, no permission): it is left as it is
    }
  }

  async alarm(name: string): Promise<void> {
    if (name === clipboardAlarm) await this.clear()
  }
}
