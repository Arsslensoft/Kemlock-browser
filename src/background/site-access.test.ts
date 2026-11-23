import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allSitesGranted,
  contentScriptId,
  dropContentScripts,
  injectContentScript,
  syncContentScripts,
} from './site-access'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
})
afterEach(() => mock.uninstall())

describe('site access', () => {
  it('registers the content script for every frame once all sites are granted', async () => {
    expect(await allSitesGranted()).toBe(false)
    expect(await syncContentScripts()).toBe(false)
    expect(mock.registered.size).toBe(0)
    mock.granted.add('<all_urls>')
    expect(await syncContentScripts()).toBe(true)
    expect(await syncContentScripts()).toBe(true)
    expect(mock.registered.get(contentScriptId)).toMatchObject({
      js: ['content.js'],
      matches: ['<all_urls>'],
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    })
  })

  it('removes the script when the access goes', async () => {
    mock.granted.add('<all_urls>')
    await syncContentScripts()
    mock.granted.delete('<all_urls>')
    expect(await syncContentScripts()).toBe(false)
    expect(mock.registered.size).toBe(0)
  })

  it('falls back to the older spelling where a browser does not know the first', async () => {
    mock.granted.add('<all_urls>')
    const register = mock.chrome.scripting.registerContentScripts
    let first = true
    mock.chrome.scripting.registerContentScripts = (async (
      scripts: chrome.scripting.RegisteredContentScript[],
    ) => {
      if (first) {
        first = false
        throw new Error('Unexpected property: matchOriginAsFallback')
      }
      return register(scripts)
    }) as typeof register
    expect(await syncContentScripts()).toBe(true)
    expect(mock.registered.get(contentScriptId)).toMatchObject({ matchAboutBlank: true })
  })

  it('injects into a tab, or only the frames named, and can drop the script', async () => {
    await injectContentScript(7)
    await injectContentScript(7, [3])
    expect(mock.injected).toEqual([
      { tabId: 7, frameIds: undefined, files: ['content.js'] },
      { tabId: 7, frameIds: [3], files: ['content.js'] },
    ])
    mock.granted.add('<all_urls>')
    await syncContentScripts()
    await dropContentScripts()
    expect(mock.registered.size).toBe(0)
  })
})
