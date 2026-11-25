// Who sent a message, by what the browser reports and nothing the message
// says (design decision 4).

/** The extension's own pages, by the path they are built at. */
export type ExtensionPage =
  'popup' | 'setup' | 'account' | 'menu' | 'offscreen' | 'unlock' | 'sends' | 'keys' | 'transfer'

const pages: Readonly<Record<string, ExtensionPage>> = {
  '/src/popup/index.html': 'popup',
  '/src/setup/index.html': 'setup',
  '/src/account/index.html': 'account',
  '/src/menu/index.html': 'menu',
  '/src/offscreen/index.html': 'offscreen',
  // The tab that asks the browser for a passkey, Windows Hello or a security key (docs/plans/add-passkey-unlock.md)
  '/src/unlock/index.html': 'unlock',
  '/src/sends/index.html': 'sends',
  // Keys and PGP, in a tab: the popup's screens for files and long jobs
  '/src/keys/index.html': 'keys',
  '/src/transfer/index.html': 'transfer',
}

/** The extension's id, and the origins its pages send from. */
export interface Identity {
  id: string
  origins: readonly string[]
}

/** A content script, in one frame of one tab. */
export interface ContentSender {
  from: 'content'
  tabId: number
  frameId: number
  /** Chrome's id for the frame's document, to send to that document only. */
  documentId?: string
  url: string
  /** The frame's origin, or null when it has none to match (opaque, unknown). */
  origin: string | null
}

/** One of the extension's pages, and the tab it is in, if any. */
export interface PageSender {
  from: 'page'
  page: ExtensionPage
  tabId?: number
  frameId?: number
}

export type Sender = ContentSender | PageSender

const extensionSchemes = new Set(['chrome-extension:', 'moz-extension:'])

/**
 * An address's origin. The URL standard gives "null" for schemes it
 * doesn't know, the extensions' among them, though Chrome gives its own
 * scheme's, so an extension address's is built from its scheme and host.
 */
export function originOf(url: URL): string {
  return extensionSchemes.has(url.protocol) ? `${url.protocol}//${url.host}` : url.origin
}

/**
 * The frame's origin: the browser's own `sender.origin` where it gives one
 * (Chrome, also for about:blank frames, which inherit theirs), else the
 * address's, for web addresses only.
 */
function frameOrigin(sender: chrome.runtime.MessageSender, url: URL): string | null {
  if (sender.origin !== undefined) return sender.origin === 'null' ? null : sender.origin
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
}

/** The sender as the background trusts it, or null when it is refused. */
export function identifySender(
  sender: chrome.runtime.MessageSender,
  self: Identity,
): Sender | null {
  if (sender.id !== self.id || sender.url === undefined) return null
  let url: URL
  try {
    url = new URL(sender.url)
  } catch {
    return null
  }
  const origin = originOf(url)
  if (self.origins.includes(origin)) {
    if (sender.origin !== undefined && sender.origin !== origin) return null
    const page = pages[url.pathname]
    if (page === undefined) return null
    return { from: 'page', page, tabId: sender.tab?.id, frameId: sender.frameId }
  }
  if (extensionSchemes.has(url.protocol)) return null
  const tabId = sender.tab?.id
  if (tabId === undefined || sender.frameId === undefined) return null
  return {
    from: 'content',
    tabId,
    frameId: sender.frameId,
    documentId: sender.documentId,
    url: sender.url,
    origin: frameOrigin(sender, url),
  }
}

/**
 * The address a frame is matched by (decision 4): the address the browser reports for it, or, for
 * a frame with none to read (about:blank, srcdoc), the web origin it inherits. Never a tab's, never
 * the page's own claim; null when the frame has no web address to match.
 */
export function frameAddress(sender: Pick<ContentSender, 'url' | 'origin'>): string | null {
  try {
    const url = new URL(sender.url)
    if (url.protocol === 'https:' || url.protocol === 'http:') return sender.url
  } catch {
    // Not an address: the origin, if any, is all there is
  }
  if (sender.origin === null) return null
  return sender.origin.startsWith('https://') || sender.origin.startsWith('http://')
    ? `${sender.origin}/`
    : null
}
