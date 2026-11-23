// The browser's own vault: its password (typed twice, with the app's strength meter), unlocking it
// to set up again, removing Kemlock from the browser, and the end of setup.
import { useState } from 'preact/hooks'
import type { SyncStatus } from '../shared/api'
import type { FlowState } from './flow'
import { progressOf } from './flow'
import { t } from './i18n'
import { ask } from './send'
import { canMakeVault, checks, passwordScore, passwordStrength } from './strength'
import { Actions, Alert, Frame, PasswordField, Status, useBusy, type Dispatch } from './ui'

interface Props {
  state: FlowState
  dispatch: Dispatch
}

const levels = ['veryweak', 'weak', 'fair', 'strong', 'verystrong']

/** The app's meter: five bars, and the level in words read out as it changes. */
function Strength({ password }: { password: string }) {
  const { level, bars } = passwordStrength(password)
  const { passed } = passwordScore(password)
  return (
    <div class="strength">
      <div class="bars" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((bar) => (
          <span key={bar} class={bar < bars ? `bar on level-${level}` : 'bar'} />
        ))}
      </div>
      <p class="level-name" role="status" aria-live="polite">
        {password === '' ? '' : t(`setup_strength_${levels[level]}`)}
      </p>
      <ul class="checks">
        {checks.map((check, i) => (
          <li key={check} class={passed[i] ? 'met' : undefined}>
            <span aria-hidden="true">{passed[i] ? '✓' : '○'}</span>
            <span>{t(`setup_check_${check}`)}</span>
            <span class="sr-only">{passed[i] ? t('setup_check_met') : t('setup_check_unmet')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** First run: "A password for this browser", and the vault made under it. */
export function PasswordScreen({ state, dispatch }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, run] = useBusy(dispatch)
  const mismatch = confirm !== '' && password !== confirm

  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || !canMakeVault(password, confirm)) return
    void run(async () => {
      await ask('createVault', { password })
      setPassword('')
      setConfirm('')
      dispatch({ type: 'created' })
    })
  }

  return (
    <Frame
      title={t('setup_password_title')}
      lead={t('setup_password_lead')}
      progress={progressOf(state)}
      error={state.error}
    >
      <form onSubmit={submit} noValidate>
        <PasswordField
          label={t('setup_password_field')}
          value={password}
          onInput={setPassword}
          autoComplete="new-password"
          disabled={busy}
          required
        />
        <Strength password={password} />
        <PasswordField
          label={t('setup_password_confirm')}
          value={confirm}
          onInput={setConfirm}
          autoComplete="new-password"
          disabled={busy}
          required
          error={mismatch ? t('setup_password_mismatch') : null}
        />
        {confirm !== '' && !mismatch ? <Status>{t('setup_password_match')}</Status> : null}
        <p class="hint">{t('setup_password_forgot')}</p>
        <p class="hint">{t('setup_password_footnote')}</p>
        {busy ? <Status>{t('setup_password_sealing')}</Status> : null}
        <Actions>
          <button type="submit" class="primary" disabled={busy || !canMakeVault(password, confirm)}>
            {t('setup_password_button')}
          </button>
        </Actions>
      </form>
    </Frame>
  )
}

/** Setting up again with the browser's vault locked: its password first. */
export function UnlockScreen({ state, dispatch }: Props) {
  const [password, setPassword] = useState('')
  const [busy, run] = useBusy(dispatch)
  const wrong = state.screen.name === 'unlock' ? state.screen.wrongPasswords : 0

  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || password === '') return
    void run(async () => {
      const result = await ask('unlock', { password })
      setPassword('')
      if (result.ok) dispatch({ type: 'unlocked' })
      else dispatch({ type: 'wrongPassword', wrongPasswords: result.wrongPasswords })
    })
  }

  return (
    <Frame title={t('setup_unlock_title')} lead={t('setup_unlock_lead')} error={state.error}>
      <form onSubmit={submit} noValidate>
        <PasswordField
          label={t('setup_unlock_field')}
          value={password}
          onInput={setPassword}
          autoComplete="current-password"
          disabled={busy}
          required
        />
        {wrong > 0 ? <Alert>{t('setup_unlock_wrong', wrong)}</Alert> : null}
        <Actions>
          <button type="submit" class="primary" disabled={busy || password === ''}>
            {t('setup_unlock_button')}
          </button>
        </Actions>
      </form>
    </Frame>
  )
}

