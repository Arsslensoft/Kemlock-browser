// The pages that edit an MFA code's details and a service's backup codes' details: a name, the websites they are used on, a note,
// custom fields and links. The secret, the digits and the codes themselves are not changed here (their own pages do that).
import { useState } from 'preact/hooks'
import type { BackupCodeView, CodeView, ItemRef } from '../shared/api'
import {
  Button,
  Group,
  IconButton,
  Notice,
  PageHeader,
  Section,
  Switch,
  TextField,
  useLoad,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { backupName, codeName } from './codes'
import type { Vault } from './data'
import { hostOf } from './format'
import { DetailRow } from './items-ui'
import { FieldsEditor, LinkPicker, useItemExtras } from './item-extras'
import { ask } from './send'
import { siteProblem } from './site-rules'

/** The websites typed so far: the ones that are not blank, trimmed, each once. */
function typedSites(rows: string[]): string[] {
  return [...new Set(rows.map((row) => row.trim()).filter((row) => row !== ''))]
}

/** A code's websites in a form: one box each, add and remove. */
function SitesList(props: { value: string[]; onChange: (next: string[]) => void }) {
  const { value } = props
  return (
    <div class="stack sites">
      {value.map((site, index) => {
        const problem = siteProblem({ uri: site, match: 'domain' })
        return (
          <TextField
            key={index}
            label={t('popup_fieldWebsite')}
            value={site}
            type="url"
            placeholder="example.com"
            invalid={problem !== undefined}
            {...(problem === undefined ? {} : { hint: problem })}
            onInput={(next) => props.onChange(value.map((row, i) => (i === index ? next : row)))}
            trailing={
              value.length > 1 ? (
                <IconButton
                  icon="x"
                  size={16}
                  weight={2}
                  label={t('popup_removeWebsite', site === '' ? String(index + 1) : hostOf(site))}
                  onClick={() => props.onChange(value.filter((_, i) => i !== index))}
                />
              ) : undefined
            }
          />
        )
      })}
      <div class="actions start">
        <Button kind="ghost" icon="plus" onClick={() => props.onChange([...value, ''])}>
          {t('popup_addWebsite')}
        </Button>
      </div>
    </div>
  )
}

/**
 * The websites a linked item lends: shown as they are, with where they come from. They change on that item, so nothing here
 * edits them.
 */
function LentSites(props: { item: ItemRef; websites: string[]; from: ItemRef[] }) {
  const names = useLoad(() => ask('linkedItems', { ref: props.item }), [props.item.id])
  const lenders = props.from.map(
    (ref) =>
      names.value?.find((view) => view.ref.kind === ref.kind && view.ref.id === ref.id)?.name ??
      t('extras_linkedItem'),
  )
  return (
    <Section title={t('popup_websites')}>
      <Group>
        <DetailRow
          label={t('popup_websites')}
          value={
            props.websites.length > 0 ? (
              <span class="websites">
                {props.websites.map((site) => (
                  <span key={site} class="ellipsis mono">
                    {hostOf(site)}
                  </span>
                ))}
              </span>
            ) : (
              t('popup_noWebsite')
            )
          }
        />
      </Group>
      <p class="strength-line">{t('extras_websitesFrom', lenders.join(', '))}</p>
    </Section>
  )
}

function Gone(props: { title: string; message: string; onBack: () => void }) {
  return (
    <div class="screen">
      <PageHeader title={props.title} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Notice>{props.message}</Notice>
      </div>
    </div>
  )
}

/** The note a view may carry (the core sends it for the edit page); empty when it carries none. */
const noteOf = (view: CodeView | BackupCodeView): string =>
  'note' in view && typeof view.note === 'string' ? view.note : ''

/** The page that edits an MFA code: its name, websites, note, fields and links. */
export function CodeEditPage(props: {
  id: string
  vault: Vault
  onBack: () => void
  onSaved?: (id: string) => void
}) {
  const { vault } = props
  const code = vault.codes.find((candidate) => candidate.id === props.id)
  if (code === undefined)
    return <Gone title={t('popup_codes')} message={t('extras_codeGone')} onBack={props.onBack} />
  return <CodeForm code={code} vault={vault} onBack={props.onBack} onSaved={props.onSaved} />
}

function CodeForm(props: {
  code: CodeView
  vault: Vault
  onBack: () => void
  onSaved?: ((id: string) => void) | undefined
}) {
  const { code } = props
  const item: ItemRef = { kind: 'otp', id: code.id }
  const lent = code.websitesFrom !== undefined && code.websitesFrom.length > 0
  const ownSites = code.ownWebsites ?? code.websites
  const [name, setName] = useState(code.name ?? '')
  const [sites, setSites] = useState<string[]>(ownSites.length > 0 ? ownSites : [''])
  const [note, setNote] = useState(noteOf(code))
  const [pinned, setPinned] = useState(code.pinned === true)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const extras = useItemExtras('otp', item, code.fields)

  const save = async () => {
    const problem =
      sites
        .map((site) => siteProblem({ uri: site, match: 'domain' }))
        .find((p) => p !== undefined) ?? extras.problem
    if (problem !== undefined) {
      setError(problem)
      return
    }
    // Only what was changed goes: a member left alone is never rewritten
    const own = typedSites(sites)
    const input = {
      ...(name.trim() === (code.name ?? '') ? {} : { name: name.trim() }),
      ...(lent || own.join('\n') === ownSites.join('\n') ? {} : { websites: own }),
      ...(note === noteOf(code) ? {} : { note: note.trim() }),
      ...(pinned === (code.pinned === true) ? {} : { pinned }),
      ...extras.members(),
    }
    setBusy(true)
    setError(undefined)
    try {
      await ask('saveCode', { id: code.id, input })
      await props.vault.reload()
      if (props.onSaved === undefined) props.onBack()
      else props.onSaved(code.id)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t('extras_editCodeTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div class="body form-body">
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          <p class="muted ellipsis">
            {[code.issuer, code.account].filter((p) => p !== '').join(' · ')}
          </p>
          <TextField
            label={t('popup_codeName')}
            value={name}
            placeholder={codeName({ ...code, name: undefined })}
            onInput={setName}
          />
          {lent ? (
            <LentSites item={item} websites={code.websites} from={code.websitesFrom ?? []} />
          ) : (
            <Section title={t('popup_websites')}>
              <SitesList value={sites} onChange={setSites} />
            </Section>
          )}
          <TextField label={t('popup_fieldNote')} value={note} multiline onInput={setNote} />
          <FieldsEditor {...extras.fieldsProps} />
          <Group>
            <Switch checked={pinned} label={t('items_pin')} onChange={setPinned} />
          </Group>
          <LinkPicker {...extras.linkProps} />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={extras.loading}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** The page that edits a service's backup codes: its name, websites, note, fields and links. The codes are managed on their own page. */
export function BackupEditPage(props: {
  id: string
  vault: Vault
  onBack: () => void
  onSaved?: (id: string) => void
}) {
  const backup = props.vault.backups.find((candidate) => candidate.serviceId === props.id)
  if (backup === undefined)
    return (
      <Gone title={t('popup_backupCodes')} message={t('extras_backupGone')} onBack={props.onBack} />
    )
  return (
    <BackupForm backup={backup} vault={props.vault} onBack={props.onBack} onSaved={props.onSaved} />
  )
}

function BackupForm(props: {
  backup: BackupCodeView
  vault: Vault
  onBack: () => void
  onSaved?: ((id: string) => void) | undefined
}) {
  const { backup } = props
  const item: ItemRef = { kind: 'backup-codes', id: backup.serviceId }
  const [name, setName] = useState(backup.name ?? '')
  const [sites, setSites] = useState<string[]>(
    (backup.websites ?? []).length > 0 ? (backup.websites ?? []) : [''],
  )
  const [note, setNote] = useState(noteOf(backup))
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const extras = useItemExtras('backup-codes', item, backup.fields)

  const save = async () => {
    const problem =
      sites
        .map((site) => siteProblem({ uri: site, match: 'domain' }))
        .find((p) => p !== undefined) ?? extras.problem
    if (problem !== undefined) {
      setError(problem)
      return
    }
    const own = typedSites(sites)
    const input = {
      ...(name.trim() === (backup.name ?? '') ? {} : { name: name.trim() }),
      ...(own.join('\n') === (backup.websites ?? []).join('\n') ? {} : { websites: own }),
      ...(note === noteOf(backup) ? {} : { note: note.trim() }),
      ...extras.members(),
    }
    setBusy(true)
    setError(undefined)
    try {
      await ask('saveBackupCodes', { serviceId: backup.serviceId, input })
      await props.vault.reload()
      if (props.onSaved === undefined) props.onBack()
      else props.onSaved(backup.serviceId)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t('extras_editBackupTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div class="body form-body">
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          <p class="muted ellipsis">{backup.issuer}</p>
          <TextField
            label={t('popup_codeName')}
            value={name}
            placeholder={backupName({ ...backup, name: undefined })}
            onInput={setName}
          />
          <Section title={t('popup_websites')}>
            <SitesList value={sites} onChange={setSites} />
          </Section>
          <TextField label={t('popup_fieldNote')} value={note} multiline onInput={setNote} />
          <FieldsEditor {...extras.fieldsProps} />
          <LinkPicker {...extras.linkProps} />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={extras.loading}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
