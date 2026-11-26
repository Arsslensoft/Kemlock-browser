import { describe, expect, it } from 'vitest'
import type { HomeView, SignInStep, SyncStatus, VaultState } from '../shared/api'
import { initialState, progressOf, reduce, type FlowEvent, type FlowState } from './flow'

const run = (events: FlowEvent[], from: FlowState = initialState): FlowState =>
  events.reduce(reduce, from)

const vault = (over: Partial<VaultState> = {}): VaultState => ({
  exists: true,
  unlocked: true,
  wrongPasswords: 0,
  fileSync: 'readOnly',
  ...over,
})

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  place: 'vaultwarden',
  server: 'https://vault.example',
  running: false,
  ...over,
})

const step = (s: SignInStep): FlowEvent => ({ type: 'step', step: s })

describe('where setup starts', () => {
  it('asks for the browser password on first run', () => {
    const state = run([{ type: 'loaded', mode: 'first', vault: vault({ exists: false }) }])
    expect(state.screen.name).toBe('password')
    expect(progressOf(state)).toEqual({ step: 1, total: 4 })
  })

  it('goes to the place when set up again, without the password step', () => {
    const state = run([{ type: 'loaded', mode: 'again', vault: vault() }])
    expect(state.screen.name).toBe('place')
    expect(progressOf(state)).toEqual({ step: 1, total: 3 })
  })

  it('treats a vault that exists as set up again even without a fragment', () => {
    expect(run([{ type: 'loaded', mode: 'first', vault: vault() }]).mode).toBe('again')
  })

  it('unlocks a locked vault first, counting the wrong passwords', () => {
    const locked = run([
      { type: 'loaded', mode: 'again', vault: vault({ unlocked: false, wrongPasswords: 2 }) },
    ])
    expect(locked.screen).toEqual({ name: 'unlock', wrongPasswords: 2 })
    expect(run([{ type: 'wrongPassword', wrongPasswords: 3 }], locked).screen).toEqual({
      name: 'unlock',
      wrongPasswords: 3,
    })
    expect(run([{ type: 'unlocked' }], locked).screen.name).toBe('place')
  })

  it('opens the remove confirmation without reading the vault', () => {
    expect(run([{ type: 'loaded', mode: 'remove', vault: null }]).screen.name).toBe('remove')
  })

  it('opens sign-in again at the address of the place the browser syncs with', () => {
    const state = run([
      { type: 'loaded', mode: 'signin', vault: vault({ sync: status({ account: 'a@b.c' }) }) },
    ])
    expect(state.screen.name).toBe('address')
    expect(state.place).toBe('vaultwarden')
    expect(state.address).toBe('https://vault.example')
  })

  it('removing leaves an empty browser that can be set up again', () => {
    const removed = run([{ type: 'loaded', mode: 'remove', vault: null }, { type: 'removed' }])
    expect(removed.screen.name).toBe('removed')
    expect(run([{ type: 'restart' }], removed).screen.name).toBe('password')
  })
})

describe('the place and its address', () => {
  const atPlace = run([{ type: 'loaded', mode: 'again', vault: vault() }])

  it('refuses http and says only https is accepted', () => {
    const state = run(
      [
        { type: 'place', place: 'vaultwarden' },
        { type: 'address', text: 'http://vault.example' },
      ],
      atPlace,
    )
    expect(state.screen.name).toBe('address')
    expect(state.addressError).toBe('insecure')
  })

  it('asks for access to the address as soon as it is typed, before anything is sent', () => {
    const state = run(
      [
        { type: 'place', place: 'kemlock' },
        { type: 'address', text: 'https://vault.riverstudio.co' },
      ],
      atPlace,
    )
    expect(state.screen).toEqual({ name: 'access', refused: false })
    expect(state.address).toBe('https://vault.riverstudio.co')
  })

  it('stays on the access step when it is refused, and goes on when it is granted', () => {
    const typed = run(
      [
        { type: 'place', place: 'webdav' },
        { type: 'address', text: 'https://dav.example/k' },
      ],
      atPlace,
    )
    expect(run([{ type: 'accessRefused' }], typed).screen).toEqual({
      name: 'access',
      refused: true,
    })
    expect(run([{ type: 'accessGranted' }], typed).screen.name).toBe('form')
  })

  it('goes back from the access step to the address, and from the address to the place', () => {
    const typed = run(
      [
        { type: 'place', place: 'webdav' },
        { type: 'address', text: 'https://dav.example/k' },
      ],
      atPlace,
    )
    const back = run([{ type: 'back' }], typed)
    expect(back.screen.name).toBe('address')
    expect(run([{ type: 'back' }], back).screen.name).toBe('place')
  })

  it('shows a failed server check at the address', () => {
    const state = run(
      [
        { type: 'place', place: 'vaultwarden' },
        { type: 'address', text: 'https://not-vw.example' },
        { type: 'failed', problem: 'address' },
      ],
      atPlace,
    )
    expect(state.screen.name).toBe('address')
    expect(state.error).toEqual({ problem: 'address' })
  })

  it('offers not syncing for now', () => {
    expect(run([{ type: 'skip' }], atPlace).screen).toEqual({ name: 'done', status: null })
  })
})

