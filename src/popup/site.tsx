// The card for the tab in front: its logins and codes first, with Fill, or a warning when the
// address looks like another site's, or a hint when the vault has nothing for it.
import type { CodeView, LoginView, TabView } from '../shared/api'
import { Button, Notice, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { CodeValue, codeName } from './codes'
import type { Vault } from './data'
import type { Live } from './live'
import { PasswordLine } from './logins'
import { ask } from './send'

interface SiteItems {
  logins: LoginView[]
  /** Matched codes no matched login carries: each gets a card of its own. */
  codes: CodeView[]
  /** Every code the cards show, for the live ticker. */
  shownCodes: CodeView[]
}

export function siteItems(tab: TabView | undefined, vault: Vault): SiteItems {
  if (tab === undefined) return { logins: [], codes: [], shownCodes: [] }
  const logins = tab.match.logins
    .map((id) => vault.logins.find((login) => login.id === id))
    .filter((login): login is LoginView => login !== undefined)
  const linked = new Set(
    logins.flatMap((login) => (login.codeId === undefined ? [] : [login.codeId])),
  )
  const codes = tab.match.codes
    .filter((id) => !linked.has(id))
    .map((id) => vault.codes.find((code) => code.id === id))
    .filter((code): code is CodeView => code !== undefined)
  const linkedCodes = [...linked]
    .map((id) => vault.codes.find((code) => code.id === id))
    .filter((code): code is CodeView => code !== undefined)
  return { logins, codes, shownCodes: [...linkedCodes, ...codes] }
}

export function SiteCards(props: {
  tab: TabView | undefined
  vault: Vault
  live: Live
  onOpenLogin: (id: string) => void
}) {
  const { tab, vault, live } = props
  const say = useToast()
  if (tab === undefined) return null
  const items = siteItems(tab, vault)
  const { match } = tab

  const fill = async (args: { loginId?: string; codeId?: string }) => {
    try {
      await ask('fill', { tabId: tab.tabId, ...args })
      say(t('popup_filled'))
    } catch (error) {
      say(errorMessage(error))
    }
  }

  const nothing = items.logins.length === 0 && items.codes.length === 0

  return (
    <div class="site">
      {match.lookAlikeOf !== undefined && (
        <Notice kind="warn">
          <strong>{t('popup_lookAlikeTitle', match.lookAlikeOf)}</strong>{' '}
          {t('popup_lookAlikeBody', match.site)}
        </Notice>
      )}
      {nothing && match.lookAlikeOf === undefined && match.site !== '' && (
        <Notice>{t('popup_unknownSite', match.site)}</Notice>
      )}
      {items.logins.map((login) => {
        const code =
          login.codeId === undefined ? undefined : vault.codes.find((c) => c.id === login.codeId)
        return (
          <article class="card" key={login.id} aria-label={login.name}>
            <div class="row">
              <div class="grow">
                <h2 class="card-title">
                  <button type="button" class="link" onClick={() => props.onOpenLogin(login.id)}>
                    {login.name}
                  </button>
                </h2>
                {login.username !== '' && <div class="muted small ellipsis">{login.username}</div>}
              </div>
            </div>
            <PasswordLine login={login} />
            {code !== undefined && (
              <div class="row card-code">
                <span class="muted small grow ellipsis">{t('popup_twoStepCode')}</span>
                <CodeValue code={code} live={live} />
              </div>
            )}
            <div class="actions">
              {code !== undefined && !code.onSecurityKey && (
                <Button
                  label={t('popup_fillCodeOf', login.name)}
                  onClick={() => void fill({ codeId: code.id })}
                >
                  {t('popup_fillCode')}
                </Button>
              )}
              <Button
                kind="primary"
                label={t('popup_fillLoginOf', login.name)}
                onClick={() => void fill({ loginId: login.id })}
              >
                {t('popup_fillLogin')}
              </Button>
            </div>
          </article>
        )
      })}
      {items.codes.map((code) => (
        <article class="card" key={code.id} aria-label={codeName(code)}>
          <div class="grow">
            <h2 class="card-title">{codeName(code)}</h2>
            {code.issuer !== '' && <div class="muted small ellipsis">{code.account}</div>}
          </div>
          <div class="row card-code">
            <span class="grow" />
            <CodeValue code={code} live={live} />
          </div>
          {!code.onSecurityKey && (
            <div class="actions">
              <Button
                kind="primary"
                label={t('popup_fillCodeOf', codeName(code))}
                onClick={() => void fill({ codeId: code.id })}
              >
                {t('popup_fillCode')}
              </Button>
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
