// The fill path (design decision 4): a click goes to the background, which checks that the frame's
// site still matches the item, and sends the value to that tab and frame only. The content script
// checks the field again. A code's secret never leaves the core: only the digits travel.
import type { PageApi } from '../shared/api'
import { fillRefused, type FieldReport, type ToContent } from '../shared/messages'
import { BackgroundError } from './errors'
import { rememberPick } from './picks'
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

  private async send(tabId: number, entry: Entry, fieldId: string, value: string): Promise<void> {
    const origin = originOf(entry.frame.address)
    if (origin === null) throw new BackgroundError('noMatch')
    const message: ToContent = { kind: 'fill', fieldId, value, origin }
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
