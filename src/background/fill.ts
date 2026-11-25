// The fill path (design decision 4): a click goes to the background, which checks that the frame's
// site still matches the item, and sends the value to that tab and frame only. The content script
// checks the field again. A code's secret never leaves the core: only the digits travel.
import type { CardFull, IdentityFull, PageApi } from '../shared/api'
import { fillRefused, type FieldReport, type ToContent } from '../shared/messages'
import { BackgroundError } from './errors'
import { formValues } from './forms'
import { rememberPick } from './picks'
import { refuseHidden } from './spaces'
import { injectContentScript } from './site-access'
import { hostOf, siteMatch } from './site'
import type { Deps } from './deps'
import type { FrameRecord } from './tabs'

export type FillArgs = Parameters<PageApi['fill']>[0]

interface Entry {
  frameId: number
  frame: FrameRecord
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const originOf = (address: string | null | undefined): string | null => {
  if (address === null || address === undefined) return null
  try {
    return new URL(address).origin
  } catch {
    return null
  }
}

/** How long a tab just given the script is waited for to report its fields. */
const reportWaitMs = 1500

export class Filler {
  constructor(private readonly d: Deps) {}

  /**
   * Fills. `confirmed` is the person's own pick in the menu after seeing the address (the picker
   * and the look-alike guard), which may fill an item the site doesn't match; otherwise the
   * item must be one the frame's site offers.
   */
  async fill(args: FillArgs, confirmed: boolean): Promise<void> {
    if (args.newPassword !== undefined) await this.fillNewPassword(args)
    else if (args.cardId !== undefined || args.identityId !== undefined)
      await this.fillForm(args, confirmed)
    else if (args.loginId === undefined && args.codeId === undefined)
      throw new BackgroundError('badRequest')
    else {
      const entries = await this.entries(args)
      if (args.loginId !== undefined) await this.fillLogin(args, args.loginId, entries, confirmed)
      if (args.codeId !== undefined) await this.fillCode(args, args.codeId, entries, confirmed)
    }
    await this.d.autoLock.used()
  }

  /** The frames to fill: the one named, or every frame of the tab that reported fields. */
  private async entries(args: FillArgs): Promise<Entry[]> {
    const { tabs } = this.d
    if (args.fieldId !== undefined) {
      const frameId = args.frameId ?? 0
      const frame = (await tabs.get(args.tabId)).frames[frameId]
      if (frame === undefined) throw new BackgroundError('unknownField')
      return [{ frameId, frame }]
    }
    let entries = await this.reported(args.tabId, args.frameId)
    if (entries.length === 0) {
      // Without access to all sites, the popup's click is what lets the script in (activeTab)
      try {
        await injectContentScript(args.tabId)
      } catch {
        throw new BackgroundError('noPermission')
      }
      for (let waited = 0; waited <= reportWaitMs; waited += 100) {
        entries = await this.reported(args.tabId, args.frameId)
        if (entries.length > 0) break
        await sleep(100)
      }
    }
    return entries
  }

  private async reported(tabId: number, frameId?: number): Promise<Entry[]> {
    const state = await this.d.tabs.get(tabId)
    const top = state.frames[0]
    if (top !== undefined) {
      // A tab that went on to another site since its frames reported: they are no longer its
      const current = (await chrome.tabs.get(tabId).catch(() => undefined))?.url
      const now = originOf(current)
      if (now !== null && now !== originOf(top.address)) {
        await this.d.tabs.forgetFrames(tabId)
        return []
      }
    }
    return Object.entries(state.frames)
      .map(([id, frame]) => ({ frameId: Number(id), frame }))
      .filter(
        (entry) =>
          (frameId === undefined || entry.frameId === frameId) && entry.frame.fields.length > 0,
      )
  }

  private async send(
    tabId: number,
    entry: Entry,
    fieldId: string,
    value: string,
    alt?: string[],
  ): Promise<void> {
    const origin = originOf(entry.frame.address)
    if (origin === null) throw new BackgroundError('noMatch')
    const message: ToContent = {
      kind: 'fill',
      fieldId,
      value,
      origin,
      ...(alt === undefined ? {} : { alt }),
    }
    const options =
      entry.frame.documentId === undefined
        ? { frameId: entry.frameId }
        : { frameId: entry.frameId, documentId: entry.frame.documentId }
    let answer: unknown
    try {
      answer = await chrome.tabs.sendMessage(tabId, message, options)
    } catch {
      throw new BackgroundError('failed')
    }
    if (fillRefused(answer)) throw new BackgroundError('failed')
  }

