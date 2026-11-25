// The duplicate cleaner, as the app's Duplicates screen has it: the groups of items the vault holds more than once with the reason
// each matched, Review (what the merge keeps, the newest value preselected), "Not duplicates" with Undo, Check again, and Undo
// merge for 30 days. With a Kemlock Server account, the switch for server matching, which lets the server suggest groups of logins.
import { useState } from 'preact/hooks'
import type { DuplicateGroup, MergePlan } from '../../shared/tools-api'
import {
  Button,
  Confirm,
  Group,
  LinkButton,
  Notice,
  PageHeader,
  Section,
  Switch,
  useLoad,
  useToast,
} from '../../shared/ui/components'
import { formatDate, hasMessage, t } from '../../shared/ui/i18n'
import type { Vault } from '../data'
import { isStale, toolsError, toolsLoadError } from './errors'
import { ask } from '../send'
import type { ToolsRoute } from './routes'

/** The reason a group matched, in words; a reason this version doesn't know is the general line. */
const reasonText = (reason: string): string =>
  hasMessage(`tools_reason_${reason}`) ? t(`tools_reason_${reason}`) : t('tools_reason_other')

export function DuplicatesPage(props: {
  vault: Vault
  onBack: () => void
  go: (route: ToolsRoute) => void
}) {
  const say = useToast()
  const found = useLoad(() => ask('duplicates'))
  const [explain, setExplain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState<string | undefined>()
  /** The merge whose item that stayed was changed since: Undo asks before it overwrites that. */
  const [editedUndo, setEditedUndo] = useState<{ id: string; label: string } | undefined>()
  const data = found.value

  const dismiss = async (group: DuplicateGroup) => {
    try {
      await ask('duplicateDismiss', { key: group.key })
      setDismissed(group.key)
      await found.reload()
    } catch (error) {
      say(toolsError(error))
      if (isStale(error)) await found.reload()
    }
  }

  const undo = async (recordId: string, label: string, overwrite = false) => {
    try {
      const result = await ask('duplicateUndo', { recordId, ...(overwrite ? { overwrite } : {}) })
      if (result === 'edited') {
        setEditedUndo({ id: recordId, label })
        return
      }
      setEditedUndo(undefined)
      say(t(result === 'undone' ? 'tools_mergeUndone' : 'tools_mergeUndoFailed'))
      await Promise.all([found.reload(), props.vault.reload()])
    } catch (error) {
      say(toolsError(error))
    }
  }

  const setMatching = async (on: boolean) => {
    setBusy(true)
    try {
      await ask('setDuplicateMatching', { on })
      setExplain(false)
      await found.reload()
    } catch (error) {
      say(toolsError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t('tools_duplicatesTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        <p class="note-text">{t('tools_duplicatesNote')}</p>
        {found.error !== undefined && <Notice kind="error">{toolsLoadError(found.error)}</Notice>}
        {data === undefined && found.error === undefined && (
          <p class="muted" role="status">
            {t('tools_checking')}
          </p>
        )}
        {data !== undefined && (
          <>
            <p class="muted small">
              {data.matching.on ? t('tools_onDeviceServer') : t('tools_onDevice')}
            </p>
            {dismissed !== undefined && (
              <Notice kind="ok">
                <p>{t('tools_notDuplicatesSaved')}</p>
                <button
                  type="button"
                  class="note-link"
                  onClick={() =>
                    void ask('duplicateRestore', { key: dismissed })
                      .then(() => {
                        setDismissed(undefined)
                        return found.reload()
                      })
                      .catch((error) => say(toolsError(error)))
                  }
                >
                  {t('tools_undo')}
                </button>
              </Notice>
            )}
            {data.groups.length === 0 ? (
              <Notice kind="ok">{t('tools_noDuplicates')}</Notice>
            ) : (
              data.groups.map((group) => (
                <article
                  class="group pad dup-group"
                  key={group.key}
                  aria-label={reasonText(group.reason)}
                >
                  <h2 class="dup-reason">{reasonText(group.reason)}</h2>
                  <ul class="plain stack">
                    {group.items.map((item) => (
                      <li key={item.id} class="lines">
                        <span class="name ellipsis">{item.name}</span>
                        <span class="label ellipsis">
                          {[item.detail, t('tools_changedOn', formatDate(item.changedAt))]
                            .filter((part) => part !== '')
                            .join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div class="actions start">
                    <Button
                      kind="primary"
                      label={t('tools_reviewGroup', reasonText(group.reason))}
                      onClick={() => props.go({ name: 'duplicate', key: group.key })}
                    >
                      {t('tools_review')}
                    </Button>
                    <Button
                      label={t('tools_notDuplicatesOf', group.items[0]?.name ?? '')}
                      onClick={() => void dismiss(group)}
                    >
                      {t('tools_notDuplicates')}
                    </Button>
                  </div>
                </article>
              ))
            )}
            <div class="actions start">
              <Button icon="refresh" onClick={() => void found.reload()}>
                {t('tools_checkAgain')}
              </Button>
            </div>

            {editedUndo !== undefined && (
              <Confirm
                danger
                title={t(
                  'tools_undoEditedTitle',
                  editedUndo.label === '' ? t('tools_unnamed') : editedUndo.label,
                )}
                body={t('tools_undoEditedBody')}
                confirmLabel={t('tools_undoAnyway')}
                cancelLabel={t('popup_cancel')}
                onCancel={() => setEditedUndo(undefined)}
                onConfirm={() => void undo(editedUndo.id, editedUndo.label, true)}
              />
            )}
            {data.records.length > 0 && (
              <Section title={t('tools_undoMerge')}>
                <Group>
                  {[...data.records].reverse().map((record) => (
                    <div class="row pad-row" key={record.id}>
                      <span class="grow lines">
                        <span class="name ellipsis">
                          {record.label === '' ? t('tools_unnamed') : record.label}
                        </span>
                        <span class="label">
                          {t('tools_mergedOn', formatDate(record.at), record.count)}
                        </span>
                      </span>
                      <LinkButton
                        label={t('tools_undoMergeOf', record.label)}
                        onClick={() => void undo(record.id, record.label)}
                      >
                        {t('tools_undo')}
                      </LinkButton>
                    </div>
                  ))}
                </Group>
                <p class="note-faint">{t('tools_undoMergeNote')}</p>
              </Section>
            )}

            {data.matching.available && (
              <Section title={t('tools_serverMatching')}>
                <Group pad>
                  <Switch
                    checked={data.matching.on}
                    label={t('tools_serverMatchingSwitch')}
                    detail={t('tools_serverMatchingDetail')}
                    disabled={busy}
                    onChange={(on) => (on ? setExplain(true) : void setMatching(false))}
                  />
                  {explain && (
                    <Confirm
                      title={t('tools_matchingExplainTitle')}
                      body={`${t('tools_matchingExplainSends')} ${t('tools_matchingExplainLearns')} ${t('tools_matchingExplainNever')}`}
                      confirmLabel={t('tools_matchingTurnOn')}
                      cancelLabel={t('popup_cancel')}
                      busy={busy}
                      onCancel={() => setExplain(false)}
                      onConfirm={() => void setMatching(true)}
                    />
                  )}
                </Group>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** What a merge keeps: the item that stays, and for each field that differs the copy it is taken from. */
export function DuplicateReviewPage(props: { keyText: string; vault: Vault; onBack: () => void }) {
  const say = useToast()
  const plan = useLoad(() => ask('duplicateReview', { key: props.keyText }), [props.keyText])
  const [kept, setKept] = useState<string | undefined>()
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const data: MergePlan | undefined = plan.value
  if (data === undefined)
    return (
      <div class="screen">
        <PageHeader
          title={t('tools_reviewTitle')}
          onBack={props.onBack}
          backLabel={t('popup_back')}
        />
        <div class="body">
          {plan.error !== undefined ? (
            <Notice kind="error">{toolsLoadError(plan.error)}</Notice>
          ) : (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          )}
        </div>
      </div>
    )

  const keptId = kept ?? data.keptId
  const merge = async () => {
    setBusy(true)
    try {
      // What the person didn't change is what was preselected: the newest copy
      const chosen: Record<string, string> = {}
      for (const field of data.fields) chosen[field.id] = picks[field.id] ?? field.picked
      const done = await ask('duplicateMerge', { key: data.key, keptId, picks: chosen })
      await props.vault.reload()
      say(
        done.skipped !== undefined && done.skipped > 0
          ? t('tools_mergedSkipped', done.removed, done.skipped)
          : t('tools_merged', done.removed),
      )
      props.onBack()
    } catch (error) {
      say(toolsError(error))
      // The group is not what it was: back to the list, which is checked again
      if (isStale(error)) props.onBack()
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t('tools_reviewTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        <p class="note-text">{t('tools_reviewNote')}</p>
        {data.skipped !== undefined && data.skipped > 0 && (
          <p class="note-faint" role="note">
            {t('tools_reviewSkipped', data.skipped)}
          </p>
        )}
        <Section title={t('tools_keepWhich')}>
          <Group>
            {data.items.map((item) => (
              <label class="row pad-row choice" key={item.id}>
                <input
                  type="radio"
                  name="kept"
                  checked={keptId === item.id}
                  onChange={() => setKept(item.id)}
                />
                <span class="grow lines">
                  <span class="name ellipsis">{item.name}</span>
                  <span class="label ellipsis">
                    {[item.detail, t('tools_changedOn', formatDate(item.changedAt))]
                      .filter((part) => part !== '')
                      .join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </Group>
        </Section>
        {data.fields.map((field) => (
          <Section key={field.id} title={t(`tools_field_${field.id}`)}>
            <Group>
              {field.options.map((option) => {
                const item = data.items.find((held) => held.id === option.itemId)
                return (
                  <label class="row pad-row choice" key={option.itemId}>
                    <input
                      type="radio"
                      name={`field-${field.id}`}
                      checked={(picks[field.id] ?? field.picked) === option.itemId}
                      onChange={() =>
                        setPicks((previous) => ({ ...previous, [field.id]: option.itemId }))
                      }
                    />
                    <span class="grow lines">
                      <span class="name ellipsis">
                        {option.text === '' ? t('tools_empty') : option.text}
                      </span>
                      <span class="label ellipsis">{item?.name ?? ''}</span>
                    </span>
                  </label>
                )
              })}
            </Group>
          </Section>
        ))}
        <p class="note-faint">{t('tools_reviewKept')}</p>
      </div>
      <div class="foot-bar">
        <Button tall onClick={props.onBack}>
          {t('popup_cancel')}
        </Button>
        <Button kind="primary" tall busy={busy} onClick={() => void merge()}>
          {t('tools_mergeItems', data.items.length)}
        </Button>
      </div>
    </div>
  )
}
