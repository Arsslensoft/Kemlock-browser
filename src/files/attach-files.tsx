// Files for a secure note: any number, up to what the note holds (100, each up to 50 MiB). The core holds at most four staged files at once,
// so they go in groups of four: each file is staged a piece at a time, then the group is added to the note, which the core uploads.
import { useState } from 'preact/hooks'
import type { NoteFull } from '../shared/api'
import { fileError, fileSize, itemFileLimit, noteFileLimit } from '../popup/file-actions'
import { ask } from '../popup/send'
import { Button, Notice, useLoad } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { useBackgroundHeld } from './keepalive'
import { ChosenFile, FilePicker, Finished, refusalOf } from './picker'
import { stageBlob } from './stage'

/** The most files the core holds staged at once. */
const stagedAtOnce = 4

type State =
  { kind: 'waiting' } | { kind: 'sending' } | { kind: 'added' } | { kind: 'failed'; why: string }

interface Chosen {
  /** Which chosen file it is, so the same file chosen twice stays two rows. */
  key: number
  file: File
  state: State
}

let nextKey = 1

/**
 * The files of a group the core could not put on the note: it answers with the note and, when only some failed, their staged handles
 * (`failed`). A name is taken for a handle too, so a core that names the files by name is understood.
 */
function failedOf(note: NoteFull): Set<string> {
  const named = (note as NoteFull & { failed?: unknown }).failed
  return new Set(
    Array.isArray(named) ? named.filter((id): id is string => typeof id === 'string') : [],
  )
}

export function AttachFiles(props: { noteId: string }) {
  const note = useLoad<NoteFull>(() => ask('revealNote', { id: props.noteId }), [props.noteId])
  const [chosen, setChosen] = useState<Chosen[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [percent, setPercent] = useState(0)
  const [added, setAdded] = useState(0)
  useBackgroundHeld(busy)
  const current = note.value

  if (current === undefined)
    return note.error === undefined ? (
      <p class="muted" role="status">
        {t('popup_loading')}
      </p>
    ) : (
      <Notice kind="error">{note.error}</Notice>
    )

  if (current.space?.canEdit === false) return <Notice>{t('files_spaceReadOnly')}</Notice>

  const waiting = chosen.filter((item) => item.state.kind !== 'added')
  // What the note can still take besides the files already chosen (the note's own count includes the ones added so far)
  const room = noteFileLimit - current.attachments.length - waiting.length
  const finished = chosen.length > 0 && waiting.length === 0
  const setState = (key: number, state: State) =>
    setChosen((list) => list.map((item) => (item.key === key ? { ...item, state } : item)))

  const choose = (picked: File[]) => {
    const refusals = picked.map(refusalOf).filter((why): why is string => why !== undefined)
    const fine = picked.filter((file) => refusalOf(file) === undefined)
    const fits = fine.slice(0, Math.max(0, room))
    setError(
      refusals[0] ??
        (fits.length < fine.length ? t('files_errorTooMany', noteFileLimit) : undefined),
    )
    setChosen((list) => [
      ...list,
      ...fits.map((file) => ({ key: nextKey++, file, state: { kind: 'waiting' } as State })),
    ])
  }

  const send = async () => {
    setError(undefined)
    setBusy(true)
    const todo = chosen.filter((item) => item.state.kind !== 'added')
    for (let start = 0; start < todo.length; start += stagedAtOnce) {
      const group = todo.slice(start, start + stagedAtOnce)
      const handles: { key: number; handle: string }[] = []
      try {
        for (const item of group) {
          setState(item.key, { kind: 'sending' })
          setPercent(0)
          const staged = await stageBlob(
            item.file,
            (data, held) =>
              ask('stageItemFile', held === undefined ? { data } : { data, handle: held }),
            (sent, total) => setPercent(Math.round((sent / total) * 100)),
            (held) => ask('releaseStaged', { handle: held }).catch(() => undefined),
          )
          handles.push({ key: item.key, handle: staged.handle })
        }
        const result = await ask('addAttachments', {
          noteId: props.noteId,
          files: group.map((item) => ({
            handle: handles.find((held) => held.key === item.key)!.handle,
            name: item.file.name,
            ...(item.file.type === '' ? {} : { type: item.file.type }),
          })),
        })
        // Only the files the core says did not go are left to try again
        const failed = failedOf(result)
        let went = 0
        for (const item of group) {
          const handle = handles.find((held) => held.key === item.key)!.handle
          if (failed.has(handle) || failed.has(item.file.name)) {
            await ask('releaseStaged', { handle }).catch(() => undefined)
            setState(item.key, { kind: 'failed', why: t('files_errorNotAdded', item.file.name) })
          } else {
            setState(item.key, { kind: 'added' })
            went += 1
          }
        }
        setAdded((count) => count + went)
        if (went < group.length) setError(t('files_errorSomeNotAdded'))
      } catch (failure) {
        // What was staged for this group and did not get added is let go of; the groups after it are left for another try
        for (const held of handles)
          await ask('releaseStaged', { handle: held.handle }).catch(() => undefined)
        const why = fileError(failure)
        for (const item of group) setState(item.key, { kind: 'failed', why })
        for (const item of todo.slice(start + stagedAtOnce)) setState(item.key, { kind: 'waiting' })
        setError(why)
        break
      }
    }
    await note.reload()
    setBusy(false)
  }

  if (finished && !busy)
    return (
      <Finished
        title={t('files_attachedTitle')}
        body={t('files_attached', current.title, added)}
        again={{
          label: t('files_addMore'),
          onClick: () => {
            setChosen([])
            setAdded(0)
          },
        }}
      />
    )

  const statusOf = (state: State): string | undefined =>
    state.kind === 'sending'
      ? t('files_sending', percent)
      : state.kind === 'added'
        ? t('files_statusAdded')
        : state.kind === 'failed'
          ? state.why
          : undefined

  return (
    <form
      class="files-panel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <p>{t('files_attaching', current.title)}</p>
      <p class="muted">
        {current.attachments.length === 0
          ? t('files_noteHoldsNone', noteFileLimit)
          : current.attachments.length === 1
            ? t('files_noteHoldsOne', noteFileLimit)
            : t('files_noteHolds', current.attachments.length, noteFileLimit)}
      </p>
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      {room > 0 ? (
        <FilePicker multiple disabled={busy} label={t('files_chooseMany')} onChoose={choose} />
      ) : (
        <Notice>{t('files_errorTooMany', noteFileLimit)}</Notice>
      )}
      <p class="muted">{t('files_limit', fileSize(itemFileLimit))}</p>
      {chosen.length > 0 && (
        <ul class="files-chosen-list">
          {chosen.map((item) => (
            <ChosenFile
              key={item.key}
              file={item.file}
              status={statusOf(item.state)}
              failed={item.state.kind === 'failed'}
              onRemove={
                busy || item.state.kind === 'added'
                  ? undefined
                  : () => setChosen((list) => list.filter((other) => other.key !== item.key))
              }
            />
          ))}
        </ul>
      )}
      {busy && (
        <p class="muted" role="status">
          {t('files_sealing')}
        </p>
      )}
      <div class="actions start">
        <Button kind="primary" tall type="submit" busy={busy} disabled={waiting.length === 0}>
          {t('files_addToNote')}
        </Button>
      </div>
    </form>
  )
}
