// The account's own calls and the approval watcher (docs/plans/add-browser-account.md).
//
// Calls: one `account` page message with the op inside. Only the extension's own pages may send it (the sender is the browser's, never
// the message's), the vault must be open, and the core does the rest. Approving a device, confirming an emergency contact and showing
// a recovery code are each the person's own click on an extension page: the phone asks its owner to show it is them, and this is what
// the browser has in its place.
//
// Watcher: the account's other devices ask to sign in at any time. The live socket can't carry that to a browser (it authenticates its
// upgrade with headers that a browser's WebSocket can't set), so an alarm reads the open requests every minute while the vault is open,
// and each request the person hasn't been told of raises a notification that opens the account page.
import type {
  AccountOp,
  AccountRequest,
  AccountResult,
  ApprovalView,
  MoveStatus,
} from '../shared/account'
import type { SignInStep } from '../shared/api'
import type { Deps } from './deps'
import { BackgroundError } from './errors'
import type { ExtensionPage, PageSender } from './senders'

/** The alarm that reads the open requests every minute; the sync scheduler sets it with its own while the vault is open (sync.ts). */
export const approvalsAlarm = 'kemlock-approvals'
const seenKey = 'kemlock_approvals_seen'
const notificationPrefix = 'kemlock-approval:'

/** The pages that may use the account's calls: the popup, setup (making an account, the move) and the account page. */
const allowed: readonly ExtensionPage[] = ['popup', 'setup', 'account']

/** Ops that change what the first sync does, so the toolbar's icon is read again after them. */
const changesSync: ReadonlySet<AccountOp> = new Set(['register', 'moveCancel'])

/** The text of one of the account strings, or its name when the browser lacks it. */
function message(name: string, ...subs: string[]): string {
  const text = chrome.i18n.getMessage(name, subs)
  return text === '' || text === undefined ? name : text
}

export class AccountManager {
  constructor(private readonly d: Deps) {}

  /** The account page's address, at the section [hash] names. */
  static pageUrl(hash = ''): string {
    return chrome.runtime.getURL(`src/account/index.html${hash === '' ? '' : `#${hash}`}`)
  }

  /* ------------------------------------------------------------------------------------------- */
  /* The calls                                                                                     */
  /* ------------------------------------------------------------------------------------------- */

  async handle(request: AccountRequest, sender: PageSender): Promise<AccountResult> {
    if (!allowed.includes(sender.page)) throw new BackgroundError('refused')
    const state = await this.d.core.state()
    if (!state.exists) throw new BackgroundError('noVault')
    if (!state.unlocked) throw new BackgroundError('locked')
    const { core } = this.d
    if (core.account === undefined) throw new BackgroundError('unsupported')
    const answer = await core.account(request)
    switch (request.op) {
      case 'register':
        return this.afterSignIn(answer as SignInStep)
      case 'approve':
      case 'deny':
        await this.forget(request.id)
        return answer
      default:
        if (changesSync.has(request.op)) await this.d.sync.showIcon()
        return answer
    }
  }

  /** Signed in: the first sync runs now, and the step ends with how it went (as the sign-ins of the sync do). */
  private async afterSignIn(step: SignInStep): Promise<SignInStep> {
    if (step.step !== 'done') return step
    const status = await this.d.sync.run(true)
    await this.d.sync.showIcon()
    return status === null ? step : { step: 'done', status }
  }

  /* ------------------------------------------------------------------------------------------- */
  /* The approval watcher                                                                          */
  /* ------------------------------------------------------------------------------------------- */

  async alarm(name: string): Promise<void> {
    if (name === approvalsAlarm) await this.check()
  }

  /** The requests that are open now, or none when the vault is locked, doesn't sync with Kemlock Server, or the server can't be asked. */
  async pending(): Promise<ApprovalView[]> {
    const { core } = this.d
    if (core.account === undefined) return []
    try {
      if (!(await core.state()).unlocked) return []
      if ((await core.syncStatus())?.place !== 'kemlock') return []
      const answer = (await core.account({ op: 'approvals' })) as { approvals: ApprovalView[] }
      return answer.approvals
    } catch {
      return []
    }
  }

  /** Tells the person of each request they haven't been told of. */
  async check(): Promise<void> {
    const open = await this.pending()
    const stored = (await chrome.storage.session.get(seenKey))[seenKey] as unknown
    const seen = new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [])
    for (const approval of open) {
      if (seen.has(approval.id)) continue
      await this.notify(approval)
    }
    // What is still open stays told of; what ended is forgotten, with its notification
    for (const id of seen) {
      if (!open.some((approval) => approval.id === id))
        await chrome.notifications?.clear(`${notificationPrefix}${id}`).catch(() => undefined)
    }
    await chrome.storage.session.set({ [seenKey]: open.map((approval) => approval.id) })
    await this.resumeMove()
  }

  /**
   * A move the core was stopped in the middle of (the worker is stopped after a while with nobody asking, and a browser restarts) goes
   * on from the step its record names, at the next minute of the alarm. A move that failed, one that waits for the person, and one that
   * runs are left alone; a failure is forgotten with the core that had it, so each start tries once.
   */
  private async resumeMove(): Promise<void> {
    const { core } = this.d
    if (core.account === undefined) return
    try {
      if (!(await core.state()).unlocked) return
      const status = (await core.account({ op: 'moveStatus' })) as MoveStatus
      if (status.running || status.held || status.finished || !status.offered) return
      if (status.step === undefined || status.problem !== undefined) return
      await core.account({ op: 'moveStart' })
    } catch {
      // The next minute asks again
    }
  }

  private async notify(approval: ApprovalView): Promise<void> {
    await chrome.notifications
      ?.create(`${notificationPrefix}${approval.id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/kemlock-128.png'),
        title: message('account_notice_title'),
        message: message('account_notice_body', approval.deviceName),
        priority: 2,
      })
      .catch(() => undefined)
  }

  /** A request was answered here: its notification goes, and it isn't told of again. */
  private async forget(id: string): Promise<void> {
    await chrome.notifications?.clear(`${notificationPrefix}${id}`).catch(() => undefined)
    const stored = (await chrome.storage.session.get(seenKey))[seenKey] as unknown
    if (Array.isArray(stored))
      await chrome.storage.session.set({ [seenKey]: stored.filter((seen) => seen !== id) })
  }

  /** A notification was clicked: the account page opens at the approvals. */
  async notificationClicked(id: string): Promise<void> {
    if (!id.startsWith(notificationPrefix)) return
    await chrome.notifications?.clear(id).catch(() => undefined)
    await chrome.tabs.create({ url: AccountManager.pageUrl('approvals') })
  }
}
