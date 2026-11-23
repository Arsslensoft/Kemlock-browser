// The content script's whole job in one frame (design decisions 3, 4, 7, 9, 10): find fields and say
// so, place the button in each, open the menu frame, fill the one field the background names, and
// watch forms being sent. It holds no item. Everything it needs from the page and the browser comes
// in through `Deps`, so the tests run it over a jsdom page with a stand-in background.

import type { ContentApi } from '../shared/api'
import type { FieldKind } from '../shared/messages'
import { Badge } from './badge'
import { readSent, sameSent, sendsForm, formOf, type Sent } from './capture'
import { fieldNames, isVisible, pageGeometry, type Geometry } from './dom'
import { fillEntry, longestValue } from './fill'
import { MenuFrame, type FrameMode } from './frame'
import { plainAt } from './gate'
import { boundsOf, placeBadge, type Box } from './place'
import { siteRulesOf } from './rules'
import { scanFrame, signatureOfReports, type Registered, type Registry } from './scan'

/** What the background sends a frame of its tab (ToContent in src/shared/messages.ts). */
export type Incoming =
  | { kind: 'fill'; fieldId: string; value: string; origin?: string }
  | { kind: 'openMenu'; fieldId: string }
  | { kind: 'closeMenus' }
  | { kind: 'contextTarget' }
  | { kind: 'savePrompt' }

/** What a frame answers `contextTarget` with: the field the right-click was on. */
export interface ContextTarget {
  fieldId: string
  kind: FieldKind
  boxes?: number
  rules?: string
}

export type Call = <K extends keyof ContentApi>(
  kind: K,
  args: Parameters<ContentApi[K]>[0],
) => Promise<Awaited<ReturnType<ContentApi[K]>>>

export interface Deps {
  doc: Document
  call: Call
  /** `chrome.runtime.getURL('src/menu/index.html')`. */
  pageUrl: string
  /** The button's accessible name. */
  label: string
  /** This frame's origin as the browser has it (`window.origin`): a fill meant for another is refused. */
  origin: string
  /** Whether this is the page's top frame, which alone shows the save prompt. */
  isTop: boolean
  geometry?: Geometry
}

/** A press on a form's button that may be a send, until the page navigates or the form goes. */
interface Armed {
  sent: Sent
  at: number
  form: HTMLFormElement | null
  elements: HTMLInputElement[]
}

export const armedForMs = 10_000
const scanDelayMs = 150
const sameSendMs = 3_000

export class Controller {
  private readonly deps: Deps
  private readonly doc: Document
  private readonly geometry: Geometry
  private readonly nameOf = fieldNames()
  private readonly ownHosts = new Set<Element>()
  private readonly badges = new Map<string, Badge>()
  private registry: Registry = new Map()
  private newPasswords: HTMLInputElement[] = []
  private manual: Registered | null = null
  private lastContext: HTMLInputElement | null = null
  private lastReports: string | null = null
  private buttons = false
  private scanTimer: ReturnType<typeof setTimeout> | undefined
  private placeQueued = false
  private frame: MenuFrame | null = null
  private prompt: MenuFrame | null = null
  private who: Promise<{ tabId: number; frameId: number }> | null = null
  private armed: Armed | null = null
  private lastSent: { sent: Sent; at: number } | null = null
  private stopped = false

