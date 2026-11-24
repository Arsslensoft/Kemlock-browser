// The small pieces every step is made of: the page with its header and rail, the card's heading (focused when a step
// opens), labelled fields, the notices (live regions where they report) and a busy hook.
import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useContext, useEffect, useId, useRef, useState } from 'preact/hooks'
import { Wordmark } from '../shared/brand/brand'
import { progressOf, type FlowEvent, type FlowState, type ProblemInfo } from './flow'
import { problemText, t } from './i18n'
import { Glyph, type GlyphName } from './icons'
import { Rail } from './rail'

export type Dispatch = (event: FlowEvent) => void

/** The flow's state, for the page around the card (the rail and the step count). */
export const FlowContext = createContext<FlowState | null>(null)

/** The browser's own name, as the header shows it. */
export function browserName(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Firefox\//.test(agent)) return 'Firefox'
  if (/Edg\//.test(agent)) return 'Edge'
  return 'Chrome'
}

interface FrameProps {
  title: string
  lead?: string
  error?: ProblemInfo | null
  /** What to show as the error when the message of `error` isn't enough (a hint below it). */
  hint?: string | null
  /** Something above the heading (the done screen's check). */
  badge?: ComponentChildren
  children?: ComponentChildren
}

/** One step: the page's header and rail, then the card: a heading that takes focus, the lead, the error, then the form. */
export function Frame({ title, lead, error, hint, badge, children }: FrameProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  const state = useContext(FlowContext)
  const progress = state === null ? null : progressOf(state)
  useEffect(() => {
    heading.current?.focus()
  }, [title])
  return (
    <div class="page">
      <header class="top">
        <div class="top-in">
          <Wordmark height={18} />
          <span class="browser">{browserName()}</span>
          <span class="grow" />
          {progress ? (
            <span class="progress mono">{t('setup_step_of', progress.step, progress.total)}</span>
          ) : null}
        </div>
      </header>
      <main class="layout">
        <aside class="side">
          {state === null ? null : <Rail state={state} />}
          <div class="side-note">
            <span class="side-title">{t('setup_title')}</span>
            <p>{t('setup_rail_note')}</p>
          </div>
        </aside>
        <section aria-labelledby={id} class="card">
          <div class={badge ? 'step with-badge' : 'step'}>
            {badge}
            <div class="head">
              <h1 id={id} ref={heading} tabIndex={-1}>
                {title}
              </h1>
              {lead ? <p class="lead">{lead}</p> : null}
            </div>
            <Problem error={error ?? null} hint={hint ?? null} />
            {children}
          </div>
        </section>
      </main>
    </div>
  )
}

type Tone = 'danger' | 'warn' | 'info'

const toneIcons: Record<Tone, GlyphName> = { danger: 'info', warn: 'warn', info: 'info' }

/** A notice: an icon and its words, tinted by tone. Reports through `role` (alert or status) when it has one. */
export function Notice({
  tone,
  role,
  class: className,
  children,
}: {
  tone: Tone
  role?: 'alert' | 'status'
  class?: string
  children?: ComponentChildren
}) {
  return (
    <div class={`notice t-${tone}${className ? ` ${className}` : ''}`} role={role}>
      <span class="notice-icon">
        <Glyph name={toneIcons[tone]} />
      </span>
      <span class="notice-body">{children}</span>
    </div>
  )
}

/** A sync problem in the app's words, announced when it appears. */
export function Problem({ error, hint }: { error: ProblemInfo | null; hint?: string | null }) {
  if (error === null) return null
  return (
    <Notice tone="danger" role="alert" class="problem">
      <span>{problemText(error.problem, error.message)}</span>
      {hint ? <span class="hint">{hint}</span> : null}
    </Notice>
  )
}

/** An error (or, as a warning, a caution) in this step's own words (not a sync problem). */
export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warn'
  children?: ComponentChildren
}) {
  return (
    <Notice tone={tone} role="alert">
      {children}
    </Notice>
  )
}

