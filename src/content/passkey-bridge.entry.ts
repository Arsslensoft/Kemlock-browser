// The bridge script's entry (built as `passkey-bridge.js`, registered in the isolated world at `document_start`): see passkey-bridge.ts.
import { startPasskeyBridge, type BridgeRuntime } from './passkey-bridge'

const marker = Symbol.for('kemlock.passkey.bridge')
const scope = globalThis as typeof globalThis & { [marker]?: boolean }

if (scope[marker] !== true) {
  scope[marker] = true
  startPasskeyBridge(window, chrome.runtime as unknown as BridgeRuntime)
}
