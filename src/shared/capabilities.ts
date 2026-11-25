// What the browser has of the extension APIs the extension leans on (docs/plans/add-safari.md). Chrome, Edge and
// Firefox have all but a few; Safari lacks several, and a missing API is `undefined`, so calling it at the top of the
// background throws and the extension never starts. The background asks here, once, and goes without what is not there.
//
// This reads the browser, never its name: a Safari that gains `idle` gets the lock on a locked screen with no change here,
// and `__BROWSER__` is used only where a build must leave a piece of code out (src/background/index.ts).

/** What the background goes without when the browser has none of it. */
export interface Capabilities {
  /** `chrome.offscreen`: a document with a clipboard, for a service worker that has no DOM (Chrome and Edge). */
  offscreen: boolean
  /** `chrome.idle`: the system's idle state, whose `locked` is a locked screen. Safari has none. */
  idle: boolean
  /** `chrome.identity.launchWebAuthFlow`: the browser's sign-in window, which single sign-on and passkeys ride on. Safari has none. */
  identity: boolean
  /** `chrome.contextMenus`: the right-click menu. Safari on iOS has none. */
  contextMenus: boolean
  /** `chrome.scripting.registerContentScripts`: the content script for all frames, kept by the browser. */
  registerContentScripts: boolean
  /** `chrome.storage.session.setAccessLevel`: keeps content scripts out of the session storage. */
  sessionAccessLevel: boolean
}

/** Whether `path` leads, from `root`, to a function; an object or a missing link on the way is a no. */
function hasFunction(root: unknown, ...path: string[]): boolean {
  let at: unknown = root
  for (const name of path) {
    if ((typeof at !== 'object' && typeof at !== 'function') || at === null) return false
    at = (at as Record<string, unknown>)[name]
  }
  return typeof at === 'function'
}

/** What `api` (the `chrome` object; the global one by default) has. */
export function detect(api: unknown = (globalThis as { chrome?: unknown }).chrome): Capabilities {
  return {
    offscreen:
      hasFunction(api, 'offscreen', 'createDocument') && hasFunction(api, 'runtime', 'getContexts'),
    idle: hasFunction(api, 'idle', 'onStateChanged', 'addListener'),
    identity:
      hasFunction(api, 'identity', 'launchWebAuthFlow') &&
      hasFunction(api, 'identity', 'getRedirectURL'),
    contextMenus:
      hasFunction(api, 'contextMenus', 'create') &&
      hasFunction(api, 'contextMenus', 'onClicked', 'addListener'),
    registerContentScripts:
      hasFunction(api, 'scripting', 'registerContentScripts') &&
      hasFunction(api, 'scripting', 'getRegisteredContentScripts') &&
      hasFunction(api, 'scripting', 'unregisterContentScripts'),
    sessionAccessLevel: hasFunction(api, 'storage', 'session', 'setAccessLevel'),
  }
}

/**
 * Keeps the session storage to the extension's own pages (design decision 5), where the browser can say so, and answers whether
 * it is so. A browser that can't say (Safari has no `setAccessLevel`) may let a content script read the session storage, so
 * nothing that opens the vault may be kept there: the answer is false, and the vault locks when the background unloads. The
 * Safari checklist (step 10) checks Safari's default; if it is the extension's pages only, this can answer true there.
 */
export async function limitSessionToTrusted(): Promise<boolean> {
  if (!detect().sessionAccessLevel) return false
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    return true
  } catch {
    // Refused: as if the browser could not say
    return false
  }
}
