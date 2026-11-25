// The few icons the vault tools add to the shared set (src/shared/ui/icons.tsx). The shapes are Lucide's
// (https://lucide.dev), (c) Lucide Contributors, under the ISC licence whose text is src/shared/ui/LUCIDE-LICENSE.txt. They are
// decoration: the control that holds one carries its own accessible name.
import type { JSX } from 'preact'

export type ToolIconName =
  'up' | 'down' | 'grip' | 'tag' | 'pin' | 'reorder' | 'layers' | 'shieldAlert'

const shapes: Record<ToolIconName, () => JSX.Element> = {
  up: () => (
    <>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </>
  ),
  down: () => (
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>
  ),
  grip: () => (
    <>
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="19" r="1" />
    </>
  ),
  tag: () => (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  pin: () => (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </>
  ),
  reorder: () => (
    <>
      <path d="m3 16 4 4 4-4" />
      <path d="M7 20V4" />
      <path d="m21 8-4-4-4 4" />
      <path d="M17 4v16" />
    </>
  ),
  layers: () => (
    <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </>
  ),
  shieldAlert: () => (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
}

/** An icon at `size` px, drawn as the shared ones are. */
export function ToolIcon(props: { name: ToolIconName; size?: number; weight?: number }) {
  const size = props.size ?? 18
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.weight ?? 1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[props.name]()}
    </svg>
  )
}

/** A text-free button of a row, with a tool icon. */
export function ToolIconButton(props: {
  icon: ToolIconName
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
      <ToolIcon name={props.icon} />
    </button>
  )
}
