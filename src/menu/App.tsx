// The in-page menu and the save prompt (design decisions 4, 9, 10, 11): an extension page the content
// script shows in a frame the page can't read. It lists what the background says matches the field,
// and fills, saves or updates only after the click gate (src/menu/gate.ts) lets the click count.
// It renders text, never markup.
import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { CodeView, LoginView, MenuView, PageApi, PendingSave } from '../shared/api'
import { Wordmark } from '../shared/brand/brand'
import { ask } from './ask'
import type { Channel, Init } from './channel'
import { markDifference, type Part } from './diff'
import type { Ignored, Verdict } from './gate'
import {
  codeWords,
  firstScreen,
  knowsNothing,
  loginWords,
  matchedCodes,
  matchedLogins,
  search,
  tileHue,
  tileLetter,
  wantsCode,
  type Screen,
} from './model'
import { t } from './text'

/**
 * What the menu asks the background to fill: `newPassword` is a suggestion that goes into the field
 * and its confirmation, `remember` is "Always suggest here" (the background's `fill`).
 */
type FillArgs = Parameters<PageApi['fill']>[0] & { newPassword?: string; remember?: boolean }

const fillWith = (args: FillArgs) => ask('fill', args)

export interface AppProps {
  channel: Channel
  init: Init
}

/** The sentence that says why a click was ignored (spec: "say why"). */
export function ignoredText(why: Ignored): string {
  switch (why) {
    case 'wait':
      return t('menu_gate_wait')
    case 'faded':
      return t('menu_gate_faded')
    case 'covered':
      return t('menu_gate_covered')
    default:
      return t('menu_gate_hidden')
  }
}

/** A click or Enter: where in the frame it happened, or null for a key. */
interface Press {
  x: number | null
  y: number | null
}

export const pressOf = (event: MouseEvent): Press =>
  event.detail === 0 ? { x: null, y: null } : { x: event.clientX, y: event.clientY }

/** Runs [action] only when the gate lets this press count, else says why. */
function useGuarded(channel: Channel) {
  const [notice, setNotice] = useState<string | null>(null)
  const guarded = useCallback(
    async (press: Press, action: () => Promise<void>) => {
      const verdict: Verdict = await channel.permit(press.x, press.y)
      if (!verdict.ok) {
        setNotice(ignoredText(verdict.why))
        return
      }
      setNotice(null)
      try {
        await action()
      } catch {
        setNotice(t('menu_fill_failed'))
      }
    },
    [channel],
  )
  return { notice, setNotice, guarded }
}

/** Reports the card's height to the content script, which sizes the frame. */
function useSize(channel: Channel) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const card = ref.current
    if (card === null) return
    const report = () => channel.size(card.getBoundingClientRect().height)
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(card)
    return () => observer.disconnect()
  }, [channel])
  return ref
}

/** Up and Down move between the rows of a list; Escape closes the menu. */
function onKeys(channel: Channel) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      channel.close(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-row]'),
    )
    if (rows.length === 0) return
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1
    event.preventDefault()
    rows[(next + rows.length) % rows.length].focus()
  }
}

