// @vitest-environment jsdom
// What the account adds to the setup tab: making an account, the Recovery Kit as a way in, and the move into Kemlock Server.
import type * as AccountSend from '../account/send'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, type ComponentChild } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountResult, MoveStatus } from '../shared/account'
import type { SignInStep } from '../shared/api'
import { account, AccountError } from '../account/send'
import { heldMoveStep, MoveScreen, RecoveryKitOption, RegisterScreen } from './accountScreens'
import { initialState, reduce, type FlowEvent, type FlowState } from './flow'
import { ask } from './send'
import { MasterPasswordScreen, SecondScreen } from './stepScreens'
import { flushFrames, frameStubs, makeGetMessage } from './testkit'

vi.mock('./send', () => ({ ask: vi.fn() }))
vi.mock('../account/send', async (original) => ({
  ...(await original<typeof AccountSend>()),
  account: vi.fn(),
}))

const root = join(import.meta.dirname, '..', '..')
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>
const messages = {
  ...read('locales/parts/setup.en.json'),
  ...read('locales/parts/account.en.json'),
  ...read('locales/app/en.json'),
}

let container: HTMLElement
let dispatched: FlowEvent[]
let accountReply: (request: { op: string }) => unknown

const dispatch = (event: FlowEvent) => {
  dispatched.push(event)
}

beforeEach(() => {
  dispatched = []
  accountReply = () => ({})
  vi.mocked(ask).mockReset()
  vi.mocked(account).mockReset()
  vi.mocked(account).mockImplementation(((op: string, args?: object) =>
    Promise.resolve(accountReply({ op, ...(args ?? {}) }))) as never)
  vi.stubGlobal('chrome', {
    i18n: { getMessage: makeGetMessage(messages), getUILanguage: () => 'en' },
  })
  for (const [name, value] of Object.entries(frameStubs())) vi.stubGlobal(name, value)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(() => {
    render(null, container)
  })
  await flushFrames()
  container.remove()
  vi.unstubAllGlobals()
})

const settle = () =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  })

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
    (l) => l.htmlFor !== '' && l.textContent === label,
  )
  const input = found === undefined ? null : document.getElementById(found.htmlFor)
  if (input === null) throw new Error(`no field "${label}" in: ${text()}`)
  await act(() => {
    ;(input as HTMLInputElement).value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const show = async (node: ComponentChild) => {
  await act(() => {
    render(node, container)
  })
  await settle()
}

const state = (over: Partial<FlowState> = {}): FlowState => ({
  ...initialState,
  mode: 'again',
  place: 'kemlock',
  address: 'https://km.example',
  screen: { name: 'register' },
  ...over,
})

describe('making an account', () => {
  const password = 'Correct-Horse-Battery-9!'

  it('needs an email and a password that is long enough, typed twice', async () => {
    await show(<RegisterScreen state={state()} dispatch={dispatch} />)
    expect(button('Create the account').disabled).toBe(true)
    await type('Email', 'sam@example.com')
    await type('Master password', 'short')
    await type('Type it again', 'short')
    expect(button('Create the account').disabled).toBe(true)
    await type('Master password', password)
    await type('Type it again', `${password}x`)
    expect(button('Create the account').disabled).toBe(true)
    expect(text()).toContain("The passwords don't match")
    await type('Type it again', password)
    expect(button('Create the account').disabled).toBe(false)
  })

  it('sends the account to the core, and goes on with the steps a sign-in has', async () => {
    const step: SignInStep = {
      step: 'done',
      status: { place: 'kemlock', server: 'https://km.example', running: false },
    }
    accountReply = () => step as AccountResult
    await show(<RegisterScreen state={state()} dispatch={dispatch} />)
    await type('Email', ' sam@example.com ')
    await type('Name (optional)', 'Sam')
    await type('Master password', password)
    await type('Type it again', password)
    await click('Create the account')
    expect(account).toHaveBeenCalledWith('register', {
      server: 'https://km.example',
      email: 'sam@example.com',
      name: 'Sam',
      password,
    })
    expect(dispatched).toEqual([{ type: 'step', step }])
  })

  it('carries the invite code when one was typed', async () => {
    accountReply = () => ({ step: 'done', status: {} }) as AccountResult
    await show(<RegisterScreen state={state()} dispatch={dispatch} />)
    await click('I have an invite code')
    await type('Email', 'sam@example.com')
    await type('Invite code', ' tok-1 ')
    await type('Master password', password)
    await type('Type it again', password)
    await click('Create the account')
    expect(account).toHaveBeenCalledWith(
      'register',
      expect.objectContaining({ inviteToken: 'tok-1' }),
    )
  })

  it('says in its own words that sign-ups are closed or the email has an account', async () => {
    for (const [problem, said] of [
      ['signupsClosed', "isn't open to new accounts"],
      ['accountExists', 'has an account already'],
    ] as const) {
      dispatched = []
      accountReply = () => ({ step: 'error', problem }) as AccountResult
      await show(<RegisterScreen state={state()} dispatch={dispatch} />)
      await type('Email', 'sam@example.com')
      await type('Master password', password)
      await type('Type it again', password)
      await click('Create the account')
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]).toMatchObject({ type: 'failed', problem: 'setup' })
      expect((dispatched[0] as { message: string }).message).toContain(said)
    }
  })
})

