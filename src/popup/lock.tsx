// The lock screen: nothing of the vault shows here, only the password, and how many wrong tries.
import { useState } from 'preact/hooks'
import type { VaultState } from '../shared/api'
import { Button, Confirm, Notice, TextField } from '../shared/ui/components'
import { errorMessage, formatDateTime, t } from '../shared/ui/i18n'
import { openSetup } from './links'
import { ask } from './send'

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
      <Button kind="ghost" onClick={() => setAsking(true)}>
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [wrong, setWrong] = useState(state.wrongPasswords)
  const [lastAt, setLastAt] = useState(state.lastWrongAt)

  if (!state.exists) {
    return (
      <main class="lock">
        <h1>{t('extName')}</h1>
        <p class="muted">{t('popup_noVault')}</p>
        <Button kind="primary" onClick={() => openSetup()}>
          {t('popup_setUp')}
        </Button>
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
    <main class="lock">
      <h1>{t('extName')}</h1>
      <p class="muted">{t('popup_locked')}</p>
      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault()
          void unlock()
        }}
      >
        <TextField
          label={t('popup_vaultPassword')}
          type="password"
          value={password}
          autocomplete="current-password"
          autofocus
          invalid={error !== undefined}
          onInput={setPassword}
        />
        {error !== undefined && <Notice kind="error">{error}</Notice>}
        {wrong > 0 && <Notice kind="warn">{wrongTriesText(wrong, lastAt)}</Notice>}
        <Button kind="primary" type="submit" busy={busy} disabled={password === ''}>
          {busy ? t('popup_unlocking') : t('popup_unlock')}
        </Button>
      </form>
      <p class="muted small">{t('popup_forgot')}</p>
      <RemoveKemlock onRemoved={props.onRemoved} />
    </main>
  )
}
