// Telling the extension's open pages that the vault locked, so a page that holds decrypted text (a revealed key, a decrypted
// message) wipes it. The background broadcasts `lockedMessage` whenever the vault locks or goes: auto-lock, sleep, the lock
// button, removal. A page listens with `useVaultLock`, and asks again when it becomes visible, as a page that was in the
// background may have missed the message (a worker that was stopped, a tab that was frozen).
import { useEffect, useRef } from 'preact/hooks'

/** What the background sends the extension's pages when the vault locks. */
export const lockedMessage = { kemlock: 'locked' } as const

export function isLockedMessage(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const keys = Object.keys(raw)
  return keys.length === 1 && (raw as { kemlock?: unknown }).kemlock === 'locked'
}

/**
 * Whether a message came from the extension itself and not from a web page: a content script's message reaches every extension
 * page too, and its sender is the page's address. (Only a page of the extension, or its background, has the extension's own.)
 */
export function fromExtension(sender: { id?: string; url?: string }): boolean {
  return (
    sender.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''))
  )
}

/** The background's side: tells every open page of the extension that the vault locked. It never fails. */
export async function broadcastLocked(): Promise<void> {
  try {
    await chrome.runtime.sendMessage(lockedMessage)
  } catch {
    // No page is open to hear it
  }
}

/**
 * Calls `onLocked` when the background says the vault locked, and when the page becomes visible with `isOpen` answering
 * that it is not (or failing, which a vault that is locked or gone does).
 */
export function useVaultLock(onLocked: () => void, isOpen?: () => Promise<boolean>): void {
  const latest = useRef({ onLocked, isOpen })
  latest.current = { onLocked, isOpen }
  useEffect(() => {
    const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (isLockedMessage(message) && fromExtension(sender)) latest.current.onLocked()
      // Nothing to answer: the background and the other pages are not waiting on this one
      return false
    }
    const onVisible = () => {
      const check = latest.current.isOpen
      if (document.visibilityState !== 'visible' || check === undefined) return
      check().then(
        (open) => {
          if (!open) latest.current.onLocked()
        },
        () => latest.current.onLocked(),
      )
    }
    chrome.runtime.onMessage.addListener(listener)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      chrome.runtime.onMessage.removeListener(listener)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
