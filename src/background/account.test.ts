import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountRequest, ApprovalView, DeviceView } from '../shared/account'
import { AccountManager, approvalsAlarm } from './account'
import { content, harness, popup, setup, start, useClock, type Harness } from './test/harness'

const accountPage = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/account/index.html',
  origin: 'chrome-extension://kemlockid',
}

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const ask = (request: AccountRequest, sender = accountPage) =>
  h.ok<unknown>({ kind: 'account', request }, sender)
const signIn = () =>
  h.ok({
    kind: 'signInKemlock',
    server: 'https://km.example',
    email: 'sam@example.com',
    password: 'master',
  })

describe('the account request', () => {
  it('is answered to the popup, the setup tab and the account page', async () => {
    for (const sender of [popup, setup, accountPage]) {
      const answer = (await ask({ op: 'devices' }, sender)) as { devices: DeviceView[] }
      expect(answer.devices.map((d) => d.name)).toContain('Kemlock · Chrome')
    }
  })

  it('is refused to a content script, whatever it asks', async () => {
    const page = content('https://evil.example/')
    for (const request of [{ op: 'devices' }, { op: 'approve', id: 'request-1' }]) {
      expect(await h.send({ kind: 'account', request }, page)).toEqual({
        ok: false,
        error: 'refused',
      })
    }
    expect(h.core.accounts.asked).toEqual([])
  })

  it('is refused when its op is not one of the account, or a field is of the wrong kind', async () => {
    for (const request of [
      { op: 'format' },
      { op: 'approve' },
      { op: 'approve', id: 7 },
      { op: 'emergencyInvite', email: 'a@b.c', kind: 'view', waitDays: 91 },
      { op: 'register', server: 'ftp://x', email: 'a@b.c', name: '', password: 'p' },
    ])
      expect(await h.send({ kind: 'account', request }, accountPage)).toEqual({
        ok: false,
        error: 'malformed',
      })
    expect(h.core.accounts.asked).toEqual([])
  })

  it('needs the vault to be open', async () => {
    await h.ok({ kind: 'lock' })
    expect(await h.send({ kind: 'account', request: { op: 'devices' } }, accountPage)).toEqual({
      ok: false,
      error: 'locked',
    })
  })

  it('answers what the core fails with in its own word', async () => {
    h.core.accounts.failing.set('devices', 'rateLimited')
    expect(await h.send({ kind: 'account', request: { op: 'devices' } }, accountPage)).toEqual({
      ok: false,
      error: 'rateLimited',
    })
  })

  it('makes an account, and runs the first sync as a sign-in does', async () => {
    const step = await ask({
      op: 'register',
      server: 'https://km.example',
      email: 'new@example.com',
      name: 'Sam',
      password: 'a long enough password',
    })
    expect(step).toMatchObject({ step: 'done' })
    // A second try with the same address says it has one
    expect(
      await ask({
        op: 'register',
        server: 'https://km.example',
        email: 'new@example.com',
        name: '',
        password: 'a long enough password',
      }),
    ).toEqual({ step: 'error', problem: 'accountExists' })
  })
})

