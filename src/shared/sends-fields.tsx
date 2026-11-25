// The option fields of a Send, as the New Send page and the popup's edit page both show them: when it is deleted, when its link stops
// working, how many times it may be opened, its password, "Hide my email" and the owner's notes (docs/plans/add-sends.md, design 4).
import { SelectField, Switch, TextField } from './ui/components'
import { formatDate, t } from './ui/i18n'
import {
  deleteChoices,
  deleteInMs,
  expiryChoices,
  fitExpiry,
  keepsExpiry,
  type OptionsDraft,
} from './sends-options'
import { sendDaysText } from './sends-text'
import type { SendDetail } from './sends'

/** The fields. [was] is the Send being edited, which has a date to keep, opens used and maybe a password. */
export function SendOptionsFields(props: {
  draft: OptionsDraft
  onChange: (draft: OptionsDraft) => void
  was?: SendDetail
}) {
  const { draft, was } = props
  const now = Date.now()
  const set = (patch: Partial<OptionsDraft>) =>
    props.onChange(fitExpiry({ ...draft, ...patch }, was, now))
  const deleteMs = deleteInMs(draft, was, now)
  const deleteOptions = [
    ...(was === undefined
      ? []
      : [{ value: 'keep', label: t('sends_keepDate', formatDate(was.deletionAt)) }]),
    ...deleteChoices.map((choice) => ({ value: String(choice), label: sendDaysText(choice) })),
  ]
  const expiryOptions = [
    { value: 'never', label: t('sends_expiresNever') },
    // The date the Send has, while the deletion doesn't come before it
    ...(was?.expiresAt === undefined || !keepsExpiry(draft, was, now)
      ? []
      : [{ value: 'keep', label: t('sends_keepDate', formatDate(was.expiresAt)) }]),
    ...expiryChoices(deleteMs).map((choice) => ({
      value: String(choice),
      label: sendDaysText(choice),
    })),
  ]
  const hasPassword = was?.hasPassword === true
  return (
    <>
      <SelectField
        stacked
        label={t('sends_deletes')}
        value={String(draft.deleteDays)}
        options={deleteOptions}
        onChange={(value) => set({ deleteDays: value === 'keep' ? 'keep' : Number(value) })}
      />
      <SelectField
        stacked
        label={t('sends_expires')}
        value={String(draft.expiry)}
        options={expiryOptions}
        onChange={(value) =>
          set({ expiry: value === 'never' || value === 'keep' ? value : Number(value) })
        }
      />
      <div class="stack">
        <Switch
          checked={draft.limited}
          label={t('sends_opensLimit')}
          onChange={(limited) => set({ limited })}
        />
        {draft.limited && (
          <TextField
            label={t('sends_opensCount')}
            value={draft.maxAccess}
            autocomplete="off"
            hint={
              was !== undefined && was.accessCount > 0
                ? t('sends_opensUsed', was.accessCount)
                : undefined
            }
            onInput={(maxAccess) => set({ maxAccess: maxAccess.replace(/\D/g, '').slice(0, 9) })}
          />
        )}
      </div>
      {hasPassword && (
        <SelectField
          stacked
          label={t('sends_password')}
          value={draft.passwordMode}
          options={[
            { value: 'keep', label: t('sends_passwordKeep') },
            { value: 'change', label: t('sends_passwordChange') },
            { value: 'remove', label: t('sends_passwordRemove') },
          ]}
          onChange={(mode) =>
            set({ passwordMode: mode as OptionsDraft['passwordMode'], password: '' })
          }
        />
      )}
      {(!hasPassword || draft.passwordMode === 'change') && (
        <TextField
          label={hasPassword ? t('sends_passwordNew') : t('sends_password')}
          value={draft.password}
          type="password"
          autocomplete="new-password"
          hint={hasPassword ? undefined : t('sends_passwordHint')}
          onInput={(password) => set({ password })}
        />
      )}
      <Switch
        checked={draft.hideEmail}
        label={t('sends_hideEmail')}
        detail={t('sends_hideEmailHint')}
        onChange={(hideEmail) => set({ hideEmail })}
      />
      <TextField
        label={t('sends_notes')}
        hint={t('sends_notesHint')}
        value={draft.notes}
        multiline
        onInput={(notes) => set({ notes })}
      />
    </>
  )
}
