// The popup's first screen: the site in front, then search, Codes and Logins.
import type { CodeView, GeneratedPassword, LoginView, TabView } from '../shared/api'
import { Wordmark } from '../shared/brand/brand'
import {
  Button,
  IconButton,
  Notice,
  Ring,
  Tabs,
  useLoad,
  useToastBottom,
} from '../shared/ui/components'
import { formatDate, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { CodeRow } from './codes'
import { useCopy } from './copy'
import { computable, type Vault } from './data'
import { allTags, codeMatches, healthCounts, hostOf, loginMatches } from './format'
import { findItems, ItemPanels } from './items-rows'
import { useLiveCodes, secondsLeft, warnSeconds } from './live'
import { LoginRow } from './logins'
import { byOrder as passkeysByOrder, passkeyMatches } from './passkey-format'
import { PasskeysEmpty, PasskeysList } from './passkeys'
import type { Route } from './route'
import { ask } from './send'
import { SendsEntry } from './sends'
import { SiteCards, siteItems } from './site'
import { SpacesCard } from './spaces'
import { SyncBanner, SyncFooter, useSyncStatus } from './sync-state'
import { openSetup } from './links'
import { ToolIcon, ToolIconButton } from './tools/icons'
import { taggableKind } from './tools/tag-kinds'
import { byPinnedThenOrder } from './tools/order'

/** The lists Home has tabs for. */
export type HomeList = 'codes' | 'logins' | 'passkeys' | 'notes' | 'cards' | 'identities'
const homeLists: readonly string[] = ['codes', 'logins', 'passkeys', 'notes', 'cards', 'identities']

/** What the person has chosen on Home, kept while a page is open over it. */
export interface HomeUi {
  query: string
  list: HomeList
  tag: string | null
}

export const homeStart: HomeUi = { query: '', list: 'codes', tag: null }

/** The vault's order, with the pinned items first (the app's custom sort). */
const byOrder = <T extends { id: string; order: number; pinned?: boolean }>(items: T[]): T[] =>
  byPinnedThenOrder(items)

function healthLine(logins: LoginView[], breachedOn: boolean): string {
  const counts = healthCounts(logins, breachedOn)
  const parts = [
    counts.breached > 0 ? t('popup_countBreached', counts.breached) : '',
    counts.reused > 0 ? t('popup_countReused', counts.reused) : '',
    counts.weak > 0 ? t('popup_countWeak', counts.weak) : '',
    counts.withoutItsCode > 0 ? t('popup_countWithoutCode', counts.withoutItsCode) : '',
  ].filter((part) => part !== '')
  return parts.length > 0 ? parts.join(' · ') : t('popup_healthNoWarnings')
}

/** "harbornotes.app · today": the newest password Kemlock made that no login holds. */
function RecentCard(props: { entry: GeneratedPassword; onRecent: () => void; onSave: () => void }) {
  const copy = useCopy()
  const { entry } = props
  const site = entry.site === undefined || entry.site === '' ? '' : hostOf(entry.site)
  const sameDay = new Date(entry.at).toDateString() === new Date().toDateString()
  const when = sameDay ? t('popup_today') : formatDate(entry.at)
  return (
    <div class="recent-card">
      <span class="grow lines">
        <button type="button" class="recent-link" onClick={props.onRecent}>
          {t('popup_recent')}
        </button>
        <span class="mono ellipsis">{site === '' ? when : `${site} · ${when}`}</span>
      </span>
      <button
        type="button"
        class="link-btn quiet"
        aria-label={t('popup_copyPasswordOf', site === '' ? t('popup_generatedUnnamed') : site)}
        onClick={() => void copy('generated', String(entry.at), entry.value)}
      >
        {t('popup_copy')}
      </button>
      <button type="button" class="link-btn" onClick={props.onSave}>
        {t('popup_saveAsLogin')}
      </button>
    </div>
  )
}

/** Added by tools: the way to the duplicate cleaner. */
function DuplicatesCard(props: { onOpen: () => void }) {
  return (
    <button type="button" class="link-card hov" onClick={props.onOpen}>
      <span class="warn-icon" aria-hidden="true">
        <ToolIcon name="layers" size={16} weight={2} />
      </span>
      <span class="grow lines">
        <span class="name">{t('tools_duplicatesTitle')}</span>
        <span class="label">{t('tools_duplicatesCard')}</span>
      </span>
      <Icon name="chevron" size={16} weight={2} />
    </button>
  )
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
  useToastBottom(52)
  const [sync, setSync] = useSyncStatus()
  const recent = useLoad(() => ask('recentPasswords'))
  const passkeysLoaded = useLoad(() => ask('passkeys'))
  const allPasskeys = passkeysLoaded.value ?? []
  const setQuery = (next: string) => props.onUi({ ...props.ui, query: next })
  const setList = (next: HomeList) => props.onUi({ ...props.ui, list: next })
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
  const passkeys = passkeysByOrder(allPasskeys).filter(
    (passkey) => passkeyMatches(passkey, needle) && inTag({ tags: passkey.tags ?? [] }),
  )
  // The Passkeys tab is there once the vault holds one (a passkey is made when a site asks for one)
  const hasPasskeys = allPasskeys.length > 0
  const found = findItems(vault, needle, tag)
  const tags = allTags(
    vault.codes,
    vault.logins,
    vault.notes,
    vault.cards,
    vault.identities,
    allPasskeys.map((passkey) => ({ tags: passkey.tags ?? [] })),
  )
  const items = siteItems(tab, vault)
  // The last passkey went: its tab with it, and the list falls back to the codes
  const shownList = list === 'passkeys' && !hasPasskeys ? 'codes' : list
  const showCodes = searching || shownList === 'codes'
  const showLogins = searching || shownList === 'logins'
  const showPasskeys = searching ? passkeys.length > 0 : shownList === 'passkeys'
  const openPasskey = (id: string) => props.onRoute({ name: 'passkey', id })
  const tickIds = [
    ...items.shownCodes.map((code) => code.id),
    ...(showCodes ? computable(codes).map((code) => code.id) : []),
  ]
  const live = useLiveCodes(tickIds)
  const breachedOn = vault.settings.breachedPasswords
  const open = (id: string) => props.onRoute({ name: 'login', id })

  // The small timer by the tabs follows the first code on show that counts down.
  const timed = vault.codes.find((code) => {
    const entry = live.entries[code.id]
    return entry !== undefined && secondsLeft(entry, live.now) !== undefined
  })
  const timedEntry = timed === undefined ? undefined : live.entries[timed.id]
  const timedLeft = timedEntry === undefined ? undefined : secondsLeft(timedEntry, live.now)

  const nothingAtAll =
    vault.codes.length === 0 &&
    vault.logins.length === 0 &&
    vault.notes.length === 0 &&
    vault.cards.length === 0 &&
    vault.identities.length === 0
  const first = vault.backups[0]
  const backupsSub =
    vault.backups.length === 0 || first === undefined
      ? ''
      : vault.backups.length === 1
        ? `${t('popup_backupCount', first.left, first.total)} · ${first.issuer}`
        : t('popup_backupServices', vault.backups.length)
  const newest = [...(recent.value ?? [])].sort((a, b) => b.at - a.at)[0]
  const vaultwarden = sync !== undefined && sync !== null && sync.place === 'vaultwarden'

  const emptyState = (kind: 'codes' | 'logins') => {
    const sentence = t(kind === 'codes' ? 'popup_noCodes' : 'popup_noLogins')
    const cut = sentence.indexOf('. ') + 1
    return (
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">
          <Icon name={kind === 'codes' ? 'scan' : 'key'} size={30} weight={1.6} />
        </span>
        <div class="empty-words">
          <p class="empty-title">{cut > 0 ? sentence.slice(0, cut) : sentence}</p>
          {cut > 0 && <p class="empty-rest">{sentence.slice(cut + 1)}</p>}
        </div>
        {kind === 'codes' ? (
          <Button kind="primary" icon="plus" onClick={() => props.onRoute({ name: 'addCode' })}>
            {t('popup_addCode')}
          </Button>
        ) : (
          <Button icon="plus" onClick={() => props.onRoute({ name: 'edit', id: null })}>
            {t('popup_newLogin')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div class="screen home">
      <header class="home-bar">
        <div class="brand">
          <Wordmark height={17} />
          <span class="sub">{t('popup_personalVault')}</span>
        </div>
        <IconButton
          icon="plus"
          weight={2}
          label={t('popup_addCode')}
          onClick={() => props.onRoute({ name: 'addCode' })}
        />
        <IconButton
          icon="key"
          label={t('popup_generator')}
          onClick={() => props.onRoute({ name: 'generator' })}
        />
        <IconButton
          icon="shieldCheck"
          label={t('keys_open')}
          onClick={() => props.onRoute({ name: 'keys' })}
        />
        <IconButton
          icon="settings"
          label={t('popup_settings')}
          onClick={() => props.onRoute({ name: 'settings' })}
        />
        <IconButton icon="lock" label={t('popup_lockNow')} onClick={props.onLock} />
      </header>

      {props.notice !== undefined && (
        <div class="home-notice">
          <Notice>{props.notice}</Notice>
        </div>
      )}

      {sync !== undefined && sync !== null && (
        <SyncBanner
          status={sync}
          onStatus={setSync}
          onReview={() => props.onRoute({ name: 'settings' })}
        />
      )}

      <div class="search-wrap">
        <label class="field">
          <span class="box search">
            <Icon name="search" size={16} weight={2} />
            <input
              type="search"
              value={query}
              aria-label={t('popup_searchLabel')}
              placeholder={t('popup_searchPlaceholder')}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </span>
        </label>
      </div>

      <div class="scroll">
        {!searching && (
          <SiteCards
            tab={tab}
            vault={vault}
            live={live}
            onOpenLogin={open}
            passkeys={allPasskeys}
            onOpenPasskey={openPasskey}
          />
        )}

        {!searching && <SpacesCard onOpen={() => props.onRoute({ name: 'spaces' })} />}

        {!searching && (
          <div class="tabs-row">
            <Tabs
              label={t('popup_listsLabel')}
              selected={shownList}
              class="many"
              onSelect={(id) => setList(homeLists.includes(id) ? (id as HomeList) : 'codes')}
              tabs={[
                { id: 'codes', label: t('popup_codes'), count: vault.codes.length },
                { id: 'logins', label: t('popup_logins'), count: vault.logins.length },
                ...(hasPasskeys
                  ? [{ id: 'passkeys', label: t('passkeys_tab'), count: allPasskeys.length }]
                  : []),
                { id: 'notes', label: t('items_notes'), count: vault.notes.length },
                { id: 'cards', label: t('items_cards'), count: vault.cards.length },
                { id: 'identities', label: t('items_identities'), count: vault.identities.length },
              ]}
            />
            {/* Added by tools: tags and order */}
            <span class="tab-tools">
              {/* Where the core doesn't tag what the list holds, there is nothing to tag */}
              {taggableKind(shownList) !== undefined && (
                <ToolIconButton
                  icon="tag"
                  label={t('tools_tagsTitle')}
                  onClick={() => props.onRoute({ name: 'tags' })}
                />
              )}
              {/* Only codes and logins have an order of their own to change */}
              {(shownList === 'codes' || shownList === 'logins') && (
                <ToolIconButton
                  icon="reorder"
                  label={t(shownList === 'codes' ? 'tools_reorderCodes' : 'tools_reorderLogins')}
                  onClick={() =>
                    props.onRoute({
                      name: 'reorder',
                      kind: shownList === 'codes' ? 'code' : 'login',
                    })
                  }
                />
              )}
            </span>
            {shownList === 'codes' && timedLeft !== undefined && timed !== undefined && (
              <span class="tab-timer mono">
                <Ring
                  remaining={timedLeft}
                  period={timed.period}
                  warn={timedLeft <= warnSeconds}
                  size={14}
                  label={t('popup_secondsLeft', timedLeft)}
                />
                <span aria-hidden="true">{t('popup_secondsShort', timedLeft)}</span>
              </span>
            )}
          </div>
        )}

        {tags.length > 0 && (
          <div class="chips" role="group" aria-label={t('popup_tagFilter')}>
            <button
              type="button"
              class={tag === null ? 'chip on' : 'chip'}
              aria-pressed={tag === null ? 'true' : 'false'}
              onClick={() => setTag(null)}
            >
              <span>{t('popup_allTags')}</span>
            </button>
            {tags.map((name) => (
              <button
                key={name}
                type="button"
                class={tag === name ? 'chip on' : 'chip'}
                aria-pressed={tag === name ? 'true' : 'false'}
                onClick={() => setTag(tag === name ? null : name)}
              >
                <span>{name}</span>
              </button>
            ))}
          </div>
        )}

        {showCodes && (
          <div
            class="panel"
            role={searching ? undefined : 'tabpanel'}
            id="panel-codes"
            aria-labelledby={searching ? undefined : 'tab-codes'}
          >
            {searching && codes.length > 0 && (
              <h2 class="label-caps list-title">{t('popup_codes')}</h2>
            )}
            {codes.length > 0 ? (
              <ul class="list">
                {codes.map((code) => (
                  <CodeRow key={code.id} code={code} live={live} />
                ))}
              </ul>
            ) : (
              !searching &&
              (vault.codes.length === 0 ? (
                emptyState('codes')
              ) : (
                <p class="empty muted">{t('popup_noneInTag')}</p>
              ))
            )}
            {!searching && tag === null && (
              <button
                type="button"
                class="link-card hov"
                onClick={() => props.onRoute({ name: 'backupCodes' })}
              >
                <span class="grow lines">
                  <span class="name">{t('popup_backupCodes')}</span>
                  <span class="label">
                    {vault.backups.length === 0 ? t('tools_addServiceCodes') : backupsSub}
                  </span>
                </span>
                <Icon name="chevron" size={16} weight={2} />
              </button>
            )}
            {!searching && tag === null && vault.codes.length > 1 && (
              <DuplicatesCard onOpen={() => props.onRoute({ name: 'duplicates' })} />
            )}
          </div>
        )}

        {showLogins && (
          <div
            class="panel"
            role={searching ? undefined : 'tabpanel'}
            id="panel-logins"
            aria-labelledby={searching ? undefined : 'tab-logins'}
          >
            {searching && logins.length > 0 && (
              <h2 class="label-caps list-title">{t('popup_logins')}</h2>
            )}
            {!searching && vaultwarden && (
              <div class="note" role="note">
                {t('popup_loginsNotSynced')}
              </div>
            )}
            {!searching && vault.logins.length > 0 && (
              <button
                type="button"
                class="link-card hov"
                onClick={() => props.onRoute({ name: 'health' })}
              >
                <span class="warn-icon" aria-hidden="true">
                  <Icon name="warning" size={16} weight={2} />
                </span>
                <span class="grow lines">
                  <span class="name">{t('popup_healthTitle')}</span>
                  <span class="label warn-text">{healthLine(vault.logins, breachedOn)}</span>
                </span>
                <Icon name="chevron" size={16} weight={2} />
              </button>
            )}
            {!searching && vault.logins.length > 1 && (
              <DuplicatesCard onOpen={() => props.onRoute({ name: 'duplicates' })} />
            )}
            {logins.length > 0 ? (
              <ul class="list">
                {logins.map((login) => (
                  <LoginRow key={login.id} login={login} breachedOn={breachedOn} onOpen={open} />
                ))}
              </ul>
            ) : (
              !searching &&
              (vault.logins.length === 0 ? (
                emptyState('logins')
              ) : (
                <p class="empty muted">{t('popup_noneInTag')}</p>
              ))
            )}
            {!searching && newest !== undefined && (
              <RecentCard
                entry={newest}
                onRecent={() => props.onRoute({ name: 'recent' })}
                onSave={() =>
                  props.onRoute({
                    name: 'edit',
                    id: null,
                    prefill: {
                      name: newest.site === undefined ? '' : hostOf(newest.site),
                      password: newest.value,
                      websites:
                        newest.site === undefined || newest.site === '' ? [] : [newest.site],
                    },
                  })
                }
              />
            )}
          </div>
        )}

        {showPasskeys && (
          <div
            class="panel"
            role={searching ? undefined : 'tabpanel'}
            id="panel-passkeys"
            aria-labelledby={searching ? undefined : 'tab-passkeys'}
          >
            {searching && <h2 class="label-caps list-title">{t('passkeys_tab')}</h2>}
            {passkeys.length > 0 ? (
              <PasskeysList passkeys={passkeys} onOpen={openPasskey} />
            ) : (
              <PasskeysEmpty />
            )}
          </div>
        )}

        <ItemPanels
          vault={vault}
          found={found}
          list={shownList}
          searching={searching}
          onRoute={props.onRoute}
        />

        {!searching && <SendsEntry onOpen={() => props.onRoute({ name: 'sends' })} />}

        {searching &&
          codes.length === 0 &&
          logins.length === 0 &&
          passkeys.length === 0 &&
          found.notes.length === 0 &&
          found.cards.length === 0 &&
          found.identities.length === 0 && (
            <div class="empty-state" role="status">
              <div class="empty-words">
                <p class="empty-title">{t('popup_nothingMatches', needle)}</p>
                <p class="empty-rest">{t('popup_searchHelp')}</p>
              </div>
            </div>
          )}
      </div>

      {sync === null && nothingAtAll && (
        <div class="sync-off">
          <span class="grow">{t('popup_syncOff')}</span>
          <Button onClick={() => openSetup('again')}>{t('popup_setUpSync')}</Button>
        </div>
      )}

      {!(sync === null && nothingAtAll) && <SyncFooter status={sync} settings={vault.settings} />}
    </div>
  )
}