describe('the approval watcher', () => {
  const notice = () => [...h.mock.notifications.keys()]
  const watch = async () => {
    await signIn()
    await h.bg.onAlarm({ name: approvalsAlarm })
  }

  it('sets its alarm when the vault opens, and takes it away when it locks', async () => {
    h.done()
    h = await harness({ sample: true })
    await h.ok({ kind: 'unlock', password: 'correct horse' })
    expect(h.mock.alarms.get(approvalsAlarm)).toEqual({ periodInMinutes: 1 })
    await h.ok({ kind: 'lock' })
    expect(h.mock.alarms.has(approvalsAlarm)).toBe(false)
  })

  it('tells of each request once, and not at all when nothing waits', async () => {
    await watch()
    expect(notice()).toEqual([])
    h.core.accounts.addApproval({ id: 'request-9', deviceName: 'Kemlock · Firefox' })
    await h.bg.onAlarm({ name: approvalsAlarm })
    await h.bg.onAlarm({ name: approvalsAlarm })
    expect(notice()).toEqual(['kemlock-approval:request-9'])
    expect(h.mock.notifications.get('kemlock-approval:request-9')).toMatchObject({
      type: 'basic',
      message: 'account_notice_body',
    })
  })

  it('forgets a notification when its request is answered here, or ends', async () => {
    await watch()
    h.core.accounts.addApproval({ id: 'a' })
    h.core.accounts.addApproval({ id: 'b' })
    await h.bg.onAlarm({ name: approvalsAlarm })
    expect(notice().sort()).toEqual(['kemlock-approval:a', 'kemlock-approval:b'])
    await ask({ op: 'approve', id: 'a' })
    expect(notice()).toEqual(['kemlock-approval:b'])
    // The request ended on the server (another device answered it)
    h.core.accounts.state.approvals = []
    await h.bg.onAlarm({ name: approvalsAlarm })
    expect(notice()).toEqual([])
  })

  it('does nothing while the vault is locked or it syncs elsewhere', async () => {
    h.core.accounts.addApproval({ id: 'x' })
    // No sync is set up yet
    await h.bg.onAlarm({ name: approvalsAlarm })
    expect(notice()).toEqual([])
    await signIn()
    await h.ok({ kind: 'lock' })
    await h.bg.onAlarm({ name: approvalsAlarm })
    expect(notice()).toEqual([])
  })

  it('opens the account page at the approvals when a notification is clicked', async () => {
    await h.bg.onNotificationClicked('kemlock-approval:abc')
    expect(h.mock.createdTabs).toEqual([AccountManager.pageUrl('approvals')])
    // Another extension's notification, or none of its own, opens nothing
    await h.bg.onNotificationClicked('other')
    expect(h.mock.createdTabs).toHaveLength(1)
  })

  it('refuses to approve a request whose words differ', async () => {
    await watch()
    const bad: Partial<ApprovalView> = { id: 'bad', agrees: false }
    h.core.accounts.addApproval(bad)
    expect(
      await h.send({ kind: 'account', request: { op: 'approve', id: 'bad' } }, accountPage),
    ).toEqual({
      ok: false,
      error: 'phraseMismatch',
    })
    expect(h.core.accounts.state.approvals.map((a) => a.id)).toEqual(['bad'])
    // Denying it is always possible
    await ask({ op: 'deny', id: 'bad' })
    expect(h.core.accounts.state.approvals).toEqual([])
  })
})

describe('a move the core was stopped in', () => {
  const stopped = {
    offered: true,
    held: false,
    running: false,
    finished: false,
    done: 2,
    total: 5,
    step: 'copy',
  } as const

  it('goes on at the next minute of the alarm, once', async () => {
    await signIn()
    h.core.accounts.state.move = { ...stopped }
    await h.bg.onAlarm({ name: approvalsAlarm })
    expect(h.core.accounts.asked.filter((op) => op === 'moveStart')).toHaveLength(1)
    await h.bg.onAlarm({ name: approvalsAlarm })
    // The fake finished it: nothing is started again
    expect(h.core.accounts.asked.filter((op) => op === 'moveStart')).toHaveLength(1)
  })

  it('leaves one that failed, one that waits for the person, and one that runs', async () => {
    await signIn()
    for (const move of [
      { ...stopped, problem: 'network' },
      { ...stopped, held: true },
      { ...stopped, running: true },
      { ...stopped, offered: false },
      { offered: true, held: false, running: false, finished: false, done: 0, total: 0 },
    ]) {
      h.core.accounts.state.move = move
      await h.bg.onAlarm({ name: approvalsAlarm })
    }
    expect(h.core.accounts.asked).not.toContain('moveStart')
  })
})

describe('the page address', () => {
  it('is the account page, at a section when one is named', () => {
    expect(AccountManager.pageUrl()).toBe('chrome-extension://kemlockid/src/account/index.html')
    expect(AccountManager.pageUrl('devices')).toBe(
      'chrome-extension://kemlockid/src/account/index.html#devices',
    )
    expect(start).toBeGreaterThan(0)
  })
})
