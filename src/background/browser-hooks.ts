// What the core asks of the browser for Kemlock Server's SSO and passkey sign-ins (docs/plans/add-kemlock-server-sync.md, D4).
import { detect } from '../shared/capabilities'
import type { CoreHooks } from './core/wasm'
import { BackgroundError } from './errors'
import { browserAuth, browserRedirectUrl } from './identity'
import { passkeyAssertion } from './passkey'

/**
 * What the browser lets the core ask. A browser with no sign-in window (Safari) gives none, so the core doesn't offer single
 * sign-on or a passkey, and setup doesn't show them (docs/plans/add-safari.md).
 */
export function browserHooks(): CoreHooks {
  if (!detect().identity) return {}
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
