// Kemlock Server's item format over a WebDAV vault (docs/plans/add-item-format.md): the phone leaves custom fields, two-way links,
// a login with several websites and match rules, a contact with no key, codes with a name and websites, a File item and a note
// with an attached file in the folder, and the popup shows them, keeps a hidden field hidden until it is asked for, saves without
// touching what it didn't edit (the stored bodies are read back, as sync.spec.ts does), adds and removes a link at both ends, and
// lists the files read-only with the notice, since only Kemlock Server sync carries file bytes.
import { joinFolder, phoneWrites, readFolder, seedFile } from './dav'
import {
  ITEM_FORMAT_PASSPHRASE as PASSPHRASE,
  fileNames,
  ids,
  itemFormatDoc,
  linkIds,
  member,
  members,
} from './fixtures/item-format'
import { expect, test, type Kemlock } from './kemlock'
import {
  addOwnField,
  editButton,
  expectNoFileActions,
  fieldButton,
  filesNotice,
  openCodes,
  openContact,
  openFileItem,
  openLogin,
  openNote,
  pickLink,
  saveButton,
  unlinkButton,
} from './item-ui'
import { makeSyncFile } from './otp'
import type { SiteServer } from './site-server'
import { box, chooseOption, control } from './ui'

const login = { kind: 'login', id: ids.orbit } as const
const harbor = { kind: 'login', id: ids.harbor } as const

/** The phone's folder holds the item-format vault, and the browser has joined it. */
async function joinPhonesVault(kemlock: Kemlock, site: SiteServer) {
  seedFile(site.dav, makeSyncFile(itemFormatDoc(), PASSPHRASE))
  await kemlock.createVault()
  expect(await joinFolder(kemlock, PASSPHRASE)).toBe('done')
}

/** What the folder holds after the browser's change reached it. */
async function folderAfterSync(kemlock: Kemlock, site: SiteServer) {
  const status = await kemlock.call('syncNow')
  expect(status.problem).toBeUndefined()
  return readFolder(site.dav, PASSPHRASE)
}