export function App({ channel, init }: AppProps) {
  const ref = useSize(channel)
  return (
    <div
      class={init.mode === 'save' ? 'card prompt' : 'card'}
      ref={ref}
      onKeyDown={onKeys(channel)}
    >
      {init.mode === 'save' ? (
        <>
          <Header />
          <SavePrompt channel={channel} init={init} />
        </>
      ) : (
        <MenuScreen channel={channel} init={init} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ */
/* The menu                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

type Loaded = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; view: MenuView }

function MenuScreen({ channel, init }: AppProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [screen, setScreen] = useState<Screen>('list')
  const [fromGuard, setFromGuard] = useState(false)

  const load = useCallback(() => {
    ask('menu', { tabId: init.tabId, frameId: init.frameId, fieldId: init.fieldId }).then(
      (view) => {
        setLoaded({ status: 'ready', view })
        setScreen(firstScreen(view))
      },
      () => setLoaded({ status: 'failed' }),
    )
  }, [init])
  useEffect(load, [load])

  const shell = (body: ComponentChildren, chip?: ComponentChildren) => (
    <>
      <Header chip={chip} />
      {body}
    </>
  )
  if (loaded.status === 'loading') return shell(<p class="muted">{t('menu_loading')}</p>)
  if (loaded.status === 'failed') return shell(<p class="muted">{t('menu_failed')}</p>)
  const { view } = loaded
  if (!view.state.exists) return shell(<p class="muted">{t('menu_no_vault')}</p>)
  if (!view.state.unlocked)
    return shell(<Unlock wrong={view.state.wrongPasswords} onUnlocked={load} />)
  if (view.field.kind === 'newPassword')
    return shell(<Suggestions channel={channel} init={init} view={view} />)
  if (screen === 'guard')
    return shell(
      <Guard
        channel={channel}
        view={view}
        onPick={() => {
          setFromGuard(true)
          setScreen('picker')
        }}
      />,
      <span class="chip">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        {t('menu_guard_chip')}
      </span>,
    )
  if (screen === 'picker')
    return shell(<Picker channel={channel} init={init} view={view} fromGuard={fromGuard} />)
  return shell(<List channel={channel} init={init} view={view} />)
}

/** The wordmark every card starts with. */
function Header({ chip }: { chip?: ComponentChildren }) {
  return (
    <div class="head">
      <Wordmark height={14} />
      {chip}
    </div>
  )
}

/** The letter tile of an item, in the hue its name gives. Decorative: the row's words name it. */
function Tile({ name }: { name: string }) {
  return (
    <span class="tile" aria-hidden="true" style={{ '--hue': String(tileHue(name)) } as never}>
      {tileLetter(name)}
    </span>
  )
}

function Rows({ children }: { children: ComponentChildren }) {
  return <div class="rows">{children}</div>
}

function Row(props: {
  title: string
  detail?: string
  /** The detail is a secret or an address: shown in the monospace face. */
  mono?: boolean
  disabled?: boolean
  onClick: (event: MouseEvent) => void
}) {
  return (
    <button
      type="button"
      class="row"
      data-row
      aria-disabled={props.disabled === true ? 'true' : undefined}
      onClick={(event) => {
        if (props.disabled === true) return
        props.onClick(event)
      }}
    >
      <Tile name={props.title} />
      <span class="words">
        <span class="name">{props.title}</span>
        {props.detail !== undefined && props.detail !== '' ? (
          <span class={props.mono === true ? 'detail mono' : 'detail'}>{props.detail}</span>
        ) : null}
      </span>
    </button>
  )
}

const loginTitle = (login: LoginView) => login.name || login.username
const loginDetail = (login: LoginView) => (login.name ? login.username : '')
const codeTitle = (code: CodeView) => code.issuer || code.account
const codeDetail = (code: CodeView) => (code.issuer ? code.account : '')

/** Focuses the first row once, so Enter and the arrows work in a menu opened from the keyboard. */
function useFirstFocus(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    document.querySelector<HTMLElement>('[data-row], input')?.focus()
  }, [ready])
}

function List({ channel, init, view }: AppProps & { view: MenuView }) {
  const { notice, guarded } = useGuarded(channel)
  const code = wantsCode(view)
  const logins = matchedLogins(view)
  const codes = matchedCodes(view)
  useFirstFocus(true)

  const fill = (press: Press, ids: { loginId?: string; codeId?: string }) =>
    guarded(press, async () => {
      await fillWith({
        tabId: init.tabId,
        frameId: init.frameId,
        fieldId: init.fieldId,
        ...ids,
      })
      channel.close(true)
    })

  return (
    <>
      {code ? (
        codes.length === 0 ? (
          <p class="muted">{t('menu_empty_codes')}</p>
        ) : (
          <Rows>
            {codes.map((c) => (
              <Row
                key={c.id}
                title={codeTitle(c)}
                detail={c.onSecurityKey ? t('menu_kept_on_key') : codeDetail(c)}
                disabled={c.onSecurityKey}
                onClick={(event) => void fill(pressOf(event), { codeId: c.id })}
              />
            ))}
          </Rows>
        )
      ) : logins.length === 0 ? (
        <p class="muted">{t('menu_empty_logins')}</p>
      ) : (
        <Rows>
          {logins.map((l) => (
            <Row
              key={l.id}
              title={loginTitle(l)}
              detail={loginDetail(l)}
              onClick={(event) => void fill(pressOf(event), { loginId: l.id })}
            />
          ))}
        </Rows>
      )}
      {notice !== null ? (
        <p class="notice" role="alert">
          {notice}
        </p>
      ) : null}
    </>
  )
}

/* The picker: every login or code, with search; the pick is confirmed with the address it fills. */

function Picker({
  channel,
  init,
  view,
  fromGuard,
}: AppProps & { view: MenuView; fromGuard: boolean }) {
  const code = wantsCode(view)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<{ login?: LoginView; code?: CodeView } | null>(null)
  useFirstFocus(chosen === null)

  if (chosen !== null)
    return (
      <Confirm
        channel={channel}
        init={init}
        view={view}
        chosen={chosen}
        fromGuard={fromGuard}
        onBack={() => setChosen(null)}
      />
    )

  const shownLogins = search(view.logins, query, loginWords)
  const shownCodes = search(view.codes, query, codeWords)
  const nothing = code ? shownCodes.length === 0 : shownLogins.length === 0
  return (
    <>
      {knowsNothing(view) && !fromGuard ? <p class="lead">{t('menu_unknown_site')}</p> : null}
      <div class="field">
        <input
          type="search"
          class="search"
          aria-label={t('menu_search')}
          placeholder={t('menu_search')}
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          autoComplete="off"
        />
      </div>
      {nothing ? <p class="muted">{t('menu_picker_none')}</p> : null}
      <Rows>
        {code
          ? shownCodes.map((c) => (
              <Row
                key={c.id}
                title={codeTitle(c)}
                detail={c.onSecurityKey ? t('menu_kept_on_key') : codeDetail(c)}
                disabled={c.onSecurityKey}
                onClick={() => setChosen({ code: c })}
              />
            ))
          : shownLogins.map((l) => (
              <Row
                key={l.id}
                title={loginTitle(l)}
                detail={loginDetail(l)}
                onClick={() => setChosen({ login: l })}
              />
            ))}
      </Rows>
    </>
  )
}

function Confirm({
  channel,
  init,
  view,
  chosen,
  fromGuard,
  onBack,
}: AppProps & {
  view: MenuView
  chosen: { login?: LoginView; code?: CodeView }
  fromGuard: boolean
  onBack: () => void
}) {
  const { notice, guarded } = useGuarded(channel)
  const [always, setAlways] = useState(false)
  // Read at the click: the box's state may not have rendered yet when Fill follows it at once
  const alwaysBox = useRef<HTMLInputElement>(null)
  const name = chosen.login !== undefined ? loginTitle(chosen.login) : codeTitle(chosen.code!)
  const warn = fromGuard || view.match.lookAlikeOf !== undefined
  return (
    <>
      <p class="lead">{t('menu_confirm_title', name)}</p>
      <p class="address">
        <span class="muted">{t('menu_confirm_address')}</span> <strong>{view.match.site}</strong>
      </p>
      {warn ? (
        <p class="notice" role="alert">
          {t('menu_confirm_lookalike', view.match.lookAlikeOf ?? '')}
        </p>
      ) : null}
      {!warn ? (
        <label class="check">
          <input
            type="checkbox"
            ref={alwaysBox}
            checked={always}
            onChange={(event) => setAlways((event.target as HTMLInputElement).checked)}
          />
          <span>
            {t('menu_always')}
            <span class="detail">{t('menu_always_hint')}</span>
          </span>
        </label>
      ) : null}
      {notice !== null ? (
        <p class="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div class="buttons">
        <button type="button" class="secondary" onClick={onBack}>
          {t('menu_back')}
        </button>
        <button
          type="button"
          class="primary"
          onClick={(event) =>
            void guarded(pressOf(event), async () => {
              await fillWith({
                tabId: init.tabId,
                frameId: init.frameId,
                fieldId: init.fieldId,
                ...(chosen.login !== undefined ? { loginId: chosen.login.id } : {}),
                ...(chosen.code !== undefined ? { codeId: chosen.code.id } : {}),
                ...((alwaysBox.current?.checked ?? always) && !warn ? { remember: true } : {}),
                picked: true,
              })
              channel.close(true)
            })
          }
        >
          {t('menu_fill')}
        </button>
      </div>
    </>
  )
}

/* The look-alike guard */

function Marked({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.marked ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  )
}

function Guard({
  channel,
  view,
  onPick,
}: {
  channel: Channel
  view: MenuView
  onPick: () => void
}) {
  const known = view.match.lookAlikeOf ?? ''
  const diff = markDifference(view.match.site, known)
  const dont = useRef<HTMLButtonElement>(null)
  useEffect(() => dont.current?.focus(), [])
  return (
    <>
      <p class="lead warn" role="heading" aria-level={2}>
        {t('menu_guard_title', known)}
      </p>
      <p class="muted">{t('menu_guard_text')}</p>
      <dl class="addresses">
        <dt>{t('menu_guard_page')}</dt>
        <dd class="mono">
          <Marked parts={diff.a} />
        </dd>
        <dt>{t('menu_guard_known')}</dt>
        <dd class="mono">
          <Marked parts={diff.b} />
        </dd>
      </dl>
      <div class="buttons">
        <button type="button" class="secondary" onClick={onPick}>
          {t('menu_pick_anyway')}
        </button>
        <button type="button" class="primary" ref={dont} onClick={() => channel.close(true)}>
          {t('menu_dont_fill')}
        </button>
      </div>
      <p class="hint">{t('menu_guard_hint')}</p>
    </>
  )
}

/* Unlock, inline */

function Unlock({ wrong, onUnlocked }: { wrong: number; onUnlocked: () => void }) {
  const [password, setPassword] = useState('')
  const [tries, setTries] = useState(wrong)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <form
      class="unlock"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || password === '') return
        setBusy(true)
        ask('unlock', { password }).then(
          (result) => {
            setBusy(false)
            if (result.ok) {
              setPassword('')
              onUnlocked()
            } else {
              setTries(result.wrongPasswords)
              setFailed(true)
              setPassword('')
            }
          },
          () => {
            setBusy(false)
            setFailed(true)
          },
        )
      }}
    >
      <p class="lead">{t('menu_locked_title')}</p>
      <div class="field">
        <input
          ref={input}
          type="password"
          class="search"
          aria-label={t('menu_password')}
          placeholder={t('menu_password')}
          value={password}
          autoComplete="off"
          onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
        />
      </div>
      {failed ? (
        <p class="notice" role="alert">
          {tries > 1 ? t('menu_wrong_count', tries) : t('menu_wrong')}
        </p>
      ) : null}
      <div class="buttons">
        <button type="submit" class="primary" disabled={busy || password === ''}>
          {t('menu_unlock')}
        </button>
      </div>
    </form>
  )
}

