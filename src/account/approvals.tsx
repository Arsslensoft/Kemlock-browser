// Devices waiting to be approved: the five words the core worked out from the request's one-time key, to compare with the new device's,
// and a click to approve (the root key is sealed to that key) or deny. The server's own words are never shown.
import { useState } from 'preact/hooks'
import type { ApprovalView } from '../shared/account'
import { Button, Group, Notice, Section, useToast } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { kindName, relativeAge } from './format'
import { canApprove } from './model'
import { account } from './send'
import { useRunner } from './use'

function Request({ approval, reload }: { approval: ApprovalView; reload: () => Promise<void> }) {
  const say = useToast()
  const runner = useRunner()
  const [answered, setAnswered] = useState(false)
  const answer = (op: 'approve' | 'deny') =>
    void runner.run(async () => {
      await account(op, { id: approval.id })
      setAnswered(true)
      say(t(op === 'approve' ? 'account_approvals_approved' : 'account_approvals_denied'))
      await reload()
    })
  const words = approval.phrase
  return (
    <li class="request">
      <div class="request-head">
        <span class="strong">{approval.deviceName}</span>
        <span class="muted small">
          {t('account_approvals_from', kindName(approval.deviceKind), approval.ip)} ·{' '}
          {relativeAge(approval.ageSeconds)}
        </span>
      </div>
      {words === null ? (
        <Notice kind="error">{t('account_approvals_nokey')}</Notice>
      ) : (
        <>
          <ol class="words" aria-label={t('account_approvals_words')}>
            {words.map((word, i) => (
              <li key={`${i}-${word}`}>
                <span class="n mono" aria-hidden="true">
                  {i + 1}
                </span>
                <span class="word mono">{word}</span>
              </li>
            ))}
          </ol>
          {!approval.agrees ? (
            <Notice kind="error">{t('account_approvals_differ')}</Notice>
          ) : (
            <p class="muted small">{t('account_approvals_check')}</p>
          )}
        </>
      )}
      {runner.error !== null ? <Notice kind="error">{runner.error}</Notice> : null}
      <div class="actions start">
        <Button
          kind="primary"
          busy={runner.busy}
          disabled={answered || !canApprove(approval)}
          onClick={() => answer('approve')}
        >
          {t('account_approvals_approve')}
        </Button>
        <Button disabled={runner.busy || answered} onClick={() => answer('deny')}>
          {t('account_approvals_deny')}
        </Button>
      </div>
    </li>
  )
}

export function ApprovalsPanel(props: {
  approvals: ApprovalView[] | undefined
  reload: () => Promise<void>
}) {
  const { approvals, reload } = props
  return (
    <Section title={t('account_approvals_title')}>
      <p class="lead">{t('account_approvals_lead')}</p>
      {approvals === undefined ? (
        <p class="muted" role="status">
          {t('account_loading')}
        </p>
      ) : approvals.length === 0 ? (
        <Group pad>
          <p class="muted">{t('account_approvals_none')}</p>
        </Group>
      ) : (
        <ul class="requests plain">
          {approvals.map((approval) => (
            <Request key={approval.id} approval={approval} reload={reload} />
          ))}
        </ul>
      )}
    </Section>
  )
}
