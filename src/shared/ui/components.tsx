// Small Preact components the extension's pages share. They render text and attributes only,
// never markup, and carry their accessible names themselves.
import { createContext } from 'preact'
import type { ComponentChildren } from 'preact'
import { useCallback, useContext, useEffect, useId, useRef, useState } from 'preact/hooks'
import { errorMessage } from './i18n'
import { Icon, type IconName } from './icons'

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost'

export interface ButtonProps {
  kind?: ButtonKind
  icon?: IconName
  busy?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
  /** An accessible name that differs from the visible text. */
  label?: string
  class?: string
  onClick?: () => void
  children?: ComponentChildren
}

export function Button(props: ButtonProps) {
  const { kind = 'secondary', icon, busy, disabled, type = 'button', title, label } = props
  return (
    <button
      type={type}
      class={`btn ${kind}${props.class ? ` ${props.class}` : ''}`}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
      aria-label={label}
      title={title}
      onClick={props.onClick}
    >
      {icon && <Icon name={icon} size={16} />}
      {props.children !== undefined && <span>{props.children}</span>}
    </button>
  )
}

export function IconButton(props: {
  icon: IconName
  label: string
  onClick?: () => void
  disabled?: boolean
  pressed?: boolean
  class?: string
}) {
  return (
    <button
      type="button"
      class={`icon-btn${props.class ? ` ${props.class}` : ''}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed ? 'true' : 'false'}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  )
}

export function Switch(props: {
  checked: boolean
  label: string
  detail?: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const detailId = useId()
  const labelId = useId()
  return (
    <label class="row switch">
      <span class="grow">
        <span class="strong" id={labelId}>
          {props.label}
        </span>
        {props.detail && (
          <span class="muted small" id={detailId}>
            {props.detail}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        aria-labelledby={labelId}
        aria-describedby={props.detail ? detailId : undefined}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </label>
  )
}

export function TextField(props: {
  label: string
  value: string
  onInput: (value: string) => void
  type?: 'text' | 'password' | 'search' | 'url'
  autocomplete?: string
  hint?: string
  multiline?: boolean
  autofocus?: boolean
  readOnly?: boolean
  invalid?: boolean
  placeholder?: string
  class?: string
}) {
  const id = useId()
  const hintId = useId()
  const common = {
    id,
    value: props.value,
    autocomplete: props.autocomplete ?? 'off',
    autofocus: props.autofocus,
    readOnly: props.readOnly,
    placeholder: props.placeholder,
    'aria-invalid': props.invalid ? ('true' as const) : undefined,
    'aria-describedby': props.hint ? hintId : undefined,
  }
  return (
    <div class={`field${props.class ? ` ${props.class}` : ''}`}>
      <label for={id}>{props.label}</label>
      {props.multiline ? (
        <textarea
          {...common}
          rows={3}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      ) : (
        <input
          {...common}
          type={(props.type ?? 'text') as 'text'}
          spellcheck={false}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      )}
      {props.hint && (
        <span class="muted small" id={hintId}>
          {props.hint}
        </span>
      )}
    </div>
  )
}

export interface Option<V extends string | number> {
  value: V
  label: string
}

export function SelectField<V extends string | number>(props: {
  label: string
  value: V
  options: Option<V>[]
  onChange: (value: V) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div class="field row-field">
      <label for={id}>{props.label}</label>
      <select
        id={id}
        value={String(props.value)}
        disabled={props.disabled}
        onChange={(event) => {
          const picked = props.options.find(
            (option) => String(option.value) === event.currentTarget.value,
          )
          if (picked) props.onChange(picked.value)
        }}
      >
        {props.options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Notice(props: {
  kind?: 'info' | 'warn' | 'error' | 'ok'
  children?: ComponentChildren
  class?: string
}) {
  const kind = props.kind ?? 'info'
  return (
    <div
      class={`notice ${kind}${props.class ? ` ${props.class}` : ''}`}
      role={kind === 'error' || kind === 'warn' ? 'alert' : 'status'}
    >
      {(kind === 'warn' || kind === 'error') && <Icon name="warning" size={16} />}
      <div class="grow">{props.children}</div>
    </div>
  )
}

export function Badge(props: {
  kind?: 'warn' | 'danger' | 'neutral' | 'accent'
  children?: ComponentChildren
}) {
  return <span class={`badge ${props.kind ?? 'neutral'}`}>{props.children}</span>
}

/** The countdown ring of a code: the part of its period left, and the seconds in words. */
export function Ring(props: { remaining: number; period: number; warn?: boolean; label: string }) {
  const radius = 11
  const circumference = 2 * Math.PI * radius
  const fraction = Math.max(0, Math.min(1, props.period > 0 ? props.remaining / props.period : 0))
  return (
    <span class={`ring${props.warn ? ' warn' : ''}`} role="img" aria-label={props.label}>
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <circle class="track" cx="15" cy="15" r={radius} fill="none" stroke-width="3" />
        <circle
          class="arc"
          cx="15"
          cy="15"
          r={radius}
          fill="none"
          stroke-width="3"
          stroke-linecap="round"
          stroke-dasharray={`${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
          transform="rotate(-90 15 15)"
        />
      </svg>
      {/* Drawn from an attribute, so the seconds are not text that runs into the digits of a code. */}
      <span class="ring-number" aria-hidden="true" data-seconds={Math.max(0, props.remaining)} />
    </span>
  )
}

export function PageHeader(props: {
  title: string
  onBack?: () => void
  backLabel: string
  children?: ComponentChildren
}) {
  return (
    <header class="bar">
      {props.onBack && <IconButton icon="back" label={props.backLabel} onClick={props.onBack} />}
      <h1 class="grow">{props.title}</h1>
      {props.children}
    </header>
  )
}

export function Section(props: { title?: string; children?: ComponentChildren; class?: string }) {
  const id = useId()
  return (
    <section
      class={`section${props.class ? ` ${props.class}` : ''}`}
      aria-labelledby={props.title ? id : undefined}
    >
      {props.title && (
        <h2 id={id} class="section-title">
          {props.title}
        </h2>
      )}
      {props.children}
    </section>
  )
}

/** A question asked in place, with the safe answer focused. */
export function Confirm(props: {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
  }, [])
  return (
    <div
      class="confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={props.body ? bodyId : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          props.onCancel()
        }
      }}
    >
      <p class="strong" id={titleId}>
        {props.title}
      </p>
      {props.body && (
        <p class="muted" id={bodyId}>
          {props.body}
        </p>
      )}
      <div class="actions">
        <button type="button" class="btn secondary" ref={cancel} onClick={props.onCancel}>
          <span>{props.cancelLabel}</span>
        </button>
        <Button
          kind={props.danger ? 'danger' : 'primary'}
          busy={props.busy}
          onClick={props.onConfirm}
        >
          {props.confirmLabel}
        </Button>
      </div>
    </div>
  )
}

