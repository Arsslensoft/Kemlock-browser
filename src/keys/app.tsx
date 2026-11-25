// The keys tab's page: the keys screens when the vault is open, and, when it is locked, where to unlock it (the popup is where
// the password is typed; this page has no lock screen of its own).
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { VaultState } from '../shared/api'
import { KemlockIcon } from '../shared/brand/brand'
import { Button, Notice } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { KeysScreen } from '../popup/keys'
import { routeFromHash } from '../popup/keys/route'
import { ask, lockedEvent } from '../popup/send'
import { useVaultLock } from '../shared/vault-lock'

export function KeysTab() {
  const [state, setState] = useState<VaultState | undefined>()
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    try {
      setState(await ask('keysState'))
      setError(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  // The vault locked: the screens go, with what they held (a revealed key, a decrypted text), before anything else is asked
  useVaultLock(
    () => {
      setState((previous) => (previous === undefined ? previous : { ...previous, unlocked: false }))
      void refresh()
    },
    async () => (await ask('keysState')).unlocked,
  )

  useEffect(() => {
    void refresh()
    // A call the background refused because the vault locked meanwhile (auto-lock, sleep)
    window.addEventListener(lockedEvent, refresh)
    return () => window.removeEventListener(lockedEvent, refresh)
  }, [refresh])

  if (state === undefined) {
    return error !== undefined ? (
      <main class="screen pad">
        <Notice kind="error">{error}</Notice>
      </main>
    ) : (
      <div class="screen pad muted" role="status">
        {t('popup_loading')}
      </div>
    )
  }

  if (!state.exists || !state.unlocked) {
    return (
      <main class="screen pad keys-locked">
        <KemlockIcon size={36} />
        <h1>{t('keys_tabLockedTitle')}</h1>
        <p class="muted">{state.exists ? t('keys_tabLocked') : t('keys_tabNoVault')}</p>
        <Button kind="primary" onClick={() => void refresh()}>
          {t('keys_tabTryAgain')}
        </Button>
      </main>
    )
  }

  return <KeysScreen start={routeFromHash(location.hash)} />
}
