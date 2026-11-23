// The settings' sync card: where the vault syncs, when it last did, and what stopped it, in the
// app's words. Nothing here syncs logins through Vaultwarden: the card says so.
import { useState } from 'preact/hooks'
import type { SyncPlace, SyncStatus } from '../shared/api'
import { Button, Confirm, Notice, Section, useLoad, useToast } from '../shared/ui/components'
import { errorMessage, formatDateTime, problemMessage, t } from '../shared/ui/i18n'
import { openSetup } from './links'
import { ask } from './send'

const placeNames: Record<SyncPlace, string> = {
  kemlock: 'popup_placeKemlock',
  webdav: 'popup_placeWebdav',
  vaultwarden: 'popup_placeVaultwarden',
}

/** The problems a new sign-in answers; setup holds the sign-in steps, not the popup. */
const signInProblems = ['signedOut', 'auth', 'sessionEnded', 'sessionReused', 'kemlockAddress']

/** What an entry the removal guard names is, in the popup's words (kinds the core doesn't know show as "Item"). */
const kindNames: Record<string, string> = {
  code: 'popup_removalKindCode',
  backupCodes: 'popup_removalKindBackupCodes',
  login: 'popup_removalKindLogin',
  note: 'popup_removalKindNote',
  card: 'popup_removalKindCard',
  identity: 'popup_removalKindIdentity',
  key: 'popup_removalKindKey',
  passkey: 'popup_removalKindPasskey',
  contact: 'popup_removalKindContact',
}

/** "would remove 6 of 22 items", and the names behind the number when the sync can give them. */
function RemovalList(props: { status: SyncStatus }) {
  const items = props.status.pendingRemovalItems ?? []
  const count = props.status.pendingRemovals ?? items.length
  return (
    <div class="removal-review">
      <p class="strong">{t('popup_removalsListTitle')}</p>
      {items.length === 0 ? (
        <p class="muted">{t('popup_removalsNoList')}</p>
      ) : (
        <ul class="removal-list">
          {items.map((item, index) => (
            <li key={index}>
              <span>{item.name === '' ? t('popup_removalsUnnamed') : item.name}</span>
              <span class="muted">{t(kindNames[item.kind] ?? 'popup_removalKindOther')}</span>
            </li>
          ))}
        </ul>
      )}
      {count > items.length && items.length > 0 && (
        <p class="muted">{t('popup_removalsMore', count - items.length)}</p>
      )}
    </div>
  )
}

function Row(props: { label: string; value: string }) {
  return (
    <div class="kv">
      <dt class="muted">{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  )
}

export function SyncCard() {
  const say = useToast()
  const status = useLoad(() => ask('syncStatus'))
  const [current, setCurrent] = useState<SyncStatus | null | undefined>(undefined)
  const [asking, setAsking] = useState<'removals' | 'signOut' | undefined>()
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)

  const shown = current !== undefined ? current : status.value
  const update = (next: SyncStatus | null) => setCurrent(next)

  const run = async (work: () => Promise<SyncStatus | null>) => {
    setBusy(true)
    try {
      update(await work())
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
      setAsking(undefined)
      setReviewing(false)
    }
  }

  if (status.loading) return <Section title={t('popup_sync')} />
  if (status.error !== undefined && shown === undefined) {
    return (
      <Section title={t('popup_sync')}>
        <Notice kind="error">{status.error}</Notice>
      </Section>
    )
  }
  if (shown === null || shown === undefined) {
    return (
      <Section title={t('popup_sync')}>
        <p class="muted">{t('popup_syncOff')}</p>
        <div class="actions start">
          <Button onClick={() => openSetup('again')}>{t('popup_setUpSync')}</Button>
        </div>
      </Section>
    )
  }

  const removals = shown.problem === 'removals' || (shown.pendingRemovals ?? 0) > 0
  const needsSignIn = shown.problem !== undefined && signInProblems.includes(shown.problem)

  return (
    <Section title={t('popup_sync')}>
      <dl class="kvs">
        <Row label={t('popup_syncPlace')} value={t(placeNames[shown.place])} />
        {shown.server !== '' && <Row label={t('popup_syncServer')} value={shown.server} />}
        {shown.account !== undefined && (
          <Row label={t('popup_syncAccount')} value={shown.account} />
        )}
        {shown.storage !== undefined && (
          <Row
            label={t('popup_syncStorage')}
            value={t(shown.storage === 'sealed' ? 'popup_storageSealed' : 'popup_storagePlain')}
          />
        )}
        {shown.home !== undefined && <Row label={t('popup_syncHome')} value={shown.home} />}
        <Row
          label={t('popup_syncLast')}
          value={shown.lastSync === undefined ? t('popup_never') : formatDateTime(shown.lastSync)}
        />
        {shown.deviceName !== undefined && (
          <Row label={t('popup_syncDevice')} value={shown.deviceName} />
        )}
      </dl>

      {shown.loginsNotSynced === true && <Notice>{t('popup_loginsNotSynced')}</Notice>}

      {shown.problem !== undefined && (
        <Notice kind="warn">
          <p>{problemMessage(shown.problem)}</p>
          {needsSignIn && (
            <div class="actions start">
              <Button onClick={() => openSetup('signin')}>{t('popup_signInAgain')}</Button>
            </div>
          )}
        </Notice>
      )}

      {removals && asking !== 'removals' && (
        <div class="removal-guard">
          <p class="strong">
            {shown.scopeSize !== undefined
              ? t('popup_removalsOf', shown.pendingRemovals ?? 0, shown.scopeSize)
              : t('popup_removalsCount', shown.pendingRemovals ?? 0)}
          </p>
          <p class="muted">{t('popup_removalsKeepHint')}</p>
          {reviewing && <RemovalList status={shown} />}
          <div class="actions start">
            <Button kind="primary" busy={busy} onClick={() => void run(() => ask('keepRemovals'))}>
              {t('popup_removalsKeep')}
            </Button>
            <Button
              disabled={busy}
              label={reviewing ? t('popup_removalsHide') : undefined}
              onClick={() => setReviewing(!reviewing)}
            >
              {t('popup_removalsReview')}
            </Button>
            <Button kind="danger" disabled={busy} onClick={() => setAsking('removals')}>
              {t('popup_removalsRemove')}
            </Button>
          </div>
        </div>
      )}
      {asking === 'removals' && (
        <Confirm
          title={t('popup_removalsTitle', shown.pendingRemovals ?? 0)}
          body={t('popup_removalsBody')}
          confirmLabel={t('popup_removalsRemove')}
          cancelLabel={t('popup_cancel')}
          danger
          busy={busy}
          onCancel={() => setAsking(undefined)}
          onConfirm={() => void run(() => ask('confirmRemovals'))}
        />
      )}

      {asking === 'signOut' ? (
        <Confirm
          title={t('popup_signOutTitle')}
          body={t('popup_signOutBody')}
          confirmLabel={t('popup_signOut')}
          cancelLabel={t('popup_cancel')}
          danger
          busy={busy}
          onCancel={() => setAsking(undefined)}
          onConfirm={() =>
            void run(async () => {
              await ask('signOut')
              return null
            })
          }
        />
      ) : (
        <div class="actions">
          <Button
            kind="primary"
            busy={busy || shown.running}
            onClick={() => void run(() => ask('syncNow'))}
          >
            {busy || shown.running ? t('popup_syncing') : t('popup_syncNow')}
          </Button>
          <Button onClick={() => setAsking('signOut')}>{t('popup_signOut')}</Button>
        </div>
      )}
    </Section>
  )
}
