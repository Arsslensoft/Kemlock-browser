// Notes, cards and identities (docs/plans/add-items.md), on fixture pages served at the names a person would browse to: a card
// fills a checkout form, selects included, from the menu opened with the down arrow in a field; a payment frame asks first; a
// checkout with a card the vault doesn't hold offers to save it; an identity fills an address; and the popup shows a card's number
// only when asked. Items are clicked only after the click gate's half second.
import { expect, GATE_MS, menuItem, test, type Kemlock } from './kemlock'
import { hosts } from './hosts'
import { control } from './ui'
import type { Frame, Locator } from '@playwright/test'

const VISA = {
  name: 'Everyday Visa',
  cardholder: 'Sam Rivera',
  number: '4111111111111111',
  brand: 'Visa',
  expMonth: 5,
  expYear: 2029,
  code: '123',
}

const HOME = {
  name: 'Home',
  givenName: 'Sam',
  familyName: 'Rivera',
  email: 'sam@example.com',
  phone: '+33 6 12 34 56 78',
  address: { lines: ['1 Orbit Way'], city: 'Lyon', postalCode: '69001', country: 'FR' },
}

/** Waits out the click gate's half second, then clicks. */
async function gatedClick(menu: Frame, target: Locator): Promise<void> {
  await menu.page().waitForTimeout(GATE_MS)
  await target.click()
}

const saveVisa = (kemlock: Kemlock) => kemlock.call('saveCard', { id: null, input: VISA })

