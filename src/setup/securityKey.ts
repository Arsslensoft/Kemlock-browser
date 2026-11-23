// A security key on the server's own address (design decision 13). A browser decides a WebAuthn
// request's origin by the page it runs in, so setup opens the server's connector page in a tab,
// injects a small relay into it, takes the answer only from that tab on that origin, closes the
// tab and sends the answer as the second step. Setup holds the step, not the background: Chrome
// restarts a service worker that waits for the key.
import type { SecurityKeyChallenge } from '../shared/api'
import { originOf } from './address'

/** What the connector page answered: the assertion as the server wants it, and "Don't ask again". */
export interface KeyResult {
  assertion: string
  remember: boolean
}

/** The kind of the relay's message to this page. */
export const relayKind = 'securityKeyResult'

const maxAssertion = 64 * 1024

/** The connector page's address: the server's own, with the challenge and this page as the parent. */
export function connectorUrl(
  challenge: SecurityKeyChallenge,
  parent: string,
  locale: string,
): string {
  const params = new URLSearchParams({ data: challenge.data, parent, v: '1', locale })
  return `${challenge.domain.replace(/\/+$/, '')}${challenge.path}?${params.toString()}`
}

/**
 * When the server's own address isn't the one typed, the address to use (the key would be asked
 * on a page of another origin, which the server refuses), else null.
 */
export function otherAddress(typed: string, challenge: SecurityKeyChallenge): string | null {
  const own = originOf(challenge.domain)
  if (own === null) return null
  return own === originOf(typed) ? null : challenge.domain.replace(/\/+$/, '')
}

/** The answer in a relay's message, only when it came from the tab asked, on the server's origin. */
export function acceptRelay(
  message: unknown,
  sender: { tab?: { id?: number }; url?: string },
  tabId: number,
  origin: string,
): KeyResult | null {
  if (typeof message !== 'object' || message === null) return null
  const { kind, data, remember } = message as Record<string, unknown>
  if (kind !== relayKind) return null
  if (sender.tab?.id !== tabId || sender.url === undefined || originOf(sender.url) !== origin)
    return null
  if (typeof data !== 'string' || data.length === 0 || data.length > maxAssertion) return null
  return { assertion: data, remember: remember === true }
}

/**
 * Runs inside the connector's tab (scripting.executeScript, so it can't use anything of this
 * file). The page posts `{command: 'webAuthnResult', data, remember}` to its own window.
 */
function relay(): void {
  const marked = window as unknown as { __kemlockRelay?: boolean }
  if (marked.__kemlockRelay === true) return
  marked.__kemlockRelay = true
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const body = event.data as { command?: unknown; data?: unknown; remember?: unknown } | null
    if (body === null || typeof body !== 'object' || body.command !== 'webAuthnResult') return
    chrome.runtime
      .sendMessage({ kind: 'securityKeyResult', data: body.data, remember: body.remember === true })
      .catch(() => undefined)
  })
}

/**
 * Opens the connector in a tab and waits for the key's answer. Rejects when the tab is closed
 * first, or `signal` aborts (which closes the tab).
 */
export async function askSecurityKey(
  challenge: SecurityKeyChallenge,
  signal?: AbortSignal,
): Promise<KeyResult> {
  const origin = originOf(challenge.domain)
  if (origin === null) throw new Error('address')
  const url = connectorUrl(
    challenge,
    chrome.runtime.getURL('src/setup/index.html'),
    chrome.i18n.getUILanguage(),
  )
  const tab = await chrome.tabs.create({ url })
  const tabId = tab.id
  if (tabId === undefined) throw new Error('tab')

  return new Promise<KeyResult>((resolve, reject) => {
    const inject = (address: string | undefined) => {
      if (address === undefined || originOf(address) !== origin) return
      chrome.scripting.executeScript({ target: { tabId }, func: relay }).catch(() => undefined)
    }
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      const got = acceptRelay(message, sender, tabId, origin)
      if (got === null) return
      stop()
      chrome.tabs.remove(tabId).catch(() => undefined)
      resolve(got)
    }
    const onUpdated = (
      id: number,
      info: { status?: string; url?: string },
      changed: chrome.tabs.Tab,
    ) => {
      if (id === tabId && (info.status !== undefined || info.url !== undefined)) inject(changed.url)
    }
    const onRemoved = (id: number) => {
      if (id !== tabId) return
      stop()
      reject(new Error('closed'))
    }
    const onAbort = () => {
      stop()
      chrome.tabs.remove(tabId).catch(() => undefined)
      reject(new Error('closed'))
    }
    const stop = () => {
      chrome.runtime.onMessage.removeListener(onMessage)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
      signal?.removeEventListener('abort', onAbort)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort)
    inject(tab.url ?? tab.pendingUrl)
  })
}
