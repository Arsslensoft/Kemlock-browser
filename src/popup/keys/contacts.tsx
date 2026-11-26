// Contacts: other people's OpenPGP public keys. Adding one by pasted text or a file shows its fingerprint first, and says whether
// the person compared it with its owner; a contact's page shows the same, with the key to copy.
import { useState } from 'preact/hooks'
import type { ContactPreview, ContactView, Source } from '../../shared/keys-api'
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
import {
  FieldsEditor,
  FieldsSection,
  LinkPicker,
  LinksSection,
  useItemExtras,
} from '../item-extras'
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

/** The details a contact holds besides a key, as the forms hold them: text, as it is typed. */
interface Details {
  name: string
  company: string
  email: string
  phone: string
  address: string
  note: string
}

const detailsOf = (view: ContactView | undefined): Details => ({
  name: view?.name ?? '',
  company: view?.company ?? '',
  email: view?.email ?? '',
  phone: view?.phone ?? '',
  address: view?.address ?? '',
  note: view?.note ?? '',
})

const emailOk = (email: string): boolean =>
  email.trim() === '' || /^[^\s@]+@[^\s@]+$/.test(email.trim())

/** The boxes for a contact's details; the name is the page's own. */
function DetailFields(props: { value: Details; onChange: (next: Details) => void }) {
  const set = (key: keyof Details) => (text: string) =>
    props.onChange({ ...props.value, [key]: text })
  return (
    <>
      <TextField label={t('keys_fieldName')} value={props.value.name} onInput={set('name')} />
      <TextField
        label={t('items_fieldCompany')}
        value={props.value.company}
        onInput={set('company')}
      />
      <TextField
        label={t('items_fieldEmail')}
        value={props.value.email}
        invalid={!emailOk(props.value.email)}
        {...(emailOk(props.value.email) ? {} : { hint: t('extras_emailBad') })}
        onInput={set('email')}
      />
      <TextField label={t('items_fieldPhone')} value={props.value.phone} onInput={set('phone')} />
      <TextField
        label={t('items_address')}
        value={props.value.address}
        multiline
        onInput={set('address')}
      />
      <TextField
        label={t('keys_fieldNote')}
        value={props.value.note}
        multiline
        onInput={set('note')}
      />
    </>
  )
}

