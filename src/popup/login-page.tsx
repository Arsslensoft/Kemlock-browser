// A login's page: what it holds, its warnings, its code and backup codes, and Edit and Delete.
import { useState } from 'preact/hooks'
import type { TabView } from '../shared/api'
import {
  Button,
  Confirm,
  IconButton,
  Notice,
  PageHeader,
  SelectField,
  Section,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, formatDate, t } from '../shared/ui/i18n'
import { BackupCodes, CodeValue, codeName } from './codes'
import { backupsFor, type Vault } from './data'
import { healthTags, hostOf } from './format'
import { useLiveCodes } from './live'
import { PasswordLine } from './logins'
import { useCopy } from './copy'
import type { Route } from './route'
import { ask } from './send'

export function LoginPage(props: {
  id: string
  vault: Vault
  tab: TabView | undefined
  onBack: () => void
  onRoute: (route: Route) => void
}) {
  const { vault, tab } = props
  const login = vault.logins.find((candidate) => candidate.id === props.id)
  const code =
    login?.codeId === undefined
      ? undefined
      : vault.codes.find((candidate) => candidate.id === login.codeId)
  const live = useLiveCodes(code !== undefined && !code.onSecurityKey ? [code.id] : [])
  const copy = useCopy()
  const say = useToast()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const remembered = useLoad(() => ask('rememberedSites', { loginId: props.id }), [props.id])

  if (login === undefined) {
    return (
      <div>
        <PageHeader title={t('popup_logins')} onBack={props.onBack} backLabel={t('popup_back')} />
        <Section>
          <Notice>{t('popup_loginGone')}</Notice>
        </Section>
      </div>
    )
  }

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await work()
      await vault.reload()
      if (done !== undefined) say(done)
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const fill = async (args: { loginId?: string; codeId?: string }) => {
    if (tab === undefined) return
    try {
      await ask('fill', { tabId: tab.tabId, ...args })
      say(t('popup_filled'))
    } catch (error) {
      say(errorMessage(error))
    }
  }

  const tags = healthTags(login, vault.settings.breachedPasswords)
  const unlinked = vault.codes.filter((candidate) => candidate.loginId === undefined)
  const backups = code === undefined ? [] : backupsFor(vault.backups, code)
  const strengthLabel = t(`popup_strength${Math.max(0, Math.min(4, login.strength))}`)

  return (
    <div>
      <PageHeader title={login.name} onBack={props.onBack} backLabel={t('popup_back')}>
        <IconButton
          icon="edit"
          label={t('popup_edit')}
          onClick={() => props.onRoute({ name: 'edit', id: login.id })}
        />
        <IconButton icon="trash" label={t('popup_deleteLogin')} onClick={() => setAsking(true)} />
      </PageHeader>

      {asking && (
        <Section>
          <Confirm
            title={t('popup_deleteTitle')}
            body={t('popup_deleteBody', login.name)}
            confirmLabel={t('popup_delete')}
            cancelLabel={t('popup_cancel')}
            danger
            busy={busy}
            onCancel={() => setAsking(false)}
            onConfirm={() =>
              void (async () => {
                setBusy(true)
                try {
                  await ask('deleteLogin', { id: login.id })
                  await vault.reload()
                  props.onBack()
                } catch (error) {
                  say(errorMessage(error))
                  setBusy(false)
                  setAsking(false)
                }
              })()
            }
          />
        </Section>
      )}

      {tab !== undefined && (
        <Section>
          <div class="actions start">
            <Button kind="primary" onClick={() => void fill({ loginId: login.id })}>
              {t('popup_fillLogin')}
            </Button>
            {code !== undefined && !code.onSecurityKey && (
              <Button onClick={() => void fill({ codeId: code.id })}>{t('popup_fillCode')}</Button>
            )}
          </div>
        </Section>
      )}

      {tags.length > 0 && (
        <Section>
          {tags.includes('breached') && <Notice kind="error">{t('popup_warnBreached')}</Notice>}
          {tags.includes('reused') && <Notice kind="warn">{t('popup_warnReused')}</Notice>}
          {tags.includes('weak') && (
            <Notice kind="warn">{t('popup_warnWeak', strengthLabel)}</Notice>
          )}
          {tags.includes('withoutItsCode') && (
            <Notice kind="warn">
              <p>{t('popup_warnNoCode')}</p>
              <div class="actions start">
                <Button onClick={() => props.onRoute({ name: 'addCode' })}>
                  {t('popup_addCode')}
                </Button>
                <Button
                  busy={busy}
                  onClick={() =>
                    void run(() => ask('ignoreHealth', { id: login.id, ignored: true }))
                  }
                >
                  {t('popup_dontWarn')}
                </Button>
              </div>
            </Notice>
          )}
        </Section>
      )}

      <Section title={t('popup_websites')}>
        {login.websites.length > 0 ? (
          <ul class="plain">
            {login.websites.map((site) => (
              <li key={site} class="ellipsis">
                {hostOf(site)}
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">{t('popup_noWebsite')}</p>
        )}
      </Section>

      <Section title={t('popup_username')}>
        <div class="row">
          <span class="grow ellipsis">{login.username === '' ? '–' : login.username}</span>
          {login.username !== '' && (
            <IconButton
              icon="copy"
              label={t('popup_copyUsernameOf', login.name)}
              onClick={() => void copy('username', login.id)}
            />
          )}
        </div>
      </Section>

      <Section title={t('popup_password')}>
        <PasswordLine login={login} />
        <p class="muted small">
          {login.passwordChangedAt === undefined
            ? strengthLabel
            : t('popup_strengthChanged', strengthLabel, formatDate(login.passwordChangedAt))}
        </p>
        <div class="meter" role="img" aria-label={strengthLabel}>
          {[0, 1, 2, 3, 4].map((step) => (
            <span key={step} class={step <= login.strength ? 'bar-on' : ''} />
          ))}
        </div>
        {login.previousPasswords > 0 && (
          <p class="muted small">{t('popup_previousCount', login.previousPasswords)}</p>
        )}
      </Section>

      <Section title={t('popup_twoStepCode')}>
        {code !== undefined ? (
          <div class="row">
            <span class="grow ellipsis">{codeName(code)}</span>
            <CodeValue code={code} live={live} />
          </div>
        ) : unlinked.length > 0 ? (
          <SelectField
            label={t('popup_linkCode')}
            value=""
            options={[
              { value: '', label: t('popup_noCodeLinked') },
              ...unlinked.map((candidate) => ({
                value: candidate.id,
                label: `${codeName(candidate)} · ${candidate.account}`,
              })),
            ]}
            onChange={(value) => {
              if (value !== '')
                void run(
                  () => ask('linkCode', { codeId: value, loginId: login.id }),
                  t('popup_linked'),
                )
            }}
          />
        ) : (
          <p class="muted">{t('popup_noCodeLinked')}</p>
        )}
      </Section>

      {backups.length > 0 && (
        <Section title={t('popup_backupCodes')}>
          <BackupCodes backups={backups} onChanged={vault.reload} />
        </Section>
      )}

      {remembered.value !== undefined && remembered.value.length > 0 && (
        <Section title={t('popup_remembered')}>
          <p class="muted small">{t('popup_rememberedNote')}</p>
          <ul class="list">
            {remembered.value.map((host) => (
              <li key={host} class="item">
                <span class="grow ellipsis">{host}</span>
                <Button
                  label={t('popup_forgetHost', host)}
                  onClick={() =>
                    void (async () => {
                      try {
                        await ask('forgetSite', { loginId: login.id, host })
                        await remembered.reload()
                      } catch (error) {
                        say(errorMessage(error))
                      }
                    })()
                  }
                >
                  {t('popup_forget')}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
