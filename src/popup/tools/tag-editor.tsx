// The tag editor: the chips an item holds, each with a button that removes it, a field where Enter or a comma adds what was typed,
// and the tags of other items offered with one tap. Shared: any screen that shows an item says its kind and id, and the editor
// saves each change through the background (`setTags`), so the item's page needs no form of its own for tags.
import { useId, useState } from 'preact/hooks'
import type { ItemKind } from '../../shared/tools-api'
import { useToast } from '../../shared/ui/components'
import { errorMessage, t } from '../../shared/ui/i18n'
import { Icon } from '../../shared/ui/icons'
import { ask } from '../send'

/** The longest a tag can be, as the app keeps it. */
export const maxTagLength = 24

/** How many tags from other items are offered at once. */
const maxSuggestions = 8

const plain = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const same = (a: string, b: string): boolean => plain(a) === plain(b)

export function TagEditor(props: {
  kind: ItemKind
  id: string
  /** The tags the item holds now. */
  tags: string[]
  /** Tags other items hold, offered to add. */
  suggestions?: string[]
  /** Told the tags that were saved, so the page can load the vault again. */
  onChange?: (tags: string[]) => void
}) {
  const say = useToast()
  const inputId = useId()
  const [tags, setTags] = useState(props.tags)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (next: string[]) => {
    setBusy(true)
    try {
      const saved = await ask('setTags', { itemKind: props.kind, id: props.id, tags: next })
      setTags(saved)
      props.onChange?.(saved)
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const add = (raw: string[]) => {
    const fresh = raw.map((text) => text.trim()).filter((text) => text !== '')
    if (fresh.length === 0) return
    setDraft('')
    const next = [...tags]
    for (const tag of fresh) if (!next.some((held) => same(held, tag))) next.push(tag)
    if (next.length !== tags.length) void save(next)
  }

  const offered = (props.suggestions ?? [])
    .filter((tag) => !tags.some((held) => same(held, tag)))
    .slice(0, maxSuggestions)

  return (
    <div class="tag-editor">
      <label class="tag-editor-label" for={inputId}>
        {t('tools_tags')}
      </label>
      <ul class="tag-chips plain" aria-label={t('tools_tagsOfItem')}>
        {tags.length === 0 && <li class="muted small">{t('tools_noTags')}</li>}
        {tags.map((tag) => (
          <li key={tag} class="tag-chip">
            <span class="ellipsis">{tag}</span>
            <button
              type="button"
              class="tag-remove"
              aria-label={t('tools_removeTag', tag)}
              title={t('tools_removeTag', tag)}
              disabled={busy}
              onClick={() => void save(tags.filter((held) => held !== tag))}
            >
              <Icon name="x" size={14} weight={2.2} />
            </button>
          </li>
        ))}
      </ul>
      <div class="box tag-input">
        <input
          id={inputId}
          type="text"
          value={draft}
          maxLength={maxTagLength + 1}
          placeholder={t('tools_addTagPlaceholder')}
          autocomplete="off"
          spellcheck={false}
          disabled={busy}
          onInput={(event) => {
            const text = event.currentTarget.value
            // A comma finishes a tag, as on most tag fields
            if (text.includes(',')) {
              const parts = text.split(',')
              add(parts.slice(0, -1))
              setDraft(parts[parts.length - 1] ?? '')
            } else setDraft(text)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add([draft])
            }
          }}
          onBlur={() => add([draft])}
        />
      </div>
      {offered.length > 0 && (
        <div class="chips tag-suggestions" role="group" aria-label={t('tools_suggestedTags')}>
          {offered.map((tag) => (
            <button
              key={tag}
              type="button"
              class="chip"
              disabled={busy}
              aria-label={t('tools_addTagOf', tag)}
              onClick={() => add([tag])}
            >
              <span>{tag}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
