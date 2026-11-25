// The menu frame's line to the content script that opened it (design decision 9). The content script
// hands over a MessagePort once, with the secret in this page's address; from then on the page's own
// window can't hear or speak to the menu. The port carries the content script's word on whether the
// frame is in plain view, and the menu's questions before it acts on a click.

import { Gate, canTrackVisibility, trackVisibility, type PageState, type Verdict } from './gate'

export interface Init {
  mode: 'menu' | 'save' | 'passkey'
  tabId: number
  frameId: number
  fieldId: string
  siteRules?: string
  /** The passkey card's secret: what it asks and answers under. */
  token?: string
}

/** What the screens use: ask leave to act, say how tall they are, close. */
export interface Channel {
  /**
   * Leave to act on a click at [x], [y] of this frame (null for a key): the gate's verdict, then the
   * content script's check at that point.
   */
  permit(x: number | null, y: number | null): Promise<Verdict>
  size(height: number): void
  close(refocus: boolean): void
  /** The half second of plain view starts again, as when the menu moves (a new screen asking for a click of its own). */
  restart?(): void
}

const asksFor = 1500

export interface Connected {
  channel: Channel
  init: Init
}

/** The mode and secret in the address: `#menu.<secret>`, or `#save.<secret>`. */
export function parseHash(
  hash: string,
): { mode: 'menu' | 'save' | 'passkey'; nonce: string } | null {
  const match = /^#(menu|save|passkey)\.([0-9a-f]{32})$/.exec(hash)
  return match === null ? null : { mode: match[1] as 'menu' | 'save' | 'passkey', nonce: match[2] }
}

/**
 * Waits for the content script's port. Nothing else may talk to the menu: a message counts only with
 * the secret from the address and a port to go with it.
 */
export function connect(
  nonce: string,
  win: Window = window,
  now: () => number = () => Date.now(),
): Promise<Connected> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { kemlock?: unknown; nonce?: unknown } | null
      if (data === null || typeof data !== 'object') return
      if (data.kemlock !== 'port' || data.nonce !== nonce || event.ports.length === 0) return
      win.removeEventListener('message', onMessage)
      resolve(open(event.ports[0], win, now))
    }
    win.addEventListener('message', onMessage)
  })
}

function open(port: MessagePort, win: Window, now: () => number): Promise<Connected> {
  const gate = new Gate({ tracked: canTrackVisibility() })
  if (canTrackVisibility()) trackVisibility(win.document.documentElement, gate, now)
  let seq = 0
  const waiting = new Map<number, (answer: { ok: boolean; why?: string }) => void>()
  return new Promise((resolve) => {
    port.onmessage = (event: MessageEvent) => {
      const data = event.data as { kind?: string } & Record<string, unknown>
      if (data === null || typeof data !== 'object') return
      if (data.kind === 'init') {
        const channel: Channel = {
          async permit(x, y) {
            const first = gate.verdict(now())
            if (!first.ok) return first
            const id = ++seq
            const answer = await new Promise<{ ok: boolean; why?: string }>((done) => {
              waiting.set(id, done)
              setTimeout(() => {
                if (waiting.delete(id)) done({ ok: false, why: 'silent' })
              }, asksFor)
              port.postMessage({ kind: 'check', id, x, y })
            })
            if (!answer.ok)
              return {
                ok: false,
                why:
                  answer.why === 'covered'
                    ? 'covered'
                    : answer.why === 'faded'
                      ? 'faded'
                      : 'hidden',
              }
            return gate.verdict(now())
          },
          size: (height) => port.postMessage({ kind: 'size', height }),
          close: (refocus) => port.postMessage({ kind: 'close', refocus }),
          restart: () => gate.restart(now()),
        }
        resolve({
          channel,
          init: {
            mode: data.mode === 'save' || data.mode === 'passkey' ? data.mode : 'menu',
            tabId: Number(data.tabId),
            frameId: Number(data.frameId),
            fieldId: String(data.fieldId ?? ''),
            ...(typeof data.siteRules === 'string' ? { siteRules: data.siteRules } : {}),
            ...(typeof data.token === 'string' ? { token: data.token } : {}),
          },
        })
      } else if (data.kind === 'state') {
        gate.pageSays(data as unknown as PageState, now())
      } else if (data.kind === 'checked') {
        const done = waiting.get(Number(data.id))
        if (done !== undefined) {
          waiting.delete(Number(data.id))
          done({ ok: data.ok === true, why: typeof data.why === 'string' ? data.why : undefined })
        }
      }
    }
  })
}