  constructor(deps: Deps) {
    this.deps = deps
    this.doc = deps.doc
    const own = deps.geometry ?? pageGeometry(deps.doc)
    // The menu and the buttons sit over the page; they don't cover a field for the fill's test
    this.geometry = {
      rect: (element) => own.rect(element),
      elementsAt: (x, y) => own.elementsAt(x, y).filter((element) => !this.ownHosts.has(element)),
      viewport: () => own.viewport(),
    }
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Finding fields                                                                              */
  /* ------------------------------------------------------------------------------------------ */

  /** Reads the frame, reports what changed, and keeps the buttons where the fields are. */
  async scan(): Promise<void> {
    if (this.stopped) return
    const scan = scanFrame(this.doc, this.nameOf, this.geometry)
    this.registry = scan.registry
    this.newPasswords = scan.newPasswords
    const signature = signatureOfReports(scan.reports)
    if (signature !== this.lastReports && !(this.lastReports === null && signature === '')) {
      this.lastReports = signature
      try {
        const answer = await this.deps.call('fields', { fields: scan.reports })
        this.buttons = answer.buttons
      } catch {
        this.buttons = false
      }
    } else if (this.lastReports === null) this.lastReports = ''
    this.syncBadges()
    this.flushIfGone()
  }

  /** A rescan soon: forms that appear later, a field that changes, a page that moves. */
  schedule(): void {
    if (this.stopped || this.scanTimer !== undefined) return
    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined
      void this.scan()
    }, scanDelayMs)
  }

  /** The box of a field in the viewport (a code in boxes: from its first box to its last). */
  private boxOf(entry: Registered): Box | null {
    const boxes = entry.elements.filter((e) => e.isConnected).map((e) => this.geometry.rect(e))
    if (boxes.length !== entry.elements.length) return null
    return boundsOf(boxes)
  }

  private syncBadges(): void {
    for (const [id, badge] of this.badges)
      if (!this.buttons || !this.registry.has(id)) {
        this.ownHosts.delete(badge.host)
        badge.host.remove()
        this.badges.delete(id)
      }
    if (!this.buttons) return
    for (const id of this.registry.keys()) {
      if (this.badges.has(id)) continue
      const badge = new Badge(this.doc, this.deps.label, (event) => this.pressed(id, event))
      this.badges.set(id, badge)
      this.ownHosts.add(badge.host)
      this.attach(badge.host)
    }
    this.place()
  }

  private attach(host: Element): void {
    ;(this.doc.body ?? this.doc.documentElement).append(host)
  }

  /** Moves every button to its field (scroll, resize, layout changes). */
  place(): void {
    const { width, height } = this.geometry.viewport()
    for (const [id, badge] of this.badges) {
      const entry = this.registry.get(id)
      const box = entry === undefined ? null : this.boxOf(entry)
      let at: Box | null = null
      if (box !== null && box.left + box.width > 0 && box.top + box.height > 0)
        if (box.left < width && box.top < height)
          at = placeBadge(box, entry !== undefined && entry.elements.length > 1)
      badge.place(at)
      if (!badge.host.isConnected) this.attach(badge.host)
    }
  }

  /** `place` at most once per frame of the page's drawing. */
  queuePlace(): void {
    if (this.placeQueued || this.badges.size === 0) return
    this.placeQueued = true
    const view = this.doc.defaultView
    const run = () => {
      this.placeQueued = false
      this.place()
    }
    if (view !== null && typeof view.requestAnimationFrame === 'function')
      view.requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  /** Whether a mutation record is about Kemlock's own elements, which must not trigger a rescan. */
  ownMutation(record: MutationRecord): boolean {
    if (this.ownHosts.has(record.target as Element)) return true
    if (record.type !== 'childList') return false
    const nodes = [...record.addedNodes, ...record.removedNodes]
    return nodes.length > 0 && nodes.every((node) => this.ownHosts.has(node as Element))
  }

  /* ------------------------------------------------------------------------------------------ */
  /* The menu                                                                                    */
  /* ------------------------------------------------------------------------------------------ */

  private identity(): Promise<{ tabId: number; frameId: number }> {
    if (this.who === null) {
      const who = this.deps.call('frame', {})
      who.catch(() => {
        if (this.who === who) this.who = null
      })
      this.who = who
    }
    return this.who
  }

  /** A press on a button: a person's, on a button in plain view. */
  private pressed(id: string, event: MouseEvent): void {
    if (!event.isTrusted) return
    const badge = this.badges.get(id)
    if (badge === undefined) return
    const small = { width: 8, height: 8 }
    const plain = plainAt(badge.host, event.clientX, event.clientY, this.geometry, small)
    if (!plain.ok) return
    void this.openMenu(id, 'click')
  }

  /** Opens the menu on a field: by the button, the down arrow, or the background asking. */
  async openMenu(id: string, via: 'click' | 'key' | 'auto'): Promise<boolean> {
    const entry = this.registry.get(id) ?? (this.manual?.id === id ? this.manual : null)
    if (entry === null || this.stopped) return false
    this.closeMenu(false)
    let who: { tabId: number; frameId: number }
    try {
      who = await this.identity()
      await this.deps.call('openMenu', { fieldId: id })
    } catch {
      return false
    }
    if (this.frame !== null || this.stopped) return false
    const siteRules = entry.kind === 'newPassword' ? siteRulesOf(this.newPasswords) : undefined
    const frame = this.frameFor('menu', who, id, siteRules, () => {
      const current = this.registry.get(id) ?? (this.manual?.id === id ? this.manual : null)
      return current === null ? null : this.boxOf(current)
    })
    if (frame === null) return false
    this.frame = frame
    if (via !== 'auto') frame.focus()
    return true
  }

  private frameFor(
    mode: FrameMode,
    who: { tabId: number; frameId: number },
    fieldId: string,
    siteRules: string | undefined,
    anchor: () => Box | null,
  ): MenuFrame | null {
    try {
      const frame: MenuFrame = new MenuFrame(
        {
          doc: this.doc,
          geometry: this.geometry,
          pageUrl: this.deps.pageUrl,
          ownHosts: this.ownHosts,
        },
        {
          mode,
          tabId: who.tabId,
          frameId: who.frameId,
          fieldId,
          ...(siteRules !== undefined ? { siteRules } : {}),
          anchor,
          onClose: (refocus) => {
            if (this.frame === frame) this.frame = null
            if (this.prompt === frame) this.prompt = null
            if (refocus) this.refocus(fieldId)
          },
        },
      )
      return frame
    } catch {
      return null
    }
  }

  private refocus(id: string): void {
    const entry = this.registry.get(id) ?? this.manual
    entry?.elements[0]?.focus({ preventScroll: true })
  }

  closeMenu(refocus: boolean): void {
    this.frame?.close(refocus)
  }

  get menuOpen(): boolean {
    return this.frame !== null
  }

  /** Whether an event's path runs through one of Kemlock's own elements. */
  isOwn(path: EventTarget[]): boolean {
    return path.some((node) => this.ownHosts.has(node as Element))
  }

  /** The down arrow in a recognised field, with buttons on, opens its menu (spec). */
  arrowDown(event: KeyboardEvent): void {
    if (!this.buttons || event.defaultPrevented) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.composedPath()[0]
    for (const entry of this.registry.values()) {
      if (entry.elements[0] !== target) continue
      event.preventDefault()
      void this.openMenu(entry.id, 'key')
      return
    }
  }

  /** Notes the field a right-click is on, for the background's `contextTarget` that follows. */
  contextMenu(event: MouseEvent): void {
    const target = event.composedPath()[0]
    this.lastContext = target instanceof HTMLInputElement ? target : null
  }

  /**
   * The field the right-click menu was used on: a registered one, or any other text field, which
   * becomes fillable (spec "Any field fills from the right-click menu"). Null when it was on none.
   */
  contextTarget(): ContextTarget | null {
    const element =
      this.lastContext ??
      (this.doc.activeElement instanceof HTMLInputElement ? this.doc.activeElement : null)
    if (element === null || !element.isConnected) return null
    if (['hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'image'].includes(element.type))
      return null
    for (const entry of this.registry.values()) {
      if (entry.kind === 'manual' || !entry.elements.includes(element)) continue
      const rules = entry.kind === 'newPassword' ? siteRulesOf(this.newPasswords) : undefined
      return {
        fieldId: entry.id,
        kind: entry.kind,
        ...(entry.elements.length > 1 ? { boxes: entry.elements.length } : {}),
        ...(rules !== undefined ? { rules } : {}),
      }
    }
    const id = this.nameOf(element)
    this.manual = { id, kind: 'manual', elements: [element] }
    const kind: FieldKind = element.type === 'password' ? 'password' : 'username'
    const rules = element.type === 'password' ? siteRulesOf([element]) : undefined
    return { fieldId: id, kind, ...(rules !== undefined ? { rules } : {}) }
  }

  /* ------------------------------------------------------------------------------------------ */
  /* The background's messages                                                                   */
  /* ------------------------------------------------------------------------------------------ */

  /** The answer to a message from the background, or undefined for one that isn't ours. */
  handle(message: unknown): unknown {
    if (typeof message !== 'object' || message === null) return undefined
    const { kind } = message as { kind?: unknown }
    switch (kind) {
      case 'fill': {
        const { fieldId, value, origin } = message as Incoming & { kind: 'fill' }
        if (typeof fieldId !== 'string' || typeof value !== 'string') return { ok: false }
        // The page may have gone to another site since the background matched the item
        if (origin !== undefined && origin !== this.deps.origin) return { ok: false }
        return { ok: this.fill(fieldId, value) }
      }
      case 'openMenu': {
        const { fieldId } = message as Incoming & { kind: 'openMenu' }
        if (typeof fieldId !== 'string') return { ok: false }
        return this.openMenu(fieldId, 'auto').then((ok) => ({ ok }))
      }
      case 'closeMenus':
        this.frame?.close(false)
        this.prompt?.close(false)
        return { ok: true }
      case 'contextTarget':
        return this.contextTarget()
      case 'savePrompt':
        return this.showPrompt().then((ok) => ({ ok }))
      default:
        return undefined
    }
  }

  /** Decision 4's last steps: the field is the registered one, still there and in view; set it. */
  fill(fieldId: string, value: string): boolean {
    if (value.length === 0 || value.length > longestValue) return false
    const entry = this.registry.get(fieldId) ?? (this.manual?.id === fieldId ? this.manual : null)
    if (entry === null) return false
    const done = fillEntry(entry, value, this.geometry)
    if (!done) this.schedule()
    return done
  }

  private async showPrompt(): Promise<boolean> {
    if (!this.deps.isTop || this.stopped) return false
    this.prompt?.close(false)
    let who: { tabId: number; frameId: number }
    try {
      who = await this.identity()
    } catch {
      return false
    }
    this.prompt = this.frameFor('save', who, '', undefined, () => null)
    return this.prompt !== null
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Forms being sent                                                                            */
  /* ------------------------------------------------------------------------------------------ */

  /** A form was submitted: send what it holds. */
  submitted(event: Event): void {
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    this.send(readSent(this.registry, form))
    this.armed = null
  }

  /** A press on a button: a send, if the page then navigates or the form goes. */
  pressedPage(event: MouseEvent): void {
    const target = event.composedPath()[0]
    if (!(target instanceof Element)) return
    const button = sendsForm(target)
    if (button === null) return
    const form = formOf(button)
    const scope: ParentNode | null = form ?? this.doc
    const sent = readSent(this.registry, scope)
    if (sent === null) return
    const elements = [...this.registry.values()]
      .filter((entry) => entry.kind !== 'code')
      .map((entry) => entry.elements[0])
      .filter((input) => form === null || input.form === form || form.contains(input))
    this.armed = { sent, at: Date.now(), form, elements }
  }

  /** The page is leaving, or navigated: an armed press was a send. */
  navigated(): void {
    this.flushArmed()
  }

  /** After a rescan: an armed press whose form is gone or hidden was a send. */
  private flushIfGone(): void {
    const armed = this.armed
    if (armed === null) return
    if (Date.now() - armed.at > armedForMs) {
      this.armed = null
      return
    }
    const gone =
      (armed.form !== null && !armed.form.isConnected) ||
      armed.elements.every((input) => !input.isConnected || !isVisible(input, this.geometry))
    if (gone && armed.elements.length > 0) this.flushArmed()
  }

  private flushArmed(): void {
    const armed = this.armed
    this.armed = null
    if (armed === null || Date.now() - armed.at > armedForMs) return
    this.send(armed.sent)
  }

  private send(sent: Sent | null): void {
    if (sent === null) return
    const now = Date.now()
    if (
      this.lastSent !== null &&
      now - this.lastSent.at < sameSendMs &&
      sameSent(this.lastSent.sent, sent)
    )
      return
    this.lastSent = { sent, at: now }
    this.deps.call('sent', sent).catch(() => undefined)
  }

  /** The extension went away (reloaded or removed): leave the page as it was. */
  stop(): void {
    this.stopped = true
    clearTimeout(this.scanTimer)
    this.frame?.close(false)
    this.prompt?.close(false)
    for (const badge of this.badges.values()) badge.host.remove()
    this.badges.clear()
  }
}
