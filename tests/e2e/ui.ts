// How the tests find the extension's own screens: by role and visible English text, never by
// class. When a screen's wording or markup changes, this is the one file to change. Everything
// here follows the real screens (src/setup, src/popup, src/menu); the popup's helpers try the likeliest
// roles for a control with `.or`.
import { expect, type Frame, type Locator, type Page } from '@playwright/test'

type Name = string | RegExp

/** A control by its visible name, whatever role the screen gave it. */
export function control(page: Page | Frame | Locator, name: Name): Locator {
  return page
    .getByRole('button', { name })
    .or(page.getByRole('link', { name }))
    .or(page.getByRole('tab', { name }))
    .or(page.getByRole('menuitem', { name }))
    .or(page.getByRole('radio', { name }))
    .or(page.getByRole('option', { name }))
    .first()
}

/** A switch or a checkbox by its label. */
export function toggle(page: Page | Frame | Locator, name: Name): Locator {
  return page.getByRole('switch', { name }).or(page.getByRole('checkbox', { name })).first()
}

/** A text box by its label, or its placeholder. */
export function box(page: Page | Locator, name: Name): Locator {
  return page.getByLabel(name).or(page.getByPlaceholder(name)).first()
}

export const passwordBoxes = (page: Page) => page.locator('input[type="password"]:visible')

/* ---------------------------------------------------------------------------------------------- */
/* The lock screen and the popup's frame                                                           */
/* ---------------------------------------------------------------------------------------------- */

/** The lock screen's password box. */
export const lockScreenPassword = (page: Page) => passwordBoxes(page).first()

export async function unlockWith(page: Page, password: string): Promise<void> {
  await lockScreenPassword(page).fill(password)
  await control(page, /^unlock$/i).click()
}

/** The lock screen is showing. */
export async function expectLocked(page: Page): Promise<void> {
  await expect(lockScreenPassword(page)).toBeVisible()
  await expect(control(page, /^unlock$/i)).toBeVisible()
}

export async function lockNow(page: Page): Promise<void> {
  await control(page, /lock now/i).click()
}

/** The popup's three lists and tools. */
export type Section = 'Codes' | 'Logins' | 'Generator' | 'Settings'
export async function openSection(page: Page, section: Section): Promise<void> {
  await control(page, new RegExp(`^${section}$`, 'i')).click()
}

/** One row of a list, by the name it shows. */
export const row = (page: Page, text: Name): Locator =>
  page
    .locator('li, [role="listitem"], [role="row"], article, [data-testid]')
    .filter({ hasText: text })
    .last()

export const search = (page: Page) =>
  page
    .getByRole('searchbox')
    .or(page.getByPlaceholder(/search/i))
    .first()

/**
 * The six digits a code row shows (as "123 456", "123456" or one span a digit group). A row shows
 * dots until the first answer of the background, so this waits for the digits.
 */
export async function codeShownIn(row: Locator): Promise<string> {
  let text = ''
  await expect
    .poll(async () => {
      text = await row.innerText()
      return /\d{6,8}/.test(text.replace(/\s/g, ''))
    })
    .toBe(true)
  return text.replace(/\s/g, '').match(/\d{6,8}/)![0]
}

/* ---------------------------------------------------------------------------------------------- */
/* Setup                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/** "A password for this browser" and "Type it again", typed. */
export async function typeBrowserPassword(
  page: Page,
  password: string,
  again = password,
): Promise<void> {
  const boxes = passwordBoxes(page)
  await boxes.nth(0).fill(password)
  await boxes.nth(1).fill(again)
}

/** The password step's one button; it stays disabled until the password is strong enough and typed twice alike. */
export const createVaultButton = (page: Page) => control(page, /^create the vault$/i)

/** "A password for this browser", typed twice, then "Create the vault". */
export async function setBrowserPassword(
  page: Page,
  password: string,
  again = password,
): Promise<void> {
  await typeBrowserPassword(page, password, again)
  await createVaultButton(page).click()
}

const placeNames = {
  'Kemlock Server': /^kemlock server/i,
  WebDAV: /^webdav folder/i,
  Vaultwarden: /^vaultwarden/i,
}

/** The place step ("Where does your phone sync?"): one click on the place's button goes to its address. */
export async function pickPlace(
  page: Page,
  place: 'Kemlock Server' | 'WebDAV' | 'Vaultwarden',
): Promise<void> {
  await page.getByRole('button', { name: placeNames[place] }).click()
}

/** The address step ("Connect your sync folder" for WebDAV): the address, then Continue. */
export async function enterAddress(page: Page, address: string, folder = false): Promise<void> {
  await page.getByLabel(folder ? /^folder address/i : /^server address/i).fill(address)
  await control(page, /^continue$/i).click()
}

/**
 * The access step ("Allow access to <host>"): its own button asks for the address's permission.
 * With the all-sites permission in the test manifest the browser grants it without a prompt.
 */
export async function allowAccess(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^allow access to /i }).click()
}

/** "Sign in to the folder": the folder's login and the sync passphrase, then Sign in. */
export async function signInToFolder(
  page: Page,
  login: { username: string; password: string; passphrase: string },
): Promise<void> {
  await page.getByLabel(/^username/i).fill(login.username)
  await page.getByLabel(/^password (or app password)/i).fill(login.password)
  await page.getByLabel(/^sync passphrase/i).fill(login.passphrase)
  await control(page, /^sign in$/i).click()
}

/** Picks the option of a select whose text matches. */
export async function chooseOption(select: Locator, text: RegExp): Promise<void> {
  const label = await select.evaluate(
    (el, source) => {
      const re = new RegExp(source.pattern, source.flags)
      const option = [...(el as HTMLSelectElement).options].find((o) => re.test(o.text))
      return option?.text ?? null
    },
    { pattern: text.source, flags: text.flags },
  )
  if (label === null) throw new Error(`no option matches ${String(text)}`)
  await select.selectOption({ label })
}

/** "Remove Kemlock from this browser", with whatever confirmation the screen asks for. */
export async function removeFromBrowser(page: Page): Promise<void> {
  page.once('dialog', (dialog) => void dialog.accept())
  await control(page, /remove kemlock from this browser/i).click()
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'))
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dialog.getByRole('button', { name: /remove|confirm|yes/i }).click()
  }
}
