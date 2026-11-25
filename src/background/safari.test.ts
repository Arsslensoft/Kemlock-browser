// The background in a browser that lacks what Chrome has (docs/plans/add-safari.md): each API the extension leans on is taken
// away from the chrome mock, as Safari does not have it, and the background still starts and works.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { browserHooks } from './browser-hooks'
import { createMenus, menuItems, parentMenuId } from './menus'
import { contentScriptId, dropContentScripts, syncContentScripts } from './site-access'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'
import { harness, popup, report } from './test/harness'

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
})
afterEach(() => mock.uninstall())

type Bag = Record<string, unknown>

/** The mock's `chrome`, as a bag of APIs to take one from. */
const apis = () => mock.chrome as unknown as Record<string, Bag | undefined>

describe('the content script where the browser cannot register one', () => {
  beforeEach(() => {
    const scripting = apis().scripting
    if (scripting === undefined) throw new Error('the mock has scripting')
    delete scripting.registerContentScripts
    delete scripting.getRegisteredContentScripts
    delete scripting.unregisterContentScripts
  })

  it('registers nothing, and says whether the access is held, so activeTab serves the rest', async () => {
    expect(await syncContentScripts()).toBe(false)
    mock.granted.add('<all_urls>')
    expect(await syncContentScripts()).toBe(true)
    expect(mock.registered.size).toBe(0)
  })

  it('has nothing to drop', async () => {
    await expect(dropContentScripts()).resolves.toBeUndefined()
  })

  it('lets the background set up without it', async () => {
    mock.granted.add('<all_urls>')
    const h = await harness({ mock })
    await expect(h.bg.setup()).resolves.toBeUndefined()
    expect(mock.registered.size).toBe(0)
    h.done()
  })
})

describe('the content script in the spellings of each browser', () => {
  /** Makes `registerContentScripts` refuse its first `refusals` tries with this message; answers the tries made. */
  function refuse(refusals: number, message: string) {
    const register = mock.chrome.scripting.registerContentScripts
    let tried = 0
    mock.chrome.scripting.registerContentScripts = (async (
      scripts: chrome.scripting.RegisteredContentScript[],
    ) => {
      tried += 1
      if (tried <= refusals) throw new Error(message)
      return register(scripts)
    }) as typeof register
    return () => tried
  }

  beforeEach(() => {
    mock.granted.add('<all_urls>')
  })

  it('registers with neither matchOriginAsFallback nor matchAboutBlank where a browser knows neither', async () => {
    const tries = refuse(2, 'Unexpected property')
    expect(await syncContentScripts()).toBe(true)
    expect(tries()).toBe(3)
    const script = mock.registered.get(contentScriptId)
    expect(script).toMatchObject({ allFrames: true, matches: ['<all_urls>'], js: ['content.js'] })
    expect(script).not.toHaveProperty('matchOriginAsFallback')
    expect(script).not.toHaveProperty('matchAboutBlank')
  })

  it('fails when the browser refuses the last spelling too', async () => {
    const tries = refuse(3, 'Unexpected property')
    await expect(syncContentScripts()).rejects.toThrow('Unexpected property')
    expect(tries()).toBe(3)
    expect(mock.registered.size).toBe(0)
  })

  it('does not drop a property to get past a refusal that is not about one', async () => {
    const tries = refuse(3, 'Invalid match pattern')
    await expect(syncContentScripts()).rejects.toThrow('Invalid match pattern')
    // The first two spellings, as before; the one with neither is for a browser that says a property is unknown
    expect(tries()).toBe(2)
    expect(mock.registered.size).toBe(0)
  })

  const there = ["Duplicate script ID 'kemlock-content'", 'A script with this id already exists']
  it.each(there)('takes a script that is there already as registered: %s', async (message) => {
    const tries = refuse(1, message)
    expect(await syncContentScripts()).toBe(true)
    expect(tries()).toBe(1)
  })
})

describe('the right-click menu', () => {
  it('is made where there is one', async () => {
    await createMenus()
    expect(mock.menus.has(parentMenuId)).toBe(true)
    expect(mock.menus.size).toBe(Object.keys(menuItems).length + 1)
  })

  it('is left out where the browser has none (Safari on iOS), without failing', async () => {
    delete apis().contextMenus
    await expect(createMenus()).resolves.toBeUndefined()
    expect(mock.menus.size).toBe(0)
  })
})

describe('the hooks the core is given', () => {
  it('are the browser sign-in window, its redirect address and the passkey page, where there is one', () => {
    const hooks = browserHooks()
    expect(typeof hooks.launchWebAuthFlow).toBe('function')
    expect(typeof hooks.passkeyAssertion).toBe('function')
    expect(hooks.redirectUrl).toBe('https://kemlockid.chromiumapp.org/')
  })

  it('are none in Safari, so the core offers neither SSO nor a passkey', () => {
    delete apis().identity
    expect(browserHooks()).toEqual({})
  })
})

describe('the whole background with what Safari lacks taken away', () => {
  /** Safari 18: no offscreen, idle or identity, no access level on the session storage, no context menus (iOS). */
  function asSafari() {
    for (const name of ['offscreen', 'idle', 'identity', 'contextMenus']) delete apis()[name]
    delete (mock.chrome.storage.session as unknown as Bag).setAccessLevel
  }

  it('starts, unlocks, takes the fields a content script reports, and locks', async () => {
    asSafari()
    const h = await harness({ mock, unlocked: true })
    await h.bg.setup()
    expect(mock.menus.size).toBe(0)
    expect(mock.sessionAccessLevel).toBeUndefined()
    expect((await h.core.state()).unlocked).toBe(true)
    // Nothing that opens the vault is kept where a content script may read it
    expect(mock.session.has('kemlock_session')).toBe(false)
    const url = 'https://accounts.orbit-cloud.com/sign-in'
    mock.tabs.set(7, { id: 7, url, active: true, windowId: 1 })
    const seen = await report(h, url, [
      { id: 'u', kind: 'username' },
      { id: 'p', kind: 'password' },
    ])
    expect(seen).toHaveProperty('buttons')
    expect((await h.send({ kind: 'lock' }, popup)).ok).toBe(true)
    expect((await h.core.state()).unlocked).toBe(false)
    h.done()
  })

  it('locks when the background is stopped, since its keys are not kept in a session storage that may be open', async () => {
    asSafari()
    const h = await harness({ mock, unlocked: true })
    const woken = await h.restart()
    expect((await woken.core.state()).unlocked).toBe(false)
    expect(mock.icons.at(-1)).toBe('icons/locked-16.png')
    woken.done()
  })

  it('keeps it where the browser promises the session storage is closed to content scripts', async () => {
    const h = await harness({ mock, unlocked: true })
    expect(mock.session.has('kemlock_session')).toBe(true)
    const woken = await h.restart()
    expect((await woken.core.state()).unlocked).toBe(true)
    woken.done()
  })
})
