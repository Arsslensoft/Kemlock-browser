// Safari's native side (docs/plans/add-safari.md). A Safari web extension lives in a Mac app, and the app's extension handler
// (tool/safari/SafariWebExtensionHandler.swift) answers `runtime.sendNativeMessage` with what a web page can't do: write the
// system clipboard without a click, clear it only if nothing changed it since (the pasteboard's change count), and say whether the
// screen is locked (Safari has no `idle` API). Safari ignores the
// application name and sends every message to its own app's handler, so only this extension reaches it.
//
// A request is `{ kemlock: 1, cmd, value?, seconds?, count? }` and the answer `{ kemlock: 1, ok: true, count?, locked? }`. Anything else (the
// handler Xcode generates only echoes the message back) is a failure, and the callers go without the native help.

/** Version of the request and the answer: the Swift handler and this file change together. */
export const nativeProtocol = 1

/** Sends a message to the app's extension handler and gives its answer. */
export type NativeCall = (message: Record<string, unknown>) => Promise<unknown>

export type NativeCommand = 'write' | 'clear' | 'screenLocked'

/** What a good answer holds. */
export interface NativeAnswer {
  /** The pasteboard's change count after a write: what a later clear is of. */
  count?: number
  locked?: boolean
}

/** What a command takes: the text and how long it will stay (a write), the change count it was written at (a clear). */
export interface NativeArgs {
  value?: string
  seconds?: number
  count?: number
}

/** The part of `chrome.runtime` that sends to the app. */
interface NativeRuntime {
  sendNativeMessage?: unknown
}

/** `runtime.sendNativeMessage` to the app extension, or null where the browser has none. */
export function nativeCall(runtime: NativeRuntime): NativeCall | null {
  if (typeof runtime.sendNativeMessage !== 'function') return null
  const send = runtime.sendNativeMessage as (application: string, body: object) => Promise<unknown>
  return (message) => send.call(runtime, 'application.id', message)
}

/** One command, to the handler. Throws when it is not our handler, or it says no. */
export async function askNative(
  call: NativeCall,
  cmd: NativeCommand,
  args: NativeArgs = {},
): Promise<NativeAnswer> {
  const request = { kemlock: nativeProtocol, cmd, ...args }
  const reply = await call(request)
  if (typeof reply !== 'object' || reply === null) throw new Error('native')
  const answer = reply as Record<string, unknown>
  if (answer.kemlock !== nativeProtocol || answer.ok !== true) throw new Error('native')
  return {
    ...(typeof answer.count === 'number' ? { count: answer.count } : {}),
    ...(typeof answer.locked === 'boolean' ? { locked: answer.locked } : {}),
  }
}

/** Whether the screen is locked, as the Mac says; false when it can't be asked. */
export function nativeScreenLocked(call: NativeCall): () => Promise<boolean> {
  return async () => {
    try {
      return (await askNative(call, 'screenLocked')).locked === true
    } catch {
      return false
    }
  }
}
