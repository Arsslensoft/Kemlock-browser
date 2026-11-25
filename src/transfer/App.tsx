// The transfer tab: Import and Export over the open vault. The vault must be open; the tab has a lock screen of its own for it,
// since it is not the popup (the popup closes when a file dialog opens, which is why this is a tab).
import { useCallback, useEffect, useState } from 'preact/hooks'
import { KemlockIcon } from '../shared/brand/brand'
import type { ExportInfo } from '../shared/transfer'
import { Button, Notice, Tabs, TextField } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { useVaultLock } from '../shared/vault-lock'
import { ExportPanel } from './export'
import { ImportPanel } from './import'
import { ask, AskError } from './send'
import { errorLine } from './text'

export type Panel = 'import' | 'export'

/** Which panel the address's fragment asks for (`#export`); Import by default. */
export function panelOf(hash: string): Panel {
  return hash.replace(/^#/, '') === 'export' ? 'export' : 'import'
}

type Gate =
  | { name: 'loading' }
  | { name: 'ready'; info: ExportInfo }
  | { name: 'locked'; wrong: number }
  | { name: 'noVault' }
  | { name: 'failed'; error: string }

function Unlock(props: { wrong: number; onOpened: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(props.wrong)
  const [error, setError] = useState<string | undefined>()
  const submit = async (event: Event) => {
    event.preventDefault()
    if (password === '' || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await ask('transferUnlock', { password })
      if (result.ok) {
        setPassword('')
        props.onOpened()
        return
      }
      setWrong(result.wrongPasswords)
      setError(t('transfer_unlock_wrong'))
    } catch (failure) {
      setError(errorLine(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form class="card" onSubmit={(event) => void submit(event)}>
      <h2>{t('transfer_unlock_title')}</h2>
      <p class="muted">{t('transfer_unlock_body')}</p>
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      {wrong > 1 && <p class="muted small">{t('transfer_unlock_count', wrong)}</p>}
      <TextField
        label={t('transfer_unlock_password')}
        type="password"
        value={password}
        autocomplete="current-password"
        autofocus
        onInput={setPassword}
      />
      <div class="actions start">
        <Button kind="primary" type="submit" busy={busy} disabled={password === ''}>
          {t('transfer_unlock_button')}
        </Button>
      </div>
    </form>
  )
}

export function App() {
  const [panel, setPanel] = useState<Panel>(() => panelOf(location.hash))
  const [gate, setGate] = useState<Gate>({ name: 'loading' })

  const load = useCallback(async () => {
    try {
      setGate({ name: 'ready', info: await ask('transferExportInfo') })
    } catch (failure) {
      const code = failure instanceof AskError ? failure.code : 'failed'
      if (code === 'locked') setGate({ name: 'locked', wrong: 0 })
      else if (code === 'noVault') setGate({ name: 'noVault' })
      else setGate({ name: 'failed', error: errorLine(failure) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The vault locked: the panels go with what they held (an opened file's preview, a file or QR codes of an export, which are let go
  // as the panels unmount) and the tab asks for the password again. The check is for a tab that missed the message.
  useVaultLock(
    () =>
      setGate((previous) =>
        previous.name === 'noVault' ? previous : { name: 'locked', wrong: 0 },
      ),
    async () => (await ask('pageState')).unlocked,
  )

  useEffect(() => {
    const follow = () => setPanel(panelOf(location.hash))
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  const choose = (id: string) => {
    const next: Panel = id === 'export' ? 'export' : 'import'
    setPanel(next)
    history.replaceState(null, '', `#${next}`)
  }

  return (
    <div class="transfer">
      <header class="head">
        <KemlockIcon size={32} />
        <h1>{t('transfer_title')}</h1>
      </header>
      {gate.name === 'loading' && <p class="muted">{t('transfer_loading')}</p>}
      {gate.name === 'noVault' && (
        <Notice kind="warn">
          <span>{t('transfer_noVault')}</span>
        </Notice>
      )}
      {gate.name === 'failed' && (
        <div class="card">
          <Notice kind="error">{gate.error}</Notice>
          <div class="actions start">
            <Button onClick={() => void load()}>{t('transfer_retry')}</Button>
          </div>
        </div>
      )}
      {gate.name === 'locked' && <Unlock wrong={gate.wrong} onOpened={() => void load()} />}
      {gate.name === 'ready' && (
        <>
          <Tabs
            label={t('transfer_tabs')}
            selected={panel}
            onSelect={choose}
            tabs={[
              { id: 'import', label: t('transfer_tab_import') },
              { id: 'export', label: t('transfer_tab_export') },
            ]}
          />
          <section
            role="tabpanel"
            id={`panel-${panel}`}
            aria-labelledby={`tab-${panel}`}
            class="panel"
          >
            {panel === 'import' ? (
              <ImportPanel onLocked={() => void load()} onApplied={() => void load()} />
            ) : (
              <ExportPanel info={gate.info} onLocked={() => void load()} />
            )}
          </section>
        </>
      )}
    </div>
  )
}
