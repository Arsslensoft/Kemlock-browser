// The page that edits a File item (its name, notes, pin and links) or starts a new one. Choosing the file is the files tab's work: the
// file picker would close the popup, so the tab holds the picker and the upload (src/files).
import { useState } from 'preact/hooks'
import type { FileFull, ItemRef } from '../shared/api'
import { Button, Group, Notice, PageHeader, Switch, TextField, useLoad } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { openFilesTab, useFileSync } from './file-actions'
import { LinkPicker } from './item-extras'
import { ask } from './send'

export function EditFile(props: {
  /** The file to change, or null for a new one. */
  id: string | null
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const sync = useFileSync()
  const full = useLoad<FileFull | undefined>(
    () => (props.id === null ? Promise.resolve(undefined) : ask('revealFile', { id: props.id })),
    [props.id],
  )
  const current = props.id === null ? undefined : { kind: 'file' as const, id: props.id }
  // The links the file holds now, as the picker's starting point; sent only when the person changes them
  const held = useLoad<ItemRef[]>(
    () =>
      current === undefined
        ? Promise.resolve([])
        : ask('linkedItems', { ref: current }).then((items) => items.map((item) => item.ref)),
    [props.id],
  )
  const [name, setName] = useState<string | undefined>()
  const [notes, setNotes] = useState<string | undefined>()
  const [pinned, setPinned] = useState<boolean | undefined>()
  const [links, setLinks] = useState<ItemRef[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const title = props.id === null ? t('files_new') : t('files_edit')
  if (sync === undefined || (props.id !== null && full.value === undefined && held.loading)) {
    return (
      <div class="screen">
        <PageHeader title={title} onBack={props.onBack} backLabel={t('popup_back')} />
        <div class="body">
          {full.error === undefined ? (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          ) : (
            <Notice kind="error">{full.error}</Notice>
          )}
        </div>
      </div>
    )
  }
  if (sync === 'readOnly') {
    return (
      <div class="screen">
        <PageHeader title={title} onBack={props.onBack} backLabel={t('popup_back')} />
        <div class="body">
          <Notice>{t('files_needSync')}</Notice>
        </div>
      </div>
    )
  }

  // A new file starts in the tab, where the file is chosen
  if (props.id === null || current === undefined) {
    return (
      <div class="screen">
        <PageHeader title={title} onBack={props.onBack} backLabel={t('popup_back')} />
        <div class="body form-body">
          <Notice>{t('files_chooseInTab')}</Notice>
          <div class="actions start">
            <Button kind="primary" tall icon="plus" onClick={() => openFilesTab('newFile')}>
              {t('files_choose')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const file = full.value
  const loaded = file !== undefined
  const shownName = name ?? file?.name ?? ''
  const shownNotes = notes ?? file?.notes ?? ''
  const shownPin = pinned ?? file?.pinned ?? false
  const shownLinks = links ?? held.value ?? []

  const save = async () => {
    if (props.id === null || !loaded) return
    if (shownName.trim() === '') {
      setError(t('files_nameNeeded'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const saved = await ask('saveFile', {
        id: props.id,
        input: {
          name: shownName.trim(),
          notes: shownNotes,
          pinned: shownPin,
          // Links the person didn't touch are left as they are
          ...(links === undefined ? {} : { links }),
        },
      })
      props.onSaved(saved.id)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader title={title} onBack={props.onBack} backLabel={t('popup_back')} />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div class="body form-body">
          {(error ?? full.error) !== undefined && (
            <Notice kind="error">{error ?? full.error}</Notice>
          )}
          <TextField label={t('files_fieldName')} value={shownName} onInput={setName} />
          <TextField
            label={t('files_fieldNotes')}
            value={shownNotes}
            multiline
            readOnly={!loaded}
            onInput={setNotes}
          />
          <Group>
            <Switch checked={shownPin} label={t('items_pin')} onChange={setPinned} />
          </Group>
          <LinkPicker ref={current} value={shownLinks} onChange={setLinks} />
          <div class="actions start">
            <Button icon="refresh" onClick={() => openFilesTab(`replace/${props.id}`)}>
              {t('files_replace')}
            </Button>
          </div>
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={!loaded}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
