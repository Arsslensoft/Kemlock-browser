// The shared-spaces spec (docs/plans/add-spaces.md), over a WebDAV folder the way a team's phones leave it: a space joined from the
// phone's invite shows in the popup with its name on its items, is synced as a scope of its own, and goes when the person leaves.
// The spaces on Kemlock Server need a real server and two accounts; Kemlock-core's tests hold the chain, and the popup's own tests
// hold what each role is offered.
import { createCipheriv, randomBytes } from 'node:crypto'
import type { SpacesView } from '../../src/shared/spaces-api'
import { FOLDER, DAV_LOGIN, withLogins } from './dav'
import { expect, test } from './kemlock'
import { openSyncFile } from './otp'

// An invite the app made (Kemlock-core's test/fixtures/sync/sync.json): its space, its file's name, the key of the file and the code
const SPACE = {
  id: '3f2c9a71e4b0d856',
  name: 'Famille Dupont 👪',
  file: 'backmycodes-space-3f2c9a71e4b0d856.json',
  key: 'rlV2sQ2EeNOxFCHzreFIj/bo405mCRsiozC0mYyQCII=',
  code: 'HX4Z-T927-6ANC',
  invite:
    'bmc-space:eyJ2IjoxLCJzYWx0IjoiU0swemd3cmtPVjU3R2xrdzZTdXpGQT09Iiwibm9uY2UiOiJlMGZqQnl6M2g2dDlCdk1NIiwiY3QiOiJudWRTVWtUNFBuYSt4dGFRZ2VPb0dKUmI4ZGU0VW5IS3Y5SzNxdk02Z1BJeWU2SEF1ajRlZ3J3S1VhUC9Gc2NtbncyQStySUhzd1dkRjYzWm9jZVE5Sk9laE95TzA5OGVEV0I1Y2V2N2hQQ2x0ZmR0YWxVTmtSSHNmSURySWV2UElDK1NrZGZvalF1RXh3aTRTbUg2U3gySDVvdmhWK21YVTVXeVVDdUhOb2h0eUVPdW5KTEY2dXo5YjlPWnhQOG9QYXVpWGREaWx4ZnQ2UnYzSUZIaStMc01vVmNlUTI5UHczMzY5QT09In0',
}

/** A space's file: a sync document sealed with the space's raw key, as the app writes it. */
function spaceFile(doc: Record<string, unknown>): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(SPACE.key, 'base64'), nonce)
  const body = Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()])
  return JSON.stringify({
    app: 'BackMyCodes',
    kind: 'sync',
    version: 1,
    nonce: nonce.toString('base64'),
    ct: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
  })
}

/** A login the app wrote, now in the team's space. */
function teamLogin(): Record<string, unknown> {
  const doc = openSyncFile(withLogins.file, { key: withLogins.key })
  const [first] = doc.logins ?? []
  if (first === undefined) throw new Error('the fixture has no login')
  return {
    ...first,
    id: '0b6f1d2e-7a54-4c1b-9d3e-5f2a8c4e6b10',
    name: 'Team Wiki',
    spaceId: SPACE.id,
  }
}

test.describe('a WebDAV space', () => {
  test('is joined with its invite, synced as a scope of its own, and left', async ({
    kemlock,
    site,
  }) => {
    site.dav.seed('/kemlock/', { [SPACE.file]: spaceFile({ logins: [teamLogin()] }) })
    await kemlock.createVault()

    await expect(
      kemlock.call('joinDavSpace', {
        invite: SPACE.invite,
        code: 'AAAA-AAAA-AAAA',
        folder: FOLDER,
        ...DAV_LOGIN,
      }),
    ).rejects.toThrow(/space_dav_invite_code/)
    const joined = await kemlock.call('joinDavSpace', {
      invite: SPACE.invite,
      code: SPACE.code,
      folder: FOLDER,
      ...DAV_LOGIN,
    })
    expect(joined).toEqual({ id: SPACE.id, name: SPACE.name })

    // The spaces' scopes run on their own: the browser syncs nowhere else
    const view: SpacesView = await kemlock.call('syncSpaces')
    expect(view.webdav).toHaveLength(1)
    expect(view.webdav[0]).toMatchObject({
      id: SPACE.id,
      name: SPACE.name,
      status: 'webdav',
      items: 1,
    })
    expect(view.webdav[0]?.problem).toBeUndefined()

    const logins = await kemlock.call('logins')
    expect(logins.map((login) => login.name)).toContain('Team Wiki')
    const wiki = logins.find((login) => login.name === 'Team Wiki')
    expect(wiki?.space).toEqual({
      id: SPACE.id,
      name: SPACE.name,
      canEdit: true,
      passwordHidden: false,
    })

    // The popup shows the item with the space's name, and the space with what is in it
    const popup = await kemlock.popup()
    await popup.getByRole('tab', { name: /^logins/i }).click()
    const row = popup.locator('li').filter({ hasText: 'Team Wiki' })
    await expect(row).toContainText(SPACE.name)
    await popup.locator('.spaces-card').click()
    await expect(popup.getByRole('heading', { name: 'Shared spaces' })).toBeVisible()
    await popup.locator('.item-main').filter({ hasText: SPACE.name }).click()
    await expect(popup.getByText('Team Wiki')).toBeVisible()

    // Leaving takes its items off this browser
    await popup.getByRole('button', { name: 'Leave the space' }).click()
    await popup.locator('.confirm .btn.danger').click()
    await expect.poll(async () => (await kemlock.call('logins')).length).toBe(0)
    expect((await kemlock.call('spaces')).webdav).toHaveLength(0)
  })

  test('takes a login of the vault in, and writes it to the space’s file only', async ({
    kemlock,
    site,
  }) => {
    site.dav.seed('/kemlock/', { [SPACE.file]: spaceFile({}) })
    await kemlock.createVault()
    await kemlock.call('joinDavSpace', {
      invite: SPACE.invite,
      code: SPACE.code,
      folder: FOLDER,
      ...DAV_LOGIN,
    })
    const saved = await kemlock.call('saveLogin', {
      id: null,
      input: {
        name: 'Orbit',
        username: 'sam',
        password: 'p4ss-orbit',
        websites: ['orbit-cloud.com'],
      },
    })
    await kemlock.call('moveItem', { itemKind: 'login', id: saved.id, space: SPACE.id })
    await kemlock.call('syncSpaces')

    const written = openSyncFile(site.dav.text(`/kemlock/${SPACE.file}`)!, { key: SPACE.key })
    expect(written.logins?.map((login) => login.name)).toEqual(['Orbit'])
    expect(written.logins?.[0]).toMatchObject({ spaceId: SPACE.id })
  })
})
