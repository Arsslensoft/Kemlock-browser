// The popup: the lock screen while the vault is locked, otherwise a stack of pages over Home.
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { PopupView } from '../shared/api'
import { Notice, useLoad } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { useVaultLock } from '../shared/vault-lock'
import { AddCode } from './add-code'
import { BackupCodesPage } from './backup-codes'
import { CardPage, EditCard } from './card-page'
import { rememberClipboardSeconds } from './copy'
import { loadVault, type Vault } from './data'
import { EditLogin } from './edit'
import { Generator } from './generator'
import { HealthPage } from './health'
import { Home, homeStart, type HomeUi } from './home'
import { EditIdentity, IdentityPage } from './identity-page'
import { KeysScreen } from './keys'
import { LockScreen } from './lock'
import { requestedTab } from './links'
import { LoginPage } from './login-page'
import { EditNote, NotePage } from './note-page'
import { PasskeyPage } from './passkeys'
import { Recent } from './recent'
import type { Route } from './route'
import { ask, lockedEvent } from './send'
import { SendPage } from './send-page'
import { SendsPage } from './sends'
import { SettingsPage } from './settings'
import { SpacesPage } from './spaces'
import { isToolsRoute } from './tools/routes'
import { ToolsRouter } from './tools/router'

/** `popup` as the background will take it: `PageApi.popup(args?: { tabId?: number })`. */

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
      <main class="screen pad">
        <Notice kind="error">{loaded.error}</Notice>
      </main>
    ) : (
      <div class="screen pad muted" role="status">
        {t('popup_loading')}
      </div>
    )
  }

  const vault: Vault = { ...loaded.value, reload: loaded.reload }
  rememberClipboardSeconds(vault.settings.clipboardSeconds)

  const lock = () =>
    void ask('lock').then(props.onLocked, () => {
      props.onLocked()
    })

  // Added by tools: the vault tools' pages
  if (isToolsRoute(route)) return <ToolsRouter route={route} vault={vault} onBack={back} go={go} />

  switch (route.name) {
    case 'login':
      return <LoginPage id={route.id} vault={vault} tab={tab} onBack={back} onRoute={go} />
    case 'passkey':
      return <PasskeyPage id={route.id} vault={vault} onBack={back} onRoute={go} />
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
        <HealthPage
          vault={vault}
          onBack={back}
          onOpenLogin={(id) => go({ name: 'login', id })}
          onSettings={() => go({ name: 'settings' })}
          onBreaches={() => go({ name: 'breaches' })}
        />
      )
    case 'backupCodes':
      return <BackupCodesPage vault={vault} onBack={back} onRoute={go} />
    case 'generator':
      return <Generator onBack={back} onRecent={() => go({ name: 'recent' })} />
    case 'recent':
      return <Recent onBack={back} onSave={(prefill) => go({ name: 'edit', id: null, prefill })} />
    case 'settings':
      return <SettingsPage vault={vault} tab={tab} onBack={back} onRemoved={props.onRemoved} />
    case 'spaces':
      return <SpacesPage vault={vault} open={route.open} onBack={back} onRoute={go} />
    // Added by sends (begin)
    case 'sends':
      return <SendsPage onBack={back} onRoute={go} />
    case 'send':
      return <SendPage id={route.id} vault={vault} onBack={back} />
    // Added by sends (end)
    case 'keys':
      return <KeysScreen onBack={back} />
    // Notes, cards and identities: after a save the new page replaces the edit page over Home
    case 'note':
      return <NotePage id={route.id} vault={vault} onBack={back} onRoute={go} />
    case 'noteEdit':
      return (
        <EditNote
          id={route.id}
          vault={vault}
          onBack={back}
          onSaved={(id) => setStack([{ name: 'home' }, { name: 'note', id }])}
        />
      )
    case 'card':
      return <CardPage id={route.id} vault={vault} tab={tab} onBack={back} onRoute={go} />
    case 'cardEdit':
      return (
        <EditCard
          id={route.id}
          vault={vault}
          onBack={back}
          onSaved={(id) => setStack([{ name: 'home' }, { name: 'card', id }])}
        />
      )
    case 'identity':
      return <IdentityPage id={route.id} vault={vault} tab={tab} onBack={back} onRoute={go} />
    case 'identityEdit':
      return (
        <EditIdentity
          id={route.id}
          vault={vault}
          onBack={back}
          onSaved={(id) => setStack([{ name: 'home' }, { name: 'identity', id }])}
        />
      )
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
      const tabId = requestedTab()
      // Opened as a tab (the browser tests): the background answers for that tab, not the one in front.
      setView(await ask('popup', tabId === undefined ? {} : { tabId }))
      setError(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  // The vault locked (auto-lock, sleep, the lock button in another window): the lock screen replaces the pages at once, before the
  // background has answered again, so nothing decrypted stays on screen. The check is for a popup that missed the message.
  useVaultLock(
    () => {
      setNotice(undefined)
      setView((previous) =>
        previous === undefined
          ? previous
          : { ...previous, state: { ...previous.state, unlocked: false } },
      )
      void refresh()
    },
    async () => (await ask('pageState')).unlocked,
  )

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
      <main class="screen pad">
        <Notice kind="error">{error}</Notice>
      </main>
    ) : (
      <div class="screen pad muted" role="status">
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
