// How the item-format specs find the popup's new screens (docs/plans/add-item-format.md): fields, links, rules, the Files row
// and the Files tab. They were written while the screens were; every locator here is a guess at the screens' wording
// (the plan's English), so when a screen's label differs this is the one file to change. Role and label first, never class.
import { expect, type Locator, type Page } from '@playwright/test'
import { control, row } from './ui'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Opens a login's page from the popup's Logins list. */
export async function openLogin(popup: Page, name: string): Promise<void> {
  await control(popup, /^logins$/i).click()
  await control(popup, new RegExp(`^open ${escape(name)}`, 'i')).click()
}

/** Opens a note's page from the Notes list of Home. */
export async function openNote(popup: Page, title: string): Promise<void> {
  await control(popup, /^notes\b/i).click()
  await control(popup, new RegExp(`^open ${escape(title)}`, 'i')).click()
}

/** Opens a File item's page from the Files row of Home. */
export async function openFileItem(popup: Page, name: string): Promise<void> {
  await control(popup, /^files\b/i).click()
  await control(popup, new RegExp(`^open ${escape(name)}`, 'i')).click()
}

/** Opens a contact's page: Keys and PGP, the Contacts tab, the contact. */
export async function openContact(popup: Page, name: string): Promise<void> {
  await control(popup, /^keys and pgp$/i).click()
  await control(popup, /^contacts\b/i).click()
  await control(popup, new RegExp(`^open ${escape(name)}`, 'i')).click()
}

/** The codes list. The tab says "MFA codes", never "Codes" (decision 6). */
export async function openCodes(popup: Page): Promise<void> {
  await control(popup, /^mfa codes$/i).click()
}

/** The page's Edit button (the item bar of every page). */
export const editButton = (popup: Page): Locator => control(popup, /^edit\b/i)

export const saveButton = (popup: Page): Locator => control(popup, /^save$/i)

/**
 * A button of a custom field's row on a page: Show or Copy, named either "Show <field>" or sitting in the row that shows the
 * field's name.
 */
export function fieldButton(popup: Page, verb: 'Show' | 'Hide' | 'Copy', field: string): Locator {
  const name = escape(field)
  return popup
    .getByRole('button', { name: new RegExp(`${verb}.*${name}|${name}.*${verb}`, 'i') })
    .or(row(popup, field).getByRole('button', { name: new RegExp(`^${verb}\\b`, 'i') }))
    .first()
}

/** The Unlink button of a linked item of a page (its own name is in the button's, or it is in the item's row). */
export function unlinkButton(popup: Page, name: string): Locator {
  return popup
    .getByRole('button', {
      name: new RegExp(`unlink.*${escape(name)}|${escape(name)}.*unlink`, 'i'),
    })
    .or(row(popup, name).getByRole('button', { name: /unlink/i }))
    .first()
}

/** Links an item from an edit page's picker: search for it, then pick it. */
export async function pickLink(popup: Page, query: string, name: string): Promise<void> {
  const box = popup
    .getByRole('searchbox', { name: /link|item|search/i })
    .or(popup.getByPlaceholder(/search/i))
    .or(popup.getByLabel(/search/i))
    .first()
  await box.fill(query)
  await control(popup, new RegExp(escape(name), 'i')).click()
}

/** The "Add a field" control of a fields editor, and the choice of the person's own field in it. */
export async function addOwnField(popup: Page, name: string, value: string): Promise<void> {
  await control(popup, /add a field/i).click()
  await control(popup, /your own field/i).click()
  await popup
    .getByLabel(/field name|^name$/i)
    .last()
    .fill(name)
  await popup
    .getByLabel(/^value\b|field value/i)
    .last()
    .fill(value)
}

/** What the page says where files can't be used. */
export const filesNotice = (popup: Page): Locator =>
  popup.getByText(/files need kemlock server sync/i).first()

/** The buttons of a file's actions (not the item's own Delete): never there when the vault doesn't sync with Kemlock Server. */
export async function expectNoFileActions(popup: Page): Promise<void> {
  const actions = [
    /^download\b/i,
    /^add files\b/i,
    /^replace\b/i,
    /^remove .*(file|attachment|\.pdf)/i,
    /^delete (the |this )?file/i,
  ]
  for (const name of actions) {
    await expect(
      popup.getByRole('button', { name }).or(popup.getByRole('link', { name })),
    ).toHaveCount(0)
  }
}

/** The Files tab at a hash (`newFile`, `replace/<id>`, `attach/<noteId>`), as the popup opens it. */
export async function openFilesTab(
  context: { newPage(): Promise<Page> },
  url: (path: string) => string,
  hash: string,
): Promise<Page> {
  const tab = await context.newPage()
  await tab.goto(url(`src/files/index.html#${hash}`))
  return tab
}

/** Gives the Files tab a file, through its picker (the drop area has one behind it). */
export async function chooseFile(
  tab: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await tab.locator('input[type="file"]').first().setInputFiles(file)
}
