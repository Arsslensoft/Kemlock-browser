// The passkey requests waiting for the person (docs/plans/add-passkeys.md), in storage.session so a worker the browser stopped
// still knows them: a modal card in a tab's top frame, or a conditional request that a field's menu can answer. A request holds
// what the page asked and where the browser says it asked from, and nothing secret.
import type { PasskeyCreationOptions, PasskeyRequestOptions } from '../shared/passkeys'

export interface StoredRequest {
  /** The page script's own id, which the end is told under. */
  id: string
  tabId: number
  frameId: number
  /** Chrome's id for the frame's document: the end goes to that document only. */
  documentId?: string
  /** The frame's origin as the browser reported it, never the request's. */
  origin: string
  /** The tab's origin when it is not the frame's (a frame of another site asks). */
  topOrigin?: string
  /** The frame's host, for the card and the sites Kemlock stays out of. */
  host: string
  type: 'create' | 'get'
  /** A conditional request is answered from a field's menu; any other from the card. */
  conditional: boolean
  /** The relying party the core checked against the origin. */
  rpId: string
  options: PasskeyCreationOptions | PasskeyRequestOptions
  at: number
  /** When it is given up. */
  expires: number
  /** A modal request: the secret of its card, which the background gave to the top frame's content script alone. */
  token?: string
}

const storeKey = 'kemlock_passkey_requests'

export class PasskeyRequests {
  private chain: Promise<unknown> = Promise.resolve()

  /** One change at a time, so two messages in a row don't write over each other. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async all(): Promise<Record<string, StoredRequest>> {
    const stored = (await chrome.storage.session.get(storeKey))[storeKey]
    return typeof stored === 'object' && stored !== null
      ? (stored as Record<string, StoredRequest>)
      : {}
  }

  private async write(all: Record<string, StoredRequest>): Promise<void> {
    if (Object.keys(all).length === 0) await chrome.storage.session.remove(storeKey)
    else await chrome.storage.session.set({ [storeKey]: all })
  }

  /** Keeps a request (one id once), dropping those whose time has gone. */
  put(request: StoredRequest, now: number): Promise<void> {
    return this.serial(async () => {
      const all = await this.all()
      for (const [id, held] of Object.entries(all)) if (held.expires <= now) delete all[id]
      all[request.id] = request
      await this.write(all)
    })
  }

  get(id: string): Promise<StoredRequest | undefined> {
    return this.serial(async () => (await this.all())[id])
  }

  /** The requests of a tab, the newest first. */
  forTab(tabId: number): Promise<StoredRequest[]> {
    return this.serial(async () =>
      Object.values(await this.all())
        .filter((request) => request.tabId === tabId)
        .sort((a, b) => b.at - a.at),
    )
  }

  /** Forgets a request; answers whether it was there. */
  remove(id: string): Promise<boolean> {
    return this.serial(async () => {
      const all = await this.all()
      if (!(id in all)) return false
      delete all[id]
      await this.write(all)
      return true
    })
  }

  /** Forgets a tab's requests and answers them, so the caller can end each. */
  removeTab(tabId: number): Promise<StoredRequest[]> {
    return this.serial(async () => {
      const all = await this.all()
      const gone = Object.values(all).filter((request) => request.tabId === tabId)
      for (const request of gone) delete all[request.id]
      if (gone.length > 0) await this.write(all)
      return gone
    })
  }

  /** Locking drops every request that waits for the person, and answers them so each can be ended. */
  takeAll(): Promise<StoredRequest[]> {
    return this.serial(async () => {
      const all = Object.values(await this.all())
      await chrome.storage.session.remove(storeKey)
      return all
    })
  }
}
