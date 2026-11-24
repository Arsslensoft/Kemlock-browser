// Recently generated passwords: what the extension made and filled, kept 30 days in the vault.
import { useState } from 'preact/hooks'
import type { GeneratedPassword } from '../shared/api'
import { Button, Notice, PageHeader, useLoad } from '../shared/ui/components'
import { formatDateTime, t } from '../shared/ui/i18n'
import { useCopy } from './copy'
import { hostOf } from './format'
import type { Prefill } from './route'
import { ask } from './send'

function Entry(props: { entry: GeneratedPassword; onSave: (prefill: Prefill) => void }) {
  const { entry } = props
  const copy = useCopy()
  const [shown, setShown] = useState(false)
  const site = entry.site === undefined || entry.site === '' ? '' : hostOf(entry.site)
  const title = site === '' ? t('popup_generatedUnnamed') : site
  return (
    <li class="group pad recent-entry" aria-label={title}>
      <div class="lines">
        <span class="name ellipsis">{title}</span>
        <span class="label">{t('popup_generatedAt', formatDateTime(entry.at))}</span>
      </div>
      <div class={shown ? 'mono well-text revealed' : 'mono well-text'}>
        {shown ? (
          entry.value
        ) : (
          <>
            <span aria-hidden="true">••••••••••</span>
            <span class="visually-hidden">{t('popup_passwordHidden')}</span>
          </>
        )}
      </div>
      <div class="actions split">
        <Button
          label={t(shown ? 'popup_hidePasswordOf' : 'popup_showPasswordOf', title)}
          onClick={() => setShown((v) => !v)}
        >
          {t(shown ? 'popup_hide' : 'popup_show')}
        </Button>
        <Button
          label={t('popup_copyPasswordOf', title)}
          onClick={() => void copy('generated', String(entry.at), entry.value)}
        >
          {t('popup_copy')}
        </Button>
        <Button
          kind="primary"
          class="wide"
          label={t('popup_saveAsLoginOf', title)}
          onClick={() =>
            props.onSave({
              name: site,
              password: entry.value,
              websites: entry.site === undefined || entry.site === '' ? [] : [entry.site],
            })
          }
        >
          {t('popup_saveAsLogin')}
        </Button>
      </div>
    </li>
  )
}

export function Recent(props: { onBack: () => void; onSave: (prefill: Prefill) => void }) {
  const recent = useLoad(() => ask('recentPasswords'))
  const entries = [...(recent.value ?? [])].sort((a, b) => b.at - a.at)
  return (
    <div class="screen">
      <PageHeader title={t('popup_recent')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <p class="note-text">{t('popup_recentNote')}</p>
        {recent.error !== undefined && <Notice kind="error">{recent.error}</Notice>}
        {recent.value !== undefined && entries.length === 0 && (
          <p class="muted none-line">{t('popup_recentNone')}</p>
        )}
        {entries.length > 0 && (
          <ul class="plain stack-12">
            {entries.map((entry) => (
              <Entry key={`${entry.at}`} entry={entry} onSave={props.onSave} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
