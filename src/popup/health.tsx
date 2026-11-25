// Password health, worked out in the browser from the vault: nothing about it is stored or synced.
import { useState } from 'preact/hooks'
import type { LoginView } from '../shared/api'
import {
  Button,
  Group,
  Notice,
  PageHeader,
  Section,
  Tile,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import type { Vault } from './data'
import { ask } from './send'

export function HealthPage(props: {
  vault: Vault
  onBack: () => void
  onOpenLogin: (id: string) => void
  onSettings: () => void
  /** Opens the breach alerts of the vault's services (the vault tools). */
  onBreaches?: () => void
}) {
  const { vault } = props
  const say = useToast()
  const report = useLoad(() => ask('health'))
  const [checking, setChecking] = useState(false)

  // Added by tools: "Check now" asks Pwned Passwords again for every password, whatever it said before
  const checkNow = async () => {
    setChecking(true)
    try {
      const check = await ask('checkBreaches')
      await Promise.all([vault.reload(), report.reload()])
      say(t('tools_checkedPasswords', check.passwords.breached, check.passwords.failed))
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }
  const named = (ids: string[]): LoginView[] =>
    ids
      .map((id) => vault.logins.find((login) => login.id === id))
      .filter((login): login is LoginView => login !== undefined)

  const ignore = async (id: string) => {
    try {
      await ask('ignoreHealth', { id, ignored: true })
      await Promise.all([vault.reload(), report.reload()])
    } catch (error) {
      say(errorMessage(error))
    }
  }

  const list = (title: string, logins: LoginView[], withIgnore = false) =>
    logins.length === 0 ? null : (
      <Section title={`${title} · ${logins.length}`}>
        <Group>
          {logins.map((login) => (
            <div class="health-item" key={login.id}>
              <button
                type="button"
                class="health-open hov"
                aria-label={t('popup_openLogin', login.name)}
                onClick={() => props.onOpenLogin(login.id)}
              >
                <Tile name={login.name} />
                <span class="grow lines">
                  <span class="name ellipsis">{login.name}</span>
                  {login.username !== '' && <span class="label ellipsis">{login.username}</span>}
                </span>
                <Icon name="chevron" size={16} weight={2} />
              </button>
              {withIgnore && (
                <button
                  type="button"
                  class="link-btn hov health-ignore"
                  aria-label={t('popup_dontWarnOf', login.name)}
                  onClick={() => void ignore(login.id)}
                >
                  {t('popup_dontWarn')}
                </button>
              )}
            </div>
          ))}
        </Group>
      </Section>
    )

  const data = report.value
  const nothing =
    data !== undefined &&
    data.reused.length === 0 &&
    data.weak.length === 0 &&
    data.withoutItsCode.length === 0 &&
    data.breached.length === 0

  return (
    <div class="screen">
      <PageHeader
        title={t('popup_healthTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        {report.error !== undefined && <Notice kind="error">{report.error}</Notice>}
        {data !== undefined && (
          <>
            {vault.settings.breachedPasswords ? (
              list(t('popup_sectionBreached'), named(data.breached))
            ) : (
              <Notice>
                <p>{t('popup_breachOff')}</p>
                <button type="button" class="note-link" onClick={props.onSettings}>
                  {t('popup_settings')}
                </button>
              </Notice>
            )}
            <div class="actions start">
              {vault.settings.breachedPasswords && (
                <Button icon="refresh" busy={checking} onClick={() => void checkNow()}>
                  {t('tools_checkNow')}
                </Button>
              )}
              {props.onBreaches !== undefined && (
                <Button onClick={props.onBreaches}>{t('tools_serviceBreaches')}</Button>
              )}
            </div>
            {list(t('popup_sectionReused'), named(data.reused))}
            {list(t('popup_sectionWeak'), named(data.weak))}
            {list(t('popup_sectionWithoutCode'), named(data.withoutItsCode), true)}
            {nothing && (
              <div class="all-clear">
                <span class="empty-icon solid" aria-hidden="true">
                  <Icon name="shieldCheck" size={24} />
                </span>
                <p class="muted">{t('popup_healthNone')}</p>
              </div>
            )}
          </>
        )}
        <p class="note-faint">{t('popup_healthNote')}</p>
      </div>
    </div>
  )
}
