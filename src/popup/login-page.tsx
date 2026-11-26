// A login's page: what it holds, its warnings, its code and backup codes, and Edit and Delete.
import { useState } from 'preact/hooks'
import type { TabView } from '../shared/api'
import { KemlockIcon } from '../shared/brand/brand'
import {
  Button,
  Confirm,
  Group,
  IconButton,
  LinkButton,
  Notice,
  PageHeader,
  Section,
  SelectField,
  Tile,
  useLoad,
  useToast,
  useToastBottom,
} from '../shared/ui/components'
import { errorMessage, formatDate, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { CodeLine, codeName } from './codes'
import { useCopy } from './copy'
import { backupsFor, type Vault } from './data'
import { allTags, healthTags, hostOf } from './format'
import { FieldsSection, LinksSection } from './item-extras'
import { useLiveCodes } from './live'
import { passkeysOfWebsites } from './passkey-format'
import { LoginPasskeys, usePasskeys } from './passkeys'
import { PasswordLine } from './logins'
import type { Route } from './route'
import { ask } from './send'
import { useFill } from './site'
import { SiteRuleLine } from './site-rules'
import { SpaceDetail } from './spaces'
import { TagEditor } from './tools/tag-editor'

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
  const fill = useFill(tab)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const remembered = useLoad(() => ask('rememberedSites', { loginId: props.id }), [props.id])
  const passkeys = usePasskeys()
  useToastBottom(tab === undefined ? 16 : 76)

  if (login === undefined) {
    return (
      <div class="screen">
        <PageHeader title={t('popup_logins')} onBack={props.onBack} backLabel={t('popup_back')} />
        <div class="body">
          <Notice>{t('popup_loginGone')}</Notice>
        </div>
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

  const tags = healthTags(login, vault.settings.breachedPasswords)
  const unlinked = vault.codes.filter((candidate) => candidate.loginId === undefined)
  const backups = code === undefined ? [] : backupsFor(vault.backups, code)
  // A password the space hides has no strength to show: nothing of it, not even the line
  const strengthLabel =
    login.strength === undefined
      ? undefined
      : t(`popup_strength${Math.max(0, Math.min(4, login.strength))}`)
  const backup = backups[0]
  const toGenerator = () => props.onRoute({ name: 'generator' })

  return (
    <div class="screen">
      <header class="bar login-bar">
        <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
        <KemlockIcon size={24} class="mark" />
        <Tile name={login.name} size={32} />
        <h1 class="login-title">{login.name}</h1>
        {login.space?.canEdit !== false && (
          <button
            type="button"
            class="link-btn hov"
            onClick={() => props.onRoute({ name: 'edit', id: login.id })}
          >
            {t('popup_edit')}
          </button>
        )}
        {login.space?.canEdit !== false && (
          <IconButton icon="trash" label={t('popup_deleteLogin')} onClick={() => setAsking(true)} />
        )}
      </header>

      {asking && (
        <div class="login-confirm">
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
        </div>
      )}

      <div class="body tight">
        <Group>
          <div class="detail-row">
            <span class="detail-label">{t('popup_websites')}</span>
            {login.websites.length > 0 || (login.websiteRules ?? []).length > 0 ? (
              <span class="mono grow websites">
                {(login.websiteRules ?? []).length > 0
                  ? (login.websiteRules ?? []).map((rule, index) => (
                      <SiteRuleLine key={`${index}:${rule.uri}`} rule={rule} />
                    ))
                  : login.websites.map((site) => (
                      <span key={site} class="ellipsis">
                        {hostOf(site)}
                      </span>
                    ))}
              </span>
            ) : (
              <span class="grow muted">{t('popup_noWebsite')}</span>
            )}
          </div>
          <div class="detail-row">
            <span class="detail-label">{t('popup_username')}</span>
            <span class="grow ellipsis">{login.username === '' ? '–' : login.username}</span>
            {login.username !== '' && (
              <IconButton
                icon="copy"
                size={16}
                label={t('popup_copyUsernameOf', login.name)}
                onClick={() => void copy('username', login.id)}
              />
            )}
          </div>
          <PasswordLine login={login} variant="detail" />
          <SpaceDetail
            kind="login"
            id={login.id}
            space={login.space}
            onMoved={() => void vault.reload()}
          />
        </Group>
        {strengthLabel !== undefined && (
          <p class="strength-line">
            {login.passwordChangedAt === undefined
              ? strengthLabel
              : t('popup_strengthChanged', strengthLabel, formatDate(login.passwordChangedAt))}
            {login.previousPasswords > 0 && (
              <span> · {t('popup_previousCount', login.previousPasswords)}</span>
            )}
          </p>
        )}

        {tags.includes('breached') && (
          <div class="login-note danger" role="note">
            <Icon name="warning" size={15} weight={2} />
            <div class="grow">
              <p class="note-title">{t('popup_tagBreached')}</p>
              <p class="note-body">{t('popup_warnBreached')}</p>
              <button type="button" class="note-link" onClick={toGenerator}>
                {t('popup_generateAPassword')}
              </button>
            </div>
          </div>
        )}
        {tags.includes('reused') && (
          <div class="login-note" role="note">
            <Icon name="warning" size={15} weight={2} />
            <div class="grow">
              <p class="note-title">{t('popup_tagReused')}</p>
              <p class="note-body">{t('popup_warnReused')}</p>
              <button type="button" class="note-link" onClick={toGenerator}>
                {t('popup_generateAPassword')}
              </button>
            </div>
          </div>
        )}
        {tags.includes('weak') && (
          <div class="login-note" role="note">
            <Icon name="warning" size={15} weight={2} />
            <div class="grow">
              <p class="note-title">{t('popup_tagWeak')}</p>
              <p class="note-body">{t('popup_warnWeak', strengthLabel ?? '')}</p>
              <button type="button" class="note-link" onClick={toGenerator}>
                {t('popup_generateAPassword')}
              </button>
            </div>
          </div>
        )}
        {tags.includes('withoutItsCode') && (
          <div class="login-note" role="note">
            <Icon name="warning" size={15} weight={2} />
            <div class="grow">
              <p class="note-title">{t('popup_tagWithoutCode')}</p>
              <p class="note-body">{t('popup_warnNoCode')}</p>
              <div class="note-actions">
                <button
                  type="button"
                  class="note-link"
                  onClick={() => props.onRoute({ name: 'addCode' })}
                >
                  {t('popup_addCode')}
                </button>
                <button
                  type="button"
                  class="note-link"
                  disabled={busy}
                  onClick={() =>
                    void run(() => ask('ignoreHealth', { id: login.id, ignored: true }))
                  }
                >
                  {t('popup_dontWarn')}
                </button>
              </div>
            </div>
          </div>
        )}

        <Section title={t('popup_twoStepCode')}>
          {code !== undefined ? (
            <>
              <Group>
                <CodeLine
                  code={code}
                  live={live}
                  variant="detail"
                  sub={`${codeName(code)} · ${code.account}`}
                />
                {backup !== undefined && (
                  <button
                    type="button"
                    class="link-row hov"
                    onClick={() => props.onRoute({ name: 'backupCodes' })}
                  >
                    <span class="chip-bc" aria-hidden="true">
                      BC
                    </span>
                    <span class="grow lines">
                      <span class="name">{t('popup_backupCodes')}</span>
                      <span class="label">{t('popup_backupCount', backup.left, backup.total)}</span>
                    </span>
                    <Icon name="chevron" size={16} weight={2} />
                  </button>
                )}
              </Group>
              <FieldsSection item={{ kind: 'otp', id: code.id }} fields={code.fields} />
              {(code.links ?? 0) > 0 && (
                <LinksSection
                  item={{ kind: 'otp', id: code.id }}
                  onRoute={props.onRoute}
                  onChanged={() => void vault.reload()}
                />
              )}
              <div class="actions start">
                <Button
                  kind="ghost"
                  icon="edit"
                  onClick={() => props.onRoute({ name: 'codeEdit', id: code.id })}
                >
                  {t('extras_editCode')}
                </Button>
              </div>
            </>
          ) : unlinked.length > 0 ? (
            <Group pad>
              <SelectField
                stacked
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
            </Group>
          ) : (
            <Group pad>
              <p class="muted">{t('popup_noCodeLinked')}</p>
            </Group>
          )}
        </Section>

        <LoginPasskeys
          passkeys={passkeysOfWebsites(passkeys.value ?? [], login.websites)}
          onOpen={(id) => props.onRoute({ name: 'passkey', id })}
        />

        {remembered.value !== undefined && remembered.value.length > 0 && (
          <Section>
            <Group>
              {remembered.value.map((host) => (
                <div key={host} class="remembered">
                  <span class="grow lines">
                    <span class="label">{t('popup_remembered')}</span>
                    <span class="mono ellipsis">{host}</span>
                  </span>
                  <LinkButton
                    quiet
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
                  </LinkButton>
                </div>
              ))}
            </Group>
            <p class="strength-line">{t('popup_rememberedNote')}</p>
          </Section>
        )}

        {/* Added by tools: the login's tags, changed in place */}
        <Section title={t('tools_tags')}>
          <Group pad>
            <TagEditor
              kind="login"
              id={login.id}
              tags={login.tags}
              suggestions={allTags(vault.codes, vault.logins)}
              onChange={() => void vault.reload()}
            />
          </Group>
        </Section>

        <FieldsSection item={{ kind: 'login', id: login.id }} fields={login.fields} />
        <LinksSection
          item={{ kind: 'login', id: login.id }}
          onRoute={props.onRoute}
          onChanged={() => void vault.reload()}
        />
      </div>

      {tab !== undefined && (
        <div class="foot-bar">
          <Button
            kind="primary"
            label={t('popup_fillLoginOf', login.name)}
            onClick={() => void fill({ loginId: login.id })}
          >
            {t('popup_fillLogin')}
          </Button>
          {code !== undefined && !code.onSecurityKey && (
            <Button
              class="no-grow"
              label={t('popup_fillCodeOf', login.name)}
              onClick={() => void fill({ codeId: code.id })}
            >
              {t('popup_fillCode')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
