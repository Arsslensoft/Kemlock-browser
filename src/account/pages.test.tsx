// @vitest-environment jsdom
// The account page's panels rendered over a mocked `account`: what a person sees and presses, and what the page then asks of the core.
import type * as SendModule from './send'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeAccount, fakeFingerprint, fakeProof } from '../background/core/fake-account'
import type { AccountRequest } from '../shared/account'
import { ToastProvider } from '../shared/ui/components'
import { lockChannel, type LockChannel } from '../shared/vault-lock-testing'
import { flushFrames, frameStubs, makeGetMessage } from '../setup/testkit'
import { App } from './App'
import { account, AccountError } from './send'

vi.mock('./send', async (original) => ({
  ...(await original<typeof SendModule>()),
  account: vi.fn(),
}))

const root = join(import.meta.dirname, '..', '..')
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>
const messages = { ...read('locales/parts/account.en.json'), ...read('locales/app/en.json') }

let fake: FakeAccount
let container: HTMLElement
let asked: AccountRequest[]
let failure: string | undefined
let channel: LockChannel

beforeEach(() => {
  fake = new FakeAccount(() => Date.now())
  asked = []
  failure = undefined
  vi.mocked(account).mockReset()
  vi.mocked(account).mockImplementation(((op: string, args?: object) => {
    const request = { op, ...(args ?? {}) } as AccountRequest
    asked.push(request)
    if (failure !== undefined) return Promise.reject(new AccountError(failure))
    return fake
      .call(request)
      .catch((error: Error) => Promise.reject(new AccountError(error.message)))
  }) as never)
  channel = lockChannel('kemlockid')
  vi.stubGlobal('chrome', {
    i18n: { getMessage: makeGetMessage(messages), getUILanguage: () => 'en' },
    tabs: { create: vi.fn() },
    runtime: channel.runtime,
  })
  vi.stubGlobal('print', vi.fn())
  for (const [name, value] of Object.entries(frameStubs())) vi.stubGlobal(name, value)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  vi.useRealTimers()
  await act(() => {
    render(null, container)
  })
  await flushFrames()
  container.remove()
  window.history.replaceState(null, '', '#')
  vi.unstubAllGlobals()
})

const settle = () =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  })

const open = async (hash = '') => {
  window.history.replaceState(null, '', `#${hash}`)
  await act(() => {
    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
      container,
    )
  })
  await settle()
}

const text = () => container.textContent ?? ''

const button = (label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').trim().startsWith(label),
  )
  if (found === undefined) throw new Error(`no button "${label}" in: ${text()}`)
  return found
}

const click = async (label: string) => {
  await act(() => {
    button(label).click()
  })
  await settle()
}

