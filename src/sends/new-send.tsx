// New Send (docs/plans/add-sends.md, design 4): a text or a file, with the options. It is a tab, not the popup, because choosing a file
// closes the popup. A file goes to the core a piece at a time, and the core seals everything: the page never holds the link, the key or
// the proof, and asks for the link to be copied through the clipboard that clears itself.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { SendKind } from '../shared/sends'
import { sendFileLimit, sendNameMaxLength } from '../shared/sends'
import { SendOptionsFields } from '../shared/sends-fields'
import { newDraft, newSendInput, type OptionsDraft } from '../shared/sends-options'
import { fileSizeText, sendProblemText } from '../shared/sends-text'
import { Button, Group, Notice, Tabs, TextField, useLoad, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { ask } from './ask'
import { stageFile } from './files'
import { useBackgroundHeld } from './keepalive'
import { openSetupTab } from './tabs'

type Step = 'idle' | 'file' | 'seal'

export function NewSend(props: {
  /** The draft a note left for this form (`sendTakeDraft` gives it once), when the popup opened the tab from a note. */
  draftToken?: string
  /** Said once the draft was asked for, so that the tab asks no more. */
  onDraftTaken?: () => void
}) {
  const listing = useLoad(() => ask('sends'))
  const say = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<SendKind>('text')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [draft, setDraft] = useState<OptionsDraft>(newDraft)
  const [step, setStep] = useState<Step>('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const [made, setMade] = useState<{ id: string; name: string } | undefined>()
  const [draftGone, setDraftGone] = useState(false)
  const busy = step !== 'idle'
  // A file going up is held by the core for this tab: the background is held (a port, pinged) until the Send is made
  useBackgroundHeld(busy)

  // "Send this note": the note's title and text come from the background, once, and start a text Send
  const { draftToken, onDraftTaken } = props
  useEffect(() => {
    if (draftToken === undefined) return
    let alive = true
    ask('sendTakeDraft', { token: draftToken }).then(
      (draft) => {
        if (!alive) return
        if (draft === null) setDraftGone(true)
        else {
          setKind('text')
          setName(draft.name)
          setText(draft.text)
        }
        // Asked for once: the tab asks no more, whichever way it went
        onDraftTaken?.()
      },
      () => {
        if (!alive) return
        setDraftGone(true)
        onDraftTaken?.()
      },
    )
    return () => {
      alive = false
    }
  }, [draftToken])
  const result = listing.value

  if (result === undefined || !result.ok || !result.value.available) {
    return (
      <div class="sends-panel">
        {result === undefined ? (
          listing.error === undefined ? (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          ) : (
            <Notice kind="error">{listing.error}</Notice>
          )
        ) : !result.ok ? (
          <Notice kind="error">{sendProblemText(result)}</Notice>
        ) : (
          <Notice kind="info">
            {sendProblemText({
              problem: 'noSync',
              place: result.value.available ? null : result.value.place,
            })}
          </Notice>
        )}
        <div class="actions start">
          {result !== undefined && result.ok ? (
            <Button onClick={openSetupTab}>{t('popup_setUpSync')}</Button>
          ) : (
            <Button onClick={() => void listing.reload()}>{t('sends_retry')}</Button>
          )}
        </div>
      </div>
    )
  }

  const choose = (picked: File | undefined) => {
    if (picked === undefined) return
    if (picked.size === 0) {
      setError(t('sends_errorEmptyFile'))
      return
    }
    if (picked.size > sendFileLimit) {
      setError(t('sends_errorFileTooBigLimit', fileSizeText(sendFileLimit)))
      return
    }
    setError(undefined)
    setFile(picked)
    if (name.trim() === '') setName(picked.name.slice(0, sendNameMaxLength))
  }

  const reset = () => {
    setName('')
    setText('')
    setFile(undefined)
    setDraft(newDraft())
    setMade(undefined)
    setError(undefined)
  }

  const make = async () => {
    setError(undefined)
    if (name.trim() === '') return setError(t('sends_errorNoName'))
    if (kind === 'text' && text === '') return setError(t('sends_errorNoText'))
    if (kind === 'file' && file === undefined) return setError(t('sends_errorNoFile'))
    const built = newSendInput({ kind, name, text, mime: file?.type }, draft, Date.now())
    if (built === 'maxAccess') return setError(t('sends_errorMaxAccess'))
    let input = built
    try {
      if (kind === 'file' && file !== undefined) {
        setStep('file')
        setPercent(0)
        const staged = await stageFile(
          file,
          (data, handle) =>
            ask('sendStageFile', handle === undefined ? { data } : { data, handle }),
          (sent, total) => setPercent(Math.round((sent / total) * 100)),
          (handle) => ask('sendClose', { handle }).catch(() => undefined),
        )
        if (!staged.ok) return setError(sendProblemText(staged))
        // The core makes the Send from the file under this handle, and only if it holds as many bytes as this page counted
        input = { ...built, handle: staged.value.handle, size: file.size }
      }
      setStep('seal')
      const done = await ask('sendMake', { input })
      if (!done.ok) return setError(sendProblemText(done))
      // What was typed is let go as the Send is made: the form starts over, and the page keeps only the Send's id
      setMade({ id: done.value.id, name: input.name })
      setText('')
      setFile(undefined)
      setDraft(newDraft())
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setStep('idle')
    }
  }

  const copyLink = async (id: string) => {
    try {
      const done = await ask('sendCopyLink', { id })
      if (done.ok) say(t('sends_linkCopied'), t('sends_clipboardClears'))
      else say(sendProblemText(done))
    } catch (failure) {
      say(errorMessage(failure))
    }
  }

  if (made !== undefined)
    return (
      <div class="sends-panel">
        <Group pad accent>
          <h2 class="sends-title">{t('sends_linkTitle')}</h2>
          <p>{t('sends_linkMade', made.name)}</p>
          <p class="muted">{t('sends_linkBody')}</p>
          <div class="actions start">
            <Button kind="primary" icon="copy" tall onClick={() => void copyLink(made.id)}>
              {t('sends_copyLink')}
            </Button>
            <Button tall onClick={reset}>
              {t('sends_makeAnother')}
            </Button>
          </div>
        </Group>
      </div>
    )

  return (
    <form
      class="sends-panel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void make()
      }}
    >
      <Tabs
        label={t('sends_what')}
        selected={kind}
        onSelect={(id) => {
          setKind(id === 'file' ? 'file' : 'text')
          setError(undefined)
        }}
        tabs={[
          { id: 'text', label: t('sends_kindText') },
          { id: 'file', label: t('sends_kindFile') },
        ]}
      />
      {draftGone && <Notice kind="warn">{t('sends_draftGone')}</Notice>}
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <div class="sends-panel" role="tabpanel" id={`panel-${kind}`} aria-labelledby={`tab-${kind}`}>
        <TextField
          label={t('sends_name')}
          hint={t('sends_nameHint')}
          value={name}
          onInput={setName}
        />
        {kind === 'text' ? (
          <TextField
            class="sends-text"
            label={t('sends_text')}
            value={text}
            multiline
            onInput={setText}
          />
        ) : (
          <div class="field">
            <span class="sends-file-label">{t('sends_fileLabel')}</span>
            <input
              ref={fileInput}
              type="file"
              class="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                choose(event.currentTarget.files?.[0])
                event.currentTarget.value = ''
              }}
            />
            <div class="actions start">
              <Button icon="plus" onClick={() => fileInput.current?.click()}>
                {file === undefined ? t('sends_fileChoose') : t('sends_fileChange')}
              </Button>
            </div>
            {file !== undefined && (
              <p class="sends-file" role="status">
                <Icon name="check" size={14} weight={2} />
                <span class="mono">
                  {t('sends_fileChosen', file.name, fileSizeText(file.size))}
                </span>
              </p>
            )}
            <p class="muted">{t('sends_fileLimit', fileSizeText(sendFileLimit))}</p>
          </div>
        )}
      </div>
      <SendOptionsFields draft={draft} onChange={setDraft} />
      {busy && (
        <p class="muted" role="status">
          {step === 'file'
            ? t('sends_sendingFile', percent)
            : draft.password === ''
              ? t('sends_making')
              : `${t('sends_making')} ${t('sends_deriving')}`}
        </p>
      )}
      <div class="actions start">
        <Button kind="primary" tall type="submit" busy={busy}>
          {t('sends_make')}
        </Button>
      </div>
    </form>
  )
}
