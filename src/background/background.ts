// The background's work: every PageApi and ContentApi method (src/shared/api.ts) on top of the core,
// and the browser's events (tabs, alarms, the right-click menu, permissions). Pages are recognised
// by their extension origin and a content script only by what the browser reports of its frame
// (design decision 4); the answers are the router's.
import type {
  CodePreview,
  CodeView,
  ContentApi,
  CoreApi,
  GeneratedPassword,
  LoginView,
  MenuView,
  PageApi,
  PageRequest,
  PendingSave,
  PopupView,
  SignInStep,
  SiteMatch,
  TabView,
} from '../shared/api'
import { parseContextTarget, type ContentMessage, type ToContent } from '../shared/messages'
import {
  chromeAutoLockHost,
  defaultAutoLockSettings,
  AutoLock,
  idleAlarm,
  beatAlarm,
} from './autolock'
import { ClipboardManager, offscreenBackend, type ClipboardBackend } from './clipboard'
import type { Deps } from './deps'
import { BackgroundError } from './errors'
import { Filler, recentKey } from './fill'
import { createMenus, menuItems, type MenuAction } from './menus'
import { forgetPick, pickedHosts } from './picks'
import { isNeverSave, mirrorPrefs, neverSave, readPrefs } from './prefs'
import type { Handlers } from './router'
import { frameAddress, type ContentSender, type ExtensionPage, type PageSender } from './senders'
import { allSitesGranted, injectContentScript, syncContentScripts } from './site-access'
import { hostOf, siteMatch } from './site'
import { SyncScheduler } from './sync'
import { keepMs, TabStore, type PendingLogin } from './tabs'
import { Toolbar } from './toolbar'
import { VaultSession } from './vault'

type PageImpl = {
  [K in keyof PageApi]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<PageApi[K]>
}
type ContentImpl = {
  [K in keyof ContentApi]: (
    message: Extract<ContentMessage, { kind: K }>,
    sender: ContentSender,
  ) => ReturnType<ContentApi[K]>
}

const pagesAndMenu: readonly ExtensionPage[] = ['popup', 'setup', 'menu']
const pages: readonly ExtensionPage[] = ['popup', 'setup']
const menuAndPopup: readonly ExtensionPage[] = ['popup', 'menu']
const menuOnly: readonly ExtensionPage[] = ['menu']

/** How long an opened menu may list and fill, and how soon a use counts again as activity. */
const menuGraceMs = 10 * 60_000
const touchEveryMs = 5000
/** The wait after a form is sent before a prompt on a page that didn't navigate. */
const promptAfterMs = 2500

const backupKey = 'kemlock_backup_used'
const unknownMatch = (site: string): SiteMatch => ({ site, logins: [], codes: [] })

export class Background {
  readonly handlers: Handlers
  private readonly filler: Filler
  private lastTouch = 0
  /** Tabs that are loading a page right now. */
  private readonly loading = new Set<number>()

  constructor(private readonly d: Deps) {
    this.filler = new Filler(d)
    this.handlers = { content: this.contentHandlers(), page: this.pageHandlers() }
  }

  /* ------------------------------------------------------------------------------------------- */
  /* Shared steps                                                                                  */
  /* ------------------------------------------------------------------------------------------- */

  private check(sender: PageSender, allowed: readonly ExtensionPage[]): void {
    if (!allowed.includes(sender.page)) throw new BackgroundError('refused')
  }

  /** The vault must be open to go on. */
  private async needOpen(): Promise<void> {
    const state = await this.d.core.state()
    if (!state.exists) throw new BackgroundError('noVault')
    if (!state.unlocked) throw new BackgroundError('locked')
  }

