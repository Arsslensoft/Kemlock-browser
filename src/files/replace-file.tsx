// A File item's new file: the item keeps its name, notes, pin and tags; the file under it is replaced once the new one is up.
import { useState } from 'preact/hooks'
import type { FileFull } from '../shared/api'
import { fileDetail, fileError, fileSize, itemFileLimit } from '../popup/file-actions'
import { ask } from '../popup/send'
import { Button, Notice, useLoad } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { useBackgroundHeld } from './keepalive'
import { ChosenFile, FilePicker, Finished, refusalOf } from './picker'
import { stageBlob } from './stage'

type Step = 'idle' | 'send' | 'seal'

export function ReplaceFile(props: { id: string }) {
  const loaded = useLoad<FileFull>(() => ask('revealFile', { id: props.id }), [props.id])
  const [file, setFile] = useState<File | undefined>()
  const [step, setStep] = useState<Step>('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const [done, setDone] = useState(false)
  const busy = step !== 'idle'
  useBackgroundHeld(busy)
  const current = loaded.value

  if (current === undefined)
    return loaded.error === undefined ? (
      <p class="muted" role="status">
        {t('popup_loading')}
      </p>
    ) : (
      <Notice kind="error">{loaded.error}</Notice>
    )

  const choose = (picked: File[]) => {
    const [first] = picked
    if (first === undefined) return
    const refused = refusalOf(first)
    setError(refused)
    if (refused === undefined) setFile(first)
  }

  const replace = async () => {
    setError(undefined)
    if (file === undefined) return setError(t('files_errorNoFile'))
    let handle: string | undefined
    try {
      setStep('send')
      setPercent(0)
      const staged = await stageBlob(
        file,
        (data, held) =>
          ask('stageItemFile', held === undefined ? { data } : { data, handle: held }),
        (sent, total) => setPercent(Math.round((sent / total) * 100)),
        (held) => ask('releaseStaged', { handle: held }).catch(() => undefined),
      )
      handle = staged.handle
      setStep('seal')
      // The item's own members go back as they are; only the file changes
      await ask('saveFile', {
        id: current.id,
        input: {
          name: current.name,
          notes: current.notes,
          pinned: current.pinned,
          tags: current.tags,
          staged: { handle, name: file.name, ...(file.type === '' ? {} : { type: file.type }) },
        },
      })
      handle = undefined
      setDone(true)
    } catch (failure) {
      if (handle !== undefined) await ask('releaseStaged', { handle }).catch(() => undefined)
      setError(fileError(failure))
    } finally {
      setStep('idle')
    }
  }

  if (done)
    return <Finished title={t('files_replacedTitle')} body={t('files_replaced', current.name)} />

  const now = fileDetail({
    name: current.fileName ?? current.name,
    type: current.type,
    size: current.size,
  })
  return (
    <form
      class="files-panel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void replace()
      }}
    >
      <p>{t('files_replacing', current.name)}</p>
      {current.fileName !== undefined && (
        <p class="muted">
          {t('files_currentFile', current.fileName)}
          {now === '' ? '' : ` · ${now}`}
        </p>
      )}
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <FilePicker
        disabled={busy}
        label={file === undefined ? t('files_choose') : t('files_change')}
        onChoose={choose}
      />
      <p class="muted">{t('files_limit', fileSize(itemFileLimit))}</p>
      {file !== undefined && (
        <ul class="files-chosen-list">
          <ChosenFile file={file} />
        </ul>
      )}
      {busy && (
        <p class="muted" role="status">
          {step === 'send' ? t('files_sending', percent) : t('files_sealing')}
        </p>
      )}
      <div class="actions start">
        <Button kind="primary" tall type="submit" busy={busy}>
          {t('files_replace')}
        </Button>
      </div>
    </form>
  )
}