/** A contact with no key: a name and details only. It can be given a key later by adding one with the same name. */
function PlainContact(props: {
  data: KeysData
  onBack: () => void
  onAdded: (id: string | null) => void
}) {
  const [value, setValue] = useState<Details>(() => detailsOf(undefined))
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const extras = useItemExtras('contact', null, undefined)
  const save = async () => {
    const problem =
      value.name.trim() === ''
        ? t('extras_contactNeedsName')
        : !emailOk(value.email)
          ? t('extras_emailBad')
          : extras.problem
    if (problem !== undefined) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const saved = await ask('saveContact', {
        id: null,
        name: value.name.trim(),
        ...(value.company.trim() === '' ? {} : { company: value.company.trim() }),
        ...(value.email.trim() === '' ? {} : { email: value.email.trim() }),
        ...(value.phone.trim() === '' ? {} : { phone: value.phone.trim() }),
        ...(value.address.trim() === '' ? {} : { address: value.address.trim() }),
        ...(value.note.trim() === '' ? {} : { note: value.note.trim() }),
        ...extras.members(),
      })
      await props.data.reload()
      props.onAdded(saved.id)
    } catch (failure) {
      setError(keysError(failure))
      setBusy(false)
    }
  }
  return (
    <div class="screen">
      <PageHeader
        title={t('extras_newContact')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div class="body form-body">
          <p class="muted">{t('extras_contactNoKeyBody')}</p>
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          <DetailFields value={value} onChange={setValue} />
          <FieldsEditor {...extras.fieldsProps} />
          <LinkPicker {...extras.linkProps} />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={extras.loading}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
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
  // A contact needs no key: its name and details alone make one (the person's, kept with the rest of the vault)
  const [plain, setPlain] = useState(false)

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
  if (plain)
    return <PlainContact data={props.data} onBack={() => setPlain(false)} onAdded={props.onAdded} />
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
          {found === undefined && (
            <div class="actions start">
              <Button kind="ghost" icon="user" onClick={() => setPlain(true)}>
                {t('extras_contactNoKey')}
              </Button>
            </div>
          )}
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
  const [details, setDetails] = useState<Details>(() => detailsOf(item))
  const extras = useItemExtras(
    'contact',
    item === undefined ? null : { kind: 'contact', id: item.id },
    item?.fields,
  )

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

  const before = detailsOf(item)
  const same = (key: keyof Details) => details[key].trim() === before[key].trim()
  const changed =
    !(['name', 'company', 'email', 'phone', 'address', 'note'] as const).every(same) ||
    Object.keys(extras.members()).length > 0
  // A contact with no key has details only: nothing to compare or copy
  const hasKey = item.hasKey !== false
  const copyText = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => say(t('keys_copied')),
      () => say(t('keys_copyFailed')),
    )
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
        {hasKey && item.standing !== 'ok' && (
          <Notice kind="warn">
            {item.standing === 'revoked'
              ? t('keys_contactRevoked')
              : item.standing === 'expired'
                ? t('keys_contactExpired')
                : t('keys_contactExpiring')}
          </Notice>
        )}
        {item.unreadable === true && <Notice kind="error">{t('keys_contactUnreadable')}</Notice>}
        {(item.company ?? item.email ?? item.phone ?? item.address) !== undefined && (
          <Group>
            {item.company !== undefined && (
              <div class="detail-row">
                <span class="detail-label">{t('items_company')}</span>
                <span class="grow ellipsis">{item.company}</span>
              </div>
            )}
            {item.email !== undefined && (
              <div class="detail-row">
                <span class="detail-label">{t('items_email')}</span>
                <span class="grow keys-detail">
                  <span class="ellipsis">{item.email}</span>
                </span>
                <IconButton
                  icon="copy"
                  size={16}
                  label={t('items_copyEmail')}
                  onClick={() => copyText(item.email ?? '')}
                />
              </div>
            )}
            {item.phone !== undefined && (
              <div class="detail-row">
                <span class="detail-label">{t('items_phone')}</span>
                <span class="grow ellipsis">{item.phone}</span>
                <IconButton
                  icon="copy"
                  size={16}
                  label={t('items_copyPhone')}
                  onClick={() => copyText(item.phone ?? '')}
                />
              </div>
            )}
            {item.address !== undefined && (
              <div class="detail-row">
                <span class="detail-label">{t('items_address')}</span>
                <span class="grow contact-address">{item.address}</span>
              </div>
            )}
          </Group>
        )}
        {!hasKey && <Notice>{t('extras_contactNoKeyNote')}</Notice>}
        {hasKey && (
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
        )}

        {hasKey && (
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
                <Button
                  icon="lock"
                  onClick={() => props.onRoute({ name: 'tools', tool: 'encrypt' })}
                >
                  {t('keys_encryptTo')}
                </Button>
              )}
            </div>
          </Section>
        )}

        {hasKey && key.value !== undefined && (
          <CopyBox label={t('keys_publicPgp')} text={key.value.pem} fileName={key.value.fileName} />
        )}
        {hasKey && key.error !== undefined && <Notice kind="error">{key.error}</Notice>}

        <FieldsSection item={{ kind: 'contact', id: item.id }} fields={item.fields} />
        <LinksSection
          item={{ kind: 'contact', id: item.id }}
          onChanged={() => void data.reload()}
        />

        <Section title={t('keys_detailsTitle')}>
          <form
            class="stack-12 keys-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!changed) return
              const problem = !emailOk(details.email) ? t('extras_emailBad') : extras.problem
              if (problem !== undefined) {
                say(problem)
                return
              }
              // Only what changed goes, so a member left alone is never rewritten
              void run(
                () =>
                  ask('saveContact', {
                    id: item.id,
                    ...(same('name') || details.name.trim() === ''
                      ? {}
                      : { name: details.name.trim() }),
                    ...(same('company') ? {} : { company: details.company.trim() }),
                    ...(same('email') ? {} : { email: details.email.trim() }),
                    ...(same('phone') ? {} : { phone: details.phone.trim() }),
                    ...(same('address') ? {} : { address: details.address.trim() }),
                    ...(same('note') ? {} : { note: details.note.trim() }),
                    ...extras.members(),
                  }),
                t('keys_saveDone'),
              )
            }}
          >
            <DetailFields value={details} onChange={setDetails} />
            <FieldsEditor {...extras.fieldsProps} />
            <LinkPicker {...extras.linkProps} />
            <div class="actions">
              <Button
                kind="primary"
                type="submit"
                busy={busy}
                disabled={!changed || extras.loading}
              >
                {t('popup_save')}
              </Button>
            </div>
          </form>
        </Section>
      </div>
    </div>
  )
}
