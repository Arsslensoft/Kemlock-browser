// Notes, cards and identities on Home, beside Codes and Logins: the rows, and the panels the tabs and the search show.
import type { CardView, IdentityView, NoteView } from '../shared/api'
import { Button, IconButton, Tile } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { Icon, type IconName } from '../shared/ui/icons'
import { useCopy, useFlash } from './copy'
import type { Vault } from './data'
import {
  cardLine,
  cardMatches,
  identityLine,
  identityMatches,
  noteMatches,
  pinnedFirst,
} from './items-data'
import type { Route } from './route'

export type ItemList = 'notes' | 'cards' | 'identities'

export interface FoundItems {
  notes: NoteView[]
  cards: CardView[]
  identities: IdentityView[]
}

/** What the search and the tag filter leave of each kind, pinned first. */
export function findItems(vault: Vault, needle: string, tag: string | null): FoundItems {
  const inTag = (item: { tags: string[] }) => tag === null || item.tags.includes(tag)
  return {
    notes: pinnedFirst(vault.notes).filter((note) => noteMatches(note, needle) && inTag(note)),
    cards: pinnedFirst(vault.cards).filter((card) => cardMatches(card, needle) && inTag(card)),
    identities: pinnedFirst(vault.identities).filter(
      (identity) => identityMatches(identity, needle) && inTag(identity),
    ),
  }
}

function NoteRow(props: { note: NoteView; onOpen: (id: string) => void }) {
  const { note } = props
  const detail =
    note.files > 0 ? t('items_files', note.files) : note.keyNote === true ? t('items_keyNote') : ''
  return (
    <li class="item">
      <button
        type="button"
        class="item-main hov"
        aria-label={t('items_openNote', note.title)}
        onClick={() => props.onOpen(note.id)}
      >
        <Tile name={note.title} />
        <span class="grow lines">
          <span class="name ellipsis">{note.title}</span>
          {detail !== '' && <span class="label ellipsis">{detail}</span>}
        </span>
        {note.pinned && (
          <span class="value">
            <span class="mono sub">{t('items_pinned')}</span>
          </span>
        )}
      </button>
    </li>
  )
}

function CardRow(props: { card: CardView; onOpen: (id: string) => void }) {
  const { card } = props
  const copy = useCopy()
  const [copied, flash] = useFlash()
  return (
    <li class={copied ? 'item copied' : 'item'}>
      <button
        type="button"
        class="item-main hov"
        aria-label={t('items_openCard', card.name)}
        onClick={() => props.onOpen(card.id)}
      >
        <Tile name={card.name} />
        <span class="grow lines">
          <span class="name ellipsis">{card.name}</span>
          <span class="label ellipsis">{cardLine(card)}</span>
        </span>
        <span class="value">
          <span
            class={
              copied ? 'mono sub copied-mark' : card.expired ? 'mono sub danger-text' : 'mono sub'
            }
          >
            {copied
              ? t('popup_copied')
              : card.expired
                ? t('items_expired')
                : card.pinned
                  ? t('items_pinned')
                  : ''}
          </span>
        </span>
      </button>
      <IconButton
        icon="copy"
        size={16}
        weight={2}
        label={t('items_copyCardNumberOf', card.name)}
        disabled={!card.hasNumber}
        onClick={() =>
          void copy('cardNumber', card.id).then((ok) => {
            if (ok) flash()
          })
        }
      />
    </li>
  )
}

function IdentityRow(props: { identity: IdentityView; onOpen: (id: string) => void }) {
  const { identity } = props
  const copy = useCopy()
  const [copied, flash] = useFlash()
  const line = identityLine(identity)
  return (
    <li class={copied ? 'item copied' : 'item'}>
      <button
        type="button"
        class="item-main hov"
        aria-label={t('items_openIdentity', identity.name)}
        onClick={() => props.onOpen(identity.id)}
      >
        <Tile name={identity.name} />
        <span class="grow lines">
          <span class="name ellipsis">{identity.name}</span>
          {line !== '' && <span class="label ellipsis">{line}</span>}
        </span>
        <span class="value">
          <span class={copied ? 'mono sub copied-mark' : 'mono sub'}>
            {copied ? t('popup_copied') : identity.pinned ? t('items_pinned') : ''}
          </span>
        </span>
      </button>
      {identity.email !== undefined && (
        <IconButton
          icon="copy"
          size={16}
          weight={2}
          label={t('items_copyEmailOf', identity.name)}
          onClick={() =>
            void copy('email', identity.id).then((ok) => {
              if (ok) flash()
            })
          }
        />
      )}
    </li>
  )
}