test.describe('cards and identities', () => {
  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
  })

  test('a card fills a checkout form, its selects too, and filling sends nothing', async ({
    kemlock,
    site,
  }) => {
    await saveVisa(kemlock)
    const page = await kemlock.visit(hosts.orbit, '/checkout')
    const menu = await kemlock.openMenu(page, page.locator('#number'))
    await expect(menuItem(menu, VISA.name)).toBeVisible()
    await expect(menu.getByText(/•••• 1111/).first()).toBeVisible()
    // The menu lists the card by name and last digits: the number is not in the page's reach
    const readable = await page.evaluate(() => document.documentElement.outerHTML)
    expect(readable).not.toContain('4111111111111111')
    await expect(page.locator('#number')).toHaveValue('')

    await gatedClick(menu, menuItem(menu, VISA.name))
    await expect(page.locator('#holder')).toHaveValue('Sam Rivera')
    await expect(page.locator('#number')).toHaveValue('4111111111111111')
    await expect(page.locator('#month')).toHaveValue('05')
    await expect(page.locator('#year')).toHaveValue('2029')
    await expect(page.locator('#cvc')).toHaveValue('123')
    expect(site.posts).toEqual([])
  })

  test('a payment frame asks the person first, showing the frame’s own address', async ({
    kemlock,
  }) => {
    await saveVisa(kemlock)
    const page = await kemlock.visit(hosts.orbit, '/checkout-frame')
    await expect.poll(() => page.frames().some((f) => f.url().includes(hosts.evil))).toBe(true)
    const child = page.frames().find((f) => f.url().includes(hosts.evil))!
    const menu = await kemlock.openMenu(page, child.locator('#number'))
    await gatedClick(menu, menuItem(menu, VISA.name))

    await expect(menu.getByText(new RegExp(`https://${hosts.evil}`)).first()).toBeVisible()
    await expect(menu.getByText(new RegExp(hosts.orbit)).first()).toBeVisible()
    await expect(child.locator('#number')).toHaveValue('')

    await gatedClick(menu, control(menu, /^fill$/i))
    await expect(child.locator('#number')).toHaveValue('4111111111111111')
    await expect(child.locator('#month')).toHaveValue('05')
  })

  test('a checkout with a card the vault does not hold offers to save it', async ({ kemlock }) => {
    const page = await kemlock.visit(hosts.harbor, '/checkout')
    await page.locator('#holder').fill('Alex Doe')
    await page.locator('#number').fill('5555 5555 5555 4444')
    await page.locator('#month').selectOption('09')
    await page.locator('#year').selectOption('2030')
    await page.locator('#cvc').fill('321')
    await control(page, /pay now/i).click()
    await page.waitForURL(/\/welcome$/)

    const prompt = await kemlock.frameWithText(page, /save this card to kemlock\?/i)
    await expect(prompt.getByText(/•••• 4444/).first()).toBeVisible()
    await expect(prompt.getByText(/09\/2030/).first()).toBeVisible()
    // Never the number or the code
    expect(await prompt.locator('body').innerText()).not.toContain('5555555555554444')
    await gatedClick(prompt, control(prompt, /^save$/i))

    await expect
      .poll(async () => (await kemlock.call('cards')).map((card) => card.lastFour))
      .toContain('4444')
    const [saved] = await kemlock.call('cards')
    const whole = await kemlock.call('revealCard', { id: saved.id })
    expect(whole).toMatchObject({
      number: '5555555555554444',
      cardholder: 'Alex Doe',
      expMonth: 9,
      expYear: 2030,
      code: '321',
      brand: 'Mastercard',
    })
  })

  test('a card the vault holds is not offered again', async ({ kemlock }) => {
    await saveVisa(kemlock)
    const page = await kemlock.visit(hosts.harbor, '/checkout')
    await page.locator('#number').fill(VISA.number)
    await control(page, /pay now/i).click()
    await page.waitForURL(/\/welcome$/)
    await page.waitForTimeout(2500)
    expect(await kemlock.anyFrameSays(page, /save this card/i)).toBe(false)
  })

  test('an identity fills an address, a country select by its name', async ({ kemlock }) => {
    await kemlock.call('saveIdentity', { id: null, input: HOME })
    const page = await kemlock.visit(hosts.orbit, '/address')
    const menu = await kemlock.openMenu(page, page.locator('#given'))
    await gatedClick(menu, menuItem(menu, HOME.name))
    await expect(page.locator('#given')).toHaveValue('Sam')
    await expect(page.locator('#family')).toHaveValue('Rivera')
    await expect(page.locator('#contact')).toHaveValue('sam@example.com')
    await expect(page.locator('#phone')).toHaveValue('+33 6 12 34 56 78')
    await expect(page.locator('#street')).toHaveValue('1 Orbit Way')
    await expect(page.locator('#postal')).toHaveValue('69001')
    await expect(page.locator('#city')).toHaveValue('Lyon')
    await expect(page.locator('#country')).toHaveValue('FR')
  })

  test('the popup shows a card’s number only when asked, and copies it through the clipboard', async ({
    kemlock,
  }) => {
    await saveVisa(kemlock)
    const popup = await kemlock.popup()
    await control(popup, /^cards\b/i).click()
    await control(popup, /open everyday visa/i).click()
    await expect(popup.getByText(/•••• 1111/).first()).toBeVisible()
    await expect(popup.locator('body')).not.toContainText('4111 1111 1111 1111')
    await control(popup, /show the card number/i).click()
    await expect(popup.getByText('4111 1111 1111 1111')).toBeVisible()
    await control(popup, /copy the card number/i).click()
    await expect.poll(() => kemlock.clipboard()).toBe('4111111111111111')
  })

  test('a note is saved, read and deleted from the popup', async ({ kemlock }) => {
    const popup = await kemlock.popup()
    await kemlock.call('saveNote', { id: null, input: { title: 'Wi-Fi', text: 'hunter2 at home' } })
    await popup.reload()
    await control(popup, /^notes\b/i).click()
    await expect(popup.getByText('Wi-Fi').first()).toBeVisible()
    await control(popup, /open wi-fi/i).click()
    await expect(popup.getByText('hunter2 at home')).toBeVisible()
    await control(popup, /delete note/i).click()
    await control(popup, /^delete$/i).click()
    await expect.poll(async () => (await kemlock.call('notes')).length).toBe(0)
  })
})
