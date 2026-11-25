// Emergency access (docs/crypto.md, "The sealed box"): a contact the account names, the wait before they can ask, and the root key sealed
// to their kx1 key. The grantor compares the contact's fingerprint before the key is sealed; the contact asks, and the grantor may answer
// before the wait ends. The server's part ends at releasing the sealed key, so the contact's side fetches it and says whether it opens.
import { useState } from 'preact/hooks'
import type { EmergencyKind, GrantView } from '../shared/account'
import {
  Badge,
  Button,
  Confirm,
  Group,
  Notice,
  Section,
  SelectField,
  TextField,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { described } from './errors'
import { dateOf } from './format'
import { contactAction, daysLeft, grantorActions } from './model'
import { account } from './send'
import { useRunner } from './use'

interface Confirming {
  id: string
  name: string
  fingerprint: string
}

const stateTone = (state: GrantView['grant']['state']): 'accent' | 'warn' | 'neutral' =>
  state === 'confirmed' || state === 'approved'
    ? 'accent'
    : state === 'recovery-initiated'
      ? 'warn'
      : 'neutral'

function Fingerprint({ text }: { text: string }) {
  return (
    <p class="fingerprint mono" aria-label={t('account_emergency_fingerprintLabel')}>
      {text}
    </p>
  )
}

export function EmergencyPanel() {
  const say = useToast()
  const overview = useLoad(async () => described(account('emergency')))
  const runner = useRunner()
  const [adding, setAdding] = useState(false)
  const [email, setEmail] = useState('')
  const [kind, setKind] = useState<EmergencyKind>('view')
  const [wait, setWait] = useState('7')
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [removing, setRemoving] = useState<GrantView | null>(null)
  const [released, setReleased] = useState<{
    who: string
    kind: EmergencyKind
    opens: boolean
  } | null>(null)
  const now = Date.now()
  const waitDays = Number.parseInt(wait, 10)
  const validWait = Number.isInteger(waitDays) && waitDays >= 1 && waitDays <= 90

  const change = (work: () => Promise<unknown>, done?: string) =>
    void runner.run(async () => {
      await work()
      if (done !== undefined) say(done)
      await overview.reload()
    })

  const invite = (event: Event) => {
    event.preventDefault()
    if (email.trim() === '' || !validWait) return
    change(async () => {
      await account('emergencyInvite', { email: email.trim(), kind, waitDays })
      setEmail('')
      setAdding(false)
    }, t('account_emergency_invited'))
  }

  const startConfirm = (view: GrantView) =>
    void runner.run(async () => {
      const found = await account('emergencyContact', { id: view.grant.id })
      setConfirming({ id: view.grant.id, name: found.name, fingerprint: found.fingerprint })
    })

  const confirm = (open: Confirming) =>
    change(
      async () => {
        await account('emergencyConfirm', { id: open.id, fingerprint: open.fingerprint })
        setConfirming(null)
      },
      t('account_emergency_confirmed', confirming?.name ?? ''),
    )

  const step = (id: string, which: 'accept' | 'initiate' | 'approve' | 'reject', done: string) =>
    change(() => account('emergencyStep', { id, step: which }), done)

  const getKey = (view: GrantView) =>
    void runner.run(async () => {
      const key = await account('emergencyKey', { id: view.grant.id })
      setReleased({ who: view.grantorEmail ?? key.grantorId, kind: key.kind, opens: key.opens })
    })

  const trusted = overview.value?.trusted
  const grantors = overview.value?.grantors

  return (
    <Section title={t('account_emergency_title')}>
      <p class="lead">{t('account_emergency_lead')}</p>
      {overview.error !== undefined ? <Notice kind="error">{overview.error}</Notice> : null}
      {runner.error !== null ? <Notice kind="error">{runner.error}</Notice> : null}

      {confirming !== null ? (
        <Group pad class="confirm-contact">
          <h3 class="subtitle">{t('account_emergency_confirmTitle', confirming.name)}</h3>
          <p>{t('account_emergency_confirmBody', confirming.name)}</p>
          <Fingerprint text={confirming.fingerprint} />
          <div class="actions start">
            <Button kind="primary" busy={runner.busy} onClick={() => confirm(confirming)}>
              {t('account_emergency_matches')}
            </Button>
            <Button disabled={runner.busy} onClick={() => setConfirming(null)}>
              {t('account_emergency_notNow')}
            </Button>
          </div>
        </Group>
      ) : null}

      <div class="section-head">
        <h3 class="subtitle">{t('account_emergency_trusted')}</h3>
        <Button icon="plus" expanded={adding} onClick={() => setAdding((open) => !open)}>
          {t('account_emergency_add')}
        </Button>
      </div>
      {adding ? (
        <form class="stack-12" noValidate onSubmit={invite} aria-label={t('account_emergency_add')}>
          <TextField
            label={t('account_emergency_email')}
            value={email}
            onInput={setEmail}
            hint={t('account_emergency_emailHint')}
          />
          <SelectField
            stacked
            label={t('account_emergency_kind')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'view', label: t('account_emergency_kind_view') },
              { value: 'takeover', label: t('account_emergency_kind_takeover') },
            ]}
          />
          <TextField
            label={t('account_emergency_wait')}
            value={wait}
            onInput={setWait}
            invalid={!validWait}
            hint={t('account_emergency_waitHint')}
          />
          <div class="actions start">
            <Button
              type="submit"
              kind="primary"
              busy={runner.busy}
              disabled={email.trim() === '' || !validWait}
            >
              {t('account_emergency_invite')}
            </Button>
          </div>
        </form>
      ) : null}
      {trusted === undefined ? (
        overview.loading ? (
          <p class="muted" role="status">
            {t('account_loading')}
          </p>
        ) : null
      ) : trusted.length === 0 ? (
        <Group pad>
          <p class="muted">{t('account_emergency_none')}</p>
        </Group>
      ) : (
        <Group>
          {trusted.map((view) => {
            const { grant } = view
            const left = daysLeft(grant.dueAt, now)
            const actions = grantorActions(grant.state)
            return (
              <div class="item" key={grant.id}>
                <div class="grow">
                  <div class="row names">
                    <span class="strong">{grant.granteeEmail}</span>
                    <Badge kind={stateTone(grant.state)}>
                      {t(`account_emergency_state_${grant.state.replace('-', '_')}`)}
                    </Badge>
                  </div>
                  <div class="muted small">
                    {t(
                      'account_emergency_line',
                      t(`account_emergency_kind_${grant.kind}`),
                      grant.waitDays,
                    )}
                    {left !== null ? ` · ${t('account_emergency_due', left)}` : ''}
                  </div>
                </div>
                <div class="actions">
                  {actions.includes('confirm') ? (
                    <Button
                      kind="primary"
                      disabled={runner.busy}
                      label={t('account_emergency_confirmFor', grant.granteeEmail)}
                      onClick={() => startConfirm(view)}
                    >
                      {t('account_emergency_confirmStart')}
                    </Button>
                  ) : null}
                  {actions.includes('reject') ? (
                    <Button
                      disabled={runner.busy}
                      label={t('account_emergency_rejectFor', grant.granteeEmail)}
                      onClick={() => step(grant.id, 'reject', t('account_emergency_rejected'))}
                    >
                      {t('account_emergency_reject')}
                    </Button>
                  ) : null}
                  {actions.includes('approve') ? (
                    <Button
                      kind="primary"
                      disabled={runner.busy}
                      label={t('account_emergency_approveFor', grant.granteeEmail)}
                      onClick={() => step(grant.id, 'approve', t('account_emergency_approved'))}
                    >
                      {t('account_emergency_approve')}
                    </Button>
                  ) : null}
                  <Button
                    kind="danger"
                    disabled={runner.busy}
                    label={t('account_emergency_removeFor', grant.granteeEmail)}
                    onClick={() => setRemoving(view)}
                  >
                    {t('account_emergency_remove')}
                  </Button>
                </div>
              </div>
            )
          })}
        </Group>
      )}

      {grantors !== undefined && grantors.length > 0 ? (
        <>
          <h3 class="subtitle">{t('account_emergency_grantors')}</h3>
          <Group>
            {grantors.map((view) => {
              const { grant } = view
              const who = view.grantorEmail ?? grant.grantorId
              const action = contactAction(grant.state)
              return (
                <div class="item" key={grant.id}>
                  <div class="grow">
                    <div class="row names">
                      <span class="strong">{who}</span>
                      <Badge kind={stateTone(grant.state)}>
                        {t(`account_emergency_state_${grant.state.replace('-', '_')}`)}
                      </Badge>
                    </div>
                    <div class="muted small">
                      {t(
                        'account_emergency_line',
                        t(`account_emergency_kind_${grant.kind}`),
                        grant.waitDays,
                      )}
                      {grant.dueAt !== null
                        ? ` · ${t('account_emergency_until', dateOf(grant.dueAt))}`
                        : ''}
                    </div>
                  </div>
                  <div class="actions">
                    {action === 'accept' ? (
                      <Button
                        kind="primary"
                        disabled={runner.busy}
                        label={t('account_emergency_acceptFor', who)}
                        onClick={() => step(grant.id, 'accept', t('account_emergency_accepted'))}
                      >
                        {t('account_emergency_accept')}
                      </Button>
                    ) : null}
                    {action === 'ask' ? (
                      <Button
                        disabled={runner.busy}
                        label={t('account_emergency_askFor', who)}
                        onClick={() => step(grant.id, 'initiate', t('account_emergency_asked'))}
                      >
                        {t('account_emergency_ask')}
                      </Button>
                    ) : null}
                    {action === 'key' ? (
                      <Button
                        disabled={runner.busy}
                        label={t('account_emergency_keyFor', who)}
                        onClick={() => getKey(view)}
                      >
                        {t('account_emergency_key')}
                      </Button>
                    ) : null}
                    <Button
                      kind="danger"
                      disabled={runner.busy}
                      label={t('account_emergency_leaveFor', who)}
                      onClick={() => setRemoving(view)}
                    >
                      {t('account_emergency_leave')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </Group>
        </>
      ) : null}

      {released !== null ? (
        <Notice kind={released.opens ? 'ok' : 'error'}>
          <strong>{t('account_emergency_releasedTitle', released.who)}</strong>
          <p>
            {released.opens
              ? t(`account_emergency_released_${released.kind}`)
              : t('account_emergency_releasedBad')}
          </p>
        </Notice>
      ) : null}

      {removing !== null ? (
        <Confirm
          title={t('account_emergency_removeTitle')}
          body={t('account_emergency_removeBody')}
          confirmLabel={t('account_emergency_remove')}
          cancelLabel={t('account_cancel')}
          danger
          busy={runner.busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            change(async () => {
              await account('emergencyRevoke', { id: removing.grant.id })
              setRemoving(null)
            }, t('account_emergency_removed'))
          }
        />
      ) : null}
    </Section>
  )
}
