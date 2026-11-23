// "Add a code": the QR code on the page in front is read as the page opens and shown, with its name
// editable and an offer to link it to the site's login, and added on confirmation; or a pasted
// otpauth:// link is added straight away.
import { useEffect, useState } from 'preact/hooks'
import type { CodePreview, CodeView, LoginView, TabView } from '../shared/api'
import {
  Button,
  Notice,
  PageHeader,
  Section,
  Switch,
  TextField,
  useToast,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { codeName } from './codes'
import type { Vault } from './data'
import { ask } from './send'

/** The name a preview starts with: its issuer, else its account. */
const nameOf = (preview: CodePreview): string =>
  preview.issuer !== '' ? preview.issuer : preview.account

/** [link] with [issuer] as its issuer, in the parameter and in the label. */
export function withIssuer(link: string, issuer: string): string {
  try {
    const url = new URL(link)
    const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const account = (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label).trim()
    url.searchParams.set('issuer', issuer)
    url.pathname = `/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
    return url.toString()
  } catch {
    return link
  }
}

export function AddCode(props: { vault: Vault; tab: TabView | undefined; onBack: () => void }) {
  const { vault, tab } = props
  const tabId = tab?.tabId
  const say = useToast()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [none, setNone] = useState(false)
  const [preview, setPreview] = useState<CodePreview | undefined>()
  const [name, setName] = useState('')
  const [linkTo, setLinkTo] = useState<string | undefined>()
  const [added, setAdded] = useState<CodeView | undefined>()
  const [linkedTo, setLinkedTo] = useState<string | undefined>()

  // The site's logins that have no code yet: the ones a new code may belong to.
  const offers: LoginView[] =
    tab === undefined
      ? []
      : tab.match.logins
          .map((id) => vault.logins.find((login) => login.id === id))
          .filter((login): login is LoginView => login !== undefined && login.codeId === undefined)

  const scan = async (id: number) => {
    setScanning(true)
    setError(undefined)
    setNone(false)
    setPreview(undefined)
    try {
      const found = await ask('readCodeFromTab', { tabId: id })
      if (found === null) {
        setNone(true)
      } else {
        setPreview(found)
        setName(nameOf(found))
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setScanning(false)
    }
  }

  // The page in front is read as "Add a code" opens
  useEffect(() => {
    if (tabId !== undefined) void scan(tabId)
  }, [tabId])

  const attempt = async (work: () => Promise<CodeView>, offered?: string) => {
    setBusy(true)
    setError(undefined)
    try {
      const code = await work()
      setAdded(code)
      if (offered !== undefined) setLinkedTo(offers.find((login) => login.id === offered)?.name)
      await vault.reload()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const addFound = (found: CodePreview) => {
    const edited = name.trim()
    const otpauth =
      edited !== '' && edited !== nameOf(found) ? withIssuer(found.otpauth, edited) : found.otpauth
    void attempt(
      () =>
        ask('addCodeFromLink', {
          otpauth,
          ...(found.website === undefined ? {} : { website: found.website }),
          ...(linkTo === undefined ? {} : { linkTo }),
        }),
      linkTo,
    )
  }

  const linkAfter = async (login: LoginView) => {
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
              <Button key={login.id} kind="primary" onClick={() => void linkAfter(login)}>
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
          {preview !== undefined && preview.existing !== undefined && (
            <Section title={t('popup_fromPage')}>
              <Notice kind="warn">
                {t('popup_codeAlready', codeName(preview.existing), preview.existing.account)}
              </Notice>
            </Section>
          )}
          {preview !== undefined && preview.existing === undefined && (
            <Section title={t('popup_fromPage')}>
              <div>
                <div class="strong ellipsis">{nameOf(preview)}</div>
                {preview.account !== '' && (
                  <div class="muted small ellipsis">{preview.account}</div>
                )}
              </div>
              <TextField label={t('popup_codeName')} value={name} onInput={setName} />
              {offers.map((login) => (
                <Switch
                  key={login.id}
                  label={t('popup_linkToLogin', login.name)}
                  checked={linkTo === login.id}
                  onChange={(on) => setLinkTo(on ? login.id : undefined)}
                />
              ))}
              <div class="actions start">
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={name.trim() === ''}
                  onClick={() => addFound(preview)}
                >
                  {t('popup_add')}
                </Button>
              </div>
            </Section>
          )}
          {preview === undefined && (
            <Section title={t('popup_fromPage')}>
              <p class="muted" role={scanning ? 'status' : undefined}>
                {scanning ? t('popup_scanning') : t('popup_fromPageBody')}
              </p>
              {none && <Notice kind="warn">{t('popup_noCodeFound')}</Notice>}
              <div class="actions start">
                <Button
                  icon="search"
                  busy={scanning}
                  disabled={tabId === undefined}
                  onClick={() => tabId !== undefined && void scan(tabId)}
                >
                  {t('popup_scanPage')}
                </Button>
              </div>
            </Section>
          )}

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
