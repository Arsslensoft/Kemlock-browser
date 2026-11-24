import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CodeView,
  LoginView,
  MenuView,
  PendingSave,
  PopupView,
  SyncStatus,
  UnlockResult,
} from '../shared/api'
import { idleAlarm } from './autolock'
import { codeFor, decodeBase32 } from './core/fake'
import { siteMatch } from './site'
import {
  content,
  harness,
  menuFrame,
  popup,
  report,
  setup,
  start,
  until,
  useClock,
  type Harness,
} from './test/harness'

const orbit = 'https://accounts.orbit-cloud.com/sign-in'
const loginFields = [
  { id: 'u', kind: 'username' },
  { id: 'p', kind: 'password' },
]
const flush = () => vi.advanceTimersByTimeAsync(10)
const fills = (h: Harness) =>
  h.mock.sentToTabs.filter((sent) => (sent.message as { kind: string }).kind === 'fill')

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const logins = () => h.ok<LoginView[]>({ kind: 'logins' })
const codes = () => h.ok<CodeView[]>({ kind: 'codes' })
const activeTab = (url: string, id = 7) =>
  h.mock.tabs.set(id, { id, url, active: true, windowId: 1 })

describe('the vault', () => {
  it('is created, opened, sealed in the session, and shown on the icon', async () => {
    h.done()
    h = await harness({ sample: false })
    expect(await h.send({ kind: 'codes' })).toEqual({ ok: false, error: 'noVault' })
    await h.ok({ kind: 'createVault', password: 'hunter two' })
    expect((await h.ok<PopupView>({ kind: 'popup' })).state).toMatchObject({ unlocked: true })
    expect(h.mock.sessionAccessLevel).toBe('TRUSTED_CONTEXTS')
    expect(h.mock.session.get('kemlock_session')).toMatch(/^fake-session/)
    expect(h.mock.icons.at(-1)).toBe('icons/unlocked-16.png')
    expect(h.mock.local.get('kemlock_prefs')).toEqual({ buttonsOnPages: true, offerToSave: true })
  })

  it('shows nothing while locked, and counts wrong passwords until it opens', async () => {
    await h.ok({ kind: 'lock' })
    expect(h.mock.icons.at(-1)).toBe('icons/locked-16.png')
    for (const kind of ['codes', 'logins', 'health', 'backupCodes', 'settings', 'syncStatus'])
      expect(await h.send({ kind })).toEqual({ ok: false, error: 'locked' })
    activeTab(orbit)
    expect(await h.ok<PopupView>({ kind: 'popup' })).toEqual({
      state: { exists: true, unlocked: false, wrongPasswords: 0 },
    })
    expect(await h.ok<UnlockResult>({ kind: 'unlock', password: 'nope' })).toEqual({
      ok: false,
      wrongPasswords: 1,
    })
    await h.ok({ kind: 'unlock', password: 'nope again' })
    expect((await h.ok<PopupView>({ kind: 'popup' })).state).toMatchObject({
      wrongPasswords: 2,
      lastWrongAt: start,
    })
    expect(await h.ok<UnlockResult>({ kind: 'unlock', password: 'correct horse' })).toEqual({
      ok: true,
      wrongPasswords: 2,
    })
    expect(h.mock.icons.at(-1)).toBe('icons/unlocked-16.png')
  })

  it('opens again after the worker stopped, without the password, and not in another browser session', async () => {
    const woken = await h.restart()
    expect((await woken.ok<PopupView>({ kind: 'popup' })).state.unlocked).toBe(true)
    expect(await woken.ok<CodeView[]>({ kind: 'codes' })).toHaveLength(1)
    // The browser closed: the session storage is gone
    h.mock.session.clear()
    const next = await woken.restart()
    expect((await next.ok<PopupView>({ kind: 'popup' })).state.unlocked).toBe(false)
    expect(h.mock.icons.at(-1)).toBe('icons/locked-16.png')
  })

  it('locks at once: keys, alarms, counts, menus and sent forms go', async () => {
    activeTab(orbit)
    await report(h, orbit, loginFields)
    await h.ok({ kind: 'sent', username: 'u', password: 'p' }, content(orbit))
    await flush()
    expect(h.mock.badgeText.get(7)).toBe('2')
    await h.ok({ kind: 'lock' })
    expect(h.mock.session.has('kemlock_session')).toBe(false)
    expect([...h.mock.alarms.keys()]).toEqual([])
    expect(h.mock.badgeText.get(7)).toBe('')
    expect(
      h.mock.sentToTabs.some((s) => (s.message as { kind: string }).kind === 'closeMenus'),
    ).toBe(true)
    expect(JSON.stringify([...h.mock.session.entries()])).not.toContain('"password":"p"')
    expect((await h.ok<PopupView>({ kind: 'popup' })).state.unlocked).toBe(false)
  })

  it('locks when the idle time passes, and not before a use', async () => {
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    await h.ok({ kind: 'logins' })
    vi.setSystemTime(start + 6 * 60_000)
    await h.bg.onAlarm({ name: idleAlarm })
    expect((await h.ok<PopupView>({ kind: 'popup' })).state.unlocked).toBe(true)
    vi.setSystemTime(start + 12 * 60_000)
    await h.bg.onAlarm({ name: idleAlarm })
    expect((await h.core.state()).unlocked).toBe(false)
  })

  it('locks when the screen locks, unless asked not to', async () => {
    await h.ok({ kind: 'saveSettings', settings: { lockOnSleep: false } })
    await h.bg.onIdle('locked')
    expect((await h.core.state()).unlocked).toBe(true)
    await h.ok({ kind: 'saveSettings', settings: { lockOnSleep: true } })
    await h.bg.onIdle('active')
    expect((await h.core.state()).unlocked).toBe(true)
    await h.bg.onIdle('locked')
    expect((await h.core.state()).unlocked).toBe(false)
    expect(h.mock.session.has('kemlock_session')).toBe(false)
  })

  it('is removed with everything the extension stored', async () => {
    h.mock.granted.add('<all_urls>')
    await h.ok({ kind: 'allSitesGranted' })
    await h.ok({ kind: 'removeVault' })
    expect((await h.core.state()).exists).toBe(false)
    expect(h.mock.local.size).toBe(0)
    expect(h.mock.session.size).toBe(0)
    expect(h.mock.alarms.size).toBe(0)
    expect(h.mock.registered.size).toBe(0)
    expect(await h.send({ kind: 'unlock', password: 'correct horse' })).toEqual({
      ok: false,
      error: 'noVault',
    })
  })

  it('signs out first, and deletes the device keys database, when it is removed', async () => {
    const order: string[] = []
    const signOut = vi.spyOn(h.core, 'signOut').mockImplementation(async () => {
      order.push('signOut')
      throw new Error('the server is out of reach')
    })
    const remove = h.core.removeVault.bind(h.core)
    vi.spyOn(h.core, 'removeVault').mockImplementation(async () => {
      order.push('removeVault')
      return remove()
    })
    const deleted: string[] = []
    vi.stubGlobal('indexedDB', {
      deleteDatabase: (name: string) => {
        order.push('deleteDatabase')
        deleted.push(name)
        const request: { onsuccess?: () => void } = {}
        queueMicrotask(() => request.onsuccess?.())
        return request
      },
    })
    try {
      await h.ok({ kind: 'removeVault' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(signOut).toHaveBeenCalledOnce()
    expect(order).toEqual(['signOut', 'removeVault', 'deleteDatabase'])
    expect(deleted).toEqual(['kemlock-device-keys'])
    expect((await h.core.state()).exists).toBe(false)
  })

  it('refuses a vault password where a vault already is', async () => {
    expect(await h.send({ kind: 'createVault', password: 'again' })).toMatchObject({ ok: false })
  })
})

describe('who may ask what', () => {
  it('keeps the list, password and clipboard calls from the menu frame and other pages', async () => {
    const [login] = await logins()
    for (const message of [
      { kind: 'showPassword', id: login.id },
      { kind: 'copy', what: 'password', id: login.id },
      { kind: 'saveSettings', settings: {} },
      { kind: 'removeVault' },
      { kind: 'syncNow' },
    ])
      expect(await h.send(message, menuFrame), message.kind).toEqual({
        ok: false,
        error: 'refused',
      })
    // The popup is not the menu either
    expect(await h.send({ kind: 'menu', tabId: 7, frameId: 0, fieldId: 'u' }, popup)).toEqual({
      ok: false,
      error: 'refused',
    })
    const offscreen = { ...popup, url: 'chrome-extension://kemlockid/src/offscreen/index.html' }
    expect(await h.send({ kind: 'popup' }, offscreen)).toEqual({ ok: false, error: 'refused' })
  })
})

describe('the popup', () => {
  it('opens on the site in front, and the toolbar counts its logins and codes', async () => {
    activeTab(orbit)
    const view = await h.ok<PopupView>({ kind: 'popup' })
    expect(view.tab).toMatchObject({ tabId: 7, address: orbit })
    expect(view.tab?.match).toMatchObject({ site: 'orbit-cloud.com' })
    expect(view.tab?.match.logins).toHaveLength(1)
    await flush()
    expect(h.mock.badgeText.get(7)).toBe('2')
    expect(h.mock.badgeColor.get(7)).toBe('#1559C7')
  })

  it('has no card for a site that matches nothing, nor for a page that is not a site', async () => {
    activeTab('https://example.org/')
    expect((await h.ok<PopupView>({ kind: 'popup' })).tab?.match).toMatchObject({
      logins: [],
      codes: [],
    })
    await flush()
    expect(h.mock.badgeText.get(7)).toBe('')
    activeTab('chrome://extensions')
    expect((await h.ok<PopupView>({ kind: 'popup' })).tab).toBeUndefined()
  })

  it('says "!" in orange on a look-alike', async () => {
    activeTab('https://orbit-c1oud.com/')
    const view = await h.ok<PopupView>({ kind: 'popup' })
    expect(view.tab?.match.lookAlikeOf).toBe('orbit-cloud.com')
    await flush()
    expect(h.mock.badgeText.get(7)).toBe('!')
    expect(h.mock.badgeColor.get(7)).toBe('#9A4A06')
  })

  it('follows the tab the person switches to', async () => {
    activeTab(orbit, 8)
    await h.bg.onTabActivated(8)
    expect(h.mock.badgeText.get(8)).toBe('2')
    activeTab('https://example.org/', 9)
    await h.bg.onTabActivated(9)
    expect(h.mock.badgeText.get(9)).toBe('')
  })
})

describe('what the vault holds', () => {
  it('lists codes and live codes that are the real ones', async () => {
    const [code] = await codes()
    const [live] = await h.ok<{ id: string; code: string; expiresAt: number }[]>({
      kind: 'liveCodes',
      ids: [code.id],
    })
    const counter = Math.floor(start / 30_000)
    expect(live.code).toBe(await codeFor(decodeBase32('JBSWY3DPEHPK3PXP'), counter, 6, 'totp'))
    expect(live.expiresAt).toBe((counter + 1) * 30_000)
  })

  it('saves, deletes and counts a change towards the next sync', async () => {
    await h.ok(
      { kind: 'signInKemlock', server: 'https://k.example', email: 'a@b.c', password: 'p' },
      setup,
    )
    const saved = await h.ok<LoginView>({
      kind: 'saveLogin',
      id: null,
      input: {
        name: 'Harbor',
        username: 'sam',
        password: 'Long-Enough-Pass-7',
        websites: ['harbornotes.app'],
      },
    })
    expect(await logins()).toHaveLength(2)
    expect(h.mock.alarms.has('kemlock-sync-soon')).toBe(true)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(h.core.calls).toContain('syncNow')
    await h.ok({ kind: 'ignoreHealth', id: saved.id, ignored: true })
    await h.ok({ kind: 'deleteLogin', id: saved.id })
    expect(await logins()).toHaveLength(1)
  })

  it('shows a password only to the popup, and keeps it out of the lists', async () => {
    const [login] = await logins()
    expect(JSON.stringify(login)).not.toContain('Orbit-Cloud-7731')
    expect(await h.ok({ kind: 'showPassword', id: login.id })).toBe('Orbit-Cloud-7731!')
  })

  it('counts a backup code used, copies it and has the next sync follow', async () => {
    const [service] = await h.ok<{ serviceId: string; left: number }[]>({ kind: 'backupCodes' })
    expect(service.left).toBe(3)
    await h.ok({ kind: 'copy', what: 'backupCode', id: service.serviceId })
    expect(h.clipboard.text).toBe('1111-2222')
    expect((await h.ok<{ left: number }[]>({ kind: 'backupCodes' }))[0].left).toBe(2)
  })

  it('links a code, reads the health and the generator', async () => {
    const [login] = await logins()
    const [code] = await codes()
    await h.ok({ kind: 'linkCode', codeId: code.id, loginId: null })
    expect((await logins())[0].codeId).toBeUndefined()
    await h.ok({ kind: 'linkCode', codeId: code.id, loginId: login.id })
    expect((await logins())[0].codeId).toBe(code.id)
    expect(await h.ok({ kind: 'health' })).toMatchObject({ reused: [], weak: [] })
    expect(
      await h.ok<string>({ kind: 'generate', options: { mode: 'random', length: 24 } }),
    ).toHaveLength(24)
  })

  it('counts an HOTP up', async () => {
    const hotp = await h.core.addCode('otpauth://hotp/Mail:sam?secret=GEZDGNBVGY3TQOJQ&counter=0')
    const next = await h.ok<{ code: string }>({ kind: 'nextHotp', id: hotp.id })
    expect(next.code).toMatch(/^\d{6}$/)
  })
})

describe('copying', () => {
  it('copies a password, a username and a code, and clears it later if unchanged', async () => {
    const [login] = await logins()
    await h.ok({ kind: 'copy', what: 'password', id: login.id })
    expect(h.clipboard.text).toBe('Orbit-Cloud-7731!')
    await h.ok({ kind: 'copy', what: 'username', id: login.id })
    expect(h.clipboard.text).toBe('sam@example.com')
    const [code] = await codes()
    await h.ok({ kind: 'copy', what: 'code', id: code.id })
    expect(h.clipboard.text).toMatch(/^\d{6}$/)
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => h.clipboard.text === '')
    expect(h.clipboard.text).toBe('')
  })

  it('clears after the time chosen, and leaves what was copied since', async () => {
    const [login] = await logins()
    await h.ok({ kind: 'saveSettings', settings: { clipboardSeconds: 10 } })
    await h.ok({ kind: 'copy', what: 'password', id: login.id })
    h.clipboard.text = 'something else'
    await vi.advanceTimersByTimeAsync(11_000)
    expect(h.clipboard.text).toBe('something else')
  })

  it('copies a generated password it is handed, and refuses one it has not', async () => {
    await h.ok({ kind: 'copy', what: 'generated', id: '', value: 'Gen-erated-1' })
    expect(h.clipboard.text).toBe('Gen-erated-1')
    expect(await h.send({ kind: 'copy', what: 'generated', id: '' })).toEqual({
      ok: false,
      error: 'failed',
    })
  })
})

describe('filling', () => {
  it('fills the login of the site in front into its frame, after checking the site again', async () => {
    const [login] = await logins()
    await report(h, orbit, loginFields)
    await h.ok({ kind: 'fill', tabId: 7, loginId: login.id })
    expect(fills(h)).toEqual([
      {
        tabId: 7,
        message: {
          kind: 'fill',
          fieldId: 'u',
          value: 'sam@example.com',
          origin: 'https://accounts.orbit-cloud.com',
        },
        options: { frameId: 0, documentId: 'doc-7-0' },
      },
      {
        tabId: 7,
        message: {
          kind: 'fill',
          fieldId: 'p',
          value: 'Orbit-Cloud-7731!',
          origin: 'https://accounts.orbit-cloud.com',
        },
        options: { frameId: 0, documentId: 'doc-7-0' },
      },
    ])
  })

  it('does not fill a site the item is not for', async () => {
    const [login] = await logins()
    for (const url of ['https://orbit-cloud.com.evil.io/', 'https://orbit-c1oud.com/']) {
      await report(h, url, loginFields)
      expect(await h.send({ kind: 'fill', tabId: 7, loginId: login.id })).toEqual({
        ok: false,
        error: 'noMatch',
      })
      expect(
        await h.send({ kind: 'fill', tabId: 7, frameId: 0, fieldId: 'p', loginId: login.id }),
      ).toEqual({
        ok: false,
        error: 'noMatch',
      })
    }
    expect(fills(h)).toEqual([])
  })

  it("judges a field by its own frame: a frame from another site isn't filled in an Orbit page", async () => {
    const [login] = await logins()
    await report(h, orbit, loginFields, 7, 0)
    await report(h, 'https://evil.test/login', loginFields, 7, 3)
    await h.ok({ kind: 'fill', tabId: 7, loginId: login.id })
    expect(new Set(fills(h).map((sent) => sent.options?.frameId))).toEqual(new Set([0]))
    expect(
      await h.send({ kind: 'fill', tabId: 7, frameId: 3, fieldId: 'p', loginId: login.id }),
    ).toEqual({ ok: false, error: 'noMatch' })
  })

  it('does not fill into a frame whose field it was never told of', async () => {
    const [login] = await logins()
    await report(h, orbit, loginFields)
    expect(
      await h.send({ kind: 'fill', tabId: 7, frameId: 0, fieldId: 'nope', loginId: login.id }),
    ).toEqual({
      ok: false,
      error: 'unknownField',
    })
    expect(
      await h.send({ kind: 'fill', tabId: 7, frameId: 9, fieldId: 'u', loginId: login.id }),
    ).toEqual({
      ok: false,
      error: 'unknownField',
    })
    expect(await h.send({ kind: 'fill', tabId: 7 })).toEqual({ ok: false, error: 'badRequest' })
  })

  it('fills a code into its field, and never a code kept on a security key', async () => {
    const [code] = await codes()
    await report(h, orbit, [{ id: 'c', kind: 'code', boxes: 6 }])
    await h.ok({ kind: 'fill', tabId: 7, codeId: code.id })
    const [sent] = fills(h)
    expect((sent.message as { fieldId: string; value: string }).fieldId).toBe('c')
    expect((sent.message as { value: string }).value).toMatch(/^\d{6}$/)
    h.core.disk.codes[0].onSecurityKey = true
    expect(await h.send({ kind: 'fill', tabId: 7, codeId: code.id })).toEqual({
      ok: false,
      error: 'securityKey',
    })
  })

  it('says so when the page refuses', async () => {
    const [login] = await logins()
    await report(h, orbit, loginFields)
    h.mock.tabReply = () => ({ ok: false })
    expect(await h.send({ kind: 'fill', tabId: 7, loginId: login.id })).toEqual({
      ok: false,
      error: 'failed',
    })
    h.mock.tabReply = () => {
      throw new Error('the frame went')
    }
    expect(await h.send({ kind: 'fill', tabId: 7, loginId: login.id })).toEqual({
      ok: false,
      error: 'failed',
    })
  })

  it('lets the script in when the popup is used on a tab with none, and waits for its report', async () => {
    const [login] = await logins()
    activeTab(orbit)
    h.mock.onInject = async (injection) => {
      await report(h, orbit, loginFields, injection.tabId)
    }
    await h.ok({ kind: 'fill', tabId: 7, loginId: login.id })
    expect(h.mock.injected).toEqual([{ tabId: 7, frameIds: undefined, files: ['content.js'] }])
    expect(fills(h)).toHaveLength(2)
  })

  it('says there is no match when the script finds no field, or no permission when it cannot enter', async () => {
    const [login] = await logins()
    const waiting = h.send({ kind: 'fill', tabId: 7, loginId: login.id })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await waiting).toEqual({ ok: false, error: 'noMatch' })
    h.mock.chrome.scripting.executeScript = (async () => {
      throw new Error('Cannot access contents of the page')
    }) as typeof chrome.scripting.executeScript
    expect(await h.send({ kind: 'fill', tabId: 8, loginId: login.id })).toEqual({
      ok: false,
      error: 'noPermission',
    })
  })

  it('forgets the frames of a tab that went on to another site since', async () => {
    const [login] = await logins()
    await report(h, orbit, loginFields)
    activeTab('https://evil.test/')
    const waiting = h.send({ kind: 'fill', tabId: 7, loginId: login.id })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await waiting).toEqual({ ok: false, error: 'noMatch' })
    expect(fills(h)).toEqual([])
  })

  it('offers the linked code on the next page after a login filled, on that site only', async () => {
    const [login] = await logins()
    await report(h, orbit, loginFields)
    await h.ok({ kind: 'fill', tabId: 7, loginId: login.id })
    h.mock.sentToTabs.length = 0
    await report(h, 'https://accounts.orbit-cloud.com/code', [{ id: 'c', kind: 'code' }])
    await flush()
    expect(h.mock.sentToTabs).toEqual([
      { tabId: 7, message: { kind: 'openMenu', fieldId: 'c' }, options: { frameId: 0 } },
    ])
    // Once only, and filling still needs a click
    h.mock.sentToTabs.length = 0
    await report(h, 'https://accounts.orbit-cloud.com/code', [{ id: 'c', kind: 'code' }])
    await flush()
    expect(h.mock.sentToTabs).toEqual([])
    expect(fills(h)).toEqual([])
  })

  it('does not offer the code on another site, nor when the setting is off', async () => {
    const [login] = await logins()
    await report(h, orbit, loginFields)
    await h.ok({ kind: 'fill', tabId: 7, loginId: login.id })
    h.mock.sentToTabs.length = 0
    await report(h, 'https://evil.test/code', [{ id: 'c', kind: 'code' }])
    await flush()
    expect(h.mock.sentToTabs).toEqual([])
    await h.ok({ kind: 'saveSettings', settings: { codeAfterPassword: false } })
    await report(h, orbit, loginFields, 8)
    await h.ok({ kind: 'fill', tabId: 8, loginId: login.id })
    await report(h, 'https://accounts.orbit-cloud.com/code', [{ id: 'c', kind: 'code' }], 8)
    await flush()
    expect(
      h.mock.sentToTabs.filter((s) => s.tabId === 8 && !('value' in (s.message as object))),
    ).toEqual([])
  })
})