describe('sign-in steps', () => {
  const atForm = run([
    { type: 'loaded', mode: 'again', vault: vault() },
    { type: 'place', place: 'vaultwarden' },
    { type: 'address', text: 'https://vault.example' },
    { type: 'accessGranted' },
  ])

  it('goes to the second step with the methods the account has', () => {
    const state = run(
      [step({ step: 'second', methods: ['authenticator', 'email'], unsupported: ['duo'] })],
      atForm,
    )
    expect(state.screen).toEqual({
      name: 'second',
      methods: ['authenticator', 'email'],
      unsupported: ['duo'],
    })
  })

  it('shows a wrong code on the second step itself', () => {
    const second = run(
      [step({ step: 'second', methods: ['authenticator'], unsupported: [] })],
      atForm,
    )
    const state = run([step({ step: 'error', problem: 'auth' })], second)
    expect(state.screen.name).toBe('second')
    expect(state.error).toEqual({ problem: 'auth' })
  })

  it('keeps the approval screen while the poll repeats the step, and moves on when approved', () => {
    const approval: SignInStep = {
      step: 'approval',
      phrase: ['a', 'b', 'c', 'd', 'e'],
      requestId: 'r1',
    }
    const waiting = run([step(approval)], atForm)
    expect(run([step(approval)], waiting)).toBe(waiting)
    expect(run([step({ step: 'firstSync', adds: 3, removes: 0 })], waiting).screen).toEqual({
      name: 'firstSync',
      adds: 3,
      removes: 0,
    })
  })

  it('goes back to the form when an approval fails', () => {
    const waiting = run([step({ step: 'approval', phrase: [], requestId: 'r1' })], atForm)
    const state = run([step({ step: 'error', problem: 'sessionEnded' })], waiting)
    expect(state.screen.name).toBe('form')
    expect(state.error?.problem).toBe('sessionEnded')
  })

  it('asks the master password when there is no device to approve', () => {
    expect(run([step({ step: 'masterPassword' })], atForm).screen.name).toBe('masterPassword')
  })

  it('lists the homes, or says there is none', () => {
    const homes: HomeView[] = [{ id: 'h1', name: 'Kemlock', storage: 'sealed', items: 22 }]
    expect(run([step({ step: 'homes', homes })], atForm).screen).toEqual({ name: 'homes', homes })
    expect(run([step({ step: 'homes', homes: [] })], atForm).screen.name).toBe('noHome')
  })

  it('asks a wrong passphrase again, wherever it was typed', () => {
    const state = run([step({ step: 'error', problem: 'key' })], atForm)
    expect(state.screen.name).toBe('passphrase')
    expect(state.error?.problem).toBe('key')
  })

  it('shows the first sync before it runs, and ends at done', () => {
    const first = run([step({ step: 'firstSync', adds: 9, removes: 0 })], atForm)
    expect(first.screen.name).toBe('firstSync')
    expect(progressOf(first)).toEqual({ step: 3, total: 3 })
    const done = run([step({ step: 'done', status: status() })], first)
    expect(done.screen.name).toBe('done')
    expect(progressOf(done)).toBeNull()
    expect(run([{ type: 'cancelled' }], first).screen.name).toBe('place')
  })

  it('starts again at another address when the key must be asked there', () => {
    const state = run([{ type: 'useAddress', address: 'https://vault.own.example' }], atForm)
    expect(state.screen.name).toBe('address')
    expect(state.address).toBe('https://vault.own.example')
  })

  it('shows a failure of the background on the step it happened in', () => {
    const state = run([{ type: 'failed', problem: 'setup', message: 'x' }], atForm)
    expect(state.screen.name).toBe('form')
    expect(state.error).toEqual({ problem: 'setup', message: 'x' })
  })
})
