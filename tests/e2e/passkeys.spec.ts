// The passkey provider (docs/plans/add-passkeys.md), on a fixture page that asks for a passkey as a site does and checks what it is
// given: the person is asked in a frame the page can't read, a passkey made here signs in here, the popup lists and deletes it, and
// a conditional request is answered from a field's menu. Choices that would end in the browser's own prompt (another device or key)
// are left out: they need an authenticator the test browser has none of.
import type { Page } from '@playwright/test'
import { expect, GATE_MS, menuItem, PASSWORD, test, type Kemlock } from './kemlock'
import { hosts } from './hosts'
import { control } from './ui'

const status = (page: Page) => page.locator('#status')

/** Waits for the card with this heading, out the click gate's half second, then presses one of its buttons. */
async function choose(kemlock: Kemlock, page: Page, heading: RegExp, button: RegExp) {
  const card = await kemlock.frameWithText(page, heading)
  await page.waitForTimeout(GATE_MS)
  await card.getByRole('button', { name: button }).click()
  return card
}

/** Makes the passkey of the fixture page, by the person choosing Kemlock. */
async function makePasskey(kemlock: Kemlock) {
  const page = await kemlock.visit(hosts.orbit, '/passkey')
  await page.getByRole('button', { name: 'Create passkey' }).click()
  await choose(kemlock, page, /Save a passkey in Kemlock/, /^Save a passkey$/)
  await expect(status(page)).toContainText('created')
  return page
}

test.describe('passkeys', () => {
  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
  })

  test('a passkey is saved in the vault when the person chooses Kemlock, and the site is told', async ({
    kemlock,
  }) => {
    const page = await kemlock.visit(hosts.orbit, '/passkey')
    await page.getByRole('button', { name: 'Create passkey' }).click()
    const card = await kemlock.frameWithText(page, /Save a passkey in Kemlock/)
    // The card says what the site asked for, and nothing is made before the person chooses
    await expect(card.getByText(hosts.orbit)).toBeVisible()
    await expect(card.getByText('Sam')).toBeVisible()
    expect(await kemlock.call('passkeys')).toHaveLength(0)
    await expect(status(page)).toHaveText('idle')

    await page.waitForTimeout(GATE_MS)
    await card.getByRole('button', { name: /^Save a passkey$/ }).click()
    await expect(status(page)).toContainText(`webauthn.create https://${hosts.orbit}`)
    const [passkey] = await kemlock.call('passkeys')
    expect(passkey).toMatchObject({ rpId: hosts.orbit, userName: 'sam@example.com' })
    await expect(status(page)).toContainText(passkey!.credentialId)
    // The page was told of the credential and nothing of the key
    expect(JSON.stringify(await kemlock.call('passkeys'))).not.toMatch(/privateKey|MIG/)
  })

  test('the passkey signs in: the site verifies the signature, for its own origin and challenge', async ({
    kemlock,
  }) => {
    const page = await makePasskey(kemlock)
    await page.getByRole('button', { name: 'Sign in with passkey' }).click()
    const card = await kemlock.frameWithText(page, /Sign in with a passkey/)
    await expect(card.getByText('Sam')).toBeVisible()
    await page.waitForTimeout(GATE_MS)
    await card.getByRole('button', { name: /Sam/ }).click()
    await expect(status(page)).toContainText('verified')
  })

  test('closing the card with Escape is a no: the site gets NotAllowedError and nothing is saved', async ({
    kemlock,
  }) => {
    const page = await kemlock.visit(hosts.orbit, '/passkey')
    await page.getByRole('button', { name: 'Create passkey' }).click()
    const card = await kemlock.frameWithText(page, /Save a passkey in Kemlock/)
    // The card never takes the keyboard by itself; the person gives it theirs, and then Escape is a no
    await card.locator('p.lead').click()
    await page.keyboard.press('Escape')
    await expect(status(page)).toHaveText('error NotAllowedError')
    expect(await kemlock.call('passkeys')).toHaveLength(0)
    await expect.poll(() => kemlock.menuOpen(page)).toBe(false)
  })

  test('the card does not take the keyboard from the page: typing goes on, and no key answers it', async ({
    kemlock,
  }) => {
    const page = await kemlock.visit(hosts.orbit, '/passkey')
    await page.locator('#user').focus()
    // The page asks while the person types
    await page.evaluate(() => document.getElementById('create')!.click())
    await kemlock.frameWithText(page, /Save a passkey in Kemlock/)
    await page.waitForTimeout(GATE_MS)
    await page.keyboard.type('sam')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await expect(page.locator('#user')).toHaveValue(/^sam/)
    expect(await kemlock.call('passkeys')).toHaveLength(0)
    await expect(status(page)).toHaveText('idle')
  })

  test('a locked vault is opened in the card itself, and then the passkey is saved', async ({
    kemlock,
  }) => {
    const page = await kemlock.visit(hosts.orbit, '/passkey')
    await kemlock.call('lock')
    await page.getByRole('button', { name: 'Create passkey' }).click()
    const card = await kemlock.frameWithText(page, /Unlock Kemlock to use a passkey/)
    await card.getByLabel('Password').fill(PASSWORD)
    await card.getByRole('button', { name: 'Unlock' }).click()
    await kemlock.frameWithText(page, /Save a passkey in Kemlock/)
    await page.waitForTimeout(GATE_MS)
    await card.getByRole('button', { name: /^Save a passkey$/ }).click()
    await expect(status(page)).toContainText('created')
    expect(await kemlock.call('passkeys')).toHaveLength(1)
  })

  test('a page that waits with conditional mediation is answered from the field’s menu', async ({
    kemlock,
  }) => {
    // The same tab, reloaded: the fixture keeps the passkey's public key in this tab's sessionStorage to verify with
    const page = await makePasskey(kemlock)
    await page.reload()
    await page.getByRole('button', { name: 'Wait for a passkey' }).click()
    await expect(status(page)).toHaveText('idle')
    // No card of its own: the passkey is in the menu of the field that says "webauthn"
    const menu = await kemlock.openMenu(page, page.locator('#user'))
    await expect(menuItem(menu, /Sam/)).toBeVisible()
    await page.waitForTimeout(GATE_MS)
    await menuItem(menu, /Sam/).click()
    await expect(status(page)).toContainText('verified')
  })

  test('the popup lists the passkey with the site in front, opens its page, and deletes it', async ({
    kemlock,
  }) => {
    const site = await makePasskey(kemlock)
    const popup = await kemlock.popup(site)
    // On this site, and in its own list
    await expect(popup.getByText(/Passkey · Sam/)).toBeVisible()
    await control(popup, /^Passkeys/).click()
    await expect(popup.getByText(/Sam · orbit-cloud\.com/)).toBeVisible()
    await control(popup, /Open the passkey of Orbit Cloud/).click()
    await expect(popup.getByText('sam@example.com')).toBeVisible()
    await control(popup, 'Delete passkey').click()
    await control(popup, /^Delete$/).click()
    await expect.poll(() => kemlock.call('passkeys')).toHaveLength(0)
  })

  test('a passkey in the vault also shows on the login’s page for its site', async ({
    kemlock,
  }) => {
    await kemlock.seedOrbit()
    const site = await makePasskey(kemlock)
    const popup = await kemlock.popup(site)
    await control(popup, /^Logins/).click()
    await control(popup, /Open Orbit Cloud/).click()
    await expect(popup.getByText(/Sam · orbit-cloud\.com/)).toBeVisible()
  })
})
