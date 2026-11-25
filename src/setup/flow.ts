// The setup tab's steps as a pure reducer (design decision 3, specs browser-vault and
// browser-sync). Screens hold what they show; secrets (passwords, passphrases, codes) never
// enter this state, the forms keep them until they are sent.
import type {
  HomeView,
  SecondMethod,
  SignInStep,
  SyncPlace,
  SyncStatus,
  VaultState,
} from '../shared/api'
import { parseAddress, type AddressProblem } from './address'

/** How the page was opened: first run, "Set up again" (#again), "Sign in again" (#signin), "Remove" (#remove). */
export type Mode = 'first' | 'again' | 'signin' | 'remove'

export type Screen =
  | { name: 'loading' }
  | { name: 'unlock'; wrongPasswords: number }
  | { name: 'password' }
  | { name: 'place' }
  | { name: 'address' }
  | { name: 'access'; refused: boolean }
  | { name: 'form' }
  | { name: 'second'; methods: SecondMethod[]; unsupported: string[] }
  | { name: 'approval'; phrase: string[]; requestId: string }
  | { name: 'masterPassword' }
  /** Kemlock Server: making an account (account/accountScreens.tsx). */
  | { name: 'register' }
  /** Kemlock Server: the vault moves off Vaultwarden or WebDAV into it, once the person says so. */
  | {
      name: 'move'
      source: 'vaultwarden' | 'webdav'
      counts: Record<string, number>
      files: number
      resumed: boolean
    }
  | { name: 'homes'; homes: HomeView[] }
  | { name: 'noHome' }
  | { name: 'passphrase' }
  | { name: 'firstSync'; adds: number; removes: number }
  | { name: 'done'; status: SyncStatus | null }
  | { name: 'remove' }
  | { name: 'removed' }

export type ScreenName = Screen['name']

/** A sync problem to show in the app's words (`message` is the background's own, when it has one). */
export interface ProblemInfo {
  problem: string
  message?: string
}

export interface FlowState {
  mode: Mode
  screen: Screen
  place: SyncPlace | null
  /** The server or folder address, as accepted by parseAddress. */
  address: string
  addressError: AddressProblem | null
  error: ProblemInfo | null
  /** Where the browser syncs now, when set up again. */
  current: SyncStatus | null
}

export const initialState: FlowState = {
  mode: 'first',
  screen: { name: 'loading' },
  place: null,
  address: '',
  addressError: null,
  error: null,
  current: null,
}

export type FlowEvent =
  /** The page opened: how, and the vault's state (null for #remove, which needs none). */
  | { type: 'loaded'; mode: Mode; vault: VaultState | null }
  | { type: 'unlocked' }
  | { type: 'wrongPassword'; wrongPasswords: number }
  | { type: 'created' }
  | { type: 'place'; place: SyncPlace }
  | { type: 'register' }
  | { type: 'address'; text: string }
  /** The security key's page is on another address: start again at the address, with it typed. */
  | { type: 'useAddress'; address: string }
  | { type: 'accessRefused' }
  | { type: 'accessGranted' }
  | { type: 'step'; step: SignInStep }
  /** A failure with no step of its own (the server check, a message the background refused). */
  | { type: 'failed'; problem: string; message?: string }
  | { type: 'back' }
  | { type: 'skip' }
  | { type: 'cancelled' }
  | { type: 'removed' }
  | { type: 'restart' }

const withScreen = (state: FlowState, screen: Screen): FlowState => ({
  ...state,
  screen,
  error: null,
})

function afterUnlock(state: FlowState): FlowState {
  if (state.mode === 'signin' && state.place !== null && state.address !== '')
    return withScreen(state, { name: 'address' })
  return withScreen(state, { name: 'place' })
}

function loaded(state: FlowState, mode: Mode, vault: VaultState | null): FlowState {
  const next: FlowState = { ...state, mode }
  if (mode === 'remove') return withScreen(next, { name: 'remove' })
  if (vault === null || !vault.exists)
    return withScreen({ ...next, mode: 'first' }, { name: 'password' })
  // A vault that exists is never first-run, whichever way the page was opened
  if (next.mode === 'first') next.mode = 'again'
  next.current = vault.sync ?? null
  if (mode === 'signin' && vault.sync !== undefined) {
    next.place = vault.sync.place
    next.address = vault.sync.server
  }
  if (!vault.unlocked)
    return withScreen(next, { name: 'unlock', wrongPasswords: vault.wrongPasswords })
  return afterUnlock(next)
}