describe('opening an account with a Recovery Kit', () => {
  const open = async () => {
    await show(<RecoveryKitOption dispatch={dispatch} />)
    await click('Use a Recovery Kit instead')
  }

  it('sends two pieces as the answer of the sign-in, and goes on with the step it gives', async () => {
    const step: SignInStep = { step: 'masterPassword' }
    vi.mocked(ask).mockResolvedValue(step as never)
    await open()
    await type('First piece', ' BMCKIT1-A ')
    await type('Second piece', 'BMCKIT1-B')
    await click('Open with the kit')
    expect(ask).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'recoveryKit', pieces: ['BMCKIT1-A', 'BMCKIT1-B'] },
    })
    expect(dispatched).toEqual([{ type: 'step', step }])
  })

  it('says what is wrong with the pieces where they were typed, and leaves the sign-in waiting', async () => {
    vi.mocked(ask).mockResolvedValue({ step: 'error', problem: 'kitChecksum' } as never)
    await open()
    await type('First piece', 'a')
    await type('Second piece', 'b')
    await click('Open with the kit')
    expect(text()).toContain('has a typo')
    expect(dispatched).toEqual([])
    vi.mocked(ask).mockResolvedValue({ step: 'error', problem: 'unheardOf' } as never)
    await click('Open with the kit')
    expect(text()).toContain("don't open this account's kit")
  })

  it('tells the waiting approval to stop while the answer is on its way, and to go on when it did not open the account', async () => {
    const working: boolean[] = []
    vi.mocked(ask).mockResolvedValue({ step: 'error', problem: 'kitWrong' } as never)
    await show(<RecoveryKitOption dispatch={dispatch} onWorking={(on) => working.push(on)} />)
    await click('Use a Recovery Kit instead')
    await type('First piece', 'a')
    await type('Second piece', 'b')
    await click('Open with the kit')
    expect(working).toEqual([true, false])
    vi.mocked(ask).mockResolvedValue({ step: 'masterPassword' } as never)
    await click('Open with the kit')
    // An answer that opens the account leaves the approval stopped: the screen changes with the step
    expect(working).toEqual([true, false, true])
  })

  it('is outside the form of the master password, which can hold no other', async () => {
    await show(
      <MasterPasswordScreen
        state={state({ screen: { name: 'masterPassword' } })}
        dispatch={dispatch}
      />,
    )
    await click('Use a Recovery Kit instead')
    expect(container.querySelectorAll('form')).toHaveLength(2)
    expect(container.querySelector('form form')).toBeNull()
  })

  it('needs both pieces', async () => {
    await open()
    await type('First piece', 'a')
    expect(button('Open with the kit').disabled).toBe(true)
  })
})

