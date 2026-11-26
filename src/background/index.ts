// The background: the service worker in Chrome and Edge, the event page in
// Firefox and the non-persistent page in Safari (design decision 3). It loads the core, holds
// the vault and is the only part that knows a secret (decision 4).
//
// Every listener is added here, at the top level and at once, as a worker the browser stopped and
// woke for an event must have them before it loads anything; each waits for the core.
import { createBackground, type Background } from './background'
import { detect } from '../shared/capabilities'
import { nativeCall, nativeScreenLocked } from './native'
import {
  directBackend,
  offscreenBackend,
  pageBackend,
  safariBackend,
  type ClipboardBackend,
} from './clipboard'
import { loadBackgroundCore } from './core/load'
import { isForOtherPages, route } from './router'
import { itemFilesKeepAlivePort } from '../shared/item-files'
import { acceptItemFilesPort } from './item-files'
import { acceptSendsPort } from './sends'
import { originOf, type Identity } from './senders'

/**
 * The extension's own origin. Chrome loads the menu frame from a
 * per-session address (`use_dynamic_url`), but the frame's messages still
 * come from this origin.
 */
function identity(): Identity {
  return { id: chrome.runtime.id, origins: [originOf(new URL(chrome.runtime.getURL('')))] }
}

const self = identity()

/** What the browser has of the APIs below: Safari has no `idle`, and none of the right-click menu on iOS (capabilities.ts). */
const can = detect()

/**
 * Safari has no `idle`: it asks the Mac app whether the screen is locked at each beat of the auto-lock. __BROWSER__ keeps the
 * native code out of the other builds.
 */
function screenLocked(): (() => Promise<boolean>) | undefined {
  if (__BROWSER__ !== 'safari') return undefined
  const call = nativeCall(chrome.runtime)
  return call === null || can.idle ? undefined : nativeScreenLocked(call)
}

/**
 * Where the clipboard is. Firefox's event page has a DOM, so it copies itself; Safari's copies through the Mac app, and
 * its page has the editing commands to fall back on; Chrome and Edge copy through the offscreen document. __BROWSER__
 * is fixed at build time, so Firefox's bundle drops the offscreen code, which web-ext lint refuses there.
 */
function clipboardBackend(): ClipboardBackend {
  if (__BROWSER__ === 'firefox') return directBackend()
  if (__BROWSER__ === 'safari') return safariBackend(nativeCall(chrome.runtime), pageBackend())
  return can.offscreen ? offscreenBackend() : pageBackend()
}

const ready: Promise<Background> = loadBackgroundCore().then((core) =>
  createBackground(core, { clipboard: clipboardBackend(), screenLocked: screenLocked() }),
)
// A core that doesn't load answers every message with `failed`, and the console says why
ready.catch((error: unknown) => console.error('Kemlock: the core did not load', error))

/** Runs a listener's work once the background is up, whatever it throws staying inside. */
const whenReady = (work: (background: Background) => Promise<unknown> | void): void => {
  void ready.then(work).catch(() => undefined)
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Not ours: returning false leaves the answer to the page it is for
  if (isForOtherPages(message)) return false
  ready
    .then((background) => route(message, sender, self, background.handlers))
    .then(sendResponse, () => sendResponse({ ok: false, error: 'failed' }))
  return true
})

// Added by sends: the Sends tab holds a port while it holds a Send, so the worker is not stopped under it. Added by item format: the
// files tab holds one while a file is staged, uploading or being read, and the popup while it downloads one; the files a page made are
// let go when its last port closes. Each accepts its own name and closes any other, so one listener
// hands a port to the one it is for.
chrome.runtime.onConnect.addListener((port) =>
  port.name === itemFilesKeepAlivePort
    ? acceptItemFilesPort(
        port,
        self,
        ready.then((background) => background.fileHandles),
      )
    : acceptSendsPort(port, self),
)

chrome.runtime.onInstalled.addListener(() => whenReady((background) => background.setup()))
chrome.runtime.onStartup.addListener(() => whenReady((background) => background.setup()))
chrome.alarms.onAlarm.addListener((alarm) => whenReady((background) => background.onAlarm(alarm)))
// Safari has no idle API: the vault still locks after the idle time and when the computer sleeps, not when the screen locks
if (can.idle)
  chrome.idle.onStateChanged.addListener((state) =>
    whenReady((background) => background.onIdle(state)),
  )
if (can.contextMenus)
  chrome.contextMenus.onClicked.addListener((info, tab) =>
    whenReady((background) => background.onMenuClicked(info, tab)),
  )
chrome.tabs.onUpdated.addListener((tabId, change) =>
  whenReady((background) => background.onTabUpdated(tabId, change)),
)
chrome.tabs.onActivated.addListener(({ tabId }) =>
  whenReady((background) => background.onTabActivated(tabId)),
)
chrome.tabs.onRemoved.addListener((tabId) =>
  whenReady((background) => background.onTabRemoved(tabId)),
)
// A browser without notifications (Safari) has no listener to add, and the extension loads all the same
chrome.notifications?.onClicked.addListener((id) =>
  whenReady((background) => background.onNotificationClicked(id)),
)
// Optional: a browser that doesn't tell of a grant leaves the content script as it is until the next start
chrome.permissions.onAdded?.addListener(() =>
  whenReady((background) => background.onPermissionsChanged()),
)
chrome.permissions.onRemoved?.addListener(() =>
  whenReady((background) => background.onPermissionsChanged()),
)
