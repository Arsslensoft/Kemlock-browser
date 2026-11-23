// The background: the service worker in Chrome and Edge, the event page in
// Firefox (design decision 3). It loads the core, holds the vault and is
// the only part that knows a secret (decision 4).
//
// Every listener is added here, at the top level and at once, as a worker the browser stopped and
// woke for an event must have them before it loads anything; each waits for the core.
import { createBackground, type Background } from './background'
import { directBackend } from './clipboard'
import { loadBackgroundCore } from './core/load'
import { isForOtherPages, route } from './router'
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

const ready: Promise<Background> = loadBackgroundCore().then((core) =>
  // Firefox's event page has a clipboard of its own; Chrome and Edge copy through the offscreen document
  createBackground(core, __BROWSER__ === 'firefox' ? { clipboard: directBackend() } : {}),
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

chrome.runtime.onInstalled.addListener(() => whenReady((background) => background.setup()))
chrome.runtime.onStartup.addListener(() => whenReady((background) => background.setup()))
chrome.alarms.onAlarm.addListener((alarm) => whenReady((background) => background.onAlarm(alarm)))
chrome.idle.onStateChanged.addListener((state) =>
  whenReady((background) => background.onIdle(state)),
)
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
chrome.permissions.onAdded.addListener(() =>
  whenReady((background) => background.onPermissionsChanged()),
)
chrome.permissions.onRemoved.addListener(() =>
  whenReady((background) => background.onPermissionsChanged()),
)
