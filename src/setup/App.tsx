// The setup tab: first run, "Set up again" (#again), "Sign in again" (#signin) and "Remove Kemlock
// from this browser" (#remove). The steps are flow.ts's; each screen asks the background.
import { useEffect, useReducer } from 'preact/hooks'
import { initialState, reduce, type FlowState, type Mode, type ProblemInfo } from './flow'
import { t } from './i18n'
import { AccessScreen, AddressScreen, FormScreen, PlaceScreen } from './placeScreens'
import { ask } from './send'
import {
  ApprovalScreen,
  FirstSyncScreen,
  HomesScreen,
  MasterPasswordScreen,
  NoHomeScreen,
  PassphraseScreen,
  SecondScreen,
} from './stepScreens'
import { Actions, FlowContext, Frame, Status, type Dispatch } from './ui'
import {
  DoneScreen,
  PasswordScreen,
  RemoveScreen,
  RemovedScreen,
  UnlockScreen,
} from './vaultScreens'

/** How the page was opened, from its address's fragment. */
export function modeOf(hash: string): Mode {
  switch (hash.replace(/^#/, '')) {
    case 'again':
      return 'again'
    case 'signin':
      return 'signin'
    case 'remove':
      return 'remove'
    default:
      return 'first'
  }
}

/** Reads the vault's state and routes to the first screen. */
export async function boot(dispatch: Dispatch, hash: string): Promise<void> {
  const mode = modeOf(hash)
  if (mode === 'remove') {
    dispatch({ type: 'loaded', mode, vault: null })
    return
  }
  try {
    const view = await ask('popup')
    dispatch({ type: 'loaded', mode, vault: view.state })
  } catch {
    dispatch({ type: 'failed', problem: 'setup', message: t('setup_error_load') })
  }
}

function Loading({ error, retry }: { error: ProblemInfo | null; retry: () => void }) {
  return (
    <Frame title={t('setup_loading_title')} error={error}>
      <Status>{t('setup_loading')}</Status>
      <Actions>
        <button type="button" class="secondary" onClick={retry}>
          {t('setup_retry')}
        </button>
      </Actions>
    </Frame>
  )
}

/** The screen of the step the flow is at. */
function Step({ state, dispatch }: { state: FlowState; dispatch: Dispatch }) {
  const props = { state, dispatch }
  switch (state.screen.name) {
    case 'loading':
      return <Loading error={state.error} retry={() => void boot(dispatch, window.location.hash)} />
    case 'unlock':
      return <UnlockScreen {...props} />
    case 'password':
      return <PasswordScreen {...props} />
    case 'place':
      return <PlaceScreen {...props} />
    case 'address':
      return <AddressScreen {...props} />
    case 'access':
      return <AccessScreen {...props} />
    case 'form':
      return <FormScreen {...props} />
    case 'second':
      return <SecondScreen {...props} />
    case 'approval':
      return <ApprovalScreen {...props} />
    case 'masterPassword':
      return <MasterPasswordScreen {...props} />
    case 'homes':
      return <HomesScreen {...props} />
    case 'noHome':
      return <NoHomeScreen {...props} />
    case 'passphrase':
      return <PassphraseScreen {...props} />
    case 'firstSync':
      return <FirstSyncScreen {...props} />
    case 'done':
      return <DoneScreen {...props} />
    case 'remove':
      return <RemoveScreen {...props} />
    case 'removed':
      return <RemovedScreen {...props} />
  }
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState)

  useEffect(() => {
    document.title = t('setup_title')
    document.documentElement.lang = chrome.i18n.getUILanguage()
    const start = () => void boot(dispatch, window.location.hash)
    start()
    window.addEventListener('hashchange', start)
    return () => window.removeEventListener('hashchange', start)
  }, [])

  return (
    <FlowContext.Provider value={state}>
      <Step state={state} dispatch={dispatch} />
    </FlowContext.Provider>
  )
}
