// The popup's first screen: the site in front, then search, Codes and Logins.
import type { CodeView, LoginView, TabView } from '../shared/api'
import { IconButton, Notice, Tabs } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { BackupCodes, CodeRow } from './codes'
import { computable, type Vault } from './data'
import { allTags, codeMatches, healthCounts, loginMatches } from './format'
import { useLiveCodes } from './live'
import { LoginRow } from './logins'
import type { Route } from './route'
import { SiteCards, siteItems } from './site'

/** What the person has chosen on Home, kept while a page is open over it. */
export interface HomeUi {
  query: string
  list: 'codes' | 'logins'
  tag: string | null
}

export const homeStart: HomeUi = { query: '', list: 'codes', tag: null }

const byOrder = <T extends { order: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.order - b.order)

function healthLine(logins: LoginView[], breachedOn: boolean): string {
  const counts = healthCounts(logins, breachedOn)
  const parts = [
    counts.breached > 0 ? t('popup_countBreached', counts.breached) : '',
    counts.reused > 0 ? t('popup_countReused', counts.reused) : '',
    counts.weak > 0 ? t('popup_countWeak', counts.weak) : '',
    counts.withoutItsCode > 0 ? t('popup_countWithoutCode', counts.withoutItsCode) : '',
  ].filter((part) => part !== '')
  return [
    t('popup_healthTitle'),
    ...(parts.length > 0 ? parts : [t('popup_healthNoWarnings')]),
  ].join(' · ')
}

export function Home(props: {
  vault: Vault
  tab: TabView | undefined
  ui: HomeUi
  onUi: (ui: HomeUi) => void
  /** Said once after unlocking when wrong passwords came before. */
  notice?: string
  onRoute: (route: Route) => void
  onLock: () => void
}) {
  const { vault, tab } = props
  const { query, list, tag } = props.ui
  const setQuery = (next: string) => props.onUi({ ...props.ui, query: next })
  const setList = (next: 'codes' | 'logins') => props.onUi({ ...props.ui, list: next })
  const setTag = (next: string | null) => props.onUi({ ...props.ui, tag: next })

  const needle = query.trim()
  const searching = needle !== ''
  const inTag = (item: { tags: string[] }) => tag === null || item.tags.includes(tag)
  const codes: CodeView[] = byOrder(vault.codes).filter(
    (code) => codeMatches(code, needle) && inTag(code),
  )
  const logins: LoginView[] = byOrder(vault.logins).filter(
    (login) => loginMatches(login, needle) && inTag(login),
  )
  const tags = allTags(vault.codes, vault.logins)
  const items = siteItems(tab, vault)
  const showCodes = searching || list === 'codes'
  const showLogins = searching || list === 'logins'
  const tickIds = [
    ...items.shownCodes.map((code) => code.id),
    ...(showCodes ? computable(codes).map((code) => code.id) : []),
  ]
  const live = useLiveCodes(tickIds)
  const breachedOn = vault.settings.breachedPasswords
  const open = (id: string) => props.onRoute({ name: 'login', id })

  return (
    <div class="home">
      <header class="bar">
        <h1 class="grow">{t('extName')}</h1>
        <IconButton
          icon="plus"
          label={t('popup_addCode')}
          onClick={() => props.onRoute({ name: 'addCode' })}
        />
        <IconButton
          icon="key"
          label={t('popup_generator')}
          onClick={() => props.onRoute({ name: 'generator' })}
        />
        <IconButton
          icon="settings"
          label={t('popup_settings')}
          onClick={() => props.onRoute({ name: 'settings' })}
        />
        <IconButton icon="lock" label={t('popup_lockNow')} onClick={props.onLock} />
      </header>

      {props.notice !== undefined && <Notice class="gap">{props.notice}</Notice>}

      <SiteCards tab={tab} vault={vault} live={live} onOpenLogin={open} />

      <div class="search">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={query}
          aria-label={t('popup_searchLabel')}
          placeholder={t('popup_searchPlaceholder')}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {!searching && (
        <Tabs
          label={t('popup_listsLabel')}
          selected={list}
          onSelect={(id) => setList(id === 'logins' ? 'logins' : 'codes')}
          tabs={[
            { id: 'codes', label: t('popup_codes'), count: vault.codes.length },
            { id: 'logins', label: t('popup_logins'), count: vault.logins.length },
          ]}
        />
      )}

      {tags.length > 0 && (
        <div class="chips filter" role="group" aria-label={t('popup_tagFilter')}>
          <button
            type="button"
            class={tag === null ? 'chip on' : 'chip'}
            aria-pressed={tag === null ? 'true' : 'false'}
            onClick={() => setTag(null)}
          >
            {t('popup_allTags')}
          </button>
          {tags.map((name) => (
            <button
              key={name}
              type="button"
              class={tag === name ? 'chip on' : 'chip'}
              aria-pressed={tag === name ? 'true' : 'false'}
              onClick={() => setTag(tag === name ? null : name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {showCodes && (
        <div
          role={searching ? undefined : 'tabpanel'}
          id="panel-codes"
          aria-labelledby={searching ? undefined : 'tab-codes'}
        >
          {searching && <h2 class="section-title list-title">{t('popup_codes')}</h2>}
          {codes.length > 0 ? (
            <ul class="list">
              {codes.map((code) => (
                <CodeRow key={code.id} code={code} live={live} />
              ))}
            </ul>
          ) : (
            !searching && (
              <p class="empty muted">
                {vault.codes.length === 0 ? t('popup_noCodes') : t('popup_noneInTag')}
              </p>
            )
          )}
          {!searching && vault.backups.length > 0 && (
            <details class="backups">
              <summary>{t('popup_backupCodes')}</summary>
              <BackupCodes backups={vault.backups} onChanged={vault.reload} />
            </details>
          )}
        </div>
      )}

      {showLogins && (
        <div
          role={searching ? undefined : 'tabpanel'}
          id="panel-logins"
          aria-labelledby={searching ? undefined : 'tab-logins'}
        >
          {searching && <h2 class="section-title list-title">{t('popup_logins')}</h2>}
          {!searching && vault.logins.length > 0 && (
            <button
              type="button"
              class="health-row"
              onClick={() => props.onRoute({ name: 'health' })}
            >
              <span class="grow">{healthLine(vault.logins, breachedOn)}</span>
              <Icon name="chevron" size={16} />
            </button>
          )}
          {logins.length > 0 ? (
            <ul class="list">
              {logins.map((login) => (
                <LoginRow key={login.id} login={login} breachedOn={breachedOn} onOpen={open} />
              ))}
            </ul>
          ) : (
            !searching && (
              <p class="empty muted">
                {vault.logins.length === 0 ? t('popup_noLogins') : t('popup_noneInTag')}
              </p>
            )
          )}
        </div>
      )}

      {searching && codes.length === 0 && logins.length === 0 && (
        <p class="empty muted" role="status">
          {t('popup_nothingMatches', needle)}
        </p>
      )}
    </div>
  )
}
