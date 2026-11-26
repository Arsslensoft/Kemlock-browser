// The transfer tab, in a real Chromium over the built extension: exporting the vault as files and QR codes, importing them back (with the
// real Dart core: the encrypted export, the CSV reader, the QR reader), and the settings that open it.
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, ORBIT, PASSWORD, test, type Kemlock } from './kemlock'
import { box, control, openSection, toggle } from './ui'

const transferUrl = (kemlock: Kemlock, panel: 'import' | 'export') =>
  kemlock.url(`src/transfer/index.html#${panel}`)

async function openTransfer(kemlock: Kemlock, panel: 'import' | 'export'): Promise<Page> {
  const page = await kemlock.context.newPage()
  await page.goto(transferUrl(kemlock, panel))
  await expect(page.getByRole('heading', { name: /^import and export$/i })).toBeVisible()
  return page
}

/** Exports in [format] (its radio's name) and answers the file's text. */
async function exportFile(
  page: Page,
  format: RegExp,
  extra: (page: Page) => Promise<void> = async () => undefined,
): Promise<{ path: string; text: string; name: string }> {
  await control(page, format).click()
  await extra(page)
  await box(page, /your kemlock password/i).fill(PASSWORD)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    control(page, /^export and save$/i).click(),
  ])
  const path = await download.path()
  return { path, text: await readFile(path, 'utf8'), name: download.suggestedFilename() }
}

const understand = async (page: Page) => {
  await toggle(page, /i understand that this is not encrypted/i).check()
}

