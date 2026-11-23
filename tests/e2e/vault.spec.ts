// The browser-vault spec: a vault of its own, sealed, open only while it is used.
import { EXTENSION_ID } from './extension-key'
import { expect, ORBIT, PASSWORD, test } from './kemlock'
import {
  chooseOption,
  control,
  expectLocked,
  lockNow,
  openSection,
  passwordBoxes,
  removeFromBrowser,
  setBrowserPassword,
  unlockWith,
} from './ui'

const HARBOR_LINK =
  'otpauth://totp/Harbor%20Notes:alex@harbornotes.app?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Harbor%20Notes'

test.describe('the browser vault', () => {
  test('the extension loads under the fixed id the tests give it', async ({ kemlock }) => {
    expect(kemlock.id).toBe(EXTENSION_ID)
    expect((await kemlock.call('popup')).state).toMatchObject({ exists: false, unlocked: false })
  })

  test('setup asks for a password twice and makes the vault', async ({ kemlock }) => {
    const setup = await kemlock.setup()
    await expect(setup.getByText(/a password for this browser/i)).toBeVisible()

    // Two different passwords: setup doesn't continue, and says so
    await setBrowserPassword(setup, PASSWORD, `${PASSWORD} but different`)
    await expect(setup.getByText(/(don.t|do not|doesn.t) match|not the same/i)).toBeVisible()
    expect((await kemlock.call('popup')).state.exists).toBe(false)

    await passwordBoxes(setup).nth(1).fill(PASSWORD)
    await control(setup, /continue|next|create/i).click()
    await expect.poll(async () => (await kemlock.call('popup')).state.exists).toBe(true)
  })

  test('the stored vault holds no item in the clear', async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
    await kemlock.call('addCodeFromLink', { otpauth: HARBOR_LINK })
    const secrets = [
      ORBIT.name,
      ORBIT.username,
      ORBIT.password,
      ORBIT.website,
      ORBIT.secret,
      'Harbor Notes',
      'alex@harbornotes.app',
      'harbornotes.app',
      'GEZDGNBVGY3TQOJQ',
    ]
    // What the browser's own API reads...
    const stored = JSON.stringify(await kemlock.storage())
    for (const secret of secrets)
      expect(stored, `storage.local holds ${secret}`).not.toContain(secret)
    // ...and what is on the disk of the profile
    expect(await kemlock.scanProfile(secrets)).toEqual([])
  })

  test('lock now locks, and the right password opens it again', async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
    const popup = await kemlock.popup()
    await expect(popup.getByText(ORBIT.name).first()).toBeVisible()

    await lockNow(popup)
    await expectLocked(popup)
    // Nothing of the vault shows while locked: not the popup, not the badge
    await expect(popup.getByText(ORBIT.name)).toHaveCount(0)
    expect(await kemlock.worker.evaluate(() => chrome.action.getBadgeText({}))).toBe('')
    expect((await kemlock.call('popup')).state.unlocked).toBe(false)

    await unlockWith(popup, PASSWORD)
    await expect(popup.getByText(ORBIT.name).first()).toBeVisible()
    expect((await kemlock.call('popup')).state.unlocked).toBe(true)
  })

  test('wrong passwords are counted, shown on reopening, and cleared by the right one', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    await kemlock.call('lock')
    let popup = await kemlock.popup()
    await expectLocked(popup)
    // The lock screen says that sync brings the items back after a forgotten password
    await expect(popup.getByText(/sync/i).first()).toBeVisible()

    for (const wrong of ['nope 1', 'nope 2', 'nope 3']) {
      await unlockWith(popup, wrong)
      await expect(
        popup.getByText(/wrong|incorrect|isn.t right|not the right/i).first(),
      ).toBeVisible()
    }
    // The popup is closed and opened again: the count and the time are still there
    await popup.close()
    popup = await kemlock.popup()
    await expect(popup.getByText(/3 (wrong|incorrect)/i)).toBeVisible()
    expect((await kemlock.call('popup')).state).toMatchObject({ wrongPasswords: 3 })

    await unlockWith(popup, PASSWORD)
    // It says once how many there were...
    await expect(popup.getByText(/3 (wrong|incorrect)/i)).toBeVisible()
    expect((await kemlock.call('popup')).state).toMatchObject({ unlocked: true, wrongPasswords: 0 })
    // ...and not again
    await popup.reload()
    await expect(popup.getByText(/3 (wrong|incorrect)/i)).toHaveCount(0)
  })

  test('the vault stays open when the service worker is stopped', async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
    await kemlock.stopWorker()
    await expect.poll(() => kemlock.context.serviceWorkers().length).toBe(0)
    // The next request wakes it, and finds the keys in the session storage
    const { state } = await kemlock.call('popup')
    expect(state).toMatchObject({ exists: true, unlocked: true })
    expect((await kemlock.call('logins')).map((l) => l.name)).toContain(ORBIT.name)
  })

  test('closing the browser locks the vault, and the vault is still there', async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
    await kemlock.restart()
    const { state } = await kemlock.call('popup')
    expect(state).toMatchObject({ exists: true, unlocked: false })
    const popup = await kemlock.popup()
    await expectLocked(popup)
    await unlockWith(popup, PASSWORD)
    expect((await kemlock.call('logins')).map((l) => l.name)).toContain(ORBIT.name)
  })

  test('it locks after the idle time chosen in Settings', async ({ kemlock }) => {
    test.setTimeout(240_000)
    await kemlock.createVault()
    const popup = await kemlock.popup()
    await openSection(popup, 'Settings')
    await chooseOption(popup.getByLabel(/auto.?lock|lock after|idle/i).first(), /^1\s*min/i)
    await expect.poll(async () => (await kemlock.call('settings')).autoLockMinutes).toBe(1)
    // Nothing of Kemlock is used from here on: the popup is closed, and the wait is the minute
    // plus the browser's alarm granularity. A request to the background would count as use.
    await popup.close()
    await kemlock.closeBridge()
    await new Promise((resolve) => setTimeout(resolve, 100_000))
    const { state } = await kemlock.call('popup')
    expect(state.unlocked).toBe(false)
  })

  test('Remove Kemlock from this browser empties its storage and reopens setup', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
    for (const page of kemlock.context.pages()) {
      if (page.url().includes('/src/setup/')) await page.close()
    }
    const popup = await kemlock.popup()
    await openSection(popup, 'Settings')
    await removeFromBrowser(popup)

    await expect
      .poll(() => kemlock.context.pages().some((p) => p.url().includes('/src/setup/')))
      .toBe(true)
    await expect
      .poll(async () =>
        Object.keys(await kemlock.storage()).filter((key) => key.startsWith('backmycodes_')),
      )
      .toEqual([])
    expect((await kemlock.call('popup')).state.exists).toBe(false)
  })
})
