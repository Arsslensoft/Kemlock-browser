// Unlocking the browser's vault with a passkey, Windows Hello or a security key (docs/plans/add-passkey-unlock.md), over a virtual
// authenticator with the PRF extension (Chrome's DevTools WebAuthn domain): the unlock tab makes a credential for the open vault, the
// vault locks, the same tab opens it again from the authenticator's PRF output, and the password keeps working throughout.
//
// The virtual authenticator belongs to the tab it was added in, so one tab does both ceremonies (a reload between them keeps it).
// Firefox has no virtual authenticator for automation: its relying party and permission are checked by the unit tests and by hand.
import type { CDPSession, Page } from '@playwright/test'
import { expect, PASSWORD, test, type Kemlock } from './kemlock'

/** A tab with a platform authenticator that has user verification and the PRF extension, which presses itself. */
async function tabWithAuthenticator(kemlock: Kemlock): Promise<{ page: Page; cdp: CDPSession }> {
  const page = await kemlock.context.newPage()
  const cdp = await kemlock.context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  })
  return { page, cdp }
}

const addPage = (kemlock: Kemlock) => kemlock.url('src/unlock/index.html#add')
const unlockPage = (kemlock: Kemlock) => kemlock.url('src/unlock/index.html#unlock')

/** What is set up, as the lock screen and Settings read it. */
const info = (kemlock: Kemlock) => kemlock.call('passkeyUnlockInfo')

test.describe('unlocking with a passkey', () => {
  test('makes a credential for the open vault, locks, and opens the vault again from it', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    await kemlock.seedOrbit()
    const { page } = await tabWithAuthenticator(kemlock)

    await page.goto(addPage(kemlock))
    await page.getByLabel('Name').fill('Test laptop')
    // A wrong password first: the credential is kept, and only the password is asked again
    await page.getByLabel('Vault password').fill('not the password')
    await page.getByRole('button', { name: 'Add a passkey or security key' }).click()
    await expect(page.getByText('That isn’t the password.')).toBeVisible()
    await page.getByLabel('Vault password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Add a passkey or security key' }).click()
    await expect(page.getByText(/Added Test laptop/)).toBeVisible()

    const set = await info(kemlock)
    expect(set.credentials).toMatchObject([
      { name: 'Test laptop', attachment: 'platform', transports: expect.any(Array) },
    ])
    expect(set.passwordRequired).toBeUndefined()

    // The record is ciphertext and public values: no PRF output, no private key, no password
    const record = JSON.stringify((await kemlock.storage()).backmycodes_extension_passkey_unlock)
    expect(record).toContain(set.credentials[0]!.credentialId)
    expect(record).not.toContain(PASSWORD)

    await kemlock.call('lock')
    expect((await kemlock.call('popup')).state.unlocked).toBe(false)

    // The unlock tab asks the authenticator by itself, opens the vault and closes
    await page.goto(unlockPage(kemlock))
    await page.reload()
    await expect
      .poll(async () => (await kemlock.call('popup')).state.unlocked, { timeout: 20_000 })
      .toBe(true)
    // The vault holds what it held
    expect((await kemlock.call('logins')).map((login) => login.name)).toEqual(['Orbit Cloud'])
    // And the credential says when it was used
    expect((await info(kemlock)).credentials[0]!.lastUsedAt).toBeGreaterThan(0)
  })

  test('leaves the password working, and removing the credential leaves only the password', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    const { page } = await tabWithAuthenticator(kemlock)
    await page.goto(addPage(kemlock))
    await page.getByLabel('Vault password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Add a passkey or security key' }).click()
    await expect(page.getByText(/Added /)).toBeVisible()

    await kemlock.call('lock')
    expect(await kemlock.call('unlock', { password: PASSWORD })).toMatchObject({ ok: true })
    const [credential] = (await info(kemlock)).credentials
    await kemlock.call('removePasskeyUnlock', { id: credential!.id })
    expect((await info(kemlock)).credentials).toEqual([])
    expect(await kemlock.storage()).not.toHaveProperty('backmycodes_extension_passkey_unlock')
    await kemlock.call('lock')
    expect(await kemlock.call('unlock', { password: PASSWORD })).toMatchObject({ ok: true })
  })

  test('does not unlock a vault that is locked when a credential is added', async ({ kemlock }) => {
    await kemlock.createVault()
    await kemlock.call('lock')
    const { page } = await tabWithAuthenticator(kemlock)
    await page.goto(addPage(kemlock))
    await expect(page.getByText(/Unlock Kemlock with the password first/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a passkey or security key' })).toBeDisabled()
  })
})