/** "Remove Kemlock from this browser", with its confirmation. */
export function RemoveScreen({ state, dispatch }: Props) {
  const [busy, run] = useBusy(dispatch)
  const remove = () =>
    void run(async () => {
      await ask('removeVault')
      dispatch({ type: 'removed' })
    })
  return (
    <Frame title={t('setup_remove_title')} lead={t('setup_remove_lead')} error={state.error}>
      <ul class="plain">
        <li>{t('setup_remove_deletes')}</li>
        <li>{t('setup_remove_forgets')}</li>
        <li>{t('setup_remove_keeps')}</li>
        <li>{t('setup_remove_recover')}</li>
      </ul>
      <Actions>
        <button type="button" class="danger" disabled={busy} onClick={remove}>
          {t('setup_remove_button')}
        </button>
        <button type="button" class="secondary" disabled={busy} onClick={() => window.close()}>
          {t('setup_remove_cancel')}
        </button>
      </Actions>
      {busy ? <Status>{t('setup_remove_busy')}</Status> : null}
    </Frame>
  )
}

/** After removing: the browser is empty, and setup can start over. */
export function RemovedScreen({ dispatch }: Props) {
  return (
    <Frame title={t('setup_removed_title')} lead={t('setup_removed_lead')}>
      <Actions>
        <button type="button" class="primary" onClick={() => dispatch({ type: 'restart' })}>
          {t('setup_removed_again')}
        </button>
      </Actions>
    </Frame>
  )
}

function Summary({ status }: { status: SyncStatus }) {
  const places = {
    kemlock: 'setup_place_kemlock',
    webdav: 'setup_place_webdav',
    vaultwarden: 'setup_place_vaultwarden',
  } as const
  return (
    <dl class="summary">
      <dt>{t('setup_done_place')}</dt>
      <dd>{t(places[status.place] ?? 'setup_place_kemlock')}</dd>
      <dt>{t('setup_done_server')}</dt>
      <dd>{status.server}</dd>
      {status.account ? (
        <>
          <dt>{t('setup_done_account')}</dt>
          <dd>{status.account}</dd>
        </>
      ) : null}
      {status.deviceName ? (
        <>
          <dt>{t('setup_done_device')}</dt>
          <dd>{status.deviceName}</dd>
        </>
      ) : null}
    </dl>
  )
}

/** The end: what is synced, and what to do next (pin the extension, open the popup). */
export function DoneScreen({ state }: Props) {
  const status = state.screen.name === 'done' ? state.screen.status : null
  const [hint, setHint] = useState(false)
  const loginsStay = status?.place === 'vaultwarden' || status?.loginsNotSynced === true

  const open = () => {
    try {
      const opened = chrome.action.openPopup()
      Promise.resolve(opened).catch(() => setHint(true))
    } catch {
      setHint(true)
    }
  }

  return (
    <Frame
      title={status ? t('setup_done_title') : t('setup_done_title_alone')}
      lead={status ? t('setup_done_lead') : t('setup_done_lead_alone')}
    >
      {status ? <Summary status={status} /> : null}
      {loginsStay ? <p class="note">{t('setup_logins_stay')}</p> : null}
      <h2>{t('setup_next_title')}</h2>
      <ol class="next">
        <li>{t('setup_next_pin')}</li>
        <li>{t('setup_next_open')}</li>
        {status ? <li>{t('setup_next_sync')}</li> : null}
      </ol>
      <Actions>
        <button type="button" class="primary" onClick={open}>
          {t('setup_next_button')}
        </button>
        <button type="button" class="secondary" onClick={() => window.close()}>
          {t('setup_next_close')}
        </button>
      </Actions>
      {hint ? <Status>{t('setup_next_hint')}</Status> : null}
    </Frame>
  )
}
