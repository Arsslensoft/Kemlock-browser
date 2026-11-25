// A Send's page (docs/plans/add-sends.md): its state, Copy link through the clipboard that clears itself, the on and off switch, Edit
// and Delete. The link is rebuilt by the core from the Send's sealed key and goes to the clipboard in the background: this page never
// holds it.
import { useState } from 'preact/hooks'
import { KemlockIcon } from '../shared/brand/brand'
import {
  Button,
  Confirm,
  Group,
  IconButton,
  Notice,
  PageHeader,
  Switch,
  TextField,
  Tile,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, formatDate, t } from '../shared/ui/i18n'
import { SendOptionsFields } from '../shared/sends-fields'
import { draftOf, sendPatch, type OptionsDraft } from '../shared/sends-options'
import type { SendDetail, SendPatch } from '../shared/sends'
import { sendKindText, sendOpensText, sendProblemText, sendStatusText } from '../shared/sends-text'
import type { Vault } from './data'
import { ask } from './send'
import './sends.css'

function Row(props: { label: string; children: string }) {
  return (
    <div class="detail-row">
      <span class="detail-label">{props.label}</span>
      <span class="grow">{props.children}</span>
    </div>
  )
}

/** The form that changes a Send's options. Only what differs is sent: the core keeps the rest as the Send has it. */
function EditSend(props: { send: SendDetail; onCancel: () => void; onSaved: () => void }) {
  const { send } = props
  const [name, setName] = useState(send.name ?? '')
  const [text, setText] = useState(send.text ?? '')
  const [draft, setDraft] = useState<OptionsDraft>(() => draftOf(send))
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const isText = send.kind === 'text'

  const save = async () => {
    const patch = sendPatch(send, { name, text: isText ? text : undefined }, draft, Date.now())
    if (patch === 'maxAccess') {
      setError(t('sends_errorMaxAccessFrom', Math.max(1, send.accessCount)))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const result = await ask('sendUpdate', { id: send.id, patch })
      if (!result.ok) {
        setError(sendProblemText(result))
        setBusy(false)
        return
      }
      props.onSaved()
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t('sends_editTitle')}
        onBack={props.onCancel}
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
          {isText ? (
            <>
              <TextField
                label={t('sends_name')}
                hint={t('sends_nameHint')}
                value={name}
                onInput={setName}
              />
              <TextField label={t('sends_text')} value={text} multiline onInput={setText} />
            </>
          ) : (
            <Notice>{t('sends_editFileNote')}</Notice>
          )}
          <SendOptionsFields draft={draft} onChange={setDraft} was={send} />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onCancel}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}

export function SendPage(props: { id: string; vault: Vault; onBack: () => void }) {
  const loaded = useLoad(() => ask('sendGet', { id: props.id }), [props.id])
  const say = useToast()
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [showText, setShowText] = useState(false)
  const [busy, setBusy] = useState(false)
  const result = loaded.value

  if (result === undefined || !result.ok) {
    return (
      <div class="screen">
        <PageHeader title={t('sends_title')} onBack={props.onBack} backLabel={t('popup_back')} />
        <div class="body">
          {result === undefined && loaded.error === undefined ? (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          ) : (
            <Notice kind="error">
              {result === undefined ? (loaded.error ?? '') : sendProblemText(result)}
            </Notice>
          )}
        </div>
      </div>
    )
  }

  const send = result.value
  const name = send.readable && send.name !== undefined ? send.name : t('sends_status_unreadable')

  if (editing)
    return (
      <EditSend
        send={send}
        onCancel={() => setEditing(false)}
        onSaved={() =>
          void (async () => {
            setEditing(false)
            say(t('sends_saved'))
            await loaded.reload()
          })()
        }
      />
    )

  const update = async (patch: SendPatch) => {
    setBusy(true)
    try {
      const done = await ask('sendUpdate', { id: send.id, patch })
      if (!done.ok) say(sendProblemText(done))
      await loaded.reload()
    } catch (failure) {
      say(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    try {
      const done = await ask('sendCopyLink', { id: send.id })
      if (!done.ok) say(sendProblemText(done))
      else
        say(
          t('sends_linkCopied'),
          t('popup_clipboardClears', props.vault.settings.clipboardSeconds),
        )
    } catch (failure) {
      say(errorMessage(failure))
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      const done = await ask('sendDelete', { id: send.id })
      if (!done.ok) {
        say(sendProblemText(done))
        setBusy(false)
        setAsking(false)
        return
      }
      say(t('sends_deleted'))
      props.onBack()
    } catch (failure) {
      say(errorMessage(failure))
      setBusy(false)
      setAsking(false)
    }
  }

  return (
    <div class="screen">
      <header class="bar login-bar">
        <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
        <KemlockIcon size={24} class="mark" />
        <Tile name={name} size={32} />
        <h1 class="login-title">{name}</h1>
        {send.readable && (
          <button type="button" class="link-btn hov" onClick={() => setEditing(true)}>
            {t('popup_edit')}
          </button>
        )}
        <IconButton
          icon="trash"
          label={t('sends_deleteSend', name)}
          onClick={() => setAsking(true)}
        />
      </header>

      {asking && (
        <div class="login-confirm">
          <Confirm
            title={t('sends_deleteTitle')}
            body={t('sends_deleteBody', name)}
            confirmLabel={t('popup_delete')}
            cancelLabel={t('popup_cancel')}
            danger
            busy={busy}
            onCancel={() => setAsking(false)}
            onConfirm={() => void remove()}
          />
        </div>
      )}

      <div class="body tight">
        {!send.readable ? (
          <Notice kind="warn">{t('sends_unreadable')}</Notice>
        ) : (
          <>
            <Group>
              <Row label={t('sends_detailType')}>{sendKindText(send.kind)}</Row>
              <Row label={t('sends_detailStatus')}>{sendStatusText(send.status)}</Row>
              <Row label={t('sends_detailOpens')}>{sendOpensText(send)}</Row>
              <Row label={t('sends_detailDeletes')}>{formatDate(send.deletionAt)}</Row>
              {send.expiresAt !== undefined && (
                <Row label={t('sends_detailExpires')}>{formatDate(send.expiresAt)}</Row>
              )}
              {send.hasPassword && (
                <Row label={t('sends_password')}>{t('sends_detailPassword')}</Row>
              )}
            </Group>
            {send.status === 'waitingForFile' && (
              <Notice kind="warn">{t('sends_waitingNote')}</Notice>
            )}
            {send.notes !== undefined && send.notes !== '' && (
              <Group pad>
                <span class="detail-label">{t('sends_detailNotes')}</span>
                <p class="note-text">{send.notes}</p>
              </Group>
            )}
            {send.text !== undefined && (
              <Group pad>
                {showText ? (
                  <p class="note-text mono send-text">{send.text}</p>
                ) : (
                  <span class="muted">{t('sends_textHidden')}</span>
                )}
                <div class="actions start">
                  <Button onClick={() => setShowText((on) => !on)}>
                    {showText ? t('popup_hide') : t('sends_showText')}
                  </Button>
                </div>
              </Group>
            )}
            <Group>
              <Switch
                checked={!send.disabled}
                label={t('sends_on')}
                detail={t('sends_onHint')}
                disabled={busy}
                onChange={(on) => void update({ disabled: !on })}
              />
            </Group>
            <p class="muted">{t('sends_linkWarning')}</p>
            <div class="actions">
              <Button kind="primary" icon="copy" tall onClick={() => void copyLink()}>
                {t('sends_copyLink')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
