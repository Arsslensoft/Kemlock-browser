// The settings' sync card: where the vault syncs, when it last did, and what stopped it, in the
// app's words. Logins sync through Kemlock Server and WebDAV, and Vaultwarden keeps them in this
// browser: the card says so.
import { useState } from 'preact/hooks'
import type { SyncStatus } from '../shared/api'
import { Button, Confirm, Group, Notice, Section, useLoad, useToast } from '../shared/ui/components'
import { errorMessage, formatDateTime, problemMessage, t } from '../shared/ui/i18n'
import { AccountActions } from './account-actions'
import { openSetup } from './links'
import { ask } from './send'
import { placeNames, rememberPlace, signInProblems } from './sync-state'

/** What an entry the removal guard names is, in the popup's words (kinds the core doesn't know show as "Item"). */
const kindNames: Record<string, string> = {
  code: 'popup_removalKindCode',
  backupCodes: 'popup_removalKindBackupCodes',
  login: 'popup_removalKindLogin',
  note: 'popup_removalKindNote',
  file: 'popup_removalKindFile',
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
      <p class="removal-review-title">{t('popup_removalsListTitle')}</p>
      {items.length === 0 ? (
        <p class="muted small">{t('popup_removalsNoList')}</p>
      ) : (
        <ul class="removal-list">
          {items.map((item, index) => (
            <li key={index}>
              <span class="removal-name">
                {item.name === '' ? t('popup_removalsUnnamed') : item.name}
              </span>
              <span class="muted removal-kind">
                {t(kindNames[item.kind] ?? 'popup_removalKindOther')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {count > items.length && items.length > 0 && (
        <p class="removal-more">{t('popup_removalsMore', count - items.length)}</p>
      )}
    </div>
  )
}

function Row(props: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt>{props.label}</dt>
      <dd class={props.mono ? 'mono' : undefined}>{props.value}</dd>
    </>
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
  const update = (next: SyncStatus | null) => {
    setCurrent(next)
    void rememberPlace(next)
  }

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
        <Group pad>
          <p class="muted">{t('popup_syncOff')}</p>
          <div class="actions start">
            <Button onClick={() => openSetup('again')}>{t('popup_setUpSync')}</Button>
          </div>
        </Group>
      </Section>
    )
  }

  const removals = shown.problem === 'removals' || (shown.pendingRemovals ?? 0) > 0
  const needsSignIn = shown.problem !== undefined && signInProblems.includes(shown.problem)
  const showProblem = shown.problem !== undefined && shown.problem !== 'removals'
  const pending = shown.pendingRemovals ?? 0

  return (
    <Section title={t('popup_sync')}>
      <Group class="sync-card">
        <dl class="kvs">
          <Row label={t('popup_syncPlace')} value={t(placeNames[shown.place])} />
          {shown.server !== '' && <Row label={t('popup_syncServer')} value={shown.server} mono />}
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

        <div class="sync-body">
          <AccountActions place={shown.place} problem={shown.problem} />

          {(shown.loginsNotSynced === true || shown.place === 'vaultwarden') && (
            <Notice>{t('popup_loginsNotSynced')}</Notice>
          )}

          {showProblem && (
            <Notice kind="warn">
              <p>{problemMessage(shown.problem ?? '')}</p>
              {needsSignIn && (
                <div class="actions start">
                  <Button kind="warn" onClick={() => openSetup('signin')}>
                    {t('popup_signInAgain')}
                  </Button>
                </div>
              )}
            </Notice>
          )}

          {removals && asking !== 'removals' && (
            <div class="removal-guard" role="group" aria-labelledby="removal-title">
              <p class="removal-title" id="removal-title">
                {shown.scopeSize !== undefined
                  ? t('popup_removalsOf', pending, shown.scopeSize)
                  : t('popup_removalsCount', pending)}
              </p>
              <p class="removal-hint">{t('popup_removalsKeepHint')}</p>
              {reviewing && <RemovalList status={shown} />}
              <div class="actions split">
                <Button
                  kind="primary"
                  busy={busy}
                  onClick={() => void run(() => ask('keepRemovals'))}
                >
                  {t('popup_removalsKeep')}
                </Button>
                <Button
                  disabled={busy}
                  expanded={reviewing}
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
              title={t('popup_removalsTitle', pending)}
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
            asking !== 'removals' && (
              <div class="actions split">
                <Button
                  kind="primary"
                  busy={busy || shown.running}
                  onClick={() => void run(() => ask('syncNow'))}
                >
                  {busy || shown.running ? t('popup_syncing') : t('popup_syncNow')}
                </Button>
                <Button onClick={() => setAsking('signOut')}>{t('popup_signOut')}</Button>
              </div>
            )
          )}
        </div>
      </Group>
    </Section>
  )
}
