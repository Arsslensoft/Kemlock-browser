// The menu's frame and the save prompt's (design decisions 4 and 9): an iframe to the extension's own
// page, inside a closed shadow root on the top layer, so the page can neither read it nor reach into
// it. The frame and this script talk over a MessageChannel handed across once, with a secret in the
// frame's address that the page can't see, and never in the page's own window messages.
//
// While the frame is open this script tells it, many times a second, whether it is in plain view
// (src/content/gate.ts), and answers its `check` before it acts on a click or a key.

import type { Geometry } from './dom'
import { plainAt, plainView, signatureOf, type NotPlain } from './gate'
import { placeMenu, placePrompt, type Box } from './place'

export type FrameMode = 'menu' | 'save'

/** What this script sends the frame over the port. */
export type ToFrame =
  | {
      kind: 'init'
      mode: FrameMode
      tabId: number
      frameId: number
      fieldId: string
      siteRules?: string
    }
  | { kind: 'state'; plain: boolean; why?: NotPlain; signature: string }
  | { kind: 'checked'; id: number; ok: boolean; why?: NotPlain }

/** What the frame sends this script. */
export type FromFrame =
  | { kind: 'check'; id: number; x: number | null; y: number | null }
  | { kind: 'size'; height: number }
  | { kind: 'close'; refocus?: boolean }

export interface FrameEnv {
  doc: Document
  geometry: Geometry
  /** The menu page's address (`chrome.runtime.getURL`), without its hash. */
  pageUrl: string
  /** Where hosts are listed so the page scan and the fill's coverage test pass over them. */
  ownHosts: Set<Element>
}

export interface FrameOptions {
  mode: FrameMode
  tabId: number
  frameId: number
  fieldId: string
  siteRules?: string
  /** The field's box (for the menu); the prompt ignores it. */
  anchor: () => Box | null
  /** The frame is gone: closed by the person, by Escape, or because its field went away. */
  onClose: (refocus: boolean) => void
}

const width = { menu: 320, save: 340 }
const firstHeight = { menu: 160, save: 170 }
const tallest = 420
const beatMs = 150

/** The styles the host keeps whatever the page's say: the important ones of a shadow tree win. */
const hostStyle = `
:host {
  position: fixed !important;
  left: var(--kemlock-left, 0px) !important;
  top: var(--kemlock-top, 0px) !important;
  right: auto !important;
  bottom: auto !important;
  width: var(--kemlock-width, 320px) !important;
  height: var(--kemlock-height, 160px) !important;
  z-index: 2147483647 !important;
  display: block !important;
  opacity: 1 !important;
  visibility: visible !important;
  filter: none !important;
  clip-path: none !important;
  mask: none !important;
  transform: none !important;
  mix-blend-mode: normal !important;
  pointer-events: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: hidden !important;
  background: transparent !important;
  color-scheme: light dark !important;
}
iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
`

