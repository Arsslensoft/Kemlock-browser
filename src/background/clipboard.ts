// Copying, and clearing the clipboard later only if it still holds the copied value (design
// decision 14). Chrome and Edge copy through the offscreen document (a service worker has no DOM);
// Firefox's event page has `navigator.clipboard` itself.

/** Where the clipboard is written and read from. */
export interface ClipboardBackend {
  write(text: string): Promise<void>
  read(): Promise<string>
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

async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface Copied {
  digest: string
  due: number
}

export class ClipboardManager {
  constructor(
    private readonly backend: ClipboardBackend,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Copies, and clears after `seconds` if nothing else was copied meanwhile. Only a digest of the
   * value is kept, in memory-only session storage, to compare with later.
   */
  async copy(value: string, seconds: number): Promise<void> {
    await this.backend.write(value)
    const due = this.now() + seconds * 1000
    await chrome.storage.session.set({
      [recordKey]: { digest: await digest(value), due } satisfies Copied,
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
      if ((await digest(await this.backend.read())) === stored.digest) await this.backend.write('')
    } catch {
      // The clipboard can't be read (no focus, no permission): it is left as it is
    }
  }

  async alarm(name: string): Promise<void> {
    if (name === clipboardAlarm) await this.clear()
  }
}
