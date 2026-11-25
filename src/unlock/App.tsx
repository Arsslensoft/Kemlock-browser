// The unlock tab (docs/plans/add-passkey-unlock.md): `#add` makes a credential for the open vault, anything else (`#unlock`) asks
// the vault's credentials and opens it. A page of its own because WebAuthn can't be asked from the popup, which closes when the
// browser's prompt takes focus. It holds nothing: the answers go to the background, which hands them to the core.
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { PasskeyUnlockInfo } from '../shared/api'
import { KemlockIcon } from '../shared/brand/brand'
import { Button, IconButton, Notice, SelectField, TextField } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { useVaultLock } from '../shared/vault-lock'
import { AskError, ask } from '../popup/send'
import {
  askCredentials,
  CeremonyError,
  makeCredential,
  type MadeCredential,
  prfSupport,
  type Attachment,
  type PrfSupport,
} from './ceremony'

/** The page's own words for what went wrong. */
export function problemText(error: unknown): string {
  const code = error instanceof CeremonyError || error instanceof AskError ? error.message : ''
  switch (code) {
    case 'cancelled':
      return t('unlock_errorCancelled')
    case 'noPrf':
    case 'unsupported':
      return t('unlock_errorNoPrf')
    case 'duplicate':
      return t('unlock_errorDuplicate')
    case 'security':
      return t('unlock_errorSecurity')
    case 'firefox':
      return t('unlock_unsupportedFirefox')
    case 'wrongPassword':
      return t('unlock_errorWrongPassword')
    case 'unavailable':
      return t('unlock_unsupportedFirefox')
    case 'locked':
      return t('unlock_errorLocked')
    case 'notFound':
      return t('unlock_errorNone')
    default:
      return t('unlock_errorFailed')
  }
}

/** Closes this tab: the work is done and nothing else is in it. */
async function closeThisTab(): Promise<void> {
  try {
    const tab = await chrome.tabs.getCurrent()
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id)
  } catch {
    window.close()
  }
}

function Frame(props: { title: string; children: ComponentChildren }) {
  return (
    <main class="unlock-page">
      <div class="unlock-card">
        <div class="unlock-head">
          <KemlockIcon size={32} />
          <h1>{props.title}</h1>
        </div>
        {props.children}
      </div>
    </main>
  )
}

/* ----------------------------------------------------------------------------------------------- */
/* Unlocking                                                                                         */
/* ----------------------------------------------------------------------------------------------- */

type UnlockState =
  | { at: 'asking' }
  | { at: 'done' }
  | { at: 'password'; why: 'tries' | 'days' }
  | { at: 'failed'; text: string }

export function UnlockPage() {
  const [state, setState] = useState<UnlockState>({ at: 'asking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    const say = (next: UnlockState) => {
      if (alive) setState(next)
    }
    void (async () => {
      say({ at: 'asking' })
      try {
        if ((await prfSupport()) === 'firefox')
          return say({ at: 'failed', text: t('unlock_unsupportedFirefox') })
        const info: PasskeyUnlockInfo = await ask('passkeyUnlockInfo')
        if (info.credentials.length === 0) return say({ at: 'failed', text: t('unlock_errorNone') })
        if (info.passwordRequired !== undefined)
          return say({ at: 'password', why: info.passwordRequired })
        const answer = await askCredentials(info)
        const result = await ask('unlockWithPasskey', answer)
        if (result.ok) {
          say({ at: 'done' })
          await closeThisTab()
          return
        }
        say({
          at: 'failed',
          text: t(result.reason === 'stale' ? 'unlock_errorStale' : 'unlock_errorWrong'),
        })
      } catch (error) {
        if (error instanceof AskError && error.message === 'passwordRequired') {
          // The core counted the tries: whichever reason it has, the password is what is asked for now
          const info = await ask('passkeyUnlockInfo').catch(() => undefined)
          return say({ at: 'password', why: info?.passwordRequired ?? 'tries' })
        }
        say({ at: 'failed', text: problemText(error) })
      }
    })()
    return () => {
      alive = false
    }
  }, [attempt])

  return (
    <Frame title={t('unlock_pageTitleUnlock')}>
      {state.at === 'asking' && (
        <p class="unlock-wait" role="status">
          {t('unlock_asking')}
        </p>
      )}
      {state.at === 'done' && <Notice kind="ok">{t('unlock_done')}</Notice>}
      {state.at === 'password' && (
        <>
          <Notice kind="warn">
            {t(state.why === 'days' ? 'unlock_passwordDays' : 'unlock_passwordTries')}
          </Notice>
          <Button kind="primary" onClick={() => void closeThisTab()}>
            {t('unlock_usePassword')}
          </Button>
        </>
      )}
      {state.at === 'failed' && (
        <>
          <Notice kind="error">{state.text}</Notice>
          <div class="actions start">
            <Button kind="primary" onClick={() => setAttempt(attempt + 1)}>
              {t('unlock_tryAgain')}
            </Button>
            <Button onClick={() => void closeThisTab()}>{t('unlock_usePassword')}</Button>
          </div>
        </>
      )}
    </Frame>
  )
}

/* ----------------------------------------------------------------------------------------------- */
/* Making a credential                                                                               */
/* ----------------------------------------------------------------------------------------------- */

type AddState =
  | { at: 'form' }
  | { at: 'working' }
  | { at: 'added'; name: string }
  | { at: 'failed'; text: string }

