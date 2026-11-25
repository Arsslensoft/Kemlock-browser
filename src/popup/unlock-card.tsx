// Unlocking with a passkey, Windows Hello, Touch ID or a security key (docs/plans/add-passkey-unlock.md): the lock screen's button, and
// Settings › Security, which lists the credentials and adds, renames and removes them. WebAuthn can't be asked here, since the popup
// closes when the browser's prompt takes focus, so adding and unlocking open the extension's unlock tab.
import './unlock-card.css'
import { useState } from 'preact/hooks'
import type { PasskeySlotView } from '../shared/api'
import {
  Button,
  Confirm,
  Group,
  IconButton,
  Notice,
  Section,
  TextField,
  useLoad,
} from '../shared/ui/components'
import { errorMessage, formatDate, t } from '../shared/ui/i18n'
import { prfSupport } from '../unlock/ceremony'
import { ask } from './send'

/** The unlock tab, for the ceremony the popup can't run. */
function openUnlockTab(page: 'add' | 'unlock'): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`src/unlock/index.html#${page}`) })
}

/** What the lock screen needs: whether the browser has PRF, the credentials, and whether the password is asked instead. */
async function loadLock() {
  const [support, info] = await Promise.all([prfSupport(), ask('passkeyUnlockInfo')])
  return { support, info }
}

/**
 * "Unlock with a passkey or security key", over the password form: only where the browser has PRF and a credential is set up. When
 * the password is required, a line says why instead, and the password form is all there is.
 */
export function PasskeyUnlockButton() {
  const found = useLoad(loadLock)
  const { value } = found
  // A background that can't answer, or no credential: nothing to offer, and the password form is as it was
  if (
    value === undefined ||
    value.support === 'no' ||
    value.support === 'firefox' ||
    value.info.credentials.length === 0
  )
    return null
  const why = value.info.passwordRequired
  if (why !== undefined) {
    return (
      <Notice kind="info" class="passkey-note">
        {t(why === 'days' ? 'unlock_passwordDays' : 'unlock_passwordTries')}
      </Notice>
    )
  }
  return (
    <div class="passkey-lock">
      <Button kind="primary" tall icon="key" onClick={() => openUnlockTab('unlock')}>
        {t('unlock_button')}
      </Button>
      <p class="passkey-or muted small">{t('unlock_orPassword')}</p>
    </div>
  )
}

const kindName = (slot: PasskeySlotView): string =>
  t(slot.attachment === 'cross-platform' ? 'unlock_kindKeyShort' : 'unlock_kindDeviceShort')

function detail(slot: PasskeySlotView): string {
  const added = formatDate(slot.addedAt)
  return slot.lastUsedAt === undefined
    ? t('unlock_rowAdded', kindName(slot), added)
    : t('unlock_rowUsed', kindName(slot), added, formatDate(slot.lastUsedAt))
}

/** Settings › Security: the credentials that open the vault beside its password. */
export function PasskeyUnlockCard() {
  const support = useLoad(prfSupport)
  const info = useLoad(() => ask('passkeyUnlockInfo'))
  const [renaming, setRenaming] = useState<string | undefined>()
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<PasskeySlotView | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  if (support.loading) return null
  const title = t('unlock_sectionSecurity')
  // Said plainly, with nothing to press: this browser can't do it
  if (support.value === 'no' || support.value === 'firefox') {
    return (
      <Section title={title}>
        <Group pad>
          <p class="muted">
            {t(support.value === 'firefox' ? 'unlock_unsupportedFirefox' : 'unlock_unsupported')}
          </p>
        </Group>
      </Section>
    )
  }

  const slots = info.value?.credentials ?? []

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      setError(undefined)
      await info.reload()
    } catch (failure) {
      setError(errorMessage(failure))
    }
    setBusy(false)
  }

  return (
    <Section title={title}>
      <Group>
        <div class="passkey-intro">
          <span class="strong">{t('unlock_rowTitle')}</span>
          <span class="muted small">{t('unlock_rowDetail')}</span>
        </div>
        {error !== undefined && <Notice kind="error">{error}</Notice>}
        {info.value?.passwordRequired !== undefined && (
          <Notice kind="info">
            {t(
              info.value.passwordRequired === 'days'
                ? 'unlock_passwordDays'
                : 'unlock_passwordTries',
            )}
          </Notice>
        )}
        {slots.length === 0 && info.value !== undefined && (
          <p class="passkey-none muted small">{t('unlock_none')}</p>
        )}
        {slots.map((slot) => (
          <div key={slot.id} class="passkey-item">
            {renaming === slot.id ? (
              <form
                class="stack"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (draft.trim() === '') return
                  void run(async () => {
                    await ask('renamePasskeyUnlock', { id: slot.id, name: draft.trim() })
                    setRenaming(undefined)
                  })
                }}
              >
                <TextField
                  label={t('unlock_nameLabel')}
                  value={draft}
                  autofocus
                  onInput={setDraft}
                />
                <div class="actions start">
                  <Button kind="primary" type="submit" busy={busy} disabled={draft.trim() === ''}>
                    {t('unlock_save')}
                  </Button>
                  <Button onClick={() => setRenaming(undefined)}>{t('unlock_cancel')}</Button>
                </div>
              </form>
            ) : (
              <div class="row passkey-row">
                <div class="grow">
                  <div class="strong passkey-name">{slot.name}</div>
                  <div class="muted small">{detail(slot)}</div>
                </div>
                <IconButton
                  icon="edit"
                  label={t('unlock_renameNamed', slot.name)}
                  disabled={busy}
                  onClick={() => {
                    setDraft(slot.name)
                    setRenaming(slot.id)
                  }}
                />
                <IconButton
                  icon="trash"
                  label={t('unlock_removeNamed', slot.name)}
                  disabled={busy}
                  onClick={() => setRemoving(slot)}
                />
              </div>
            )}
            {removing?.id === slot.id && (
              <Confirm
                title={t('unlock_removeTitle', slot.name)}
                body={t('unlock_removeBody')}
                confirmLabel={t('unlock_remove')}
                cancelLabel={t('unlock_cancel')}
                danger
                busy={busy}
                onCancel={() => setRemoving(undefined)}
                onConfirm={() =>
                  void run(async () => {
                    await ask('removePasskeyUnlock', { id: slot.id })
                    setRemoving(undefined)
                  })
                }
              />
            )}
          </div>
        ))}
        <div class="passkey-add">
          <div class="actions start">
            <Button icon="plus" onClick={() => openUnlockTab('add')}>
              {t('unlock_add')}
            </Button>
          </div>
          <p class="muted small">{t('unlock_addNote')}</p>
        </div>
      </Group>
    </Section>
  )
}
