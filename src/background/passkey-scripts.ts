// The passkey provider's two scripts (docs/plans/add-passkeys.md), registered for every frame while the person has the provider on
// and Kemlock has access to all sites:
//
// - `passkey-main.js`, in the page's own world, at `document_start`: wraps `navigator.credentials.create` and `.get` before any
//   script of the page runs. It holds no secret and decides nothing: it asks.
// - `passkey-bridge.js`, in the extension's isolated world, also at `document_start`: takes the request over a `MessagePort`
//   from its own window and passes it to the background, whose answer comes back the same way.
//
// A registered script is the only way to run before the page's own, and one needs the host permission, so the provider needs
// the access the buttons in fields need (Settings › Site access) and the frame list. Without both, nothing is registered and the browser's own
// passkey prompts are all there is.
import { readPasskeyPrefs } from './passkey-prefs'

/**
 * What the provider needs, asked for in one request from the switch's own click: access to all sites (to run before the page's
 * own scripts) and `webNavigation` (to read a frame's ancestors, so the client data can say `crossOrigin`). Neither is asked for
 * at install.
 */
export const passkeyAccess: chrome.permissions.Permissions = {
  origins: ['<all_urls>'],
  permissions: ['webNavigation'],
}

export function passkeyAccessGranted(): Promise<boolean> {
  return chrome.permissions.contains(passkeyAccess)
}

export const passkeyMainId = 'kemlock-passkey-main'
export const passkeyBridgeId = 'kemlock-passkey-bridge'
/** The built scripts (tool/build.mjs). */
export const passkeyMainFile = 'passkey-main.js'
export const passkeyBridgeFile = 'passkey-bridge.js'

async function register(script: chrome.scripting.RegisteredContentScript): Promise<void> {
  try {
    await chrome.scripting.registerContentScripts([{ ...script, matchOriginAsFallback: true }])
  } catch (error) {
    if (String(error).includes('Duplicate')) return
    // A browser that doesn't know matchOriginAsFallback: the same without it (Firefox spells it matchAboutBlank,
    // which the typings lack)
    const older = {
      ...script,
      matchAboutBlank: true,
    } as unknown as chrome.scripting.RegisteredContentScript
    await chrome.scripting.registerContentScripts([older])
  }
}

/**
 * Makes the registered scripts agree with the switch and the access: both registered while the provider is on and access to all
 * sites is held, neither when it isn't. Answers whether they are registered.
 */
export async function syncPasskeyScripts(): Promise<boolean> {
  const wanted = (await passkeyAccessGranted()) && (await readPasskeyPrefs()).on
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [passkeyMainId, passkeyBridgeId],
  })
  const has = (id: string) => registered.some((script) => script.id === id)
  if (!wanted) {
    if (registered.length > 0)
      await chrome.scripting.unregisterContentScripts({
        ids: registered.map((script) => script.id),
      })
    return false
  }
  const common: Omit<chrome.scripting.RegisteredContentScript, 'id' | 'js' | 'world'> = {
    matches: ['<all_urls>'],
    allFrames: true,
    runAt: 'document_start',
    persistAcrossSessions: true,
  }
  if (!has(passkeyMainId))
    await register({ id: passkeyMainId, js: [passkeyMainFile], world: 'MAIN', ...common })
  if (!has(passkeyBridgeId))
    await register({ id: passkeyBridgeId, js: [passkeyBridgeFile], world: 'ISOLATED', ...common })
  return true
}

/** "Remove Kemlock from this browser": the registered scripts go. */
export async function dropPasskeyScripts(): Promise<void> {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [passkeyMainId, passkeyBridgeId],
  })
  if (registered.length > 0)
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) })
}
