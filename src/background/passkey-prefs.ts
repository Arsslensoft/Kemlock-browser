// What the background must know about the passkey provider while the vault is locked, when the sealed settings can't be read:
// whether it is on, and the sites the person said it stays out of ("Don't offer here"). Mirrored in clear in storage.local, as
// nothing about an item: the switch itself, and the digests of the hosts (so the list names no site), as the sites never to
// save logins for are (src/background/prefs.ts).
import type { Settings } from '../shared/api'

const prefsKey = 'kemlock_passkey_prefs'
const offKey = 'kemlock_passkeys_off_here'
const maxHosts = 500

export interface PasskeyPrefs {
  /** Kemlock answers the browser's passkey requests (on unless the person turned it off). */
  on: boolean
}

export async function readPasskeyPrefs(): Promise<PasskeyPrefs> {
  const stored = (await chrome.storage.local.get(prefsKey))[prefsKey] as
    Partial<PasskeyPrefs> | undefined
  return { on: stored?.on !== false }
}

export async function mirrorPasskeyPrefs(settings: Pick<Settings, 'passkeys'>): Promise<void> {
  await chrome.storage.local.set({ [prefsKey]: { on: settings.passkeys !== false } })
}

/** A host as it is kept: lower case, without the leading `www.` and a trailing dot. */
export function siteKey(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '')
}

async function digest(host: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(siteKey(host))),
  )
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function offList(): Promise<string[]> {
  const stored = (await chrome.storage.local.get(offKey))[offKey]
  return Array.isArray(stored) ? (stored as string[]) : []
}

/** Whether Kemlock stays out of the passkey requests of [host]. */
export async function isOffHere(host: string): Promise<boolean> {
  return (await offList()).includes(await digest(host))
}

export async function setOffHere(host: string, off: boolean): Promise<void> {
  const list = await offList()
  const hash = await digest(host)
  if (list.includes(hash) === off) return
  const next = off ? [...list, hash].slice(-maxHosts) : list.filter((item) => item !== hash)
  await chrome.storage.local.set({ [offKey]: next })
}
