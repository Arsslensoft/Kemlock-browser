// The browser-autofill spec, on fixture pages served at the names a person would browse to.
// Menus are opened with the down arrow in a field (spec: "or pressing the down arrow"), because
// Kemlock's button is drawn in a closed shadow root that no selector reaches; `hasButton` finds it
// by what is drawn over the field. Items are clicked only after the click gate's half second.
import { expect, GATE_MS, menuItem, ORBIT, test, type Kemlock } from './kemlock'
import { hosts } from './hosts'
import { totpNear } from './otp'
import { control, toggle } from './ui'
import type { Frame, Page } from '@playwright/test'

const email = (page: Page | Frame) => page.getByLabel('Email')
const password = (page: Page | Frame) => page.getByLabel('Password', { exact: true })

/** Opens the field's menu, waits out the click gate, and picks the item. */
async function pick(
  kemlock: Kemlock,
  page: Page,
  field: ReturnType<Page['locator']>,
  item: string | RegExp = ORBIT.name,
) {
  const menu = await kemlock.openMenu(page, field)
  await page.waitForTimeout(GATE_MS)
  await menuItem(menu, item).click()
  return menu
}

const UNKNOWN_SITE = /doesn.t know this site/i

test.describe('autofill, with access to all sites', () => {
  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
  })

  test.describe('buttons and menus', () => {
    test('recognised fields get a button, other fields do not, and the switch turns them off', async ({
      kemlock,
    }) => {
      const page = await kemlock.visit(hosts.orbit, '/signin')
      await expect.poll(() => kemlock.hasButton(page, email(page))).toBe(true)
      expect(await kemlock.hasButton(page, password(page))).toBe(true)

      const code = await kemlock.visit(hosts.orbit, '/code')
      await expect.poll(() => kemlock.hasButton(code, code.locator('#otp'))).toBe(true)
      // A recovery code is another kind of code: no button, and never a one-time code
      expect(await kemlock.hasButton(code, code.locator('#recovery'))).toBe(false)

      await kemlock.call('saveSettings', { settings: { buttonsOnPages: false } })
      await page.reload()
      await page.waitForTimeout(1500)
      expect(await kemlock.hasButton(page, email(page))).toBe(false)
      expect(await kemlock.hasButton(page, password(page))).toBe(false)
    })

    test("the menu lists the site's login, is read by neither the page nor its script, and nothing fills by itself", async ({
      kemlock,
      site,
    }) => {
      const page = await kemlock.visit(hosts.orbit, '/signin')
      await expect(email(page)).toHaveValue('')
      const menu = await kemlock.openMenu(page, email(page))
      await expect(menuItem(menu, ORBIT.name)).toBeVisible()
      await expect(menu.getByText(ORBIT.username).first()).toBeVisible()

      // The page's own script reads its document, and every frame it can reach: no sign of the menu
      const readable = await page.evaluate(() => {
        const frames = [...document.querySelectorAll('iframe')].map((f) => {
          try {
            return f.contentDocument?.body.innerText ?? ''
          } catch {
            return ''
          }
        })
        return [document.documentElement.outerHTML, document.body.innerText, ...frames].join('\n')
      })
      expect(readable).not.toContain(ORBIT.name)
      expect(readable).not.toContain(ORBIT.username)
      // The fields are still empty: the menu was opened, nothing was picked, nothing was sent
      await expect(email(page)).toHaveValue('')
      await expect(password(page)).toHaveValue('')
      expect(site.posts).toEqual([])
    })

    test('picking the login fills the form on its own site', async ({ kemlock, site }) => {
      const page = await kemlock.visit(hosts.orbit, '/signin')
      await pick(kemlock, page, email(page))
      await expect(email(page)).toHaveValue(ORBIT.username)
      await expect(password(page)).toHaveValue(ORBIT.password)
      // Filling is not sending
      expect(site.posts).toEqual([])
    })

    test('several logins for one site are each listed, by username', async ({ kemlock }) => {
      await kemlock.call('saveLogin', {
        id: null,
        input: {
          name: 'Orbit Cloud',
          username: 'work@example.com',
          password: 'Work-pw-12345!',
          websites: ['orbit-cloud.com'],
        },
      })
      const page = await kemlock.visit(hosts.orbit, '/signin')
      const menu = await kemlock.openMenu(page, email(page))
      await expect(menu.getByText(ORBIT.username).first()).toBeVisible()
      await expect(menu.getByText('work@example.com').first()).toBeVisible()
    })

    test('only visible fields are filled', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbit, '/hidden')
      await pick(kemlock, page, email(page))
      await expect(email(page)).toHaveValue(ORBIT.username)
      await expect(password(page)).toHaveValue(ORBIT.password)
      await expect(page.locator('#ghost')).toHaveValue('')
    })

    test('a field a script controls keeps the value (the value setter and the events)', async ({
      kemlock,
    }) => {
      const page = await kemlock.visit(hosts.orbit, '/controlled')
      await pick(kemlock, page, email(page))
      await expect(page.locator('#state')).toHaveText(`${ORBIT.username}|${ORBIT.password}`)
      await expect(email(page)).toHaveValue(ORBIT.username)
    })
  })

  test.describe('which site an item fills on', () => {
    test("another subdomain of the login's site is offered the login", async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbitApp, '/signin')
      const menu = await kemlock.openMenu(page, email(page))
      await expect(menuItem(menu, ORBIT.name)).toBeVisible()
      await expect(menu.getByText(UNKNOWN_SITE)).toHaveCount(0)
    })

    for (const host of [hosts.suffixTrick, hosts.endTrick]) {
      test(`${host} is not the login's site: the picker, and nothing fills`, async ({
        kemlock,
      }) => {
        const page = await kemlock.visit(host, '/signin')
        const menu = await kemlock.openMenu(page, email(page))
        await expect(menu.getByText(UNKNOWN_SITE).first()).toBeVisible()
        await expect(email(page)).toHaveValue('')
        await expect(password(page)).toHaveValue('')
      })
    }

    test('a shared suffix matches only exactly', async ({ kemlock }) => {
      await kemlock.call('saveLogin', {
        id: null,
        input: {
          name: 'Sam pages',
          username: 'sam',
          password: 'Sam-pages-pw-1!',
          websites: ['sam.github.io'],
        },
      })
      const sam = await kemlock.visit(hosts.samGithub, '/signin')
      const samMenu = await kemlock.openMenu(sam, email(sam))
      await expect(menuItem(samMenu, 'Sam pages')).toBeVisible()
      await expect(samMenu.getByText(UNKNOWN_SITE)).toHaveCount(0)

      const alex = await kemlock.visit(hosts.alexGithub, '/signin')
      const alexMenu = await kemlock.openMenu(alex, email(alex))
      await expect(alexMenu.getByText(UNKNOWN_SITE).first()).toBeVisible()
    })

    test('a field is judged by its own frame, not by the page around it', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbit, '/frame')
      await expect.poll(() => page.frames().some((f) => f.url().includes(hosts.evil))).toBe(true)
      const child = page.frames().find((f) => f.url().includes(hosts.evil))!
      await expect(email(child)).toBeVisible()
      await email(child).focus()
      await page.keyboard.press('ArrowDown')
      const menu = await kemlock.menu(page)
      await expect(menu.getByText(UNKNOWN_SITE).first()).toBeVisible()
      await expect(email(child)).toHaveValue('')
    })

    test('an unknown site offers a picker, and "Always suggest here" remembers the pick in this browser', async ({
      kemlock,
    }) => {
      const page = await kemlock.visit(hosts.orbitAuth, '/signin')
      let menu = await kemlock.openMenu(page, email(page))
      await expect(menu.getByText(UNKNOWN_SITE).first()).toBeVisible()
      await page.waitForTimeout(GATE_MS)
      await menuItem(menu, ORBIT.name).click()
      // The address it would fill (the site's registrable domain) is shown before anything is filled
      await expect(menu.getByText(/orbitauth\.net/i).first()).toBeVisible()
      await expect(email(page)).toHaveValue('')
      await toggle(menu, /always suggest here/i).check()
      await page.waitForTimeout(GATE_MS)
      await control(menu, /^(fill|confirm|yes|continue)/i).click()
      await expect(email(page)).toHaveValue(ORBIT.username)

      // From then on it is offered by name there
      await page.reload()
      menu = await kemlock.openMenu(page, email(page))
      await expect(menuItem(menu, ORBIT.name)).toBeVisible()
      await expect(menu.getByText(UNKNOWN_SITE)).toHaveCount(0)
    })
  })

  test.describe('the look-alike guard', () => {
    for (const [what, host] of [
      ['a digit for a letter', hosts.lookAlike],
      ['a Cyrillic letter', hosts.homograph],
    ] as const) {
      test(`${what} gets the guard, and "Don't fill" is the main action`, async ({ kemlock }) => {
        const page = await kemlock.visit(host, '/signin')
        const menu = await kemlock.openMenu(page, email(page))
        await expect(menu.getByText(/this isn.t orbit-cloud\.com/i).first()).toBeVisible()
        const dont = control(menu, /don.t fill/i)
        await expect(dont).toBeVisible()
        await page.waitForTimeout(GATE_MS)
        await dont.click()
        await expect(email(page)).toHaveValue('')
        await expect(password(page)).toHaveValue('')
      })
    }

    test('filling on a look-alike needs the login picked and the address confirmed', async ({
      kemlock,
    }) => {
      const page = await kemlock.visit(hosts.lookAlike, '/signin')
      const menu = await kemlock.openMenu(page, email(page))
      // The guard first: "Pick a login anyway", then the login, then the address it fills
      await control(menu, /pick a login anyway/i).click()
      await page.waitForTimeout(GATE_MS)
      await menuItem(menu, ORBIT.name).click()
      await expect(email(page)).toHaveValue('')
      await expect(menu.getByText(/orbit-c1oud\.com/).first()).toBeVisible()
      await page.waitForTimeout(GATE_MS)
      await control(menu, /^(fill|confirm|yes|continue)/i).click()
      await expect(email(page)).toHaveValue(ORBIT.username)
    })

    test('a different site with a similar name gets the picker, not the guard', async ({
      kemlock,
    }) => {
      await kemlock.call('saveLogin', {
        id: null,
        input: {
          name: 'GitHub',
          username: 'sam',
          password: 'Gh-pw-12345!x',
          websites: ['github.com'],
        },
      })
      const page = await kemlock.visit(hosts.gitlab, '/signin')
      const menu = await kemlock.openMenu(page, email(page))
      await expect(menu.getByText(UNKNOWN_SITE).first()).toBeVisible()
      await expect(menu.getByText(/this isn.t/i)).toHaveCount(0)
    })
  })

  test.describe('the click gate', () => {
    test('a click a tenth of a second after the menu opened fills nothing', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbit, '/signin')
      const menu = await kemlock.openMenu(page, email(page))
      const box = (await menuItem(menu, ORBIT.name).boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(300)
      await expect(email(page)).toHaveValue('')
      // Once the menu has been in view for half a second, the same click fills
      await page.waitForTimeout(GATE_MS)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(email(page)).toHaveValue(ORBIT.username)
    })

    test('a menu the page faded to opacity 0 takes no click', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbit, '/signin')
      const menu = await kemlock.openMenu(page, email(page))
      await page.waitForTimeout(GATE_MS)
      const box = (await menuItem(menu, ORBIT.name).boundingBox())!
      await page.evaluate(() => {
        document.documentElement.style.opacity = '0'
      })
      await page.waitForTimeout(GATE_MS)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(500)
      await expect(email(page)).toHaveValue('')
      await expect(password(page)).toHaveValue('')
    })
  })

  test.describe('codes', () => {
    test('a code fills, and a recovery field never gets one', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbit, '/code')
      await pick(kemlock, page, page.locator('#otp'))
      expect(totpNear(ORBIT.secret)).toContain(await page.locator('#otp').inputValue())
      await expect(page.locator('#recovery')).toHaveValue('')
    })

    test('a row of six boxes is one code, one digit in each', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbit, '/boxes')
      await pick(kemlock, page, page.getByLabel('Digit 1'))
      const digits = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) => page.getByLabel(`Digit ${n}`).inputValue()),
      )
      for (const digit of digits) expect(digit).toMatch(/^\d$/)
      expect(totpNear(ORBIT.secret)).toContain(digits.join(''))
    })

    test("after the password, the next page's code field offers the code by itself, and waits for a pick", async ({
      kemlock,
    }) => {
      await kemlock.call('saveSettings', { settings: { codeAfterPassword: true } })
      const page = await kemlock.visit(hosts.orbit, '/signin-2step')
      await pick(kemlock, page, email(page))
      await expect(password(page)).toHaveValue(ORBIT.password)
      await control(page, /^sign in$/i).click()
      await page.waitForURL(/\/code$/)

      // The menu opens on the code field with no click or key, and the field stays empty
      const menu = await kemlock.menu(page, 15_000)
      await expect(menuItem(menu, ORBIT.name)).toBeVisible()
      await expect(page.locator('#otp')).toHaveValue('')
      await page.waitForTimeout(GATE_MS)
      await menuItem(menu, ORBIT.name).click()
      // The fill goes through the background: it lands a moment after the click
      await expect(page.locator('#otp')).toHaveValue(/^\d{6}$/)
      expect(totpNear(ORBIT.secret)).toContain(await page.locator('#otp').inputValue())
    })
  })

  test.describe('new passwords and saving', () => {
    test('a sign-up form gets the same strong password in both fields, and it is kept under Recently generated', async ({
      kemlock,
    }) => {
      const page = await kemlock.visit(hosts.harbor, '/signup')
      await pick(kemlock, page, page.locator('#new-password'), /strong password/i)
      const first = await page.locator('#new-password').inputValue()
      expect(first.length).toBeGreaterThanOrEqual(14)
      await expect(page.locator('#confirm-password')).toHaveValue(first)
      // The site's passwordrules: at least 14, with a lower and an upper case letter and a digit
      expect(first).toMatch(/[a-z]/)
      expect(first).toMatch(/[A-Z]/)
      expect(first).toMatch(/\d/)
      await expect
        .poll(async () => (await kemlock.call('recentPasswords')).map((p) => p.value))
        .toContain(first)
    })

    test('a new-password field with maxlength 16 gets 16 characters', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.harbor, '/signup-maxlength')
      await pick(kemlock, page, page.locator('#new-password'), /strong password/i)
      const value = await page.locator('#new-password').inputValue()
      expect(value).toHaveLength(16)
      await expect(page.locator('#confirm-password')).toHaveValue(value)
    })

    test("a sign-up offers to save, and Save adds the login with the form's host", async ({
      kemlock,
    }) => {
      const page = await kemlock.visit(hosts.harbor, '/signup')
      await email(page).fill('alex@harbornotes.app')
      await page.locator('#new-password').fill('Harbor-pass-12345!')
      await page.locator('#confirm-password').fill('Harbor-pass-12345!')
      await control(page, /create account/i).click()
      await page.waitForURL(/\/welcome$/)

      const prompt = await kemlock.frameWithText(page, /save to kemlock\?/i)
      await expect(prompt.getByText(/harbornotes\.app/i).first()).toBeVisible()
      await expect(prompt.getByText(/alex@harbornotes\.app/i).first()).toBeVisible()
      await page.waitForTimeout(GATE_MS)
      await control(prompt, /^save$/i).click()

      await expect
        .poll(
          async () =>
            (await kemlock.call('logins')).find((l) => l.username === 'alex@harbornotes.app')
              ?.websites,
        )
        .toContain('harbornotes.app')
      const saved = (await kemlock.call('logins')).find(
        (l) => l.username === 'alex@harbornotes.app',
      )!
      expect(await kemlock.call('showPassword', { id: saved.id })).toBe('Harbor-pass-12345!')
    })

    test('signing in with the password the vault holds shows no prompt', async ({ kemlock }) => {
      const page = await kemlock.visit(hosts.orbit, '/signin')
      await pick(kemlock, page, email(page))
      await control(page, /^sign in$/i).click()
      await page.waitForURL(/\/welcome$/)
      await page.waitForTimeout(2500)
      expect(await kemlock.anyFrameSays(page, /save to kemlock|update in kemlock/i)).toBe(false)
    })

    test('with "Offer to save new logins" off, a sign-up shows no prompt', async ({ kemlock }) => {
      await kemlock.call('saveSettings', { settings: { offerToSave: false } })
      const page = await kemlock.visit(hosts.harbor, '/signup')
      await email(page).fill('alex@harbornotes.app')
      await page.locator('#new-password').fill('Harbor-pass-12345!')
      await page.locator('#confirm-password').fill('Harbor-pass-12345!')
      await control(page, /create account/i).click()
      await page.waitForURL(/\/welcome$/)
      await page.waitForTimeout(2500)
      expect(await kemlock.anyFrameSays(page, /save to kemlock|update in kemlock/i)).toBe(false)
    })

    test('a changed password offers Update, which keeps the old one first among the previous passwords', async ({
      kemlock,
    }) => {
      const login = await kemlock.call('saveLogin', {
        id: null,
        input: {
          name: 'Harbor Notes',
          username: 'alex@harbornotes.app',
          password: 'Harbor-pass-12345!',
          websites: ['harbornotes.app'],
        },
      })
      const page = await kemlock.visit(hosts.harbor, '/change-password')
      await email(page).fill('alex@harbornotes.app')
      await page.locator('#current-password').fill('Harbor-pass-12345!')
      await page.locator('#new-password').fill('Harbor-new-67890?')
      await page.locator('#confirm-password').fill('Harbor-new-67890?')
      await control(page, /change password/i).click()
      await page.waitForURL(/\/welcome$/)

      const prompt = await kemlock.frameWithText(page, /update in kemlock\?/i)
      await page.waitForTimeout(GATE_MS)
      await control(prompt, /^update$/i).click()
      await expect
        .poll(async () => kemlock.call('showPassword', { id: login.id }))
        .toBe('Harbor-new-67890?')
      const updated = (await kemlock.call('logins')).find((l) => l.id === login.id)!
      expect(updated.previousPasswords).toBe(1)
    })
  })
})

test.describe('autofill, without access to all sites', () => {
  test.use({ allSites: false })

  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
  })

  test("pages show no button, and the toolbar popup's Fill login still fills the tab in front", async ({
    kemlock,
  }) => {
    const page = await kemlock.visit(hosts.orbit, '/signin')
    await page.waitForTimeout(1500)
    expect(await kemlock.hasButton(page, email(page))).toBe(false)
    await email(page).focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(1000)
    expect(kemlock.menuOpen(page)).toBe(false)

    // The toolbar's own popup holds activeTab for the tab in front; a popup in a tab does not,
    // so this needs a browser that shows `action.openPopup()` as a page
    await page.bringToFront()
    const popup = await kemlock.toolbarPopup()
    test.skip(popup === null, 'this browser does not show the toolbar popup as a page')
    await control(popup!, /fill login/i).click()
    await expect(email(page)).toHaveValue(ORBIT.username)
    await expect(password(page)).toHaveValue(ORBIT.password)
  })
})
