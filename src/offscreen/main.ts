// Chrome and Edge only: the offscreen document that copies to the clipboard and clears it while
// the popup is closed (design decision 14). It answers the background and nobody else: a content
// script's message reaches every extension page, so a message counts only from the extension's own
// background (not a tab).

import { copyText, pasteText } from '../shared/dom-clipboard'

interface Request {
  target: 'offscreen'
  kind: 'write' | 'read'
  value?: string
}

const isRequest = (message: unknown): message is Request =>
  typeof message === 'object' &&
  message !== null &&
  (message as Request).target === 'offscreen' &&
  ((message as Request).kind === 'write' || (message as Request).kind === 'read')

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRequest(message)) return false
  const fromBackground =
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    (sender.url === undefined || sender.url.startsWith(chrome.runtime.getURL('')))
  if (!fromBackground) return false
  try {
    if (message.kind === 'write') {
      copyText(typeof message.value === 'string' ? message.value : '')
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: true, value: pasteText() })
    }
  } catch {
    sendResponse({ ok: false })
  }
  return false
})
