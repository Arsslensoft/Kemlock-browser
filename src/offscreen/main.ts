// Chrome and Edge only: the offscreen document that copies to the clipboard and clears it while
// the popup is closed (design decision 14). It answers the background and nobody else: a content
// script's message reaches every extension page, so a message counts only from the extension's own
// background (not a tab).

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

function withTextarea<T>(use: (area: HTMLTextAreaElement) => T): T {
  const area = document.createElement('textarea')
  document.body.append(area)
  try {
    return use(area)
  } finally {
    area.remove()
  }
}

/** The document is never focused, so `navigator.clipboard` refuses: the editing commands work. */
function write(text: string): void {
  // Copying nothing copies nothing: a space is what a cleared clipboard holds here
  const value = text === '' ? ' ' : text
  const copied = withTextarea((area) => {
    area.value = value
    area.select()
    return document.execCommand('copy')
  })
  if (!copied) throw new Error('copy')
}

function read(): string {
  return withTextarea((area) => {
    area.focus()
    if (!document.execCommand('paste')) throw new Error('paste')
    return area.value
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRequest(message)) return false
  const fromBackground =
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    (sender.url === undefined || sender.url.startsWith(chrome.runtime.getURL('')))
  if (!fromBackground) return false
  try {
    if (message.kind === 'write') {
      write(typeof message.value === 'string' ? message.value : '')
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: true, value: read() })
    }
  } catch {
    sendResponse({ ok: false })
  }
  return false
})