  private field(entry: Entry, fieldId: string | undefined): FieldReport | undefined {
    if (fieldId === undefined) return undefined
    const field = entry.frame.fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new BackgroundError('unknownField')
    return field
  }

  private async fillLogin(
    args: FillArgs,
    loginId: string,
    entries: Entry[],
    confirmed: boolean,
  ): Promise<void> {
    const { core } = this.d
    let filled = 0
    let secret: Awaited<ReturnType<typeof core.revealLogin>> | undefined
    for (const entry of entries) {
      if (entry.frame.address === null) continue
      const offered = (await siteMatch(core, entry.frame.address)).logins.includes(loginId)
      if (!offered && !confirmed) {
        if (args.fieldId !== undefined) throw new BackgroundError('noMatch')
        continue
      }
      // The picker names every login: one whose password a grant hides is never put on a site the person chose (docs/plans/add-spaces.md)
      if (!offered) await refuseHidden(core, loginId)
      const target = this.field(entry, args.fieldId)
      const fields = entry.frame.fields
      const username =
        target?.kind === 'username' ? target : fields.find((f) => f.kind === 'username')
      const password =
        target?.kind === 'password' || target?.kind === 'newPassword'
          ? target
          : fields.find((f) => f.kind === 'password')
      if (target?.kind === 'code' || (username === undefined && password === undefined)) continue
      secret ??= await core.revealLogin(loginId)
      if (username !== undefined && secret.username !== '')
        await this.send(args.tabId, entry, username.id, secret.username)
      if (password !== undefined) await this.send(args.tabId, entry, password.id, secret.password)
      filled++
      const host = hostOf(entry.frame.address)
      if (!offered && args.remember === true && host !== null)
        await rememberPick(core, host, loginId)
      if (password !== undefined) await this.codeToFollow(args.tabId, loginId, host)
    }
    if (filled === 0)
      throw new BackgroundError(args.fieldId === undefined ? 'noMatch' : 'unknownField')
  }

  /** The login has a code and the person wants it offered on the next page: remember that. */
  private async codeToFollow(tabId: number, loginId: string, host: string | null): Promise<void> {
    const { core, tabs, now } = this.d
    if (host === null || !(await core.settings()).codeAfterPassword) return
    const login = (await core.logins()).find((l) => l.id === loginId)
    if (login?.codeId === undefined) return
    await tabs.update(tabId, (state) => {
      state.after = { loginId, host, at: now() }
    })
  }

  private async fillCode(
    args: FillArgs,
    codeId: string,
    entries: Entry[],
    confirmed: boolean,
  ): Promise<void> {
    const { core, now } = this.d
    const code = (await core.codes()).find((c) => c.id === codeId)
    if (code === undefined) throw new BackgroundError('failed')
    if (code.onSecurityKey) throw new BackgroundError('securityKey')
    let filled = 0
    let digits: string | undefined
    for (const entry of entries) {
      if (entry.frame.address === null) continue
      const offered = (await siteMatch(core, entry.frame.address)).codes.includes(codeId)
      if (!offered && !confirmed) {
        if (args.fieldId !== undefined) throw new BackgroundError('noMatch')
        continue
      }
      // A field named by the right-click menu takes the code whatever Kemlock thought it was
      const target =
        this.field(entry, args.fieldId) ?? entry.frame.fields.find((f) => f.kind === 'code')
      if (target === undefined) continue
      digits ??= (await core.liveCodes([codeId], now()))[0]?.code
      if (digits === undefined) throw new BackgroundError('failed')
      await this.send(args.tabId, entry, target.id, digits)
      filled++
      const host = hostOf(entry.frame.address)
      if (!offered && args.remember === true && host !== null)
        await rememberPick(core, host, codeId)
    }
    if (filled === 0)
      throw new BackgroundError(args.fieldId === undefined ? 'noMatch' : 'unknownField')
  }

