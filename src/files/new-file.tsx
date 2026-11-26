// A new File item: the file, its name (the file's own to start with), notes and the pin. The file goes to the core a piece at a time and
// the core seals it and uploads it to Kemlock Server; the page never holds more than the piece it is sending.
import { useState } from 'preact/hooks'
import { fileError, fileSize, itemFileLimit } from '../popup/file-actions'
import { ask } from '../popup/send'
import { Button, Group, Notice, Switch, TextField } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { useBackgroundHeld } from './keepalive'
import { ChosenFile, FilePicker, Finished, refusalOf } from './picker'
import { stageBlob } from './stage'

type Step = 'idle' | 'send' | 'seal'

export function NewFile() {
  const [file, setFile] = useState<File | undefined>()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [pinned, setPinned] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const [made, setMade] = useState<string | undefined>()
  const busy = step !== 'idle'
  // The core holds the staged file for this tab: the background is held (a port, pinged) until the item is saved
  useBackgroundHeld(busy)

  const choose = (picked: File[]) => {
    const [first] = picked
    if (first === undefined) return
    const refused = refusalOf(first)
    if (refused !== undefined) {
      setError(refused)
      return
    }
    setError(undefined)
    setFile(first)
    // The name follows the file until the person has typed one of their own
    if (name.trim() === '' || name === file?.name) setName(first.name)
  }

  const reset = () => {
    setFile(undefined)
    setName('')
    setNotes('')
    setPinned(false)
    setMade(undefined)
    setError(undefined)
  }

  const save = async () => {
    setError(undefined)
    if (file === undefined) return setError(t('files_errorNoFile'))
    if (name.trim() === '') return setError(t('files_nameNeeded'))
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
      const saved = await ask('saveFile', {
        id: null,
        input: {
          name: name.trim(),
          notes,
          pinned,
          staged: { handle, name: file.name, ...(file.type === '' ? {} : { type: file.type }) },
        },
      })
      handle = undefined
      setMade(saved.name)
      setFile(undefined)
    } catch (failure) {
      // A handle the core still holds after a failed save is let go of here
      if (handle !== undefined) await ask('releaseStaged', { handle }).catch(() => undefined)
      setError(fileError(failure))
    } finally {
      setStep('idle')
    }
  }

  if (made !== undefined)
    return (
      <Finished
        title={t('files_savedTitle')}
        body={t('files_saved', made)}
        again={{ label: t('files_addAnother'), onClick: reset }}
      />
    )

  return (
    <form
      class="files-panel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
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
      <TextField label={t('files_fieldName')} value={name} onInput={setName} />
      <TextField label={t('files_fieldNotes')} value={notes} multiline onInput={setNotes} />
      <Group>
        <Switch checked={pinned} label={t('items_pin')} onChange={setPinned} />
      </Group>
      {busy && (
        <p class="muted" role="status">
          {step === 'send' ? t('files_sending', percent) : t('files_sealing')}
        </p>
      )}
      <div class="actions start">
        <Button kind="primary" tall type="submit" busy={busy}>
          {t('files_save')}
        </Button>
      </div>
    </form>
  )
}