function secret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** An address's origin the way `postMessage` wants it, also for extension schemes. */
export function originOfUrl(url: string): string {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

export class MenuFrame {
  readonly host: HTMLElement
  private readonly iframe: HTMLIFrameElement
  private port: MessagePort | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private height: number
  private closed = false

  constructor(
    private readonly env: FrameEnv,
    private readonly options: FrameOptions,
  ) {
    const { doc } = env
    const nonce = secret()
    this.height = firstHeight[options.mode]
    this.host = doc.createElement('div')
    if (typeof this.host.showPopover === 'function') this.host.setAttribute('popover', 'manual')
    const root = this.host.attachShadow({ mode: 'closed' })
    const style = doc.createElement('style')
    style.textContent = hostStyle
    this.iframe = doc.createElement('iframe')
    this.iframe.setAttribute('title', 'Kemlock')
    this.iframe.setAttribute('allow', '')
    this.iframe.addEventListener('load', () => this.handshake(nonce), { once: true })
    this.iframe.src = `${env.pageUrl}#${options.mode}.${nonce}`
    root.append(style, this.iframe)
    env.ownHosts.add(this.host)
    this.reposition()
    if (this.closed) return
    ;(doc.body ?? doc.documentElement).append(this.host)
    if (typeof this.host.showPopover === 'function') {
      try {
        this.host.showPopover()
      } catch {
        // Not on the top layer: the z-index still puts it in front
      }
    }
    this.timer = setInterval(() => this.beat(), beatMs)
  }

  /** Gives the frame keyboard focus, for a menu opened by the down arrow. */
  focus(): void {
    this.iframe.focus()
  }

  private handshake(nonce: string): void {
    const target = this.iframe.contentWindow
    if (target === null || this.closed) return
    const channel = new MessageChannel()
    this.port = channel.port1
    channel.port1.onmessage = (event: MessageEvent) => this.heard(event.data)
    target.postMessage({ kemlock: 'port', nonce }, originOfUrl(this.env.pageUrl), [channel.port2])
    const { mode, tabId, frameId, fieldId, siteRules } = this.options
    this.send({
      kind: 'init',
      mode,
      tabId,
      frameId,
      fieldId,
      ...(siteRules !== undefined ? { siteRules } : {}),
    })
    this.beat()
  }

  private send(message: ToFrame): void {
    this.port?.postMessage(message)
  }

  private heard(data: unknown): void {
    if (typeof data !== 'object' || data === null) return
    const message = data as Partial<FromFrame> & { kind?: unknown }
    switch (message.kind) {
      case 'check': {
        const { id, x, y } = message as Extract<FromFrame, { kind: 'check' }>
        if (typeof id !== 'number') return
        this.send({ kind: 'checked', id, ...this.verdictAt(x, y) })
        return
      }
      case 'size': {
        const { height } = message as Extract<FromFrame, { kind: 'size' }>
        if (typeof height !== 'number' || !Number.isFinite(height)) return
        this.height = Math.max(80, Math.min(tallest, Math.ceil(height)))
        this.reposition()
        return
      }
      case 'close':
        this.close((message as Extract<FromFrame, { kind: 'close' }>).refocus === true)
        return
    }
  }

  /** Whether a press at [x], [y] of the frame (or on a key, its middle) is on a menu in plain view. */
  private verdictAt(x: number | null, y: number | null): { ok: boolean; why?: NotPlain } {
    const rect = this.env.geometry.rect(this.host)
    const px = typeof x === 'number' ? rect.left + x : rect.left + rect.width / 2
    const py = typeof y === 'number' ? rect.top + y : rect.top + rect.height / 2
    const plain = plainAt(this.host, px, py, this.env.geometry)
    return plain.ok ? { ok: true } : { ok: false, why: plain.why }
  }

  private beat(): void {
    if (this.closed) return
    if (!this.host.isConnected) {
      // The page took it away: it comes back or the menu ends, never half there
      this.close(false)
      return
    }
    this.reposition()
    const plain = plainView(this.host, this.env.geometry)
    const signature = signatureOf(this.env.geometry.rect(this.host))
    this.send(
      plain.ok
        ? { kind: 'state', plain: true, signature }
        : { kind: 'state', plain: false, why: plain.why, signature },
    )
  }

  /** Puts the host where its field is now: under it, or at the top right for the prompt. */
  reposition(): void {
    const viewport = this.env.geometry.viewport()
    const size = { width: width[this.options.mode], height: this.height }
    let box: Box
    if (this.options.mode === 'save') box = placePrompt(size, viewport)
    else {
      const anchor = this.options.anchor()
      if (anchor === null) {
        this.close(false)
        return
      }
      box = placeMenu(anchor, size, viewport)
    }
    const style = this.host.style
    style.setProperty('--kemlock-left', `${box.left}px`)
    style.setProperty('--kemlock-top', `${box.top}px`)
    style.setProperty('--kemlock-width', `${box.width}px`)
    style.setProperty('--kemlock-height', `${box.height}px`)
  }

  get isOpen(): boolean {
    return !this.closed
  }

  close(refocus: boolean): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    this.port?.close()
    this.port = null
    this.env.ownHosts.delete(this.host)
    this.host.remove()
    this.options.onClose(refocus)
  }
}
