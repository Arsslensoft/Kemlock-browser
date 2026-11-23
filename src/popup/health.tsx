// Password health, worked out in the browser from the vault: nothing about it is stored or synced.
import type { LoginView } from '../shared/api'
import {
  Button,
  IconButton,
  Notice,
  PageHeader,
  Section,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import type { Vault } from './data'
import { ask } from './send'

export function HealthPage(props: {
  vault: Vault
  onBack: () => void
  onOpenLogin: (id: string) => void
}) {
  const { vault } = props
  const say = useToast()
  const report = useLoad(() => ask('health'))
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
        <ul class="list">
          {logins.map((login) => (
            <li class="item" key={login.id}>
              <button type="button" class="item-main" onClick={() => props.onOpenLogin(login.id)}>
                <span class="grow">
                  <span class="strong ellipsis">{login.name}</span>
                  {login.username !== '' && (
                    <span class="muted small ellipsis">{login.username}</span>
                  )}
                </span>
              </button>
              {withIgnore && (
                <Button
                  label={t('popup_dontWarnOf', login.name)}
                  onClick={() => void ignore(login.id)}
                >
                  {t('popup_dontWarn')}
                </Button>
              )}
              <IconButton
                icon="chevron"
                label={t('popup_openLogin', login.name)}
                onClick={() => props.onOpenLogin(login.id)}
              />
            </li>
          ))}
        </ul>
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
    <div>
      <PageHeader
        title={t('popup_healthTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      {report.error !== undefined && (
        <Section>
          <Notice kind="error">{report.error}</Notice>
        </Section>
      )}
      {data !== undefined && (
        <>
          {vault.settings.breachedPasswords ? (
            list(t('popup_sectionBreached'), named(data.breached))
          ) : (
            <Section>
              <Notice>{t('popup_breachOff')}</Notice>
            </Section>
          )}
          {list(t('popup_sectionReused'), named(data.reused))}
          {list(t('popup_sectionWeak'), named(data.weak))}
          {list(t('popup_sectionWithoutCode'), named(data.withoutItsCode), true)}
          {nothing && (
            <Section>
              <p class="muted">{t('popup_healthNone')}</p>
            </Section>
          )}
        </>
      )}
      <Section>
        <p class="muted small">{t('popup_healthNote')}</p>
      </Section>
    </div>
  )
}
