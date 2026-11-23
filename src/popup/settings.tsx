// Settings: locking, the clipboard, pages, breached passwords, sync, site access and removal.
import { useState } from 'preact/hooks'
import type { Settings as SettingsValue } from '../shared/api'
import {
  Button,
  Group,
  Notice,
  PageHeader,
  Section,
  SelectField,
  Switch,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import type { Vault } from './data'
import { openSetup } from './links'
import { RemoveKemlock } from './lock'
import { ask } from './send'
import { SyncCard } from './sync-card'

const allSites = { origins: ['<all_urls>'] }

const lockOptions = [1, 5, 15, 60] as const
const clipboardOptions = [10, 30, 60, 120] as const

export function SettingsPage(props: { vault: Vault; onBack: () => void; onRemoved: () => void }) {
  const say = useToast()
  const [settings, setSettings] = useState<SettingsValue>(props.vault.settings)
  const [error, setError] = useState<string | undefined>()
  const granted = useLoad(() => ask('allSitesGranted'))
  const [grantedNow, setGrantedNow] = useState<boolean | undefined>()
  const hasAllSites = grantedNow ?? granted.value ?? false

  const save = async (patch: Partial<SettingsValue>) => {
    try {
      const next = await ask('saveSettings', { settings: patch })
      setSettings(next)
      setError(undefined)
      await props.vault.reload()
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  // The browser asks for a permission only from the click that wants it, so this stays in the
  // switch's own turn: no await comes before `request`.
  const buttonsOnPages = (on: boolean) => {
    if (!on) {
      void save({ buttonsOnPages: false })
      return
    }
    chrome.permissions.request(allSites).then(
      (ok) => {
        setGrantedNow(ok)
        if (ok) void save({ buttonsOnPages: true })
        else say(t('popup_accessRefused'))
      },
      (failure) => setError(errorMessage(failure)),
    )
  }

  const stopAllSites = async () => {
    try {
      await chrome.permissions.remove(allSites)
      setGrantedNow(false)
      await save({ buttonsOnPages: false })
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return (
    <div class="screen">
      <PageHeader title={t('popup_settings')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        {error !== undefined && <Notice kind="error">{error}</Notice>}

        <Section title={t('popup_sectionLock')}>
          <Group>
            <SelectField
              label={t('popup_autoLock')}
              value={settings.autoLockMinutes}
              options={lockOptions.map((minutes) => ({
                value: minutes,
                label: t(`popup_lockAfter${minutes}`),
              }))}
              onChange={(autoLockMinutes) => void save({ autoLockMinutes })}
            />
            <Switch
              label={t('popup_lockOnSleep')}
              checked={settings.lockOnSleep}
              onChange={(lockOnSleep) => void save({ lockOnSleep })}
            />
            <SelectField
              label={t('popup_clipboardClear')}
              value={settings.clipboardSeconds}
              options={clipboardOptions.map((seconds) => ({
                value: seconds,
                label: t('popup_seconds', seconds),
              }))}
              onChange={(clipboardSeconds) => void save({ clipboardSeconds })}
            />
          </Group>
        </Section>

        <Section title={t('popup_sectionPages')}>
          <Group>
            <Switch
              label={t('popup_buttonsOnPages')}
              detail={t('popup_buttonsOnPagesDetail')}
              checked={settings.buttonsOnPages && hasAllSites}
              onChange={buttonsOnPages}
            />
            <Switch
              label={t('popup_codeAfterPassword')}
              checked={settings.codeAfterPassword}
              onChange={(codeAfterPassword) => void save({ codeAfterPassword })}
            />
            <Switch
              label={t('popup_offerToSave')}
              checked={settings.offerToSave}
              onChange={(offerToSave) => void save({ offerToSave })}
            />
            <Switch
              label={t('popup_breachCheck')}
              detail={t('popup_breachCheckDetail')}
              checked={settings.breachedPasswords}
              onChange={(breachedPasswords) => void save({ breachedPasswords })}
            />
          </Group>
        </Section>

        <SyncCard />

        <Section title={t('popup_siteAccess')}>
          <Group pad>
            <p class="muted">{t(hasAllSites ? 'popup_accessAll' : 'popup_accessClick')}</p>
            {hasAllSites && (
              <div class="actions start">
                <Button onClick={() => void stopAllSites()}>{t('popup_stopAllSites')}</Button>
              </div>
            )}
          </Group>
        </Section>

        <Section title={t('popup_sectionThisBrowser')}>
          <Group>
            <div class="this-browser">
              <div class="actions start">
                <Button icon="refresh" onClick={() => openSetup('again')}>
                  {t('popup_setUpAgain')}
                </Button>
              </div>
              <p class="muted small">{t('popup_setUpAgainNote')}</p>
            </div>
            <div class="remove-row">
              <RemoveKemlock onRemoved={props.onRemoved} />
            </div>
          </Group>
        </Section>
      </div>
    </div>
  )
}