test.describe('the item format, over a WebDAV vault', () => {
  test.beforeEach(async ({ kemlock, site }) => {
    await joinPhonesVault(kemlock, site)
  })

  test("a login's fields show, and a hidden one only when asked for", async ({ kemlock }) => {
    // The views carry no hidden value and name what they can't edit
    const [view] = (await kemlock.call('logins')).filter((l) => l.id === ids.orbit)
    const byName = (name: string) => view!.fields.find((f) => f.name === name)!
    expect(byName('Account number')).toMatchObject({
      kind: 'text',
      value: 'AC-1234',
      editable: true,
    })
    expect(byName('Paid plan')).toMatchObject({ kind: 'boolean', value: 'true', editable: true })
    expect(byName('Recovery PIN')).toMatchObject({ kind: 'hidden', hasValue: true, editable: true })
    expect(byName('Recovery PIN').value).toBeUndefined()
    expect(byName('Linked username')).toMatchObject({ kind: 'linked', editable: false })
    expect(JSON.stringify(await kemlock.call('logins'))).not.toContain('8842')
    expect(
      await kemlock.call('revealField', { ref: login, index: byName('Recovery PIN').index }),
    ).toBe('8842')

    const popup = await kemlock.popup()
    await openLogin(popup, 'Orbit Cloud')
    await expect(popup.getByText('Account number').first()).toBeVisible()
    await expect(popup.getByText('AC-1234').first()).toBeVisible()
    // A checkbox reads Yes or No
    await expect(popup.getByText(/^yes$/i).first()).toBeVisible()
    await expect(popup.getByText('Recovery PIN').first()).toBeVisible()
    await expect(popup.locator('body')).not.toContainText('8842')

    await fieldButton(popup, 'Show', 'Recovery PIN').click()
    await expect(popup.getByText('8842').first()).toBeVisible()
    await fieldButton(popup, 'Copy', 'Recovery PIN').click()
    await expect.poll(() => kemlock.clipboard()).toBe('8842')
  })

  test('a login with several websites shows the rule of each, and the editor changes one', async ({
    kemlock,
    site,
  }) => {
    const [view] = (await kemlock.call('logins')).filter((l) => l.id === ids.orbit)
    expect(view!.websiteRules).toEqual([
      { uri: 'orbit-cloud.com', match: 'default' },
      { uri: 'https://login.orbit-cloud.com/', match: 'startsWith' },
      { uri: '^https://[a-z]+\\.orbit-cloud\\.com/admin$', match: 'regex' },
    ])

    const popup = await kemlock.popup()
    await openLogin(popup, 'Orbit Cloud')
    await expect(popup.getByText('login.orbit-cloud.com').first()).toBeVisible()
    await expect(popup.getByText(/starts with/i).first()).toBeVisible()
    await expect(popup.getByText(/regular expression/i).first()).toBeVisible()

    // The editor has a select of rules for each website; the second one is changed to Exact
    await editButton(popup).click()
    const rules = popup.getByRole('combobox', { name: /rule|match/i })
    await expect(rules).toHaveCount(3)
    await chooseOption(rules.nth(1), /^exact/i)
    await saveButton(popup).click()
    await expect
      .poll(
        async () =>
          (await kemlock.call('logins')).find((l) => l.id === ids.orbit)?.websiteRules[1]?.match,
      )
      .toBe('exact')

    // Only that website's rule changed: the others are as the phone wrote them
    const stored = member(await folderAfterSync(kemlock, site), 'logins', ids.orbit)
    const original = member(itemFormatDoc(), 'logins', ids.orbit)
    const uris = stored.uris as Record<string, unknown>[]
    expect(uris).toHaveLength(3)
    expect(JSON.stringify(uris[0])).toBe(JSON.stringify((original.uris as unknown[])[0]))
    expect(uris[1]).toEqual({ uri: 'https://login.orbit-cloud.com/', match: 3 })
    expect(JSON.stringify(uris[2])).toBe(JSON.stringify((original.uris as unknown[])[2]))
  })

  test('a save keeps every member the browser did not edit, byte for byte', async ({
    kemlock,
    site,
  }) => {
    const before = itemFormatDoc()
    const original = member(before, 'logins', ids.orbit)
    const popup = await kemlock.popup()
    await openLogin(popup, 'Orbit Cloud')
    await editButton(popup).click()
    await box(popup, /^name$/i).fill('Orbit Cloud EU')
    await saveButton(popup).click()
    await expect
      .poll(async () => (await kemlock.call('logins')).find((l) => l.id === ids.orbit)?.name)
      .toBe('Orbit Cloud EU')

    const doc = await folderAfterSync(kemlock, site)
    const stored = member(doc, 'logins', ids.orbit)
    expect(stored.name).toBe('Orbit Cloud EU')
    expect(stored.updatedAt as number).toBeGreaterThan(original.updatedAt as number)
    // The edited item: the fields (the hidden one, the linked one and the nameless one included), the links, the rules and
    // the key it doesn't know are the very text the phone wrote
    for (const key of ['fields', 'links', 'uris', 'x-future', 'username', 'password', 'note']) {
      expect(JSON.stringify(stored[key]), key).toBe(JSON.stringify(original[key]))
    }
    // The items it didn't touch are untouched
    expect(members(doc, 'notes')).toEqual(members(before, 'notes'))
    expect(members(doc, 'contacts')).toEqual(members(before, 'contacts'))
    expect(members(doc, 'files')).toEqual(members(before, 'files'))
    expect(member(doc, 'logins', ids.harbor)).toEqual(member(before, 'logins', ids.harbor))
  })

  test('a note saved in the browser keeps its attached file, its link and its field', async ({
    kemlock,
    site,
  }) => {
    const original = member(itemFormatDoc(), 'notes', ids.wifi)
    const popup = await kemlock.popup()
    await openNote(popup, 'Wi-Fi')
    await editButton(popup).click()
    await box(popup, /^title$/i).fill('Home Wi-Fi')
    await saveButton(popup).click()
    await expect
      .poll(async () => (await kemlock.call('notes')).find((n) => n.id === ids.wifi)?.title)
      .toBe('Home Wi-Fi')

    const stored = member(await folderAfterSync(kemlock, site), 'notes', ids.wifi)
    expect(stored.title).toBe('Home Wi-Fi')
    for (const key of ['attachments', 'links', 'fields', 'text', 'x-future']) {
      expect(JSON.stringify(stored[key]), key).toBe(JSON.stringify(original[key]))
    }
  })

  test('a field added in the editor is appended, and the others stay as they were', async ({
    kemlock,
    site,
  }) => {
    const original = member(itemFormatDoc(), 'logins', ids.orbit)
    const popup = await kemlock.popup()
    await openLogin(popup, 'Orbit Cloud')
    await editButton(popup).click()
    await addOwnField(popup, 'Nickname', 'Sam')
    await saveButton(popup).click()
    await expect
      .poll(async () =>
        (await kemlock.call('logins')).find((l) => l.id === ids.orbit)?.fields.map((f) => f.name),
      )
      .toContain('Nickname')

    const stored = member(await folderAfterSync(kemlock, site), 'logins', ids.orbit)
    const fields = stored.fields as Record<string, unknown>[]
    const was = original.fields as Record<string, unknown>[]
    // Each of the phone's fields, in its place, as it was; the new one is a text field of the person's own, with no admin id
    expect(fields.slice(0, was.length).map((f) => JSON.stringify(f))).toEqual(
      was.map((f) => JSON.stringify(f)),
    )
    expect(fields[was.length]).toEqual({ name: 'Nickname', value: 'Sam', kind: 'text' })
    expect(fields).toHaveLength(was.length + 1)
  })

  test('a link made in the editor and one removed on the page change both items', async ({
    kemlock,
    site,
  }) => {
    // The note's link and the code's `linkedLoginId` are the login's links already
    const first = await kemlock.call('linkedItems', { ref: login })
    expect(first.map((l) => l.ref)).toEqual(
      expect.arrayContaining([
        { kind: 'note', id: ids.wifi },
        { kind: 'otp', id: ids.orbitCode },
      ]),
    )

    const popup = await kemlock.popup()
    await openLogin(popup, 'Orbit Cloud')
    await editButton(popup).click()
    await pickLink(popup, 'harbor', 'Harbor Notes')
    await saveButton(popup).click()
    await expect
      .poll(async () => (await kemlock.call('linkedItems', { ref: harbor })).map((l) => l.ref))
      .toContainEqual(login)
    expect((await kemlock.call('linkedItems', { ref: login })).map((l) => l.ref)).toContainEqual(
      harbor,
    )

    // Both bodies name each other in the folder, and the note's link is where it was
    let doc = await folderAfterSync(kemlock, site)
    expect(linkIds(member(doc, 'logins', ids.orbit))).toEqual([ids.harbor, ids.wifi].sort())
    expect(linkIds(member(doc, 'logins', ids.harbor))).toEqual([ids.orbit])
    expect(linkIds(member(doc, 'notes', ids.wifi))).toEqual([ids.orbit])

    // Removing it on the login's page takes it off the other end too
    await expect(popup.getByText('Harbor Notes').first()).toBeVisible()
    await unlinkButton(popup, 'Harbor Notes').click()
    await expect
      .poll(async () => (await kemlock.call('linkedItems', { ref: harbor })).length)
      .toBe(0)
    doc = await folderAfterSync(kemlock, site)
    expect(linkIds(member(doc, 'logins', ids.orbit))).toEqual([ids.wifi])
    expect(linkIds(member(doc, 'logins', ids.harbor))).toEqual([])
    // The link the phone made is still there, with the key the browser doesn't know
    const kept = (member(doc, 'logins', ids.orbit).links as Record<string, unknown>[]).find(
      (l) => l.id === ids.wifi,
    )
    expect(kept).toEqual({ id: ids.wifi, 'x-note': 'kept' })
  })

  test('a link the phone made on one side only is shown as one-way', async ({ kemlock, site }) => {
    const doc = itemFormatDoc()
    // The login names Harbor Notes; Harbor Notes doesn't name the login
    member(doc, 'logins', ids.orbit).links = [{ id: ids.wifi }, { id: ids.harbor }]
    member(doc, 'logins', ids.orbit).updatedAt = Date.now() + 60_000
    phoneWrites(site.dav, doc, PASSPHRASE)
    await kemlock.call('syncNow')
    const items = await kemlock.call('linkedItems', { ref: login })
    expect(items.find((l) => l.ref.id === ids.harbor)).toMatchObject({ halfMade: true })
    expect(items.find((l) => l.ref.id === ids.wifi)?.halfMade).toBeFalsy()
  })

  test('a contact with no key shows its details and saves without one', async ({
    kemlock,
    site,
  }) => {
    const [ada] = (await kemlock.call('contacts')).filter((c) => c.id === ids.ada)
    expect(ada).toMatchObject({
      name: 'Ada Lovelace',
      company: 'Analytical Engines Ltd',
      email: 'ada@analytical.example',
      phone: '+44 20 7946 0000',
      hasKey: false,
    })

    const popup = await kemlock.popup()
    await openContact(popup, 'Ada Lovelace')
    await expect(popup.getByText('Analytical Engines Ltd').first()).toBeVisible()
    await expect(popup.getByText('ada@analytical.example').first()).toBeVisible()
    await expect(popup.getByText('+44 20 7946 0000').first()).toBeVisible()
    await expect(popup.getByText(/12 St James Square/).first()).toBeVisible()

    // The contact's details are edited on its page
    if (await editButton(popup).isVisible()) await editButton(popup).click()
    await popup.getByLabel(/^company/i).fill('Analytical Engines plc')
    await saveButton(popup).click()
    await expect
      .poll(async () => (await kemlock.call('contacts')).find((c) => c.id === ids.ada)?.company)
      .toBe('Analytical Engines plc')

    const stored = member(await folderAfterSync(kemlock, site), 'contacts', ids.ada)
    const original = member(itemFormatDoc(), 'contacts', ids.ada)
    expect(stored).toMatchObject({
      company: 'Analytical Engines plc',
      source: 'manual',
    })
    // A contact with no key has no `public` (crypto.md, "Contact")
    expect(stored).not.toHaveProperty('public')
    for (const key of ['email', 'phone', 'address', 'x-future']) {
      expect(JSON.stringify(stored[key]), key).toBe(JSON.stringify(original[key]))
    }
  })

  test('MFA codes have a name and websites, a linked one shows its login’s, and "Code" is gone', async ({
    kemlock,
  }) => {
    const codes = await kemlock.call('codes')
    const vpn = codes.find((c) => c.id === ids.vpnCode)!
    expect(vpn).toMatchObject({
      name: 'Work VPN',
      ownWebsites: ['vpn.example.com', 'sso.example.com'],
    })
    const orbit = codes.find((c) => c.id === ids.orbitCode)!
    // The phone's linkedLoginId is a link (both pages show it), not the app's own code-login pairing (loginId)
    expect(orbit.loginId).toBeUndefined()
    expect(orbit.websitesFrom).toEqual([login])
    expect(orbit.websites).toEqual(expect.arrayContaining(['orbit-cloud.com']))

    const popup = await kemlock.popup()
    await openCodes(popup)
    await expect(popup.getByText('Work VPN').first()).toBeVisible()
    await expect(popup.getByText(/vpn\.example\.com/).first()).toBeVisible()
    // The word is "MFA code" in the popup's tabs, never "Code"
    await expect(control(popup, /^codes$/i)).toHaveCount(0)
  })

  test('files are listed, read-only, with the notice: nothing to add, download, replace or delete', async ({
    kemlock,
  }) => {
    expect(await kemlock.call('syncStatus')).toMatchObject({
      place: 'webdav',
      fileSync: 'readOnly',
    })
    const note = await kemlock.call('revealNote', { id: ids.wifi })
    expect(note.attachments).toEqual([
      expect.objectContaining({ name: fileNames.attached, size: 2048, type: 'application/pdf' }),
    ])
    expect((await kemlock.call('files')).map((f) => f.name)).toEqual([fileNames.itemName])

    const popup = await kemlock.popup()
    await openNote(popup, 'Wi-Fi')
    await expect(popup.getByText(fileNames.attached).first()).toBeVisible()
    await expect(filesNotice(popup)).toBeVisible()
    await expectNoFileActions(popup)

    await popup.reload()
    await openFileItem(popup, fileNames.itemName)
    await expect(popup.getByText(fileNames.itemName).first()).toBeVisible()
    await expect(popup.getByText(fileNames.item).first()).toBeVisible()
    await expect(filesNotice(popup)).toBeVisible()
    await expectNoFileActions(popup)
  })
})
