// Where the browser syncs: the place, its address, the access to that address, and the sign-in.
import { useState } from 'preact/hooks'
import type { SignInStep, SyncPlace } from '../shared/api'
import { parseAddress } from './address'
import type { FlowState } from './flow'
import { t } from './i18n'
import { Glyph, type GlyphName } from './icons'
import { ask } from './send'
import {
  Actions,
  Alert,
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

const placeNames: Record<SyncPlace, string> = {
  kemlock: 'setup_place_kemlock',
  webdav: 'setup_place_webdav',
  vaultwarden: 'setup_place_vaultwarden',
}

const placeIcons: Record<SyncPlace, GlyphName> = {
  kemlock: 'server',
  webdav: 'folder',
  vaultwarden: 'shield',
}

export const placeName = (place: SyncPlace | null): string =>
  t(placeNames[place ?? 'kemlock'] ?? placeNames.kemlock)

/** Kemlock Server first, then WebDAV and Vaultwarden (docs/plans/add-kemlock-server-sync.md). */
export function PlaceScreen({ state, dispatch }: Props) {
  const choices: SyncPlace[] = ['kemlock', 'webdav', 'vaultwarden']
  return (
    <Frame title={t('setup_place_title')} lead={t('setup_place_lead')} error={state.error}>
      {state.current ? (
        <Note>
          {t('setup_place_current', placeName(state.current.place), state.current.server)}
        </Note>
      ) : null}
      <ul class="choices">
        {choices.map((place) => (
          <li key={place}>
            <button type="button" class="choice" onClick={() => dispatch({ type: 'place', place })}>
              <Tile name={placeIcons[place]} accent={place === 'kemlock'} />
              <span class="choice-text">
                <span class="choice-title">{placeName(place)}</span>
                <span class="choice-body">{t(`${placeNames[place]}_body`)}</span>
              </span>
              <span class="choice-go">
                <Glyph name="chevron" size={18} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p class="hint">{t('setup_place_phone')}</p>
      <Actions>
        <button type="button" class="secondary" onClick={() => dispatch({ type: 'skip' })}>
          {state.current ? t('setup_place_keep') : t('setup_place_skip')}
        </button>
      </Actions>
    </Frame>
  )
}

/** The server's (or the WebDAV folder's) address: https only. */
export function AddressScreen({ state, dispatch }: Props) {
  const [text, setText] = useState(state.address)
  const place = state.place ?? 'kemlock'
  const folder = place === 'webdav'
  const problem =
    state.addressError === 'insecure'
      ? t('sync_problem_insecure')
      : state.addressError === 'invalid'
        ? t('setup_address_invalid')
        : null

  const submit = (event: Event) => {
    event.preventDefault()
    dispatch({ type: 'address', text })
  }

  return (
    <Frame
      title={t(folder ? 'setup_address_title_folder' : 'setup_address_title', placeName(place))}
      lead={t(folder ? 'setup_address_lead_folder' : 'setup_address_lead')}
      error={state.error}
      hint={state.error?.problem === 'network' && !folder ? t('setup_certificate_hint') : null}
    >
      <form onSubmit={submit} noValidate>
        <Field
          label={folder ? t('setup_address_folder') : t('setup_address_server')}
          value={text}
          onInput={setText}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={folder ? 'https://dav.example/kemlock' : 'https://vault.example'}
          mono
          hint={folder ? undefined : t('setup_address_certificate')}
          error={problem}
          required
        />
        <Actions>
          <button type="submit" class="primary">
            {t('setup_continue')}
          </button>
          <button type="button" class="secondary" onClick={() => dispatch({ type: 'back' })}>
            {t('setup_back')}
          </button>
        </Actions>
      </form>
    </Frame>
  )
}

/**
 * Access to the address, asked from this click (a user gesture) before anything is sent to it,
 * and apart from the optional access to all sites (spec: browser-sync).
 */
export function AccessScreen({ state, dispatch }: Props) {
  const parsed = parseAddress(state.address)
  const [busy, run] = useBusy(dispatch)
  const refused = state.screen.name === 'access' && state.screen.refused
  if (!parsed.ok) return null
  const place = state.place ?? 'kemlock'

  const allow = () => {
    // The browser's prompt needs this click, so it is asked before anything awaits
    const request = chrome.permissions.request({ origins: [parsed.pattern] })
    void run(async () => {
      const granted = await Promise.resolve(request).then(
        (ok) => ok,
        () => false,
      )
      if (!granted) {
        dispatch({ type: 'accessRefused' })
        return
      }
      if (place !== 'webdav') {
        const checked = await ask('checkServer', { place, server: state.address })
        if (!checked.ok) {
          dispatch({ type: 'failed', problem: checked.problem })
          return
        }
      }
      dispatch({ type: 'accessGranted' })
    })
  }

  return (
    <Frame
      title={t('setup_access_title', parsed.host)}
      lead={t('setup_access_lead', parsed.host)}
      error={state.error}
    >
      <ul class="facts">
        <li>
          <Tile name="shieldCheck" size={24} accent />
          <span class="strong">{t('setup_access_only', parsed.host)}</span>
        </li>
        <li>
          <Tile name="check" size={24} />
          <span>{t('setup_access_nothing', parsed.host)}</span>
        </li>
        <li>
          <Tile name="check" size={24} />
          <span>{t('setup_access_apart')}</span>
        </li>
      </ul>
      <div class="address mono">https://{parsed.host}</div>
      {refused ? <Alert>{t('setup_access_refused', parsed.host)}</Alert> : null}
      {busy ? <Status>{t('setup_access_checking', parsed.host)}</Status> : null}
      <Actions>
        <button type="button" class="primary" disabled={busy} onClick={allow}>
          {refused ? t('setup_access_again') : t('setup_access_button', parsed.host)}
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
    </Frame>
  )
}

/** Kemlock Server's other ways in, with the words each uses (design D4). */
type Way = 'sso' | 'passkey'
const ways = {
  sso: {
    request: 'signInKemlockSso',
    busy: 'setup_form_busy_sso',
    cancelled: 'setup_way_sso_cancelled',
    failed: 'setup_way_sso_failed',
  },
  passkey: {
    request: 'signInKemlockPasskey',
    busy: 'setup_form_busy_passkey',
    cancelled: 'setup_way_passkey_cancelled',
    failed: 'setup_way_passkey_failed',
  },
} as const

/**
 * What an error step of SSO or a passkey says in this screen's own words, or null to show it as any sign-in's problem. The
 * server refusing this extension's redirect (its KEMLOCK_BROWSER_EXTENSION_IDS doesn't list the id) names the id to add.
 */
function wayFailure(way: Way, step: Extract<SignInStep, { step: 'error' }>): string | null {
  switch (step.problem) {
    case 'cancelled':
      return t(ways[way].cancelled)
    case 'ssoRedirect':
      return t('setup_sso_refused', step.message ?? '')
    case 'ssoFailed':
      return t(ways[way].failed)
    case 'unsupported':
      return t('setup_way_unsupported')
    default:
      return null
  }
}

/** The sign-in: email and master password, or a WebDAV folder's username, password and passphrase. */
export function FormScreen({ state, dispatch }: Props) {
  const place = state.place ?? 'kemlock'
  const [email, setEmail] = useState(state.current?.account ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, run] = useBusy(dispatch)
  const [way, setWay] = useState<Way | null>(null)
  const webdav = place === 'webdav'
  const ready = webdav
    ? username !== '' && password !== '' && passphrase !== ''
    : email !== '' && password !== ''

  const submit = (event: Event) => {
    event.preventDefault()
    if (busy || !ready) return
    setWay(null)
    void run(async () => {
      let step: SignInStep
      if (place === 'kemlock')
        step = await ask('signInKemlock', { server: state.address, email, password })
      else if (place === 'vaultwarden')
        step = await ask('signInVaultwarden', { server: state.address, email, password })
      else {
        step = await ask('signInWebdav', { folder: state.address, username, password })
        // The folder's sync passphrase was typed with the rest: answer its step with it
        if (step.step === 'passphrase')
          step = await ask('answerStep', { answer: { step: 'passphrase', passphrase } })
      }
      setPassword('')
      setPassphrase('')
      dispatch({ type: 'step', step })
    })
  }

  // SSO or a passkey, then the same steps (approval, master password, first sync). The email is optional: it is only what the
  // steps name.
  const signInWith = (kind: Way) => {
    if (busy) return
    setWay(kind)
    void run(async () => {
      const address = email.trim()
      const step = await ask(ways[kind].request, {
        server: state.address,
        ...(address === '' ? {} : { email: address }),
      })
      setPassword('')
      const said = step.step === 'error' ? wayFailure(kind, step) : null
      if (said !== null) dispatch({ type: 'failed', problem: 'setup', message: said })
      else dispatch({ type: 'step', step })
    })
  }

  return (
    <Frame
      title={t(`setup_form_title_${place}`)}
      lead={t(`setup_form_lead_${place}`)}
      error={state.error}
      hint={
        state.error?.problem === 'network' && place === 'kemlock'
          ? t('setup_certificate_hint')
          : null
      }
    >
      <form onSubmit={submit} noValidate>
        {webdav ? (
          <Field
            label={t('setup_form_username')}
            value={username}
            onInput={setUsername}
            autoComplete="username"
            disabled={busy}
            required
          />
        ) : (
          <Field
            label={t('setup_form_email')}
            value={email}
            onInput={setEmail}
            type="email"
            inputMode="email"
            autoComplete="username"
            disabled={busy}
            required
          />
        )}
        <PasswordField
          label={webdav ? t('setup_form_webdav_password') : t('setup_form_master')}
          value={password}
          onInput={setPassword}
          autoComplete="current-password"
          hint={webdav ? undefined : t(`setup_form_master_${place}`)}
          disabled={busy}
          required
        />
        {webdav ? (
          <PasswordField
            label={t('setup_form_passphrase')}
            value={passphrase}
            onInput={setPassphrase}
            autoComplete="off"
            hint={t('setup_form_passphrase_hint')}
            disabled={busy}
            required
          />
        ) : null}
        {place === 'vaultwarden' ? <Note status>{t('setup_logins_stay')}</Note> : null}
        {busy ? (
          <Status>
            {t(
              webdav ? 'setup_form_busy_webdav' : way !== null ? ways[way].busy : 'setup_form_busy',
            )}
          </Status>
        ) : null}
        <Actions>
          <button type="submit" class="primary" disabled={busy || !ready}>
            {t('setup_form_button')}
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
      {place === 'kemlock' ? (
        <div class="ways">
          <p class="or">{t('setup_form_or')}</p>
          <div class="way-buttons">
            <button
              type="button"
              class="secondary"
              disabled={busy}
              onClick={() => signInWith('sso')}
            >
              <Glyph name="users" />
              {t('setup_form_sso')}
            </button>
            <button
              type="button"
              class="secondary"
              disabled={busy}
              onClick={() => signInWith('passkey')}
            >
              <Glyph name="key" />
              {t('setup_form_passkey')}
            </button>
          </div>
        </div>
      ) : null}
    </Frame>
  )
}
