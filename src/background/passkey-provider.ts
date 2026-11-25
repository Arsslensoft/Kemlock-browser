// Kemlock as the browser's passkey provider (docs/plans/add-passkeys.md), the background's part:
//
// - `begin` takes a request the page script reported through the bridge, decides whether Kemlock serves it (the provider is on, a
//   vault exists, the site is not one the person excluded, the request is one Kemlock can answer, the relying party fits the
//   frame's origin as the browser reports it), and either leaves it to the browser (`fallback`) or keeps it and asks the person.
// - The person is asked in the menu frame the extension draws (src/menu/), which the page can't read: "Save a passkey in Kemlock"
//   or "Use another device or key" for a creation, the passkeys that match or the same way out for a sign-in. A conditional
//   request is answered from the menu of the page's field instead.
// - The person's click, through the menu's click gate, is the user presence; the vault being open is the user verification. The
//   core then makes or signs, and the end goes back to the frame that asked as a `passkeyDone` message, by the browser's own
//   address for that tab, frame and document.
//
// Secrets stay in the core: this holds options and ids, and a signature leaves only as the answer to the page.
import type { MenuView, VaultState } from '../shared/api'
import type { ToContent } from '../shared/messages'
import type {
  CreatedPasskey,
  PasskeyAction,
  PasskeyChoice,
  PasskeyCreationOptions,
  PasskeyCredentialJson,
  PasskeyErrorName,
  PasskeyOutcome,
  PasskeyPrompt,
  PasskeyRequestOptions,
  PasskeyStart,
  PasskeyView,
} from '../shared/passkeys'
import type { Deps } from './deps'
import { BackgroundError, errorWord } from './errors'
import { isOffHere, readPasskeyPrefs, setOffHere } from './passkey-prefs'
import { descriptorIds, serveCreate, serveGet } from './passkey-request'
import { PasskeyRequests, type StoredRequest } from './passkey-requests'
import type { ContentSender } from './senders'
import { hostOf } from './site'

/** What the provider needs of the background that holds it. */
export interface ProviderHooks {
  /** The vault must be open to go on (throws `noVault` or `locked`). */
  needOpen(): Promise<void>
  /** Kemlock was used: the idle time starts over. */
  touch(): Promise<void>
  /** A change was made in the browser: sync follows shortly. */
  changed(): Promise<void>
}

/** The DOM exception a core failure is told to the page as. */
function errorNameOf(error: unknown): PasskeyErrorName {
  switch (errorWord(error)) {
    case 'passkeyInvalidState':
      return 'InvalidStateError'
    case 'passkeySecurity':
      return 'SecurityError'
    case 'passkeyNotSupported':
      return 'NotSupportedError'
    case 'passkeyEncoding':
      return 'EncodingError'
    case 'locked':
    case 'noVault':
      return 'NotAllowedError'
    default:
      return 'UnknownError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toChoice = (passkey: PasskeyView): PasskeyChoice => ({
  id: passkey.id,
  name: passkey.name,
  detail: passkey.userDisplayName ?? passkey.userName,
})

/** A secret for a card: 128 bits the page never sees. */
const randomToken = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

export class PasskeyProvider {
  readonly requests = new PasskeyRequests()
  /** Requests being answered now: a second click on a card is not a second passkey. */
  private readonly busy = new Set<string>()

  constructor(
    private readonly d: Deps,
    private readonly hooks: ProviderHooks,
  ) {}

  /* ------------------------------------------------------------------------------------------- */
  /* From the page                                                                                  */
  /* ------------------------------------------------------------------------------------------- */

  /**
   * Whether Kemlock answers passkey requests in this frame: the switch, a vault, and the site not excluded. Only the background
   * asks this; what a page may learn of it is `status`, which says no more than the switch.
   */
  private async usable(sender: Pick<ContentSender, 'origin'>): Promise<boolean> {
    if (sender.origin === null) return false
    if (!(await readPasskeyPrefs()).on) return false
    if (!(await this.d.core.state()).exists) return false
    const host = hostOf(sender.origin)
    return host !== null && !(await isOffHere(host))
  }

