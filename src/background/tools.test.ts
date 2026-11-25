import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupCodeView, CodeView, LoginView } from '../shared/api'
import type {
  BackupDetail,
  BreachCheck,
  BreachesView,
  DuplicatesView,
  MergePlan,
  TagCount,
  ToolsSettings,
} from '../shared/tools-api'
import { content, harness, menuFrame, popup, setup, useClock, type Harness } from './test/harness'

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const codes = () => h.ok<CodeView[]>({ kind: 'codes' })
const logins = () => h.ok<LoginView[]>({ kind: 'logins' })
const login = (name: string, password = 'Hunter2-hunter2', username = 'sam@example.com') =>
  h.ok<LoginView>({
    kind: 'saveLogin',
    id: null,
    input: { name, username, password, websites: ['orbit-cloud.com'] },
  })

describe('who may ask for the vault tools', () => {
  const requests = [
    { kind: 'tags' },
    { kind: 'setTags', itemKind: 'login', id: 'x', tags: ['a'] },
    { kind: 'reorder', itemKind: 'code', ids: ['x'] },
    { kind: 'backupDetail', serviceId: 'orbit' },
    { kind: 'addBackupService', name: 'A', text: 'abcd' },
    { kind: 'duplicates' },
    { kind: 'breaches' },
    { kind: 'checkBreaches' },
    { kind: 'saveToolsSettings', settings: { breachRefresh: true } },
  ]

  it('is the popup and the setup tab, and not the menu frame, a content script or a locked vault', async () => {
    for (const message of requests) {
      expect(await h.send(message, menuFrame), message.kind).toEqual({
        ok: false,
        error: 'refused',
      })
      expect(await h.send(message, content('https://orbit-cloud.com/')), message.kind).toEqual({
        ok: false,
        error: 'refused',
      })
    }
    expect(await h.send({ kind: 'tags' }, setup)).toMatchObject({ ok: true })
    // The codes themselves, and the copies of a group, are for the popup that shows them
    for (const message of [
      { kind: 'backupDetail', serviceId: 'orbit' },
      { kind: 'duplicateReview', key: 'a|b' },
    ])
      expect(await h.send(message, setup), message.kind).toEqual({ ok: false, error: 'refused' })
    await h.ok({ kind: 'lock' })
    for (const message of requests)
      expect(await h.send(message, popup), message.kind).toEqual({ ok: false, error: 'locked' })
  })
})

