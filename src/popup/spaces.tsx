// Shared spaces in the popup (docs/plans/add-spaces.md): the card on Home, the list of spaces with making one and joining a WebDAV
// one, the badge a space's items wear, and the picker that says where an item lives.
import { useState } from 'preact/hooks'
import type { SpaceNote, SpaceRow, SpacesView } from '../shared/spaces-api'
import {
  Button,
  Notice,
  PageHeader,
  SelectField,
  Tile,
  TextField,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import type { Vault } from './data'
import type { Route } from './route'
import { ask } from './send'
import { SpaceContact } from './space-contact'
import { SpacePage } from './space-page'
import { problemText, spaceError, statusText } from './spaces-ui'
import './spaces.css'

/** A small mark on an item that lives in a space: the space's name. */
export function SpaceBadge(props: { space: SpaceNote | undefined }) {
  const { space } = props
  if (space === undefined) return null
  return (
    <span
      class={space.canEdit ? 'space-badge' : 'space-badge readonly'}
      title={
        space.canEdit ? t('spaces_inSpace', space.name) : t('spaces_inSpaceReadOnly', space.name)
      }
    >
      <Icon name="folder" size={11} weight={2} />
      <span class="ellipsis">{space.name}</span>
    </span>
  )
}

/** Home's card: where the spaces are, with what waits for the person (an invitation, a fingerprint to compare). */
export function SpacesCard(props: { onOpen: () => void }) {
  const loaded = useLoad(() => ask('spaces', { refresh: false }).catch(() => undefined))
  const view = loaded.value
  if (view === undefined) return null
  const rows = [...view.server, ...view.webdav]
  if (!view.available && rows.length === 0) return null
  const waiting = view.server.filter(
    (row) =>
      ['invited', 'compare', 'cantBeChecked'].includes(row.status) || row.problem !== undefined,
  ).length
  const sub =
    rows.length === 0
      ? t('spaces_cardNone')
      : waiting > 0
        ? t('spaces_cardWaiting', rows.length, waiting)
        : t('spaces_cardCount', rows.length)
  return (
    <button type="button" class="link-card hov spaces-card" onClick={props.onOpen}>
      <span class="spaces-card-icon" aria-hidden="true">
        <Icon name="folder" size={16} weight={2} />
      </span>
      <span class="grow lines">
        <span class="name">{t('spaces_title')}</span>
        <span class={waiting > 0 ? 'label warn-text' : 'label'}>{sub}</span>
      </span>
      <Icon name="chevron" size={16} weight={2} />
    </button>
  )
}

type SpaceRoute =
  | { name: 'list' }
  | { name: 'space'; id: string; dav?: boolean }
  | { name: 'contact'; id: string }
  | { name: 'make' }
  | { name: 'join' }

/** The spaces and what is in them: a page of its own, with its own small stack. */
export function SpacesPage(props: {
  vault: Vault
  /** A space to open first. */
  open?: string
  onBack: () => void
  onRoute: (route: Route) => void
}) {
  const [stack, setStack] = useState<SpaceRoute[]>(
    props.open === undefined
      ? [{ name: 'list' }]
      : [{ name: 'list' }, { name: 'space', id: props.open }],
  )
  const route = stack[stack.length - 1] ?? { name: 'list' }
  const go = (next: SpaceRoute) => setStack((previous) => [...previous, next])
  const back = () =>
    setStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous))
  const toList = () => setStack([{ name: 'list' }])
  switch (route.name) {
    case 'space':
      return (
        <SpacePage
          id={route.id}
          dav={route.dav === true}
          vault={props.vault}
          onBack={back}
          onLeft={() => {
            void props.vault.reload()
            toList()
          }}
          onRoute={props.onRoute}
          onContact={() => go({ name: 'contact', id: route.id })}
        />
      )
    case 'contact':
      return (
        <SpaceContact
          id={route.id}
          onBack={back}
          onDone={() => {
            void props.vault.reload()
            toList()
          }}
        />
      )
    case 'make':
      return (
        <MakeSpace
          onBack={back}
          onMade={(id) => setStack([{ name: 'list' }, { name: 'space', id }])}
        />
      )
    case 'join':
      return (
        <JoinSpace
          onBack={back}
          onJoined={() => {
            void props.vault.reload()
            toList()
          }}
        />
      )
    default:
      return (
        <SpaceList
          onBack={props.onBack}
          vault={props.vault}
          onOpen={(row) =>
            row.kind === 'webdav'
              ? go({ name: 'space', id: row.id, dav: true })
              : go({ name: row.compared ? 'space' : 'contact', id: row.id })
          }
          onMake={() => go({ name: 'make' })}
          onJoin={() => go({ name: 'join' })}
        />
      )
  }
}

