// Opening a Send from its link, as a recipient (docs/plans/add-sends.md, design 7). It needs no account: the link's key stays in the core,
// which asks the link's own server for the sealed Send and opens it. This page asks the browser for access to that server first, from
// the click, since a link may name any server.
import { useEffect, useRef, useState } from 'preact/hooks'
import { sendLinkMaxLength, type ReceivedSendView, type SendFailure } from '../shared/sends'
import { fileSizeText, sendProblemText } from '../shared/sends-text'
import { Button, Group, Notice, TextField, useToast } from '../shared/ui/components'
import { errorMessage, formatDate, t } from '../shared/ui/i18n'
import { ask, AskError, isGone } from './ask'
import { readFile, saveBlob } from './files'
import { useBackgroundHeld } from './keepalive'
import { fileNameOnly, findSendLink, hostOfLink, originPatternOf } from './links'
import { openLinkInTab } from './tabs'

/** What a received Send shows: its text with Copy, or its file with Save. */
function Received(props: { send: ReceivedSendView; onClose: () => void }) {
  const { send } = props
  const say = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [noted, setNoted] = useState(false)

  // The text goes from the core to a note in the background, and not through this page
  const saveAsNote = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await ask('sendSaveAsNote', { handle: send.handle })
      setNoted(true)
      say(t('sends_noteSaved'))
    } catch (failure) {
      setError(
        isGone(failure)
          ? t('sends_lostReceived')
          : failure instanceof AskError && failure.code === 'invalid'
            ? t('sends_noteTooLong')
            : errorMessage(failure),
      )
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await ask('sendCopyText', { handle: send.handle })
      say(t('sends_copied'), t('sends_clipboardClears'))
    } catch (failure) {
      say(isGone(failure) ? t('sends_lostReceived') : errorMessage(failure))
    }
  }

  // Saving fetches the file, which counts as an open, and the core holds it: a second save reads what it holds
  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const done = await ask('sendDownload', { handle: send.handle })
      if (!done.ok) {
        setError(sendProblemText(done, true))
        return
      }
      const blob = await readFile(
        (index) => ask('sendReadFile', { handle: send.handle, index }),
        send.mime,
      )
      saveBlob(blob, fileNameOnly(send.name))
      say(t('sends_savedFile'))
    } catch (failure) {
      setError(isGone(failure) ? t('sends_lostReceived') : errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Group pad accent>
      <h2 class="sends-title">{send.name}</h2>
      {send.senderEmail !== undefined && <p class="muted">{t('sends_from', send.senderEmail)}</p>}
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      {send.kind === 'text' ? (
        <>
          <pre class="received-text">{send.text}</pre>
          <div class="actions start">
            <Button kind="primary" icon="copy" onClick={() => void copy()}>
              {t('sends_copy')}
            </Button>
            <Button busy={busy} disabled={noted} onClick={() => void saveAsNote()}>
              {t('sends_saveNote')}
            </Button>
          </div>
        </>
      ) : send.tooBig ? (
        <Notice kind="warn">{sendProblemText({ problem: 'tooBig', size: send.size }, true)}</Notice>
      ) : (
        <>
          <p class="mono">
            {t('sends_receivedFile', send.mime ?? '', fileSizeText(send.size ?? 0))}
          </p>
          <p class="muted">{t('sends_fileUses')}</p>
          {busy && (
            <p class="muted" role="status">
              {t('sends_downloading')}
            </p>
          )}
          <div class="actions start">
            <Button kind="primary" icon="arrowRight" busy={busy} onClick={() => void save()}>
              {t('sends_save')}
            </Button>
          </div>
        </>
      )}
      <p class="muted">{t('sends_deletesOn', formatDate(send.deletionAt))}</p>
      <div class="actions start">
        <Button onClick={props.onClose}>{t('sends_close')}</Button>
      </div>
    </Group>
  )
}