  /**
   * What the page script may be told for the availability checks: the switch, and nothing of the vault or of the sites the person
   * excluded, which would tell any page who has a vault and where Kemlock stays out.
   */
  async status(sender: Pick<ContentSender, 'origin'>): Promise<boolean> {
    return sender.origin !== null && (await readPasskeyPrefs()).on
  }

  /**
   * The top page's origin when the frame that asks is not same-origin with every one of its ancestors (so the client data says
   * `crossOrigin`), else undefined. The chain is the browser's own: each frame's parent. A frame whose ancestors can't be read
   * (an address with no origin, a frame the browser doesn't list) throws, and the request goes to the browser.
   */
  private async crossTop(sender: ContentSender, origin: string): Promise<string | undefined> {
    if (sender.frameId === 0) return undefined
    // The frame list is the optional webNavigation permission's: without it a frame can't be judged, and the browser answers
    if (!(await chrome.permissions.contains({ permissions: ['webNavigation'] })))
      throw new BackgroundError('noPermission')
    const frames = await chrome.webNavigation.getAllFrames({ tabId: sender.tabId })
    if (frames === null || frames === undefined) throw new BackgroundError('unknownField')
    const byId = new Map(frames.map((frame) => [frame.frameId, frame]))
    let current = byId.get(sender.frameId)
    if (current === undefined) throw new BackgroundError('unknownField')
    let cross = false
    let top = origin
    for (let depth = 0; current.parentFrameId >= 0; depth += 1) {
      const parent = byId.get(current.parentFrameId)
      if (parent === undefined || depth > 64) throw new BackgroundError('unknownField')
      const address = new URL(parent.url)
      if (address.protocol !== 'https:' && address.protocol !== 'http:')
        throw new BackgroundError('unknownField')
      if (address.origin !== origin) cross = true
      top = address.origin
      current = parent
    }
    return cross ? top : undefined
  }

  async begin(
    sender: ContentSender,
    message: {
      id: string
      type: 'create' | 'get'
      conditional: boolean
      options: PasskeyCreationOptions | PasskeyRequestOptions
    },
  ): Promise<PasskeyStart> {
    const { core, now } = this.d
    const fallback: PasskeyStart = { outcome: 'fallback' }
    const origin = sender.origin
    try {
      if (origin === null || !(await this.usable(sender))) return fallback
      const host = hostOf(origin)
      if (host === null) return fallback
      const create = message.type === 'create'
      // A creation is never conditional here: the browser has its own automatic passkey upgrade
      if (create && message.conditional) return fallback
      const served = create
        ? serveCreate(message.options as PasskeyCreationOptions)
        : serveGet(message.options as PasskeyRequestOptions, message.conditional)
      if (!served.serve) return fallback
      // The relying party must be one this origin may use; if the browser would refuse it, it says so itself
      const rpId = await core.checkPasskeyRp(origin, served.rpId).catch(() => null)
      if (rpId === null) return fallback
      const topOrigin = await this.crossTop(sender, origin)
      // A page must not learn what the vault holds before the person is asked: a conditional request is always kept, and a
      // creation that names a credential the vault holds is asked too (the card says so, and the page is told once it is closed).
      // Only a sign-in with nothing of Kemlock's to offer, which no card could answer, is left to the browser at once.
      if (!create && !message.conditional && (await core.state()).unlocked) {
        const allowed = descriptorIds((served.options as PasskeyRequestOptions).allowCredentials)
        if ((await core.findPasskeys(rpId, allowed)).length === 0) return fallback
      }
      const at = now()
      const token = message.conditional ? undefined : randomToken()
      const request: StoredRequest = {
        id: message.id,
        tabId: sender.tabId,
        frameId: sender.frameId,
        ...(sender.documentId === undefined ? {} : { documentId: sender.documentId }),
        origin,
        ...(topOrigin === undefined ? {} : { topOrigin }),
        host,
        type: message.type,
        conditional: message.conditional,
        rpId,
        options: served.options,
        at,
        expires: at + served.timeout,
        ...(token === undefined ? {} : { token }),
      }
      if (!message.conditional) await this.endOthers(sender.tabId, message.id)
      await this.requests.put(request, at)
      if (token === undefined) return { outcome: 'pending' }
      if (!(await this.showCard(sender.tabId, token))) {
        await this.requests.remove(request.id)
        return fallback
      }
      return { outcome: 'pending' }
    } catch {
      // Whatever went wrong before the person was asked, the browser's own prompt is the way on
      return fallback
    }
  }