export interface TabItem {
  id: string
  label: string
  /** Shown beside the label but not part of the tab's name ("Codes", not "Codes 3"). */
  count?: number
}

export function Tabs(props: {
  tabs: TabItem[]
  selected: string
  label: string
  onSelect: (id: string) => void
}) {
  const move = (from: number, step: number) => {
    const next = props.tabs[(from + step + props.tabs.length) % props.tabs.length]
    if (next) props.onSelect(next.id)
  }
  return (
    <div class="tabs" role="tablist" aria-label={props.label}>
      {props.tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === props.selected ? 'true' : 'false'}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === props.selected ? 0 : -1}
          class={tab.id === props.selected ? 'tab on' : 'tab'}
          onClick={() => props.onSelect(tab.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(index, 1)
            else if (event.key === 'ArrowLeft') move(index, -1)
            else return
            event.preventDefault()
          }}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span class="tab-count" aria-hidden="true">{` ${tab.count}`}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/* A short line at the foot of the page, read out by screen readers. */

type Say = (text: string) => void
const ToastContext = createContext<Say>(() => undefined)

export function ToastProvider(props: { children?: ComponentChildren }) {
  const [text, setText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const say = useCallback<Say>((next) => {
    setText(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setText(''), 3500)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <ToastContext.Provider value={say}>
      {props.children}
      <div class={text ? 'toast on' : 'toast'} role="status" aria-live="polite">
        {text}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = (): Say => useContext(ToastContext)

/* Loading from the background. */

export interface Loaded<T> {
  value: T | undefined
  error: string | undefined
  loading: boolean
  reload: () => Promise<void>
}

/** Runs `load` on mount and when `deps` change, and again on `reload()`; the newest run wins. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[] = []): Loaded<T> {
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({
    loading: true,
  })
  const latest = useRef(0)
  const alive = useRef(true)
  const loader = useRef(load)
  loader.current = load
  const run = useCallback(async () => {
    const mine = ++latest.current
    try {
      const value = await loader.current()
      if (alive.current && mine === latest.current) setState({ value, loading: false })
    } catch (error) {
      if (alive.current && mine === latest.current)
        setState((previous) => ({
          value: previous.value,
          error: errorMessage(error),
          loading: false,
        }))
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void run()
    return () => {
      alive.current = false
    }
    // `deps` is the caller's list of what makes it load again.
  }, [run, ...deps])
  return { value: state.value, error: state.error, loading: state.loading, reload: run }
}
