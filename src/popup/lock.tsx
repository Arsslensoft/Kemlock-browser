// The lock screen: nothing of the vault shows here, only the password, and how many wrong tries.
import { useEffect, useState } from 'preact/hooks'
import type { SyncPlace, VaultState } from '../shared/api'
import { KemlockIcon, Wordmark } from '../shared/brand/brand'
import { Button, Confirm, IconButton, Notice, TextField } from '../shared/ui/components'
import { errorMessage, formatDateTime, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { openSetup } from './links'
import { ask } from './send'
import { placeNames, savedPlace } from './sync-state'
import { PasskeyUnlockButton } from './unlock-card'

export function wrongTriesText(count: number, at: number | undefined): string {
  if (at === undefined) return t('popup_wrongCount', count)
  const when = formatDateTime(at)
  if (count === 1) return t('popup_wrongOne', when)
  return t('popup_wrongMany', count, when)
}

/** Removing the browser's vault, asked in place: used here and in Settings. */
export function RemoveKemlock(props: { onRemoved: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  if (!asking) {
    return (
      <Button kind="ghost" class="danger" onClick={() => setAsking(true)}>
        {t('popup_removeKemlock')}
      </Button>
    )
  }
  return (
    <div class="stack">
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <Confirm
        title={t('popup_removeTitle')}
        body={t('popup_removeBody')}
        confirmLabel={t('popup_removeConfirm')}
        cancelLabel={t('popup_cancel')}
        danger
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() =>
          void (async () => {
            setBusy(true)
            try {
              await ask('removeVault')
              openSetup()
              props.onRemoved()
            } catch (failure) {
              setError(errorMessage(failure))
              setBusy(false)
              setAsking(false)
            }
          })()
        }
      />
    </div>
  )
}

export function LockScreen(props: {
  state: VaultState
  /** The vault opened; `wrongBefore` is how many wrong tries it had seen. */
  onUnlocked: (wrongBefore: number) => void
  onRemoved: () => void
}) {
  const { state } = props
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [wrong, setWrong] = useState(state.wrongPasswords)
  const [lastAt, setLastAt] = useState(state.lastWrongAt)
  const [place, setPlace] = useState<SyncPlace | undefined>(state.sync?.place)

  // Where the vault syncs isn't known while it is sealed: the popup remembers it from the last time it was open.
  useEffect(() => {
    let alive = true
    void savedPlace().then(
      (saved) => alive && saved !== undefined && setPlace((now) => now ?? saved),
    )
    return () => {
      alive = false
    }
  }, [])

  const head = (
    <>
      <div class="lock-mark">
        <KemlockIcon size={64} />
      </div>
      <h1 class="lock-name">
        <Wordmark height={24} />
      </h1>
    </>
  )

  if (!state.exists) {
    return (
      <main class="screen lock">
        <div class="lock-top">
          {head}
          <p class="lock-text">{t('popup_noVault')}</p>
        </div>
        <div class="lock-actions">
          <Button kind="primary" tall onClick={() => openSetup()}>
            {t('popup_setUp')}
          </Button>
        </div>
      </main>
    )
  }

  const unlock = async () => {
    if (password === '') return
    setBusy(true)
    setError(undefined)
    try {
      const result = await ask('unlock', { password })
      if (result.ok) {
        setPassword('')
        props.onUnlocked(Math.max(wrong, state.wrongPasswords))
        return
      }
      setWrong(result.wrongPasswords)
      setLastAt(Date.now())
      setError(t('popup_wrongPassword'))
      setPassword('')
    } catch (failure) {
      setError(errorMessage(failure))
    }
    setBusy(false)
  }

  return (
    <main class="screen lock">
      <div class="lock-top">
        {head}
        <p class="lock-text">{t('popup_locked')}</p>
        {place !== undefined && (
          <span class="lock-pill">
            <Icon name="server" size={14} weight={2} />
            {t('popup_syncPlace')} {t(placeNames[place])}
          </span>
        )}
      </div>
      <form
        class="lock-form"
        onSubmit={(event) => {
          event.preventDefault()
          void unlock()
        }}
      >
        <PasskeyUnlockButton />
        <TextField
          label={t('popup_vaultPassword')}
          type={shown ? 'text' : 'password'}
          value={password}
          autocomplete="current-password"
          autofocus
          invalid={error !== undefined}
          onInput={setPassword}
          trailing={
            <IconButton
              icon={shown ? 'eyeOff' : 'eye'}
              label={shown ? t('popup_hide') : t('popup_show')}
              pressed={shown}
              onClick={() => setShown(!shown)}
            />
          }
        />
        {error !== undefined && <Notice kind="error">{error}</Notice>}
        {wrong > 0 && <Notice kind="warn">{wrongTriesText(wrong, lastAt)}</Notice>}
        <Button kind="primary" tall type="submit" busy={busy} disabled={password === ''}>
          {busy ? t('popup_unlocking') : t('popup_unlock')}
        </Button>
      </form>
      <p class="lock-forgot">{t('popup_forgot')}</p>
      <div class="lock-remove">
        <RemoveKemlock onRemoved={props.onRemoved} />
      </div>
    </main>
  )
}
