// A stand-in for the part of `chrome.runtime` that `useVaultLock` uses (its extension id, its addresses and its message listeners), for
// the tests of the pages that wire it, and a way to send those pages the message the background sends when the vault locks. Nothing here
// is imported by the extension itself.
import { lockedMessage } from './vault-lock'

type Sender = { id?: string; url?: string }
type Listener = (message: unknown, sender: Sender) => unknown

export interface LockChannel {
  /** What to put at `chrome.runtime`. */
  runtime: {
    id: string
    getURL: (path: string) => string
    onMessage: {
      addListener: (listener: Listener) => void
      removeListener: (listener: Listener) => void
    }
  }
  /** Tells every page listening that the vault locked, as the background does (`broadcastLocked`). */
  lock: () => void
  /** Sends every listener a message from [sender], to see that a page ignores what is not the lock message of the extension. */
  send: (message: unknown, sender: Sender) => void
  /** How many pages are listening now. */
  listening: () => number
}

export function lockChannel(id = 'kemlock'): LockChannel {
  const base = `chrome-extension://${id}/`
  let listeners: Listener[] = []
  const send = (message: unknown, sender: Sender) => {
    for (const listener of [...listeners]) listener(message, sender)
  }
  return {
    runtime: {
      id,
      getURL: (path: string) => `${base}${path}`,
      onMessage: {
        addListener: (listener) => {
          listeners.push(listener)
        },
        removeListener: (listener) => {
          listeners = listeners.filter((other) => other !== listener)
        },
      },
    },
    lock: () => send(lockedMessage, { id, url: `${base}background.js` }),
    send,
    listening: () => listeners.length,
  }
}
