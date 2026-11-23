// The few things the background must know while the vault is locked, when the sealed settings can't
// be read: whether to show buttons in fields, and whether to offer to save. They are mirrored from the
// settings in storage.local, in clear, as nothing about an item. Also the sites the person said
// never to offer to save for, kept as digests of their hosts.
import type { Settings } from '../shared/api'

const prefsKey = 'kemlock_prefs'
const neverKey = 'kemlock_never_save'
const maxNever = 500

export interface Prefs {
  buttonsOnPages: boolean
  offerToSave: boolean
}

export async function readPrefs(): Promise<Prefs> {
  const stored = (await chrome.storage.local.get(prefsKey))[prefsKey] as Partial<Prefs> | undefined
  return {
    buttonsOnPages: stored?.buttonsOnPages !== false,
    offerToSave: stored?.offerToSave !== false,
  }
}

export async function mirrorPrefs(
  settings: Pick<Settings, 'buttonsOnPages' | 'offerToSave'>,
): Promise<void> {
  await chrome.storage.local.set({
    [prefsKey]: { buttonsOnPages: settings.buttonsOnPages, offerToSave: settings.offerToSave },
  })
}

async function digest(host: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(host.toLowerCase())),
  )
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function neverList(): Promise<string[]> {
  const stored = (await chrome.storage.local.get(neverKey))[neverKey]
  return Array.isArray(stored) ? (stored as string[]) : []
}

export async function isNeverSave(host: string): Promise<boolean> {
  return (await neverList()).includes(await digest(host))
}

export async function neverSave(host: string): Promise<void> {
  const list = await neverList()
  const hash = await digest(host)
  if (list.includes(hash)) return
  await chrome.storage.local.set({ [neverKey]: [...list, hash].slice(-maxNever) })
}
