// Where the vault syncs, as Home shows it: a banner when sync stopped, and the line at the foot.
import { useEffect, useState } from 'preact/hooks'
import type { Settings, SyncPlace, SyncStatus } from '../shared/api'
import { Button, useToast } from '../shared/ui/components'
import { errorMessage, formatDateTime, hasMessage, problemMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { openSetup } from './links'
import { ask } from './send'

export const placeNames: Record<SyncPlace, string> = {
  kemlock: 'popup_placeKemlock',
  webdav: 'popup_placeWebdav',
  vaultwarden: 'popup_placeVaultwarden',
}

/** The problems a new sign-in answers; setup holds the sign-in steps, not the popup. */
export const signInProblems = [
  'signedOut',
  'auth',
  'sessionEnded',
  'sessionReused',
  'kemlockAddress',
]

/** Problems a new run may clear by itself: Sync now is offered. */
const retryProblems = ['network', 'older', 'kemlockOlder']

const placeKey = 'kemlock_sync_place'

/** The place Kemlock last synced with, kept in this browser so the lock screen can name it. */
export async function savedPlace(): Promise<SyncPlace | undefined> {
  try {
    const stored = (await chrome.storage.local.get(placeKey))[placeKey]
    return stored === 'kemlock' || stored === 'webdav' || stored === 'vaultwarden'
      ? stored
      : undefined
  } catch {
    return undefined
  }
}

export async function rememberPlace(status: SyncStatus | null): Promise<void> {
  try {
    await chrome.storage.local.set({ [placeKey]: status === null ? 'none' : status.place })
  } catch {
    // The lock screen then says nothing of where the vault syncs.
  }
}

/** `undefined` while it loads or when it can't be read; `null` when the vault doesn't sync. */
export function useSyncStatus(): [
  SyncStatus | null | undefined,
  (next: SyncStatus | null) => void,
] {
  const [status, setStatus] = useState<SyncStatus | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    ask('syncStatus').then(
      (value) => {
        if (!alive) return
        setStatus(value)
        void rememberPlace(value)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])
  return [
    status,
    (next) => {
      setStatus(next)
      void rememberPlace(next)
    },
  ]
}

/** "just now", "2 min ago", "3 h ago", or the date. */
export function agoText(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return t('popup_agoNow')
  if (minutes < 60) return t('popup_agoMinutes', minutes)
  if (minutes < 24 * 60) return t('popup_agoHours', Math.floor(minutes / 60))
  return formatDateTime(at)
}

/** What stopped sync, in the app's words, with what can be done about it from here. */
export function SyncBanner(props: {
  status: SyncStatus
  onStatus: (status: SyncStatus | null) => void
  onReview: () => void
}) {
  const { status } = props
  const say = useToast()
  const [busy, setBusy] = useState(false)
  const removals = status.problem === 'removals' || (status.pendingRemovals ?? 0) > 0
  const problem = status.problem
  if (problem === undefined && !removals) return null
  // A problem the app has no words for gets the general line, with both ways on.
  const unknown = problem !== undefined && !removals && !hasMessage(`sync_problem_${problem}`)
  const signIn = problem !== undefined && (signInProblems.includes(problem) || unknown)
  const retry = problem !== undefined && (retryProblems.includes(problem) || unknown)

  const syncNow = async () => {
    setBusy(true)
    try {
      props.onStatus(await ask('syncNow'))
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="sync-banner" role="alert">
      <Icon name="warning" size={16} weight={2} />
      <div class="grow">
        <p>
          {removals
            ? status.scopeSize !== undefined
              ? t('popup_removalsOf', status.pendingRemovals ?? 0, status.scopeSize)
              : t('popup_removalsCount', status.pendingRemovals ?? 0)
            : problemMessage(problem ?? '')}
        </p>
        <div class="actions start">
          {signIn && (
            <Button kind="warn" onClick={() => openSetup('signin')}>
              {t('popup_signInAgain')}
            </Button>
          )}
          {removals && <Button onClick={props.onReview}>{t('popup_removalsReview')}</Button>}
          {retry && (
            <Button busy={busy} onClick={() => void syncNow()}>
              {busy ? t('popup_syncing') : t('popup_syncNow')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** "Kemlock Server · synced 2 min ago", and how long until the vault locks by itself. */
export function SyncFooter(props: { status: SyncStatus | null | undefined; settings: Settings }) {
  const { status } = props
  const minutes = props.settings.autoLockMinutes
  const idle = minutes >= 60 ? t('popup_idleHours', minutes / 60) : t('popup_idleMinutes', minutes)
  let line = ''
  let tone: 'ok' | 'warn' = 'ok'
  if (status !== null && status !== undefined) {
    const place = t(placeNames[status.place])
    if (status.problem !== undefined || (status.pendingRemovals ?? 0) > 0) {
      line = t('popup_footerStopped', place)
      tone = 'warn'
    } else if (status.running) line = t('popup_footerSyncing', place)
    else if (status.lastSync === undefined) line = t('popup_footerNever', place)
    else line = t('popup_footerSynced', place, agoText(status.lastSync))
  }
  return (
    <footer class="home-foot">
      {line !== '' ? (
        <span class="sync-line">
          <span class={tone === 'warn' ? 'dot warn' : 'dot'} aria-hidden="true" />
          {line}
        </span>
      ) : (
        <span />
      )}
      <span class="idle">{t('popup_locksAfter', idle)}</span>
    </footer>
  )
}
