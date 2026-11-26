// The browser-popup spec: the site in front, live codes, search, copying, the generator, health,
// settings, "Add an MFA code" and the toolbar icon. The popup is opened as a tab (see Kemlock.popup).
import type { Page } from '@playwright/test'
import { expect, ORBIT, test, type Kemlock } from './kemlock'
import { hosts } from './hosts'
import { totp, totpNear } from './otp'
import { codeShownIn, control, openSection, row, search, toggle } from './ui'

const PASTED = 'otpauth://totp/Orbit:sam?secret=JBSWY3DPEHPK3PXP&issuer=Orbit'

test.describe('the popup', () => {
  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
  })

  test('the site in front comes first, with its login and code, and fills the tab', async ({
    kemlock,
  }) => {
    await kemlock.seedOrbit()
    const site = await kemlock.visit(hosts.orbit, '/signin')
    const popup = await kemlock.popup(site)

    // A card for Orbit Cloud: the login, its password as dots, the linked code
    await expect(popup.getByText(ORBIT.name).first()).toBeVisible()
    await expect(popup.getByText(ORBIT.username).first()).toBeVisible()
    await expect(popup.getByText(ORBIT.password)).toHaveCount(0)
    expect(totpNear(ORBIT.secret)).toContain(await codeShownIn(row(popup, ORBIT.name)))
    await expect(control(popup, /fill MFA code/i)).toBeVisible()

    // Nothing was filled by itself
    await expect(site.getByLabel('Email')).toHaveValue('')
    await control(popup, /fill login/i).click()
    await expect(site.getByLabel('Email')).toHaveValue(ORBIT.username)
    await expect(site.getByLabel('Password')).toHaveValue(ORBIT.password)
    // The password was typed into the page, nothing else of the account was
    expect(await site.evaluate(() => document.documentElement.outerHTML)).not.toContain(
      ORBIT.secret,
    )
  })

  test('a site that matches nothing opens on the lists, without a card', async ({ kemlock }) => {
    await kemlock.seedOrbit()
    const site = await kemlock.visit(hosts.harbor, '/signin')
    const popup = await kemlock.popup(site)
    await expect(popup.getByText(ORBIT.name).first()).toBeVisible()
    await expect(control(popup, /fill login/i)).toHaveCount(0)
  })

  test('codes are live: the digits are the ones the secret gives, and they change', async ({
    kemlock,
  }) => {
    test.slow()
    await kemlock.seedOrbit()
    const popup = await kemlock.popup()
    const shown = () => codeShownIn(row(popup, ORBIT.name))
    const first = await shown()
    expect(totpNear(ORBIT.secret)).toContain(first)
    // Within one period the list shows the next code, without the popup being reloaded
    await expect.poll(shown, { timeout: 40_000, intervals: [1000] }).not.toBe(first)
    expect(totp(ORBIT.secret)).toBe(await shown())
  })

  test('search matches names, usernames and websites, and says when nothing does', async ({
    kemlock,
  }) => {
    await kemlock.seedOrbit()
    await kemlock.call('saveLogin', {
      id: null,
      input: {
        name: 'Linear',
        username: 'sam@work.example',
        password: 'Lin3ar-pw-!',
        websites: ['linear.app'],
      },
    })
    const popup = await kemlock.popup()
    await openSection(popup, 'Logins')
    await expect(popup.getByText('Linear').first()).toBeVisible()

    await search(popup).fill('orbit')
    await expect(popup.getByText(ORBIT.name).first()).toBeVisible()
    await expect(popup.getByText('Linear')).toHaveCount(0)
    await search(popup).fill('ORBIT-CLOUD.COM')
    await expect(popup.getByText(ORBIT.name).first()).toBeVisible()
    await search(popup).fill('work.example')
    await expect(popup.getByText('Linear').first()).toBeVisible()
    await search(popup).fill('zzzz')
    await expect(
      popup.getByText(/no (match|result)|nothing (found|matches)|not found/i).first(),
    ).toBeVisible()
  })

  test('copying puts the code and the password on the clipboard', async ({ kemlock }) => {
    await kemlock.seedOrbit()
    const popup = await kemlock.popup()
    await row(popup, ORBIT.name).getByRole('button', { name: /copy/i }).first().click()
    // Copying is the background's work: the clipboard is read until it holds what was copied
    await expect
      .poll(async () => totpNear(ORBIT.secret).includes(await kemlock.clipboard()))
      .toBe(true)

    await popup.bringToFront()
    await openSection(popup, 'Logins')
    // "Clicking a login copies its password"
    await row(popup, ORBIT.name).getByText(ORBIT.name).first().click()
    await expect.poll(() => kemlock.clipboard()).toBe(ORBIT.password)
  })

  test("the generator makes the app's passwords and remembers its length", async ({ kemlock }) => {
    const popup = await kemlock.popup()
    await openSection(popup, 'Generator')
    // Random, 20 characters by default
    const output = popup
      .locator('output, [data-testid="generated"], [aria-label*="generated" i], code, pre')
      .first()
    await expect(output).toHaveText(/^\S{20}$/)

    const length = popup.getByLabel(/length/i).first()
    await length.fill('32')
    await control(popup, /generate|refresh|new/i).click()
    await expect(output).toHaveText(/^\S{32}$/)

    // The choice is remembered, and not synced
    await popup.reload()
    await openSection(popup, 'Generator')
    await expect(popup.getByLabel(/length/i).first()).toHaveValue('32')

    // Passphrase: five words by default
    await control(popup, /passphrase/i).click()
    const words = ((await output.innerText()).match(/[A-Za-z]+/g) ?? []).length
    expect(words).toBeGreaterThanOrEqual(5)
  })

  test('health tags reused and weak passwords and logins without their code', async ({
    kemlock,
  }) => {
    const { loginId } = await kemlock.seedOrbit()
    const shared = ORBIT.password
    const linear = await kemlock.call('saveLogin', {
      id: null,
      input: { name: 'Linear', username: 'sam', password: shared, websites: ['linear.app'] },
    })
    const github = await kemlock.call('saveLogin', {
      id: null,
      input: {
        name: 'GitHub login',
        username: 'sam',
        password: 'Z8#kq!vN2m$Lp4xR',
        websites: ['github.com'],
      },
    })
    expect(loginId).not.toBe(linear.id)
    const popup = await kemlock.popup()
    await openSection(popup, 'Logins')
    // The counts row, as the spec words it
    await expect(popup.getByText(/password health/i).first()).toBeVisible()
    await expect(popup.getByText(/2 reused/i).first()).toBeVisible()
    await expect(popup.getByText(/1 without its MFA code/i).first()).toBeVisible()
    await expect(
      row(popup, 'Linear')
        .getByText(/reused/i)
        .first(),
    ).toBeVisible()
    await expect(
      row(popup, ORBIT.name)
        .getByText(/reused/i)
        .first(),
    ).toBeVisible()

    // "Don't warn for this login" stops the tag, and the count
    await kemlock.call('ignoreHealth', { id: github.id, ignored: true })
    await popup.reload()
    await openSection(popup, 'Logins')
    await expect(popup.getByText(/without its MFA code/i)).toHaveCount(0)
  })

  test('settings are saved, and nothing asks for Premium', async ({ kemlock }) => {
    const popup = await kemlock.popup()
    await openSection(popup, 'Settings')
    const offer = toggle(popup, /offer to save/i)
    await expect(offer).toBeChecked()
    await offer.click()
    await expect.poll(async () => (await kemlock.call('settings')).offerToSave).toBe(false)

    await popup.reload()
    await openSection(popup, 'Settings')
    await expect(toggle(popup, /offer to save/i)).not.toBeChecked()
    for (const section of ['MFA codes', 'Logins', 'Generator', 'Settings'] as const) {
      // Generator and Settings are pages over Home; the lists are on Home itself
      await popup.reload()
      await openSection(popup, section)
      await expect(popup.getByText(/premium|upgrade|subscribe/i)).toHaveCount(0)
    }
  })

  test.describe('Add an MFA code', () => {
    const qr = (uri?: string) => `/qr${uri ? `?uri=${encodeURIComponent(uri)}` : ''}`

    // "Add an MFA code" reads what the tab in front shows. The popup is a tab here, so the site is put in
    // front again, as it is behind the toolbar's popup, before the popup is asked.
    const addAnMfaCode = async (popup: Page, site: Page) => {
      await site.bringToFront()
      await control(popup, /add an MFA code/i).click()
    }

    test('a pasted link adds the code', async ({ kemlock }) => {
      const popup = await kemlock.popup()
      await control(popup, /add an MFA code/i).click()
      await popup
        .getByRole('textbox', { name: /link|otpauth|paste/i })
        .or(popup.getByPlaceholder(/otpauth/i))
        .first()
        .fill(PASTED)
      await control(popup, /^add$/i).click()
      await expect
        .poll(async () => (await kemlock.call('codes')).map((c) => c.issuer))
        .toContain('Orbit')
      // The code is added, and listed once the person is done
      await control(popup, /^done$/i).click()
      await expect(row(popup, 'Orbit').first()).toBeVisible()
    })

    test("a QR code on the page adds the account with the page's site as its website", async ({
      kemlock,
    }) => {
      const site = await kemlock.visit(hosts.harbor, qr())
      const popup = await kemlock.popup(site)
      await addAnMfaCode(popup, site)
      await expect(popup.getByText('Harbor Notes').first()).toBeVisible({ timeout: 20_000 })
      await control(popup, /^add$/i).click()
      await expect.poll(async () => (await kemlock.call('codes')).length).toBe(1)
      const [added] = await kemlock.call('codes')
      expect(added).toMatchObject({ issuer: 'Harbor Notes', account: 'alex@harbornotes.app' })
      expect(added.websites).toContain('harbornotes.app')
    })

    test('a QR code that holds only an address adds nothing', async ({ kemlock }) => {
      const site = await kemlock.visit(hosts.harbor, qr('https://example.com/not-a-code'))
      const popup = await kemlock.popup(site)
      await addAnMfaCode(popup, site)
      await expect(
        popup.getByText(/no (MFA )?code (was )?found|couldn.t find an? (MFA )?code/i).first(),
      ).toBeVisible({ timeout: 20_000 })
      expect(await kemlock.call('codes')).toEqual([])
    })

    test('a code already in the vault is named, not added twice', async ({ kemlock }) => {
      await kemlock.call('addCodeFromLink', {
        otpauth:
          'otpauth://totp/Harbor%20Notes:alex@harbornotes.app?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Harbor%20Notes',
      })
      const site = await kemlock.visit(hosts.harbor, qr())
      const popup = await kemlock.popup(site)
      await addAnMfaCode(popup, site)
      await expect(popup.getByText(/already/i).first()).toBeVisible({ timeout: 20_000 })
      await expect(popup.getByText('Harbor Notes').first()).toBeVisible()
      expect(await kemlock.call('codes')).toHaveLength(1)
    })

    test("the add step offers to link the code to the site's login", async ({ kemlock }) => {
      const login = await kemlock.call('saveLogin', {
        id: null,
        input: {
          name: 'Harbor Notes',
          username: 'alex@harbornotes.app',
          password: 'Harb0r-pw-!!',
          websites: ['harbornotes.app'],
        },
      })
      const site = await kemlock.visit(hosts.harbor, qr())
      const popup = await kemlock.popup(site)
      await addAnMfaCode(popup, site)
      await expect(popup.getByText(/link to the harbor notes login/i).first()).toBeVisible({
        timeout: 20_000,
      })
      await toggle(popup, /link to the harbor notes login/i)
        .check()
        .catch(() => control(popup, /link to the harbor notes login/i).click())
      await control(popup, /^add$/i).click()
      await expect
        .poll(async () => (await kemlock.call('logins')).find((l) => l.id === login.id)?.codeId)
        .toBeTruthy()
    })
  })

  test.describe('the toolbar icon', () => {
    const badge = (kemlock: Kemlock, tabId: number) =>
      kemlock.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)

    test('counts the matches of the site in front, and warns on a look-alike', async ({
      kemlock,
    }) => {
      await kemlock.seedOrbit()
      const site = await kemlock.visit(hosts.orbit, '/signin')
      const siteId = await kemlock.tabId(site)
      await expect.poll(() => badge(kemlock, siteId)).toMatch(/^[1-9]\d*$/)

      const lookAlike = await kemlock.visit(hosts.lookAlike, '/signin')
      const lookAlikeId = await kemlock.tabId(lookAlike)
      await expect.poll(() => badge(kemlock, lookAlikeId)).toBe('!')
    })

    test('shows nothing while locked', async ({ kemlock }) => {
      await kemlock.seedOrbit()
      const site = await kemlock.visit(hosts.orbit, '/signin')
      const siteId = await kemlock.tabId(site)
      await expect.poll(() => badge(kemlock, siteId)).toMatch(/^[1-9]\d*$/)
      await kemlock.call('lock')
      await expect.poll(() => badge(kemlock, siteId)).toBe('')
    })
  })
})
