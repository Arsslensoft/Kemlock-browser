// The keys list and the contacts list: what the vault holds of each, found by search and tags, with the way to add one and to
// the PGP tools.
import { useState } from 'preact/hooks'
import type { ContactView, KeyView } from '../../shared/keys-api'
import { IconButton, PageHeader, Tabs, Tile } from '../../shared/ui/components'
import { t } from '../../shared/ui/i18n'
import { Icon } from '../../shared/ui/icons'
import type { KeysData } from './data'
import { inKeysTab, openKeysTab } from './files'
import {
  contactMatches,
  keyMatches,
  keyTags,
  kindNames,
  shortFingerprint,
  sortContacts,
  sortKeys,
  standingNames,
} from './format'
import type { KeysRoute } from './route'

function Standing(props: { standing: KeyView['standing'] }) {
  const { standing } = props
  if (standing === undefined || standing === 'ok') return null
  return <span class="mono sub warn-text">{t(standingNames[standing])}</span>
}

function KeyRow(props: { item: KeyView; onOpen: (id: string) => void }) {
  const { item } = props
  const tags = item.tags.length > 0 ? ` · ${item.tags.map((tag) => `#${tag}`).join(' ')}` : ''
  return (
    <li class="item">
      <button
        type="button"
        class="item-main hov"
        aria-label={t('keys_openKey', item.name)}
        onClick={() => props.onOpen(item.id)}
      >
        <Tile name={item.name} />
        <span class="grow lines">
          <span class="name ellipsis">{item.name}</span>
          <span class="label ellipsis">{`${t(kindNames[item.kind])} · ${item.line}`}</span>
          <span class="label mono ellipsis">{`${shortFingerprint(item.fingerprint)}${tags}`}</span>
        </span>
        <span class="value">
          <Standing standing={item.standing} />
        </span>
        <Icon name="chevron" size={16} weight={2} />
      </button>
    </li>
  )
}

function ContactRow(props: { item: ContactView; onOpen: (id: string) => void }) {
  const { item } = props
  // A contact with no key has nothing to compare and no fingerprint: its email and company say who it is
  const keyless = item.hasKey === false
  const who = [item.email, item.company]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ')
  return (
    <li class="item">
      <button
        type="button"
        class="item-main hov"
        aria-label={t('keys_openContact', item.name)}
        onClick={() => props.onOpen(item.id)}
      >
        <Tile name={item.name} />
        <span class="grow lines">
          <span class="name ellipsis">{item.name}</span>
          <span class="label ellipsis">{item.line}</span>
          {keyless ? (
            who !== '' && <span class="label ellipsis">{who}</span>
          ) : (
            <span class="label mono ellipsis">{shortFingerprint(item.fingerprint)}</span>
          )}
        </span>
        {!keyless && (
          <span class="value">
            {item.standing !== 'ok' ? (
              <span class="mono sub warn-text">{t(standingNames[item.standing])}</span>
            ) : (
              <span class={item.checked ? 'mono sub copied-mark' : 'mono sub'}>
                {item.checked ? t('keys_checked') : t('keys_notChecked')}
              </span>
            )}
          </span>
        )}
        <Icon name="chevron" size={16} weight={2} />
      </button>
    </li>
  )
}

export function KeysList(props: {
  data: KeysData
  tab: 'keys' | 'contacts'
  onTab: (tab: 'keys' | 'contacts') => void
  onRoute: (route: KeysRoute) => void
  onBack?: () => void
}) {
  const { keys, contacts } = props.data
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const inTab = inKeysTab()
  const onKeys = props.tab === 'keys'
  const shownKeys = sortKeys(keys).filter(
    (key) => keyMatches(key, query) && (tag === null || key.tags.includes(tag)),
  )
  const shownContacts = sortContacts(contacts).filter((contact) => contactMatches(contact, query))
  const tags = keyTags(keys)

  return (
    <div class="screen">
      <PageHeader title={t('keys_title')} onBack={props.onBack} backLabel={t('popup_back')}>
        <IconButton
          icon="plus"
          weight={2}
          label={onKeys ? t('keys_addKey') : t('keys_addContact')}
          onClick={() => props.onRoute({ name: onKeys ? 'addKey' : 'addContact' })}
        />
        <IconButton
          icon="shieldCheck"
          label={t('keys_tools')}
          onClick={() => props.onRoute({ name: 'tools' })}
        />
        {!inTab && (
          <IconButton icon="link" label={t('keys_openTab')} onClick={() => openKeysTab()} />
        )}
      </PageHeader>

      <div class="search-wrap">
        <label class="field">
          <span class="box search">
            <Icon name="search" size={16} weight={2} />
            <input
              type="search"
              value={query}
              aria-label={t('keys_searchLabel')}
              placeholder={t('keys_searchPlaceholder')}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </span>
        </label>
      </div>

      <div class="scroll">
        <div class="tabs-row">
          <Tabs
            label={t('keys_listsLabel')}
            selected={props.tab}
            onSelect={(id) => props.onTab(id === 'contacts' ? 'contacts' : 'keys')}
            tabs={[
              { id: 'keys', label: t('keys_keys'), count: keys.length },
              { id: 'contacts', label: t('keys_contacts'), count: contacts.length },
            ]}
          />
        </div>

        {onKeys && tags.length > 0 && (
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

        <div
          class="panel"
          role="tabpanel"
          id={`panel-${props.tab}`}
          aria-labelledby={`tab-${props.tab}`}
        >
          {onKeys &&
            (shownKeys.length > 0 ? (
              <ul class="list">
                {shownKeys.map((item) => (
                  <KeyRow
                    key={item.id}
                    item={item}
                    onOpen={(id) => props.onRoute({ name: 'key', id })}
                  />
                ))}
              </ul>
            ) : (
              <Empty
                filled={keys.length > 0}
                emptyText={t('keys_noKeys')}
                actionLabel={t('keys_addKey')}
                onAction={() => props.onRoute({ name: 'addKey' })}
              />
            ))}
          {!onKeys &&
            (shownContacts.length > 0 ? (
              <ul class="list">
                {shownContacts.map((item) => (
                  <ContactRow
                    key={item.id}
                    item={item}
                    onOpen={(id) => props.onRoute({ name: 'contact', id })}
                  />
                ))}
              </ul>
            ) : (
              <Empty
                filled={contacts.length > 0}
                emptyText={t('keys_noContacts')}
                actionLabel={t('keys_addContact')}
                onAction={() => props.onRoute({ name: 'addContact' })}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

function Empty(props: {
  /** The list has items, and the search hides them all. */
  filled: boolean
  emptyText: string
  actionLabel: string
  onAction: () => void
}) {
  if (props.filled)
    return (
      <div class="empty-state" role="status">
        <div class="empty-words">
          <p class="empty-title">{t('keys_noMatch')}</p>
        </div>
      </div>
    )
  return (
    <div class="empty-state">
      <span class="empty-icon" aria-hidden="true">
        <Icon name="key" size={30} weight={1.6} />
      </span>
      <div class="empty-words">
        <p class="empty-title">{props.emptyText}</p>
      </div>
      <button type="button" class="btn primary" onClick={props.onAction}>
        <Icon name="plus" size={16} weight={2} />
        <span>{props.actionLabel}</span>
      </button>
    </div>
  )
}
