// The browser-sync spec, over a WebDAV folder the way the phone leaves it: an in-memory server
// behind https, holding the sync files the app itself wrote (fixtures/app/).
import {
  DAV_LOGIN,
  FOLDER,
  SYNC_PATH,
  everyKind,
  joinFolder,
  personal,
  phoneWrites,
  readFolder,
  seedFile,
  withLogins,
} from './dav'
import { expect, ORBIT, PASSWORD, test } from './kemlock'
import { makeSyncFile, openSyncFile, totpNear } from './otp'
import {
  allowAccess,
  control,
  enterAddress,
  openSection,
  pickPlace,
  setBrowserPassword,
  signInToFolder,
} from './ui'

const PASSPHRASE = personal.passphrase
const HARBOR_LINK =
  'otpauth://totp/Harbor%20Notes:alex@harbornotes.app?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Harbor%20Notes'

test.describe('sync with a WebDAV folder', () => {
  test("setup joins the phone's folder and the codes appear in the popup", async ({
    kemlock,
    site,
  }) => {
    seedFile(site.dav, personal.text)
    const setup = await kemlock.setup()
    await setBrowserPassword(setup, PASSWORD)

    // "After the browser's password, setup asks where the phone syncs"
    await expect(setup.getByRole('heading', { name: /where does your phone sync/i })).toBeVisible()
    await pickPlace(setup, 'WebDAV')
    await expect(setup.getByRole('heading', { name: /connect your sync folder/i })).toBeVisible()
    await enterAddress(setup, FOLDER, true)
    // Access to the folder's address is asked on its own screen, before anything is sent to it
    await expect(setup.getByRole('heading', { name: /allow access to/i })).toBeVisible()
    await allowAccess(setup)
    await expect(setup.getByRole('heading', { name: /sign in to the folder/i })).toBeVisible()
    await signInToFolder(setup, { ...DAV_LOGIN, passphrase: PASSPHRASE })

    // The first sync is shown before it runs: what comes to this browser, and what would be removed
    await expect(setup.getByRole('heading', { name: /the first sync/i })).toBeVisible({
      timeout: 60_000,
    })
    await expect(setup.getByText(/items? comes? to this browser/i)).toBeVisible()
    await control(setup, /^start syncing$/i).click()
    await expect(setup.getByRole('heading', { name: /kemlock is ready/i })).toBeVisible({
      timeout: 60_000,
    })

    await expect.poll(async () => (await kemlock.call('codes')).length, { timeout: 60_000 }).toBe(3)
    expect((await kemlock.call('popup')).state.sync).toMatchObject({ place: 'webdav' })

    const popup = await kemlock.popup()
    await expect(popup.getByText('GitHub').first()).toBeVisible()
    await expect(popup.getByText('Société Générale ✓').first()).toBeVisible()
    await expect(popup.getByText('Steam').first()).toBeVisible()
    // The live code is the one this test computes from the fixture's secret
    // GitHub is listed twice: its code, and its backup codes under a fold. The code's row has the copy
    // button, and says how many backup codes are left and, near the end of the period, the next code
    const githubRow = popup
      .locator('li')
      .filter({ has: popup.getByRole('button', { name: 'Copy the MFA code of GitHub' }) })
    const shown = (await githubRow.innerText())
      .replace(/backup codes left: \d+/i, '')
      .split(/next/i)[0]
    const github = shown.replace(/\s/g, '').match(/\d{6,8}/)![0]
    expect(totpNear('JBSWY3DPEHPK3PXP')).toContain(github)
  })

  test('a wrong passphrase stores nothing', async ({ kemlock, site }) => {
    seedFile(site.dav, personal.text)
    await kemlock.createVault()
    let step = await kemlock.call('signInWebdav', { folder: FOLDER, ...DAV_LOGIN })
    expect(step.step).toBe('passphrase')
    step = await kemlock.call('answerStep', {
      answer: { step: 'passphrase', passphrase: 'not the passphrase' },
    })
    expect(step).toMatchObject({ step: 'error', problem: 'key' })
    expect(await kemlock.call('syncStatus')).toBeNull()
    expect(await kemlock.call('codes')).toEqual([])
    // Nothing was written to the folder either
    expect(site.dav.writes()).toEqual([])
  })

  test('a wrong WebDAV password is refused by the server and says so', async ({
    kemlock,
    site,
  }) => {
    seedFile(site.dav, personal.text)
    await kemlock.createVault()
    const step = await kemlock.call('signInWebdav', {
      folder: FOLDER,
      username: 'sam',
      password: 'wrong',
    })
    expect(step).toMatchObject({ step: 'error', problem: 'auth' })
  })

  test('only https folders are accepted', async ({ kemlock }) => {
    await kemlock.createVault()
    const step = await kemlock.call('signInWebdav', {
      folder: `http://${new URL(FOLDER).host}/kemlock/`,
      ...DAV_LOGIN,
    })
    expect(step).toMatchObject({ step: 'error', problem: 'insecure' })
  })

  test('a change in the browser reaches the file, logins included', async ({ kemlock, site }) => {
    seedFile(site.dav, personal.text)
    await kemlock.createVault()
    expect(await joinFolder(kemlock, PASSPHRASE)).toBe('done')
    expect(await kemlock.call('codes')).toHaveLength(3)

    await kemlock.seedOrbit()
    await kemlock.call('addCodeFromLink', { otpauth: HARBOR_LINK })
    const before = site.dav.etag(SYNC_PATH)
    await kemlock.call('syncNow')

    // Written against the ETag it read: no write over a change it hadn't seen
    expect(site.dav.etag(SYNC_PATH)).not.toBe(before)
    const written = site.dav.writes(SYNC_PATH).at(-1)!
    expect(written.ifMatch).toBe(before)
    // The phone's side opens it with the passphrase: its codes, and the browser's additions
    const doc = readFolder(site.dav, PASSPHRASE)
    const issuers = (doc.accounts ?? []).map((a) => a.issuer)
    expect(issuers).toEqual(
      expect.arrayContaining(['GitHub', 'Steam', 'Orbit Cloud', 'Harbor Notes']),
    )
    expect((doc.logins ?? []).map((l) => l.name)).toEqual([ORBIT.name])
    expect(doc.backupServices).toEqual(personal.decrypted.backupServices)
  })

  test('a change on the phone reaches the browser', async ({ kemlock, site }) => {
    seedFile(site.dav, personal.text)
    await kemlock.createVault()
    await joinFolder(kemlock, PASSPHRASE)

    const doc = readFolder(site.dav, PASSPHRASE)
    doc.accounts!.push({
      id: 'z1',
      issuer: 'Zephyr',
      label: 'z@example.com',
      secret: 'GEZDGNBVGY3TQOJQ',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      addedAt: Date.now(),
    })
    phoneWrites(site.dav, doc, PASSPHRASE)
    await kemlock.call('syncNow')
    expect((await kemlock.call('codes')).map((c) => c.issuer)).toContain('Zephyr')

    // And on screen
    const popup = await kemlock.popup()
    await expect(popup.getByText('Zephyr').first()).toBeVisible()
  })

  test('two changes to one item: both end with the later one', async ({ kemlock, site }) => {
    seedFile(site.dav, personal.text)
    await kemlock.createVault()
    await joinFolder(kemlock, PASSPHRASE)
    // The browser has its own login; the phone then changes it later, with the old password kept
    const login = await kemlock.call('saveLogin', {
      id: null,
      input: {
        name: 'Orbit Cloud',
        username: 'sam',
        password: 'one',
        websites: ['orbit-cloud.com'],
      },
    })
    await kemlock.call('syncNow')
    const doc = readFolder(site.dav, PASSPHRASE)
    const phone = doc.logins!.find((l) => l.id === login.id)!
    phone.password = 'two'
    phone.updatedAt = Date.now() + 60_000
    phoneWrites(site.dav, doc, PASSPHRASE)
    await kemlock.call('syncNow')
    expect(await kemlock.call('showPassword', { id: login.id })).toBe('two')
    const after = (await kemlock.call('logins')).find((l) => l.id === login.id)!
    expect(after.previousPasswords).toBeGreaterThanOrEqual(1)
  })

  test('keys, notes, passkeys and unknown kinds come back unchanged, and attached files stay', async ({
    kemlock,
    site,
  }) => {
    const passphrase = 'sync passphrase one'
    const original = openSyncFile(everyKind.file, { key: everyKind.key })
    // A deletion is remembered for 180 days; the fixture's are a year old by now, so date them again
    original.deleted = (original.deleted ?? []).map((d, i) => ({ ...d, at: Date.now() - 1000 * i }))
    seedFile(site.dav, makeSyncFile(original, passphrase))
    // A note's attached file lives beside the sync file; the browser must leave it alone
    for (const attachment of (original.notes as { attachments: { id: string }[] }[])[0]
      .attachments) {
      site.dav.put(`/kemlock/backmycodes-file-${attachment.id}`, Buffer.from('KMA1 sealed bytes'))
    }
    const files = [...site.dav.files.keys()].filter((p) => p.includes('backmycodes-file-'))
    expect(files).toHaveLength(2)

    await kemlock.createVault()
    expect(await joinFolder(kemlock, passphrase)).toBe('done')
    await kemlock.call('addCodeFromLink', { otpauth: HARBOR_LINK })
    await kemlock.call('syncNow')

    const doc = readFolder(site.dav, passphrase)
    expect(doc.keys).toEqual(original.keys)
    expect(doc.notes).toEqual(original.notes)
    expect(doc.passkeys).toEqual(original.passkeys)
    expect(doc.deleted).toEqual(expect.arrayContaining(original.deleted!))
    expect((doc.accounts ?? []).map((a) => a.issuer)).toEqual(
      expect.arrayContaining(['GitHub', 'Harbor Notes']),
    )
    // The files are still on the server, and none was fetched or deleted
    for (const file of files) expect(site.dav.files.has(file)).toBe(true)
    expect(
      site.dav.log.filter(
        (r) => r.path.includes('backmycodes-file-') && ['GET', 'DELETE'].includes(r.method),
      ),
    ).toEqual([])
  })

  test("a login of the app's own file arrives with its previous passwords", async ({
    kemlock,
    site,
  }) => {
    const passphrase = 'sync passphrase two'
    seedFile(
      site.dav,
      makeSyncFile(openSyncFile(withLogins.file, { key: withLogins.key }), passphrase),
    )
    await kemlock.createVault()
    await joinFolder(kemlock, passphrase)
    const logins = await kemlock.call('logins')
    expect(logins.map((l) => l.name).sort()).toEqual(['Banking app', 'Larkspur Mail'])
    expect(logins.find((l) => l.name === 'Larkspur Mail')).toMatchObject({ previousPasswords: 2 })
  })

  test('a sync that would remove 6 of 22 items stops, and Keep and Remove answer it', async ({
    kemlock,
    site,
  }) => {
    const passphrase = 'sync passphrase three'
    const accounts = Array.from({ length: 22 }, (_, i) => ({
      id: `c${String(i + 1).padStart(2, '0')}`,
      issuer: `Service ${String(i + 1).padStart(2, '0')}`,
      label: 'sam@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      addedAt: 1_700_000_000_000 + i,
    }))
    seedFile(site.dav, makeSyncFile({ accounts, backupServices: [], deleted: [] }, passphrase))
    await kemlock.createVault()
    await joinFolder(kemlock, passphrase)
    expect(await kemlock.call('codes')).toHaveLength(22)

    // Another device deletes six of them
    const gone = accounts.slice(0, 6)
    const otherDeletes = () =>
      phoneWrites(
        site.dav,
        {
          accounts: accounts.slice(6),
          backupServices: [],
          deleted: gone.map((a) => ({ id: a.id, at: Date.now() + 1000 })),
        },
        passphrase,
      )
    otherDeletes()
    const writes = site.dav.writes().length
    const status = await kemlock.call('syncNow')
    expect(status).toMatchObject({ problem: 'removals', pendingRemovals: 6, scopeSize: 22 })
    expect(status.pendingRemovalItems).toEqual(gone.map((a) => ({ name: a.issuer, kind: 'code' })))
    // Nothing was written, and nothing was removed
    expect(site.dav.writes()).toHaveLength(writes)
    expect(await kemlock.call('codes')).toHaveLength(22)

    // The sync card of the popup's settings says how many, lists them on Review, and offers Keep and Remove
    const popup = await kemlock.popup()
    await openSection(popup, 'Settings')
    await expect(popup.getByText(/would remove 6 of 22 items/i)).toBeVisible()
    await control(popup, /^review$/i).click()
    for (const a of gone) await expect(popup.getByText(a.issuer, { exact: true })).toBeVisible()
    expect(site.dav.writes()).toHaveLength(writes)

    // Keep: one run with no deletion either way. The file holds all 22 and none of the deletions
    await control(popup, /^keep$/i).click()
    await expect(popup.getByText(/would remove/i)).toHaveCount(0)
    expect(await kemlock.call('codes')).toHaveLength(22)
    const kept = readFolder(site.dav, passphrase)
    expect((kept.accounts ?? []).map((a) => a.id).sort()).toEqual(accounts.map((a) => a.id))
    expect(kept.deleted ?? []).toEqual([])

    // The other device deletes them again: this time, Remove (asked first) takes them off here and in the file
    otherDeletes()
    expect(await kemlock.call('syncNow')).toMatchObject({ problem: 'removals', pendingRemovals: 6 })
    const again = await kemlock.popup()
    await openSection(again, 'Settings')
    await expect(again.getByText(/would remove 6 of 22 items/i)).toBeVisible()
    await control(again, /^remove$/i).click()
    await expect(again.getByText(/remove them?/i)).toBeVisible()
    expect(await kemlock.call('codes')).toHaveLength(22)
    await control(again, /^remove$/i).click()
    await expect(again.getByText(/would remove/i)).toHaveCount(0)
    expect(await kemlock.call('codes')).toHaveLength(16)
    const removed = readFolder(site.dav, passphrase)
    expect((removed.accounts ?? []).map((a) => a.id).sort()).toEqual(
      accounts.slice(6).map((a) => a.id),
    )
    expect((removed.deleted ?? []).map((d) => d.id).sort()).toEqual(gone.map((a) => a.id))
  })

  test('the settings show the folder, and signing out keeps the items and deletes nothing', async ({
    kemlock,
    site,
  }) => {
    seedFile(site.dav, personal.text)
    await kemlock.createVault()
    await joinFolder(kemlock, PASSPHRASE)
    const popup = await kemlock.popup()
    await openSection(popup, 'Settings')
    await expect(popup.getByText(new RegExp(new URL(FOLDER).host, 'i')).first()).toBeVisible()

    const before = site.dav.text(SYNC_PATH)
    await kemlock.call('signOut')
    expect(await kemlock.call('syncStatus')).toBeNull()
    expect(await kemlock.call('codes')).toHaveLength(3)
    expect(site.dav.text(SYNC_PATH)).toBe(before)
    expect(site.dav.log.filter((r) => r.method === 'DELETE')).toEqual([])
  })
})