export function OpenSend() {
  const [link, setLink] = useState('')
  const [password, setPassword] = useState('')
  const [asksPassword, setAsksPassword] = useState(false)
  const [failure, setFailure] = useState<SendFailure | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [received, setReceived] = useState<ReceivedSendView | undefined>()
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)

  // The core holds the received Send under a handle only this page has: it is let go when the page goes, and the background is held
  // (a port, pinged) while it is open, since a stopped worker would lose it
  const held = useRef<string | undefined>(undefined)
  held.current = received?.handle
  useBackgroundHeld(received !== undefined)
  useEffect(() => {
    const letGo = () => {
      if (held.current !== undefined)
        void ask('sendClose', { handle: held.current }).catch(() => undefined)
    }
    window.addEventListener('pagehide', letGo)
    return () => {
      window.removeEventListener('pagehide', letGo)
      letGo()
    }
  }, [])

  // After too many password tries the server says how long to wait
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const open = () => {
    setFailure(undefined)
    setError(undefined)
    const text = link.trim()
    if (text.length > sendLinkMaxLength) {
      setError(t('sends_inputTooLong'))
      return
    }
    // Only the link found goes on, to the browser's permission and to the core: not the message around it, which may hold another
    const found = findSendLink(text)
    if (found === null) {
      setFailure({ problem: 'badLink' })
      return
    }
    const pattern = originPatternOf(found)
    // The browser asks only from this click, so the request comes before anything awaits. Already granted, it answers at once.
    const access: Promise<boolean> =
      pattern === null
        ? Promise.resolve(true)
        : Promise.resolve(chrome.permissions.request({ origins: [pattern] })).catch(() => false)
    void (async () => {
      setBusy(true)
      try {
        if (!(await access)) {
          setError(t('sends_accessRefused', hostOfLink(found)))
          return
        }
        const done = await ask('sendOpen', {
          link: found,
          ...(asksPassword && password !== '' ? { password } : {}),
        })
        if (done.ok) {
          setReceived(done.value)
          setLink('')
          setPassword('')
          setAsksPassword(false)
          return
        }
        if (done.problem === 'passwordRequired') {
          setAsksPassword(true)
          return
        }
        if (done.problem === 'rateLimited') setWait(done.seconds ?? 60)
        setFailure(done)
      } catch (problem) {
        setError(errorMessage(problem))
      } finally {
        setBusy(false)
      }
    })()
  }

  const close = () => {
    const handle = received?.handle
    // Forgotten at once, so the page's own "let go when it goes" doesn't close it a second time
    held.current = undefined
    setReceived(undefined)
    if (handle !== undefined) void ask('sendClose', { handle }).catch(() => undefined)
  }

  if (received !== undefined)
    return (
      <div class="sends-panel">
        <Received send={received} onClose={close} />
      </div>
    )

  const found = findSendLink(link)
  return (
    <form
      class="sends-panel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (wait <= 0 && link.trim() !== '') open()
      }}
    >
      <p class="muted">{t('sends_openBody')}</p>
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      {failure !== undefined && (
        <Notice kind={failure.problem === 'wrongPassword' ? 'warn' : 'error'}>
          {sendProblemText(failure, true)}
          {failure.problem === 'notFound' && ` ${t('sends_notAvailableHint')}`}
          {failure.problem === 'rateLimited' && wait > 0 ? ` (${wait})` : ''}
        </Notice>
      )}
      <TextField
        label={t('sends_linkField')}
        value={link}
        multiline
        placeholder="https://vault.example/#/send/…"
        onInput={(value) => {
          setLink(value)
          setAsksPassword(false)
          setPassword('')
        }}
      />
      {asksPassword && (
        <>
          <p class="sends-strong">{t('sends_passwordTitle')}</p>
          <TextField
            label={t('sends_password')}
            type="password"
            autocomplete="off"
            value={password}
            autofocus
            onInput={setPassword}
          />
        </>
      )}
      <div class="actions start">
        <Button
          kind="primary"
          tall
          type="submit"
          busy={busy}
          disabled={wait > 0 || link.trim() === ''}
        >
          {t('sends_openAction')}
        </Button>
        {failure?.problem === 'bitwarden' && found !== null && (
          <Button tall onClick={() => openLinkInTab(found)}>
            {t('sends_openInTab')}
          </Button>
        )}
      </div>
    </form>
  )
}
