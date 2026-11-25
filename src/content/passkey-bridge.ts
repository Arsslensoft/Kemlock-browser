// The passkey provider's bridge, in the extension's isolated world (docs/plans/add-passkeys.md). It takes a request from the page
// script over a `MessagePort` the script made for it (src/content/passkey-protocol.ts), passes it to the background, and gives the
// background's answer back on the same port. It holds no item and decides nothing:
//
// - A message counts only when it comes from this window itself (`event.source`), never from a parent or another window, and
//   carries a port of its own. What the page script says is still the page's word: the background reads who asks and where from in
//   what the browser reports of this frame, never in the request.
// - A request waits here, by its id, until the background's `passkeyDone` for the frame arrives (a message only the extension can
//   send), or the page script says `cancel`. If the extension is gone, or it fails to answer, the request ends as `fallback`, so
//   the page script calls the browser's own function.
import type { Answer } from '../shared/api'
import type { PasskeyOutcome, PasskeyStart } from '../shared/passkeys'
import { isRecord, passkeyMarker, requestId } from './passkey-protocol'

/** The part of `chrome.runtime` the bridge uses. */
export interface BridgeRuntime {
  id: string | undefined
  sendMessage(message: unknown): Promise<unknown>
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: { id?: string },
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined,
    ): void
  }
}

const fallback: PasskeyOutcome = { outcome: 'fallback' }

type Policy = { allowsFeature?: (name: string) => boolean }

/**
 * Whether this frame may ask for a credential, judged here, in the extension's world, where the page can't change what is read:
 * a frame (of the same site or another) only where its permissions policy allows the feature, as the browser's own function
 * would, and a creation from a frame that can't see its top page only with the person's recent activity in it. A policy that
 * can't be read is a no: the browser's own function then decides.
 */
function allowedHere(win: Window, type: 'create' | 'get'): boolean {
  let framed: boolean
  try {
    framed = win.top !== win.self
  } catch {
    framed = true
  }
  if (!framed) return true
  const doc = win.document as unknown as { permissionsPolicy?: Policy; featurePolicy?: Policy }
  const policy = doc.permissionsPolicy ?? doc.featurePolicy
  if (policy?.allowsFeature?.(`publickey-credentials-${type}`) !== true) return false
  if (type === 'get') return true
  let cross = false
  try {
    void win.top?.location.href
  } catch {
    cross = true
  }
  const activation = (win.navigator as unknown as { userActivation?: { isActive?: boolean } })
    .userActivation
  return !cross || activation?.isActive === true
}

/** The answer to `passkeyBegin` as the start of a request; anything that isn't one is `fallback`. */
function startOf(answer: unknown): PasskeyStart {
  if (!isRecord(answer) || answer.ok !== true || !isRecord(answer.value)) return fallback
  const value = answer.value
  if (value.outcome === 'pending') return { outcome: 'pending' }
  if (value.outcome === 'fallback') return fallback
  if (value.outcome === 'error' || value.outcome === 'credential')
    return value as unknown as PasskeyOutcome
  return fallback
}

export function startPasskeyBridge(win: Window, runtime: BridgeRuntime): void {
  const waiting = new Map<string, MessagePort>()

  const call = async (kind: string, args: object = {}): Promise<unknown> => {
    try {
      return (await runtime.sendMessage({ kind, ...args })) as Answer<unknown>
    } catch {
      return undefined
    }
  }

  const end = (id: string, result: PasskeyOutcome): void => {
    const port = waiting.get(id)
    if (port === undefined) return
    waiting.delete(id)
    // The page script closes its end when it has read the answer: closing ours at once could lose it
    port.postMessage({ op: 'done', result })
  }

  const begin = (data: Record<string, unknown>, port: MessagePort): void => {
    const id = data.id
    if (
      typeof id !== 'string' ||
      !requestId.test(id) ||
      waiting.has(id) ||
      (data.type !== 'create' && data.type !== 'get') ||
      typeof data.conditional !== 'boolean' ||
      !isRecord(data.options)
    ) {
      port.postMessage({ op: 'done', result: fallback })
      return
    }
    if (!allowedHere(win, data.type)) {
      port.postMessage({ op: 'done', result: fallback })
      return
    }
    waiting.set(id, port)
    port.onmessage = (event: MessageEvent) => {
      const message: unknown = event.data
      if (!isRecord(message) || message.op !== 'cancel') return
      if (waiting.delete(id)) void call('passkeyCancel', { id })
      port.close()
    }
    port.postMessage({ op: 'ack' })
    void call('passkeyBegin', {
      id,
      type: data.type,
      conditional: data.conditional,
      options: data.options,
    }).then((answer) => {
      const start = startOf(answer)
      if (start.outcome !== 'pending') end(id, start)
    })
  }

  const status = (port: MessagePort): void => {
    void call('passkeyStatus').then((answer) => {
      const active = isRecord(answer) && isRecord(answer.value) && answer.value.active === true
      port.postMessage({ op: 'status', active })
    })
  }

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win) return
    const data: unknown = event.data
    if (!isRecord(data) || data[passkeyMarker] !== 1) return
    const port = event.ports[0]
    if (port === undefined) return
    if (data.op === 'begin') begin(data, port)
    else if (data.op === 'status') status(port)
  })

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only the extension's own background tells how a request ended
    if (sender.id !== runtime.id || !isRecord(message)) return false
    if (message.kind === 'passkeyDone' && typeof message.id === 'string') {
      const result = message.result
      const known = waiting.has(message.id)
      if (known) {
        const outcome = isRecord(result) ? (result as unknown as PasskeyOutcome) : fallback
        end(message.id, outcome)
      }
      sendResponse({ ok: known })
      return false
    }
    if (message.kind === 'passkeyPing' && typeof message.id === 'string') {
      sendResponse({ ok: waiting.has(message.id) })
      return false
    }
    return false
  })
}