/* New-password suggestions (decision 11) */

function Suggestions({ channel, init, view }: AppProps & { view: MenuView }) {
  const { notice, guarded } = useGuarded(channel)
  const first = view.suggestions
  const [values, setValues] = useState<{ strong: string; phrase: string } | null>(
    first !== undefined && first.length > 0
      ? { strong: first[0], phrase: first[1] ?? first[0] }
      : null,
  )
  const [round, setRound] = useState(0)
  useFirstFocus(values !== null)

  // The first pair comes with the view; "Suggest others" asks the generator again, with the site's rules
  useEffect(() => {
    if (values !== null && round === 0) return
    const rules = init.siteRules
    const extra = rules !== undefined ? { siteRules: rules } : {}
    Promise.all([
      ask('generate', { options: { mode: 'random', length: 20, ...extra } }),
      ask('generate', { options: { mode: 'passphrase', words: 5, ...extra } }),
    ]).then(
      ([strong, phrase]) => setValues({ strong, phrase }),
      () => setValues((now) => now ?? { strong: '', phrase: '' }),
    )
  }, [round])

  const use = (press: Press, value: string) =>
    guarded(press, async () => {
      if (value === '') throw new Error('nothing to use')
      await fillWith({
        tabId: init.tabId,
        frameId: init.frameId,
        fieldId: init.fieldId,
        newPassword: value,
      })
      channel.close(true)
    })

  return (
    <>
      <p class="lead">{t('menu_suggest_heading')}</p>
      {values === null ? (
        <p class="muted">{t('menu_loading')}</p>
      ) : (
        <Rows>
          <Row
            title={t('menu_suggest_strong')}
            detail={values.strong}
            mono
            onClick={(event) => void use(pressOf(event), values.strong)}
          />
          <Row
            title={t('menu_suggest_phrase')}
            detail={values.phrase}
            mono
            onClick={(event) => void use(pressOf(event), values.phrase)}
          />
        </Rows>
      )}
      {notice !== null ? (
        <p class="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div class="footer">
        <button type="button" class="link" onClick={() => setRound(round + 1)}>
          {t('menu_suggest_again')}
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------------------------------ */
/* The save and update prompt (decision 10)                                                          */
/* ------------------------------------------------------------------------------------------------ */

function SavePrompt({ channel, init }: AppProps) {
  const [pending, setPending] = useState<PendingSave | null | undefined>(undefined)
  const { notice, guarded } = useGuarded(channel)

  useEffect(() => {
    ask('pendingSave', { tabId: init.tabId }).then(
      (found) => {
        if (found === null) channel.close(false)
        else setPending(found)
      },
      () => channel.close(false),
    )
  }, [channel, init.tabId])
  useFirstFocus(pending !== undefined && pending !== null)

  if (pending === undefined || pending === null) return <p class="muted">{t('menu_loading')}</p>
  const update = pending.updateOf !== undefined
  const answer = async (save: boolean, never = false) => {
    await ask('answerSave', { tabId: init.tabId, save, ...(never ? { never: true } : {}) })
    channel.close(false)
  }
  return (
    <>
      <p class="lead">{update ? t('menu_update_title') : t('menu_save_title')}</p>
      <dl class="facts">
        <dt>{t('menu_save_site')}</dt>
        <dd class="mono">{pending.site}</dd>
        <dt>{t('menu_save_user')}</dt>
        <dd>{pending.username}</dd>
        <dt>{t('menu_save_vault')}</dt>
        <dd>{t('menu_save_vault_name')}</dd>
      </dl>
      {update ? <p class="muted">{t('menu_update_text')}</p> : null}
      {notice !== null ? (
        <p class="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div class="buttons">
        <button
          type="button"
          class="secondary"
          onClick={(event) =>
            void guarded(pressOf(event), () => answer(false).catch(() => channel.close(false)))
          }
        >
          {t('menu_not_now')}
        </button>
        <button
          type="button"
          class="primary"
          data-row
          onClick={(event) => void guarded(pressOf(event), () => answer(true))}
        >
          {update ? t('menu_update') : t('menu_save')}
        </button>
      </div>
      <div class="footer">
        <button
          type="button"
          class="link"
          onClick={(event) =>
            void guarded(pressOf(event), () =>
              answer(false, true).catch(() => channel.close(false)),
            )
          }
        >
          {t('menu_never')}
        </button>
      </div>
    </>
  )
}
