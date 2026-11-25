// What the page script (the page's own world) and the bridge script (the extension's isolated world) say to each other
// (docs/plans/add-passkeys.md). Both run in the same window, so the page can see anything they post there: nothing here is a secret,
// and nothing rests on the page not seeing it. The bridge answers only messages from its own window (`event.source`), which a
// parent frame or another window can't send, and the background decides everything of consequence from what the browser reports.
//
// The page script starts a request by posting `{ kemlockPasskey: 1, op: 'begin', … }` to its own window with one end of a fresh
// `MessageChannel`; the answers come back on that port, so they don't pass the window's other listeners:
//
//   bridge → page script:  `{ op: 'ack' }` when the request is taken, `{ op: 'done', result }` when it ends,
//                          `{ op: 'status', active }` for a `status` request.
//   page script → bridge:  `{ op: 'cancel' }` when the page aborted or the script gave up.
import type { PasskeyCreationOptions, PasskeyRequestOptions } from '../shared/passkeys'

/** The marker every message to the bridge carries. */
export const passkeyMarker = 'kemlockPasskey'

export interface BeginMessage {
  kemlockPasskey: 1
  op: 'begin'
  /** The page script's id for the request. */
  id: string
  type: 'create' | 'get'
  conditional: boolean
  options: PasskeyCreationOptions | PasskeyRequestOptions
}

export interface StatusMessage {
  kemlockPasskey: 1
  op: 'status'
}

export type ToBridge = BeginMessage | StatusMessage

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A request id: what the page script made, in the characters it uses. */
export const requestId = /^[0-9a-f]{32}$/
