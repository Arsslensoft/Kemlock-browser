// What the Kemlock Server account adds to the setup tab (docs/plans/add-browser-account.md): making an account, opening one that signed in
// without opening with two pieces of its Recovery Kit, and the move of a vault off Vaultwarden or WebDAV into Kemlock Server.
import { useEffect, useState } from 'preact/hooks'
import { useMove, problemName } from '../account/move-run'
import { account } from '../account/send'
import type { SignInStep } from '../shared/api'
import type { FlowState } from './flow'
import { t } from './i18n'
import { ask } from './send'
import { canMakeVault } from './strength'
import {
  Actions,
  Alert,
  Field,
  Frame,
  Note,
  PasswordField,
  Status,
  useBusy,
  type Dispatch,
} from './ui'
import { Strength } from './vaultScreens'

interface Props {
  state: FlowState
  dispatch: Dispatch
}

/** What a registration the server refused says, in this screen's words. */
const refusals = ['signupsClosed', 'accountExists', 'registerRefused']

/** "Create an account" on the Kemlock Server the address names: email, a name, a password, and an invite code when the server asks. */
export function RegisterScreen({ state, dispatch }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [invited, setInvited] = useState(false)
  const [token, setToken] = useState('')
  const [busy, run] = useBusy(dispatch)
  const mismatch = confirm !== '' && password !== confirm
  const ready = email.trim() !== '' && canMakeVault(password, confirm)

  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || !ready) return
    void run(async () => {
      const step = await account('register', {
        server: state.address,
        email: email.trim(),
        name: name.trim(),
        password,
        ...(invited && token.trim() !== '' ? { inviteToken: token.trim() } : {}),
      })
      setPassword('')
      setConfirm('')
      if (step.step === 'error' && refusals.includes(step.problem)) {
        dispatch({
          type: 'failed',
          problem: 'setup',
          message: t(`account_register_${step.problem}`),
        })
        return
      }
      dispatch({ type: 'step', step })
    })
  }

  return (
    <Frame
      title={t('account_register_title')}
      lead={t('account_register_lead')}
      error={state.error}
      hint={state.error?.problem === 'network' ? t('setup_certificate_hint') : null}
    >
      <form onSubmit={submit} noValidate>
        <div class="stack">
          <Field
            label={t('account_register_email')}
            value={email}
            onInput={setEmail}
            type="email"
            inputMode="email"
            autoComplete="username"
            disabled={busy}
            required
          />
          <Field
            label={t('account_register_name')}
            value={name}
            onInput={setName}
            autoComplete="name"
            hint={t('account_register_nameHint')}
            disabled={busy}
          />
          <PasswordField
            label={t('account_register_password')}
            value={password}
            onInput={setPassword}
            autoComplete="new-password"
            disabled={busy}
            required
          />
          <Strength password={password} />
          <PasswordField
            label={t('account_register_confirm')}
            value={confirm}
            onInput={setConfirm}
            autoComplete="new-password"
            disabled={busy}
            required
            error={mismatch ? t('setup_password_mismatch') : null}
          />
          {invited ? (
            <Field
              label={t('account_register_invite')}
              value={token}
              onInput={setToken}
              mono
              hint={t('account_register_inviteHint')}
              disabled={busy}
            />
          ) : (
            <div class="inline-actions">
              <button type="button" class="secondary small" onClick={() => setInvited(true)}>
                {t('account_register_haveInvite')}
              </button>
            </div>
          )}
        </div>
        <Note>{t('account_register_forgot')}</Note>
        {busy ? <Status>{t('account_register_busy')}</Status> : null}
        <Actions>
          <button type="submit" class="primary" disabled={busy || !ready}>
            {t('account_register_button')}
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

/** The problems opening with a kit can have, by the name the core gives them. */
const kitProblems = [
  'kitNone',
  'kitStale',
  'kitWrong',
  'kitFormat',
  'kitChecksum',
  'kitOtherKit',
  'kitDuplicate',
  'kitNotEnough',
]

/**
 * "Use a Recovery Kit instead": two of the account's three pieces open it without its password or another device. Shown where the
 * account signed in without opening (an approval is waited for, or the master password is asked).
 */
export function RecoveryKitOption({
  dispatch,
  onWorking,
}: {
  dispatch: Dispatch
  /** Told when the answer is on its way (true) and when it didn't open the account (false), so a poll for an approval waits. */
  onWorking?: (working: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, run] = useBusy(dispatch)

  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || first.trim() === '' || second.trim() === '') return
    setProblem(null)
    onWorking?.(true)
    void run(async () => {
      try {
        const step = await ask('answerStep', {
          answer: { step: 'recoveryKit', pieces: [first.trim(), second.trim()] },
        })
        if (step.step === 'error') {
          // Said here, where the pieces were typed: the sign-in itself goes on waiting
          setProblem(kitProblems.includes(step.problem) ? step.problem : 'kitWrong')
          onWorking?.(false)
          return
        }
        setFirst('')
        setSecond('')
        // The screen changes with the step, and nothing waits for the approval any more
        dispatch({ type: 'step', step })
      } catch (error) {
        onWorking?.(false)
        throw error
      }
    })
  }

  if (!open)
    return (
      <div class="inline-actions">
        <button type="button" class="secondary small" onClick={() => setOpen(true)}>
          {t('account_kit_use')}
        </button>
      </div>
    )
  return (
    <form class="kit-option" onSubmit={submit} noValidate aria-label={t('account_kit_use')}>
      <p class="hint">{t('account_kit_lead')}</p>
      {problem !== null ? <Alert>{t(`account_kit_error_${problem}`)}</Alert> : null}
      <Field
        label={t('account_kit_first')}
        value={first}
        onInput={setFirst}
        mono
        disabled={busy}
        required
      />
      <Field
        label={t('account_kit_second')}
        value={second}
        onInput={setSecond}
        mono
        disabled={busy}
        required
      />
      {busy ? <Status>{t('account_kit_busy')}</Status> : null}
      <Actions>
        <button
          type="submit"
          class="primary"
          disabled={busy || first.trim() === '' || second.trim() === ''}
        >
          {t('account_kit_button')}
        </button>
      </Actions>
    </form>
  )
}

