// The steps a sign-in asks after the form: a second step (with a security key on the server's own
// address), an approval from another device, the master password, a Vaultwarden home, a sync
// passphrase, and the first sync shown before it runs.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { SecondMethod, SignInStep, StepAnswer } from '../shared/api'
import type { FlowState } from './flow'
import { t, tCount } from './i18n'
import { placeName } from './placeScreens'
import { ask } from './send'
import { askSecurityKey, otherAddress } from './securityKey'
import {
  Actions,
  Alert,
  Checkbox,
  Field,
  Frame,
  Note,
  PasswordField,
  Status,
  Tile,
  useBusy,
  type Dispatch,
} from './ui'

interface Props {
  state: FlowState
  dispatch: Dispatch
}

/** Sends an answer and takes the step it leads to. */
const answer = async (dispatch: Dispatch, reply: StepAnswer): Promise<SignInStep> => {
  const step = await ask('answerStep', { answer: reply })
  dispatch({ type: 'step', step })
  return step
}

const methodOrder: SecondMethod[] = ['authenticator', 'email', 'yubikey', 'securityKey', 'apiKey']

type KeyState =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'unavailable' }
  | { kind: 'other'; address: string }
  | { kind: 'closed' }

/** A second step, among the methods the account has and the browser can answer. */
export function SecondScreen({ state, dispatch }: Props) {
  const screen = state.screen
  const given = screen.name === 'second' ? screen.methods : []
  const unsupported = screen.name === 'second' ? screen.unsupported : []
  const vaultwarden = state.place === 'vaultwarden'
  const [key, setKey] = useState<KeyState>({ kind: 'idle' })
  const offered = methodOrder.filter(
    (method) =>
      (given.includes(method) || (method === 'apiKey' && vaultwarden)) &&
      !(method === 'securityKey' && key.kind === 'unavailable'),
  )
  const [picked, setPicked] = useState<SecondMethod | null>(null)
  const method = picked !== null && offered.includes(picked) ? picked : (offered[0] ?? null)
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [sent, setSent] = useState(false)
  const [busy, run] = useBusy(dispatch)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const duoOnly = unsupported.includes('duo') && offered.every((m) => m === 'apiKey')

  const pick = (next: SecondMethod) => {
    setPicked(next)
    setCode('')
    setKey({ kind: 'idle' })
    if (next === 'email')
      void run(async () => {
        await answer(dispatch, { step: 'second', method: 'email', code: '', remember })
        setSent(true)
      })
  }

  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || method === null || method === 'securityKey' || code.trim() === '') return
    void run(async () => {
      await answer(dispatch, { step: 'second', method, code: code.trim(), remember })
      setCode('')
    })
  }

  const useKey = () =>
    void run(async () => {
      const challenge = await ask('securityKeyChallenge')
      if (challenge === null) {
        setKey({ kind: 'unavailable' })
        setPicked(null)
        return
      }
      // Before any key is asked: the page is on the server's own address, which must be the one typed
      const other = otherAddress(state.address, challenge)
      if (other !== null) {
        setKey({ kind: 'other', address: other })
        return
      }
      const controller = new AbortController()
      abort.current = controller
      setKey({ kind: 'asking' })
      try {
        const result = await askSecurityKey(challenge, controller.signal)
        setKey({ kind: 'idle' })
        await answer(dispatch, {
          step: 'securityKey',
          assertion: result.assertion,
          remember: result.remember,
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'closed') {
          setKey({ kind: 'closed' })
          return
        }
        setKey({ kind: 'idle' })
        throw error
      } finally {
        abort.current = null
      }
    })

  const label = method === null ? '' : t(`setup_method_${method}`)

  return (
    <Frame title={t('setup_second_title')} lead={t('setup_second_lead')} error={state.error}>
      {duoOnly ? <Alert>{t('setup_second_duo')}</Alert> : null}
      {unsupported.length > 0 && !duoOnly ? (
        <Note>{t('setup_second_unsupported', unsupported.map(methodName).join(', '))}</Note>
      ) : null}
      {key.kind === 'unavailable' ? <Alert>{t('setup_key_unavailable')}</Alert> : null}
      <form onSubmit={submit} noValidate>
        {offered.length > 1 ? (
          <fieldset class="methods">
            <legend>{t('setup_second_methods')}</legend>
            {offered.map((candidate) => (
              <label key={candidate} class={candidate === method ? 'radio picked' : 'radio'}>
                <input
                  type="radio"
                  name="method"
                  value={candidate}
                  checked={candidate === method}
                  disabled={busy || key.kind === 'asking'}
                  onChange={() => pick(candidate)}
                />
                <span class="radio-text">
                  <span class="radio-name">{t(`setup_method_${candidate}`)}</span>
                  <span class="radio-hint">
                    {candidate === 'securityKey'
                      ? t('setup_key_lead')
                      : t(`setup_method_${candidate}_hint`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {method === 'securityKey' ? (
          <SecurityKeyPanel
            keyState={key}
            busy={busy}
            onUse={useKey}
            onCancel={() => abort.current?.abort()}
            onAddress={(address) => dispatch({ type: 'useAddress', address })}
          />
        ) : method !== null ? (
          <>
            {method === 'email' ? (
              <p class="hint" role="status" aria-live="polite">
                {sent ? t('setup_second_email_sent') : t('setup_second_email_send')}
              </p>
            ) : null}
            <Field
              label={label}
              value={code}
              onInput={setCode}
              type={method === 'apiKey' ? 'password' : 'text'}
              inputMode={method === 'authenticator' || method === 'email' ? 'numeric' : 'text'}
              placeholder={
                method === 'authenticator' ? '000 000' : method === 'email' ? '000000' : undefined
              }
              code={method === 'authenticator' || method === 'email'}
              mono={method === 'yubikey'}
              autoComplete={method === 'apiKey' || method === 'yubikey' ? 'off' : 'one-time-code'}
              hint={t(`setup_method_${method}_hint`)}
              disabled={busy}
              required
            />
          </>
        ) : null}
        {method === 'email' ? (
          <div class="inline-actions">
            <button
              type="button"
              class="secondary small"
              disabled={busy}
              onClick={() => pick('email')}
            >
              {sent ? t('setup_second_email_again') : t('setup_second_email_button')}
            </button>
          </div>
        ) : null}
        {method !== null && method !== 'apiKey' ? (
          <Checkbox
            label={t('setup_second_remember')}
            hint={t('setup_second_remember_hint')}
            checked={remember}
            onChange={setRemember}
          />
        ) : null}
        {busy && key.kind !== 'asking' ? <Status>{t('setup_second_busy')}</Status> : null}
        <Actions>
          {method !== null && method !== 'securityKey' ? (
            <button type="submit" class="primary" disabled={busy || code.trim() === ''}>
              {t('setup_second_button')}
            </button>
          ) : null}
          <button
            type="button"
            class="secondary"
            disabled={busy && key.kind !== 'asking'}
            onClick={() => {
              abort.current?.abort()
              dispatch({ type: 'back' })
            }}
          >
            {t('setup_back')}
          </button>
        </Actions>
      </form>
    </Frame>
  )
}

const methodName = (method: string): string => {
  const known = t(`setup_method_${method}`)
  return known === `setup_method_${method}` ? method : known
}

function SecurityKeyPanel(props: {
  keyState: KeyState
  busy: boolean
  onUse: () => void
  onCancel: () => void
  onAddress: (address: string) => void
}) {
  const { keyState } = props
  if (keyState.kind === 'other')
    return (
      <div class="panel" role="alert">
        <Tile name="key" accent />
        <div class="panel-body">
          <span class="panel-text">{t('setup_key_other', keyState.address)}</span>
          <div class="inline-actions">
            <button
              type="button"
              class="primary small"
              onClick={() => props.onAddress(keyState.address)}
            >
              {t('setup_key_use_address')}
            </button>
          </div>
        </div>
      </div>
    )
  if (keyState.kind === 'asking')
    return (
      <div class="panel">
        <Tile name="key" accent />
        <div class="panel-body">
          <Status>{t('setup_key_asking')}</Status>
          <div class="inline-actions">
            <button type="button" class="secondary small" onClick={props.onCancel}>
              {t('setup_key_cancel')}
            </button>
          </div>
        </div>
      </div>
    )
  return (
    <div class="panel">
      <Tile name="key" accent />
      <div class="panel-body">
        <span class="panel-text">{t('setup_key_lead')}</span>
        {keyState.kind === 'closed' ? <Alert>{t('setup_key_closed')}</Alert> : null}
        <div class="inline-actions">
          <button type="button" class="secondary small" disabled={props.busy} onClick={props.onUse}>
            {t('setup_key_button')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Kemlock Server: the five words, shown while another signed-in device approves. */
export function ApprovalScreen({ state, dispatch }: Props) {
  const screen = state.screen
  const phrase = screen.name === 'approval' ? screen.phrase : []
  const requestId = screen.name === 'approval' ? screen.requestId : ''

  useEffect(() => {
    if (requestId === '') return
    let live = true
    let inFlight = false
    const poll = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const step = await ask('answerStep', { answer: { step: 'approval', requestId } })
        if (live) dispatch({ type: 'step', step })
      } catch {
        if (live) dispatch({ type: 'failed', problem: 'setup', message: t('setup_error_failed') })
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(() => void poll(), 2000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [requestId, dispatch])

  return (
    <Frame title={t('setup_approval_title')} lead={t('setup_approval_lead')} error={state.error}>
      <div class="words-block">
        <span id="words-label" class="legend">
          {t('setup_approval_words')}
        </span>
        <ol class="words" aria-labelledby="words-label">
          {phrase.map((word, i) => (
            <li key={`${i}-${word}`}>
              <span class="n mono" aria-hidden="true">
                {i + 1}
              </span>
              <span class="word mono">{word}</span>
            </li>
          ))}
        </ol>
      </div>
      <div class="panel slim">
        <Tile name="phone" size={36} />
        <span class="panel-text">{t('setup_approval_check')}</span>
      </div>
      <Status>{t('setup_approval_waiting')}</Status>
      <Actions>
        <button type="button" class="secondary" onClick={() => dispatch({ type: 'back' })}>
          {t('setup_approval_cancel')}
        </button>
      </Actions>
    </Frame>
  )
}

/** Kemlock Server: the account's key opens with the master password (no trusted device). */
export function MasterPasswordScreen({ state, dispatch }: Props) {
  const [password, setPassword] = useState('')
  const [busy, run] = useBusy(dispatch)
  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || password === '') return
    void run(async () => {
      await answer(dispatch, { step: 'masterPassword', password })
      setPassword('')
    })
  }
  return (
    <Frame title={t('setup_master_title')} lead={t('setup_master_lead')} error={state.error}>
      <form onSubmit={submit} noValidate>
        <PasswordField
          label={t('setup_form_master')}
          value={password}
          onInput={setPassword}
          autoComplete="current-password"
          disabled={busy}
          required
        />
        {busy ? <Status>{t('setup_form_busy')}</Status> : null}
        <Actions>
          <button type="submit" class="primary" disabled={busy || password === ''}>
            {t('setup_continue')}
          </button>
          <button
            type="button"
            class="secondary"
            disabled={busy}
            onClick={() => dispatch({ type: 'back' })}
          >
            {t('setup_back')}
          </button>
        </Actions>
      </form>
    </Frame>
  )
}

/** Vaultwarden: the account's Kemlock homes, to join one. Setup never makes a home. */
export function HomesScreen({ state, dispatch }: Props) {
  const homes = state.screen.name === 'homes' ? state.screen.homes : []
  const [chosen, setChosen] = useState<string | null>(homes.length === 1 ? homes[0].id : null)
  const [busy, run] = useBusy(dispatch)
  const home = homes.find((candidate) => candidate.id === chosen)

  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || home === undefined) return
    void run(async () => {
      await answer(dispatch, { step: 'homes', homeId: home.id })
    })
  }

  return (
    <Frame title={t('setup_homes_title')} lead={t('setup_homes_lead')} error={state.error}>
      <form onSubmit={submit} noValidate>
        <fieldset class="methods">
          <legend class="sr-only">{t('setup_homes_legend')}</legend>
          {homes.map((candidate) => (
            <label
              key={candidate.id}
              class={candidate.id === chosen ? 'radio home picked' : 'radio home'}
            >
              <input
                type="radio"
                name="home"
                value={candidate.id}
                checked={candidate.id === chosen}
                disabled={busy}
                onChange={() => setChosen(candidate.id)}
              />
              <Tile name="folder" size={36} />
              <span class="radio-text">
                <span class="radio-name">{candidate.name}</span>
                <span class="radio-hint">
                  {t(
                    'setup_home_line',
                    candidate.name,
                    t(candidate.storage === 'sealed' ? 'setup_home_sealed' : 'setup_home_plain'),
                    tCount('setup_items', candidate.items),
                  )}
                </span>
              </span>
              <span class={candidate.storage === 'sealed' ? 'chip' : 'chip warn'}>
                {t(
                  candidate.storage === 'sealed'
                    ? 'setup_home_chip_sealed'
                    : 'setup_home_chip_plain',
                )}
              </span>
            </label>
          ))}
        </fieldset>
        {home?.storage === 'sealed' ? <p class="hint">{t('setup_home_sealed_note')}</p> : null}
        {home?.storage === 'plain' ? (
          <Alert tone="warn">{t('setup_home_plain_warning')}</Alert>
        ) : null}
        {busy ? <Status>{t('setup_second_busy')}</Status> : null}
        <Actions>
          <button type="submit" class="primary" disabled={busy || home === undefined}>
            {t('setup_continue')}
          </button>
          <button
            type="button"
            class="secondary"
            disabled={busy}
            onClick={() => dispatch({ type: 'back' })}
          >
            {t('setup_back')}
          </button>
        </Actions>
      </form>
    </Frame>
  )
}

/** The account holds no Kemlock home: it has to be made on the phone first. */
export function NoHomeScreen({ state, dispatch }: Props) {
  return (
    <Frame title={t('setup_nohome_title')} lead={t('setup_nohome_lead')} error={state.error}>
      <Actions>
        <button type="button" class="primary" onClick={() => dispatch({ type: 'back' })}>
          {t('setup_nohome_again')}
        </button>
        <button type="button" class="secondary" onClick={() => dispatch({ type: 'cancelled' })}>
          {t('setup_nohome_other')}
        </button>
      </Actions>
    </Frame>
  )
}

/** The sync passphrase: a WebDAV folder's, or a sealed home's (checked against its seal). */
export function PassphraseScreen({ state, dispatch }: Props) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, run] = useBusy(dispatch)
  const webdav = state.place === 'webdav'
  const wrong = state.error?.problem === 'key'
  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || passphrase === '') return
    void run(async () => {
      await answer(dispatch, { step: 'passphrase', passphrase })
      setPassphrase('')
    })
  }
  return (
    <Frame
      title={t(webdav ? 'setup_passphrase_title_folder' : 'setup_passphrase_title_home')}
      lead={t(webdav ? 'setup_passphrase_lead_folder' : 'setup_passphrase_lead_home')}
      error={state.error}
      hint={wrong ? t('setup_passphrase_nothing_stored') : null}
    >
      <form onSubmit={submit} noValidate>
        <PasswordField
          label={t('setup_form_passphrase')}
          value={passphrase}
          onInput={setPassphrase}
          disabled={busy}
          required
        />
        {busy ? <Status>{t('setup_passphrase_checking')}</Status> : null}
        <Actions>
          <button type="submit" class="primary" disabled={busy || passphrase === ''}>
            {t('setup_continue')}
          </button>
          <button
            type="button"
            class="secondary"
            disabled={busy}
            onClick={() => dispatch({ type: 'back' })}
          >
            {t('setup_back')}
          </button>
        </Actions>
      </form>
    </Frame>
  )
}

/** What the first sync will add and remove, before it runs. */
export function FirstSyncScreen({ state, dispatch }: Props) {
  const screen = state.screen
  const adds = screen.name === 'firstSync' ? screen.adds : 0
  const removes = screen.name === 'firstSync' ? screen.removes : 0
  const [busy, run] = useBusy(dispatch)

  const go = (yes: boolean) =>
    void run(async () => {
      if (yes) {
        await answer(dispatch, { step: 'firstSync', go: true })
        return
      }
      await ask('answerStep', { answer: { step: 'firstSync', go: false } })
      dispatch({ type: 'cancelled' })
    })

  return (
    <Frame
      title={t('setup_first_title')}
      lead={t('setup_first_lead', placeName(state.place))}
      error={state.error}
    >
      <ul class="counts">
        <li>
          <Tile name="arrowDown" accent />
          <span class="count-text">
            <strong class="mono">{adds}</strong>
            <span>{tCount('setup_first_adds', adds)}</span>
          </span>
        </li>
        <li>
          <Tile name="arrowUp" accent />
          <span class="count-text">
            <strong class="mono">{removes}</strong>
            <span>{tCount('setup_first_removes', removes)}</span>
          </span>
        </li>
      </ul>
      {removes > 0 ? <Alert tone="warn">{t('setup_first_removes_warning')}</Alert> : null}
      {state.place === 'vaultwarden' ? <Note status>{t('setup_logins_stay')}</Note> : null}
      {removes === 0 ? <p class="hint">{t('setup_first_nothing')}</p> : null}
      {busy ? <Status>{t('setup_first_busy')}</Status> : null}
      <Actions>
        <button type="button" class="primary" disabled={busy} onClick={() => go(true)}>
          {t('setup_first_button')}
        </button>
        <button type="button" class="secondary" disabled={busy} onClick={() => go(false)}>
          {t('setup_first_cancel')}
        </button>
      </Actions>
    </Frame>
  )
}