/** A plain note: something to know, not something wrong. */
export function Note({ children, status }: { children?: ComponentChildren; status?: boolean }) {
  return (
    <Notice tone="info" role={status ? 'status' : undefined} class="note">
      {children}
    </Notice>
  )
}

interface FieldProps {
  label: string
  value: string
  onInput: (value: string) => void
  type?: 'text' | 'password' | 'email' | 'url'
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'email' | 'url'
  hint?: string
  error?: string | null
  disabled?: boolean
  required?: boolean
  placeholder?: string
  spellcheck?: boolean
  /** Set in Geist Mono (addresses, codes). */
  mono?: boolean
  /** The size of the code styling: the large, spaced digits of a one-time code. */
  code?: boolean
  /** What sits at the end of the box (the show/hide button). */
  trailing?: ComponentChildren
}

/** A labelled input; its hint and error are tied to it for screen readers. */
export function Field(props: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [props.hint ? hintId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined
  const classes = [props.mono || props.code ? 'mono' : '', props.code ? 'code' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div class="group">
      <label htmlFor={id}>{props.label}</label>
      <div class={props.error ? 'box bad' : 'box'}>
        <input
          id={id}
          class={classes || undefined}
          // Preact types each input type apart; the value is one of the text-like ones
          type={(props.type ?? 'text') as 'text'}
          value={props.value}
          autoComplete={props.autoComplete ?? 'off'}
          inputMode={props.inputMode}
          disabled={props.disabled}
          required={props.required}
          placeholder={props.placeholder}
          spellcheck={props.spellcheck ?? false}
          aria-describedby={describedBy}
          aria-invalid={props.error ? 'true' : undefined}
          onInput={(event) => props.onInput((event.currentTarget as HTMLInputElement).value)}
        />
        {props.trailing}
      </div>
      {props.hint ? (
        <p id={hintId} class="hint">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} class="field-error" role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  )
}

/** A password field with its own show/hide button, at the end of the box. */
export function PasswordField(props: Omit<FieldProps, 'type' | 'trailing'>) {
  const [shown, setShown] = useState(false)
  return (
    <Field
      {...props}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          class="reveal"
          aria-pressed={shown}
          disabled={props.disabled}
          onClick={() => setShown((was) => !was)}
        >
          {shown ? t('setup_hide') : t('setup_show')}
        </button>
      }
    />
  )
}

export function Checkbox(props: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange((event.currentTarget as HTMLInputElement).checked)}
      />
      <span class="check-text">
        <span class="check-label">{props.label}</span>
        {props.hint ? <span class="hint">{props.hint}</span> : null}
      </span>
    </label>
  )
}

/**
 * Runs a step's work with a busy flag; anything thrown (the background refused or failed) shows
 * as a failure in this step's words.
 */
export function useBusy(
  dispatch: Dispatch,
): [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch {
      dispatch({ type: 'failed', problem: 'setup', message: t('setup_error_failed') })
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return [busy, run]
}

/** The buttons of a step: the main one first in the markup, so Tab and Enter reach it first. */
export function Actions({ children }: { children?: ComponentChildren }) {
  return <div class="actions">{children}</div>
}

/** A status line read out as it changes, with the sync icon turning beside it. */
export function Status({ children }: { children?: ComponentChildren }) {
  return (
    <p class="status" role="status" aria-live="polite">
      <span class="spin">
        <Glyph name="refresh" />
      </span>
      {children}
    </p>
  )
}

/** A leading tile with an icon: the accent one marks the first or main item of a list. */
export function Tile({
  name,
  size = 40,
  accent,
  tone,
}: {
  name: GlyphName
  size?: 24 | 36 | 40
  accent?: boolean
  tone?: 'danger'
}) {
  return (
    <span class={`tile s${size}${accent ? ' accent' : ''}${tone ? ` t-${tone}` : ''}`}>
      <Glyph
        name={name}
        size={size === 24 ? 14 : size === 36 ? 18 : 20}
        weight={size === 24 ? 2.2 : 1.8}
      />
    </span>
  )
}
