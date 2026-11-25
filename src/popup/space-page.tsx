// A space's page (docs/plans/add-spaces.md): its items by kind, its members, collections and grants, the policies and keys its chain
// records, and what the server holds back. Every action is offered where the verified chain says this account may make it, and
// the core checks it again: nothing here decides who may do what.
import { useState } from 'preact/hooks'
import type {
  CollectionPermission,
  HeldItemView,
  SpaceCollectionView,
  SpaceItemKind,
  SpaceItemView,
  SpaceMemberView,
  SpaceView,
} from '../shared/spaces-api'
import {
  Badge,
  Button,
  Confirm,
  Group,
  Notice,
  PageHeader,
  Section,
  SelectField,
  TextField,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import type { Vault } from './data'
import type { Route } from './route'
import { ask } from './send'
import { Digits } from './space-contact'
import { kindOrder, kindText, memberText, roleText, spaceError } from './spaces-ui'

const permissions: CollectionPermission[] = [
  'view',
  'view-hide-passwords',
  'edit',
  'edit-hide-passwords',
  'manage',
]
const permissionText: Record<CollectionPermission, string> = {
  view: 'spaces_permView',
  'view-hide-passwords': 'spaces_permViewHidden',
  edit: 'spaces_permEdit',
  'edit-hide-passwords': 'spaces_permEditHidden',
  manage: 'spaces_permManage',
}

export function SpacePage(props: {
  id: string
  dav: boolean
  vault: Vault
  onBack: () => void
  onLeft: () => void
  onRoute: (route: Route) => void
  onContact: () => void
}) {
  const loaded = useLoad<SpaceView | undefined>(async () => {
    if (props.dav) return undefined
    try {
      return await ask('space', { id: props.id })
    } catch (error) {
      throw new Error(spaceError(error), { cause: error })
    }
  }, [props.id, props.dav])
  const say = useToast()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<'leave' | undefined>()
  const [confirming, setConfirming] = useState<SpaceMemberView | undefined>()
  const [inviting, setInviting] = useState(false)
  const [adding, setAdding] = useState(false)
  const view = loaded.value

  /** One change, then the page and the vault's lists again. */
  const act = async (work: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await work()
      await props.vault.reload()
      await loaded.reload()
      if (done !== undefined) say(done)
      return true
    } catch (error) {
      say(spaceError(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  // The items of the space, from the vault's own lists when the space is a WebDAV one (it has no chain to ask)
  const davItems: SpaceItemView[] = props.dav
    ? [
        ...props.vault.logins
          .filter((login) => login.space?.id === props.id)
          .map((login) => ({
            id: login.id,
            kind: 'login' as const,
            name: login.name,
            canEdit: true,
          })),
        ...props.vault.codes
          .filter((code) => code.space?.id === props.id)
          .map((code) => ({
            id: code.id,
            kind: 'code' as const,
            name: code.issuer === '' ? code.account : code.issuer,
            canEdit: true,
          })),
        ...props.vault.backups
          .filter((backup) => backup.space?.id === props.id)
          .map((backup) => ({
            id: backup.serviceId,
            kind: 'backupCodes' as const,
            name: backup.issuer,
            canEdit: true,
          })),
      ]
    : []
  const items = props.dav ? davItems : (view?.items ?? [])
  const name =
    view?.name ??
    props.vault.logins.find((l) => l.space?.id === props.id)?.space?.name ??
    t('spaces_title')

  const leave = () =>
    void (async () => {
      setBusy(true)
      try {
        await ask(props.dav ? 'leaveDavSpace' : 'spaceLeave', { id: props.id })
        props.onLeft()
      } catch (error) {
        say(spaceError(error))
        setBusy(false)
        setAsking(undefined)
      }
    })()

  return (
    <div class="screen">
      <PageHeader title={name} onBack={props.onBack} backLabel={t('popup_back')}>
        {view !== undefined && <Badge kind="accent">{roleText(view.role)}</Badge>}
      </PageHeader>
      {asking === 'leave' && (
        <div class="login-confirm">
          <Confirm
            title={t('spaces_leaveTitle', name)}
            body={t('spaces_leaveBody')}
            confirmLabel={t('spaces_leave')}
            cancelLabel={t('popup_cancel')}
            danger
            busy={busy}
            onCancel={() => setAsking(undefined)}
            onConfirm={leave}
          />
        </div>
      )}
      <div class="body tight space-page">
        {loaded.error !== undefined && <Notice kind="error">{loaded.error}</Notice>}
        {loaded.loading && !props.dav && view === undefined && loaded.error === undefined && (
          <p class="muted" role="status">
            {t('popup_loading')}
          </p>
        )}

        {view !== undefined && (
          <>
            {view.homeAway !== undefined && (
              <Notice kind="warn">{t('spaces_homeAway', view.homeAway)}</Notice>
            )}
            {!view.compared && (
              <Notice kind="warn">
                {t('spaces_notCompared')}{' '}
                <button type="button" class="link-btn" onClick={props.onContact}>
                  {t('spaces_compareNow')}
                </button>
              </Notice>
            )}
            {view.memberStatus === 'invited' || view.memberStatus === 'accepted' ? (
              <Notice>{t('spaces_waiting')}</Notice>
            ) : null}
            {view.keys.needReplacing && <Notice kind="warn">{t('spaces_keysNeed')}</Notice>}
            {view.accountRecovery && <Notice>{t('spaces_recoveryNotice')}</Notice>}
          </>
        )}

        {props.dav && <p class="muted">{t('spaces_davHelp')}</p>}

        {(view?.compared === true || props.dav) && (
          <Section title={t('spaces_itemsTitle')}>
            <ItemsByKind
              items={items}
              busy={busy}
              onOpen={(item) => props.onRoute({ name: 'login', id: item.id })}
              onOut={(item) =>
                void act(
                  () => ask('moveItem', { itemKind: item.kind, id: item.id, space: null }),
                  t('spaces_movedOut'),
                )
              }
            />
            <div class="actions start">
              <Button
                icon="plus"
                onClick={() =>
                  props.onRoute({
                    name: 'edit',
                    id: null,
                    prefill: { name: '', password: '', websites: [], space: props.id },
                  })
                }
              >
                {t('spaces_newLogin')}
              </Button>
              <Button icon="arrowRight" onClick={() => setAdding((value) => !value)}>
                {t('spaces_addExisting')}
              </Button>
            </div>
            {adding && (
              <AddExisting
                vault={props.vault}
                space={props.id}
                collections={view?.collections ?? []}
                busy={busy}
                onMove={(kind, id, collection) =>
                  void act(
                    () =>
                      ask('moveItem', {
                        itemKind: kind,
                        id,
                        space: props.id,
                        ...(collection === '' ? {} : { collection }),
                      }),
                    t('spaces_movedIn'),
                  ).then((ok) => ok && setAdding(false))
                }
              />
            )}
          </Section>
        )}

        {view !== undefined && view.compared && (
          <>
            <Section title={t('spaces_membersTitle')}>
              <Group>
                {view.members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    busy={busy}
                    onConfirm={() => setConfirming(member)}
                    onRole={(role) =>
                      void act(
                        () => ask('spaceRole', { id: props.id, member: member.id, role }),
                        t('spaces_roleChanged'),
                      )
                    }
                    onRemove={() =>
                      void act(
                        () => ask('spaceRemove', { id: props.id, member: member.id }),
                        member.status === 'invited' || member.status === 'accepted'
                          ? t('spaces_revoked')
                          : t('spaces_removed'),
                      )
                    }
                    onResend={() =>
                      void act(
                        () => ask('spaceResend', { id: props.id, member: member.id }),
                        t('spaces_resent'),
                      )
                    }
                  />
                ))}
              </Group>
              {confirming !== undefined && confirming.digits !== undefined && (
                <Group pad>
                  <p>{t('spaces_confirmWith', confirming.name)}</p>
                  <Digits
                    digits={confirming.digits}
                    label={t('spaces_digitsOf', confirming.name)}
                  />
                  <p class="muted">{t('spaces_confirmHelp')}</p>
                  <div class="actions">
                    <Button onClick={() => setConfirming(undefined)}>{t('spaces_noMatch')}</Button>
                    <Button
                      kind="primary"
                      busy={busy}
                      onClick={() =>
                        void act(
                          () =>
                            ask('spaceConfirm', {
                              id: props.id,
                              member: confirming.id,
                              digits: confirming.digits ?? '',
                            }),
                          t('spaces_confirmed', confirming.name),
                        ).then((ok) => ok && setConfirming(undefined))
                      }
                    >
                      {t('spaces_itMatches')}
                    </Button>
                  </div>
                </Group>
              )}
              {view.canInvite && (
                <div class="actions start">
                  <Button icon="plus" onClick={() => setInviting((value) => !value)}>
                    {t('spaces_invite')}
                  </Button>
                </div>
              )}
              {inviting && (
                <InviteForm
                  busy={busy}
                  onInvite={(email, role) =>
                    void act(
                      () => ask('spaceInvite', { id: props.id, email, role }),
                      t('spaces_invited'),
                    ).then((ok) => ok && setInviting(false))
                  }
                />
              )}
            </Section>

            <Section title={t('spaces_collectionsTitle')}>
              {view.collections.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  busy={busy}
                  onGrant={(member, permission) =>
                    void act(() =>
                      ask('spaceGrant', {
                        id: props.id,
                        collection: collection.id,
                        member,
                        permission,
                      }),
                    )
                  }
                />
              ))}
            </Section>

            <Section title={t('spaces_policiesTitle')}>
              <Group pad>
                {view.policies.flags.length === 0 && view.policies.minLength === undefined && (
                  <p class="muted">{t('spaces_policyNone')}</p>
                )}
                {view.policies.flags.map((flag) => (
                  <p key={flag}>{t('spaces_policyOn', flag)}</p>
                ))}
                {view.policies.minLength !== undefined && (
                  <p>{t('spaces_policyMinLength', view.policies.minLength)}</p>
                )}
                <p class="muted">{t('spaces_policyKeys', view.keys.spaceKeyVersion)}</p>
              </Group>
            </Section>

            <Held id={props.id} onChanged={() => void act(async () => undefined)} />

            {view.canLeave && (
              <div class="actions start">
                <Button kind="danger" onClick={() => setAsking('leave')}>
                  {t('spaces_leave')}
                </Button>
              </div>
            )}
            {view.onlyOwner && <p class="muted">{t('spaces_onlyOwner')}</p>}
          </>
        )}

        {props.dav && (
          <div class="actions start">
            <Button kind="danger" onClick={() => setAsking('leave')}>
              {t('spaces_leave')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function ItemsByKind(props: {
  items: SpaceItemView[]
  busy: boolean
  onOpen: (item: SpaceItemView) => void
  onOut: (item: SpaceItemView) => void
}) {
  if (props.items.length === 0) return <p class="empty muted">{t('spaces_noItems')}</p>
  return (
    <>
      {kindOrder.map((kind: SpaceItemKind) => {
        const these = props.items.filter((item) => item.kind === kind)
        if (these.length === 0) return null
        return (
          <div key={kind} class="space-kind">
            <h3 class="label-caps list-title">{t(kindText[kind])}</h3>
            <ul class="list">
              {these.map((item) => (
                <li key={item.id} class="item">
                  <span class="item-main">
                    <span class="grow lines">
                      <span class="name ellipsis">{item.name}</span>
                      {!item.canEdit && <span class="label">{t('spaces_readOnly')}</span>}
                    </span>
                  </span>
                  {item.kind === 'login' && (
                    <button type="button" class="link-btn hov" onClick={() => props.onOpen(item)}>
                      {t('spaces_open')}
                    </button>
                  )}
                  {item.canEdit && item.passwordHidden !== true && (
                    <button
                      type="button"
                      class="link-btn quiet"
                      disabled={props.busy}
                      onClick={() => props.onOut(item)}
                    >
                      {t('spaces_moveOut')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}

/** The vault's own items that can go in the space: a login, a code or a backup-code service the person picks. */
function AddExisting(props: {
  vault: Vault
  space: string
  collections: SpaceCollectionView[]
  busy: boolean
  onMove: (kind: SpaceItemKind, id: string, collection: string) => void
}) {
  const [collection, setCollection] = useState('')
  const own = [
    ...props.vault.logins
      .filter((login) => login.space === undefined)
      .map((login) => ({ kind: 'login' as const, id: login.id, name: login.name })),
    ...props.vault.codes
      .filter((code) => code.space === undefined && !code.onSecurityKey)
      .map((code) => ({
        kind: 'code' as const,
        id: code.id,
        name: code.issuer === '' ? code.account : `${code.issuer} · ${code.account}`,
      })),
    ...props.vault.backups
      .filter((backup) => backup.space === undefined)
      .map((backup) => ({
        kind: 'backupCodes' as const,
        id: backup.serviceId,
        name: backup.issuer,
      })),
  ]
  const mine = props.collections.filter(
    (c) => c.myAccess !== undefined && !c.myAccess.startsWith('view'),
  )
  return (
    <Group pad>
      {mine.length > 1 && (
        <SelectField
          stacked
          label={t('spaces_collection')}
          value={collection}
          options={[
            { value: '', label: t('spaces_firstCollection') },
            ...mine.map((c) => ({ value: c.id, label: c.id.slice(0, 8) })),
          ]}
          onChange={setCollection}
        />
      )}
      {own.length === 0 ? (
        <p class="muted">{t('spaces_nothingToAdd')}</p>
      ) : (
        <ul class="list">
          {own.map((item) => (
            <li key={`${item.kind}:${item.id}`} class="item">
              <span class="item-main">
                <span class="grow lines">
                  <span class="name ellipsis">{item.name}</span>
                  <span class="label">{t(kindText[item.kind])}</span>
                </span>
              </span>
              <button
                type="button"
                class="link-btn hov"
                disabled={props.busy}
                onClick={() => props.onMove(item.kind, item.id, collection)}
              >
                {t('spaces_moveIn')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Group>
  )
}

function MemberRow(props: {
  member: SpaceMemberView
  busy: boolean
  onConfirm: () => void
  onRole: (role: 'owner' | 'admin' | 'member') => void
  onRemove: () => void
  onResend: () => void
}) {
  const { member } = props
  const pending = member.status === 'invited' || member.status === 'accepted'
  return (
    <div class="detail-row member-row">
      <span class="grow lines">
        <span class="name ellipsis">{member.you ? t('spaces_you', member.name) : member.name}</span>
        <span class="label">
          {roleText(member.role)} · {memberText(member.status)}
        </span>
      </span>
      {member.canConfirm && (
        <button type="button" class="link-btn hov" disabled={props.busy} onClick={props.onConfirm}>
          {t('spaces_confirm')}
        </button>
      )}
      {member.canResend && (
        <button type="button" class="link-btn quiet" disabled={props.busy} onClick={props.onResend}>
          {t('spaces_resend')}
        </button>
      )}
      {member.roles.length > 0 && (
        <select
          class="role-select"
          aria-label={t('spaces_roleOf', member.name)}
          value=""
          disabled={props.busy}
          onChange={(event) => {
            const role = event.currentTarget.value
            if (role === 'owner' || role === 'admin' || role === 'member') props.onRole(role)
          }}
        >
          <option value="">{t('spaces_role')}</option>
          {member.roles.map((role) => (
            <option key={role} value={role}>
              {roleText(role)}
            </option>
          ))}
        </select>
      )}
      {member.canRemove && (
        <button type="button" class="link-btn quiet" disabled={props.busy} onClick={props.onRemove}>
          {pending ? t('spaces_revoke') : t('spaces_remove')}
        </button>
      )}
    </div>
  )
}

function InviteForm(props: {
  busy: boolean
  onInvite: (email: string, role: 'owner' | 'admin' | 'member') => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'owner' | 'admin' | 'member'>('member')
  return (
    <Group pad>
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (email.trim() !== '') props.onInvite(email.trim(), role)
        }}
      >
        <TextField
          label={t('spaces_email')}
          value={email}
          type="text"
          autocomplete="off"
          onInput={setEmail}
        />
        <SelectField
          stacked
          label={t('spaces_role')}
          value={role}
          options={[
            { value: 'member', label: roleText('member') },
            { value: 'admin', label: roleText('admin') },
            { value: 'owner', label: roleText('owner') },
          ]}
          onChange={setRole}
        />
        <p class="muted">{t('spaces_inviteHelp')}</p>
        <div class="actions">
          <Button kind="primary" type="submit" busy={props.busy} disabled={email.trim() === ''}>
            {t('spaces_sendInvite')}
          </Button>
        </div>
      </form>
    </Group>
  )
}

function CollectionCard(props: {
  collection: SpaceCollectionView
  busy: boolean
  onGrant: (member: string, permission: CollectionPermission | null) => void
}) {
  const { collection } = props
  return (
    <Group pad class="collection">
      <p class="name mono">{collection.id.slice(0, 8)}</p>
      <p class="label">
        {t('spaces_keyVersion', collection.keyVersion)}
        {collection.marked ? ` · ${t('spaces_keyMarked')}` : ''}
      </p>
      {collection.grants.length === 0 && <p class="muted">{t('spaces_noGrants')}</p>}
      {collection.grants.map((grant) => (
        <div key={grant.grantee} class="grant-row">
          <span class="grow ellipsis">{grant.group ? t('spaces_group') : grant.name}</span>
          {collection.canGrant && !grant.group ? (
            <select
              aria-label={t('spaces_permissionOf', grant.name)}
              value={grant.permission}
              disabled={props.busy}
              onChange={(event) => {
                const next = event.currentTarget.value
                if (next === '') props.onGrant(grant.grantee.replace(/^user:/, ''), null)
                else if (permissions.includes(next as CollectionPermission))
                  props.onGrant(grant.grantee.replace(/^user:/, ''), next as CollectionPermission)
              }}
            >
              {permissions.map((permission) => (
                <option key={permission} value={permission}>
                  {t(permissionText[permission])}
                </option>
              ))}
              <option value="">{t('spaces_takeGrant')}</option>
            </select>
          ) : (
            <span class="label">{t(permissionText[grant.permission])}</span>
          )}
        </div>
      ))}
      {collection.canGrant && collection.withoutGrant.length > 0 && (
        <select
          aria-label={t('spaces_give')}
          value=""
          disabled={props.busy}
          onChange={(event) => {
            const member = event.currentTarget.value
            if (member !== '') props.onGrant(member, 'view')
          }}
        >
          <option value="">{t('spaces_give')}</option>
          {collection.withoutGrant.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      )}
      {collection.myAccess?.endsWith('Hidden') === true && (
        <p class="muted">{t('spaces_hiddenHelp')}</p>
      )}
    </Group>
  )
}

/** The items the server holds back: kept (written again under the current key) or deleted, by someone who may edit. */
function Held(props: { id: string; onChanged: () => void }) {
  const [shown, setShown] = useState(false)
  const say = useToast()
  const held = useLoad<HeldItemView[]>(
    async () => (shown ? ask('spaceHeld', { id: props.id }) : []),
    [shown, props.id],
  )
  const items = held.value ?? []
  const release = async (item: HeldItemView, keep: boolean) => {
    try {
      await ask(keep ? 'spaceKeepHeld' : 'spaceDeleteHeld', { id: props.id, item: item.id })
      await held.reload()
      props.onChanged()
    } catch (error) {
      say(spaceError(error))
    }
  }
  return (
    <Section title={t('spaces_heldTitle')}>
      {!shown ? (
        <div class="actions start">
          <Button onClick={() => setShown(true)}>{t('spaces_heldShow')}</Button>
        </div>
      ) : (
        <Group pad>
          {held.error !== undefined && <Notice kind="error">{held.error}</Notice>}
          {items.length === 0 && held.error === undefined && (
            <p class="muted">{t('spaces_heldNone')}</p>
          )}
          {items.length > 0 && <p class="muted">{t('spaces_heldHelp')}</p>}
          {items.map((item) => (
            <div key={item.id} class="grant-row">
              <span class="grow ellipsis">
                {item.name === '' ? item.id.slice(0, 8) : item.name}
              </span>
              {item.canKeep && (
                <button type="button" class="link-btn hov" onClick={() => void release(item, true)}>
                  {t('spaces_heldKeep')}
                </button>
              )}
              <button
                type="button"
                class="link-btn quiet"
                onClick={() => void release(item, false)}
              >
                {t('spaces_heldDelete')}
              </button>
            </div>
          ))}
        </Group>
      )}
    </Section>
  )
}
