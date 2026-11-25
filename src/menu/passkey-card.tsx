// The passkey card (docs/plans/add-passkeys.md): what the in-page menu frame shows when a page of the tab asked for a passkey. The
// person chooses here, where the page can't read or touch it: "Save a passkey in Kemlock" or "Use another device or key" for a
// creation; the passkeys of the site or the same way out for a sign-in; the unlock form when the vault is locked. Every choice that
// makes or signs goes through the click gate (src/menu/gate.ts) like a fill, and the background decides again what it may do:
// the card only says which of its own choices the person made.
//
// It never takes the keyboard or focuses an action by itself: a page can ask while the person is typing, and their next Space or
// Enter must not answer. Saving or signing wants a press of the pointer; a key counts only after the person has moved into the
// card themselves (Tab or an arrow key). Everything it asks and answers goes under the card's token, which the background gave to
// the content script that shows it, so no other request of the tab, and no page that frames this menu page, can speak for it.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PasskeyPrompt } from '../shared/passkeys'
import { Header, Row, Rows, Unlock, ignoredText, pressOf, useSize } from './App'
import { ask } from './ask'
import type { Channel, Init } from './channel'
import type { Verdict } from './gate'
import { t } from './text'

type Loaded =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; prompt: PasskeyPrompt }

export function PasskeyApp({ channel, init }: { channel: Channel; init: Init }) {
  const ref = useSize(channel)
  // Whether the person has moved into the card with the keyboard themselves: only then does a key answer it. The keys are
  // heard on the card's document, which only receives them once the person has given the card the keyboard.
  const keyboard = useRef(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (['Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) keyboard.current = true
      // Escape is a no: the page is told the request was not allowed, not left waiting
      if (event.key !== 'Escape') return
      event.preventDefault()
      void ask('passkeyAnswer', {
        tabId: init.tabId,
        token: init.token ?? '',
        action: 'cancel',
      }).finally(() => channel.close(true))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [channel, init.tabId, init.token])
  return (
    <div class="card prompt" ref={ref}>
      <Header />
      <Card channel={channel} init={init} keyboard={keyboard} />
    </div>
  )
}

function Card({
  channel,
  init,
  keyboard,
}: {
  channel: Channel
  init: Init
  keyboard: { current: boolean }
}) {
  const token = init.token ?? ''
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (token === '') {
      setLoaded({ status: 'failed' })
      return
    }
    ask('passkeyPrompt', { tabId: init.tabId, token }).then(
      (prompt) => {
        // The request ended meanwhile (answered, aborted, or nothing of Kemlock's fits it): the card goes
        if (prompt === null) channel.close(false)
        else setLoaded({ status: 'ready', prompt })
      },
      () => setLoaded({ status: 'failed' }),
    )
  }, [channel, init.tabId, token])
  useEffect(load, [load])

  /** Answers the request, after the click gate lets the click count, and closes the card. */
  const answer = async (
    event: MouseEvent,
    action: 'save' | 'use' | 'other' | 'never' | 'dismiss',
    passkeyId?: string,
  ) => {
    if (busy) return
    // A key that presses a button the person never moved to is not their answer to a question they may not have seen
    if (event.detail === 0 && (action === 'save' || action === 'use') && !keyboard.current) {
      setNotice(t('passkeys_click'))
      return
    }
    const press = pressOf(event)
    const verdict: Verdict = await channel.permit(press.x, press.y)
    if (!verdict.ok) {
      setNotice(ignoredText(verdict.why))
      return
    }
    setNotice(null)
    setBusy(true)
    try {
      await ask('passkeyAnswer', {
        tabId: init.tabId,
        token,
        action,
        ...(passkeyId === undefined ? {} : { passkeyId }),
      })
      channel.close(false)
    } catch {
      setBusy(false)
      setNotice(t('passkeys_failed'))
    }
  }

  if (loaded.status === 'loading') return <p class="muted">{t('menu_loading')}</p>
  if (loaded.status === 'failed') return <p class="muted">{t('menu_failed')}</p>
  const { prompt } = loaded
  return (
    <Body
      prompt={prompt}
      notice={notice}
      busy={busy}
      onAnswer={(event, action, passkeyId) => void answer(event, action, passkeyId)}
      onUnlocked={load}
    />
  )
}

function Body(props: {
  prompt: PasskeyPrompt
  notice: string | null
  busy: boolean
  onAnswer: (
    event: MouseEvent,
    action: 'save' | 'use' | 'other' | 'never' | 'dismiss',
    id?: string,
  ) => void
  onUnlocked: () => void
}) {
  const { prompt, notice, busy } = props
  const create = prompt.kind === 'create'
  const unlocked = prompt.state.unlocked
  const held = prompt.alreadyHeld === true
  const lead = create ? t('passkeys_create_title') : t('passkeys_get_title')
  return (
    <>
      <p class="lead">{unlocked ? lead : t('passkeys_locked_title')}</p>
      <dl class="facts">
        <dt>{t('passkeys_site')}</dt>
        <dd class="mono">{prompt.site}</dd>
        {prompt.user !== undefined && (
          <>
            <dt>{t('passkeys_account')}</dt>
            <dd>{prompt.user.displayName ?? prompt.user.name}</dd>
          </>
        )}
        {prompt.crossOrigin && (
          <>
            <dt>{t('passkeys_asked_by')}</dt>
            <dd class="mono">{prompt.host}</dd>
          </>
        )}
      </dl>
      {!unlocked ? (
        <Unlock wrong={prompt.state.wrongPasswords} onUnlocked={props.onUnlocked} />
      ) : create ? (
        held ? (
          <p class="notice">{t('passkeys_already')}</p>
        ) : null
      ) : (
        <Rows>
          {prompt.choices.map((choice) => (
            <Row
              key={choice.id}
              title={choice.name}
              detail={choice.detail}
              disabled={busy}
              onClick={(event) => props.onAnswer(event, 'use', choice.id)}
            />
          ))}
        </Rows>
      )}
      {notice !== null ? (
        <p class="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div class="buttons">
        <button
          type="button"
          class="secondary"
          disabled={busy}
          onClick={(event) => props.onAnswer(event, 'other')}
        >
          {t('passkeys_other')}
        </button>
        {unlocked && create && held ? (
          <button
            type="button"
            class="primary"
            disabled={busy}
            onClick={(event) => props.onAnswer(event, 'dismiss')}
          >
            {t('passkeys_close')}
          </button>
        ) : unlocked && create ? (
          <button
            type="button"
            class="primary"
            data-row
            disabled={busy}
            onClick={(event) => props.onAnswer(event, 'save')}
          >
            {t('passkeys_save')}
          </button>
        ) : null}
      </div>
      <div class="footer">
        <button
          type="button"
          class="link"
          disabled={busy}
          onClick={(event) => props.onAnswer(event, 'never')}
        >
          {t('passkeys_never')}
        </button>
      </div>
    </>
  )
}
