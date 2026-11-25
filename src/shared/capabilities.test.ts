import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installChromeMock, type ChromeMock } from '../background/test/chrome-mock'
import { detect, limitSessionToTrusted } from './capabilities'

const fn = () => undefined

/** The APIs Chrome, Edge and Firefox give the background (Firefox lacks offscreen). */
const fullChrome = () => ({
  offscreen: { createDocument: fn },
  runtime: { getContexts: fn },
  idle: { onStateChanged: { addListener: fn } },
  identity: { launchWebAuthFlow: fn, getRedirectURL: fn },
  contextMenus: { create: fn, onClicked: { addListener: fn } },
  scripting: {
    registerContentScripts: fn,
    getRegisteredContentScripts: fn,
    unregisterContentScripts: fn,
  },
  storage: { session: { setAccessLevel: fn } },
})

/** What Safari 18 gives: no offscreen, idle or identity, and a session storage with no access level. */
const safari = () => ({
  runtime: {},
  contextMenus: { create: fn, onClicked: { addListener: fn } },
  scripting: {
    registerContentScripts: fn,
    getRegisteredContentScripts: fn,
    unregisterContentScripts: fn,
  },
  storage: { session: {} },
})

const nothing = {
  offscreen: false,
  idle: false,
  identity: false,
  contextMenus: false,
  registerContentScripts: false,
  sessionAccessLevel: false,
}

describe('detect', () => {
  it('finds everything in Chrome', () => {
    expect(detect(fullChrome())).toEqual({
      offscreen: true,
      idle: true,
      identity: true,
      contextMenus: true,
      registerContentScripts: true,
      sessionAccessLevel: true,
    })
  })

  it('finds what Safari lacks: offscreen, idle, identity and the session access level', () => {
    expect(detect(safari())).toEqual({
      offscreen: false,
      idle: false,
      identity: false,
      contextMenus: true,
      registerContentScripts: true,
      sessionAccessLevel: false,
    })
  })

  it('finds no context menu on iOS, and no dynamic content scripts before Safari 17.4', () => {
    const ios = { ...safari(), contextMenus: undefined, scripting: { executeScript: fn } }
    expect(detect(ios)).toMatchObject({ contextMenus: false, registerContentScripts: false })
  })

  it('wants the functions, not just a name: an object in their place is not the API', () => {
    expect(detect({ idle: { onStateChanged: {} } }).idle).toBe(false)
    expect(detect({ identity: { launchWebAuthFlow: fn } }).identity).toBe(false)
    expect(detect({ offscreen: { createDocument: fn }, runtime: {} }).offscreen).toBe(false)
    expect(detect({ idle: null }).idle).toBe(false)
    expect(detect({ idle: 'yes' }).idle).toBe(false)
  })

  it('finds nothing without an extension API, and never throws', () => {
    expect(detect(undefined)).toEqual(nothing)
    expect(detect(null)).toEqual(nothing)
    expect(detect({})).toEqual(nothing)
  })
})

describe('with the global chrome', () => {
  let mock: ChromeMock
  beforeEach(() => {
    mock = installChromeMock()
  })
  afterEach(() => mock.uninstall())

  it('is read by default, as it is at the time', () => {
    expect(detect()).toMatchObject({ idle: true, identity: true, offscreen: true })
    delete (mock.chrome as unknown as Record<string, unknown>).idle
    expect(detect().idle).toBe(false)
  })

  it('limits the session storage to the extension where the browser can', async () => {
    expect(await limitSessionToTrusted()).toBe(true)
    expect(mock.sessionAccessLevel).toBe('TRUSTED_CONTEXTS')
  })

  it('says no where the browser has no access level (Safari), without failing', async () => {
    delete (mock.chrome.storage.session as unknown as Record<string, unknown>).setAccessLevel
    await expect(limitSessionToTrusted()).resolves.toBe(false)
    expect(mock.sessionAccessLevel).toBeUndefined()
  })

  it('says no, without failing, when the browser refuses', async () => {
    const session = mock.chrome.storage.session as unknown as Record<string, unknown>
    session.setAccessLevel = () => Promise.reject(new Error('refused'))
    await expect(limitSessionToTrusted()).resolves.toBe(false)
  })
})