describe('the in-page menu', () => {
  const open = async (
    url: string,
    fields: { id: string; kind: string; rules?: string }[],
    frame = 0,
  ) => {
    await report(h, url, fields, 7, frame)
    await h.ok({ kind: 'openMenu', fieldId: fields[0].id }, content(url, 7, frame))
  }
  const ask = (fieldId = 'u', frameId = 0, tabId = 7) =>
    h.send<MenuView>({ kind: 'menu', tabId, frameId, fieldId }, menuFrame)

  it('lists what the site offers, only to the menu a content script opened', async () => {
    expect(await ask()).toEqual({ ok: false, error: 'refused' })
    await open(orbit, loginFields)
    const answer = await ask()
    expect(answer).toMatchObject({ ok: true, value: { field: { kind: 'username' } } })
    const view = (answer as { value: MenuView }).value
    expect(view.logins.map((l) => l.name)).toEqual(['Orbit Cloud'])
    expect(view.codes).toHaveLength(1)
    expect(JSON.stringify(view)).not.toContain('Orbit-Cloud-7731')
    // Another field, frame or tab is not the one opened
    expect(await ask('p')).toEqual({ ok: false, error: 'refused' })
    expect(await ask('u', 3)).toEqual({ ok: false, error: 'refused' })
    expect(await ask('u', 0, 8)).toEqual({ ok: false, error: 'refused' })
  })

  it('lists nothing while locked, so the menu asks to unlock', async () => {
    await open(orbit, loginFields)
    await h.ok({ kind: 'lock' })
    expect(await ask()).toMatchObject({ ok: false, error: 'refused' })
    await open(orbit, loginFields)
    expect(await ask()).toEqual({
      ok: true,
      value: {
        state: { exists: true, unlocked: false, wrongPasswords: 0 },
        match: { site: 'accounts.orbit-cloud.com', logins: [], codes: [] },
        logins: [],
        codes: [],
        field: { kind: 'username' },
      },
    })
    expect(
      await h.ok<UnlockResult>({ kind: 'unlock', password: 'correct horse' }, menuFrame),
    ).toMatchObject({ ok: true })
    expect(((await ask()) as { value: MenuView }).value.logins).toHaveLength(1)
  })

  it('expires a menu that was opened long ago', async () => {
    await open(orbit, loginFields)
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(await ask()).toEqual({ ok: false, error: 'refused' })
  })

  it('refuses a field the frame did not report', async () => {
    await report(h, orbit, loginFields)
    expect(await h.send({ kind: 'openMenu', fieldId: 'ghost' }, content(orbit))).toEqual({
      ok: false,
      error: 'unknownField',
    })
  })

  it('offers a picker on an unknown site, and remembers a pick for that host only', async () => {
    const [login] = await logins()
    const url = 'https://id.orbitauth.net/login'
    await open(url, loginFields)
    const view = ((await ask()) as { value: MenuView }).value
    expect(view.match).toMatchObject({ logins: [], codes: [] })
    expect(view.logins).toHaveLength(1)
    // The popup may not fill what the site doesn't offer, the menu may after the person confirmed
    expect(
      await h.send({ kind: 'fill', tabId: 7, frameId: 0, fieldId: 'u', loginId: login.id }, popup),
    ).toEqual({ ok: false, error: 'noMatch' })
    await h.ok(
      {
        kind: 'fill',
        tabId: 7,
        frameId: 0,
        fieldId: 'u',
        loginId: login.id,
        remember: true,
        picked: true,
      },
      menuFrame,
    )
    expect(fills(h)).toHaveLength(2)
    await open(url, loginFields)
    expect(((await ask()) as { value: MenuView }).value.match.logins).toEqual([login.id])
    await open('https://other.example/login', loginFields)
    expect(((await ask()) as { value: MenuView }).value.match.logins).toEqual([])
  })

  it('checks a menu fill that was not picked on the Confirm screen against the frame site', async () => {
    const [login] = await logins()
    const url = 'https://id.orbitauth.net/login'
    await open(url, loginFields)
    const args = { kind: 'fill', tabId: 7, frameId: 0, fieldId: 'u', loginId: login.id }
    // A matched-list click, or a message that claims nothing, may not fill an item the site isn't for
    expect(await h.send(args, menuFrame)).toEqual({ ok: false, error: 'noMatch' })
    expect(await h.send({ ...args, picked: false }, menuFrame)).toEqual({
      ok: false,
      error: 'noMatch',
    })
    // Another page claiming a pick doesn't make one
    expect(await h.send({ ...args, picked: true }, popup)).toEqual({ ok: false, error: 'noMatch' })
    expect(fills(h)).toEqual([])
    await h.ok({ ...args, picked: true }, menuFrame)
    expect(fills(h)).toHaveLength(2)
  })

  it('fills only the frame and field it was opened for', async () => {
    const [login] = await logins()
    await open(orbit, loginFields)
    expect(
      await h.send(
        { kind: 'fill', tabId: 7, frameId: 0, fieldId: 'p', loginId: login.id },
        menuFrame,
      ),
    ).toEqual({ ok: false, error: 'refused' })
    expect(await h.send({ kind: 'fill', tabId: 7, loginId: login.id }, menuFrame)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(fills(h)).toEqual([])
  })

  it('suggests a strong password and a passphrase on a new-password field, to the site rules', async () => {
    const url = 'https://harbornotes.app/sign-up'
    const fields = [
      { id: 'n1', kind: 'newPassword', rules: 'maxlength: 16' },
      { id: 'n2', kind: 'newPassword' },
    ]
    await open(url, fields)
    const view = ((await ask('n1')) as { value: MenuView }).value
    expect(view.suggestions).toHaveLength(2)
    expect(view.suggestions?.[0]).toHaveLength(16)
    expect(view.suggestions?.[1]).toContain('-')
  })

  it('fills a suggestion into the field and its confirmation, keeping it under Recently generated first', async () => {
    const url = 'https://harbornotes.app/sign-up'
    await open(url, [
      { id: 'n1', kind: 'newPassword' },
      { id: 'n2', kind: 'newPassword' },
    ])
    let keptBeforeFill: number | undefined
    h.mock.tabReply = () => {
      keptBeforeFill ??= h.core.disk.recent.length
    }
    await h.ok(
      { kind: 'fill', tabId: 7, frameId: 0, fieldId: 'n1', newPassword: 'Suggested-Pass-42' },
      menuFrame,
    )
    expect(keptBeforeFill).toBe(1)
    expect(fills(h).map((s) => (s.message as { fieldId: string; value: string }).fieldId)).toEqual([
      'n1',
      'n2',
    ])
    expect(new Set(fills(h).map((s) => (s.message as { value: string }).value))).toEqual(
      new Set(['Suggested-Pass-42']),
    )
    expect(
      await h.ok<{ value: string; site: string }[]>({ kind: 'recentPasswords' }),
    ).toMatchObject([{ value: 'Suggested-Pass-42', site: 'harbornotes.app' }])
  })

  it('points to setup when the account has to sign in again', async () => {
    await h.ok(
      { kind: 'signInKemlock', server: 'https://k.example', email: 'a@b.c', password: 'p' },
      setup,
    )
    h.core.syncProblem = 'sessionEnded'
    await h.ok({ kind: 'syncNow' })
    await open(orbit, loginFields)
    expect(((await ask()) as { value: MenuView }).value.signInAgain).toBe(true)
  })
})

describe('buttons in fields', () => {
  it('are for the content script only once access to all sites is granted and the setting is on', async () => {
    expect(await report(h, orbit, loginFields)).toEqual({ buttons: false })
    h.mock.granted.add('<all_urls>')
    expect(await report(h, orbit, loginFields)).toEqual({ buttons: true })
    await h.ok({ kind: 'saveSettings', settings: { buttonsOnPages: false } })
    expect(await report(h, orbit, loginFields)).toEqual({ buttons: false })
  })

  it('keep the access in step with the content script that is registered', async () => {
    expect(await h.ok({ kind: 'allSitesGranted' })).toBe(false)
    h.mock.granted.add('<all_urls>')
    expect(await h.ok({ kind: 'allSitesGranted' })).toBe(true)
    expect(h.mock.registered.size).toBe(1)
    h.mock.granted.clear()
    await h.bg.onPermissionsChanged()
    expect(h.mock.registered.size).toBe(0)
  })

  it('keep the frame by what the browser reports, not what the message says', async () => {
    await h.ok(
      {
        kind: 'fields',
        fields: loginFields,
        url: 'https://orbit-cloud.com/',
        origin: 'https://orbit-cloud.com',
      },
      content('https://evil.test/login'),
    )
    const [login] = await logins()
    expect(await h.send({ kind: 'fill', tabId: 7, loginId: login.id })).toEqual({
      ok: false,
      error: 'noMatch',
    })
  })
})

describe('the right-click menu', () => {
  const click = (id: string, pageUrl = orbit, frameId = 0) =>
    h.bg.onMenuClicked({ menuItemId: id, frameId, pageUrl, editable: true }, {
      id: 7,
    } as chrome.tabs.Tab)
  const target = { fieldId: 'x', kind: 'username' }
  const kinds = () => h.mock.sentToTabs.map((s) => (s.message as { kind: string }).kind)

  beforeEach(() => {
    h.mock.tabReply = (sent) =>
      (sent.message as { kind: string }).kind === 'contextTarget' ? target : undefined
  })

  it('is made with Fill login, Fill code and New password under Kemlock, for editable fields', async () => {
    await h.bg.setup()
    expect([...h.mock.menus.values()].map((m) => [m.id, m.parentId, m.title, m.contexts])).toEqual([
      ['kemlock', undefined, 'extName', ['editable']],
      ['kemlock-fill-login', 'kemlock', 'bgMenuFillLogin', ['editable']],
      ['kemlock-fill-code', 'kemlock', 'bgMenuFillCode', ['editable']],
      ['kemlock-new-password', 'kemlock', 'bgMenuNewPassword', ['editable']],
    ])
  })

  it('fills a field Kemlock gave no button when the site has one login', async () => {
    await click('kemlock-fill-login')
    expect(kinds()).toEqual(['contextTarget', 'fill'])
    expect(fills(h)[0]).toMatchObject({
      message: {
        fieldId: 'x',
        value: 'sam@example.com',
        origin: 'https://accounts.orbit-cloud.com',
      },
      options: { frameId: 0 },
    })
  })

  it('fills the code, or a new password into the field', async () => {
    await click('kemlock-fill-code')
    expect((fills(h)[0].message as { value: string }).value).toMatch(/^\d{6}$/)
    h.mock.sentToTabs.length = 0
    await click('kemlock-new-password')
    expect((fills(h)[0].message as { value: string }).value).toHaveLength(20)
    expect(h.core.disk.recent).toHaveLength(1)
  })

  it('opens the menu to pick when the site has no match, or when locked', async () => {
    await click('kemlock-fill-login', 'https://example.org/')
    expect(h.mock.sentToTabs.at(-1)).toMatchObject({ message: { kind: 'openMenu', fieldId: 'x' } })
    expect(fills(h)).toEqual([])
    h.mock.sentToTabs.length = 0
    await h.ok({ kind: 'lock' })
    h.mock.sentToTabs.length = 0
    await click('kemlock-fill-login')
    expect(kinds()).toEqual(['contextTarget', 'openMenu'])
  })

  it('gives the script to a frame that has none, as the click lets it', async () => {
    h.mock.tabReply = (sent) => {
      if (h.mock.injected.length === 0) throw new Error('Could not establish connection')
      return (sent.message as { kind: string }).kind === 'contextTarget' ? target : undefined
    }
    await click('kemlock-fill-login')
    expect(h.mock.injected).toEqual([{ tabId: 7, frameIds: [0], files: ['content.js'] }])
    expect(fills(h)).toHaveLength(1)
  })

  it('does nothing for another menu, or when the frame names no field', async () => {
    await click('something-else')
    expect(h.mock.sentToTabs).toEqual([])
    h.mock.tabReply = () => null
    await click('kemlock-fill-login')
    expect(fills(h)).toEqual([])
  })
})

describe('adding a code', () => {
  const qr = (link: string) => `data:image/png;kemlock-fake-qr,${encodeURIComponent(link)}`

  it('reads a QR code in the tab in front and adds it with the tab site as its website', async () => {
    activeTab(orbit)
    h.mock.captured = qr('otpauth://totp/GitHub:sam?secret=JBSWY3DPEHPK3PXQ&issuer=GitHub')
    const code = await h.ok<CodeView>({ kind: 'addCodeFromTab', tabId: 7 })
    expect(code).toMatchObject({ issuer: 'GitHub', websites: ['orbit-cloud.com'] })
    expect(await h.send({ kind: 'addCodeFromTab', tabId: 7 })).toEqual({
      ok: false,
      error: 'duplicate',
    })
  })

  it('links the new code to the login of that site', async () => {
    const [login] = await logins()
    await h.ok({ kind: 'linkCode', codeId: (await codes())[0].id, loginId: null })
    activeTab(orbit)
    h.mock.captured = qr('otpauth://totp/Orbit:sam?secret=JBSWY3DPEHPK3PXQ')
    await h.ok({ kind: 'addCodeFromTab', tabId: 7, linkTo: login.id })
    expect((await logins())[0].codeId).toBeDefined()
  })

  it('says nothing was found when the QR code is not a code, or there is none', async () => {
    activeTab(orbit)
    h.mock.captured = qr('https://example.org/')
    expect(await h.ok({ kind: 'addCodeFromTab', tabId: 7 })).toBeNull()
    h.mock.captured = 'data:image/png;base64,AAAA'
    expect(await h.ok({ kind: 'addCodeFromTab', tabId: 7 })).toBeNull()
    expect(await codes()).toHaveLength(1)
  })

  it('shows the QR code in the tab in front without adding it, and names the code it already is', async () => {
    activeTab(orbit)
    const link = 'otpauth://totp/GitHub:sam?secret=JBSWY3DPEHPK3PXQ&issuer=GitHub'
    h.mock.captured = qr(link)
    expect(await h.ok({ kind: 'readCodeFromTab', tabId: 7 })).toEqual({
      otpauth: link,
      issuer: 'GitHub',
      account: 'sam',
      website: 'accounts.orbit-cloud.com',
    })
    expect(await codes()).toHaveLength(1)

    await h.ok({ kind: 'addCodeFromLink', otpauth: link, website: 'orbit-cloud.com' })
    expect(await h.ok<{ existing: CodeView }>({ kind: 'readCodeFromTab', tabId: 7 })).toMatchObject(
      {
        existing: { issuer: 'GitHub', websites: ['orbit-cloud.com'] },
      },
    )
    h.mock.captured = qr('https://example.org/')
    expect(await h.ok({ kind: 'readCodeFromTab', tabId: 7 })).toBeNull()
  })

  it('reads only the tab in front', async () => {
    h.mock.tabs.set(7, { id: 7, url: orbit, active: false, windowId: 1 })
    expect(await h.send({ kind: 'addCodeFromTab', tabId: 7 })).toEqual({
      ok: false,
      error: 'unknownField',
    })
    expect(await h.send({ kind: 'addCodeFromTab', tabId: 99 })).toEqual({
      ok: false,
      error: 'unknownField',
    })
  })

  it('adds a pasted link, and names the account already in the vault', async () => {
    const link = 'otpauth://totp/Orbit:sam?secret=JBSWY3DPEHPK3PXQ&issuer=Orbit'
    expect(await h.ok<CodeView>({ kind: 'addCodeFromLink', otpauth: link })).toMatchObject({
      issuer: 'Orbit',
    })
    expect(await h.send({ kind: 'addCodeFromLink', otpauth: link })).toEqual({
      ok: false,
      error: 'duplicate',
    })
    expect(await h.send({ kind: 'addCodeFromLink', otpauth: 'https://example.org' })).toEqual({
      ok: false,
      error: 'badLink',
    })
  })
})

describe('saving logins', () => {
  const url = 'https://harbornotes.app/sign-up'
  const sent = (message: object, at = url) => h.ok({ kind: 'sent', ...message }, content(at))
  const pending = (tabId = 7) => h.ok<PendingSave | null>({ kind: 'pendingSave', tabId })
  const promptsOn = (tabId = 7) =>
    h.mock.sentToTabs.filter(
      (s) => s.tabId === tabId && (s.message as { kind: string }).kind === 'savePrompt',
    )

  it('offers to save a login the vault does not hold, and saves it under the form host', async () => {
    await report(h, url, loginFields)
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    expect(await pending()).toEqual({ site: 'harbornotes.app', username: 'sam' })
    const save = vi.spyOn(h.core, 'saveLogin')
    await h.ok({ kind: 'answerSave', tabId: 7, save: true })
    // A login saved from the prompt is marked as the app marks one AutoFill saved
    expect(save).toHaveBeenCalledWith(null, expect.objectContaining({ fromAutofill: true }))
    const saved = (await logins()).find((l) => l.username === 'sam')
    expect(saved).toMatchObject({ websites: ['harbornotes.app'], name: 'harbornotes.app' })
    expect(await pending()).toBeNull()
    expect(h.mock.alarms.has('kemlock-sync-soon')).toBe(true)
  })

  it('takes the new password of a form that changes one', async () => {
    await sent({ username: 'sam', password: 'old-one', newPassword: 'Brand-New-Pass-9' })
    await h.ok({ kind: 'answerSave', tabId: 7, save: true })
    const [login] = (await logins()).filter((l) => l.username === 'sam')
    expect(await h.ok({ kind: 'showPassword', id: login.id })).toBe('Brand-New-Pass-9')
  })

  it('does not offer when the vault holds that password, and offers an update when it differs', async () => {
    await sent({ username: 'sam@example.com', password: 'Orbit-Cloud-7731!' }, orbit)
    expect(await pending()).toBeNull()
    await sent({ username: 'sam@example.com', password: 'Changed-On-The-Site-5' }, orbit)
    const [login] = await logins()
    expect(await pending()).toEqual({
      site: 'orbit-cloud.com',
      username: 'sam@example.com',
      updateOf: login.id,
    })
    await h.ok({ kind: 'answerSave', tabId: 7, save: true })
    expect((await logins())[0]).toMatchObject({ previousPasswords: 1 })
    expect(await h.ok({ kind: 'showPassword', id: login.id })).toBe('Changed-On-The-Site-5')
    expect(await logins()).toHaveLength(1)
  })

  it('asks once, when the next page has loaded', async () => {
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    await h.bg.onTabUpdated(7, { status: 'loading', url: 'https://harbornotes.app/welcome' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(promptsOn()).toEqual([])
    await h.bg.onTabUpdated(7, { status: 'complete' })
    expect(promptsOn()).toEqual([
      { tabId: 7, message: { kind: 'savePrompt' }, options: { frameId: 0 } },
    ])
    await h.bg.onTabUpdated(7, { status: 'complete' })
    expect(promptsOn()).toHaveLength(1)
  })

  it('asks soon on a page that does not go on, such as a form that vanished', async () => {
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    await vi.advanceTimersByTimeAsync(3000)
    await until(() => promptsOn().length > 0)
    expect(promptsOn()).toHaveLength(1)
  })

  it('does not ask for a login the vault has, and drops what it will not offer', async () => {
    await sent({ username: 'sam@example.com', password: 'Orbit-Cloud-7731!' }, orbit)
    await h.bg.onTabUpdated(7, { status: 'complete' })
    expect(promptsOn()).toEqual([])
    expect((await h.bg['d'].tabs.get(7)).pending).toBeUndefined()
  })

  it('forgets a form after five minutes', async () => {
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000)
    expect(await pending()).toBeNull()
    await h.ok({ kind: 'answerSave', tabId: 7, save: true })
    expect((await logins()).some((l) => l.username === 'sam')).toBe(false)
  })

  it('never offers again for a site the person said never for', async () => {
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    await h.ok({ kind: 'answerSave', tabId: 7, save: false, never: true })
    expect((await logins()).some((l) => l.username === 'sam')).toBe(false)
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    expect(await pending()).toBeNull()
    expect(JSON.stringify([...h.mock.local.entries()])).not.toContain('harbornotes')
  })

  it('does not offer while the setting is off, or while locked', async () => {
    await h.ok({ kind: 'saveSettings', settings: { offerToSave: false } })
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    expect(await pending()).toBeNull()
    await h.ok({ kind: 'saveSettings', settings: { offerToSave: true } })
    await sent({ username: 'sam', password: 'Harbor-Pass-2026' })
    await h.ok({ kind: 'lock' })
    expect(await h.send({ kind: 'pendingSave', tabId: 7 })).toEqual({ ok: true, value: null })
    expect(await h.send({ kind: 'answerSave', tabId: 7, save: true })).toEqual({ ok: true })
  })

  it('answers a menu frame about its own tab only, and sees no sent form from a frame with no web address', async () => {
    expect(await h.send({ kind: 'pendingSave', tabId: 8 }, menuFrame)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(await h.send({ kind: 'pendingSave', tabId: 7 }, menuFrame)).toEqual({
      ok: true,
      value: null,
    })
    await h.ok(
      { kind: 'sent', username: 'a', password: 'b' },
      { ...content('about:blank'), origin: undefined },
    )
    expect(await pending()).toBeNull()
  })
})

describe('sync from the pages', () => {
  const signIn = () =>
    h.ok(
      { kind: 'signInKemlock', server: 'https://k.example', email: 'a@b.c', password: 'p' },
      setup,
    )

  it('signs in, checks the server, and runs Sync now with its problem on the icon', async () => {
    // Plain http is refused by the core before any request, with the problem the setup tab shows
    expect(
      await h.send(
        { kind: 'checkServer', place: 'vaultwarden', server: 'http://vw.example' },
        setup,
      ),
    ).toEqual({ ok: true, value: { ok: false, problem: 'insecure' } })
    expect(
      await h.ok({ kind: 'checkServer', place: 'kemlock', server: 'https://k.example' }, setup),
    ).toEqual({
      ok: true,
    })
    expect(await signIn()).toMatchObject({ step: 'done' })
    expect(await h.ok<SyncStatus>({ kind: 'syncNow' })).toMatchObject({ lastSync: start })
    h.core.syncProblem = 'signedOut'
    expect(await h.ok<SyncStatus>({ kind: 'syncNow' })).toMatchObject({ problem: 'signedOut' })
    expect(h.mock.icons.at(-1)).toBe('icons/sync-stopped-16.png')
    expect((await h.ok<PopupView>({ kind: 'popup' })).state.sync).toMatchObject({
      problem: 'signedOut',
    })
    h.core.syncProblem = undefined
    await h.ok({ kind: 'syncNow' })
    expect(h.mock.icons.at(-1)).toBe('icons/unlocked-16.png')
  })

  it('says it cannot sync when it is not set up', async () => {
    expect(await h.send({ kind: 'syncNow' })).toEqual({ ok: false, error: 'failed' })
  })

  it('walks the steps and gives the security key page of the second step', async () => {
    expect(await h.ok({ kind: 'securityKeyChallenge' }, setup)).toBeNull()
    await h.ok(
      { kind: 'signInKemlock', server: 'https://k.example', email: 'second@x.y', password: 'p' },
      setup,
    )
    expect(await h.ok({ kind: 'securityKeyChallenge' }, setup)).toMatchObject({
      domain: 'https://k.example',
      path: '/kem/v1/webauthn',
    })
    expect(
      await h.ok(
        {
          kind: 'answerStep',
          answer: { step: 'second', method: 'email', code: '', remember: false },
        },
        setup,
      ),
    ).toMatchObject({ step: 'done' })
    expect(await h.ok({ kind: 'syncStatus' })).toMatchObject({ place: 'kemlock' })
    await h.ok({ kind: 'signOut' })
    expect(await h.ok({ kind: 'syncStatus' })).toBeNull()
  })

  it('confirms removals', async () => {
    await signIn()
    expect(await h.ok<SyncStatus>({ kind: 'confirmRemovals' })).toMatchObject({ place: 'kemlock' })
  })

  it('stops a run that would remove much, and answers Keep or Remove', async () => {
    await signIn()
    h.core.guard = { count: 6, scope: 22, items: [{ name: 'GitHub', kind: 'code' }] }
    expect(await h.ok<SyncStatus>({ kind: 'syncNow' })).toMatchObject({
      problem: 'removals',
      pendingRemovals: 6,
      scopeSize: 22,
      pendingRemovalItems: [{ name: 'GitHub', kind: 'code' }],
    })

    // Keep runs once with nothing removed, and the stop clears
    const kept = await h.ok<SyncStatus>({ kind: 'keepRemovals' })
    expect(kept.problem).toBeUndefined()
    expect(kept.pendingRemovals).toBeUndefined()
    expect(h.core.guardAnswer).toBe('keep')
    expect(h.core.calls).toContain('keepRemovals')

    h.core.guard = { count: 6, scope: 22 }
    await h.ok({ kind: 'syncNow' })
    expect(await h.ok<SyncStatus>({ kind: 'confirmRemovals' })).toMatchObject({ place: 'kemlock' })
    expect(h.core.guardAnswer).toBe('remove')
  })

  it('keeps the removal answers for the extension pages', async () => {
    await signIn()
    expect(await h.send({ kind: 'keepRemovals' }, content('https://x.example'))).toEqual({
      ok: false,
      error: 'refused',
    })
  })

  it('changes the settings, and the idle time with them', async () => {
    expect(await h.ok({ kind: 'saveSettings', settings: { autoLockMinutes: 15 } })).toMatchObject({
      autoLockMinutes: 15,
    })
    expect(await h.ok({ kind: 'settings' })).toMatchObject({
      autoLockMinutes: 15,
      clipboardSeconds: 30,
    })
    vi.setSystemTime(start + 6 * 60_000)
    await h.bg.onAlarm({ name: idleAlarm })
    expect((await h.core.state()).unlocked).toBe(true)
  })
})

describe("Kemlock Server's SSO and passkeys", () => {
  const server = 'https://k.example'

  it('sign in as the password does, and the first sync runs', async () => {
    expect(
      await h.ok({ kind: 'signInKemlockSso', server, email: 'me@k.example' }, setup),
    ).toMatchObject({ step: 'done', status: { place: 'kemlock', account: 'me@k.example' } })
    expect(h.core.calls).toContain('signInKemlockSso')
    expect((await h.ok<SyncStatus>({ kind: 'syncStatus' })).lastSync).toBeDefined()
    await h.ok({ kind: 'signOut' })

    expect(await h.ok({ kind: 'signInKemlockPasskey', server }, setup)).toMatchObject({
      step: 'done',
      status: { place: 'kemlock' },
    })
    expect(h.core.calls).toContain('signInKemlockPasskey')
  })

  it('go on to the steps the account asks (approval, master password) without a first sync', async () => {
    h.core.waysStep = { step: 'masterPassword' }
    expect(await h.ok({ kind: 'signInKemlockSso', server }, setup)).toEqual({
      step: 'masterPassword',
    })
    h.core.waysStep = { step: 'approval', phrase: ['a', 'b', 'c', 'd', 'e'], requestId: 'r1' }
    expect(await h.ok({ kind: 'signInKemlockPasskey', server }, setup)).toMatchObject({
      step: 'approval',
    })
  })

  it("name this extension's id when the server does not list it", async () => {
    h.core.waysStep = { step: 'error', problem: 'ssoRedirect' }
    expect(await h.ok({ kind: 'signInKemlockSso', server }, setup)).toEqual({
      step: 'error',
      problem: 'ssoRedirect',
      message: 'kemlockid',
    })
  })

  it('refuse an address that is not secure, and a sender that is not an extension page', async () => {
    expect(await h.send({ kind: 'signInKemlockSso', server: '' }, setup)).toEqual({
      ok: false,
      error: 'malformed',
    })
    expect(
      await h.send({ kind: 'signInKemlockPasskey', server }, content('https://x.example')),
    ).toEqual({
      ok: false,
      error: 'refused',
    })
  })
})

describe("the browser's events", () => {
  it('forget a tab that closed, and the frames of one that went on', async () => {
    await report(h, orbit, loginFields)
    await h.bg.onTabUpdated(7, { status: 'loading', url: 'https://example.org/' })
    expect((await h.bg['d'].tabs.get(7)).frames).toEqual({})
    await report(h, orbit, loginFields)
    await h.bg.onTabRemoved(7)
    expect(await h.bg['d'].tabs.tabIds()).toEqual([])
  })

  it('make the menu and register the script held by the access on install', async () => {
    h.mock.granted.add('<all_urls>')
    await h.bg.setup()
    expect(h.mock.menus.size).toBe(4)
    expect(h.mock.registered.size).toBe(1)
  })
})

describe('what the popup asks besides', () => {
  it('gives the code each one will show once its period ends', async () => {
    const [code] = await codes()
    const [now] = await h.ok<{ code: string; expiresAt: number }[]>({
      kind: 'liveCodes',
      ids: [code.id],
    })
    const [next] = await h.ok<{ id: string; code: string; expiresAt: number }[]>({
      kind: 'nextCodes',
      ids: [code.id, 'unknown'],
    })
    expect(next.id).toBe(code.id)
    expect(next.expiresAt).toBe(now.expiresAt + 30_000)
    expect(next.code).toBe(
      await codeFor(decodeBase32('JBSWY3DPEHPK3PXP'), Math.floor(start / 30_000) + 1, 6, 'totp'),
    )
  })

  it('marks a backup code used and copies that same code, in either order', async () => {
    const left = async () => (await h.ok<{ left: number }[]>({ kind: 'backupCodes' }))[0].left
    await h.ok({ kind: 'useBackupCode', serviceId: 'orbit' })
    await h.ok({ kind: 'copy', what: 'backupCode', id: 'orbit' })
    expect(h.clipboard.text).toBe('1111-2222')
    expect(await left()).toBe(2)
    await h.ok({ kind: 'copy', what: 'backupCode', id: 'orbit' })
    await h.ok({ kind: 'useBackupCode', serviceId: 'orbit' })
    expect(h.clipboard.text).toBe('3333-4444')
    expect(await left()).toBe(1)
  })

  it('lists the sites a login was picked for, and forgets one', async () => {
    const [login] = await logins()
    await report(h, 'https://id.orbitauth.net/login', loginFields)
    await h.ok({ kind: 'openMenu', fieldId: 'u' }, content('https://id.orbitauth.net/login'))
    await h.ok(
      {
        kind: 'fill',
        tabId: 7,
        frameId: 0,
        fieldId: 'u',
        loginId: login.id,
        remember: true,
        picked: true,
      },
      menuFrame,
    )
    expect(await h.ok({ kind: 'rememberedSites', loginId: login.id })).toEqual(['id.orbitauth.net'])
    await h.ok({ kind: 'forgetSite', loginId: login.id, host: 'id.orbitauth.net' })
    expect(await h.ok({ kind: 'rememberedSites', loginId: login.id })).toEqual([])
  })

  it('trusts no pick a page writes into storage.local, and keeps none there itself', async () => {
    const [login] = await logins()
    const evil = 'https://evil.example/login'
    const before = await siteMatch(h.core, evil)
    // A compromised page's content script may write storage.local; the picks are not read from it
    h.mock.local.set('kemlock_picks', { 'evil.example': [login.id] })
    expect(await siteMatch(h.core, evil)).toEqual(before)
    expect((await siteMatch(h.core, evil)).logins).not.toContain(login.id)
    expect(await h.ok({ kind: 'rememberedSites', loginId: login.id })).toEqual([])
    // A pick made by the person goes to the core, and to nothing a page can read
    h.mock.local.clear()
    await report(h, 'https://id.orbitauth.net/login', loginFields)
    await h.ok({ kind: 'openMenu', fieldId: 'u' }, content('https://id.orbitauth.net/login'))
    await h.ok(
      {
        kind: 'fill',
        tabId: 7,
        frameId: 0,
        fieldId: 'u',
        loginId: login.id,
        remember: true,
        picked: true,
      },
      menuFrame,
    )
    expect(h.mock.local.has('kemlock_picks')).toBe(false)
    expect(await h.ok({ kind: 'rememberedSites', loginId: login.id })).toEqual(['id.orbitauth.net'])
  })

  it('has no picks while the vault is locked', async () => {
    const [login] = await logins()
    await h.ok({ kind: 'lock' })
    await expect(h.core.picks('id.orbitauth.net')).rejects.toThrow()
    expect(await h.send({ kind: 'rememberedSites', loginId: login.id })).toEqual({
      ok: false,
      error: 'locked',
    })
  })

  it('answers locked to each of them while the vault is locked', async () => {
    await h.ok({ kind: 'lock' })
    for (const message of [
      { kind: 'nextCodes', ids: ['a'] },
      { kind: 'useBackupCode', serviceId: 'orbit' },
      { kind: 'rememberedSites', loginId: 'a' },
      { kind: 'forgetSite', loginId: 'a', host: 'a.example' },
      { kind: 'copy', what: 'backupCode', id: 'orbit' },
      { kind: 'fill', tabId: 7, loginId: 'a' },
      { kind: 'generate', options: { mode: 'random' } },
      { kind: 'recentPasswords' },
      { kind: 'addCodeFromTab', tabId: 7 },
    ])
      expect(await h.send(message), message.kind).toEqual({ ok: false, error: 'locked' })
  })

  it('drops a recently generated password once a saved login holds it', async () => {
    Object.assign(h.core, { addRecentPassword: undefined, recentPasswords: undefined })
    await h.ok({ kind: 'copy', what: 'generated', id: '', value: 'x' })
    await report(h, 'https://harbornotes.app/up', [{ id: 'n', kind: 'newPassword' }])
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content('https://harbornotes.app/up'))
    await h.ok(
      { kind: 'fill', tabId: 7, frameId: 0, fieldId: 'n', newPassword: 'Gen-Pass-77!' },
      menuFrame,
    )
    expect(await h.ok<{ value: string }[]>({ kind: 'recentPasswords' })).toMatchObject([
      { value: 'Gen-Pass-77!' },
    ])
    await h.ok({
      kind: 'saveLogin',
      id: null,
      input: {
        name: 'Harbor',
        username: 'sam',
        password: 'Gen-Pass-77!',
        websites: ['harbornotes.app'],
      },
    })
    expect(await h.ok({ kind: 'recentPasswords' })).toEqual([])
  })
})

describe('what the content script and the menu picker add', () => {
  it('tells a content script its tab and frame', async () => {
    expect(await h.ok({ kind: 'frame' }, content(orbit, 7, 3))).toEqual({ tabId: 7, frameId: 3 })
    expect(await h.send({ kind: 'frame' }, popup)).toEqual({ ok: false, error: 'refused' })
  })

  it('lets the menu list the whole vault for its picker only while one is open for its tab', async () => {
    const [login] = await logins()
    for (const message of [
      { kind: 'codes' },
      { kind: 'logins' },
      { kind: 'rememberedSites', loginId: login.id },
    ])
      expect(await h.send(message, menuFrame), message.kind).toEqual({
        ok: false,
        error: 'refused',
      })
    await report(h, 'https://example.org/login', loginFields)
    await h.ok({ kind: 'openMenu', fieldId: 'u' }, content('https://example.org/login'))
    expect(await h.ok<LoginView[]>({ kind: 'logins' }, menuFrame)).toHaveLength(1)
    expect(await h.ok<CodeView[]>({ kind: 'codes' }, menuFrame)).toHaveLength(1)
    expect(await h.ok({ kind: 'rememberedSites', loginId: login.id }, menuFrame)).toEqual([])
    await h.ok({ kind: 'lock' })
    expect(await h.send({ kind: 'logins' }, menuFrame)).toEqual({ ok: false, error: 'refused' })
  })

  it('keeps a sign-up whose password comes as the new one alone', async () => {
    const url = 'https://harbornotes.app/sign-up'
    await h.ok(
      { kind: 'sent', username: 'sam', password: '', newPassword: 'Harbor-Pass-2026' },
      content(url),
    )
    expect(await h.ok({ kind: 'pendingSave', tabId: 7 })).toEqual({
      site: 'harbornotes.app',
      username: 'sam',
    })
    await h.ok({ kind: 'answerSave', tabId: 7, save: true })
    expect(
      await h.ok({
        kind: 'showPassword',
        id: (await logins()).find((l) => l.username === 'sam')!.id,
      }),
    ).toBe('Harbor-Pass-2026')
  })

  it('joins the two steps of a sign-in, in either order, of one site', async () => {
    const url = 'https://harbornotes.app/sign-in'
    await h.ok({ kind: 'sent', username: 'sam', password: '' }, content(url))
    expect(await h.ok({ kind: 'pendingSave', tabId: 7 })).toBeNull()
    // The username alone is not dropped while it waits, however soon the prompt looks
    await vi.advanceTimersByTimeAsync(3000)
    expect(
      h.mock.sentToTabs.filter((s) => (s.message as { kind: string }).kind === 'savePrompt'),
    ).toEqual([])
    await h.ok(
      { kind: 'sent', username: '', password: 'Harbor-Pass-2026' },
      content('https://harbornotes.app/password'),
    )
    expect(await h.ok({ kind: 'pendingSave', tabId: 7 })).toEqual({
      site: 'harbornotes.app',
      username: 'sam',
    })
    // Another site's second step does not join
    await h.ok({ kind: 'sent', username: 'alex', password: '' }, content(url))
    await h.ok(
      { kind: 'sent', username: '', password: 'Other-Pass-2026' },
      content('https://evil.test/'),
    )
    expect(await h.ok({ kind: 'pendingSave', tabId: 7 })).toEqual({
      site: 'evil.test',
      username: '',
    })
  })
})
