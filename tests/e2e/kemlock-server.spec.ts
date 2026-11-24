// Sync with Kemlock Server (docs/plans/add-kemlock-server-sync.md). These need a real server, so
// they are skipped unless KEMLOCK_SERVER_URL is set:
//
//   KEMLOCK_SERVER_URL=https://kemlock.example \
//   KEMLOCK_SERVER_EMAIL=me@example.com KEMLOCK_SERVER_PASSWORD='master password' \
//   [KEMLOCK_SERVER_TOTP_SECRET=BASE32 for an account with an authenticator] \
//   npm run test:e2e -- kemlock-server
//
// The address must be https. The account should have no other trusted device, so that its key opens
// with the master password; an account that asks for an approval from a phone can't be signed in
// by a test. SSO is tested only with KEMLOCK_SERVER_SSO=1, and only against a server that has this
// extension's id (tests/e2e/extension-key.ts, EXTENSION_ID) in KEMLOCK_BROWSER_EXTENSION_IDS: the
// server refuses SSO from any extension id that is not on that list.
import { EXTENSION_ID } from './extension-key'
import { expect, PASSWORD, test, type Kemlock } from './kemlock'
import { totp } from './otp'
import { allowAccess, control, enterAddress, pickPlace, setBrowserPassword } from './ui'

const server = process.env.KEMLOCK_SERVER_URL ?? ''
const email = process.env.KEMLOCK_SERVER_EMAIL ?? ''
const masterPassword = process.env.KEMLOCK_SERVER_PASSWORD ?? ''
const totpSecret = process.env.KEMLOCK_SERVER_TOTP_SECRET

/** Signs in as the setup tab's steps do, answering what the account asks. */
async function signIn(kemlock: Kemlock): Promise<void> {
  let step = await kemlock.call('signInKemlock', { server, email, password: masterPassword })
  for (let i = 0; i < 6 && step.step !== 'done'; i++) {
    switch (step.step) {
      case 'second':
        test.skip(!totpSecret, 'the account asks for a second step: set KEMLOCK_SERVER_TOTP_SECRET')
        step = await kemlock.call('answerStep', {
          answer: {
            step: 'second',
            method: 'authenticator',
            code: totp(totpSecret!),
            remember: false,
          },
        })
        break
      case 'masterPassword':
        step = await kemlock.call('answerStep', {
          answer: { step: 'masterPassword', password: masterPassword },
        })
        break
      case 'firstSync':
        step = await kemlock.call('answerStep', { answer: { step: 'firstSync', go: true } })
        break
      case 'approval':
        test.skip(true, 'the account wants an approval from another device')
        break
      default:
        throw new Error(`sign-in stopped at ${JSON.stringify(step)}`)
    }
  }
  expect(step.step).toBe('done')
}

test.describe('Kemlock Server, address checks (no server needed)', () => {
  test('an http address is refused', async ({ kemlock }) => {
    await kemlock.createVault()
    const step = await kemlock.call('signInKemlock', {
      server: 'http://vault.example',
      email: 'a@b.c',
      password: 'x',
    })
    expect(step).toMatchObject({ step: 'error' })
  })

  test('an address that is not a Kemlock Server is refused before anything is sent', async ({
    kemlock,
    site,
  }) => {
    await kemlock.createVault()
    const step = await kemlock.call('signInKemlock', {
      server: 'https://orbit-cloud.com',
      email: 'a@b.c',
      password: 'x',
    })
    expect(step).toMatchObject({ step: 'error', problem: 'kemlockAddress' })
    expect(site.posts).toEqual([])
  })
})

test.describe('Kemlock Server', () => {
  test.skip(
    !server || !email || !masterPassword,
    'set KEMLOCK_SERVER_URL, KEMLOCK_SERVER_EMAIL and KEMLOCK_SERVER_PASSWORD',
  )

  test('signs in with the master password and syncs as a device of the account', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    const status = await kemlock.call('syncNow')
    expect(status.problem).toBeUndefined()
    expect(status).toMatchObject({ place: 'kemlock', account: email })
    // The device is "Kemlock · Chrome", "· Edge" or "· Firefox", as the phone's device list shows it
    expect(status.deviceName).toMatch(/^Kemlock · (Chrome|Edge|Firefox)/)
    expect(new URL(status.server).host).toBe(new URL(server).host)

    // The browser's own password is what unlocks it, not the account's
    await kemlock.call('lock')
    expect((await kemlock.call('unlock', { password: masterPassword })).ok).toBe(false)

    // Unlocked again with the browser's own password, the popup says where it syncs
    expect((await kemlock.call('unlock', { password: PASSWORD })).ok).toBe(true)
    const popup = await kemlock.popup()
    const host = new URL(server).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await expect(popup.getByText(new RegExp(host, 'i')).first()).toBeVisible()
  })

  test('the codes and logins of the account are listed', async ({ kemlock }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    await kemlock.call('syncNow')
    // Whatever the account holds: the lists answer, and every item is kept for the next sync
    const [codes, logins] = await Promise.all([kemlock.call('codes'), kemlock.call('logins')])
    expect(Array.isArray(codes) && Array.isArray(logins)).toBe(true)
  })

  test("signing out keeps the browser's items", async ({ kemlock }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    await kemlock.call('syncNow')
    const before = (await kemlock.call('codes')).length
    await kemlock.call('signOut')
    expect(await kemlock.call('syncStatus')).toBeNull()
    expect(await kemlock.call('codes')).toHaveLength(before)
  })

  test.describe('SSO', () => {
    test.skip(
      process.env.KEMLOCK_SERVER_SSO !== '1',
      `needs a server with extension id ${EXTENSION_ID} in KEMLOCK_BROWSER_EXTENSION_IDS: set KEMLOCK_SERVER_SSO=1`,
    )

    test("the SSO button opens the server's sign-in in the browser's own window", async ({
      kemlock,
    }) => {
      const setup = await kemlock.setup()
      await setBrowserPassword(setup, PASSWORD)
      await pickPlace(setup, 'Kemlock Server')
      await enterAddress(setup, server)
      await allowAccess(setup)
      const opened = kemlock.context.waitForEvent('page', {
        predicate: (page) => page.url().includes(new URL(server).host),
        timeout: 30_000,
      })
      await control(setup, /sso|single sign-on/i).click()
      // The identity provider is the server's own to configure: here, that its page opened is the proof
      expect(new URL((await opened).url()).host).toBe(new URL(server).host)
    })
  })
})