function SpaceRows(props: { rows: SpaceRow[]; onOpen: (row: SpaceRow) => void }) {
  return (
    <ul class="list">
      {props.rows.map((row) => (
        <li key={row.id} class="item">
          <button type="button" class="item-main hov" onClick={() => props.onOpen(row)}>
            <Tile name={row.name} />
            <span class="grow lines">
              <span class="name ellipsis">{row.name}</span>
              <span
                class={
                  ['cantBeChecked', 'compare', 'invited', 'keysNeedReplacing'].includes(row.status)
                    ? 'label ellipsis warn-text'
                    : 'label ellipsis'
                }
              >
                {[
                  statusText(row),
                  row.members === undefined ? '' : t('spaces_members', row.members),
                  t('spaces_items', row.items),
                ]
                  .filter((part) => part !== '')
                  .join(' · ')}
              </span>
              {row.problem !== undefined && (
                <span class="label warn-text">{problemText(row.problem)}</span>
              )}
            </span>
            <Icon name="chevron" size={16} weight={2} />
          </button>
        </li>
      ))}
    </ul>
  )
}

function SpaceList(props: {
  vault: Vault
  onBack: () => void
  onOpen: (row: SpaceRow) => void
  onMake: () => void
  onJoin: () => void
}) {
  const say = useToast()
  const loaded = useLoad<SpacesView>(() => ask('spaces'))
  const [busy, setBusy] = useState(false)
  const view = loaded.value
  const refresh = async () => {
    setBusy(true)
    try {
      await ask('syncSpaces')
      await props.vault.reload()
      await loaded.reload()
    } catch (error) {
      say(spaceError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="screen">
      <PageHeader title={t('spaces_title')} onBack={props.onBack} backLabel={t('popup_back')}>
        <Button
          icon="refresh"
          busy={busy}
          label={t('spaces_refresh')}
          onClick={() => void refresh()}
        />
      </PageHeader>
      <div class="body">
        {loaded.error !== undefined && <Notice kind="error">{loaded.error}</Notice>}
        {view === undefined && loaded.error === undefined && (
          <p class="muted" role="status">
            {t('popup_loading')}
          </p>
        )}
        {view?.problem !== undefined && <Notice kind="warn">{problemText(view.problem)}</Notice>}
        {view?.homeAway !== undefined && (
          <Notice kind="warn">{t('spaces_homeAway', view.homeAway)}</Notice>
        )}
        {view !== undefined && !view.available && <Notice>{t('spaces_noAccount')}</Notice>}
        {view !== undefined && view.server.length > 0 && (
          <SpaceRows rows={view.server} onOpen={props.onOpen} />
        )}
        {view !== undefined && view.webdav.length > 0 && (
          <>
            <h2 class="label-caps list-title">{t('spaces_webdav')}</h2>
            <SpaceRows rows={view.webdav} onOpen={props.onOpen} />
          </>
        )}
        {view !== undefined && view.server.length + view.webdav.length === 0 && view.available && (
          <p class="empty muted">{t('spaces_none')}</p>
        )}
        <div class="actions start spaces-actions">
          {view?.available === true && (
            <Button kind="primary" icon="plus" onClick={props.onMake}>
              {t('spaces_make')}
            </Button>
          )}
          <Button icon="folder" onClick={props.onJoin}>
            {t('spaces_joinWebdav')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MakeSpace(props: { onBack: () => void; onMade: (id: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const make = async () => {
    setBusy(true)
    setError(undefined)
    try {
      props.onMade((await ask('spaceMake', { name: name.trim() })).id)
    } catch (failure) {
      setError(spaceError(failure))
      setBusy(false)
    }
  }
  return (
    <div class="screen">
      <PageHeader title={t('spaces_make')} onBack={props.onBack} backLabel={t('popup_back')} />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() !== '') void make()
        }}
      >
        <div class="body form-body">
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          <p class="muted">{t('spaces_makeHelp')}</p>
          <TextField label={t('spaces_name')} value={name} autofocus onInput={setName} />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={name.trim() === ''}>
            {t('spaces_makeAction')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function JoinSpace(props: { onBack: () => void; onJoined: () => void }) {
  const [invite, setInvite] = useState('')
  const [code, setCode] = useState('')
  const [folder, setFolder] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const join = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await ask('joinDavSpace', {
        invite: invite.trim(),
        code: code.trim(),
        folder: folder.trim(),
        username,
        password,
      })
      props.onJoined()
    } catch (failure) {
      setError(spaceError(failure))
      setBusy(false)
    }
  }
  const ready = invite.trim() !== '' && code.trim() !== '' && folder.trim() !== ''
  return (
    <div class="screen">
      <PageHeader
        title={t('spaces_joinWebdav')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) void join()
        }}
      >
        <div class="body form-body">
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          <p class="muted">{t('spaces_joinHelp')}</p>
          <TextField label={t('spaces_invite')} value={invite} multiline onInput={setInvite} />
          <TextField label={t('spaces_inviteCode')} value={code} mono onInput={setCode} />
          <TextField
            label={t('spaces_folder')}
            value={folder}
            type="url"
            placeholder="https://cloud.example.com/remote.php/dav/files/me/Kemlock/"
            onInput={setFolder}
          />
          <TextField label={t('spaces_davUser')} value={username} onInput={setUsername} />
          <TextField
            label={t('spaces_davPassword')}
            value={password}
            type="password"
            autocomplete="current-password"
            onInput={setPassword}
          />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={!ready}>
            {t('spaces_join')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** The places an item may go: the vault's own and each space the person confirmed in. */
export function useSpaceChoices() {
  return useLoad(async () => {
    const view = await ask('spaces', { refresh: false })
    return [...view.server, ...view.webdav].filter(
      (row) =>
        !row.problem &&
        (row.kind === 'webdav' ||
          ['owner', 'admin', 'custom', 'member', 'keysNeedReplacing'].includes(row.status)),
    )
  })
}

/** "Where does it live": the vault's own, or a space; for a server space, its collection is the first ("Everyone"). */
export function SpaceField(props: {
  value: string
  onChange: (space: string) => void
  /** The space the item is in now, which always stays among the choices. */
  current?: string
}) {
  const choices = useSpaceChoices()
  const rows = choices.value ?? []
  if (rows.length === 0 && props.current === undefined) return null
  return (
    <SelectField
      stacked
      label={t('spaces_where')}
      value={props.value}
      options={[
        { value: '', label: t('spaces_justMe') },
        ...rows.map((row) => ({ value: row.id, label: row.name })),
      ]}
      onChange={props.onChange}
    />
  )
}

/** A login's page shows where it lives, and moves it. */
export function SpaceDetail(props: {
  kind: 'login' | 'code' | 'backupCodes'
  id: string
  space: SpaceNote | undefined
  onMoved: () => void
}) {
  const say = useToast()
  const choices = useSpaceChoices()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(props.space?.id ?? '')
  const [busy, setBusy] = useState(false)
  const rows = choices.value ?? []
  // A login whose password a grant hides stays where it is: moving it would show the password
  const mayMove =
    props.space === undefined
      ? rows.length > 0
      : props.space.canEdit && props.space.passwordHidden !== true
  if (props.space === undefined && rows.length === 0) return null
  const move = async () => {
    setBusy(true)
    try {
      await ask('moveItem', {
        itemKind: props.kind,
        id: props.id,
        space: target === '' ? null : target,
      })
      setOpen(false)
      props.onMoved()
    } catch (error) {
      say(spaceError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div class="detail-row">
        <span class="detail-label">{t('spaces_where')}</span>
        <span class="grow ellipsis">
          {props.space === undefined ? t('spaces_justMe') : <SpaceBadge space={props.space} />}
        </span>
        {mayMove && (
          <button type="button" class="link-btn hov" onClick={() => setOpen((value) => !value)}>
            {t('spaces_move')}
          </button>
        )}
      </div>
      {open && (
        <div class="detail-row space-move">
          <SelectField
            stacked
            label={t('spaces_moveTo')}
            value={target}
            options={[
              { value: '', label: t('spaces_justMe') },
              ...rows.map((row) => ({ value: row.id, label: row.name })),
            ]}
            onChange={setTarget}
          />
          <Button
            kind="primary"
            busy={busy}
            disabled={target === (props.space?.id ?? '')}
            onClick={() => void move()}
          >
            {t('spaces_moveAction')}
          </Button>
        </div>
      )}
    </>
  )
}