describe('moving the vault into Kemlock Server', () => {
  const step = (over: Partial<Extract<FlowState['screen'], { name: 'move' }>> = {}): FlowState =>
    state({
      screen: {
        name: 'move',
        source: 'vaultwarden',
        counts: { login: 3, otp: 2, 'backup-codes': 1 },
        files: 0,
        resumed: false,
        ...over,
      },
    })
  const idle: MoveStatus = {
    offered: true,
    held: true,
    running: false,
    done: 0,
    total: 0,
    finished: false,
  }

  it('says what moves and what stays before anything is written', async () => {
    accountReply = () => idle
    await show(<MoveScreen state={step()} dispatch={dispatch} />)
    expect(text()).toContain('What moves: 6 entries')
    expect(text()).toContain('Logins')
    expect(text()).toContain('Backup codes')
    expect(text()).toContain('Nothing is deleted from Vaultwarden until the check passes')
    expect(vi.mocked(account).mock.calls.some(([op]) => op === 'moveStart')).toBe(false)
  })

  it('starts on the click, and ends setup with the first sync once the core says it finished', async () => {
    accountReply = (request) =>
      request.op === 'moveStart' ? { ...idle, held: false, finished: true, step: 'done' } : idle
    const synced = { place: 'kemlock', server: 'https://km.example', running: false }
    vi.mocked(ask).mockResolvedValue(synced as never)
    await show(<MoveScreen state={step()} dispatch={dispatch} />)
    await click('Move the vault')
    expect(account).toHaveBeenCalledWith('moveStart', {})
    expect(ask).toHaveBeenCalledWith('syncNow')
    expect(dispatched).toContainEqual({ type: 'step', step: { step: 'done', status: synced } })
  })

  it('does not move a vault whose notes have attached files', async () => {
    accountReply = () => idle
    await show(<MoveScreen state={step({ files: 2 })} dispatch={dispatch} />)
    expect(text()).toContain('2 attached files')
    expect(button('Move the vault').disabled).toBe(true)
  })

  it("says why a move stopped, and offers the removal guard's two answers", async () => {
    accountReply = () => ({ ...idle, problem: 'removals' })
    await show(<MoveScreen state={step()} dispatch={dispatch} />)
    expect(text()).toContain('would remove many entries')
    await click('Keep everything')
    expect(account).toHaveBeenCalledWith('moveStart', { choice: 'keep' })
    await click('Remove them')
    expect(account).toHaveBeenCalledWith('moveStart', { choice: 'remove' })
  })

  it('ends the held sign-in when the person does not move', async () => {
    accountReply = () => idle
    await show(<MoveScreen state={step()} dispatch={dispatch} />)
    await click("Don't move")
    expect(account).toHaveBeenCalledWith('moveCancel')
    expect(dispatched).toEqual([{ type: 'cancelled' }])
  })

  it('shows a refusal of the core in its own words', async () => {
    accountReply = (request) => {
      if (request.op === 'moveStart') throw new AccountError('moveDone')
      return idle
    }
    await show(<MoveScreen state={step()} dispatch={dispatch} />)
    await click('Move the vault')
    expect(text()).toContain('This vault moved already')
  })
})

describe('a security key as the second step', () => {
  it('is asked by the core on the own page of the server, with nothing typed', async () => {
    vi.mocked(ask).mockResolvedValue({ step: 'masterPassword' } as never)
    await show(
      <SecondScreen
        state={state({ screen: { name: 'second', methods: ['securityKey'], unsupported: [] } })}
        dispatch={dispatch}
      />,
    )
    await click('Use my security key')
    expect(ask).toHaveBeenCalledWith('answerStep', {
      answer: { step: 'second', method: 'securityKey', code: '', remember: true },
    })
    expect(ask).not.toHaveBeenCalledWith('securityKeyChallenge')
    expect(dispatched).toEqual([{ type: 'step', step: { step: 'masterPassword' } }])
  })
})

describe('a sign-in that is held for a move', () => {
  it('is shown again from what the core says of it', async () => {
    accountReply = () => ({
      offered: true,
      held: true,
      running: false,
      done: 0,
      total: 0,
      finished: false,
      source: 'webdav',
      counts: { login: 2 },
      files: 0,
      resumed: false,
    })
    expect(await heldMoveStep()).toEqual({
      step: 'move',
      source: 'webdav',
      counts: { login: 2 },
      files: 0,
      resumed: false,
    })
  })

  it('is none when nothing is held, or the core cannot be asked', async () => {
    accountReply = () => ({
      offered: false,
      held: false,
      running: false,
      done: 0,
      total: 0,
      finished: false,
    })
    expect(await heldMoveStep()).toBeNull()
    accountReply = () => {
      throw new AccountError('locked')
    }
    expect(await heldMoveStep()).toBeNull()
  })
})

describe('the steps', () => {
  const run = (events: FlowEvent[], from: FlowState = initialState) => events.reduce(reduce, from)

  it('go to Create an account from the sign-in and back', () => {
    const form = state({ screen: { name: 'form' } })
    const registering = run([{ type: 'register' }], form)
    expect(registering.screen.name).toBe('register')
    expect(run([{ type: 'back' }], registering).screen.name).toBe('form')
  })

  it('show the move a sign-in holds, and go back to the place when it is not made', () => {
    const held = run(
      [
        {
          type: 'step',
          step: { step: 'move', source: 'webdav', counts: { login: 1 }, files: 0, resumed: true },
        },
      ],
      state({ screen: { name: 'form' } }),
    )
    expect(held.screen).toEqual({
      name: 'move',
      source: 'webdav',
      counts: { login: 1 },
      files: 0,
      resumed: true,
    })
    expect(run([{ type: 'cancelled' }], held).screen.name).toBe('place')
  })
})
