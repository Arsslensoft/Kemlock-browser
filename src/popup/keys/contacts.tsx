// Contacts: other people's OpenPGP public keys. Adding one by pasted text or a file shows its fingerprint first, and says whether
// the person compared it with its owner; a contact's page shows the same, with the key to copy.
import { useState } from 'preact/hooks'
import type { ContactPreview, Source } from '../../shared/keys-api'
import { KemlockIcon } from '../../shared/brand/brand'
import {
  Button,
  Confirm,
  Group,
  IconButton,
  Notice,
  PageHeader,
  Section,
  Switch,
  TextField,
  Tile,
  useLoad,
  useToast,
} from '../../shared/ui/components'
import { formatDate, formatDateTime, t } from '../../shared/ui/i18n'
import { ask } from '../send'
import type { KeysData } from './data'
import { keysError } from './data'
import type { PickedFile } from './files'
import { standingNames } from './format'
import { Aside, CopyBox, SourceBox, sourceOf } from './parts'
import type { KeysRoute } from './route'

/** What adding one found, in a card the person checks against what its owner told them. */
function Found(props: {
  item: ContactPreview
  compared: boolean
  onCompared: (compared: boolean) => void
  replace: boolean
  onReplace: (replace: boolean) => void
}) {
  const { item } = props
  return (
    <div class="keys-found">
      <p class="strong">{item.name}</p>
      <p class="muted ellipsis">{item.line}</p>
      <p class="mono keys-fingerprint" aria-label={t('keys_fingerprint')}>
        {item.fingerprint}
      </p>
      {item.userIds.length > 1 && <p class="muted">{item.userIds.join(' · ')}</p>}
      {item.standing !== 'ok' && <Notice kind="warn">{t(standingNames[item.standing])}</Notice>}
      {item.status === 'own' && <Notice>{t('keys_contactOwn', item.existingName ?? '')}</Notice>}
      {(item.status === 'held' || item.status === 'update') && (
        <Notice>
          {item.status === 'update'
            ? t('keys_contactUpdate', item.existingName ?? '')
            : t('keys_contactHeld', item.existingName ?? '')}
        </Notice>
      )}
      {item.status === 'new' && item.sameAddressId !== undefined && (
        <Switch
          label={t('keys_contactReplace', item.sameAddressName ?? '')}
          detail={t('keys_contactReplaceBody', item.sameAddress ?? '')}
          checked={props.replace}
          onChange={props.onReplace}
        />
      )}
      {item.status !== 'own' && (
        <Switch
          label={t('keys_compared')}
          detail={t('keys_comparedBody')}
          checked={props.compared}
          onChange={props.onCompared}
        />
      )}
    </div>
  )
}

