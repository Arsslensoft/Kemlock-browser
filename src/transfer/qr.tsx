// A QR code drawn as one SVG path: black on white whatever the theme (a reader needs the contrast), with its quiet zone.
import type { QrModules } from '../shared/transfer'
import { modulesPath } from './files'

const quiet = 4

export function QrImage(props: { code: QrModules; label: string; px?: number }) {
  const span = props.code.size + 2 * quiet
  const px = props.px ?? 320
  return (
    <svg
      class="qr"
      role="img"
      aria-label={props.label}
      width={px}
      height={px}
      viewBox={`0 0 ${span} ${span}`}
      shape-rendering="crispEdges"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={modulesPath(props.code.size, props.code.modules, quiet)} fill="#000000" />
    </svg>
  )
}