/**
 * The move step of a sign-in that is held, from what the core says of it, or null when none is: the person left setup or the browser
 * between the sign-in and the answer, and setup shows it again before anything else.
 */
export async function heldMoveStep(): Promise<Extract<SignInStep, { step: 'move' }> | null> {
  try {
    const status = await account('moveStatus')
    if (!status.held || status.source === undefined || status.counts === undefined) return null
    return {
      step: 'move',
      source: status.source,
      counts: status.counts,
      files: status.files ?? 0,
      resumed: status.resumed === true,
    }
  } catch {
    return null
  }
}

/** A kind of entry as the move's count names it: the server's `backup-codes` is `backupcodes` in the strings. */
const kindKey = (kind: string): string => `account_move_kind_${kind.replace(/[^a-z0-9]/gi, '')}`

/**
 * The vault syncs with Vaultwarden on this server, or with WebDAV, and the sign-in is held: what moves and what stays, before anything is
 * written. Moving runs the app's steps and follows them here; a vault whose notes have attached files waits for the phone.
 */
export function MoveScreen({ state, dispatch }: Props) {
  const screen = state.screen
  const step = screen.name === 'move' ? screen : null
  const move = useMove()
  const [busy, run] = useBusy(dispatch)
  const status = move.status
  const files = step?.files ?? 0

  // Finished: the first sync of the new place runs, and setup ends with how it went
  const finished = status?.finished === true && status.running !== true
  useEffect(() => {
    if (!finished) return
    let live = true
    void (async () => {
      try {
        const synced = await ask('syncNow')
        if (live)
          dispatch({ type: 'step', step: { step: 'done', status: synced } satisfies SignInStep })
      } catch {
        if (live) dispatch({ type: 'failed', problem: 'setup', message: t('setup_error_failed') })
      }
    })()
    return () => {
      live = false
    }
  }, [finished, dispatch])

  const cancel = () =>
    void run(async () => {
      await account('moveCancel')
      dispatch({ type: 'cancelled' })
    })

  if (step === null) return null
  const running = status?.running === true
  const problem = status?.problem
  const total = Object.values(step.counts).reduce((sum, count) => sum + count, 0)

  return (
    <Frame
      title={t('account_move_screenTitle')}
      lead={t(
        step.source === 'webdav'
          ? 'account_move_screenLeadWebdav'
          : 'account_move_screenLeadVaultwarden',
      )}
      error={state.error}
    >
      {files > 0 ? <Alert>{t('account_move_screenFiles', files)}</Alert> : null}
      {move.error !== null ? <Alert>{move.error}</Alert> : null}
      {problem !== undefined && !running ? (
        <Alert tone="warn">{t(`account_move_problem_${problemName(problem)}`)}</Alert>
      ) : null}
      <div class="move-lists">
        <h2>{t('account_move_screenMoves', total)}</h2>
        <ul class="facts">
          {Object.entries(step.counts).map(([kind, count]) => (
            <li key={kind}>
              <span class="strong">
                {t(kindKey(kind)) === kindKey(kind) ? kind : t(kindKey(kind))}
              </span>
              <span class="mono">{count}</span>
            </li>
          ))}
        </ul>
        <h2>{t('account_move_screenStays')}</h2>
        <p class="hint">
          {t(
            step.source === 'webdav'
              ? 'account_move_screenStaysWebdav'
              : 'account_move_screenStaysVaultwarden',
          )}
        </p>
        {step.resumed ? <Note>{t('account_move_screenResumed')}</Note> : null}
      </div>
      {running ? (
        <Status>
          {t('account_move_screenRunning', t(`account_move_step_${status?.step ?? 'sync'}`))}
        </Status>
      ) : null}
      <Actions>
        {problem === 'removals' && !running ? (
          <>
            <button
              type="button"
              class="primary"
              disabled={move.busy}
              onClick={() => void move.start('keep')}
            >
              {t('account_move_keep')}
            </button>
            <button
              type="button"
              class="secondary"
              disabled={move.busy}
              onClick={() => void move.start('remove')}
            >
              {t('account_move_remove')}
            </button>
          </>
        ) : (
          <button
            type="button"
            class="primary"
            disabled={move.busy || running || busy || files > 0}
            onClick={() => void move.start()}
          >
            {problem === undefined ? t('account_move_screenButton') : t('account_move_retry')}
          </button>
        )}
        <button type="button" class="secondary" disabled={running || busy} onClick={cancel}>
          {t('account_move_screenCancel')}
        </button>
      </Actions>
    </Frame>
  )
}
