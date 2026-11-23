// The small pieces every step is made of: the frame with its heading (focused when a step
// opens), labelled fields, the error note (a live region) and a busy hook.
import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { FlowEvent, ProblemInfo } from './flow'
import { problemText, t } from './i18n'

export type Dispatch = (event: FlowEvent) => void

interface FrameProps {
  title: string
  lead?: string
  progress?: { step: number; total: number } | null
  error?: ProblemInfo | null
  /** What to show as the error when the message of `error` isn't enough (a hint below it). */
  hint?: string | null
  children?: ComponentChildren
}

/** One step: a heading that takes focus when the step opens, the lead, the error, then the form. */
export function Frame({ title, lead, progress, error, hint, children }: FrameProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  useEffect(() => {
    heading.current?.focus()
  }, [title])
  return (
    <main class="frame">
      <header class="brand">
        <span class="mark" aria-hidden="true" />
        <span class="name">Kemlock</span>
        {progress ? (
          <span class="progress">{t('setup_step_of', progress.step, progress.total)}</span>
        ) : null}
      </header>
      <section aria-labelledby={id} class="card">
        <h1 id={id} ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {lead ? <p class="lead">{lead}</p> : null}
        <Problem error={error ?? null} hint={hint ?? null} />
        {children}
      </section>
    </main>
  )
}

/** A sync problem in the app's words, announced when it appears. */
export function Problem({ error, hint }: { error: ProblemInfo | null; hint?: string | null }) {
  if (error === null) return null
  return (
    <div class="problem" role="alert">
      <p>{problemText(error.problem, error.message)}</p>
      {hint ? <p class="hint">{hint}</p> : null}
    </div>
  )
}

/** An error in this step's own words (not a sync problem). */
export function Alert({ children }: { children?: ComponentChildren }) {
  return (
    <div class="problem" role="alert">
      {children}
    </div>
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
}

/** A labelled input; its hint and error are tied to it for screen readers. */
export function Field(props: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [props.hint ? hintId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined
  return (
    <div class="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
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

/** A password field with its own show/hide button. */
export function PasswordField(props: Omit<FieldProps, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div class="password">
      <Field {...props} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        class="link show"
        aria-pressed={shown}
        onClick={() => setShown((was) => !was)}
      >
        {shown ? t('setup_hide') : t('setup_show')}
      </button>
    </div>
  )
}

export function Checkbox(props: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  const id = useId()
  return (
    <div class="check">
      <input
        id={id}
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange((event.currentTarget as HTMLInputElement).checked)}
      />
      <label htmlFor={id}>{props.label}</label>
      {props.hint ? <p class="hint">{props.hint}</p> : null}
    </div>
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

/** A status line read out as it changes. */
export function Status({ children }: { children?: ComponentChildren }) {
  return (
    <p class="status" role="status" aria-live="polite">
      {children}
    </p>
  )
}
