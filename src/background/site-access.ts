// Access to web pages is the person's to give (design decision 15). Installed with none, the
// extension asks at setup, and later in Settings › Site access, for all sites. While it holds that
// access the content script is registered for every frame; without it, the popup and the
// right-click menu inject the script into the tab in front through `activeTab`.

import { detect } from '../shared/capabilities'

type Script = chrome.scripting.RegisteredContentScript

/** What a browser says of a property it doesn't know ("Unexpected property", "Invalid value for key", "not supported"). */
const unknownProperty =
  /unexpected|unknown|unrecognized|unsupported|not supported|property|\bkey\b/i

export const contentScriptId = 'kemlock-content'
/** The built content script (tool/build.mjs). */
export const contentScriptFile = 'content.js'

export function allSitesGranted(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ['<all_urls>'] })
}

/**
 * Makes the registered content script agree with the access: registered for all frames, about:blank
 * ones included, while access to all sites is held, and gone when it isn't. Answers whether it is
 * held.
 */
export async function syncContentScripts(): Promise<boolean> {
  const granted = await allSitesGranted()
  // A browser that can't register scripts (Safari before 17.4) gets the script from activeTab, as when access isn't given
  if (!detect().registerContentScripts) return granted
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [contentScriptId] })
  if (!granted) {
    if (registered.length > 0)
      await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] })
    return false
  }
  if (registered.length > 0) return true
  const script: Script = {
    id: contentScriptId,
    js: [contentScriptFile],
    matches: ['<all_urls>'],
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }
  // A browser that doesn't know matchOriginAsFallback gets the same with its own spelling (Firefox's matchAboutBlank, which the
  // typings lack), and one that knows neither (Safari may) gets it without, but only when it says a property is unknown:
  // any other refusal (a bad pattern, no permission) is not made better by leaving a property out. about:blank frames then
  // wait for activeTab
  const spellings: Record<string, boolean>[] = [
    { matchOriginAsFallback: true },
    { matchAboutBlank: true },
    {},
  ]
  for (const [index, spelling] of spellings.entries()) {
    try {
      const attempt = Object.assign({}, script, spelling) as Script
      await chrome.scripting.registerContentScripts([attempt])
      return true
    } catch (error) {
      if (/duplicate|already/i.test(String(error))) return true
      if (index === spellings.length - 1) throw error
      if (index === 1 && !unknownProperty.test(String(error))) throw error
    }
  }
  return true
}

/** Puts the content script into the frames of a tab the person is using it on (activeTab). */
export async function injectContentScript(tabId: number, frameIds?: number[]): Promise<void> {
  await chrome.scripting.executeScript({
    target: frameIds === undefined ? { tabId, allFrames: true } : { tabId, frameIds },
    files: [contentScriptFile],
  })
}

/** "Remove Kemlock from this browser": the registered script goes. */
export async function dropContentScripts(): Promise<void> {
  if (!detect().registerContentScripts) return
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [contentScriptId] })
  if (registered.length > 0)
    await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] })
}