test.describe('the transfer tab', () => {
  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
  })

  test('exports the vault as a plain Kemlock file that holds what the vault does', async ({
    kemlock,
  }) => {
    const page = await openTransfer(kemlock, 'export')

    const file = await exportFile(page, /kemlock export, plain/i, understand)

    expect(file.name).toMatch(/^kemlock-export-.*\.json$/)
    const parsed = JSON.parse(file.text) as Record<string, unknown>
    expect(parsed).toMatchObject({ app: 'BackMyCodes', scheme: 'plaintext' })
    expect(file.text).toContain(ORBIT.name)
    expect(file.text).toContain(ORBIT.secret)
    await expect(page.getByText(/exported as kemlock-export-/i)).toBeVisible()
    // What was typed is not left in the page
    await expect(box(page, /your kemlock password/i)).toHaveValue('')
  })

  test('asks for the vault password and says when it is wrong, without saving anything', async ({
    kemlock,
  }) => {
    const page = await openTransfer(kemlock, 'export')
    await control(page, /kemlock export, plain/i).click()
    await understand(page)
    await box(page, /your kemlock password/i).fill('not the password')
    let downloaded = false
    page.on('download', () => (downloaded = true))

    await control(page, /^export and save$/i).click()

    await expect(page.getByText(/that is not your kemlock password/i)).toBeVisible()
    expect(downloaded).toBe(false)
    expect((await kemlock.call('popup')).state.wrongPasswords).toBe(1)
  })

  test('a plain format waits for the person to say they know what it is', async ({ kemlock }) => {
    const page = await openTransfer(kemlock, 'export')
    await control(page, /logins as csv/i).click()
    await box(page, /your kemlock password/i).fill(PASSWORD)

    await expect(control(page, /^export and save$/i)).toBeDisabled()
    await expect(page.getByText(/a csv file is not encrypted/i)).toBeVisible()
    await understand(page)
    await expect(control(page, /^export and save$/i)).toBeEnabled()
  })

  test('an encrypted export opens only with its password, and brings back what was removed', async ({
    kemlock,
  }) => {
    const page = await openTransfer(kemlock, 'export')
    const file = await exportFile(page, /kemlock backup, encrypted/i, async (page) => {
      await box(page, /^password of the file/i).fill('transfer password 1')
      await box(page, /type it again/i).fill('transfer password 1')
    })
    expect(file.text).not.toContain(ORBIT.password)
    expect(file.text).not.toContain(ORBIT.secret)
    const [login] = await kemlock.call('logins')
    await kemlock.call('deleteLogin', { id: login!.id })
    expect(await kemlock.call('logins')).toHaveLength(0)

    await page.goto(transferUrl(kemlock, 'import'))
    await page.locator('input[type="file"]').first().setInputFiles(file.path)
    await expect(page.getByText(/this file is encrypted/i)).toBeVisible()
    await box(page, /password of the file/i).fill('wrong password')
    await control(page, /^open$/i).click()
    await expect(page.getByText(/does not open the file/i)).toBeVisible()
    await box(page, /password of the file/i).fill('transfer password 1')
    await control(page, /^open$/i).click()

    await expect(page.getByRole('table')).toContainText(/logins/i)
    await control(page, /^import \d+ items?$/i).click()
    await expect(page.getByText(/imported\. it is in the vault now/i)).toBeVisible()
    expect((await kemlock.call('logins')).map((l) => l.name)).toContain(ORBIT.name)
  })

  test('imports a CSV of logins from another password manager, and finds the second import all held', async ({
    kemlock,
  }) => {
    const csv =
      'name,url,username,password\nGitHub,https://github.com/login,octo,hunter2\nMail,https://mail.example.com,me,pw\n'
    const page = await openTransfer(kemlock, 'import')

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: 'logins.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

    await expect(page.getByText(/csv file of logins/i)).toBeVisible()
    await expect(page.getByText('GitHub').first()).toBeVisible()
    await control(page, /^import 2 items$/i).click()
    await expect(page.getByText(/imported\. it is in the vault now/i)).toBeVisible()
    const logins = await kemlock.call('logins')
    expect(logins.map((l) => l.name)).toEqual(expect.arrayContaining(['GitHub', 'Mail']))
    expect(logins.find((l) => l.name === 'GitHub')?.websites).toContain('github.com')

    await control(page, /import another file/i).click()
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: 'logins.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByText(/the vault holds all of this already/i)).toBeVisible()
    await expect(control(page, /^import 0 items$/i)).toBeDisabled()
  })

  test('says what it cannot read, and offers the choice again', async ({ kemlock }) => {
    const page = await openTransfer(kemlock, 'import')

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('just some words'),
      })

    await expect(page.getByText(/kemlock cannot read this/i)).toBeVisible()
    await expect(control(page, /choose a file/i)).toBeVisible()
  })

  test('shows the codes as QR codes that read back as the vault’s own', async ({ kemlock }) => {
    const page = await openTransfer(kemlock, 'export')
    await control(page, /qr codes for google authenticator/i).click()
    await understand(page)
    await box(page, /your kemlock password/i).fill(PASSWORD)

    await control(page, /^show the qr codes$/i).click()

    const code = page.getByRole('img', { name: /qr code 1 of 1/i })
    await expect(code).toBeVisible()
    const picture = await code.screenshot()

    // The same picture, given to the import, is read by the core and found to be what the vault holds
    await page.goto(transferUrl(kemlock, 'import'))
    await page
      .locator('input[type="file"]')
      .nth(1)
      .setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: picture })
    await expect(page.getByText(/^qr codes$/i)).toBeVisible()
    const row = page.getByRole('row', { name: /^mfa codes/i })
    await expect(row).toContainText(/codes\s*1\s*0\s*1/i)
  })

  test('asks for the password when the vault is locked, and opens on the panel it was asked for', async ({
    kemlock,
  }) => {
    await kemlock.call('lock')
    const page = await openTransfer(kemlock, 'export')
    await expect(page.getByRole('heading', { name: /unlock kemlock/i })).toBeVisible()

    await box(page, /kemlock password/i).fill(PASSWORD)
    await control(page, /^unlock$/i).click()

    await expect(page.getByRole('tab', { name: /^export$/i })).toBeVisible()
    await expect(page.getByText(/how to export/i)).toBeVisible()
  })

  test('opens from Settings, one tab for Import and one for Export', async ({ kemlock }) => {
    const popup = await kemlock.popup()
    await openSection(popup, 'Settings')

    const [importTab] = await Promise.all([
      kemlock.context.waitForEvent('page'),
      control(popup, /^import…$/i).click(),
    ])
    expect(importTab.url()).toBe(transferUrl(kemlock, 'import'))
    const [exportTab] = await Promise.all([
      kemlock.context.waitForEvent('page'),
      control(popup, /^export…$/i).click(),
    ])
    expect(exportTab.url()).toBe(transferUrl(kemlock, 'export'))
  })

  test('refuses what only the transfer tab may ask, from the popup', async ({ kemlock }) => {
    await expect(kemlock.call('transferExportInfo')).rejects.toThrow(/refused/)
  })
})
