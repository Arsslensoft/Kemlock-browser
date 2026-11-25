// A note's page, and the page that adds or edits one (mobile/lib/features/notes): its title and text, copying the text through the
// clipboard that clears itself, and the files it holds, listed and left to the phone, which keeps their contents.
import { useState } from 'preact/hooks'
import type { NoteFull } from '../shared/api'
import {
  Button,
  Group,
  Notice,
  PageHeader,
  Section,
  Switch,
  TextField,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { sendProblemText } from '../shared/sends-text'
import { errorMessage, t } from '../shared/ui/i18n'
import { useCopy } from './copy'
import type { Vault } from './data'
import { allTags } from './format'
import { DeleteQuestion, ItemBar } from './items-ui'
import type { Route } from './route'
import { ask } from './send'
import { openSendsTab } from './sends'
import { useSyncStatus } from './sync-state'
import { TagEditor } from './tools/tag-editor'

/** The most characters a note holds (the app's limit). */
export const noteTextLimit = 10_000

/** A file's size as the app shows it. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return t('items_sizeBytes', bytes)
  if (bytes < 1024 * 1024) return t('items_sizeKb', Math.max(1, Math.round(bytes / 1024)))
  return t('items_sizeMb', (bytes / (1024 * 1024)).toFixed(1))
}

function Gone(props: { onBack: () => void }) {
  return (
    <div class="screen">
      <PageHeader title={t('items_notes')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Notice>{t('items_noteGone')}</Notice>
      </div>
    </div>
  )
}

export function NotePage(props: {
  id: string
  vault: Vault
  onBack: () => void
  onRoute: (route: Route) => void
}) {
  const { vault } = props
  const note = vault.notes.find((candidate) => candidate.id === props.id)
  const full = useLoad(() => ask('revealNote', { id: props.id }), [props.id, note?.changedAt])
  const copy = useCopy()
  const say = useToast()
  const [sync] = useSyncStatus()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (note === undefined) return <Gone onBack={props.onBack} />

  const remove = async () => {
    setBusy(true)
    try {
      await ask('deleteNote', { id: note.id })
      await vault.reload()
      props.onBack()
    } catch (error) {
      say(errorMessage(error))
      setBusy(false)
      setAsking(false)
    }
  }
  const text: NoteFull | undefined = full.value
  // Sends are Kemlock Server's: the button is there only where the vault syncs with it
  const canSend = sync !== undefined && sync !== null && sync.place === 'kemlock'
  // The background reads the note and keeps its text for the Sends tab; the tab is opened with a token, never with the text
  const send = async () => {
    try {
      const made = await ask('sendFromNote', { id: note.id })
      if (!made.ok) {
        say(sendProblemText(made))
        return
      }
      openSendsTab('new', made.value.token)
    } catch (error) {
      say(errorMessage(error))
    }
  }
  return (
    <div class="screen">
      <ItemBar
        name={note.title}
        onBack={props.onBack}
        onEdit={() => props.onRoute({ name: 'noteEdit', id: note.id })}
        onDelete={() => setAsking(true)}
        deleteLabel={t('items_deleteNote')}
      />
      {asking && (
        <DeleteQuestion
          title={t('items_deleteNoteTitle')}
          body={t('items_deleteBody', note.title)}
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
      <div class="body tight items-page">
        {full.error !== undefined && <Notice kind="error">{full.error}</Notice>}
        {text !== undefined && (
          <>
            <Group>
              <p class="note-text">{text.text === '' ? t('items_noText') : text.text}</p>
            </Group>
            {text.text !== '' && (
              <div class="actions start">
                <Button icon="copy" onClick={() => void copy('noteText', note.id)}>
                  {t('items_copyText')}
                </Button>
                {canSend && (
                  <Button icon="link" onClick={() => void send()}>
                    {t('sends_sendNote')}
                  </Button>
                )}
              </div>
            )}
            {text.attachments.length > 0 && (
              <Section title={t('items_filesTitle', text.attachments.length)}>
                <Group>
                  <div class="note-files">
                    {text.attachments.map((file, index) => (
                      <span key={`${file.name}-${index}`} class="ellipsis">
                        {file.name} <span class="label">· {fileSize(file.size)}</span>
                      </span>
                    ))}
                  </div>
                </Group>
                <p class="strength-line">{t('items_filesOnPhone')}</p>
              </Section>
            )}
          </>
        )}
        {/* Tags are changed in place; a note in a space the account may only read shows them */}
        {note.space?.canEdit === false ? (
          note.tags.length > 0 && <p class="strength-line">{note.tags.join(' · ')}</p>
        ) : (
          <Section title={t('tools_tags')}>
            <Group pad>
              <TagEditor
                kind="note"
                id={note.id}
                tags={note.tags}
                suggestions={allTags(
                  vault.codes,
                  vault.logins,
                  vault.notes,
                  vault.cards,
                  vault.identities,
                )}
                onChange={() => void vault.reload()}
              />
            </Group>
          </Section>
        )}
      </div>
    </div>
  )
}

export function EditNote(props: {
  /** The note to change, or null for a new one. */
  id: string | null
  vault: Vault
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const { vault } = props
  const note = props.id === null ? undefined : vault.notes.find((item) => item.id === props.id)
  const full = useLoad<NoteFull | undefined>(
    () => (props.id === null ? Promise.resolve(undefined) : ask('revealNote', { id: props.id })),
    [props.id],
  )
  const [title, setTitle] = useState<string | undefined>()
  const [text, setText] = useState<string | undefined>()
  const [pinned, setPinned] = useState<boolean | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  if (props.id !== null && note === undefined) return <Gone onBack={props.onBack} />
  // An existing note saves only once its text is read: saving the empty box would erase it
  const loaded = props.id === null || full.value !== undefined
  const shownTitle = title ?? note?.title ?? ''
  const shownText = text ?? full.value?.text ?? ''
  const shownPin = pinned ?? note?.pinned ?? false
  const over = shownText.length - noteTextLimit

  const save = async () => {
    if (shownTitle.trim() === '') {
      setError(t('items_noteNeedsTitle'))
      return
    }
    if (over > 0) {
      setError(t('items_noteTooLong', over))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const saved = await ask('saveNote', {
        id: props.id,
        input: { title: shownTitle.trim(), text: shownText, pinned: shownPin },
      })
      await vault.reload()
      props.onSaved(saved.id)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={props.id === null ? t('items_newNote') : t('items_editNote')}
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
          {(error ?? full.error) !== undefined && (
            <Notice kind="error">{error ?? full.error}</Notice>
          )}
          <TextField label={t('items_fieldTitle')} value={shownTitle} onInput={setTitle} />
          <TextField
            label={t('items_fieldText')}
            value={shownText}
            multiline
            readOnly={!loaded}
            onInput={setText}
          />
          <p class={over > 0 ? 'char-count over' : 'char-count'} aria-live="polite">
            {over > 0 ? t('items_noteTooLong', over) : `${shownText.length} / ${noteTextLimit}`}
          </p>
          <Group>
            <Switch checked={shownPin} label={t('items_pin')} onChange={setPinned} />
          </Group>
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
