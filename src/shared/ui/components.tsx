// Small Preact components the extension's pages share. They render text and attributes only,
// never markup, and carry their accessible names themselves.
import { createContext } from 'preact'
import type { ComponentChildren } from 'preact'
import { useCallback, useContext, useEffect, useId, useRef, useState } from 'preact/hooks'
import { KemlockIcon } from '../brand/brand'
import { errorMessage } from './i18n'
import { Icon, type IconName } from './icons'

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warn'

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
  /** A taller button (46px), for the main action of a form. */
  tall?: boolean
  expanded?: boolean
  onClick?: () => void
  children?: ComponentChildren
}

export function Button(props: ButtonProps) {
  const { kind = 'secondary', icon, busy, disabled, type = 'button', title, label } = props
  return (
    <button
      type={type}
      class={`btn ${kind}${props.tall ? ' tall' : ''}${props.class ? ` ${props.class}` : ''}`}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
      aria-label={label}
      aria-expanded={props.expanded === undefined ? undefined : props.expanded ? 'true' : 'false'}
      title={title}
      onClick={props.onClick}
    >
      {icon && <Icon name={icon} size={16} weight={2} />}
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
  size?: number
  weight?: number
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
      <Icon name={props.icon} size={props.size ?? 18} weight={props.weight} />
    </button>
  )
}

