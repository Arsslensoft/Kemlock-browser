// Tags: every tag the vault holds with how many items hold it (rename it everywhere, or take it off every item), and the items of
// every kind the core tags (codes, logins, passkeys, notes, cards and identities) to tag one by one. An item's own page is the tag
// editor, which each kind's own page reuses (`TagEditor`).
import { useState } from 'preact/hooks'
import {
  Button,
  Confirm,
  Group,
  LinkButton,
  Notice,
  PageHeader,
  Section,
  TextField,
  Tile,
  useLoad,
  useToast,
} from '../../shared/ui/components'
import type { PasskeyView } from '../../shared/passkeys'
import type { ItemKind, TagChange } from '../../shared/tools-api'
import { errorMessage, t } from '../../shared/ui/i18n'
import { Icon } from '../../shared/ui/icons'
import { codeName } from '../codes'
import type { Vault } from '../data'
import { codeMatches, loginMatches } from '../format'
import { cardLine, cardMatches, identityLine, identityMatches, noteMatches } from '../items-data'
import { passkeyMatches } from '../passkey-format'
import { ask } from '../send'
import type { ToolsRoute } from './routes'
import { TagEditor } from './tag-editor'

function TagRow(props: { name: string; count: number; onChanged: () => Promise<void> }) {
  const say = useToast()
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view')
  const [to, setTo] = useState(props.name)
  const [busy, setBusy] = useState(false)

  const run = async (
    work: () => Promise<TagChange>,
    done: string,
    doneWithSkipped: (changed: number, skipped: number) => string,
  ) => {
    setBusy(true)
    try {
      const result = await work()
      await props.onChanged()
      // Items in a space this account may only read are left as they are, and the person is told how many
      say(result.skipped > 0 ? doneWithSkipped(result.changed, result.skipped) : done)
      setMode('view')
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'delete')
    return (
      <Confirm
        danger
        busy={busy}
        title={t('tools_deleteTagTitle', props.name)}
        body={t('tools_deleteTagBody', props.count)}
        confirmLabel={t('tools_deleteTag')}
        cancelLabel={t('popup_cancel')}
        onCancel={() => setMode('view')}
        onConfirm={() =>
          void run(
            () => ask('deleteTag', { name: props.name }),
            t('tools_tagDeleted'),
            (changed, skipped) => t('tools_tagDeletedSkipped', changed, skipped),
          )
        }
      />
    )
  if (mode === 'rename')
    return (
      <form
        class="tag-rename"
        onSubmit={(event) => {
          event.preventDefault()
          void run(
            () => ask('renameTag', { from: props.name, to }),
            t('tools_tagRenamed'),
            (changed, skipped) => t('tools_tagRenamedSkipped', changed, skipped),
          )
        }}
      >
        <TextField
          label={t('tools_renameTagOf', props.name)}
          value={to}
          autofocus
          onInput={setTo}
        />
        <div class="actions">
          <Button onClick={() => setMode('view')}>{t('popup_cancel')}</Button>
          <Button kind="primary" type="submit" busy={busy} disabled={to.trim() === ''}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    )
  return (
    <div class="row tag-row">
      <span class="grow lines">
        <span class="name ellipsis">{props.name}</span>
        <span class="label">{t('tools_tagCount', props.count)}</span>
      </span>
      <LinkButton label={t('tools_renameTagOf', props.name)} onClick={() => setMode('rename')}>
        {t('tools_rename')}
      </LinkButton>
      <LinkButton label={t('tools_deleteTagTitle', props.name)} onClick={() => setMode('delete')}>
        {t('tools_deleteTag')}
      </LinkButton>
    </div>
  )
}

export function TagsPage(props: {
  vault: Vault
  onBack: () => void
  go: (route: ToolsRoute) => void
}) {
  const { vault } = props
  const tags = useLoad(() => ask('tags'))
  // The passkeys are not part of the vault's lists: asked for here, and left out if they can't be read
  const passkeys = useLoad(() => ask('passkeys'))
  const [query, setQuery] = useState('')
  const reload = async () => {
    await Promise.all([tags.reload(), vault.reload(), passkeys.reload()])
  }
  const rows = taggableItems(vault, passkeys.value ?? []).filter((row) => row.matches(query))
  return (
    <div class="screen">
      <PageHeader title={t('tools_tagsTitle')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        {tags.error !== undefined && <Notice kind="error">{tags.error}</Notice>}
        <Section title={t('tools_allTags')}>
          {tags.value !== undefined && tags.value.length === 0 ? (
            <p class="muted small">{t('tools_noTagsYet')}</p>
          ) : (
            <Group>
              {(tags.value ?? []).map((tag) => (
                <TagRow key={tag.name} name={tag.name} count={tag.count} onChanged={reload} />
              ))}
            </Group>
          )}
        </Section>
        <Section title={t('tools_tagAnItem')}>
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
          <ul class="list">
            {rows.map((row) => (
              <ItemRow
                key={`${row.kind}:${row.id}`}
                name={row.name}
                detail={row.detail}
                tags={row.tags}
                onOpen={() => props.go({ name: 'itemTags', kind: row.kind, id: row.id })}
              />
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}

function ItemRow(props: { name: string; detail: string; tags: string[]; onOpen: () => void }) {
  return (
    <li class="item">
      <button
        type="button"
        class="item-main hov"
        aria-label={t('tools_editTagsOf', props.name)}
        onClick={props.onOpen}
      >
        <Tile name={props.name} />
        <span class="grow lines">
          <span class="name ellipsis">{props.name}</span>
          <span class="label ellipsis">
            {props.tags.length > 0 ? props.tags.join(' · ') : props.detail}
          </span>
        </span>
        <Icon name="chevron" size={16} weight={2} />
      </button>
    </li>
  )
}

/** An item the tags page lists to tag one by one: its kind and id for `setTags`, what to call it, and the tags it holds. */
interface TaggableRow {
  kind: ItemKind
  id: string
  name: string
  detail: string
  tags: string[]
  matches: (query: string) => boolean
}

/** The items of every kind the core tags and the popup lists: codes, logins, passkeys, notes, cards and identities. */
export function taggableItems(vault: Vault, passkeys: PasskeyView[]): TaggableRow[] {
  return [
    ...vault.codes
      .filter((code) => !code.onSecurityKey)
      .map((code) => ({
        kind: 'code' as const,
        id: code.id,
        name: codeName(code),
        detail: code.account,
        tags: code.tags,
        matches: (query: string) => codeMatches(code, query),
      })),
    ...vault.logins.map((login) => ({
      kind: 'login' as const,
      id: login.id,
      name: login.name,
      detail: login.username,
      tags: login.tags,
      matches: (query: string) => loginMatches(login, query),
    })),
    ...passkeys.map((passkey) => ({
      kind: 'passkey' as const,
      id: passkey.id,
      name: passkey.name,
      detail: passkey.userDisplayName ?? passkey.userName,
      tags: passkey.tags ?? [],
      matches: (query: string) => passkeyMatches(passkey, query),
    })),
    ...vault.notes.map((note) => ({
      kind: 'note' as const,
      id: note.id,
      name: note.title,
      detail: '',
      tags: note.tags,
      matches: (query: string) => noteMatches(note, query),
    })),
    ...vault.cards.map((card) => ({
      kind: 'card' as const,
      id: card.id,
      name: card.name,
      detail: cardLine(card),
      tags: card.tags,
      matches: (query: string) => cardMatches(card, query),
    })),
    ...vault.identities.map((identity) => ({
      kind: 'identity' as const,
      id: identity.id,
      name: identity.name,
      detail: identityLine(identity),
      tags: identity.tags,
      matches: (query: string) => identityMatches(identity, query),
    })),
  ]
}

/** One item's tags, with the editor. */
export function ItemTagsPage(props: {
  kind: ItemKind
  id: string
  vault: Vault
  onBack: () => void
}) {
  const { vault } = props
  const passkeys = useLoad(() => ask('passkeys'))
  const items = taggableItems(vault, passkeys.value ?? [])
  const item = items.find((held) => held.kind === props.kind && held.id === props.id)
  const name = item?.name ?? ''
  // A passkey's page is not in the list until the passkeys are read: that is not "gone"
  const pending = props.kind === 'passkey' && passkeys.value === undefined && item === undefined
  const everyTag = [...new Set(items.flatMap((held) => held.tags))].sort((a, b) =>
    a.localeCompare(b),
  )
  return (
    <div class="screen">
      <PageHeader
        title={name || t('tools_tagsTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        {item === undefined ? (
          pending ? (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          ) : (
            <Notice kind="error">{t('tools_itemGone')}</Notice>
          )
        ) : (
          <Group pad>
            <TagEditor
              kind={props.kind}
              id={props.id}
              tags={item.tags}
              suggestions={everyTag}
              onChange={() => {
                void vault.reload()
                if (props.kind === 'passkey') void passkeys.reload()
              }}
            />
          </Group>
        )}
      </div>
    </div>
  )
}