export function AddPage() {
  const [kind, setKind] = useState<Attachment>('platform')
  const [name, setName] = useState('')
  const [state, setState] = useState<AddState>({ at: 'form' })
  const [password, setPassword] = useState('')
  // The credential once it is made: a wrong password is asked again without making another
  const [made, setMade] = useState<MadeCredential | undefined>()
  const [shown, setShown] = useState(false)
  const [support, setSupport] = useState<PrfSupport | undefined>()
  const [locked, setLocked] = useState(false)
  // Set when the vault locks: a credential the browser's prompt made after that is let go, and nothing is added
  const stopped = useRef(false)

  // The vault locked: the flow in progress stops, and what it held (the password typed, the credential made with its secret) goes. A
  // credential already added stays added. There is nothing else here to drop: the unlock page holds nothing at all.
  useVaultLock(
    () => {
      stopped.current = true
      setLocked(true)
      setPassword('')
      setMade(undefined)
      setState((previous) => (previous.at === 'added' ? previous : { at: 'form' }))
    },
    async () => (await ask('pageState')).unlocked,
  )

  useEffect(() => {
    let alive = true
    void prfSupport().then((found) => {
      if (!alive) return
      setSupport(found)
      // Nothing to ask where the browser can't, and never in Firefox
      if (found === 'no' || found === 'firefox') return
      // The vault must be open to wrap its key, and the background says when it is not
      void ask('passkeyUnlockPrepare').catch((error: unknown) => {
        if (alive && error instanceof AskError && error.message === 'locked') setLocked(true)
      })
    })
    return () => {
      alive = false
    }
  }, [])

  const defaultName = t(kind === 'cross-platform' ? 'unlock_nameKey' : 'unlock_nameDevice')
  const chosen = name.trim() === '' ? defaultName : name.trim()

  // The vault may be opened again while this tab waits (from the popup, or another window): when the tab comes back into view or gets
  // the focus it asks, and the flow can be started again
  useEffect(() => {
    if (!locked) return
    const again = () => {
      if (document.visibilityState !== 'visible') return
      ask('pageState').then(
        (state) => {
          if (!state.unlocked) return
          stopped.current = false
          setLocked(false)
        },
        () => undefined,
      )
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('focus', again)
    }
  }, [locked])

  const add = async () => {
    // A new try: a lock from before it is over, or the background says so again
    stopped.current = false
    setState({ at: 'working' })
    try {
      const credential =
        made ?? (await makeCredential(await ask('passkeyUnlockPrepare'), kind, chosen))
      // The vault locked while the browser's prompt was open: what it made is let go, and nothing is added
      if (stopped.current) throw new AskError('locked')
      setMade(credential)
      // The core checks the password as an unlock does: whoever sits at an open browser can't add a key of their own
      await ask('addPasskeyUnlock', { ...credential, password })
      // Added: a lock that came while the core was answering does not undo it, so it is reported as done
      setPassword('')
      setMade(undefined)
      setState({ at: 'added', name: credential.name })
    } catch (error) {
      if (error instanceof AskError && error.message === 'locked') {
        stopped.current = true
        setLocked(true)
      }
      setState({
        at: 'failed',
        text: stopped.current ? t('unlock_errorLocked') : problemText(error),
      })
    }
  }

  if (support === 'no' || support === 'firefox') {
    return (
      <Frame title={t('unlock_pageTitleAdd')}>
        <Notice kind="warn">
          {t(support === 'firefox' ? 'unlock_unsupportedFirefox' : 'unlock_unsupported')}
        </Notice>
        <Button onClick={() => void closeThisTab()}>{t('unlock_close')}</Button>
      </Frame>
    )
  }

  if (state.at === 'added') {
    return (
      <Frame title={t('unlock_pageTitleAdd')}>
        <Notice kind="ok">{t('unlock_added', state.name)}</Notice>
        <Button kind="primary" onClick={() => void closeThisTab()}>
          {t('unlock_close')}
        </Button>
      </Frame>
    )
  }

  const working = state.at === 'working'
  return (
    <Frame title={t('unlock_pageTitleAdd')}>
      {locked && <Notice kind="error">{t('unlock_errorLocked')}</Notice>}
      {state.at === 'failed' && <Notice kind="error">{state.text}</Notice>}
      <p class="muted">{t('unlock_addIntro')}</p>
      <SelectField
        stacked
        label={t('unlock_kindLabel')}
        value={kind}
        disabled={working || made !== undefined}
        options={[
          { value: 'platform', label: t('unlock_kindPlatform') },
          { value: 'cross-platform', label: t('unlock_kindKey') },
          { value: 'any', label: t('unlock_kindAny') },
        ]}
        onChange={setKind}
      />
      <TextField
        label={t('unlock_nameLabel')}
        value={name}
        placeholder={defaultName}
        onInput={setName}
      />
      <TextField
        label={t('unlock_passwordLabel')}
        hint={t('unlock_passwordHint')}
        type={shown ? 'text' : 'password'}
        value={password}
        autocomplete="current-password"
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
      <p class="muted small">
        {t(made === undefined ? 'unlock_twoPrompts' : 'unlock_madeAlready')}
      </p>
      <Button
        kind="primary"
        busy={working}
        disabled={locked || password === ''}
        onClick={() => void add()}
      >
        {working ? t('unlock_working') : t('unlock_add')}
      </Button>
    </Frame>
  )
}

/** Which page the address asks for. */
export function App() {
  return location.hash === '#add' ? <AddPage /> : <UnlockPage />
}
