// The background: the service worker in Chrome and Edge, the event page in
// Firefox (design decision 3). It loads the core, holds the vault and is
// the only part that knows a secret (decision 4).
import { route, type Handlers } from './router'
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

const handlers: Handlers = { content: {}, page: {} }

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void route(message, sender, self, handlers).then(sendResponse)
  return true
})
