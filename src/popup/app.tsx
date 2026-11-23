// The popup: the lock screen while the vault is locked, otherwise a stack of pages over Home.
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { PopupView } from '../shared/api'
import { Notice, useLoad } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { AddCode } from './add-code'
import { loadVault, type Vault } from './data'
import { EditLogin } from './edit'
import { Generator } from './generator'
import { HealthPage } from './health'
import { Home, homeStart, type HomeUi } from './home'
import { LockScreen } from './lock'
import { LoginPage } from './login-page'
import { Recent } from './recent'
import type { Route } from './route'
import { ask, lockedEvent } from './send'
import { SettingsPage } from './settings'

function Unlocked(props: {
  view: PopupView
  notice?: string
  onLocked: () => void
  onRemoved: () => void
}) {
  const loaded = useLoad(loadVault)
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }])
  const [homeUi, setHomeUi] = useState<HomeUi>(homeStart)
  const route = stack[stack.length - 1] ?? { name: 'home' }
  const go = (next: Route) => setStack((previous) => [...previous, next])
  const back = () =>
    setStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous))
  const { tab } = props.view

  if (loaded.value === undefined) {
    return loaded.error !== undefined ? (
      <main class="pad">
        <Notice kind="error">{loaded.error}</Notice>
      </main>
    ) : (
      <div class="pad muted" role="status">
        {t('popup_loading')}
      </div>
    )
  }

  const vault: Vault = { ...loaded.value, reload: loaded.reload }

  const lock = () =>
    void ask('lock').then(props.onLocked, () => {
      props.onLocked()
    })

  switch (route.name) {
    case 'login':
      return <LoginPage id={route.id} vault={vault} tab={tab} onBack={back} onRoute={go} />
    case 'edit':
      return (
        <EditLogin
          id={route.id}
          prefill={route.prefill}
          vault={vault}
          onBack={back}
          onSaved={(id) => setStack([{ name: 'home' }, { name: 'login', id }])}
        />
      )
    case 'addCode':
      return <AddCode vault={vault} tab={tab} onBack={back} />
    case 'health':
      return (
        <HealthPage vault={vault} onBack={back} onOpenLogin={(id) => go({ name: 'login', id })} />
      )
    case 'generator':
      return <Generator onBack={back} onRecent={() => go({ name: 'recent' })} />
    case 'recent':
      return <Recent onBack={back} onSave={(prefill) => go({ name: 'edit', id: null, prefill })} />
    case 'settings':
      return <SettingsPage vault={vault} onBack={back} onRemoved={props.onRemoved} />
    default:
      return (
        <Home
          vault={vault}
          tab={tab}
          ui={homeUi}
          onUi={setHomeUi}
          notice={props.notice}
          onRoute={go}
          onLock={lock}
        />
      )
  }
}

export function App() {
  const [view, setView] = useState<PopupView | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    try {
      setView(await ask('popup'))
      setError(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  useEffect(() => {
    void refresh()
    // A call the background refused because the vault locked meanwhile (auto-lock, sleep).
    const onLocked = () => {
      setNotice(undefined)
      void refresh()
    }
    window.addEventListener(lockedEvent, onLocked)
    return () => window.removeEventListener(lockedEvent, onLocked)
  }, [refresh])

  if (view === undefined) {
    return error !== undefined ? (
      <main class="pad">
        <Notice kind="error">{error}</Notice>
      </main>
    ) : (
      <div class="pad muted" role="status">
        {t('popup_loading')}
      </div>
    )
  }

  if (!view.state.exists || !view.state.unlocked) {
    return (
      <LockScreen
        state={view.state}
        onUnlocked={(wrongBefore) => {
          setNotice(wrongBefore > 0 ? t('popup_wrongBefore', wrongBefore) : undefined)
          void refresh()
        }}
        onRemoved={() => void refresh()}
      />
    )
  }

  return (
    <Unlocked
      view={view}
      notice={notice}
      onLocked={() => {
        setNotice(undefined)
        void refresh()
      }}
      onRemoved={() => void refresh()}
    />
  )
}
