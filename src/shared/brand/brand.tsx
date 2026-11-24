// Kemlock's own marks, copied byte for byte from the app's mobile/assets/brand (tool/copies.test.mjs holds them to
// it): the icon at three sizes and the wordmark for each theme. The mockups' canvas puts the icon alone, and the
// wordmark alone where the name shows (the wordmark carries the keyhole K itself).
import favicon from './kemlock-favicon.svg'
import icon from './kemlock-icon.svg'
import iconSmall from './kemlock-icon-small.svg'
import wordmarkDark from './kemlock-wordmark-dark.svg'
import wordmarkLight from './kemlock-wordmark-light.svg'

/** The icon file for a size in CSS px: the favicon up to 32, the small icon up to 48, the full icon above. */
export function iconFor(size: number): string {
  if (size <= 32) return favicon
  if (size <= 48) return iconSmall
  return icon
}

/** The Kemlock icon, the gunmetal tile with the azure keyhole K. Decorative unless given a label. */
export function KemlockIcon({
  size,
  label,
  class: className,
}: {
  size: number
  label?: string
  class?: string
}) {
  return (
    <img
      class={className}
      src={iconFor(size)}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label === undefined ? 'true' : undefined}
      draggable={false}
      style={{ display: 'block', flex: 'none', borderRadius: `${(size * 22.5) / 100}px` }}
    />
  )
}

/** The wordmark, light or dark by the system's theme; named "Kemlock" for assistive technology. */
export function Wordmark({ height, class: className }: { height: number; class?: string }) {
  return (
    <picture class={className} style={{ display: 'block', flex: 'none' }}>
      <source srcset={wordmarkDark} media="(prefers-color-scheme: dark)" />
      <img
        src={wordmarkLight}
        height={height}
        alt="Kemlock"
        draggable={false}
        style={{ display: 'block', height: `${height}px`, width: 'auto' }}
      />
    </picture>
  )
}
