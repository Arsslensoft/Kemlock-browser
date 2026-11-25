// The vault's passkeys in the popup (docs/plans/add-passkeys.md): the list, a passkey's page, the passkeys of the site in front and of a
// login's site, and the provider's switches in Settings. A passkey's key is never here: the background lists names, accounts and
// times, and deletes by id.
import { useState } from 'preact/hooks'
import type { LoginView, Settings, TabView } from '../shared/api'
import type { PasskeyView } from '../shared/passkeys'
import { KemlockIcon } from '../shared/brand/brand'
import {
  Button,
  Confirm,
  Group,
  IconButton,
  Notice,
  Section,
  Switch,
  Tile,
  useLoad,
  useToast,
  type Loaded,
} from '../shared/ui/components'
import { errorMessage, formatDate, formatDateTime, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import type { Vault } from './data'
import { allTags, hostOf } from './format'
import { loginsOfPasskey } from './passkey-format'
import { passkeyAccess } from './passkey-access'
import type { Route } from './route'
import { ask } from './send'
import { TagEditor } from './tools/tag-editor'

/** The vault's passkeys, loaded once for the page that asks. */
export function usePasskeys(): Loaded<PasskeyView[]> {
  return useLoad(() => ask('passkeys'))
}

/** "harbornotes.app · sam@example.org": what a passkey is for. */
const detailOf = (passkey: PasskeyView): string =>
  [passkey.userDisplayName ?? passkey.userName, passkey.name === passkey.rpId ? '' : passkey.rpId]
    .filter((part) => part !== '')
    .join(' · ')

/** One row of the Passkeys list; it opens the passkey's page. */
export function PasskeyRow(props: { passkey: PasskeyView; onOpen: (id: string) => void }) {
  const { passkey } = props
  return (
    <li class="item">
      <button
        type="button"
        class="item-main hov"
        aria-label={t('passkeys_openOf', passkey.name)}
        title={t('passkeys_openOf', passkey.name)}
        onClick={() => props.onOpen(passkey.id)}
      >
        <Tile name={passkey.name} />
        <span class="grow lines">
          <span class="name ellipsis">{passkey.name}</span>
          <span class="label ellipsis">{detailOf(passkey)}</span>
        </span>
        <span class="value">
          <span class="mono sub">{formatDate(passkey.createdAt)}</span>
        </span>
        <Icon name="chevron" size={16} weight={2} />
      </button>
    </li>
  )
}

export function PasskeysList(props: { passkeys: PasskeyView[]; onOpen: (id: string) => void }) {
  return (
    <ul class="list">
      {props.passkeys.map((passkey) => (
        <PasskeyRow key={passkey.id} passkey={passkey} onOpen={props.onOpen} />
      ))}
    </ul>
  )
}

/** The cards of the passkeys of the site in front, in "On this site". */
export function SitePasskeys(props: {
  tab: TabView
  passkeys: PasskeyView[]
  onOpen: (id: string) => void
}) {
  const ids = new Set(props.tab.match.passkeys ?? [])
  const here = props.passkeys.filter((passkey) => ids.has(passkey.id))
  return (
    <>
      {here.map((passkey) => (
        <article class="card" key={passkey.id} aria-label={passkey.name}>
          <div class="row card-head">
            <Tile name={passkey.name} size={40} />
            <span class="grow lines">
              <h2 class="card-title ellipsis">{passkey.name}</h2>
              <span class="label ellipsis">
                {t('passkeys_passkeyOf', passkey.userDisplayName ?? passkey.userName)}
              </span>
            </span>
            <IconButton
              icon="chevron"
              size={16}
              weight={2}
              label={t('passkeys_openOf', passkey.name)}
              onClick={() => props.onOpen(passkey.id)}
            />
          </div>
        </article>
      ))}
    </>
  )
}

/** The passkeys of a login's site, on the login's page. */
export function LoginPasskeys(props: { passkeys: PasskeyView[]; onOpen: (id: string) => void }) {
  if (props.passkeys.length === 0) return null
  return (
    <Section title={t('passkeys_tab')}>
      <Group>
        {props.passkeys.map((passkey) => (
          <button
            key={passkey.id}
            type="button"
            class="link-row hov"
            aria-label={t('passkeys_openOf', passkey.name)}
            onClick={() => props.onOpen(passkey.id)}
          >
            <span class="grow lines">
              <span class="name">{passkey.name}</span>
              <span class="label">{detailOf(passkey)}</span>
            </span>
            <Icon name="chevron" size={16} weight={2} />
          </button>
        ))}
      </Group>
    </Section>
  )
}

/** Opens the passkey's site in a tab: its relying party's own address, for a person to sign in there. */
export function openSite(rpId: string): void {
  void chrome.tabs.create({ url: `https://${rpId}/` })
}

/** A passkey's page: what it is for and when it was made, the way to its site and its login, and Delete. */
export function PasskeyPage(props: {
  id: string
  vault: Vault
  onBack: () => void
  onRoute: (route: Route) => void
}) {
  const loaded = usePasskeys()
  const say = useToast()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const passkey = loaded.value?.find((candidate) => candidate.id === props.id)

  if (passkey === undefined) {
    return (
      <div class="screen">
        <header class="bar login-bar">
          <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
          <KemlockIcon size={24} class="mark" />
          <h1 class="login-title">{t('passkeys_tab')}</h1>
        </header>
        <div class="body">
          {loaded.loading ? (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          ) : (
            <Notice>{t('passkeys_gone')}</Notice>
          )}
        </div>
      </div>
    )
  }

  const logins = loginsOfPasskey(props.vault.logins, passkey)
  const remove = async () => {
    setBusy(true)
    try {
      await ask('deletePasskey', { id: passkey.id })
      props.onBack()
    } catch (error) {
      say(errorMessage(error))
      setBusy(false)
      setAsking(false)
    }
  }

  return (
    <div class="screen">
      <header class="bar login-bar">
        <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
        <KemlockIcon size={24} class="mark" />
        <Tile name={passkey.name} size={32} />
        <h1 class="login-title">{passkey.name}</h1>
        <IconButton
          icon="trash"
          label={t('passkeys_deleteLabel')}
          onClick={() => setAsking(true)}
        />
      </header>

      {asking && (
        <div class="login-confirm">
          <Confirm
            title={t('passkeys_deleteTitle')}
            body={t('passkeys_deleteBody', passkey.userName, passkey.rpId)}
            confirmLabel={t('popup_delete')}
            cancelLabel={t('popup_cancel')}
            danger
            busy={busy}
            onCancel={() => setAsking(false)}
            onConfirm={() => void remove()}
          />
        </div>
      )}

      <div class="body tight">
        <Group>
          <div class="detail-row">
            <span class="detail-label">{t('passkeys_website')}</span>
            <span class="mono grow ellipsis">{passkey.rpId}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{t('popup_username')}</span>
            <span class="grow ellipsis">{passkey.userName === '' ? '–' : passkey.userName}</span>
          </div>
          {passkey.userDisplayName !== undefined &&
            passkey.userDisplayName !== passkey.userName && (
              <div class="detail-row">
                <span class="detail-label">{t('passkeys_displayName')}</span>
                <span class="grow ellipsis">{passkey.userDisplayName}</span>
              </div>
            )}
          <div class="detail-row">
            <span class="detail-label">{t('passkeys_created')}</span>
            <span class="grow">{formatDateTime(passkey.createdAt)}</span>
          </div>
          {passkey.changedAt > passkey.createdAt && (
            <div class="detail-row">
              <span class="detail-label">{t('passkeys_changed')}</span>
              <span class="grow">{formatDateTime(passkey.changedAt)}</span>
            </div>
          )}
        </Group>
        <p class="strength-line">{t('passkeys_keyNote')}</p>

        <Section title={t('tools_tags')}>
          <Group pad>
            <TagEditor
              kind="passkey"
              id={passkey.id}
              tags={passkey.tags ?? []}
              suggestions={allTags(
                props.vault.codes,
                props.vault.logins,
                props.vault.notes,
                props.vault.cards,
                props.vault.identities,
                (loaded.value ?? []).map((held) => ({ tags: held.tags ?? [] })),
              )}
              onChange={() => void loaded.reload()}
            />
          </Group>
        </Section>

        {logins.length > 0 && (
          <Section title={t('passkeys_logins')}>
            <Group>
              {logins.map((login: LoginView) => (
                <button
                  key={login.id}
                  type="button"
                  class="link-row hov"
                  aria-label={t('popup_openLogin', login.name)}
                  onClick={() => props.onRoute({ name: 'login', id: login.id })}
                >
                  <span class="grow lines">
                    <span class="name">{login.name}</span>
                    {login.username !== '' && <span class="label">{login.username}</span>}
                  </span>
                  <Icon name="chevron" size={16} weight={2} />
                </button>
              ))}
            </Group>
          </Section>
        )}
      </div>

      <div class="foot-bar">
        <Button
          kind="primary"
          icon="link"
          label={t('passkeys_openSite', passkey.rpId)}
          onClick={() => openSite(passkey.rpId)}
        >
          {t('passkeys_openSite', passkey.rpId)}
        </Button>
      </div>
    </div>
  )
}

/** The list's empty state: what a passkey is here, and how one gets made. */
export function PasskeysEmpty() {
  return (
    <div class="empty-state">
      <span class="empty-icon" aria-hidden="true">
        <Icon name="key" size={30} weight={1.6} />
      </span>
      <div class="empty-words">
        <p class="empty-title">{t('passkeys_noneTitle')}</p>
        <p class="empty-rest">{t('passkeys_noneBody')}</p>
      </div>
    </div>
  )
}

/**
 * Settings › Passkeys: whether Kemlock answers the browser's passkey requests, which needs the access to all sites the buttons in
 * fields need, and whether it stays out of the prompts of the site in front.
 */
export function PasskeySettings(props: {
  settings: Settings
  tab: TabView | undefined
  onSave: (patch: Partial<Settings>) => Promise<void>
  /** The access to all sites was granted from here (Site access shows it). */
  onGranted: () => void
}) {
  const say = useToast()
  const on = props.settings.passkeys !== false
  // Access to all sites and the frame list, together: the provider needs both
  const held = useLoad(() => chrome.permissions.contains(passkeyAccess))
  const [grantedNow, setGrantedNow] = useState<boolean | undefined>()
  const hasAccess = grantedNow ?? held.value ?? false
  const host = props.tab === undefined ? null : hostOf(props.tab.address)
  const here = useLoad(
    () => (host === null ? Promise.resolve(false) : ask('passkeyHere', { host })),
    [host],
  )
  const [off, setOff] = useState<boolean | undefined>()
  const offHere = off ?? here.value ?? false

  // The browser asks for a permission only from the click that wants it: no await comes before the request
  const turn = (next: boolean) => {
    if (next && !hasAccess) {
      // Both permissions in this one request, from this click, before anything is awaited
      chrome.permissions.request(passkeyAccess).then(
        (granted) => {
          setGrantedNow(granted)
          if (!granted) return say(t('popup_accessRefused'))
          props.onGranted()
          void ask('allSitesGranted').catch(() => false)
          void props.onSave({ passkeys: true })
        },
        (failure: unknown) => say(errorMessage(failure)),
      )
      return
    }
    void props.onSave({ passkeys: next })
  }

  return (
    <Section title={t('passkeys_tab')}>
      <Group>
        <Switch
          label={t('passkeys_provider')}
          detail={t('passkeys_providerDetail')}
          checked={on && hasAccess}
          onChange={turn}
        />
        {host !== null && on && hasAccess && (
          <Switch
            label={t('passkeys_onHere', host)}
            detail={t('passkeys_onHereDetail')}
            checked={!offHere}
            onChange={(checked) => {
              setOff(!checked)
              ask('passkeyHereSet', { host, off: !checked }).catch((error: unknown) => {
                setOff(undefined)
                say(errorMessage(error))
              })
            }}
          />
        )}
      </Group>
    </Section>
  )
}
