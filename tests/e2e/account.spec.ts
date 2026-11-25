// The Kemlock Server account in the browser (docs/plans/add-browser-account.md). The first group needs no server: the account page
// says what to do while the vault doesn't sync with Kemlock Server. The second needs a real one, so it is skipped unless
// KEMLOCK_SERVER_URL, KEMLOCK_SERVER_EMAIL and KEMLOCK_SERVER_PASSWORD are set (see kemlock-server.spec.ts for how), and the account
// should have no other trusted device, so that its key opens with the master password. Making an account is tried only with
// KEMLOCK_SERVER_REGISTER=1, against a server whose sign-ups are open.
import { expect, test, type Kemlock } from './kemlock'
import { totp } from './otp'
import { control, passwordBoxes } from './ui'

const server = process.env.KEMLOCK_SERVER_URL ?? ''
const email = process.env.KEMLOCK_SERVER_EMAIL ?? ''
const masterPassword = process.env.KEMLOCK_SERVER_PASSWORD ?? ''
const totpSecret = process.env.KEMLOCK_SERVER_TOTP_SECRET

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
      case 'move':
        test.skip(true, 'this vault would move: the test starts from a vault with no old store')
        break
      default:
        test.skip(true, `the sign-in stopped at ${step.step}`)
    }
  }
  expect(step.step).toBe('done')
}

test.describe('the account page, with no server', () => {
  test('says the vault does not sync with Kemlock Server, and offers to set it up', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    const page = await kemlock.account('devices')
    await expect(page.getByText(/doesn.t sync with Kemlock Server/i)).toBeVisible()
    await expect(control(page, /set up kemlock server/i)).toBeVisible()
    // No section is shown while there is nothing to show
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })
})

test.describe('the account on a Kemlock Server', () => {
  test.skip(
    !server || !email || !masterPassword,
    'set KEMLOCK_SERVER_URL, KEMLOCK_SERVER_EMAIL and KEMLOCK_SERVER_PASSWORD',
  )

  test('lists this browser among the devices, and none waiting for approval', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    const page = await kemlock.account('approvals')
    await expect(page.getByText(/no device is waiting/i)).toBeVisible()
    await control(page, /^devices$/i).click()
    await expect(page.getByText(/Kemlock · (Chrome|Edge|Firefox)/).first()).toBeVisible()
    await expect(page.getByText(/this browser/i).first()).toBeVisible()
  })

  test('shows emergency access, the Recovery Kit and the second steps of the account', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    const page = await kemlock.account('emergency')
    await expect(page.getByRole('heading', { name: /emergency access/i })).toBeVisible()
    await control(page, /^recovery kit$/i).click()
    await expect(page.getByRole('heading', { name: /recovery kit/i }).first()).toBeVisible()
    await control(page, /^second steps$/i).click()
    await expect(page.getByText(/authenticator app/i).first()).toBeVisible()
  })

  test('makes a Recovery Kit that is shown once, and keeps it after one piece is typed back', async ({
    kemlock,
  }) => {
    test.slow()
    await kemlock.createVault()
    await signIn(kemlock)
    const page = await kemlock.account('recovery')
    const noKit = await page.getByText(/this account has no recovery kit/i).isVisible()
    test.skip(!noKit, 'the account has a kit already: replacing it needs a code from its mail')
    await control(page, /make a recovery kit/i).click()
    const pieces = await page.locator('code.piece').allInnerTexts()
    expect(pieces).toHaveLength(3)
    await page.getByLabel(/type one piece back/i).fill(pieces[0]!)
    await control(page, /keep this kit/i).click()
    await expect(page.getByText(/kit [A-Z2-7]{8}/)).toBeVisible()
  })

  test('says what the vault would move, or that there is nothing to move', async ({ kemlock }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    const page = await kemlock.account('move')
    await expect(page.getByText(/nothing to move/i)).toBeVisible()
  })
})

test.describe('making an account', () => {
  test.skip(
    !server || process.env.KEMLOCK_SERVER_REGISTER !== '1',
    'set KEMLOCK_SERVER_URL and KEMLOCK_SERVER_REGISTER=1, against a server whose sign-ups are open',
  )

  test('creates an account, signs in as a device and syncs', async ({ kemlock }) => {
    test.slow()
    await kemlock.createVault()
    const address = `kemlock-e2e-${Date.now()}@example.com`
    const password = 'an account password that is long enough 7!'
    const step = await kemlock.call('account', {
      request: { op: 'register', server, email: address, name: 'E2E', password },
    })
    expect(step).toMatchObject({ step: 'done' })
    const status = await kemlock.call('syncNow')
    expect(status).toMatchObject({ place: 'kemlock', account: address })
    expect(status.problem).toBeUndefined()
    // The page the person sees names this browser
    const page = await kemlock.account('devices')
    await expect(page.getByText(/this browser/i).first()).toBeVisible()
    expect(await passwordBoxes(page).count()).toBe(0)
  })
})
