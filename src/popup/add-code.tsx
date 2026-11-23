// "Add a code": from a QR code on the page in front, or from a pasted otpauth:// link, then an
// offer to link it to the site's login.
import { useState } from 'preact/hooks'
import type { CodeView, LoginView, TabView } from '../shared/api'
import { Button, Notice, PageHeader, Section, TextField, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { codeName } from './codes'
import type { Vault } from './data'
import { ask } from './send'

export function AddCode(props: { vault: Vault; tab: TabView | undefined; onBack: () => void }) {
  const { vault, tab } = props
  const say = useToast()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [none, setNone] = useState(false)
  const [added, setAdded] = useState<CodeView | undefined>()
  const [linkedTo, setLinkedTo] = useState<string | undefined>()

  // The site's logins that have no code yet: the ones a new code may belong to.
  const offers: LoginView[] =
    tab === undefined
      ? []
      : tab.match.logins
          .map((id) => vault.logins.find((login) => login.id === id))
          .filter((login): login is LoginView => login !== undefined && login.codeId === undefined)

  const attempt = async (work: () => Promise<CodeView | null>) => {
    setBusy(true)
    setError(undefined)
    setNone(false)
    try {
      const code = await work()
      if (code === null) {
        setNone(true)
      } else {
        setAdded(code)
        await vault.reload()
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const linkTo = async (login: LoginView) => {
    if (added === undefined) return
    try {
      await ask('linkCode', { codeId: added.id, loginId: login.id })
      setLinkedTo(login.name)
      await vault.reload()
    } catch (failure) {
      say(errorMessage(failure))
    }
  }

  return (
    <div>
      <PageHeader title={t('popup_addCode')} onBack={props.onBack} backLabel={t('popup_back')} />

      {added !== undefined ? (
        <Section>
          <Notice kind="ok">{t('popup_codeAdded', codeName(added), added.account)}</Notice>
          {linkedTo !== undefined ? (
            <Notice>{t('popup_codeLinkedTo', linkedTo)}</Notice>
          ) : (
            offers.map((login) => (
              <Button key={login.id} kind="primary" onClick={() => void linkTo(login)}>
                {t('popup_linkToLogin', login.name)}
              </Button>
            ))
          )}
          <div class="actions">
            <Button onClick={props.onBack}>{t('popup_done')}</Button>
          </div>
        </Section>
      ) : (
        <>
          <Section title={t('popup_fromPage')}>
            <p class="muted">{t('popup_fromPageBody')}</p>
            <div class="actions start">
              <Button
                kind="primary"
                icon="search"
                busy={busy}
                disabled={tab === undefined}
                onClick={() => void attempt(() => ask('addCodeFromTab', { tabId: tab!.tabId }))}
              >
                {t('popup_scanPage')}
              </Button>
            </div>
            {none && <Notice kind="warn">{t('popup_noCodeFound')}</Notice>}
          </Section>

          <form
            class="section"
            onSubmit={(event) => {
              event.preventDefault()
              if (link.trim() !== '')
                void attempt(() => ask('addCodeFromLink', { otpauth: link.trim() }))
            }}
          >
            <h2 class="section-title">{t('popup_fromLink')}</h2>
            <TextField
              label={t('popup_linkField')}
              value={link}
              placeholder="otpauth://totp/…"
              onInput={setLink}
            />
            <div class="actions start">
              <Button type="submit" busy={busy} disabled={link.trim() === ''}>
                {t('popup_add')}
              </Button>
            </div>
          </form>
          {error !== undefined && (
            <Section>
              <Notice kind="error">{error}</Notice>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