  /**
   * A card or an identity (docs/plans/add-items.md, decision 1). Neither belongs to a website, so the frame is what is checked:
   * it fills by itself only in the tab's top frame over https. Any other frame (a payment provider's iframe) and any http page
   * fills only after the person confirmed it in the menu (`confirmed`), which showed them the frame's own address; the popup
   * and the right-click menu can't confirm, and are told so. Only one block of a frame is filled: the named field's, else the one
   * the person is in, else the first.
   */
  private async fillForm(args: FillArgs, confirmed: boolean): Promise<void> {
    const { core } = this.d
    const cardId = args.cardId
    const identityId = args.identityId
    const kind = cardId !== undefined ? 'card' : 'identity'
    const entries = await this.entries(args)
    let item: CardFull | IdentityFull | undefined
    let filled = 0
    let blocked: 'confirm' | 'insecure' | undefined
    for (const entry of entries) {
      const address = entry.frame.address
      if (address === null) continue
      const target = this.field(entry, args.fieldId)
      const ofKind = entry.frame.fields.filter(
        (field) => field.kind === kind && field.part !== undefined,
      )
      // One block: the field named's, else the one the person is in, else the first (never every block of the frame)
      const block =
        target?.group ?? (ofKind.find((field) => field.focus === true) ?? ofKind[0])?.group
      const fields = ofKind.filter((field) => field.group === block)
      if (fields.length === 0) continue
      const secure = address.startsWith('https://')
      if (!confirmed && !(entry.frameId === 0 && secure)) {
        blocked ??= secure ? 'confirm' : 'insecure'
        continue
      }
      // A frame the page embeds is drawn by the page, which may fade or cover it: the top frame says it is in plain view
      if (confirmed && entry.frameId !== 0 && !(await this.topSees(args.tabId, address)))
        throw new BackgroundError('unverified')
      if (item === undefined && cardId !== undefined) item = await core.revealCard(cardId)
      if (item === undefined && identityId !== undefined)
        item = await core.revealIdentity(identityId)
      if (item === undefined) throw new BackgroundError('badRequest')
      const values = formValues(
        kind === 'card' ? { card: item as CardFull } : { identity: item as IdentityFull },
        fields.flatMap((field) =>
          field.part === undefined
            ? []
            : [
                {
                  id: field.id,
                  part: field.part,
                  ...(field.rules === undefined ? {} : { rules: field.rules }),
                },
              ],
        ),
      )
      let here = 0
      for (const { fieldId, value, alt } of values) {
        try {
          await this.send(args.tabId, entry, fieldId, value, alt)
          here++
        } catch (error) {
          // A field that went away or has no such option: the others still fill
          if (!(error instanceof BackgroundError) || error.code !== 'failed') throw error
        }
      }
      filled += here
    }
    if (filled === 0) {
      if (blocked !== undefined) throw new BackgroundError(blocked)
      throw new BackgroundError(args.fieldId === undefined ? 'noMatch' : 'unknownField')
    }
  }

  /** Whether the tab's top frame draws the frame at [address] in plain view; false when it can't be asked. */
  private async topSees(tabId: number, address: string): Promise<boolean> {
    const origin = originOf(address)
    if (origin === null) return false
    const message: ToContent = { kind: 'frameVisible', origin }
    try {
      const answer = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })
      return (answer as { ok?: unknown } | undefined)?.ok === true
    } catch {
      return false
    }
  }

  /** A suggested password: kept under Recently generated first, then in the field and its confirmation. */
  private async fillNewPassword(args: FillArgs): Promise<void> {
    const { now } = this.d
    const entries = await this.entries(args)
    const entry = entries[0]
    const value = args.newPassword
    if (entry === undefined || value === undefined || args.fieldId === undefined)
      throw new BackgroundError('unknownField')
    const target = this.field(entry, args.fieldId)!
    const fields =
      target.kind === 'newPassword'
        ? entry.frame.fields.filter((f) => f.kind === 'newPassword')
        : [target]
    await this.addRecent({ value, at: now(), site: hostOf(entry.frame.address ?? '') ?? undefined })
    for (const field of fields) await this.send(args.tabId, entry, field.id, value)
  }

  /** Recently generated: sealed in the vault where the core can, else for this browser session. */
  async addRecent(password: { value: string; at: number; site?: string }): Promise<void> {
    const { core } = this.d
    if (core.addRecentPassword !== undefined) return core.addRecentPassword(password)
    const stored = (await chrome.storage.session.get(recentKey))[recentKey]
    const list = Array.isArray(stored) ? stored : []
    await chrome.storage.session.set({ [recentKey]: [password, ...list].slice(0, 50) })
  }
}

export const recentKey = 'kemlock_recent'
