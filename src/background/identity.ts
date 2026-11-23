// Kemlock Server's SSO in the browser (docs/plans/add-kemlock-server-sync.md, design 2): the core
// asks the browser to show the server's sign-in page and give back the address it ends on.
import { BackgroundError } from './errors'

/** The address the SSO flow ends on, which the server's SSO allows for browser devices. */
export function browserRedirectUrl(): string {
  return chrome.identity.getRedirectURL()
}

/**
 * Shows `url` in the browser's own sign-in window (`identity.launchWebAuthFlow`) and returns the
 * address it was sent on to, which holds the server's answer. Only a secure address is shown.
 */
export async function browserAuth(url: string): Promise<string> {
  let address: URL
  try {
    address = new URL(url)
  } catch {
    throw new BackgroundError('badRequest')
  }
  if (address.protocol !== 'https:') throw new BackgroundError('badRequest')
  let redirected: string | undefined
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: address.href, interactive: true })
  } catch {
    // The person closed the window, or the server's page failed
    throw new BackgroundError('cancelled')
  }
  if (redirected === undefined || redirected === '') throw new BackgroundError('cancelled')
  return redirected
}