/** What a kind says when the vault has none of it: a title and a line, and a button to start one. */
function Empty(props: { kind: ItemList; icon: IconName; onNew: () => void }) {
  const sentence = t(`items_none_${props.kind}`)
  const cut = sentence.indexOf('. ') + 1
  return (
    <div class="empty-state">
      <span class="empty-icon" aria-hidden="true">
        <Icon name={props.icon} size={30} weight={1.6} />
      </span>
      <div class="empty-words">
        <p class="empty-title">{cut > 0 ? sentence.slice(0, cut) : sentence}</p>
        {cut > 0 && <p class="empty-rest">{sentence.slice(cut + 1)}</p>}
      </div>
      <Button icon="plus" onClick={props.onNew}>
        {t(`items_new_${props.kind}`)}
      </Button>
    </div>
  )
}

const icons: Record<ItemList, IconName> = { notes: 'note', cards: 'card', identities: 'user' }
const titles: Record<ItemList, string> = {
  notes: 'items_notes',
  cards: 'items_cards',
  identities: 'items_identities',
}

/** The panels of the three kinds: each shows when its tab is chosen, or while a search runs and it has a match. */
export function ItemPanels(props: {
  vault: Vault
  found: FoundItems
  list: string
  searching: boolean
  onRoute: (route: Route) => void
}) {
  const { vault, found, searching } = props
  const open: Record<ItemList, (id: string) => void> = {
    notes: (id) => props.onRoute({ name: 'note', id }),
    cards: (id) => props.onRoute({ name: 'card', id }),
    identities: (id) => props.onRoute({ name: 'identity', id }),
  }
  const create: Record<ItemList, () => void> = {
    notes: () => props.onRoute({ name: 'noteEdit', id: null }),
    cards: () => props.onRoute({ name: 'cardEdit', id: null }),
    identities: () => props.onRoute({ name: 'identityEdit', id: null }),
  }
  const total: Record<ItemList, number> = {
    notes: vault.notes.length,
    cards: vault.cards.length,
    identities: vault.identities.length,
  }
  const kinds: ItemList[] = ['notes', 'cards', 'identities']
  return (
    <>
      {kinds.map((kind) => {
        const shown = searching ? found[kind].length > 0 : props.list === kind
        if (!shown) return null
        return (
          <div
            key={kind}
            class="panel"
            role={searching ? undefined : 'tabpanel'}
            id={`panel-${kind}`}
            aria-labelledby={searching ? undefined : `tab-${kind}`}
          >
            {searching && <h2 class="label-caps list-title">{t(titles[kind])}</h2>}
            {!searching && total[kind] > 0 && (
              <div class="items-head">
                <Button kind="ghost" icon="plus" onClick={create[kind]}>
                  {t(`items_new_${kind}`)}
                </Button>
              </div>
            )}
            {found[kind].length > 0 ? (
              <ul class="list">
                {kind === 'notes' &&
                  found.notes.map((note) => (
                    <NoteRow key={note.id} note={note} onOpen={open.notes} />
                  ))}
                {kind === 'cards' &&
                  found.cards.map((card) => (
                    <CardRow key={card.id} card={card} onOpen={open.cards} />
                  ))}
                {kind === 'identities' &&
                  found.identities.map((identity) => (
                    <IdentityRow key={identity.id} identity={identity} onOpen={open.identities} />
                  ))}
              </ul>
            ) : (
              !searching &&
              (total[kind] === 0 ? (
                <Empty kind={kind} icon={icons[kind]} onNew={create[kind]} />
              ) : (
                <p class="empty muted">{t('popup_noneInTag')}</p>
              ))
            )}
          </div>
        )
      })}
    </>
  )
}