/** A text button in a row of a card ("Copy", "Show", "Forget"), 44px to touch. */
export function LinkButton(props: {
  label?: string
  quiet?: boolean
  disabled?: boolean
  onClick?: () => void
  children?: ComponentChildren
}) {
  return (
    <button
      type="button"
      class={`link-btn${props.quiet ? ' quiet' : ''}`}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
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
          <span class="detail" id={detailId}>
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

/**
 * What a box that holds a secret or a plaintext must not get from the browser: no spell checker, which may send the text
 * to a cloud service, no automatic capitals and no correction.
 */
const noAssist: Record<string, string> = { autocapitalize: 'off', autocorrect: 'off' }

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
  mono?: boolean
  /** Buttons inside the box, at its right end (Show, Generate). */
  trailing?: ComponentChildren
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
      <div class={`box${props.invalid ? ' bad' : ''}${props.multiline ? ' top' : ''}`}>
        {props.multiline ? (
          <textarea
            {...common}
            {...noAssist}
            spellcheck={false}
            rows={3}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
        ) : (
          <input
            {...common}
            class={props.mono ? 'mono' : undefined}
            // A website is often a bare host ("example.com") or a rule's pattern, which the browser's own check of type="url" calls
            // invalid and then silently keeps the form from being sent: the keyboard hint is kept, the check is left to the form.
            type={(props.type === 'url' ? 'text' : (props.type ?? 'text')) as 'text'}
            {...(props.type === 'url' ? { inputMode: 'url' as const } : {})}
            spellcheck={false}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
        )}
        {props.trailing}
      </div>
      {props.hint && (
        <span class="hint" id={hintId}>
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
  /** Label above a full-width select (a form), instead of beside a narrow one (a row of settings). */
  stacked?: boolean
}) {
  const id = useId()
  return (
    <div class={props.stacked ? 'field' : 'field row-field'}>
      <label for={id}>{props.label}</label>
      <div class="box">
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
    </div>
  )
}

export function Notice(props: {
  kind?: 'info' | 'warn' | 'error' | 'ok'
  children?: ComponentChildren
  class?: string
}) {
  const kind = props.kind ?? 'info'
  const icon: IconName =
    kind === 'warn' ? 'warning' : kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'alert'
  return (
    <div
      class={`notice ${kind}${props.class ? ` ${props.class}` : ''}`}
      role={kind === 'error' || kind === 'warn' ? 'alert' : 'status'}
    >
      <Icon name={icon} size={16} weight={2} />
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

/** A name's tile: its first letter, tinted by a hue the name gives (the mockups' own hash). */
export function hueOf(name: string): number {
  const text = name.trim().toLowerCase()
  let hue = 7
  for (let i = 0; i < text.length; i += 1) hue = (hue * 31 + text.charCodeAt(i)) % 4294967296
  return hue % 360
}

export function Tile(props: { name: string; size?: number; class?: string }) {
  const size = props.size ?? 36
  return (
    <span
      class={`tile${props.class ? ` ${props.class}` : ''}`}
      aria-hidden="true"
      style={{
        '--h': String(hueOf(props.name)),
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${Math.round(size / 3)}px`,
        fontSize: `${Math.round(size * 0.42)}px`,
      }}
    >
      {props.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** The countdown ring of a code: the part of its period left, and the seconds in words. */
export function Ring(props: {
  remaining: number
  period: number
  warn?: boolean
  label: string
  size?: number
}) {
  const size = props.size ?? 28
  const stroke = size < 20 ? 2 : 2.5
  const radius = size / 2 - stroke / 2 - 0.25
  const circumference = 2 * Math.PI * radius
  const fraction = Math.max(0, Math.min(1, props.period > 0 ? props.remaining / props.period : 0))
  const middle = size / 2
  return (
    <span
      class={`ring${props.warn ? ' warn' : ''}`}
      role="img"
      aria-label={props.label}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          class="track"
          cx={middle}
          cy={middle}
          r={radius}
          fill="none"
          stroke-width={stroke}
        />
        <circle
          class="arc"
          cx={middle}
          cy={middle}
          r={radius}
          fill="none"
          stroke-width={stroke}
          stroke-linecap="round"
          stroke-dasharray={`${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
        />
      </svg>
      {/* Drawn from an attribute, so the seconds are not text that runs into the digits of a code. */}
      {size >= 20 && (
        <span
          class="ring-number"
          aria-hidden="true"
          data-seconds={Math.max(0, props.remaining)}
          style={{ fontSize: size < 27 ? '9.5px' : '10px' }}
        />
      )}
    </span>
  )
}

/** The top bar of a page: Back, Kemlock's mark, the title, and the page's own buttons. */
export function PageHeader(props: {
  title: string
  onBack?: () => void
  backLabel: string
  children?: ComponentChildren
}) {
  return (
    <header class="bar">
      {props.onBack && <IconButton icon="back" label={props.backLabel} onClick={props.onBack} />}
      <KemlockIcon size={24} class="mark" />
      <h1>{props.title}</h1>
      {props.children}
    </header>
  )
}

/** A titled part of a page: its caps title, then what it holds (usually a Group). */
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

/** A card whose children are rows set apart by hairlines; `pad` makes it one padded block. */
export function Group(props: {
  children?: ComponentChildren
  pad?: boolean
  accent?: boolean
  class?: string
}) {
  return (
    <div
      class={`group${props.pad ? ' pad' : ''}${props.accent ? ' accent' : ''}${props.class ? ` ${props.class}` : ''}`}
    >
      {props.children}
    </div>
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
      class={props.danger ? 'confirm danger' : 'confirm'}
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
      <p class="title" id={titleId}>
        {props.title}
      </p>
      {props.body && (
        <p class="body-text" id={bodyId}>
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
  class?: string
}) {
  const move = (from: number, step: number) => {
    const next = props.tabs[(from + step + props.tabs.length) % props.tabs.length]
    if (next) props.onSelect(next.id)
  }
  return (
    <div
      class={`tabs${props.class ? ` ${props.class}` : ''}`}
      role="tablist"
      aria-label={props.label}
    >
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

/** Says a title, and under it a smaller line when there is one. */
type Say = (title: string, sub?: string) => void
const ToastContext = createContext<Say>(() => undefined)

export function ToastProvider(props: { children?: ComponentChildren }) {
  const [toast, setToast] = useState<{ title: string; sub?: string } | undefined>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const say = useCallback<Say>((title, sub) => {
    setToast({ title, sub })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(undefined), 3500)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <ToastContext.Provider value={say}>
      {props.children}
      <div class={toast ? 'toast on' : 'toast'} role="status" aria-live="polite">
        <span class="tick" aria-hidden="true">
          <Icon name="check" size={14} weight={2.6} />
        </span>
        <span class="words">
          <span class="title">{toast?.title ?? ''}</span>
          {toast?.sub ? <span class="sub">{toast.sub}</span> : null}
        </span>
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = (): Say => useContext(ToastContext)

/** Lifts the toast above a bar at the foot of the page (px from the bottom) while the page shows. */
export function useToastBottom(pixels: number): void {
  useEffect(() => {
    document.documentElement.style.setProperty('--toast-bottom', `${pixels}px`)
    return () => document.documentElement.style.removeProperty('--toast-bottom')
  }, [pixels])
}

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
