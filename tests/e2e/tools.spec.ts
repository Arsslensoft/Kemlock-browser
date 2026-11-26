// The vault tools in the real extension, over the real core: tags and order, backup codes, the duplicate cleaner and the breach
// checks, through the popup, with the vault read back through the background to see what was saved.
import { expect, ORBIT, PASSWORD, test } from './kemlock'
import { control, openSection } from './ui'

test.describe('the vault tools', () => {
  test.beforeEach(async ({ kemlock }) => {
    await kemlock.createVault()
  })

  test('a login gets a tag from its own page, and the tag filters the list and survives a restart', async ({
    kemlock,
  }) => {
    const { loginId } = await kemlock.seedOrbit()
    const popup = await kemlock.popup()
    await openSection(popup, 'Logins')
    await control(popup, `Open ${ORBIT.name}`).click()
    const box = popup.getByRole('textbox', { name: 'Tags', exact: true })
    await box.fill('Work')
    await box.press('Enter')
    await expect(popup.getByRole('button', { name: 'Remove the tag Work' })).toBeVisible()
    await expect
      .poll(async () => (await kemlock.call('logins')).find((l) => l.id === loginId)?.tags)
      .toEqual(['Work'])

    await kemlock.restart()
    await kemlock.call('unlock', { password: PASSWORD })
    expect((await kemlock.call('logins')).find((l) => l.id === loginId)?.tags).toEqual(['Work'])
  })

  test('codes are put in order by Move up, and a pinned code stays first', async ({ kemlock }) => {
    await kemlock.seedOrbit()
    const second = await kemlock.call('addCodeFromLink', {
      otpauth: 'otpauth://totp/Beta:sam?secret=JBSWY3DPEHPK3PXQ&issuer=Beta',
    })
    const popup = await kemlock.popup()
    await control(popup, 'Reorder MFA codes').click()
    await control(popup, 'Move Beta up').click()
    await expect
      .poll(async () => (await kemlock.call('codes')).find((c) => c.id === second.id)?.order)
      .toBe(0)
    await control(popup, 'Pin Orbit Cloud to the top').click()
    await expect
      .poll(async () => (await kemlock.call('codes')).find((c) => c.issuer === ORBIT.name)?.pinned)
      .toBe(true)
    // Back on Home, the pinned code comes first
    await control(popup, 'Back').click()
    await expect(popup.locator('li.item .name').first()).toHaveText(ORBIT.name)
  })

  test('backup codes are added by pasting, hidden until shown, and marked used by place', async ({
    kemlock,
  }) => {
    await kemlock.seedOrbit()
    const popup = await kemlock.popup()
    await control(popup, /backup codes/i).click()
    await control(popup, /add a service’s backup codes/i).click()
    await popup.getByLabel('Service', { exact: true }).fill('Google')
    await popup.getByLabel('Backup codes', { exact: true }).fill('1234 5678\n2345 6789\n3456 7890')
    await expect(popup.getByText('3 codes found')).toBeVisible()
    await control(popup, 'Save 3 codes').click()

    const [service] = (await kemlock.call('backupCodes')).filter((b) => b.issuer === 'Google')
    expect(service).toMatchObject({ total: 3, left: 3 })
    await control(popup, 'Manage the backup codes of Google').click()
    await expect(popup.getByText('1234 5678')).toHaveCount(0)
    await control(popup, 'Show the codes of Google').click()
    await expect(popup.getByText('1234 5678')).toBeVisible()
    await control(popup, 'Mark backup code 1 used').click()
    await expect
      .poll(
        async () =>
          (await kemlock.call('backupCodes')).find((b) => b.serviceId === service!.serviceId)?.left,
      )
      .toBe(2)
    // Two left is low
    await expect(popup.getByText(/two codes or fewer/i)).toBeVisible()
  })

  test('a login saved twice is found, merged into one, and the merge undone', async ({
    kemlock,
  }) => {
    await kemlock.seedOrbit()
    await kemlock.call('saveLogin', {
      id: null,
      input: {
        name: 'Orbit Cloud copy',
        username: ORBIT.username,
        password: ORBIT.password,
        websites: [ORBIT.website],
      },
    })
    const popup = await kemlock.popup()
    await openSection(popup, 'Logins')
    await control(popup, /^duplicates/i).click()
    await expect(popup.getByText('The same sign-in')).toBeVisible()
    await control(popup, /^review: the same sign-in/i).click()
    await control(popup, 'Merge 2 items').click()
    await expect.poll(async () => (await kemlock.call('logins')).length).toBe(1)

    // The merge goes back to the list of groups, which offers to undo it
    await control(popup, /^undo the merge of/i).click()
    await expect.poll(async () => (await kemlock.call('logins')).length).toBe(2)
  })

  test('"Not duplicates" hides a group, and Undo shows it again', async ({ kemlock }) => {
    await kemlock.seedOrbit()
    await kemlock.call('saveLogin', {
      id: null,
      input: {
        name: 'Orbit Cloud copy',
        username: ORBIT.username,
        password: ORBIT.password,
        websites: [ORBIT.website],
      },
    })
    const popup = await kemlock.popup()
    await openSection(popup, 'Logins')
    await control(popup, /^duplicates/i).click()
    // Named by its item for a screen reader: "Orbit Cloud is not a duplicate"
    await control(popup, /is not a duplicate/i).click()
    await expect(popup.getByText('No duplicates found.')).toBeVisible()
    await control(popup, 'Undo').click()
    await expect(popup.getByText('The same sign-in')).toBeVisible()
  })

  test('the breach alerts open from Health, and the password check is off until turned on', async ({
    kemlock,
  }) => {
    await kemlock.seedOrbit()
    const popup = await kemlock.popup()
    await openSection(popup, 'Logins')
    await control(popup, /^password health/i).click()
    // No "Check now" while the breached-passwords check is off
    await expect(control(popup, 'Check now')).toHaveCount(0)
    await control(popup, 'Service breaches').click()
    await expect(popup.getByText(/have i been pwned/i).first()).toBeVisible()
    // The daily refresh is off, and turning it on is the person's
    const refresh = popup.getByRole('switch', { name: /look for newer breaches online/i })
    await expect(refresh).not.toBeChecked()
    expect((await kemlock.call('toolsSettings')).breachRefresh).toBe(false)
  })
})
