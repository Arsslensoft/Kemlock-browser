// Access to web pages is the person's to give (design decision 15). Installed with none, the
// extension asks at setup, and later in Settings › Site access, for all sites. While it holds that
// access the content script is registered for every frame; without it, the popup and the
// right-click menu inject the script into the tab in front through `activeTab`.

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
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [contentScriptId] })
  if (!granted) {
    if (registered.length > 0)
      await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] })
    return false
  }
  if (registered.length > 0) return true
  const script: chrome.scripting.RegisteredContentScript = {
    id: contentScriptId,
    js: [contentScriptFile],
    matches: ['<all_urls>'],
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }
  try {
    await chrome.scripting.registerContentScripts([{ ...script, matchOriginAsFallback: true }])
  } catch (error) {
    if (String(error).includes('Duplicate')) return true
    // A browser that doesn't know matchOriginAsFallback: the same without it
    // (Firefox spells it matchAboutBlank, which the typings lack)
    const older = { ...script, matchAboutBlank: true } as chrome.scripting.RegisteredContentScript
    await chrome.scripting.registerContentScripts([older])
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
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [contentScriptId] })
  if (registered.length > 0)
    await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] })
}
