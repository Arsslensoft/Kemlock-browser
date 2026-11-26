// The files tab's page: the page the hash names while the vault is open and syncs with Kemlock Server, and, when it is locked, where to
// unlock it (the popup is where the password is typed; this page has no lock screen of its own). When the vault locks, the page goes
// with what it held, and the background lets go of the files it was given.
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { VaultState } from '../shared/api'
import { Wordmark } from '../shared/brand/brand'
import { Button, Notice } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { useVaultLock } from '../shared/vault-lock'
import { ask, lockedEvent } from '../popup/send'
import { AttachFiles } from './attach-files'
import { NewFile } from './new-file'
import { ReplaceFile } from './replace-file'
import { routeFromHash, type FilesRoute } from './route'

const titleOf = (route: FilesRoute): string =>
  t(
    route.name === 'newFile'
      ? 'files_new'
      : route.name === 'replace'
        ? 'files_replace'
        : route.name === 'attach'
          ? 'files_addFiles'
          : 'files_tabTitle',
  )

function Head(props: { title: string }) {
  return (
    <header class="files-head">
      <Wordmark height={20} />
      <h1>{props.title}</h1>
    </header>
  )
}

export function FilesTab() {
  const [state, setState] = useState<VaultState | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [route, setRoute] = useState<FilesRoute>(() => routeFromHash(location.hash))

  const refresh = useCallback(async () => {
    try {
      setState(await ask('pageState'))
      setError(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  // The vault locked: the page goes, with what it held, before anything else is asked
  useVaultLock(
    () => {
      setState((previous) => (previous === undefined ? previous : { ...previous, unlocked: false }))
      void refresh()
    },
    async () => (await ask('pageState')).unlocked,
  )

  useEffect(() => {
    void refresh()
    const onHash = () => setRoute(routeFromHash(location.hash))
    window.addEventListener('hashchange', onHash)
    // A call the background refused because the vault locked meanwhile (auto-lock, sleep)
    window.addEventListener(lockedEvent, refresh)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener(lockedEvent, refresh)
    }
  }, [refresh])

  useEffect(() => {
    document.title = `${t('files_tabTitle')} · ${titleOf(route)}`
  }, [route])

  if (state === undefined) {
    return (
      <main class="files-tab">
        <Head title={t('files_tabTitle')} />
        {error !== undefined ? (
          <Notice kind="error">{error}</Notice>
        ) : (
          <p class="muted" role="status">
            {t('popup_loading')}
          </p>
        )}
      </main>
    )
  }

  if (!state.exists || !state.unlocked) {
    return (
      <main class="files-tab">
        <Head title={t('files_tabTitle')} />
        <Notice kind="warn">
          <strong>{state.exists ? t('files_lockedTitle') : t('files_noVault')}</strong>{' '}
          {state.exists && t('files_locked')}
        </Notice>
        <div class="actions start">
          <Button kind="primary" onClick={() => void refresh()}>
            {t('files_tryAgain')}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main class="files-tab">
      <Head title={titleOf(route)} />
      {state.fileSync !== 'kemlock' ? (
        <Notice>{t('files_needSync')}</Notice>
      ) : route.name === 'invalid' ? (
        <Notice kind="error">{t('files_badAddress')}</Notice>
      ) : route.name === 'replace' ? (
        <ReplaceFile key={route.id} id={route.id} />
      ) : route.name === 'attach' ? (
        <AttachFiles key={route.noteId} noteId={route.noteId} />
      ) : (
        <NewFile />
      )}
    </main>
  )
}
