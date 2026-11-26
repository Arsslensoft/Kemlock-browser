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
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { EXTENSION_ID } from './extension-key'
import {
  addOwnField,
  chooseFile,
  editButton,
  openFileItem,
  openFilesTab,
  openLogin,
  openNote,
  saveButton,
} from './item-ui'
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

  // Files and custom fields (docs/plans/add-item-format.md): they work only here, with Kemlock Server's file routes and its
  // admin-defined fields. Each test makes its own items and takes them out again, since the account is a real one.
  test.describe('files and fields', () => {
    const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    const pattern = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    /** Over 1 MiB, so staging and downloading take more than one piece. */
    const bigFile = () => randomBytes(1_572_864 + 17)

    /** Signs in, syncs, and says files are carried (the sync is with Kemlock Server). */
    async function ready(kemlock: Kemlock): Promise<void> {
      await kemlock.createVault()
      await signIn(kemlock)
      expect((await kemlock.call('syncNow')).problem).toBeUndefined()
      expect(await kemlock.call('syncStatus')).toMatchObject({
        place: 'kemlock',
        fileSync: 'kemlock',
      })
    }

    /** The Files tab takes the file; some builds want one more click to start. */
    async function giveFile(
      kemlock: Kemlock,
      hash: string,
      file: { name: string; mimeType: string; buffer: Buffer },
    ): Promise<Page> {
      const tab = await openFilesTab(kemlock.context, (path) => kemlock.url(path), hash)
      await chooseFile(tab, file)
      await tab
        .getByRole('button', { name: /^(upload|attach|add)( files?)?$/i })
        .click({ timeout: 2000 })
        .catch(() => undefined)
      return tab
    }

    /** Presses a Download button and reads what the browser saved. */
    async function downloaded(popup: Page): Promise<{ name: string; bytes: Buffer }> {
      const [download] = await Promise.all([
        popup.waitForEvent('download', { timeout: 60_000 }),
        control(popup, /^download\b/i).click(),
      ])
      return { name: download.suggestedFilename(), bytes: await readFile((await download.path())!) }
    }

    /** A destructive button, then its confirmation when the page asks for one. */
    async function confirmed(popup: Page, name: RegExp): Promise<void> {
      await control(popup, name).click()
      const confirm = popup.getByRole('button', { name: /^(remove|delete|yes)$/i }).last()
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
    }

    test('a file attached to a note is downloaded as it was, and removed', async ({ kemlock }) => {
      await ready(kemlock)
      const note = await kemlock.call('saveNote', {
        id: null,
        input: { title: `Kemlock e2e attachment ${Date.now()}`, text: 'a note with a file' },
      })
      try {
        const data = bigFile()
        const name = 'e2e-attachment.bin'
        await giveFile(kemlock, `attach/${note.id}`, {
          name,
          mimeType: 'application/octet-stream',
          buffer: data,
        })
        await expect
          .poll(
            async () => (await kemlock.call('revealNote', { id: note.id })).attachments.length,
            {
              timeout: 120_000,
            },
          )
          .toBe(1)
        const [attached] = (await kemlock.call('revealNote', { id: note.id })).attachments
        expect(attached).toMatchObject({ name, size: data.length, onServer: true })
        expect(attached!.sha256).toBe(sha256(data))

        // The popup downloads it back, piece by piece: the same bytes, under the same name
        const popup = await kemlock.popup()
        await openNote(popup, note.title)
        const got = await downloaded(popup)
        expect(got.name).toBe(name)
        expect(got.bytes.length).toBe(data.length)
        expect(sha256(got.bytes)).toBe(sha256(data))
        expect(got.bytes.equals(data)).toBe(true)

        // Removing it takes it off the note, and the next sync takes it off the server
        await confirmed(popup, /^remove\b/i)
        await expect
          .poll(async () => (await kemlock.call('revealNote', { id: note.id })).attachments.length)
          .toBe(0)
        expect((await kemlock.call('syncNow')).problem).toBeUndefined()
        expect((await kemlock.call('revealNote', { id: note.id })).attachments).toEqual([])
      } finally {
        await kemlock.call('deleteNote', { id: note.id }).catch(() => undefined)
        await kemlock.call('syncNow').catch(() => undefined)
      }
    })

    test('a File item is added, downloaded as it was, and deleted', async ({ kemlock }) => {
      await ready(kemlock)
      const data = bigFile()
      const fileName = `kemlock-e2e-${Date.now()}.bin`
      let id: string | undefined
      try {
        await giveFile(kemlock, 'newFile', {
          name: fileName,
          mimeType: 'application/octet-stream',
          buffer: data,
        })
        await expect
          .poll(
            async () => (await kemlock.call('files')).find((f) => f.fileName === fileName)?.id,
            {
              timeout: 120_000,
            },
          )
          .toBeTruthy()
        const item = (await kemlock.call('files')).find((f) => f.fileName === fileName)!
        id = item.id
        expect(item).toMatchObject({ size: data.length, onServer: true })

        const popup = await kemlock.popup()
        await openFileItem(popup, item.name)
        const got = await downloaded(popup)
        expect(got.name).toBe(fileName)
        expect(got.bytes.equals(data)).toBe(true)

        await confirmed(popup, /^delete\b/i)
        await expect
          .poll(async () => (await kemlock.call('files')).some((f) => f.id === item.id))
          .toBe(false)
        id = undefined
      } finally {
        if (id) await kemlock.call('deleteFile', { id }).catch(() => undefined)
        await kemlock.call('syncNow').catch(() => undefined)
      }
    })

    test('the fields an admin defined are offered in the editor, and one is added', async ({
      kemlock,
    }) => {
      await ready(kemlock)
      const defs = await kemlock.call('customFieldDefs', { refresh: true })
      const def = defs.fields.find((f) => f.kinds === 'all' || f.kinds.includes('login'))
      test.skip(!def, 'the account has no admin-defined field for logins')
      const login = await kemlock.call('saveLogin', {
        id: null,
        input: {
          name: `Kemlock e2e fields ${Date.now()}`,
          username: 'e2e',
          password: 'e2e-password-1',
          websites: ['e2e.example.com'],
        },
      })
      try {
        const popup = await kemlock.popup()
        await openLogin(popup, login.name)
        await editButton(popup).click()
        await control(popup, /add a field/i).click()
        // Each admin field the login may have is a choice, and "Your own field" is one only when the account allows it
        await expect(control(popup, pattern(def!.name))).toBeVisible()
        if (defs.allowOwn) await expect(control(popup, /your own field/i)).toBeVisible()
        else await expect(popup.getByText(/your own field/i)).toHaveCount(0)

        if (def!.type === 'text') {
          await control(popup, pattern(def!.name)).click()
          await popup
            .getByLabel(/^value\b|field value/i)
            .last()
            .fill('e2e value')
          await saveButton(popup).click()
          await expect
            .poll(async () =>
              (await kemlock.call('logins'))
                .find((l) => l.id === login.id)
                ?.fields.find((f) => f.adminField === def!.id),
            )
            .toMatchObject({ name: def!.name, kind: 'text', value: 'e2e value' })
        }
      } finally {
        await kemlock.call('deleteLogin', { id: login.id }).catch(() => undefined)
        await kemlock.call('syncNow').catch(() => undefined)
      }
    })

    test('when the account allows it, a field of the person’s own is added', async ({
      kemlock,
    }) => {
      await ready(kemlock)
      const defs = await kemlock.call('customFieldDefs', {})
      test.skip(!defs.allowOwn, 'this server lets only its admin-defined fields be used')
      const login = await kemlock.call('saveLogin', {
        id: null,
        input: {
          name: `Kemlock e2e own field ${Date.now()}`,
          username: 'e2e',
          password: 'e2e-password-1',
          websites: ['e2e.example.com'],
        },
      })
      try {
        const popup = await kemlock.popup()
        await openLogin(popup, login.name)
        await editButton(popup).click()
        await addOwnField(popup, 'E2E note', 'hello')
        await saveButton(popup).click()
        await expect
          .poll(async () =>
            (await kemlock.call('logins'))
              .find((l) => l.id === login.id)
              ?.fields.map((f) => f.name),
          )
          .toContain('E2E note')
      } finally {
        await kemlock.call('deleteLogin', { id: login.id }).catch(() => undefined)
        await kemlock.call('syncNow').catch(() => undefined)
      }
    })
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