export function AddContact(props: {
  data: KeysData
  initialText?: string
  onBack: () => void
  onAdded: (id: string | null) => void
}) {
  const say = useToast()
  const [text, setText] = useState(props.initialText ?? '')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [found, setFound] = useState<ContactPreview[] | undefined>()
  const [compared, setCompared] = useState<Set<string>>(new Set())
  const [replace, setReplace] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const given = (chosen: PickedFile | null = file): Source | null => sourceOf(text, chosen)

  const read = async (chosen: PickedFile | null = file) => {
    const source = given(chosen)
    if (source === null) return
    setBusy(true)
    setError(undefined)
    setFound(undefined)
    try {
      setFound(await ask('previewContacts', source))
      setCompared(new Set())
      setReplace(false)
    } catch (failure) {
      setError(keysError(failure))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    const source = given()
    if (source === null || found === undefined) return
    const single = found.length === 1 ? found[0] : undefined
    setBusy(true)
    setError(undefined)
    try {
      const added = await ask('addContacts', {
        ...source,
        source: file === null ? 'paste' : 'file',
        checked: [...compared],
        ...(replace && single?.sameAddressId !== undefined
          ? { replacing: single.sameAddressId }
          : {}),
      })
      await props.data.reload()
      say(t('keys_contactsAdded', added.length))
      props.onAdded(added.length === 1 ? (added[0]?.id ?? null) : null)
    } catch (failure) {
      setError(keysError(failure))
      setBusy(false)
    }
  }

  const addable = found?.some((item) => item.status !== 'own') ?? false
  return (
    <div class="screen">
      <PageHeader title={t('keys_addContact')} onBack={props.onBack} backLabel={t('popup_back')} />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void (found === undefined ? read() : add())
        }}
      >
        <div class="body form-body">
          <p class="muted">{t('keys_contactBody')}</p>
          <SourceBox
            label={t('keys_contactPaste')}
            text={text}
            onText={(next) => {
              setText(next)
              setFound(undefined)
            }}
            file={file}
            onFile={(chosen) => {
              setFile(chosen)
              setFound(undefined)
              if (chosen !== null) void read(chosen)
            }}
            placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
            tabHash="addContact"
            onTooLarge={() => setError(t('keys_error_tooLarge'))}
          />
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          {found?.map((item) => (
            <Found
              key={item.fingerprintHex}
              item={item}
              compared={compared.has(item.fingerprintHex)}
              onCompared={(on) =>
                setCompared((previous) => {
                  const next = new Set(previous)
                  if (on) next.add(item.fingerprintHex)
                  else next.delete(item.fingerprintHex)
                  return next
                })
              }
              replace={replace}
              onReplace={setReplace}
            />
          ))}
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          {found === undefined ? (
            <Button kind="primary" tall type="submit" busy={busy} disabled={given() === null}>
              {t('keys_contactRead')}
            </Button>
          ) : (
            <Button kind="primary" tall type="submit" busy={busy} disabled={!addable}>
              {t('keys_contactAdd')}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

export function ContactPage(props: {
  id: string
  data: KeysData
  onBack: () => void
  onRoute: (route: KeysRoute) => void
}) {
  const { data } = props
  const item = data.contacts.find((candidate) => candidate.id === props.id)
  const say = useToast()
  const key = useLoad(() => ask('contactPublic', { id: props.id }), [props.id])
  const [asking, setAsking] = useState<'delete' | 'compare' | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(item?.name ?? '')
  const [note, setNote] = useState(item?.note ?? '')

  if (item === undefined) {
    return (
      <div class="screen">
        <header class="bar">
          <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
          <KemlockIcon size={24} class="mark" />
          <h1>{t('keys_contacts')}</h1>
        </header>
        <div class="body">
          <Notice>{t('keys_contactGone')}</Notice>
        </div>
      </div>
    )
  }

  const run = async (work: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await work()
      await data.reload()
      if (done !== undefined) say(done)
      return true
    } catch (failure) {
      say(keysError(failure))
      return false
    } finally {
      setBusy(false)
    }
  }

  const changed = name.trim() !== item.name || note.trim() !== (item.note ?? '')
  return (
    <div class="screen">
      <header class="bar login-bar">
        <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
        <KemlockIcon size={24} class="mark" />
        <Tile name={item.name} size={32} />
        <h1 class="login-title">{item.name}</h1>
        <IconButton
          icon="trash"
          label={t('keys_deleteContact')}
          onClick={() => setAsking('delete')}
        />
      </header>

      {asking === 'delete' && (
        <div class="login-confirm">
          <Confirm
            title={t('keys_deleteContactTitle')}
            body={t('keys_deleteContactBody', item.name)}
            confirmLabel={t('popup_delete')}
            cancelLabel={t('popup_cancel')}
            danger
            busy={busy}
            onCancel={() => setAsking(null)}
            onConfirm={() =>
              void run(() => ask('deleteContact', { id: item.id })).then((done) => {
                if (done) props.onBack()
                else setAsking(null)
              })
            }
          />
        </div>
      )}
      {asking === 'compare' && (
        <div class="login-confirm">
          <Confirm
            title={t('keys_compareTitle', item.name)}
            body={t('keys_compareBody', item.fingerprint)}
            confirmLabel={t('keys_compareConfirm')}
            cancelLabel={t('popup_cancel')}
            busy={busy}
            onCancel={() => setAsking(null)}
            onConfirm={() =>
              void run(
                () => ask('saveContact', { id: item.id, checked: true }),
                t('keys_compareDone'),
              ).then(() => setAsking(null))
            }
          />
        </div>
      )}

      <div class="body tight">
        {item.standing !== 'ok' && (
          <Notice kind="warn">
            {item.standing === 'revoked'
              ? t('keys_contactRevoked')
              : item.standing === 'expired'
                ? t('keys_contactExpired')
                : t('keys_contactExpiring')}
          </Notice>
        )}
        {item.unreadable === true && <Notice kind="error">{t('keys_contactUnreadable')}</Notice>}
        <Group>
          <div class="detail-row">
            <span class="detail-label">{t('keys_fingerprint')}</span>
            <span class="grow keys-detail">
              <span class="mono keys-fingerprint">{item.fingerprint}</span>
            </span>
            <IconButton
              icon="copy"
              size={16}
              label={t('keys_copyFingerprint')}
              onClick={() =>
                void navigator.clipboard.writeText(item.fingerprint).then(
                  () => say(t('keys_copied')),
                  () => say(t('keys_copyFailed')),
                )
              }
            />
          </div>
          <div class="detail-row">
            <span class="detail-label">{t('keys_userIds')}</span>
            <span class="grow keys-detail">
              {item.userIds.map((userId) => (
                <span key={userId} class="ellipsis">
                  {userId}
                </span>
              ))}
            </span>
          </div>
          {item.expires !== undefined && (
            <div class="detail-row">
              <span class="detail-label">{t('keys_expires')}</span>
              <span class="grow">{formatDate(item.expires)}</span>
            </div>
          )}
          <div class="detail-row">
            <span class="detail-label">{t('keys_added')}</span>
            <span class="grow">{formatDate(item.addedAt)}</span>
          </div>
        </Group>

        <Section title={t('keys_comparedTitle')}>
          {item.checked ? (
            <Notice kind="ok">
              {item.checkedAt === undefined
                ? t('keys_checkedLine')
                : t('keys_checkedOn', formatDateTime(item.checkedAt))}
            </Notice>
          ) : (
            <Notice kind="warn">{t('keys_notCheckedLine')}</Notice>
          )}
          {item.checked && item.uncheckedAddresses.length > 0 && (
            <Aside>{t('keys_uncheckedAddresses', item.uncheckedAddresses.join(', '))}</Aside>
          )}
          <div class="keys-actions">
            {item.checked ? (
              <Button
                busy={busy}
                onClick={() =>
                  void run(
                    () => ask('saveContact', { id: item.id, checked: false }),
                    t('keys_uncompareDone'),
                  )
                }
              >
                {t('keys_uncompare')}
              </Button>
            ) : (
              <Button kind="primary" busy={busy} onClick={() => setAsking('compare')}>
                {t('keys_compare')}
              </Button>
            )}
            {item.canEncrypt && (
              <Button icon="lock" onClick={() => props.onRoute({ name: 'tools', tool: 'encrypt' })}>
                {t('keys_encryptTo')}
              </Button>
            )}
          </div>
        </Section>

        {key.value !== undefined && (
          <CopyBox label={t('keys_publicPgp')} text={key.value.pem} fileName={key.value.fileName} />
        )}
        {key.error !== undefined && <Notice kind="error">{key.error}</Notice>}

        <Section title={t('keys_detailsTitle')}>
          <form
            class="stack-12 keys-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!changed) return
              void run(
                () =>
                  ask('saveContact', {
                    id: item.id,
                    name: name.trim() === '' ? item.name : name.trim(),
                    note: note.trim(),
                  }),
                t('keys_saveDone'),
              )
            }}
          >
            <TextField label={t('keys_fieldName')} value={name} onInput={setName} />
            <TextField label={t('keys_fieldNote')} value={note} multiline onInput={setNote} />
            <div class="actions">
              <Button kind="primary" type="submit" busy={busy} disabled={!changed}>
                {t('popup_save')}
              </Button>
            </div>
          </form>
        </Section>
      </div>
    </div>
  )
}
