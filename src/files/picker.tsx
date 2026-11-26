// What the pages of the files tab share: the drop area with its file picker, and a row for a chosen file.
import { useRef, useState } from 'preact/hooks'
import { fileDetail, fileSize, itemFileLimit } from '../popup/file-actions'
import { Button, Group } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'

/** Why [file] can't be sent, in words, or undefined. */
export function refusalOf(file: File): string | undefined {
  if (file.size === 0) return t('files_errorEmpty', file.name)
  if (file.size > itemFileLimit) return t('files_errorTooBig', file.name, fileSize(itemFileLimit))
  return undefined
}

/**
 * A drop area with a button that opens the file picker (the input is reached through the button, which the keyboard and a screen
 * reader can use). [onChoose] hears the files chosen or dropped; with no [multiple] it hears at most one.
 */
export function FilePicker(props: {
  multiple?: boolean
  disabled?: boolean
  /** The button's text. */
  label: string
  onChoose: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const choose = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])]
    if (files.length > 0) props.onChoose(props.multiple === true ? files : files.slice(0, 1))
  }
  return (
    <div
      class={over ? 'files-drop over' : 'files-drop'}
      onDragOver={(event) => {
        event.preventDefault()
        if (props.disabled !== true) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        if (props.disabled !== true) choose(event.dataTransfer?.files)
      }}
    >
      <span class="files-drop-icon" aria-hidden="true">
        <Icon name="folder" size={28} weight={1.6} />
      </span>
      <p class="files-drop-title">
        {t(props.multiple === true ? 'files_dropMany' : 'files_dropOne')}
      </p>
      <input
        ref={input}
        type="file"
        multiple={props.multiple === true}
        class="files-hidden"
        tabIndex={-1}
        aria-hidden="true"
        disabled={props.disabled}
        onChange={(event) => {
          choose(event.currentTarget.files)
          // The same file can be chosen again once it was taken out
          event.currentTarget.value = ''
        }}
      />
      <Button icon="plus" disabled={props.disabled} onClick={() => input.current?.click()}>
        {props.label}
      </Button>
    </div>
  )
}

/** A chosen file: its name, kind and size, what is happening to it, and a way to take it out. */
export function ChosenFile(props: {
  file: File
  /** A word after the size ("Added", "Sending…"), or why it failed. */
  status?: string
  failed?: boolean
  onRemove?: () => void
}) {
  const { file } = props
  return (
    <li class="files-chosen">
      <span class="files-chosen-text">
        <span class="files-chosen-name">{file.name}</span>
        <span class={props.failed === true ? 'files-label danger-text' : 'files-label'}>
          {[fileDetail({ name: file.name, type: file.type, size: file.size }), props.status]
            .filter((part) => part !== undefined && part !== '')
            .join(' · ')}
        </span>
      </span>
      {props.onRemove !== undefined && (
        <Button label={t('files_removeNamed', file.name)} onClick={props.onRemove}>
          {t('files_remove')}
        </Button>
      )}
    </li>
  )
}

/** What a page says when its work is done: a title, a line, and what can be done next. */
export function Finished(props: {
  title: string
  body: string
  /** Starts the page over ("Add another file"), when there is something to add. */
  again?: { label: string; onClick: () => void }
}) {
  return (
    <Group pad accent class="files-done">
      <h2 class="files-title">{props.title}</h2>
      <p role="status">{props.body}</p>
      <div class="actions start">
        <Button kind="primary" tall onClick={() => window.close()}>
          {t('files_closeTab')}
        </Button>
        {props.again !== undefined && (
          <Button tall onClick={props.again.onClick}>
            {props.again.label}
          </Button>
        )}
      </div>
    </Group>
  )
}
