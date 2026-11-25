// Small pieces the keys screens share: a block of text to copy or save, a box that takes pasted text or a chosen file, a
// passphrase asked twice, and a signature's verdict.
import { useRef } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { SignatureView, Source } from '../../shared/keys-api'
import { Button, Notice, TextField, useToast } from '../../shared/ui/components'
import { formatDateTime, t } from '../../shared/ui/i18n'
import { Icon } from '../../shared/ui/icons'
import { download, inKeysTab, openKeysTab, readFile, type PickedFile } from './files'

/** A line of text to read and copy: a public key, a fingerprint, a result. */
export function CopyBox(props: {
  label: string
  text: string
  /** Offers a download under this name. */
  fileName?: string
  rows?: number
  /** A key that is not public: shown for as long as the screen shows it. */
  secret?: boolean
  onCopy?: () => void
}) {
  const say = useToast()
  const copy = async () => {
    if (props.onCopy !== undefined) return props.onCopy()
    try {
      await navigator.clipboard.writeText(props.text)
      say(t('keys_copied'))
    } catch {
      say(t('keys_copyFailed'))
    }
  }
  return (
    <div class={`keys-block${props.secret === true ? ' secret' : ''}`}>
      <TextField
        label={props.label}
        value={props.text}
        multiline
        readOnly
        mono
        class="keys-text"
        onInput={() => undefined}
      />
      <div class="keys-actions">
        <Button icon="copy" onClick={() => void copy()}>
          {t('keys_copy')}
        </Button>
        {props.fileName !== undefined && (
          <Button onClick={() => download(props.fileName!, props.text)}>
            {t('keys_download')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** A file chosen for a tool. In the toolbar popup a file dialog would close the popup, so it opens the keys tab instead. */
export function FileChooser(props: {
  file: PickedFile | null
  onFile: (file: PickedFile | null) => void
  /** The keys tab's address for the screen the person is on, to open when this is the popup. */
  tabHash: string
  accept?: string
  /** Said when the file is over what the tools take. */
  onTooLarge: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  if (!inKeysTab())
    return (
      <Button icon="folder" onClick={() => openKeysTab(props.tabHash)}>
        {t('keys_chooseFileInTab')}
      </Button>
    )
  return (
    <div class="keys-file">
      <input
        ref={input}
        type="file"
        hidden
        accept={props.accept}
        aria-label={t('keys_chooseFile')}
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (chosen === undefined) return
          void readFile(chosen).then((read) => {
            if (read === null) props.onTooLarge()
            else props.onFile(read)
          })
        }}
      />
      <Button icon="folder" onClick={() => input.current?.click()}>
        {props.file === null ? t('keys_chooseFile') : props.file.name}
      </Button>
      {props.file !== null && (
        <button type="button" class="link-btn quiet" onClick={() => props.onFile(null)}>
          {t('keys_removeFile')}
        </button>
      )}
    </div>
  )
}

/** The `Source` a box and a file make: the file wins; nothing when both are empty. */
export function sourceOf(text: string, file: PickedFile | null): Source | null {
  if (file !== null) return { base64: file.base64 }
  return text.trim() === '' ? null : { text }
}

/** Pasted text, or a file where the keys tab can choose one. */
export function SourceBox(props: {
  label: string
  text: string
  onText: (text: string) => void
  file: PickedFile | null
  onFile: (file: PickedFile | null) => void
  placeholder?: string
  tabHash: string
  onTooLarge: () => void
  /** Without a file (a clear-signed text is text). */
  textOnly?: boolean
}) {
  return (
    <div class="stack-12">
      {props.file === null && (
        <TextField
          label={props.label}
          value={props.text}
          multiline
          mono
          class="keys-text"
          placeholder={props.placeholder}
          onInput={props.onText}
        />
      )}
      {props.textOnly !== true && (
        <FileChooser
          file={props.file}
          onFile={props.onFile}
          tabHash={props.tabHash}
          onTooLarge={props.onTooLarge}
        />
      )}
      {props.file !== null && (
        <p class="muted">{t('keys_fileChosen', props.file.name, formatSize(props.file.size))}</p>
      )}
    </div>
  )
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A passphrase to type, shown as dots. */
export function Passphrase(props: {
  label: string
  value: string
  onInput: (value: string) => void
  hint?: string
  invalid?: boolean
  autofocus?: boolean
}) {
  return (
    <TextField
      label={props.label}
      type="password"
      value={props.value}
      hint={props.hint}
      invalid={props.invalid}
      autofocus={props.autofocus}
      autocomplete="off"
      onInput={props.onInput}
    />
  )
}

const verdictNames: Record<SignatureView['verdict'], string> = {
  good: 'keys_verdictGood',
  bad: 'keys_verdictBad',
  unknownSigner: 'keys_verdictUnknown',
  weakHash: 'keys_verdictWeakHash',
  weakKey: 'keys_verdictWeakKey',
  unsupported: 'keys_verdictUnsupported',
}

/** What a signature came to: who made it and whether to trust it. */
export function SignatureLine(props: { signature: SignatureView }) {
  const { signature } = props
  const good = signature.verdict === 'good'
  const warn = good && (signature.keyExpired || signature.keyRevoked || signature.keyExpiredSince)
  const kind = !good ? 'error' : warn || signature.signer?.checked === false ? 'warn' : 'ok'
  const who =
    signature.signer !== undefined
      ? signature.signer.name
      : signature.issuer !== undefined
        ? signature.issuer
        : ''
  return (
    <Notice kind={kind}>
      <p class="strong">{t(verdictNames[signature.verdict], who)}</p>
      {signature.detail !== undefined && <p>{signature.detail}</p>}
      {signature.made !== undefined && <p class="muted">{formatDateTime(signature.made)}</p>}
      {signature.keyRevoked && <p>{t('keys_signerRevoked')}</p>}
      {signature.keyExpired && <p>{t('keys_signerExpired')}</p>}
      {!signature.keyExpired && signature.keyExpiredSince && <p>{t('keys_signerExpiredSince')}</p>}
      {good && signature.signer?.kind === 'contact' && !signature.signer.checked && (
        <p>{t('keys_signerUnchecked')}</p>
      )}
    </Notice>
  )
}

/** A heading and what sits under it, for a screen of several parts. */
export function Block(props: { title?: string; children?: ComponentChildren }) {
  return (
    <section class="keys-section">
      {props.title !== undefined && <h2 class="label-caps">{props.title}</h2>}
      {props.children}
    </section>
  )
}

/** A line that says something small under a field. */
export function Aside(props: { children?: ComponentChildren }) {
  return (
    <p class="keys-aside">
      <Icon name="alert" size={13} weight={2} />
      <span>{props.children}</span>
    </p>
  )
}
