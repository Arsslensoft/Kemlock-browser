// What the core asks of the browser for Kemlock Server's SSO and passkey sign-ins (docs/plans/add-kemlock-server-sync.md, D4).
import type { CoreHooks } from './core/wasm'
import { BackgroundError } from './errors'
import { browserAuth, browserRedirectUrl } from './identity'
import { passkeyAssertion } from './passkey'

export function browserHooks(): CoreHooks {
  const identity = chrome.identity as typeof chrome.identity | undefined
  if (identity === undefined) return {}
  return {
    async launchWebAuthFlow(url) {
      try {
        return await browserAuth(url)
      } catch (error) {
        // The person closed the window: the sign-in ends as cancelled. Anything else (an address that isn't https) is a failure
        if (error instanceof BackgroundError && error.code === 'cancelled') return null
        throw error
      }
    },
    redirectUrl: browserRedirectUrl(),
    passkeyAssertion,
  }
}
