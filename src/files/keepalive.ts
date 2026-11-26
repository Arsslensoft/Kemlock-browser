// Keeps the background alive while a file is going up: the service worker stops after about 30 seconds with nothing to do (Chrome), and
// the staged bytes the core holds for this tab go with it. A port held open and pinged now and then is a message each time, which starts
// the worker's idle time over. The background answers a port from this page only.
import { useEffect } from 'preact/hooks'
import { itemFilesKeepAlivePort, itemFilesPingMs } from '../shared/item-files'

/** Holds a port to the background and pings it; the returned function lets go. */
export function holdBackground(): () => void {
  let port: chrome.runtime.Port | undefined
  try {
    port = chrome.runtime.connect({ name: itemFilesKeepAlivePort })
  } catch {
    // No background to hold: the calls will say so
    return () => undefined
  }
  const held = port
  const timer = setInterval(() => {
    try {
      held.postMessage({ kind: 'ping' })
    } catch {
      // The port closed (the worker stopped): the next call says what was lost
    }
  }, itemFilesPingMs)
  return () => {
    clearInterval(timer)
    try {
      held.disconnect()
    } catch {
      // Closed already
    }
  }
}

/** Holds the background while [active]. */
export function useBackgroundHeld(active: boolean): void {
  useEffect(() => (active ? holdBackground() : undefined), [active])
}
