// How the tests find the extension's own screens: by role and visible English text, never by
// class. When a screen's wording or markup changes, this is the one file to change. Everything
// here is a guess from the plan's specs (docs/plans/add-browser-extension/specs) until the screens
// exist; each helper tries the likeliest roles for its control with `.or`.
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

/** The six digits a code row shows (as "123 456", "123456" or one span a digit group). */
export async function codeShownIn(row: Locator): Promise<string> {
  const text = await row.innerText()
  const match = text.replace(/\s/g, '').match(/\d{6,8}/)
  if (!match) throw new Error(`no code in: ${text}`)
  return match[0]
}

/* ---------------------------------------------------------------------------------------------- */
/* Setup                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/** "A password for this browser", typed twice, then on to the next step. */
export async function setBrowserPassword(
  page: Page,
  password: string,
  again = password,
): Promise<void> {
  const boxes = passwordBoxes(page)
  await boxes.nth(0).fill(password)
  await boxes.nth(1).fill(again)
  await control(page, /continue|next|create/i).click()
}

/** The place step: where the phone syncs. */
export async function pickPlace(
  page: Page,
  place: 'Kemlock Server' | 'WebDAV' | 'Vaultwarden',
): Promise<void> {
  await control(page, new RegExp(place, 'i')).click()
  const next = control(page, /continue|next/i)
  if (await next.isVisible().catch(() => false)) await next.click()
}

/** "Connect your sync folder": the folder, its login and the sync passphrase. */
export async function fillWebdav(
  page: Page,
  folder: { address: string; username: string; password: string; passphrase: string },
): Promise<void> {
  await box(page, /folder|address|url/i).fill(folder.address)
  await box(page, /user/i).fill(folder.username)
  await box(page, /^(app )?password/i).fill(folder.password)
  await box(page, /passphrase/i).fill(folder.passphrase)
}

/** The access step names an address and asks for the browser's permission, which the manifest holds already. */
export async function allowAccessIfAsked(page: Page): Promise<void> {
  const allow = control(page, /allow|grant|give access/i)
  if (await allow.isVisible({ timeout: 1500 }).catch(() => false)) await allow.click()
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
