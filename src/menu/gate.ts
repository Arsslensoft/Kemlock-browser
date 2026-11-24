// The menu's own click gate (design decision 9; spec "A click counts only on a menu in plain view").
// The frame takes a click or a key only after it has been fully visible and uncovered for half a
// second, as two witnesses say: the browser's IntersectionObserver v2 (where it has one: Chrome and
// Edge) and the content script, which reads the page's styles around the frame. Any change in
// either, or the frame moving, starts the half second again. Otherwise the input is ignored, and
// the menu says why.

/** What the content script says of the frame, many times a second (src/content/frame.ts). */
export interface PageState {
  plain: boolean
  why?: 'detached' | 'hidden' | 'faded' | 'tiny' | 'clipped' | 'covered'
  /** Changes when the frame moves or is resized. */
  signature: string
}

/** Why input was ignored. `wait` is the half second; the others are what hid the menu. */
export type Ignored = 'wait' | 'hidden' | 'faded' | 'covered' | 'silent'

export type Verdict = { ok: true } | { ok: false; why: Ignored }

export interface GateOptions {
  /** How long the menu must have been in plain view, in milliseconds. */
  delay?: number
  /** How old the content script's last word may be before it counts as silence. */
  stale?: number
  /** Whether IntersectionObserver v2 is there to be asked. */
  tracked: boolean
}

export const defaultDelay = 500
export const defaultStale = 700

export class Gate {
  private readonly delay: number
  private readonly stale: number
  private readonly tracked: boolean
  private seen = false
  private page: PageState | null = null
  private pageAt = 0
  // Until the observer has said so, a tracked menu is not known to be visible
  private visible: boolean | null
  private since: number | null = null

  constructor(options: GateOptions) {
    this.delay = options.delay ?? defaultDelay
    this.stale = options.stale ?? defaultStale
    this.tracked = options.tracked
    this.visible = options.tracked ? false : null
  }

  /** IntersectionObserver v2's word: fully visible, or not. */
  intersection(visible: boolean, at: number): void {
    if (!this.tracked) return
    this.visible = visible
    this.update(at, false)
  }

  /** The content script's word on the frame. */
  pageSays(state: PageState, at: number): void {
    const moved = this.page !== null && this.page.signature !== state.signature
    this.page = state
    this.pageAt = at
    this.seen = true
    this.update(at, moved)
  }

  private ok(): boolean {
    return this.page !== null && this.page.plain && this.visible !== false
  }

  private update(at: number, moved: boolean): void {
    if (!this.ok()) this.since = null
    else if (this.since === null || moved) this.since = at
  }

  verdict(at: number): Verdict {
    if (!this.seen || this.page === null || at - this.pageAt > this.stale)
      return { ok: false, why: 'silent' }
    if (!this.page.plain) {
      const why = this.page.why
      if (why === 'faded') return { ok: false, why: 'faded' }
      if (why === 'covered') return { ok: false, why: 'covered' }
      return { ok: false, why: 'hidden' }
    }
    if (this.visible === false) return { ok: false, why: 'hidden' }
    if (this.since === null || at - this.since < this.delay) return { ok: false, why: 'wait' }
    return { ok: true }
  }
}

/** Whether this browser has IntersectionObserver v2's visibility tracking. */
export function canTrackVisibility(): boolean {
  return (
    typeof IntersectionObserver !== 'undefined' &&
    typeof IntersectionObserverEntry !== 'undefined' &&
    'isVisible' in IntersectionObserverEntry.prototype
  )
}

/**
 * Watches [target] with IntersectionObserver v2 and tells [gate]. Returns a function that stops.
 */
export function trackVisibility(target: Element, gate: Gate, now: () => number): () => void {
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1]
      if (entry === undefined) return
      const visible = (entry as IntersectionObserverEntry & { isVisible?: boolean }).isVisible
      gate.intersection(visible === true && entry.intersectionRatio >= 0.99, now())
    },
    // `trackVisibility` and `delay` are v2's: occlusion, opacity, filters and transforms count
    { threshold: [0, 0.99, 1], trackVisibility: true, delay: 100 } as IntersectionObserverInit,
  )
  observer.observe(target)
  return () => observer.disconnect()
}
