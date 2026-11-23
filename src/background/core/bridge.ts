// The core as `CoreApi`: the Dart module (core/, compiled with dart2wasm) answers one method name and a JSON array of
// arguments with one JSON envelope, and this turns each `CoreApi` method into that call. No failure crosses as anything
// but a `KemlockError` whose message is one short code word, which is how the pages read it.
import type { CoreApi } from '../../shared/api'

/** What the Dart module registers as `globalThis.kemlockCore` (core/lib/src/js/bridge.dart). */
export interface CoreBridge {
  /** Takes the host object (callbacks, the session key, the data files) and answers an envelope. */
  init(host: object): Promise<string>
  /** Calls a `CoreApi` method with its arguments as JSON text, and answers an envelope. */
  call(method: string, argsJson: string): Promise<string>
}

/** An error of the core. `message` is a code word: `locked`, `noVault`, `duplicate`, `notAnOtpauth`, … */
export class KemlockError extends Error {
  constructor(code: string, detail?: string) {
    super(code)
    this.name = 'KemlockError'
    this.detail = detail
  }

  /** The Dart side's own words, for the log. */
  readonly detail: string | undefined
}

type Envelope =
  { ok: true; value: unknown } | { ok: false; error: { code?: unknown; message?: unknown } }

/** The value an envelope holds, or the `KemlockError` it says. */
export function open(text: string): unknown {
  let envelope: Envelope
  try {
    envelope = JSON.parse(text) as Envelope
  } catch {
    throw new KemlockError('failed', 'the core answered something that is not JSON')
  }
  if (envelope.ok === true) return envelope.value
  const error = envelope.ok === false ? envelope.error : undefined
  const code = typeof error?.code === 'string' && /^\w+$/.test(error.code) ? error.code : 'failed'
  throw new KemlockError(code, typeof error?.message === 'string' ? error.message : undefined)
}

/** Every method of `CoreApi` the Dart side answers, by name. */
export const methods = [
  'state',
  'createVault',
  'unlock',
  'lock',
  'removeVault',
  'exportSession',
  'restoreSession',
  'codes',
  'liveCodes',
  'nextHotp',
  'logins',
  'revealLogin',
  'saveLogin',
  'deleteLogin',
  'ignoreHealth',
  'backupCodes',
  'useBackupCode',
  'addCode',
  'previewCode',
  'readQr',
  'linkCode',
  'match',
  'generate',
  'health',
  'syncStatus',
  'signInKemlock',
  'signInKemlockSso',
  'signInKemlockPasskey',
  'signInWebdav',
  'signInVaultwarden',
  'answerStep',
  'syncNow',
  'confirmRemovals',
  'signOut',
  'settings',
  'saveSettings',
  'recentPasswords',
  'addRecentPassword',
  'rememberedSites',
  'forgetSite',
  'checkServer',
  'securityKeyChallenge',
] as const satisfies readonly (keyof CoreApi)[]

/** The methods that answer nothing: the Dart side's `null` is `undefined` here. */
const answersNothing = new Set<string>([
  'createVault',
  'lock',
  'removeVault',
  'deleteLogin',
  'ignoreHealth',
  'linkCode',
  'signOut',
  'addRecentPassword',
  'forgetSite',
])

/** `CoreApi` over [bridge]. */
export function adaptCore(bridge: CoreBridge): CoreApi {
  const call = async (method: string, args: unknown[]): Promise<unknown> => {
    // JSON turns an argument that is `undefined` into null, which is what the Dart side reads as "none"
    const value = open(await bridge.call(method, JSON.stringify(args)))
    return answersNothing.has(method) ? undefined : value
  }
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of methods) api[method] = (...args) => call(method, args)
  return api as unknown as CoreApi
}