  /** A new modal request ends the ones before it in the tab: only one card is asked at a time. */
  private async endOthers(tabId: number, keep: string): Promise<void> {
    for (const other of await this.requests.forTab(tabId)) {
      if (other.id === keep || other.conditional) continue
      await this.requests.remove(other.id)
      await this.deliver(other, { outcome: 'error', name: 'NotAllowedError' })
    }
  }

  /** Asks the tab's top frame to show the card of the request that holds `token`, which only that frame is told. */
  private async showCard(tabId: number, token: string): Promise<boolean> {
    try {
      const message: ToContent = { kind: 'passkeyPrompt', token }
      const reply: unknown = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })
      return isRecord(reply) && reply.ok === true
    } catch {
      return false
    }
  }

  /** The page aborted the request, or the script gave up on it: it is forgotten, and its card closed. */
  async cancel(sender: ContentSender, id: string): Promise<void> {
    const request = await this.requests.get(id)
    if (
      request === undefined ||
      request.tabId !== sender.tabId ||
      request.frameId !== sender.frameId
    )
      return
    await this.requests.remove(id)
    await this.closeCard(request)
  }

  /** Closes the card of a modal request, and no other menu or prompt of the page. */
  private async closeCard(request: StoredRequest): Promise<void> {
    if (request.token === undefined) return
    const message: ToContent = { kind: 'passkeyClose', token: request.token }
    await chrome.tabs.sendMessage(request.tabId, message, { frameId: 0 }).catch(() => undefined)
  }

  /**
   * A tab was loading: each of its requests whose document is gone is over, and told so (the browser's own way is the only
   * answer left to give), with its card closed. A request whose document is still there (a single-page site that changed its
   * address) stays.
   */
  async reap(tabId: number): Promise<void> {
    for (const request of await this.requests.forTab(tabId)) {
      if (await this.waiting(request)) continue
      await this.requests.remove(request.id)
      await this.deliver(request, { outcome: 'fallback' })
      await this.closeCard(request)
    }
  }

  /** A tab closed: its requests are over. */
  async forgetTab(tabId: number): Promise<void> {
    for (const request of await this.requests.removeTab(tabId)) {
      await this.deliver(request, { outcome: 'fallback' })
      await this.closeCard(request)
    }
  }

  /** The vault locked: every request that waits for the person is over, and handed to the browser. */
  async locked(): Promise<void> {
    for (const request of await this.requests.takeAll()) {
      await this.deliver(request, { outcome: 'fallback' })
      await this.closeCard(request)
    }
  }

  /* ------------------------------------------------------------------------------------------- */
  /* To the page                                                                                    */
  /* ------------------------------------------------------------------------------------------- */

  /** Tells the frame how a request ended. False when the frame is gone (it went on to another page). */
  private async deliver(request: StoredRequest, result: PasskeyOutcome): Promise<boolean> {
    try {
      const message: ToContent = { kind: 'passkeyDone', id: request.id, result }
      await chrome.tabs.sendMessage(request.tabId, message, this.target(request))
      return true
    } catch {
      return false
    }
  }

  private target(request: StoredRequest): { frameId: number; documentId?: string } {
    return {
      frameId: request.frameId,
      ...(request.documentId === undefined ? {} : { documentId: request.documentId }),
    }
  }

  /** Whether the frame that asked is still there, waiting for this request. */
  private async waiting(request: StoredRequest): Promise<boolean> {
    try {
      const message: ToContent = { kind: 'passkeyPing', id: request.id }
      const reply: unknown = await chrome.tabs.sendMessage(
        request.tabId,
        message,
        this.target(request),
      )
      return isRecord(reply) && reply.ok === true
    } catch {
      return false
    }
  }

  /** Ends a request: forgotten, and the page told. */
  private async end(request: StoredRequest, result: PasskeyOutcome): Promise<void> {
    await this.requests.remove(request.id)
    await this.deliver(request, result)
  }

  /* ------------------------------------------------------------------------------------------- */
  /* The card                                                                                       */
  /* ------------------------------------------------------------------------------------------- */

  /**
   * The modal request whose card holds `token`, still within its time. Never "the tab's newest": a second request of the tab (an
   * embedded frame's) must not take over the card of the first, and a page that frames the menu page itself has no token.
   */
  private async modal(tabId: number, token: string): Promise<StoredRequest | undefined> {
    const now = this.d.now()
    return (await this.requests.forTab(tabId)).find(
      (request) => !request.conditional && request.token === token && request.expires > now,
    )
  }

  private vaultState(state: VaultState): PasskeyPrompt['state'] {
    return { exists: state.exists, unlocked: state.unlocked, wrongPasswords: state.wrongPasswords }
  }

  /** What the card shows; null when the request is over (the card then closes). */
  async prompt(tabId: number, token: string): Promise<PasskeyPrompt | null> {
    const { core } = this.d
    const request = await this.modal(tabId, token)
    if (request === undefined) return null
    const state = await core.state()
    // A top origin is kept only when some ancestor is of another site (it may equal the frame's own, nested between the two)
    const crossOrigin = request.topOrigin !== undefined
    const prompt: PasskeyPrompt = {
      state: this.vaultState(state),
      kind: request.type,
      site: request.rpId,
      host: request.host,
      crossOrigin,
      choices: [],
    }
    if (request.type === 'create') {
      const options = request.options as PasskeyCreationOptions
      if (state.unlocked && (await this.holdsExcluded(request))) prompt.alreadyHeld = true
      if (options.rp.name !== undefined && options.rp.name !== '') prompt.rpName = options.rp.name
      prompt.user = {
        name: options.user.name,
        ...(options.user.displayName === undefined || options.user.displayName === ''
          ? {}
          : { displayName: options.user.displayName }),
      }
    } else if (state.unlocked) {
      const options = request.options as PasskeyRequestOptions
      const found = await core.findPasskeys(request.rpId, descriptorIds(options.allowCredentials))
      // Nothing of Kemlock's answers it: the browser's own prompt takes over at once
      if (found.length === 0) {
        await this.end(request, { outcome: 'fallback' })
        return null
      }
      prompt.choices = found.map(toChoice)
    }
    return prompt
  }

  private async once(id: string, work: () => Promise<void>): Promise<void> {
    if (this.busy.has(id)) throw new BackgroundError('refused')
    this.busy.add(id)
    try {
      await work()
    } finally {
      this.busy.delete(id)
    }
  }

  /** The person's answer to the card. */
  async answer(
    tabId: number,
    token: string,
    action: PasskeyAction,
    passkeyId: string | undefined,
  ): Promise<void> {
    const request = await this.modal(tabId, token)
    if (request === undefined) throw new BackgroundError('unknownField')
    return this.once(request.id, () => this.act(request, action, passkeyId))
  }

  private async act(
    request: StoredRequest,
    action: PasskeyAction,
    passkeyId: string | undefined,
  ): Promise<void> {
    switch (action) {
      case 'other':
        return this.end(request, { outcome: 'fallback' })
      case 'cancel':
        return this.end(request, { outcome: 'error', name: 'NotAllowedError' })
      case 'dismiss': {
        // The card said the vault holds a credential the site excludes: the page is told now that the person has seen it
        const held =
          request.type === 'create' && (await this.holdsExcluded(request).catch(() => false))
        return this.end(request, {
          outcome: 'error',
          name: held ? 'InvalidStateError' : 'NotAllowedError',
        })
      }
      case 'never':
        await setOffHere(request.host, true)
        return this.end(request, { outcome: 'fallback' })
      case 'save':
        if (request.type !== 'create') throw new BackgroundError('refused')
        return this.make(request)
      case 'use':
        if (request.type !== 'get' || passkeyId === undefined) throw new BackgroundError('refused')
        return this.use(request, passkeyId)
    }
  }

  /** Whether the vault holds a credential of the site that a creation excludes (the vault open). */
  private async holdsExcluded(request: StoredRequest): Promise<boolean> {
    const excluded = descriptorIds((request.options as PasskeyCreationOptions).excludeCredentials)
    if (excluded.length === 0) return false
    return (await this.d.core.findPasskeys(request.rpId, excluded)).length > 0
  }

  private async make(request: StoredRequest): Promise<void> {
    const { core } = this.d
    await this.hooks.needOpen()
    if (!(await this.waiting(request))) {
      await this.requests.remove(request.id)
      throw new BackgroundError('unknownField')
    }
    let made: CreatedPasskey
    try {
      made = await core.createPasskey(
        request.options as PasskeyCreationOptions,
        request.origin,
        request.topOrigin,
      )
    } catch (error) {
      return this.end(request, { outcome: 'error', name: errorNameOf(error) })
    }
    await this.hooks.touch()
    await this.hooks.changed()
    await this.end(request, { outcome: 'credential', credential: made.response })
  }

  /** Signs with a passkey the request can take, for the person's click on it. */
  private async use(request: StoredRequest, passkeyId: string): Promise<void> {
    const { core } = this.d
    await this.hooks.needOpen()
    const options = request.options as PasskeyRequestOptions
    const found = await core.findPasskeys(request.rpId, descriptorIds(options.allowCredentials))
    // Only a passkey the card offered: the id the menu sends is checked against what answers this request
    if (!found.some((passkey) => passkey.id === passkeyId)) throw new BackgroundError('refused')
    if (!(await this.waiting(request))) {
      await this.requests.remove(request.id)
      throw new BackgroundError('unknownField')
    }
    let credential: PasskeyCredentialJson
    try {
      credential = await core.signPasskey(
        passkeyId,
        options.challenge,
        request.origin,
        request.topOrigin,
      )
    } catch (error) {
      return this.end(request, { outcome: 'error', name: errorNameOf(error) })
    }
    await this.hooks.touch()
    await this.end(request, { outcome: 'credential', credential })
  }

  /* ------------------------------------------------------------------------------------------- */
  /* Conditional requests, from a field's menu                                                      */
  /* ------------------------------------------------------------------------------------------- */

  /** The conditional request of a frame's current document, still within its time. */
  private async conditional(
    tabId: number,
    frameId: number,
    documentId: string | undefined,
  ): Promise<StoredRequest | undefined> {
    const now = this.d.now()
    return (await this.requests.forTab(tabId)).find(
      (request) =>
        request.conditional &&
        request.frameId === frameId &&
        request.expires > now &&
        (request.documentId === undefined ||
          documentId === undefined ||
          request.documentId === documentId),
    )
  }

  /** The passkeys a field's menu offers for the frame's conditional request; none without one, or while locked. */
  async choices(
    tabId: number,
    frameId: number,
    documentId: string | undefined,
  ): Promise<PasskeyChoice[]> {
    const request = await this.conditional(tabId, frameId, documentId)
    if (request === undefined || !(await this.d.core.state()).unlocked) return []
    const options = request.options as PasskeyRequestOptions
    const found = await this.d.core.findPasskeys(
      request.rpId,
      descriptorIds(options.allowCredentials),
    )
    return found.map(toChoice)
  }

  /** A passkey picked in the menu of a field answers the frame's conditional request. */
  async choose(
    tabId: number,
    frameId: number,
    documentId: string | undefined,
    passkeyId: string,
  ): Promise<void> {
    const request = await this.conditional(tabId, frameId, documentId)
    if (request === undefined) throw new BackgroundError('unknownField')
    return this.once(request.id, () => this.use(request, passkeyId))
  }

  /** `passkeyChoose`'s helper for the menu list: adds the passkeys to a menu view when there are any. */
  async addTo(
    view: MenuView,
    tabId: number,
    frameId: number,
    documentId: string | undefined,
  ): Promise<void> {
    if (view.field.kind === 'code' || view.field.kind === 'newPassword') return
    const choices = await this.choices(tabId, frameId, documentId)
    if (choices.length > 0) view.passkeys = choices
  }
}
