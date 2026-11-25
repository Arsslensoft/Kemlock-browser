// Sends (docs/plans/add-sends.md): the Sends tab and the popup's list. The first group needs no server; the second makes, lists,
// copies and opens a Send on a real Kemlock Server, and is skipped unless the run is pointed at one (see kemlock-server.spec.ts):
//
//   KEMLOCK_SERVER_URL=https://kemlock.example KEMLOCK_SERVER_EMAIL=me@example.com \
//   KEMLOCK_SERVER_PASSWORD='master password' npm run test:e2e -- sends
import { expect, test, type Kemlock } from './kemlock'
import { totp } from './otp'

const server = process.env.KEMLOCK_SERVER_URL ?? ''
const email = process.env.KEMLOCK_SERVER_EMAIL ?? ''
const masterPassword = process.env.KEMLOCK_SERVER_PASSWORD ?? ''
const totpSecret = process.env.KEMLOCK_SERVER_TOTP_SECRET

/** The Sends tab, on its New Send or its Open a Send page. */
async function sendsTab(kemlock: Kemlock, page: 'new' | 'open') {
  const tab = await kemlock.context.newPage()
  await tab.goto(kemlock.url(`src/sends/index.html#${page}`))
  return tab
}

test.describe('Sends without Kemlock Server sync', () => {
  test('the Sends tab says where Sends are, and shows no form to make one', async ({ kemlock }) => {
    await kemlock.createVault()
    const tab = await sendsTab(kemlock, 'new')
    await expect(tab.getByText(/Sends need Kemlock Server sync/)).toBeVisible()
    await expect(tab.getByRole('button', { name: 'Make the link' })).toHaveCount(0)
    await expect(tab.getByRole('button', { name: 'Set up sync' })).toBeVisible()
  })

  test('the popup lists nothing and says so, and still opens a link', async ({ kemlock }) => {
    await kemlock.createVault()
    const popup = await kemlock.popup()
    await popup.getByRole('button', { name: /^Sends/ }).click()
    await expect(popup.getByText(/Sends need Kemlock Server sync/)).toBeVisible()
    await expect(popup.getByRole('button', { name: 'New Send' })).toBeDisabled()
    const opened = kemlock.context.waitForEvent('page')
    await popup.getByRole('button', { name: /^Open a Send/ }).click()
    await (await opened).waitForURL(/\/src\/sends\/index\.html#open$/)
  })

  test('Open a Send takes only a Send link, and asks the server for nothing else', async ({
    kemlock,
    site,
  }) => {
    await kemlock.createVault()
    const tab = await sendsTab(kemlock, 'open')
    await tab.getByLabel('Send link').fill('hello')
    await tab.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(tab.getByText(/isn.t a Send link/)).toBeVisible()
    expect(site.posts).toEqual([])
  })

  test('Sends are for the popup and the Sends tab: the vault answers a request from no other page', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    const answer = await kemlock.call('sends')
    expect(answer).toEqual({ ok: true, value: { available: false, place: null } })
    // Making and opening are the Sends tab's alone, which the popup the tests call from is not
    await expect(
      kemlock.call('sendOpen', { link: 'https://kem.example/#/send/x/y' }),
    ).rejects.toThrow(/refused/)
    await expect(
      kemlock.call('sendMake', {
        input: { kind: 'text', name: 'a', text: 'b', notes: '', deleteInDays: 7, hideEmail: false },
      }),
    ).rejects.toThrow(/refused/)
  })
})

test.describe('Sends on Kemlock Server', () => {
  test.skip(
    !server || !email || !masterPassword,
    'set KEMLOCK_SERVER_URL, KEMLOCK_SERVER_EMAIL and KEMLOCK_SERVER_PASSWORD',
  )

  async function signIn(kemlock: Kemlock): Promise<void> {
    let step = await kemlock.call('signInKemlock', { server, email, password: masterPassword })
    for (let i = 0; i < 6 && step.step !== 'done'; i++) {
      switch (step.step) {
        case 'second':
          test.skip(
            !totpSecret,
            'the account asks for a second step: set KEMLOCK_SERVER_TOTP_SECRET',
          )
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

  test('makes a text Send, copies its link to the clipboard that clears itself, opens it as a recipient, lists it and deletes it', async ({
    kemlock,
  }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    const secret = `the wifi password is ${Date.now()}`

    // Make it
    const make = await sendsTab(kemlock, 'new')
    await make.getByLabel('Name').fill('E2E Send')
    await make.getByLabel('Text to send').fill(secret)
    await make.getByRole('button', { name: 'Make the link' }).click()
    await expect(make.getByText('Your Send is ready')).toBeVisible()
    // The page never shows the link: it is copied
    await expect(make.getByText(/#\/send\//)).toHaveCount(0)
    await make.getByRole('button', { name: 'Copy link' }).click()
    const link = await kemlock.clipboard()
    expect(link).toMatch(/^https:\/\/.+\/#\/send\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{43}$/)
    await make.close()

    // Open it as a recipient
    const open = await sendsTab(kemlock, 'open')
    await open.getByLabel('Send link').fill(link)
    await open.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(open.getByText(secret)).toBeVisible()
    await open.getByRole('button', { name: 'Close' }).click()
    await open.close()

    // List it, and delete it
    const popup = await kemlock.popup()
    await popup.getByRole('button', { name: /^Sends/ }).click()
    await expect(popup.getByText('E2E Send')).toBeVisible()
    await expect(popup.getByText(/Text · Active · Opens: 1/)).toBeVisible()
    await popup.getByRole('button', { name: 'Details of E2E Send' }).click()
    await popup.getByRole('button', { name: 'Delete E2E Send' }).click()
    await popup.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(popup.getByText('E2E Send')).toHaveCount(0)
  })

  test('a Send turned off does not open, and does again when turned on', async ({ kemlock }) => {
    await kemlock.createVault()
    await signIn(kemlock)
    const make = await sendsTab(kemlock, 'new')
    await make.getByLabel('Name').fill('E2E switch')
    await make.getByLabel('Text to send').fill('x')
    await make.getByRole('button', { name: 'Make the link' }).click()
    await make.getByRole('button', { name: 'Copy link' }).click()
    const link = await kemlock.clipboard()
    await make.close()

    const popup = await kemlock.popup()
    await popup.getByRole('button', { name: /^Sends/ }).click()
    await popup.getByRole('button', { name: 'Details of E2E switch' }).click()
    await popup.getByRole('switch', { name: 'On' }).uncheck()

    const open = await sendsTab(kemlock, 'open')
    await open.getByLabel('Send link').fill(link)
    await open.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(open.getByText(/isn.t available/)).toBeVisible()

    await popup.getByRole('switch', { name: 'On' }).check()
    await open.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(open.getByText('Close')).toBeVisible()

    await popup.getByRole('button', { name: 'Delete E2E switch' }).click()
    await popup.getByRole('button', { name: 'Delete', exact: true }).click()
  })
})