const type = async (label: string, value: string) => {
  const found = [...container.querySelectorAll('label')].find(
    (l) => l.htmlFor !== '' && (l.textContent ?? '').startsWith(label),
  )
  const input = found === undefined ? null : document.getElementById(found.htmlFor)
  if (input === null) throw new Error(`no field "${label}" in: ${text()}`)
  await act(() => {
    ;(input as HTMLInputElement).value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const sentOps = () => asked.map((request) => request.op)

/** Closes the page and opens it again, so what it loaded is read afresh. */
const reopen = async (hash = '') => {
  await act(() => {
    render(null, container)
  })
  await open(hash)
}

describe('the approvals', () => {
  it('say none are waiting', async () => {
    await open('approvals')
    expect(text()).toContain('No device is waiting')
  })

  it('show the five words and approve or deny the request', async () => {
    fake.addApproval({ id: 'r1', deviceName: 'Kemlock · Firefox' })
    await open('approvals')
    expect(text()).toContain('Kemlock · Firefox')
    for (const word of ['badge', 'fresh', 'jolly', 'moss', 'quartz']) expect(text()).toContain(word)
    await click('Approve')
    expect(asked.at(-2)).toEqual({ op: 'approve', id: 'r1' })
    expect(fake.state.approvals).toEqual([])
  })

  it('cannot approve a request whose words differ from the ones worked out here', async () => {
    fake.addApproval({ id: 'r1', agrees: false })
    await open('approvals')
    expect(text()).toContain("The server's words don't match")
    expect(button('Approve').disabled).toBe(true)
    await click('Deny')
    expect(asked.some((request) => request.op === 'deny')).toBe(true)
  })

  it('cannot approve a request that has no key', async () => {
    fake.addApproval({ id: 'r1', phrase: null, canApprove: false })
    await open('approvals')
    expect(text()).toContain('carries no key')
    expect(button('Approve').disabled).toBe(true)
  })
})

describe('the devices', () => {
  it('are listed, and another one is signed out after a question', async () => {
    await open('devices')
    expect(text()).toContain('Kemlock · Chrome')
    expect(text()).toContain('This browser')
    expect(text()).toContain('Kemlock on Pixel 9')
    // This browser has no Sign out of its own
    expect(
      [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Sign out'),
    ).toHaveLength(1)
    await click('Sign out')
    expect(text()).toContain('Sign out Kemlock on Pixel 9?')
    expect(sentOps()).not.toContain('signOutDevice')
    const confirm = [...container.querySelectorAll('.confirm button')].find(
      (b) => b.textContent === 'Sign out',
    ) as HTMLButtonElement
    await act(() => {
      confirm.click()
    })
    await settle()
    expect(asked).toContainEqual({ op: 'signOutDevice', deviceId: 'device-phone' })
    expect(container.querySelectorAll('.item')).toHaveLength(1)
  })
})

describe('emergency access', () => {
  it('names a contact, and confirms them only after the fingerprint is shown', async () => {
    await open('emergency')
    await click('Add a contact')
    await type('Their email', 'ada@example.com')
    await click('Send the invitation')
    expect(asked).toContainEqual({
      op: 'emergencyInvite',
      email: 'ada@example.com',
      kind: 'view',
      waitDays: 7,
    })
    expect(text()).toContain('ada@example.com')
    // The contact accepts (the fake is one account on both sides)
    const [grant] = fake.state.trusted
    await fake.call({ op: 'emergencyStep', id: grant!.grant.id, step: 'accept' })
    await reopen('emergency')
    expect(text()).toContain('Needs confirming')
    await click('Confirm')
    expect(text()).toContain(fakeFingerprint('ada@example.com'))
    expect(sentOps()).not.toContain('emergencyConfirm')
    await click('The numbers match')
    expect(asked).toContainEqual({
      op: 'emergencyConfirm',
      id: grant!.grant.id,
      fingerprint: fakeFingerprint('ada@example.com'),
    })
    expect(fake.state.trusted[0]!.grant.state).toBe('confirmed')
  })

  it('lets the grantor approve or refuse a request before the wait ends', async () => {
    const view = {
      grant: {
        id: 'g1',
        grantorId: 'me',
        granteeEmail: 'ada@example.com',
        granteeId: 'ada',
        kind: 'view' as const,
        waitDays: 7,
        state: 'recovery-initiated' as const,
        recoveryInitiatedAt: new Date().toISOString(),
        dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
      grantorEmail: null,
      hasKeys: true,
    }
    fake.state.trusted.push(view)
    await open('emergency')
    expect(text()).toContain('Asked for access')
    expect(text()).toContain('3 d left')
    await click('Approve')
    expect(asked).toContainEqual({ op: 'emergencyStep', id: 'g1', step: 'approve' })
  })

  it('lets a contact accept, ask, and fetch the key, and says whether it opens', async () => {
    fake.state.grantors.push({
      grant: {
        id: 'g2',
        grantorId: 'ben',
        granteeEmail: 'me@example.com',
        granteeId: 'me',
        kind: 'view',
        waitDays: 1,
        state: 'invited',
        recoveryInitiatedAt: null,
        dueAt: null,
        createdAt: new Date().toISOString(),
      },
      grantorEmail: 'ben@example.com',
      hasKeys: false,
    })
    await open('emergency')
    expect(text()).toContain('ben@example.com')
    await click('Accept')
    // A grant is confirmed by the grantor, who is the other account: the fake walks it on
    const grant = fake.state.grantors[0]!.grant
    grant.state = 'approved'
    await reopen('emergency')
    await click('Get the key')
    expect(asked).toContainEqual({ op: 'emergencyKey', id: 'g2' })
    expect(text()).toContain("ben@example.com's key was released")
  })
})

describe('the Recovery Kit', () => {
  it('is made, shown once, and kept only after a piece is typed back', async () => {
    await open('recovery')
    expect(text()).toContain('no Recovery Kit')
    await click('Make a Recovery Kit')
    const pieces = [...container.querySelectorAll('.piece')].map((p) => p.textContent ?? '')
    expect(pieces).toHaveLength(3)
    expect(pieces[0]).toContain('BMCKIT1-')
    // A piece that isn't one of them is told apart before anything is sent
    await type('Type one piece back', 'BMCKIT1-NOPE')
    await click('Keep this kit')
    expect(sentOps()).not.toContain('kitKeep')
    expect(text()).toContain("isn't one of the pieces")
    await type('Type one piece back', pieces[1]!.toLowerCase())
    await click('Keep this kit')
    expect(sentOps()).toContain('kitKeep')
    expect(fake.state.kit?.current).toBe(true)
    expect(text()).toContain('Kit ')
  })

  it('is replaced only with a fresh code, which the old kit needs', async () => {
    fake.state.kit = {
      kitId: 'OLDKIT22',
      threshold: 2,
      shares: 3,
      keyVersion: 1,
      createdAt: new Date().toISOString(),
      current: true,
    }
    await open('recovery')
    await click('Make a new kit')
    const piece = (container.querySelector('.piece')?.textContent ?? '').trim()
    await type('Type one piece back', piece)
    expect(button('Keep this kit').disabled).toBe(true)
    await type('Code', 'wrong')
    await click('Keep this kit')
    expect(text()).toContain('server refused')
    await type('Code', fakeProof)
    await click('Keep this kit')
    expect(fake.state.kit?.kitId).not.toBe('OLDKIT22')
  })

  it('is printed from the tab', async () => {
    await open('recovery')
    await click('Make a Recovery Kit')
    await click('Print')
    expect(window.print).toHaveBeenCalled()
  })
})

describe('the second steps', () => {
  it('turn the authenticator app on with the secret and a code', async () => {
    await open('steps')
    await click('Set up')
    expect(text()).toContain('JBSW Y3DP EHPK 3PXP')
    await type('Code', '123456')
    await click('Confirm')
    expect(asked).toContainEqual({ op: 'totpConfirm', code: '123456' })
    expect(fake.state.methods).toEqual([{ method: 'totp', enabled: true }])
  })

  it('ask for the fresh code to show the recovery code once a step is on', async () => {
    fake.state.methods.push({ method: 'totp', enabled: true })
    fake.state.recoveryCode = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    await open('steps')
    const shows = () =>
      [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Show')
    await act(() => {
      shows()[0]!.click()
    })
    // The row's button stays; the panel's is the second, and waits for the code
    expect(shows()[1]!.disabled).toBe(true)
    await type('Code', fakeProof)
    await act(() => {
      shows()[1]!.click()
    })
    await settle()
    expect(text()).toContain('ABCD EFGH JKLM')
  })
})

describe('the move', () => {
  it('says a sign-in is held and points to setup, which shows what moves', async () => {
    fake.state.move = {
      offered: true,
      held: true,
      running: false,
      done: 0,
      total: 0,
      finished: false,
    }
    await open('move')
    expect(text()).toContain('Continue in setup')
    expect(text()).not.toContain('Move the vault')
    await click("Don't move")
    expect(sentOps()).toContain('moveCancel')
  })

  it('lets a move that stopped be tried again or abandoned', async () => {
    fake.state.move = {
      offered: true,
      held: false,
      running: false,
      done: 1,
      total: 4,
      finished: false,
      step: 'copy',
      problem: 'oldStoreGone',
    }
    await open('move')
    expect(text()).toContain('set up no more')
    await click('Abandon the move')
    expect(sentOps()).toContain('moveCancel')
  })
})

describe('the page', () => {
  it('says what to do when the vault is locked, or sync is not Kemlock Server', async () => {
    failure = 'locked'
    await open('approvals')
    expect(text()).toContain('Kemlock is locked')
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    failure = 'notKemlock'
    await click('Try again')
    expect(text()).toContain("doesn't sync with Kemlock Server")
    expect(button('Set up Kemlock Server')).toBeDefined()
  })

  it('takes the panels down at once when the vault locks, with a Recovery Kit that was being made', async () => {
    await open('recovery')
    await click('Make a Recovery Kit')
    expect(container.querySelectorAll('.piece')).toHaveLength(3)

    failure = 'locked'
    await act(() => {
      channel.lock()
    })
    await settle()

    expect(container.querySelectorAll('.piece')).toHaveLength(0)
    expect(text()).toContain('Kemlock is locked')
    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })

  it('shows the way forward for a page that came to the front without hearing the lock', async () => {
    await open('approvals')
    Object.assign(chrome.runtime, {
      sendMessage: async () => ({
        ok: true,
        value: { exists: true, unlocked: false, wrongPasswords: 0 },
      }),
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(text()).toContain('Kemlock is locked')
  })

  it('opens at the section its address names, and shows how many approvals wait', async () => {
    fake.addApproval({ id: 'a' })
    await open('devices')
    expect(container.querySelector('#tab-devices')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('#tab-approvals')?.textContent).toContain('1')
  })
})
