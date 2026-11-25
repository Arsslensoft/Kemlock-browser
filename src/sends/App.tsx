// The Sends tab's frame: its two pages, New Send and Open a Send, by the address's hash (`#new`, `#open`) the popup opens it with.
// When the vault locks the pages go with what they held (a text being written, a received Send's text, a file going up), and the tab
// says that Kemlock is locked.
import { useEffect, useState } from 'preact/hooks'
import { Wordmark } from '../shared/brand/brand'
import { Button, Notice, Tabs } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { useVaultLock } from '../shared/vault-lock'
import { ask } from './ask'
import { NewSend } from './new-send'
import { OpenSend } from './open-send'
import { draftTokenOf } from './tabs'

type Page = 'new' | 'open'

const pageOf = (hash: string): Page => (hash === '#open' ? 'open' : 'new')

export function App() {
  const [page, setPage] = useState<Page>(() => pageOf(location.hash))
  const [locked, setLocked] = useState(false)
  // A note's draft the popup left for New Send (`#new:<token>`): taken once, and the token leaves the address at once
  const [draftToken, setDraftToken] = useState(() => draftTokenOf(location.hash))
  useEffect(() => {
    if (draftToken !== undefined) history.replaceState(null, '', '#new')
  }, [])

  useEffect(() => {
    document.title = t('sends_title')
    const onHash = () => setPage(pageOf(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // The vault locked: the pages are taken down at once, which lets go of the received Send's handle and of a file being sent, and
  // nothing typed or received stays in the tab. The check on coming to the front is for a tab that missed the message.
  useVaultLock(
    () => setLocked(true),
    async () => (await ask('pageState')).unlocked,
  )

  const again = async () => {
    try {
      if ((await ask('pageState')).unlocked) setLocked(false)
    } catch {
      // Still locked, or the background is not answering: the page stays as it is
    }
  }

  const go = (next: Page) => {
    setPage(next)
    history.replaceState(null, '', `#${next}`)
  }

  if (locked)
    return (
      <main class="sends-tab">
        <header class="sends-head">
          <Wordmark height={20} />
          <h1>{t('sends_title')}</h1>
        </header>
        <div class="sends-panel">
          <Notice kind="warn">
            <strong>{t('sends_lockedTitle')}</strong> {t('sends_locked')}
          </Notice>
          <div class="actions start">
            <Button kind="primary" onClick={() => void again()}>
              {t('sends_lockedRetry')}
            </Button>
          </div>
        </div>
      </main>
    )

  return (
    <main class="sends-tab">
      <header class="sends-head">
        <Wordmark height={20} />
        <h1>{t('sends_title')}</h1>
      </header>
      <p class="muted">{t('sends_subtitle')}</p>
      <Tabs
        label={t('sends_pages')}
        selected={page}
        onSelect={(id) => go(id === 'open' ? 'open' : 'new')}
        tabs={[
          { id: 'new', label: t('sends_new') },
          { id: 'open', label: t('sends_open') },
        ]}
      />
      <div role="tabpanel" id={`panel-${page}`} aria-labelledby={`tab-${page}`}>
        {page === 'new' ? (
          <NewSend draftToken={draftToken} onDraftTaken={() => setDraftToken(undefined)} />
        ) : (
          <OpenSend />
        )}
      </div>
    </main>
  )
}
