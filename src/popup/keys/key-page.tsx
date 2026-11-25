// A key's page: what it is, its public half to copy or save, its private half behind a warning, its name, note and tags,
// and Delete.
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { KeyView } from '../../shared/keys-api'
import { KemlockIcon } from '../../shared/brand/brand'
import {
  Button,
  Confirm,
  Group,
  IconButton,
  Notice,
  Section,
  Switch,
  TextField,
  Tile,
  useLoad,
  useToast,
} from '../../shared/ui/components'
import { formatDate, t } from '../../shared/ui/i18n'
import { ask } from '../send'
import type { KeysData } from './data'
import { keysError } from './data'
import { download } from './files'
import { kindNames, parseTags, standingNames } from './format'
import { CopyBox, Passphrase } from './parts'
import type { KeysRoute } from './route'

/** What to do with the private half once the person has read the warning. */
type Private = 'show' | 'copy' | 'file'

/** The private key as shown, for as long as it is: it hides again after a minute, and when the page goes. */
const shownFor = 60_000

function Detail(props: {
  label: string
  children: ComponentChildren
  trailing?: ComponentChildren
}) {
  return (
    <div class="detail-row">
      <span class="detail-label">{props.label}</span>
      <span class="grow keys-detail">{props.children}</span>
      {props.trailing}
    </div>
  )
}

function PgpDetails(props: { item: KeyView }) {
  const { pgp } = props.item
  if (pgp === undefined) return null
  return (
    <>
      <Detail label={t('keys_userIds')}>
        {pgp.userIds.map((userId) => (
          <span key={userId} class="ellipsis">
            {userId}
          </span>
        ))}
      </Detail>
      {props.item.expires !== undefined && (
        <Detail label={t('keys_expires')}>
          {`${formatDate(props.item.expires)}${
            props.item.standing !== undefined && props.item.standing !== 'ok'
              ? ` · ${t(standingNames[props.item.standing])}`
              : ''
          }`}
        </Detail>
      )}
      {pgp.postQuantum !== undefined && (
        <Detail label={t('keys_postQuantum')}>{pgp.postQuantum}</Detail>
      )}
      {pgp.subkeys.map((subkey) => (
        <Detail key={subkey.fingerprint} label={t('keys_subkey')}>
          <span class="mono ellipsis">{subkey.fingerprint}</span>
          <span class="muted">
            {`${subkey.algorithm} · ${subkey.uses.map((use) => t(`keys_use_${use}`)).join(', ')}${
              subkey.revoked ? ` · ${t('keys_standingRevoked')}` : ''
            }${subkey.expires === undefined ? '' : ` · ${formatDate(subkey.expires)}`}`}
          </span>
        </Detail>
      ))}
    </>
  )
}

/** Saving the private half as a file: the passphrase it is protected with, typed twice, or none by the person's choice. */
function FileExport(props: { item: KeyView; onDone: () => void; onCancel: () => void }) {
  const { item } = props
  const say = useToast()
  const [first, setFirst] = useState('')
  const [again, setAgain] = useState('')
  const [none, setNone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // A PGP key with a passphrase of its own goes out as it came
  const own = item.protected
  const ready = own || none || (first !== '' && first === again)
  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const out = await ask('exportKey', {
        id: item.id,
        purpose: 'file' as const,
        ...(own || none ? {} : { passphrase: first }),
      })
      download(out.fileName, out.text)
      say(t('keys_saved', out.fileName))
      props.onDone()
    } catch (failure) {
      setError(keysError(failure))
      setBusy(false)
    }
  }
  return (
    <form
      class="stack-12 keys-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) void save()
      }}
    >
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      {own ? (
        <Notice>{t('keys_exportOwn')}</Notice>
      ) : (
        <>
          <p class="muted">{t('keys_exportBody')}</p>
          <Passphrase
            label={t('keys_exportPassphrase')}
            value={first}
            onInput={setFirst}
            autofocus
          />
          <Passphrase
            label={t('keys_exportAgain')}
            value={again}
            onInput={setAgain}
            invalid={again !== '' && first !== again}
            hint={again !== '' && first !== again ? t('keys_exportMismatch') : undefined}
          />
          <Switch
            label={t('keys_exportNone')}
            detail={none ? t('keys_exportNoneBody') : undefined}
            checked={none}
            onChange={setNone}
          />
        </>
      )}
      <div class="actions">
        <Button onClick={props.onCancel}>{t('popup_cancel')}</Button>
        <Button kind="primary" type="submit" busy={busy} disabled={!ready}>
          {t('keys_exportButton')}
        </Button>
      </div>
    </form>
  )
}