function failed(state: FlowState, problem: string, message?: string): FlowState {
  const error: ProblemInfo = message === undefined ? { problem } : { problem, message }
  // A wrong sync passphrase is asked again, wherever it was first typed
  if (problem === 'key') return { ...state, screen: { name: 'passphrase' }, error }
  switch (state.screen.name) {
    case 'access':
      return { ...state, screen: { name: 'address' }, error }
    case 'approval':
      return { ...state, screen: { name: 'form' }, error }
    default:
      return { ...state, error }
  }
}

function stepped(state: FlowState, step: SignInStep): FlowState {
  switch (step.step) {
    case 'done':
      return withScreen(state, { name: 'done', status: step.status })
    case 'second':
      return withScreen(state, {
        name: 'second',
        methods: step.methods,
        unsupported: step.unsupported,
      })
    case 'approval':
      // The poll's answers repeat the step until it is approved
      if (state.screen.name === 'approval' && state.screen.requestId === step.requestId)
        return state
      return withScreen(state, { name: 'approval', phrase: step.phrase, requestId: step.requestId })
    case 'masterPassword':
      return withScreen(state, { name: 'masterPassword' })
    case 'move':
      return withScreen(state, {
        name: 'move',
        source: step.source,
        counts: step.counts,
        files: step.files,
        resumed: step.resumed,
      })
    case 'homes':
      return withScreen(
        state,
        step.homes.length === 0 ? { name: 'noHome' } : { name: 'homes', homes: step.homes },
      )
    case 'passphrase':
      return withScreen(state, { name: 'passphrase' })
    case 'firstSync':
      return withScreen(state, { name: 'firstSync', adds: step.adds, removes: step.removes })
    case 'error':
      return failed(state, step.problem, step.message)
  }
}

function back(state: FlowState): FlowState {
  switch (state.screen.name) {
    case 'address':
      return withScreen({ ...state, addressError: null }, { name: 'place' })
    case 'access':
    case 'form':
      return withScreen(state, { name: 'address' })
    case 'register':
      return withScreen(state, { name: 'form' })
    case 'second':
    case 'approval':
    case 'masterPassword':
    case 'homes':
    case 'noHome':
    case 'passphrase':
    case 'firstSync':
      return withScreen(state, { name: 'form' })
    default:
      return state
  }
}

export function reduce(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'loaded':
      return loaded(state, event.mode, event.vault)
    case 'unlocked':
      return afterUnlock(state)
    case 'wrongPassword':
      return { ...state, screen: { name: 'unlock', wrongPasswords: event.wrongPasswords } }
    case 'created':
      return withScreen(state, { name: 'place' })
    case 'place':
      return withScreen(
        { ...state, place: event.place, address: '', addressError: null },
        { name: 'address' },
      )
    case 'register':
      return withScreen(state, { name: 'register' })
    case 'address': {
      const parsed = parseAddress(event.text)
      if (!parsed.ok) return { ...state, addressError: parsed.reason, error: null }
      return withScreen(
        { ...state, address: parsed.address, addressError: null },
        { name: 'access', refused: false },
      )
    }
    case 'useAddress':
      return withScreen(
        { ...state, address: event.address, addressError: null },
        { name: 'address' },
      )
    case 'accessRefused':
      return { ...state, screen: { name: 'access', refused: true }, error: null }
    case 'accessGranted':
      return withScreen(state, { name: 'form' })
    case 'step':
      return stepped(state, event.step)
    case 'failed':
      return failed(state, event.problem, event.message)
    case 'back':
      return back(state)
    case 'skip':
      return withScreen(state, { name: 'done', status: state.current })
    case 'cancelled':
      return withScreen(state, { name: 'place' })
    case 'removed':
      return withScreen({ ...initialState, mode: 'first' }, { name: 'removed' })
    case 'restart':
      return withScreen({ ...initialState, mode: 'first' }, { name: 'password' })
  }
}

/** "Step n of total" for the screens that belong to one, or null. */
export function progressOf(state: FlowState): { step: number; total: number } | null {
  const first = state.mode === 'first'
  const stage = (() => {
    switch (state.screen.name) {
      case 'password':
        return 1
      case 'place':
      case 'address':
      case 'access':
        return 2
      case 'form':
      case 'register':
      case 'second':
      case 'approval':
      case 'masterPassword':
        return 3
      case 'homes':
      case 'noHome':
      case 'passphrase':
      case 'firstSync':
      case 'move':
        return 4
      default:
        return 0
    }
  })()
  if (stage === 0) return null
  return first ? { step: stage, total: 4 } : { step: stage - 1, total: 3 }
}
