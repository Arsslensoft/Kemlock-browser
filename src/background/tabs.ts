// What the background knows of each tab, in storage.session so a stopped worker still knows it
// (design decisions 4, 5 and 10): the frames that reported fields and where they are, the menu a
// frame opened, a form sent and waiting to be saved, and a login just filled whose code follows.
import type { FieldReport } from '../shared/messages'

/** A frame as its own content script reported it, with the address the browser gave. */
export interface FrameRecord {
  documentId?: string
  url: string
  origin: string | null
  /** What it is matched by: see `frameAddress`. Null for a frame with no web address. */
  address: string | null
  fields: FieldReport[]
}

/** The one menu the content script of a tab asked to open. Only it may list items and fill. */
export interface MenuGrant {
  frameId: number
  fieldId: string
  at: number
}

/** A form that was sent, kept until the next page has loaded and the person has answered. */
export interface PendingLogin {
  username: string
  password: string
  frameId: number
  address: string
  host: string
  at: number
  /** The prompt was asked for already, so a later load doesn't ask again. */
  prompted?: boolean
}

/** A login with a linked code was filled: the next code field on its site offers the code. */
export interface AfterPassword {
  loginId: string
  host: string
  at: number
}

export interface TabState {
  frames: Record<string, FrameRecord>
  menu?: MenuGrant
  pending?: PendingLogin
  after?: AfterPassword
}

/** Five minutes: how long a sent form, or a code that follows a password, is kept. */
export const keepMs = 5 * 60_000

const storeKey = 'kemlock_tabs'

const isEmpty = (state: TabState) =>
  Object.keys(state.frames).length === 0 &&
  state.menu === undefined &&
  state.pending === undefined &&
  state.after === undefined

export class TabStore {
  private chain: Promise<unknown> = Promise.resolve()

  /** One change at a time, so two messages in a row don't write over each other. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async all(): Promise<Record<string, TabState>> {
    const stored = (await chrome.storage.session.get(storeKey))[storeKey]
    return typeof stored === 'object' && stored !== null ? (stored as Record<string, TabState>) : {}
  }

  async get(tabId: number): Promise<TabState> {
    return this.serial(async () => (await this.all())[tabId] ?? { frames: {} })
  }

  /** Changes a tab's state; what `change` returns is returned. */
  update<T>(tabId: number, change: (state: TabState) => T): Promise<T> {
    return this.serial(async () => {
      const all = await this.all()
      const state = all[tabId] ?? { frames: {} }
      const result = change(state)
      if (isEmpty(state)) delete all[tabId]
      else all[tabId] = state
      await chrome.storage.session.set({ [storeKey]: all })
      return result
    })
  }

  async tabIds(): Promise<number[]> {
    return this.serial(async () => Object.keys(await this.all()).map(Number))
  }

  remove(tabId: number): Promise<void> {
    return this.update(tabId, (state) => {
      state.frames = {}
      delete state.menu
      delete state.pending
      delete state.after
    })
  }

  /** A tab went to another page: the frames it had reported are gone. */
  forgetFrames(tabId: number): Promise<void> {
    return this.update(tabId, (state) => {
      state.frames = {}
      delete state.menu
    })
  }

  /** Locking drops what a tab held: its menus' grants and the sent forms' passwords. */
  clearSecrets(): Promise<void> {
    return this.serial(async () => {
      const all = await this.all()
      for (const [id, state] of Object.entries(all)) {
        delete state.menu
        delete state.pending
        delete state.after
        if (isEmpty(state)) delete all[id]
      }
      await chrome.storage.session.set({ [storeKey]: all })
    })
  }

  async clear(): Promise<void> {
    await this.serial(() => chrome.storage.session.remove(storeKey))
  }
}