export function KeyPage(props: {
  id: string
  data: KeysData
  onBack: () => void
  onRoute: (route: KeysRoute) => void
}) {
  const { data } = props
  const item = data.keys.find((candidate) => candidate.id === props.id)
  const say = useToast()
  const publicHalf = useLoad(() => ask('keyPublic', { id: props.id }), [props.id])
  const [asking, setAsking] = useState<Private | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(item?.name ?? '')
  const [note, setNote] = useState(item?.note ?? '')
  const [tags, setTags] = useState(item?.tags.join(', ') ?? '')

  // A key on show hides again after a minute, and when the page goes
  useEffect(() => {
    if (shown === null) return
    const timer = setTimeout(() => setShown(null), shownFor)
    return () => clearTimeout(timer)
  }, [shown])

  if (item === undefined) {
    return (
      <div class="screen">
        <header class="bar">
          <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
          <KemlockIcon size={24} class="mark" />
          <h1>{t('keys_title')}</h1>
        </header>
        <div class="body">
          <Notice>{t('keys_gone')}</Notice>
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

  const proceed = async (what: Private) => {
    setAsking(null)
    if (what === 'file') {
      setExporting(true)
      return
    }
    try {
      if (what === 'show') {
        setShown((await ask('exportKey', { id: item.id, purpose: 'show' })).text)
      } else {
        await ask('copyKey', { id: item.id })
        say(t('keys_privateCopied'))
      }
    } catch (failure) {
      say(keysError(failure))
    }
  }

  const changed =
    name.trim() !== item.name ||
    note.trim() !== (item.note ?? '') ||
    parseTags(tags).join(',') !== item.tags.join(',')
  const hasPrivate = !item.onCard
  const first = publicHalf.value
  const standing = item.standing !== undefined && item.standing !== 'ok' ? item.standing : null

  return (
    <div class="screen">
      <header class="bar login-bar">
        <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
        <KemlockIcon size={24} class="mark" />
        <Tile name={item.name} size={32} />
        <h1 class="login-title">{item.name}</h1>
        <IconButton icon="trash" label={t('keys_deleteKey')} onClick={() => setDeleting(true)} />
      </header>

      {deleting && (
        <div class="login-confirm">
          <Confirm
            title={t('keys_deleteTitle')}
            body={t('keys_deleteBody', item.name)}
            confirmLabel={t('popup_delete')}
            cancelLabel={t('popup_cancel')}
            danger
            busy={busy}
            onCancel={() => setDeleting(false)}
            onConfirm={() =>
              void run(() => ask('deleteKey', { id: item.id })).then((done) => {
                if (done) props.onBack()
                else setDeleting(false)
              })
            }
          />
        </div>
      )}
      {asking !== null && (
        <div class="login-confirm">
          <Confirm
            title={t('keys_privateWarnTitle')}
            body={t('keys_privateWarnBody')}
            confirmLabel={t('keys_privateWarnConfirm')}
            cancelLabel={t('popup_cancel')}
            danger
            onCancel={() => setAsking(null)}
            onConfirm={() => void proceed(asking)}
          />
        </div>
      )}

      <div class="body tight">
        {standing !== null && (
          <Notice kind="warn">
            {item.standing === 'revoked'
              ? t('keys_noticeRevoked')
              : item.standing === 'expired'
                ? t('keys_noticeExpired')
                : t('keys_noticeExpiring')}
          </Notice>
        )}
        <Group>
          <Detail label={t('keys_kind')}>{t(kindNames[item.kind])}</Detail>
          <Detail label={t('keys_algorithm')}>{item.algorithm}</Detail>
          <Detail
            label={t('keys_fingerprint')}
            trailing={
              item.fingerprint === '' ? undefined : (
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
              )
            }
          >
            <span class="mono keys-fingerprint">{item.fingerprint}</span>
          </Detail>
          <PgpDetails item={item} />
          <Detail label={t('keys_added')}>{formatDate(item.addedAt)}</Detail>
          <Detail label={t('keys_origin')}>
            {item.origin === 'generated' ? t('keys_originGenerated') : t('keys_originImported')}
          </Detail>
        </Group>

        {publicHalf.error !== undefined && <Notice kind="error">{publicHalf.error}</Notice>}
        {first?.ssh !== undefined && (
          <CopyBox label={t('keys_publicSsh')} text={first.ssh} fileName={first.sshFile} />
        )}
        {first?.pem !== undefined && (
          <CopyBox
            label={first.pgp ? t('keys_publicPgp') : t('keys_publicPem')}
            text={first.pem}
            fileName={first.pemFile}
          />
        )}

        {item.kind === 'ssh' || (item.kind === 'pgp' && !item.onCard) ? (
          <Section title={t('keys_useTitle')}>
            <div class="keys-actions">
              <Button
                icon="edit"
                onClick={() => props.onRoute({ name: 'tools', tool: 'sign', keyId: item.id })}
              >
                {t('keys_signWith')}
              </Button>
              {item.kind === 'pgp' && (
                <Button
                  icon="lock"
                  onClick={() => props.onRoute({ name: 'tools', tool: 'decrypt', keyId: item.id })}
                >
                  {t('keys_decryptWith')}
                </Button>
              )}
            </div>
          </Section>
        ) : null}

        <Section title={t('keys_privateTitle')}>
          {!hasPrivate ? (
            <Notice>{t('keys_onCard')}</Notice>
          ) : exporting ? (
            <FileExport
              item={item}
              onDone={() => setExporting(false)}
              onCancel={() => setExporting(false)}
            />
          ) : (
            <>
              {shown !== null && (
                <>
                  <CopyBox
                    label={t('keys_privateShown')}
                    text={shown}
                    secret
                    onCopy={() => void proceed('copy')}
                  />
                  <Button icon="eyeOff" onClick={() => setShown(null)}>
                    {t('keys_hide')}
                  </Button>
                </>
              )}
              {shown === null && (
                <div class="keys-actions">
                  <Button icon="eye" onClick={() => setAsking('show')}>
                    {t('keys_privateShow')}
                  </Button>
                  <Button icon="copy" onClick={() => setAsking('copy')}>
                    {t('keys_privateCopy')}
                  </Button>
                  <Button
                    onClick={() => setAsking('file')}
                    disabled={item.inSpace}
                    title={item.inSpace ? t('keys_inSpace') : undefined}
                  >
                    {t('keys_privateSave')}
                  </Button>
                </div>
              )}
              {item.inSpace && <p class="muted">{t('keys_inSpace')}</p>}
            </>
          )}
        </Section>

        <Section title={t('keys_detailsTitle')}>
          <form
            class="stack-12 keys-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!changed) return
              void run(
                () =>
                  ask('saveKey', {
                    id: item.id,
                    name: name.trim() === '' ? item.name : name.trim(),
                    note: note.trim(),
                    tags: parseTags(tags),
                  }),
                t('keys_saveDone'),
              )
            }}
          >
            <TextField label={t('keys_fieldName')} value={name} onInput={setName} />
            <TextField
              label={t('keys_fieldTags')}
              value={tags}
              hint={t('keys_fieldTagsHint')}
              onInput={setTags}
            />
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
