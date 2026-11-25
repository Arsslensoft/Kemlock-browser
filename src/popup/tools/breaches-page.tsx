// Breach alerts, as the app has them: the services of the vault's codes and backup-code lists that have a breach listed since the
// entry was added, what is known of each, what to do, and "Dealt with". The list is the one the extension ships; while the person
// has the daily refresh on, it asks Have I Been Pwned for a newer one, which sends nothing about the vault. "Check now" asks again
// for the list and for the passwords (the breached-passwords switch).
import { useState } from 'preact/hooks'
import type { BreachAlert } from '../../shared/tools-api'
import {
  Button,
  Group,
  Notice,
  PageHeader,
  Section,
  Switch,
  useLoad,
  useToast,
} from '../../shared/ui/components'
import { errorMessage, formatDateTime, t } from '../../shared/ui/i18n'
import type { Vault } from '../data'
import { ask } from '../send'

/** "2021 · 533 million accounts · passwords"; the facts of a breach in a line. */
function facts(breach: BreachAlert): string {
  const year = breach.breachDate.slice(0, 4)
  const size = new Intl.NumberFormat(undefined, { notation: 'compact' }).format(breach.pwnCount)
  return [
    year,
    t('tools_breachAccounts', size),
    breach.passwords ? t('tools_breachPasswords') : t('tools_breachNoPasswords'),
  ].join(' · ')
}

export function BreachesPage(props: { vault: Vault; onBack: () => void }) {
  const say = useToast()
  const view = useLoad(() => ask('breaches'))
  const [busy, setBusy] = useState(false)
  const data = view.value

  const reload = async () => {
    await Promise.all([view.reload(), props.vault.reload()])
  }

  const dealtWith = async (alert: BreachAlert) => {
    try {
      await ask('dismissBreach', {
        name: alert.name,
        accountIds: alert.entries.filter((entry) => entry.kind === 'code').map((entry) => entry.id),
        serviceIds: alert.entries
          .filter((entry) => entry.kind === 'backup')
          .map((entry) => entry.id),
      })
      say(t('tools_dealtWithDone'))
      await reload()
    } catch (error) {
      say(errorMessage(error))
    }
  }

  const checkNow = async () => {
    setBusy(true)
    try {
      const check = await ask('checkBreaches')
      await reload()
      say(
        check.list.on || check.passwords.on
          ? t(
              'tools_checkedNow',
              check.passwords.on ? check.passwords.breached : 0,
              check.passwords.failed,
            )
          : t('tools_nothingToCheck'),
      )
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const setRefresh = async (on: boolean) => {
    try {
      await ask('saveToolsSettings', { settings: { breachRefresh: on } })
      await view.reload()
    } catch (error) {
      say(errorMessage(error))
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t('tools_breachesTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        <p class="note-text">{t('tools_breachesNote')}</p>
        {view.error !== undefined && <Notice kind="error">{view.error}</Notice>}
        {data !== undefined && (
          <>
            {data.alerts.length === 0 ? (
              <Notice kind="ok">{t('tools_noBreaches')}</Notice>
            ) : (
              data.alerts.map((alert) => (
                <article class="group pad breach-card" key={alert.name} aria-label={alert.title}>
                  <h2 class="breach-title">{alert.title}</h2>
                  <p class="muted small">{facts(alert)}</p>
                  <ul class="plain stack">
                    {alert.entries.map((entry) => (
                      <li key={`${entry.kind}:${entry.id}`} class="name ellipsis">
                        {t(
                          entry.kind === 'code'
                            ? 'tools_breachEntryCode'
                            : 'tools_breachEntryBackup',
                          entry.name,
                        )}
                      </li>
                    ))}
                  </ul>
                  <p class="note-text">{t('tools_breachAdvice')}</p>
                  <div class="actions start">
                    <Button
                      label={t('tools_dealtWithOf', alert.title)}
                      onClick={() => void dealtWith(alert)}
                    >
                      {t('tools_dealtWith')}
                    </Button>
                  </div>
                </article>
              ))
            )}

            <Section title={t('tools_breachChecks')}>
              <Group pad>
                <Switch
                  checked={data.refreshOn}
                  label={t('tools_refreshSwitch')}
                  detail={t('tools_refreshDetail')}
                  onChange={(on) => void setRefresh(on)}
                />
                <p class="muted small">
                  {data.checkedAt === undefined
                    ? t('tools_listUpdated', data.listUpdated)
                    : t('tools_listCheckedAt', data.listUpdated, formatDateTime(data.checkedAt))}
                </p>
                <div class="actions start">
                  <Button icon="refresh" busy={busy} onClick={() => void checkNow()}>
                    {t('tools_checkNow')}
                  </Button>
                </div>
              </Group>
            </Section>
            <p class="note-faint">
              {t('tools_breachCredit', data.source.replace(/^https?:\/\//, ''))}
            </p>
            <p class="note-faint">{data.license}</p>
          </>
        )}
      </div>
    </div>
  )
}