  /** The otpauth:// link of the QR code visible in the tab in front, with the tab's site; null when there is none. */
  private async codeOnPage(tabId: number): Promise<{ link: string; host: string | null } | null> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    // Only what the person sees in the tab in front is read
    if (tab === undefined || tab.active !== true) throw new BackgroundError('unknownField')
    let image: string
    try {
      image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    } catch {
      throw new BackgroundError('noPermission')
    }
    const link = await this.d.core.readQr(image)
    if (link === null || !link.toLowerCase().startsWith('otpauth://')) return null
    return { link, host: tab.url === undefined ? null : hostOf(tab.url) }
  }

  /** Kemlock was used: the idle time starts over (at most every few seconds). */
  private async touch(): Promise<void> {
    const now = this.d.now()
    if (now - this.lastTouch < touchEveryMs) return
    this.lastTouch = now
    await this.d.autoLock.used()
  }

  /** What opening the vault does besides the core's. */
  private async opened(): Promise<void> {
    await this.d.vault.opened()
    await mirrorPrefs(await this.d.core.settings())
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id !== undefined) void this.refreshBadge(tab.id)
  }

  /** The tab's toolbar count: of its site's matches, an orange "!" on a look-alike, none while locked. */
  async refreshBadge(tabId: number, address?: string | null): Promise<void> {
    const { core, toolbar, tabs } = this.d
    try {
      if (!(await core.state()).unlocked) return await toolbar.setBadge(tabId, null)
      address ??=
        (await chrome.tabs.get(tabId).catch(() => undefined))?.url ??
        (await tabs.get(tabId)).frames[0]?.address
      if (address === undefined || address === null) return
      const match = await siteMatch(core, address)
      await toolbar.setBadge(
        tabId,
        match.lookAlikeOf !== undefined
          ? { lookAlike: true }
          : { count: match.logins.length + match.codes.length },
      )
    } catch {
      // A tab that closed meanwhile
    }
  }

  private async tabView(tab: chrome.tabs.Tab | undefined): Promise<TabView | undefined> {
    if (tab?.id === undefined || tab.url === undefined || hostOf(tab.url) === null) return undefined
    const match = await siteMatch(this.d.core, tab.url)
    void this.refreshBadge(tab.id, tab.url)
    return { tabId: tab.id, address: tab.url, match }
  }

  /** A change was made in the browser: sync follows shortly. */
  private changed(): Promise<void> {
    return this.d.sync.changed()
  }

  /** Signed in: the first sync runs now (setup showed what it does), and the step ends with how it went. */
  private async afterSignIn(step: SignInStep): Promise<SignInStep> {
    if (step.step !== 'done') return step
    const status = await this.d.sync.run(true)
    await this.d.sync.showIcon()
    return status === null ? step : { step: 'done', status }
  }

  /** The menu a content script opened is the one that may list and fill, for its frame and field only. */
  private async authorizeMenu(
    sender: PageSender,
    tabId: number,
    frameId: number | undefined,
    fieldId: string | undefined,
  ): Promise<void> {
    if (sender.tabId !== tabId || frameId === undefined || fieldId === undefined)
      throw new BackgroundError('refused')
    const grant = (await this.d.tabs.get(tabId)).menu
    if (
      grant === undefined ||
      grant.frameId !== frameId ||
      grant.fieldId !== fieldId ||
      this.d.now() - grant.at > menuGraceMs
    )
      throw new BackgroundError('refused')
  }

  /** The menu frame may list the vault for its picker only while a menu was opened for its tab. */
  private async authorizeList(sender: PageSender): Promise<void> {
    if (sender.page !== 'menu') return
    const grant =
      sender.tabId === undefined ? undefined : (await this.d.tabs.get(sender.tabId)).menu
    if (grant === undefined || this.d.now() - grant.at > menuGraceMs)
      throw new BackgroundError('refused')
  }

  /** The prompt frame and the popup may ask about a tab; a menu frame only about its own. */
  private authorizeTab(sender: PageSender, tabId: number): void {
    if (sender.page === 'menu' && sender.tabId !== tabId) throw new BackgroundError('refused')
  }

  private async recent(): Promise<GeneratedPassword[]> {
    const { core } = this.d
    if (core.recentPasswords !== undefined) return core.recentPasswords()
    const stored = (await chrome.storage.session.get(recentKey))[recentKey]
    return Array.isArray(stored) ? (stored as GeneratedPassword[]) : []
  }

  /**
   * The next backup code of a service, marked used, and the same one for a minute: copying it and
   * marking it used, in either order, are one code and not two.
   */
  private async backupCode(serviceId: string): Promise<string> {
    const stored = (await chrome.storage.session.get(backupKey))[backupKey] as
      { serviceId: string; code: string; at: number } | undefined
    const fresh =
      stored !== undefined && stored.serviceId === serviceId && this.d.now() - stored.at < 60_000
    if (fresh) {
      // The second of the two: it takes the one the first used, and the pair is done
      await chrome.storage.session.remove(backupKey)
      return stored.code
    }
    const code = await this.d.core.useBackupCode(serviceId)
    await chrome.storage.session.set({ [backupKey]: { serviceId, code, at: this.d.now() } })
    await this.changed()
    return code
  }

  /** A saved login holds this password now, so it isn't "recently generated" any more. */
  private async forgetRecent(password: string): Promise<void> {
    if (this.d.core.recentPasswords !== undefined) return
    const stored = (await chrome.storage.session.get(recentKey))[recentKey]
    if (!Array.isArray(stored)) return
    const kept = (stored as GeneratedPassword[]).filter((p) => p.value !== password)
    await chrome.storage.session.set({ [recentKey]: kept })
  }

  private async clipboardSeconds(): Promise<number> {
    return (await this.d.core.settings()).clipboardSeconds
  }

  /* ------------------------------------------------------------------------------------------- */
  /* What the extension's pages ask                                                                */
  /* ------------------------------------------------------------------------------------------- */

  private pageHandlers(): PageImpl {
    const { core, tabs, now } = this.d
    return {
      popup: async (message, sender): Promise<PopupView> => {
        this.check(sender, pages)
        const state = await core.state()
        if (!state.unlocked) return { state }
        await this.touch()
        const active =
          message.tabId !== undefined
            ? await chrome.tabs.get(message.tabId).catch(() => undefined)
            : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        const tab = await this.tabView(active)
        return tab === undefined ? { state } : { state, tab }
      },

      createVault: async ({ password }, sender) => {
        this.check(sender, pages)
        await core.createVault(password)
        if (!(await core.state()).unlocked && !(await core.unlock(password)).ok)
          throw new BackgroundError('failed')
        await this.opened()
      },
      unlock: async ({ password }, sender) => {
        this.check(sender, pagesAndMenu)
        if (!(await core.state()).exists) throw new BackgroundError('noVault')
        const result = await core.unlock(password)
        if (result.ok) await this.opened()
        return result
      },
      lock: async (_message, sender) => {
        this.check(sender, pagesAndMenu)
        await this.d.vault.lock()
      },
      removeVault: async (_message, sender) => {
        this.check(sender, pages)
        await this.d.vault.removed()
      },

      codes: async (_message, sender) => {
        this.check(sender, pagesAndMenu)
        await this.authorizeList(sender)
        await this.needOpen()
        await this.touch()
        return core.codes()
      },
      liveCodes: async ({ ids }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await this.touch()
        return core.liveCodes(ids, now())
      },
      nextHotp: async ({ id }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        const code = await core.nextHotp(id)
        await this.changed()
        return code
      },
      logins: async (_message, sender) => {
        this.check(sender, pagesAndMenu)
        await this.authorizeList(sender)
        await this.needOpen()
        await this.touch()
        return core.logins()
      },
      saveLogin: async ({ id, input }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        const saved = await core.saveLogin(id, input)
        await this.forgetRecent(input.password)
        await this.changed()
        return saved
      },
      deleteLogin: async ({ id }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await core.deleteLogin(id)
        await this.changed()
      },
      ignoreHealth: async ({ id, ignored }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await core.ignoreHealth(id, ignored)
        await this.changed()
      },
      showPassword: async ({ id }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await this.touch()
        return (await core.revealLogin(id)).password
      },
      backupCodes: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return core.backupCodes()
      },
      health: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return core.health()
      },
      generate: async ({ options }, sender) => {
        this.check(sender, pagesAndMenu)
        await this.needOpen()
        await this.touch()
        return core.generate(options)
      },
      recentPasswords: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return this.recent()
      },

      copy: async ({ what, id, value }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await this.touch()
        let text: string | undefined
        if (what === 'username') text = (await core.revealLogin(id)).username
        else if (what === 'password') text = (await core.revealLogin(id)).password
        else if (what === 'code') text = (await core.liveCodes([id], now()))[0]?.code
        else if (what === 'backupCode') text = await this.backupCode(id)
        else text = value
        if (text === undefined || text === '') throw new BackgroundError('failed')
        await this.d.clipboard.copy(text, await this.clipboardSeconds())
      },
      fill: async (message, sender) => {
        this.check(sender, [...pagesAndMenu])
        await this.needOpen()
        const fromMenu = sender.page === 'menu'
        if (fromMenu)
          await this.authorizeMenu(sender, message.tabId, message.frameId, message.fieldId)
        await this.filler.fill(
          {
            tabId: message.tabId,
            ...(message.frameId === undefined ? {} : { frameId: message.frameId }),
            ...(message.fieldId === undefined ? {} : { fieldId: message.fieldId }),
            ...(message.loginId === undefined ? {} : { loginId: message.loginId }),
            ...(message.codeId === undefined ? {} : { codeId: message.codeId }),
            ...(message.newPassword === undefined ? {} : { newPassword: message.newPassword }),
            ...(message.remember === undefined ? {} : { remember: message.remember }),
          },
          fromMenu,
        )
      },

      addCodeFromLink: async ({ otpauth, website, linkTo }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        const code = await core.addCode(otpauth, website, linkTo)
        await this.changed()
        return code
      },
      addCodeFromTab: async ({ tabId, linkTo }, sender): Promise<CodeView | null> => {
        this.check(sender, pages)
        await this.needOpen()
        const found = await this.codeOnPage(tabId)
        if (found === null) return null
        const code = await core.addCode(found.link, found.host ?? undefined, linkTo)
        await this.changed()
        return code
      },
      readCodeFromTab: async ({ tabId }, sender): Promise<CodePreview | null> => {
        this.check(sender, pages)
        await this.needOpen()
        const found = await this.codeOnPage(tabId)
        if (found === null) return null
        const preview = await core.previewCode(found.link)
        return {
          otpauth: found.link,
          issuer: preview.issuer,
          account: preview.account,
          ...(found.host === null ? {} : { website: found.host }),
          ...(preview.existing === null ? {} : { existing: preview.existing }),
        }
      },
      nextCodes: async ({ ids }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        // What each code will show once its own period has gone by
        const periods = new Map((await core.codes()).map((code) => [code.id, code.period]))
        const byPeriod = new Map<number, string[]>()
        for (const id of ids) {
          const period = periods.get(id)
          if (period !== undefined) byPeriod.set(period, [...(byPeriod.get(period) ?? []), id])
        }
        const next = await Promise.all(
          [...byPeriod].map(([period, same]) => core.liveCodes(same, now() + period * 1000)),
        )
        return next.flat()
      },
      useBackupCode: async ({ serviceId }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await this.backupCode(serviceId)
      },
      rememberedSites: async ({ loginId }, sender) => {
        this.check(sender, pagesAndMenu)
        await this.authorizeList(sender)
        await this.needOpen()
        return pickedHosts(core, loginId)
      },
      forgetSite: async ({ loginId, host }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await forgetPick(core, host, loginId)
      },
      linkCode: async ({ codeId, loginId }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await core.linkCode(codeId, loginId)
        await this.changed()
      },

      syncStatus: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return core.syncStatus()
      },
      signInKemlock: async ({ server, email, password }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return this.afterSignIn(await core.signInKemlock({ server, email, password }))
      },
      signInWebdav: async ({ folder, username, password }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return this.afterSignIn(await core.signInWebdav({ folder, username, password }))
      },
      signInVaultwarden: async ({ server, email, password }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return this.afterSignIn(await core.signInVaultwarden({ server, email, password }))
      },
      answerStep: async ({ answer }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return this.afterSignIn(await core.answerStep(answer))
      },
      checkServer: async ({ place, server }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return core.checkServer(place, server)
      },
      securityKeyChallenge: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return core.securityKeyChallenge()
      },
      syncNow: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await this.touch()
        const status = await this.d.sync.run(true)
        if (status === null) throw new BackgroundError('failed')
        return status
      },
      confirmRemovals: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        const status = await core.confirmRemovals()
        await this.d.sync.showIcon()
        return status
      },
      signOut: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        await core.signOut()
        await this.d.sync.showIcon()
      },

      settings: async (_message, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        return core.settings()
      },
      saveSettings: async ({ settings }, sender) => {
        this.check(sender, pages)
        await this.needOpen()
        const saved = await core.saveSettings(settings)
        await mirrorPrefs(saved)
        // The idle time may be another now
        await this.d.autoLock.used()
        return saved
      },
      allSitesGranted: async (_message, sender) => {
        this.check(sender, pages)
        return syncContentScripts()
      },

      menu: async ({ tabId, frameId, fieldId }, sender): Promise<MenuView> => {
        this.check(sender, menuOnly)
        await this.authorizeMenu(sender, tabId, frameId, fieldId)
        return this.menuView(tabId, frameId, fieldId)
      },
      pendingSave: async ({ tabId }, sender): Promise<PendingSave | null> => {
        this.check(sender, menuAndPopup)
        this.authorizeTab(sender, tabId)
        const pending = (await tabs.get(tabId)).pending
        return pending === undefined ? null : this.offerFor(pending)
      },
      answerSave: async ({ tabId, save, never }, sender) => {
        this.check(sender, menuAndPopup)
        this.authorizeTab(sender, tabId)
        const pending = (await tabs.get(tabId)).pending
        if (pending === undefined) return
        await tabs.update(tabId, (state) => {
          delete state.pending
        })
        if (never === true) await neverSave(pending.host)
        if (save) await this.save(pending)
      },
    }
  }

  /** The in-page menu's list for the frame that opened it: what the site offers, or the picker. */
  private async menuView(tabId: number, frameId: number, fieldId: string): Promise<MenuView> {
    const { core } = this.d
    const frame = (await this.d.tabs.get(tabId)).frames[frameId]
    const field = frame?.fields.find((f) => f.id === fieldId)
    if (frame === undefined || field === undefined) throw new BackgroundError('unknownField')
    await this.touch()
    const state = await core.state()
    const kind = { kind: field.kind }
    const host = frame.address === null ? null : hostOf(frame.address)
    if (!state.unlocked || frame.address === null)
      return { state, match: unknownMatch(host ?? ''), logins: [], codes: [], field: kind }
    const match = await siteMatch(core, frame.address)
    const [allLogins, allCodes] = await Promise.all([core.logins(), core.codes()])
    const offered = match.logins.length + match.codes.length > 0
    const logins: LoginView[] = offered
      ? allLogins.filter((login) => match.logins.includes(login.id))
      : allLogins
    const codes: CodeView[] = offered
      ? allCodes.filter((code) => match.codes.includes(code.id))
      : allCodes
    const view: MenuView = { state, match, logins, codes, field: kind }
    if (['signedOut', 'sessionEnded'].includes(state.sync?.problem ?? '')) view.signInAgain = true
    if (field.kind === 'newPassword') {
      const siteRules = field.rules
      view.suggestions = [
        await core.generate({ mode: 'random', length: 20, ...(siteRules ? { siteRules } : {}) }),
        await core.generate({ mode: 'passphrase', words: 5, ...(siteRules ? { siteRules } : {}) }),
      ]
    }
    return view
  }

  /* ------------------------------------------------------------------------------------------- */
  /* What a content script asks                                                                    */
  /* ------------------------------------------------------------------------------------------- */

  private contentHandlers(): ContentImpl {
    const { tabs, now } = this.d
    return {
      frame: async (_message, sender) => ({ tabId: sender.tabId, frameId: sender.frameId }),

      fields: async ({ fields }, sender) => {
        const address = frameAddress(sender)
        await tabs.update(sender.tabId, (state) => {
          state.frames[sender.frameId] = {
            ...(sender.documentId === undefined ? {} : { documentId: sender.documentId }),
            url: sender.url,
            origin: sender.origin,
            address,
            fields,
          }
          if (
            state.menu?.frameId === sender.frameId &&
            !fields.some((field) => field.id === state.menu?.fieldId)
          )
            delete state.menu
        })
        const buttons = (await readPrefs()).buttonsOnPages && (await allSitesGranted())
        if (sender.frameId === 0) void this.refreshBadge(sender.tabId, address)
        void this.codeAfterPassword(sender, address, fields)
        return { buttons }
      },

      sent: async ({ username, password, newPassword }, sender) => {
        const address = frameAddress(sender)
        const host = address === null ? null : hostOf(address)
        // A sign-up sends its new password alone; a sign-in in two steps sends the username, then the
        // password, which go together when they are of one site and close in time
        const saved = newPassword !== undefined && newPassword !== '' ? newPassword : password
        if (address === null || host === null || (username === '' && saved === '')) return
        if (!(await readPrefs()).offerToSave) return
        await tabs.update(sender.tabId, (state) => {
          const before = state.pending
          const joins =
            before !== undefined &&
            before.host === host &&
            before.prompted !== true &&
            now() - before.at < keepMs
          state.pending = {
            username: username !== '' ? username : joins ? before.username : '',
            password: saved !== '' ? saved : joins ? before.password : '',
            frameId: sender.frameId,
            address,
            host,
            at: now(),
          }
        })
        // A page that doesn't go on to another (a form that vanished) is asked soon; one that
        // does, when it has loaded
        setTimeout(() => {
          if (!this.loading.has(sender.tabId)) void this.promptIfDue(sender.tabId)
        }, promptAfterMs)
      },

      openMenu: async ({ fieldId }, sender) => {
        const state = await tabs.get(sender.tabId)
        if (!state.frames[sender.frameId]?.fields.some((field) => field.id === fieldId))
          throw new BackgroundError('unknownField')
        await tabs.update(sender.tabId, (s) => {
          s.menu = { frameId: sender.frameId, fieldId, at: now() }
        })
        await this.touch()
      },
    }
  }

  /** After a login with a linked code filled: the next code field on its site offers the code. */
  private async codeAfterPassword(
    sender: ContentSender,
    address: string | null,
    fields: { id: string; kind: string }[],
  ): Promise<void> {
    const { tabs, core, now } = this.d
    try {
      const after = (await tabs.get(sender.tabId)).after
      const code = fields.find((field) => field.kind === 'code')
      if (after === undefined || code === undefined || address === null) return
      if (now() - after.at > keepMs) return await this.dropAfter(sender.tabId)
      if (!(await core.state()).unlocked) return
      if (!(await siteMatch(core, address)).logins.includes(after.loginId)) return
      await this.dropAfter(sender.tabId)
      const message: ToContent = { kind: 'openMenu', fieldId: code.id }
      await chrome.tabs.sendMessage(sender.tabId, message, { frameId: sender.frameId })
    } catch {
      // The page went on meanwhile
    }
  }

  private dropAfter(tabId: number): Promise<void> {
    return this.d.tabs.update(tabId, (state) => {
      delete state.after
    })
  }

  /* ------------------------------------------------------------------------------------------- */
  /* Saving logins (decision 10)                                                                   */
  /* ------------------------------------------------------------------------------------------- */

  /** What the vault says to a sent form: nothing, "Save to Kemlock?", or "Update in Kemlock?". */
  private async offerFor(pending: PendingLogin): Promise<PendingSave | null> {
    const { core, now } = this.d
    if (now() - pending.at > keepMs || pending.password === '') return null
    if (!(await core.state()).unlocked) return null
    if (!(await core.settings()).offerToSave || (await isNeverSave(pending.host))) return null
    const match = await core.match(pending.address)
    const site = match.site === '' ? pending.host : match.site
    const same = (await core.logins()).filter(
      (login) => match.logins.includes(login.id) && login.username === pending.username,
    )
    if (same.length === 0) return { site, username: pending.username }
    for (const login of same)
      if ((await core.revealLogin(login.id)).password === pending.password) return null
    return { site, username: pending.username, updateOf: same[0].id }
  }

  /** Saves or updates, from what the vault holds now and not from what the prompt said. */
  private async save(pending: PendingLogin): Promise<void> {
    const { core } = this.d
    await this.needOpen()
    const offer = await this.offerFor(pending)
    if (offer === null) return
    if (offer.updateOf === undefined) {
      await core.saveLogin(null, {
        name: pending.host.replace(/^www\./, ''),
        username: pending.username,
        password: pending.password,
        websites: [pending.host],
      })
    } else {
      const login = (await core.logins()).find((l) => l.id === offer.updateOf)
      if (login === undefined) return
      await core.saveLogin(login.id, {
        name: login.name,
        username: login.username,
        password: pending.password,
        websites: login.websites,
        tags: login.tags,
        ...(login.note === undefined ? {} : { note: login.note }),
      })
    }
    await this.forgetRecent(pending.password)
    await this.changed()
  }

  /** The form was sent and the page has gone on (or gone quiet): "Save to Kemlock?" if it is due. */
  private async promptIfDue(tabId: number): Promise<void> {
    const { tabs } = this.d
    const pending = (await tabs.get(tabId)).pending
    if (pending === undefined || pending.prompted === true) return
    // A first step with the username alone waits for the password
    if (this.d.now() - pending.at > keepMs || pending.password === '') return
    const state = await this.d.core.state()
    if (!state.unlocked) return
    if ((await this.offerFor(pending)) === null) {
      await tabs.update(tabId, (s) => {
        delete s.pending
      })
      return
    }
    await tabs.update(tabId, (s) => {
      if (s.pending !== undefined) s.pending.prompted = true
    })
    const message: ToContent = { kind: 'savePrompt' }
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined)
  }

  /* ------------------------------------------------------------------------------------------- */
  /* The browser's events                                                                          */
  /* ------------------------------------------------------------------------------------------- */

  /** Installed, updated, or the browser started: the right-click menu, and the script for the access held. */
  async setup(): Promise<void> {
    await createMenus()
    await syncContentScripts()
  }

  async onAlarm(alarm: { name: string }): Promise<void> {
    if (alarm.name === idleAlarm || alarm.name === beatAlarm)
      await this.d.autoLock.alarm(alarm.name)
    await this.d.sync.alarm(alarm.name)
    await this.d.clipboard.alarm(alarm.name)
  }

  onIdle(state: string): Promise<void> {
    return this.d.autoLock.idleState(state)
  }

  async onTabUpdated(tabId: number, change: { status?: string; url?: string }): Promise<void> {
    if (change.status === 'loading') {
      this.loading.add(tabId)
      // Another page: what its frames reported before is not its any more
      if (change.url !== undefined) await this.d.tabs.forgetFrames(tabId)
    } else if (change.status === 'complete') {
      this.loading.delete(tabId)
      void this.refreshBadge(tabId)
      await this.promptIfDue(tabId)
    }
  }

  onTabActivated(tabId: number): Promise<void> {
    return this.refreshBadge(tabId)
  }

  async onTabRemoved(tabId: number): Promise<void> {
    this.loading.delete(tabId)
    await this.d.tabs.remove(tabId)
  }

  /** The permissions changed: the content script follows the access to all sites. */
  async onPermissionsChanged(): Promise<void> {
    await syncContentScripts()
  }

  /** A right-click menu item was used on an editable field. */
  async onMenuClicked(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
    const item = menuItems[String(info.menuItemId)]
    const tabId = tab?.id
    if (item === undefined || tabId === undefined) return
    const frameId = info.frameId ?? 0
    const url = frameId === 0 ? (info.frameUrl ?? info.pageUrl ?? tab?.url) : info.frameUrl
    try {
      await this.rightClick(item.action, tabId, frameId, url)
    } catch {
      // The page went on, or isn't one the script can enter
    }
  }

  /** Asks the frame which field the right-click was on, giving it the script first if it has none. */
  private async askTarget(tabId: number, frameId: number) {
    const ask = async () =>
      parseContextTarget(
        await chrome.tabs.sendMessage(tabId, { kind: 'contextTarget' } satisfies ToContent, {
          frameId,
        }),
      )
    try {
      return await ask()
    } catch {
      // No script in the frame yet: the click gave the tab to activeTab, so it goes in now
      await injectContentScript(tabId, [frameId])
      return ask()
    }
  }

  private async rightClick(
    action: MenuAction,
    tabId: number,
    frameId: number,
    url: string | undefined,
  ): Promise<void> {
    const { core, tabs } = this.d
    const target = await this.askTarget(tabId, frameId)
    if (target === null) return
    const address = url === undefined ? null : frameAddress({ url, origin: null })
    // The frame knows this field now, so a fill may name it
    await tabs.update(tabId, (state) => {
      const known = state.frames[frameId]
      const frame =
        known !== undefined && known.address === address
          ? known
          : { url: url ?? '', origin: null, address, fields: [] }
      frame.fields = [
        ...frame.fields.filter((field) => field.id !== target.fieldId),
        {
          id: target.fieldId,
          kind: target.kind,
          ...(target.boxes === undefined ? {} : { boxes: target.boxes }),
          ...(target.rules === undefined ? {} : { rules: target.rules }),
        },
      ]
      state.frames[frameId] = frame
    })
    const openMenu = () =>
      chrome.tabs.sendMessage(
        tabId,
        { kind: 'openMenu', fieldId: target.fieldId } satisfies ToContent,
        {
          frameId,
        },
      )
    if (!(await core.state()).unlocked) return void (await openMenu())
    await this.touch()
    const match = await siteMatch(core, address)
    const base = { tabId, frameId, fieldId: target.fieldId }
    try {
      if (action === 'login' && match.logins.length === 1)
        return await this.filler.fill({ ...base, loginId: match.logins[0] }, false)
      if (action === 'code' && match.codes.length === 1)
        return await this.filler.fill({ ...base, codeId: match.codes[0] }, false)
      if (action === 'newPassword') {
        const newPassword = await core.generate({
          mode: 'random',
          length: 20,
          ...(target.rules ? { siteRules: target.rules } : {}),
        })
        return await this.filler.fill({ ...base, newPassword }, false)
      }
    } catch {
      // The fill refused: the menu lets the person pick
    }
    await openMenu()
  }
}

/** The pieces the background is made of, around a core. */
export interface BackgroundOptions {
  now?: () => number
  /** Where the clipboard is: the offscreen document (Chrome, Edge) unless told otherwise (Firefox). */
  clipboard?: ClipboardBackend
}

/** Builds the background over the core and takes an open vault back from the session. */
export async function createBackground(
  core: CoreApi,
  options: BackgroundOptions = {},
): Promise<Background> {
  const now = options.now ?? (() => Date.now())
  const toolbar = new Toolbar()
  const tabs = new TabStore()
  const sync = new SyncScheduler(core, toolbar, now)
  const backend = options.clipboard ?? offscreenBackend()
  const clipboard = new ClipboardManager(backend, now)
  const vault = new VaultSession(core, toolbar, sync, tabs)
  const autoLock = new AutoLock(
    chromeAutoLockHost,
    async () => {
      try {
        const settings = await core.settings()
        return { idleMinutes: settings.autoLockMinutes, lockOnSleep: settings.lockOnSleep }
      } catch {
        return defaultAutoLockSettings
      }
    },
    () => vault.lock(),
  )
  vault.autoLock = autoLock
  await vault.restore()
  return new Background({ core, tabs, toolbar, sync, clipboard, autoLock, vault, now })
}
