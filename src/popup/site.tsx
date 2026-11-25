// The card for the tab in front: its logins and codes first, with Fill, or a warning when the
// address looks like another site's, or a hint when the vault has nothing for it.
import type { CodeView, LoginView, TabView } from '../shared/api'
import type { PasskeyView } from '../shared/passkeys'
import { Button, IconButton, Notice, Tile, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { CodeLine, codeName } from './codes'
import type { Vault } from './data'
import type { Live } from './live'
import { PasswordLine } from './logins'
import { SpaceBadge } from './spaces'
import { SitePasskeys } from './passkeys'
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

/** The fill buttons of a site's card say what went to the page, in a toast. */
export function useFill(tab: TabView | undefined) {
  const say = useToast()
  return async (args: { loginId?: string; codeId?: string }) => {
    if (tab === undefined) return
    try {
      await ask('fill', { tabId: tab.tabId, ...args })
      if (args.codeId !== undefined && args.loginId === undefined)
        say(t('popup_codeFilledOn', tab.match.site), t('popup_codeFilledSub'))
      else say(t('popup_loginFilledOn', tab.match.site), t('popup_loginFilledSub'))
    } catch (error) {
      say(errorMessage(error))
    }
  }
}

export function SiteCards(props: {
  tab: TabView | undefined
  vault: Vault
  live: Live
  onOpenLogin: (id: string) => void
  /** Added by passkeys: the vault's passkeys, and the way to one's page. */
  passkeys?: PasskeyView[]
  onOpenPasskey?: (id: string) => void
}) {
  const { tab, vault, live } = props
  const fill = useFill(tab)
  if (tab === undefined) return null
  const items = siteItems(tab, vault)
  const { match } = tab
  const heldPasskeys = new Set(match.passkeys ?? [])
  const nothing = items.logins.length === 0 && items.codes.length === 0 && heldPasskeys.size === 0
  const hasCards = !nothing

  if (!hasCards && match.lookAlikeOf === undefined && match.site === '') return null

  return (
    <section class="site" aria-label={t('popup_onThisSite')}>
      <div class="site-head">
        <span class="label-caps">{t('popup_onThisSite')}</span>
        {match.site !== '' && (
          <span class="site-chip">
            <Icon name="shieldCheck" size={13} weight={2} />
            {match.site}
          </span>
        )}
      </div>
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
        const fillable = code !== undefined && !code.onSecurityKey
        return (
          <article class="card" key={login.id} aria-label={login.name}>
            <div class="row card-head">
              <Tile name={login.name} size={40} />
              <span class="grow lines">
                <h2 class="card-title ellipsis">{login.name}</h2>
                {login.username !== '' && <span class="label ellipsis">{login.username}</span>}
                <SpaceBadge space={login.space} />
              </span>
              <IconButton
                icon="chevron"
                size={16}
                weight={2}
                label={t('popup_openLogin', login.name)}
                onClick={() => props.onOpenLogin(login.id)}
              />
            </div>
            <div class="well">
              <PasswordLine login={login} />
              {code !== undefined && (
                <>
                  <div class="well-sep" />
                  <CodeLine code={code} live={live} variant="card" />
                </>
              )}
            </div>
            <div class="actions split">
              {fillable && (
                <Button
                  kind="primary"
                  icon="fill"
                  label={t('popup_fillCodeOf', login.name)}
                  onClick={() => void fill({ codeId: code.id })}
                >
                  {t('popup_fillCode')}
                </Button>
              )}
              <Button
                kind={fillable ? 'secondary' : 'primary'}
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
          <div class="row card-head">
            <Tile name={codeName(code)} size={40} />
            <span class="grow lines">
              <h2 class="card-title ellipsis">{codeName(code)}</h2>
              {code.issuer !== '' && <span class="label ellipsis">{code.account}</span>}
              <SpaceBadge space={code.space} />
            </span>
          </div>
          <div class="well">
            <CodeLine code={code} live={live} variant="card" />
          </div>
          {!code.onSecurityKey && (
            <div class="actions split">
              <Button
                kind="primary"
                icon="fill"
                label={t('popup_fillCodeOf', codeName(code))}
                onClick={() => void fill({ codeId: code.id })}
              >
                {t('popup_fillCode')}
              </Button>
            </div>
          )}
        </article>
      ))}
      {props.passkeys !== undefined && props.onOpenPasskey !== undefined && (
        <SitePasskeys tab={tab} passkeys={props.passkeys} onOpen={props.onOpenPasskey} />
      )}
    </section>
  )
}