describe('tags', () => {
  it('are set on a code and a login, shown in the lists, counted, renamed and deleted', async () => {
    const [code] = await codes()
    const [orbit] = await logins()
    expect(
      await h.ok<string[]>({
        kind: 'setTags',
        itemKind: 'code',
        id: code.id,
        tags: [' Work ', 'work', 'Home'],
      }),
    ).toEqual(['Work', 'Home'])
    await h.ok({ kind: 'setTags', itemKind: 'login', id: orbit.id, tags: ['work'] })
    expect((await codes())[0].tags).toEqual(['Work', 'Home'])
    expect((await logins())[0].tags).toEqual(['work'])
    expect(await h.ok<TagCount[]>({ kind: 'tags' })).toEqual([
      { name: 'Home', count: 1 },
      { name: 'Work', count: 2 },
    ])
    expect(await h.ok({ kind: 'renameTag', from: 'Work', to: 'Job' })).toEqual({
      changed: 2,
      skipped: 0,
    })
    expect((await logins())[0].tags).toEqual(['Job'])
    expect(await h.ok({ kind: 'deleteTag', name: 'job' })).toEqual({ changed: 2, skipped: 0 })
    expect(await h.ok<TagCount[]>({ kind: 'tags' })).toEqual([{ name: 'Home', count: 1 }])
  })

  it('refuse an item that is not there', async () => {
    expect(
      await h.send({ kind: 'setTags', itemKind: 'login', id: 'nope', tags: ['a'] }),
    ).toMatchObject({ ok: false })
  })

  it('tell sync about a change, and not about a change that changed nothing', async () => {
    const spy = vi.spyOn(h.bg['d'].sync, 'changed')
    const [code] = await codes()
    await h.ok({ kind: 'setTags', itemKind: 'code', id: code.id, tags: ['a'] })
    expect(spy).toHaveBeenCalledTimes(1)
    await h.ok({ kind: 'renameTag', from: 'nobody-has-this', to: 'x' })
    await h.ok({ kind: 'deleteTag', name: 'nobody-has-this' })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('order and pins', () => {
  it('reorders the codes by the order given, and pins first', async () => {
    const first = (await codes())[0]
    const second = await h.ok<CodeView>({
      kind: 'addCodeFromLink',
      otpauth: 'otpauth://totp/Beta:sam?secret=JBSWY3DPEHPK3PXQ&issuer=Beta',
    })
    await h.ok({ kind: 'reorder', itemKind: 'code', ids: [second.id, first.id] })
    const now = await codes()
    expect(now.find((c) => c.id === second.id)?.order).toBe(0)
    expect(now.find((c) => c.id === first.id)?.order).toBe(1)
    await h.ok({ kind: 'setPinned', itemKind: 'code', id: first.id, pinned: true })
    expect((await codes()).find((c) => c.id === first.id)?.pinned).toBe(true)
    await h.ok({ kind: 'setPinned', itemKind: 'code', id: first.id, pinned: false })
    expect((await codes()).find((c) => c.id === first.id)?.pinned).toBeUndefined()
  })

  it('reorders the logins in the browser without telling sync, which doesn’t carry that order', async () => {
    const [orbit] = await logins()
    const docs = await login('Docs', 'Other-secret-1', 'kim')
    const spy = vi.spyOn(h.bg['d'].sync, 'changed')
    await h.ok({ kind: 'reorder', itemKind: 'login', ids: [docs.id, orbit.id] })
    const now = await logins()
    expect(now.find((l) => l.id === docs.id)?.order).toBe(0)
    expect(now.find((l) => l.id === orbit.id)?.order).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('backup codes', () => {
  it('are added by pasting, marked used and unused by place, topped up, edited and deleted', async () => {
    const added = await h.ok<BackupCodeView>({
      kind: 'addBackupService',
      name: 'Google',
      text: '1234 5678\n2345 6789\n3456 7890\n4567 8901',
    })
    expect(added).toMatchObject({ issuer: 'Google', total: 4, left: 4, low: false })
    expect(
      await h.ok<string[]>({ kind: 'parseBackupCodes', text: 'a1, b2 c3, d4e5f6 g7' }),
    ).toEqual([
      'a1',
      // Two short groups are one code, as the app prints and reads them
      'b2 c3',
      'd4e5f6',
      'g7',
    ])
    const marked = await h.ok<BackupCodeView>({
      kind: 'setBackupCodeUsed',
      serviceId: added.serviceId,
      index: 0,
      used: true,
      code: '1234 5678',
    })
    expect(marked).toMatchObject({ left: 3 })
    await h.ok({
      kind: 'setBackupCodeUsed',
      serviceId: added.serviceId,
      index: 2,
      used: true,
      code: '3456 7890',
    })
    expect(
      await h.ok<BackupCodeView>({
        kind: 'removeBackupCode',
        serviceId: added.serviceId,
        index: 3,
        code: '4567 8901',
      }),
    ).toMatchObject({ total: 3, left: 1, low: true })
    expect(
      await h.ok({ kind: 'addBackupCodes', serviceId: added.serviceId, text: '1234 5678\nx9y9z9' }),
    ).toEqual({ added: 1, duplicates: 1 })
    await h.ok({
      kind: 'editBackupService',
      serviceId: added.serviceId,
      name: 'Google account',
      note: 'paper',
    })
    const detail = await h.ok<BackupDetail>({ kind: 'backupDetail', serviceId: added.serviceId })
    // Two of four are left, which is low by the app's rule (two or fewer)
    expect(detail).toMatchObject({ name: 'Google account', note: 'paper', low: true })
    expect(detail.codes.map((c) => c.used)).toEqual([true, false, true, false])
    // Marking used by place is the same list the codes page counts
    expect(
      (await h.ok<BackupCodeView[]>({ kind: 'backupCodes' })).find(
        (b) => b.serviceId === added.serviceId,
      ),
    ).toMatchObject({ left: 2 })
    await h.ok({ kind: 'deleteBackupService', serviceId: added.serviceId })
    expect(await h.send({ kind: 'backupDetail', serviceId: added.serviceId })).toMatchObject({
      ok: false,
    })
  })

  it('give the next code in order after one was marked by place, as copying does', async () => {
    const added = await h.ok<BackupCodeView>({
      kind: 'addBackupService',
      name: 'Google',
      text: 'aaaa1111\nbbbb2222\ncccc3333',
    })
    await h.ok({
      kind: 'setBackupCodeUsed',
      serviceId: added.serviceId,
      index: 0,
      used: true,
      code: 'aaaa1111',
    })
    await h.ok({ kind: 'copy', what: 'backupCode', id: added.serviceId })
    expect(h.clipboard.text).toBe('bbbb2222')
  })

  it('are marked and removed by place only when the code there is the one the page showed', async () => {
    const added = await h.ok<BackupCodeView>({
      kind: 'addBackupService',
      name: 'Google',
      text: 'aaaa1111\nbbbb2222\ncccc3333',
    })
    const id = added.serviceId
    await h.ok({ kind: 'removeBackupCode', serviceId: id, index: 0, code: 'aaaa1111' })
    // The page still shows three codes, so index 1 is bbbb2222 to it and cccc3333 to the vault
    expect(
      await h.send({
        kind: 'setBackupCodeUsed',
        serviceId: id,
        index: 1,
        used: true,
        code: 'bbbb2222',
      }),
    ).toEqual({ ok: false, error: 'stale' })
    expect(
      await h.send({ kind: 'removeBackupCode', serviceId: id, index: 1, code: 'bbbb2222' }),
    ).toEqual({ ok: false, error: 'stale' })
    expect((await h.ok<BackupDetail>({ kind: 'backupDetail', serviceId: id })).codes).toEqual([
      { code: 'bbbb2222', used: false },
      { code: 'cccc3333', used: false },
    ])
  })

  it('say which codes have no backup codes, and leave out the ones that give none', async () => {
    const [code] = await codes()
    // The sample has backup codes for Orbit Cloud, so every code is covered
    expect(await h.ok({ kind: 'backupCoverage' })).toEqual({ total: 1, covered: 1, missing: [] })
    await h.ok({ kind: 'deleteBackupService', serviceId: 'orbit' })
    expect(await h.ok({ kind: 'backupCoverage' })).toMatchObject({
      covered: 0,
      missing: [{ id: code.id }],
    })
    await h.ok({ kind: 'setNoBackupCodes', codeId: code.id, none: true })
    expect(await h.ok({ kind: 'backupCoverage' })).toEqual({ total: 0, covered: 0, missing: [] })
  })
})

describe('the duplicate cleaner', () => {
  it('finds the same sign-in, reviews it, merges it, and undoes the merge', async () => {
    const twin = await login('Orbit Cloud again', 'Orbit-Cloud-7731!')
    const view = await h.ok<DuplicatesView>({ kind: 'duplicates' })
    expect(view.groups).toHaveLength(1)
    const [group] = view.groups
    expect(group.reason).toBe('sameSignIn')
    expect(group.items.map((item) => item.id)).toContain(twin.id)

    const plan = await h.ok<MergePlan>({ kind: 'duplicateReview', key: group.key })
    expect(plan.items).toHaveLength(2)
    const done = await h.ok<{ removed: number; recordId: string }>({
      kind: 'duplicateMerge',
      key: group.key,
      keptId: twin.id,
      picks: {},
    })
    expect(done.removed).toBe(1)
    expect(await logins()).toHaveLength(1)
    expect((await h.ok<DuplicatesView>({ kind: 'duplicates' })).records).toHaveLength(1)

    expect(await h.ok({ kind: 'duplicateUndo', recordId: done.recordId })).toBe('undone')
    expect(await h.ok({ kind: 'duplicateUndo', recordId: done.recordId })).toBe('unavailable')
    expect(await logins()).toHaveLength(2)
  })

  it('remembers "Not duplicates", and takes it back', async () => {
    await login('Orbit Cloud again', 'Orbit-Cloud-7731!')
    const [group] = (await h.ok<DuplicatesView>({ kind: 'duplicates' })).groups
    expect(await h.ok({ kind: 'duplicateDismiss', key: group.key })).toBe(true)
    expect((await h.ok<DuplicatesView>({ kind: 'duplicates' })).groups).toEqual([])
    await h.ok({ kind: 'duplicateRestore', key: group.key })
    expect((await h.ok<DuplicatesView>({ kind: 'duplicates' })).groups).toHaveLength(1)
  })

  it('offers server matching only to a vault that syncs with Kemlock Server', async () => {
    expect((await h.ok<DuplicatesView>({ kind: 'duplicates' })).matching).toEqual({
      available: false,
      on: false,
    })
    expect(await h.send({ kind: 'setDuplicateMatching', on: true })).toMatchObject({ ok: false })
  })
})

describe('the breach checks', () => {
  it('alert for a service whose breach was listed, until "Dealt with"', async () => {
    const view = await h.ok<BreachesView>({ kind: 'breaches' })
    expect(view.alerts).toHaveLength(1)
    const [alert] = view.alerts
    expect(alert.entries.map((entry) => entry.kind).sort()).toEqual(['backup', 'code'])
    await h.ok({
      kind: 'dismissBreach',
      name: alert.name,
      accountIds: alert.entries.filter((e) => e.kind === 'code').map((e) => e.id),
      serviceIds: alert.entries.filter((e) => e.kind === 'backup').map((e) => e.id),
    })
    expect((await h.ok<BreachesView>({ kind: 'breaches' })).alerts).toEqual([])
  })

  it('"Check now" asks again for the passwords when the check is on, and says what it did', async () => {
    await h.ok({ kind: 'saveSettings', settings: { breachedPasswords: true } })
    await login('Weak', 'password', 'kim')
    const check = await h.ok<BreachCheck>({ kind: 'checkBreaches' })
    expect(check.passwords).toEqual({ on: true, breached: 1, failed: 0 })
    expect(check.list.on).toBe(false)
  })

  it('keep the daily refresh of the list off until it is turned on', async () => {
    expect(await h.ok<ToolsSettings>({ kind: 'toolsSettings' })).toEqual({ breachRefresh: false })
    expect(
      await h.ok<ToolsSettings>({ kind: 'saveToolsSettings', settings: { breachRefresh: true } }),
    ).toEqual({ breachRefresh: true })
    expect((await h.ok<BreachCheck>({ kind: 'checkBreaches' })).list).toMatchObject({ on: true })
  })
})
