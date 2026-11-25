// What the sync card adds for the account (docs/plans/add-browser-account.md): the way to the account page, with the devices waiting to
// be approved, and, on Vaultwarden or WebDAV, the way to move the vault into Kemlock Server. The page opens in a tab, since the popup
// closes when one does.
import { useEffect, useState } from 'preact/hooks'
import { account } from '../account/send'
import type { SyncPlace } from '../shared/api'
import { Button, Notice } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { openSetup } from './links'

/** The account page, at the section [hash] names. */
export function openAccount(hash = ''): void {
  const url = chrome.runtime.getURL(`src/account/index.html${hash === '' ? '' : `#${hash}`}`)
  void chrome.tabs.create({ url })
}

/** How many devices wait to be approved, or 0 when that can't be read (the vault doesn't sync with Kemlock Server, the server is away). */
async function waiting(): Promise<number> {
  try {
    return (await account('approvals')).approvals.length
  } catch {
    return 0
  }
}

export function AccountActions({ place, problem }: { place: SyncPlace; problem?: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (place !== 'kemlock') return
    let live = true
    void waiting().then((found) => {
      if (live) setCount(found)
    })
    return () => {
      live = false
    }
  }, [place])

  if (place !== 'kemlock')
    return (
      <div class="actions start">
        <Button onClick={() => openSetup('again')}>{t('account_popup_move')}</Button>
      </div>
    )
  return (
    <>
      {problem === 'moveUnfinished' ? (
        <div class="actions start">
          <Button kind="warn" onClick={() => openAccount('move')}>
            {t('account_popup_moveContinue')}
          </Button>
        </div>
      ) : null}
      {count > 0 ? (
        <Notice kind="warn">
          <p>{t('account_popup_waiting', count)}</p>
          <div class="actions start">
            <Button kind="warn" onClick={() => openAccount('approvals')}>
              {t('account_popup_review')}
            </Button>
          </div>
        </Notice>
      ) : null}
      <div class="actions start">
        <Button onClick={() => openAccount()}>{t('account_popup_open')}</Button>
      </div>
    </>
  )
}
