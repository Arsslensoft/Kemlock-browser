// The account page: one tab for what the account does beyond syncing. A page of its own because the popup closes when a tab opens, a kit
// is printed from a tab, and a request to approve may arrive while neither is open (a notification opens it here).
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { ApprovalView } from '../shared/account'
import { Wordmark } from '../shared/brand/brand'
import { Button, Notice, Tabs } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { useVaultLock } from '../shared/vault-lock'
import { ApprovalsPanel } from './approvals'
import { DevicesPanel } from './devices'
import { EmergencyPanel } from './emergency'
import { describe, gateCodes } from './errors'
import { MovePanel, openSetup } from './move'
import { RecoveryPanel } from './recovery'
import { SecondStepsPanel } from './second-steps'
import { account, codeOf, vaultIsOpen } from './send'

export const tabIds = ['approvals', 'devices', 'emergency', 'recovery', 'steps', 'move'] as const
export type TabId = (typeof tabIds)[number]

/** How often the open requests are read while the page is open, in milliseconds. */
export const approvalsEvery = 5000

/** The tab a page address names (`#approvals`), or the first. */
export function tabOf(hash: string): TabId {
  const name = hash.replace(/^#/, '')
  return tabIds.find((id) => id === name) ?? 'approvals'
}

/** What to do when the page can't be used as it stands: the words, and the way forward. */
function Gate({ code, retry }: { code: string; retry: () => void }) {
  return (
    <div class="gate">
      <Notice kind="warn">{describe(code)}</Notice>
      <div class="actions start">
        {code === 'notKemlock' || code === 'noVault' ? (
          <Button kind="primary" onClick={() => openSetup('again')}>
            {t('account_gate_setUp')}
          </Button>
        ) : null}
        {code === 'sessionEnded' ? (
          <Button kind="primary" onClick={() => openSetup('signin')}>
            {t('account_gate_signIn')}
          </Button>
        ) : null}
        <Button onClick={retry}>{t('account_gate_retry')}</Button>
      </div>
    </div>
  )
}

function Panel({
  tab,
  approvals,
  reload,
}: {
  tab: TabId
  approvals?: ApprovalView[]
  reload: () => Promise<void>
}) {
  switch (tab) {
    case 'approvals':
      return <ApprovalsPanel approvals={approvals} reload={reload} />
    case 'devices':
      return <DevicesPanel />
    case 'emergency':
      return <EmergencyPanel />
    case 'recovery':
      return <RecoveryPanel />
    case 'steps':
      return <SecondStepsPanel />
    case 'move':
      return <MovePanel />
  }
}

export function App() {
  const [tab, setTab] = useState<TabId>(() => tabOf(window.location.hash))
  const [approvals, setApprovals] = useState<ApprovalView[] | undefined>(undefined)
  const [gate, setGate] = useState<string | null>(null)

  const poll = useCallback(async () => {
    try {
      setApprovals((await account('approvals')).approvals)
      setGate(null)
    } catch (error) {
      const code = codeOf(error)
      if (gateCodes.has(code)) setGate(code)
    }
  }, [])

  // The vault locked: the panels go with what they held (a recovery code, a kit being made, an approval) and the page shows its way
  // forward, without waiting for the next poll. The check is for a page that missed the message.
  useVaultLock(() => {
    setApprovals(undefined)
    setGate('locked')
  }, vaultIsOpen)

  useEffect(() => {
    document.title = t('account_pageTitle')
    void poll()
    const timer = setInterval(() => void poll(), approvalsEvery)
    const onHash = () => setTab(tabOf(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => {
      clearInterval(timer)
      window.removeEventListener('hashchange', onHash)
    }
  }, [poll])

  const select = (id: string) => {
    window.location.hash = id
    setTab(tabOf(id))
  }

  return (
    <div class="account-page">
      <header class="top no-print">
        <Wordmark height={18} />
        <span class="grow" />
        <span class="muted small">{t('account_pageTitle')}</span>
      </header>
      <main class="account-main">
        {gate !== null ? (
          <Gate code={gate} retry={() => void poll()} />
        ) : (
          <>
            <div class="no-print">
              <Tabs
                label={t('account_tabs')}
                selected={tab}
                onSelect={select}
                tabs={[
                  {
                    id: 'approvals',
                    label: t('account_tab_approvals'),
                    ...(approvals !== undefined && approvals.length > 0
                      ? { count: approvals.length }
                      : {}),
                  },
                  { id: 'devices', label: t('account_tab_devices') },
                  { id: 'emergency', label: t('account_tab_emergency') },
                  { id: 'recovery', label: t('account_tab_recovery') },
                  { id: 'steps', label: t('account_tab_steps') },
                  { id: 'move', label: t('account_tab_move') },
                ]}
              />
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} class="panel">
              <Panel tab={tab} approvals={approvals} reload={poll} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
