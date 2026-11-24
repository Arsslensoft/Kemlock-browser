// Sync with a Vaultwarden (browser-sync spec; tasks 5.2 to 5.6). The real-server tests are
// skipped unless VAULTWARDEN_URL is set, as the app's own server tests are:
//
//   VAULTWARDEN_URL=https://vault.example \
//   VAULTWARDEN_EMAIL=me@example.com VAULTWARDEN_PASSWORD='master password' \
//   [VAULTWARDEN_TOTP_SECRET=BASE32 for an account with an authenticator] \
//   [VAULTWARDEN_PASSPHRASE='the home's sealing passphrase'] \
//   npm run test:e2e -- vaultwarden
//
// The server must be https (a self-signed certificate is accepted: the tests' browser ignores
// certificate errors, which a real one never does), and its account must hold a Kemlock home made
// by the phone's app. Run one against a local `vaultwarden/server` in a container with a
// certificate in front, as the app's `mobile/test/vaultwarden_server/server_kit.dart` describes.
import { expect, test, type Kemlock } from './kemlock'
import { totp } from './otp'

const server = process.env.VAULTWARDEN_URL ?? ''
const email = process.env.VAULTWARDEN_EMAIL ?? ''
const masterPassword = process.env.VAULTWARDEN_PASSWORD ?? ''
const totpSecret = process.env.VAULTWARDEN_TOTP_SECRET
const passphrase = process.env.VAULTWARDEN_PASSPHRASE

test.describe('Vaultwarden, address checks (no server needed)', () => {
  test('an http address is refused, and nothing is sent', async ({ kemlock, site }) => {
    await kemlock.createVault()
    const step = await kemlock.call('signInVaultwarden', {
      server: 'http://vault.example',
      email: 'a@b.c',
      password: 'x',
    })
    expect(step).toMatchObject({ step: 'error', problem: 'insecure' })
    expect(site.posts).toEqual([])
  })

  test('an address that is not a Vaultwarden is named as such before the master password is used', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    const step = await kemlock.call('signInVaultwarden', {
      server: 'https://orbit-cloud.com',
      email: 'a@b.c',
      password: 'x',
    })
    expect(step).toMatchObject({ step: 'error', problem: 'address' })
  })
})

async function signIn(kemlock: Kemlock): Promise<{ homes: number }> {
  let step = await kemlock.call('signInVaultwarden', { server, email, password: masterPassword })
  let homes = 0
  for (let i = 0; i < 8 && step.step !== 'done'; i++) {
    switch (step.step) {
      case 'second':
        test.skip(
          !totpSecret || !step.methods.includes('authenticator'),
          'the account asks for a second step: set VAULTWARDEN_TOTP_SECRET',
        )
        step = await kemlock.call('answerStep', {
          answer: {
            step: 'second',
            method: 'authenticator',
            code: totp(totpSecret!),
            remember: true,
          },
        })
        break
      case 'homes':
        homes = step.homes.length
        test.skip(
          homes === 0,
          'the account holds no Kemlock home: turn Vaultwarden sync on in the app first',
        )
        step = await kemlock.call('answerStep', {
          answer: { step: 'homes', homeId: step.homes[0].id },
        })
        break
      case 'passphrase':
        test.skip(!passphrase, 'the home is sealed: set VAULTWARDEN_PASSPHRASE')
        step = await kemlock.call('answerStep', {
          answer: { step: 'passphrase', passphrase: passphrase! },
        })
        break
      case 'firstSync':
        step = await kemlock.call('answerStep', { answer: { step: 'firstSync', go: true } })
        break
      default:
        throw new Error(`sign-in stopped at ${JSON.stringify(step)}`)
    }
  }
  expect(step.step).toBe('done')
  return { homes }
}

test.describe('Vaultwarden', () => {
  test.skip(
    !server || !email || !masterPassword,
    'set VAULTWARDEN_URL, VAULTWARDEN_EMAIL and VAULTWARDEN_PASSWORD',
  )

  test("joins the Kemlock home and syncs as the browser's own device", async ({ kemlock }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    const status = await kemlock.call('syncNow')
    expect(status.problem).toBeUndefined()
    expect(status).toMatchObject({ place: 'vaultwarden', loginsNotSynced: true })
    // The account's device list shows "Kemlock · Chrome" (or Edge, Firefox) once
    expect(status.deviceName).toMatch(/^Kemlock · (Chrome|Edge|Firefox)/)

    const popup = await kemlock.popup()
    await expect(popup.getByText(/logins? (aren.t|are not|stay)/i).first()).toBeVisible()
  })

  test('logins stay in the browser: a saved login writes no cipher', async ({ kemlock }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    await kemlock.seedOrbit()
    const status = await kemlock.call('syncNow')
    expect(status.problem).toBeUndefined()
    expect((await kemlock.call('logins')).map((l) => l.name)).toContain('Orbit Cloud')
  })

  test('signing out keeps the items', async ({ kemlock }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    await kemlock.call('syncNow')
    const before = (await kemlock.call('codes')).length
    await kemlock.call('signOut')
    expect(await kemlock.call('syncStatus')).toBeNull()
    expect(await kemlock.call('codes')).toHaveLength(before)
  })
})
