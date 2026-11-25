// Import: choose a file or pictures of QR codes, open it (with its password when it has one), review what it holds against the vault,
// and merge it in as the app's import does. A file's items stay in the core: this page gets names, counts and reasons.
import { useEffect, useRef, useState } from 'preact/hooks'
import type {
  TransferOpened,
  TransferOptions,
  TransferPlan,
  TransferPreview,
  TransferResult,
} from '../shared/transfer'
import { transferKinds } from '../shared/transfer'
import { Badge, Button, Group, Notice, Section, Switch, TextField } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import {
  maxFileBytes,
  maxImageBytes,
  maxImages,
  maxImagesBytes,
  readBase64,
  readDataUrl,
} from './files'
import { ask, AskError } from './send'
import { errorLine, formatLabel, kindLabel, tCount } from './text'

type Step =
  | { name: 'choose' }
  | { name: 'password'; opened: TransferOpened; source: string }
  | { name: 'review'; opened: TransferOpened; preview: TransferPreview; source: string }
  | { name: 'done'; result: TransferResult }

/** The most skipped items listed by name before "and more". */
const listedSkips = 8

const isImage = (file: File) => file.type.startsWith('image/')

export function ImportPanel(props: { onLocked: () => void; onApplied: () => void }) {
  const [step, setStep] = useState<Step>({ name: 'choose' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [password, setPassword] = useState('')
  // "Use a Recovery Kit instead": two of the kit's pieces, typed here and sent to the core, which puts them together; never kept
  const [kitMode, setKitMode] = useState(false)
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [excluded, setExcluded] = useState<string[]>([])
  const [keepChecks, setKeepChecks] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [plan, setPlan] = useState<TransferPlan | undefined>()
  const [dragging, setDragging] = useState(false)
  const token = useRef<string | undefined>(undefined)
  const planned = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const fail = (failure: unknown) => {
    if (failure instanceof AskError && failure.code === 'locked') props.onLocked()
    else setError(errorLine(failure))
  }

  const options = (): TransferOptions => ({
    mode,
    excluded,
    keepChecks,
  })

  // What the file would add, again each time a choice changes: the newest answer wins
  useEffect(() => {
    if (step.name !== 'review') return
    const mine = ++planned.current
    ask('transferPlan', { token: step.opened.token, options: options() }).then(
      (next) => {
        if (mine === planned.current) setPlan(next)
      },
      (failure) => {
        if (mine === planned.current) fail(failure)
      },
    )
    // `options()` reads exactly the values listed here.
  }, [step.name, mode, excluded.join('\u0000'), keepChecks])

  // The file is forgotten when the tab goes: it was held only for this
  useEffect(
    () => () => {
      const held = token.current
      if (held !== undefined) void ask('transferCancel', { token: held }).catch(() => undefined)
    },
    [],
  )

  const reset = () => {
    const held = token.current
    token.current = undefined
    if (held !== undefined) void ask('transferCancel', { token: held }).catch(() => undefined)
    planned.current++
    setStep({ name: 'choose' })
    setError(undefined)
    setPassword('')
    setKitMode(false)
    setFirst('')
    setSecond('')
    setMode('merge')
    setExcluded([])
    setKeepChecks(false)
    setUnderstood(false)
    setPlan(undefined)
  }

  const read = async (opened: TransferOpened, source: string, secret?: string) => {
    setBusy(true)
    setError(undefined)
    token.current = opened.token
    try {
      const preview = await ask('transferPreview', {
        token: opened.token,
        ...(secret === undefined || secret === '' ? {} : { password: secret }),
      })
      setPassword('')
      setPlan(undefined)
      setStep({ name: 'review', opened, preview, source })
    } catch (failure) {
      // A wrong password leaves the file open for another try
      if (failure instanceof AskError && failure.code === 'importBadPassword') {
        setStep({ name: 'password', opened, source })
        setError(errorLine(failure))
      } else {
        reset()
        fail(failure)
      }
    } finally {
      setBusy(false)
    }
  }

  /** The encrypted export opened with two pieces of its vault's Recovery Kit instead of its password. */
  const readKit = async (opened: TransferOpened, source: string) => {
    setBusy(true)
    setError(undefined)
    token.current = opened.token
    try {
      const preview = await ask('transferPreviewKit', {
        token: opened.token,
        pieces: [first.trim(), second.trim()],
      })
      setFirst('')
      setSecond('')
      setKitMode(false)
      setPlan(undefined)
      setStep({ name: 'review', opened, preview, source })
    } catch (failure) {
      // A piece that is wrong, or pieces that open nothing, leave the file open for another try
      if (failure instanceof AskError && failure.code.startsWith('importKit')) {
        setError(errorLine(failure))
      } else if (failure instanceof AskError && failure.code === 'importNoKit') {
        // This file has no kit: only its password opens it
        setKitMode(false)
        setFirst('')
        setSecond('')
        setError(errorLine(failure))
      } else {
        reset()
        fail(failure)
      }
    } finally {
      setBusy(false)
    }
  }

  const afterOpen = async (value: TransferOpened, source: string) => {
    token.current = value.token
    if (value.encrypted) setStep({ name: 'password', opened: value, source })
    else await read(value, source)
  }

  const chooseFile = async (file: File) => {
    if (file.size > maxFileBytes) return setError(t('transfer_error_fileTooLarge'))
    setBusy(true)
    setError(undefined)
    try {
      await afterOpen(await ask('transferOpen', { data: await readBase64(file) }), file.name)
    } catch (failure) {
      fail(failure)
    } finally {
      setBusy(false)
    }
  }

  const chooseImages = async (files: File[]) => {
    const total = files.reduce((sum, file) => sum + file.size, 0)
    if (
      files.length > maxImages ||
      total > maxImagesBytes ||
      files.some((file) => file.size > maxImageBytes)
    )
      return setError(t('transfer_error_imagesTooLarge'))
    setBusy(true)
    setError(undefined)
    try {
      const images = await Promise.all(files.map((file) => readDataUrl(file)))
      const value = await ask('transferOpenQr', { images })
      await afterOpen(value, tCount('transfer_source_images', files.length))
    } catch (failure) {
      fail(failure instanceof AskError ? failure : new AskError('unreadable'))
    } finally {
      setBusy(false)
    }
  }

  const choose = (files: File[]) => {
    if (files.length === 0) return
    if (files.every(isImage)) void chooseImages(files)
    else if (files.length === 1) void chooseFile(files[0]!)
    else setError(t('transfer_error_oneFile'))
  }

  // A picture pasted into the page is read as a QR code, as a screenshot of one is
  useEffect(() => {
    if (step.name !== 'choose') return
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter(isImage)
      if (files.length > 0) {
        event.preventDefault()
        choose(files)
      }
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [step.name])

  const apply = async () => {
    if (step.name !== 'review') return
    setBusy(true)
    setError(undefined)
    try {
      const result = await ask('transferApply', { token: step.opened.token, options: options() })
      token.current = undefined
      setStep({ name: 'done', result })
      // What the vault holds has changed, and so has what an export would hold
      props.onApplied()
    } catch (failure) {
      fail(failure)
    } finally {
      setBusy(false)
    }
  }

  const unlock = (event: Event) => {
    event.preventDefault()
    if (step.name !== 'password') return
    if (kitMode) {
      if (first.trim() !== '' && second.trim() !== '') void readKit(step.opened, step.source)
    } else if (password !== '') void read(step.opened, step.source, password)
  }

  return (
    <div class="stack">
      <p class="muted">{t('transfer_import_body')}</p>
      {error !== undefined && <Notice kind="error">{error}</Notice>}

      {step.name === 'choose' && (
        <Section title={t('transfer_import_choose')}>
          <div
            class={`card drop${dragging ? ' over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              choose([...(event.dataTransfer?.files ?? [])])
            }}
          >
            <p>{t('transfer_import_drop')}</p>
            <div class="actions start">
              <Button
                kind="primary"
                icon="folder"
                busy={busy}
                onClick={() => fileInput.current?.click()}
              >
                {t('transfer_import_file')}
              </Button>
              <Button icon="scan" busy={busy} onClick={() => imageInput.current?.click()}>
                {t('transfer_import_images')}
              </Button>
            </div>
            <input
              ref={fileInput}
              class="visually-hidden"
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              accept=".json,.csv,.txt,.zip,.cxf,text/plain,text/csv,application/json,application/zip"
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])]
                event.currentTarget.value = ''
                choose(files)
              }}
            />
            <input
              ref={imageInput}
              class="visually-hidden"
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              accept="image/*"
              multiple
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])]
                event.currentTarget.value = ''
                choose(files)
              }}
            />
            <p class="muted small">{t('transfer_import_paste')}</p>
          </div>
          <p class="muted small">{t('transfer_import_formats')}</p>
          <p class="muted small">{t('transfer_import_google')}</p>
        </Section>
      )}

      {step.name === 'password' && !kitMode && (
        <form class="card" onSubmit={unlock}>
          <h2>{t('transfer_password_title')}</h2>
          <p class="muted">
            {t('transfer_password_body', formatLabel(step.opened.format, step.opened.exporter))}
          </p>
          <TextField
            label={t('transfer_password_label')}
            type="password"
            value={password}
            autocomplete="off"
            autofocus
            onInput={setPassword}
          />
          <div class="actions start">
            <Button kind="primary" type="submit" busy={busy} disabled={password === ''}>
              {t('transfer_password_open')}
            </Button>
            {/* Only Kemlock's own encrypted file can carry a kit's wrap: another app's export and the QR codes have none */}
            {step.opened.format === 'kemlock' && (
              <Button
                kind="ghost"
                onClick={() => {
                  setPassword('')
                  setError(undefined)
                  setKitMode(true)
                }}
              >
                {t('transfer_kit_use')}
              </Button>
            )}
            <Button kind="ghost" onClick={reset}>
              {t('transfer_cancel')}
            </Button>
          </div>
        </form>
      )}

      {step.name === 'password' && kitMode && (
        <form class="card" onSubmit={unlock} aria-label={t('transfer_kit_title')}>
          <h2>{t('transfer_kit_title')}</h2>
          <p class="muted">{t('transfer_kit_body')}</p>
          <TextField
            label={t('transfer_kit_first')}
            value={first}
            autocomplete="off"
            autofocus
            onInput={setFirst}
          />
          <TextField
            label={t('transfer_kit_second')}
            value={second}
            autocomplete="off"
            onInput={setSecond}
          />
          <div class="actions start">
            <Button
              kind="primary"
              type="submit"
              busy={busy}
              disabled={first.trim() === '' || second.trim() === ''}
            >
              {t('transfer_kit_open')}
            </Button>
            <Button
              kind="ghost"
              onClick={() => {
                setFirst('')
                setSecond('')
                setError(undefined)
                setKitMode(false)
              }}
            >
              {t('transfer_kit_password')}
            </Button>
            <Button kind="ghost" onClick={reset}>
              {t('transfer_cancel')}
            </Button>
          </div>
        </form>
      )}

      {step.name === 'review' && (
        <Review
          preview={step.preview}
          opened={step.opened}
          source={step.source}
          plan={plan}
          mode={mode}
          excluded={excluded}
          keepChecks={keepChecks}
          understood={understood}
          busy={busy}
          onMode={(next) => {
            setMode(next)
            setUnderstood(false)
          }}
          onExcluded={setExcluded}
          onKeepChecks={setKeepChecks}
          onUnderstood={setUnderstood}
          onApply={() => void apply()}
          onCancel={reset}
        />
      )}

      {step.name === 'done' && <Done result={step.result} onAgain={reset} />}
    </div>
  )
}

function Review(props: {
  preview: TransferPreview
  opened: TransferOpened
  source: string
  plan: TransferPlan | undefined
  mode: 'merge' | 'replace'
  excluded: string[]
  keepChecks: boolean
  understood: boolean
  busy: boolean
  onMode: (mode: 'merge' | 'replace') => void
  onExcluded: (ids: string[]) => void
  onKeepChecks: (on: boolean) => void
  onUnderstood: (on: boolean) => void
  onApply: () => void
  onCancel: () => void
}) {
  const { preview, plan, mode } = props
  const hasCodes = preview.held.codes + preview.held.backupServices > 0
  const replace = mode === 'replace'
  const total =
    plan === undefined ? 0 : transferKinds.reduce((sum, kind) => sum + plan.adding[kind], 0)
  const ready = plan !== undefined && plan.canImport && (!replace || props.understood)
  return (
    <div class="stack">
      <div class="card">
        <div class="row">
          <div class="grow">
            <p class="strong">{props.source}</p>
            <p class="muted small">{formatLabel(preview.format, preview.exporter)}</p>
          </div>
          <Badge kind="accent">
            {t(props.opened.encrypted ? 'transfer_tag_encrypted' : 'transfer_tag_plain')}
          </Badge>
        </div>
        {props.opened.imagesUnread !== undefined && props.opened.imagesUnread > 0 && (
          <Notice kind="warn">{tCount('transfer_unread_images', props.opened.imagesUnread)}</Notice>
        )}
        {!props.opened.encrypted && preview.format !== 'qr' && preview.format !== 'kemlockQr' && (
          <p class="muted small">{t('transfer_review_plainNote')}</p>
        )}
      </div>

      <Section title={t('transfer_review_title')}>
        <Group>
          <table class="counts">
            <caption class="visually-hidden">{t('transfer_review_table')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('transfer_col_kind')}</th>
                <th scope="col" class="num">
                  {t('transfer_col_file')}
                </th>
                <th scope="col" class="num">
                  {t('transfer_col_new')}
                </th>
                <th scope="col" class="num">
                  {t('transfer_col_held')}
                </th>
              </tr>
            </thead>
            <tbody>
              {transferKinds
                .filter((kind) => preview.held[kind] > 0)
                .map((kind) => (
                  <tr key={kind}>
                    <th scope="row">{kindLabel(kind)}</th>
                    <td class="num">{plan?.held[kind] ?? preview.held[kind]}</td>
                    <td class="num strong">{plan === undefined ? '…' : plan.adding[kind]}</td>
                    <td class="num muted">{plan === undefined ? '…' : plan.duplicates[kind]}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Group>
        {plan !== undefined && !plan.canImport && !replace && (
          <Notice kind="info">{t('transfer_review_nothingNew')}</Notice>
        )}
      </Section>

      {preview.samples.length > 0 && (
        <Section title={t('transfer_samples_title')}>
          <Group>
            {preview.samples.map((sample, index) => (
              <div class="row sample" key={`${sample.kind}-${index}`}>
                <span class="grow">
                  <span class="strong">{sample.name}</span>
                  {sample.detail !== '' && <span class="muted"> {sample.detail}</span>}
                </span>
                <Badge>{t(`transfer_sample_${sample.kind}`)}</Badge>
              </div>
            ))}
          </Group>
        </Section>
      )}

      {preview.units.length > 0 && (
        <Section title={t('transfer_units_title')}>
          <p class="muted small">{t('transfer_units_body')}</p>
          <Group>
            {preview.units.map((unit) => (
              <label class="row unit" key={unit.id}>
                <input
                  type="checkbox"
                  checked={!props.excluded.includes(unit.id)}
                  onChange={(event) =>
                    props.onExcluded(
                      event.currentTarget.checked
                        ? props.excluded.filter((id) => id !== unit.id)
                        : [...props.excluded, unit.id],
                    )
                  }
                />
                <span class="grow">
                  <span class="strong">{unit.name}</span>
                  <span class="muted small"> {tCount('transfer_units_count', unit.count)}</span>
                  {unit.shared && <span class="muted small"> {t('transfer_units_shared')}</span>}
                </span>
              </label>
            ))}
          </Group>
        </Section>
      )}

      {hasCodes && (
        <Section title={t('transfer_mode_title')}>
          <fieldset class="kind" aria-label={t('transfer_mode_title')}>
            {(['merge', 'replace'] as const).map((value) => (
              <label key={value} class={mode === value ? 'choice on' : 'choice'}>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === value}
                  onChange={() => props.onMode(value)}
                />
                {t(`transfer_mode_${value}`)}
              </label>
            ))}
          </fieldset>
          {replace && (
            <>
              <Notice kind="warn">{t('transfer_mode_replaceWarning')}</Notice>
              <Switch
                label={t('transfer_mode_understood')}
                checked={props.understood}
                onChange={props.onUnderstood}
              />
            </>
          )}
        </Section>
      )}

      {plan !== undefined && plan.contacts.length > 0 && (
        <Section title={t('transfer_contacts_title')}>
          <Group>
            {plan.contacts.map((contact, index) => (
              <div class="row" key={`${contact.fingerprint ?? contact.name}-${index}`}>
                <span class="grow">
                  <span class="strong">{contact.name}</span>
                  {contact.fingerprint !== undefined && (
                    <span class="mono small muted"> {contact.fingerprint}</span>
                  )}
                </span>
                {contact.checkedInFile && <Badge>{t('transfer_contacts_checked')}</Badge>}
              </div>
            ))}
          </Group>
          {plan.contacts.some((contact) => contact.checkedInFile) && (
            <Switch
              label={t('transfer_contacts_keepChecks')}
              detail={t('transfer_contacts_keepChecksDetail')}
              checked={props.keepChecks}
              onChange={props.onKeepChecks}
            />
          )}
        </Section>
      )}

      <Left preview={preview} archiveFiles={props.opened.archiveFiles} />

      <div class="actions start">
        <Button
          kind={replace ? 'warn' : 'primary'}
          icon="arrowRight"
          busy={props.busy}
          disabled={!ready}
          onClick={props.onApply}
        >
          {replace ? t('transfer_import_replace') : tCount('transfer_import_button', total)}
        </Button>
        <Button kind="ghost" onClick={props.onCancel}>
          {t('transfer_cancel')}
        </Button>
      </div>
    </div>
  )
}

/** What the import leaves out, and why: never silently. */
function Left(props: { preview: TransferPreview; archiveFiles: number }) {
  const { preview } = props
  const cuts = preview.cuts
  const cutLines =
    cuts === undefined
      ? []
      : (['items', 'credentials', 'urls', 'collections', 'values'] as const)
          .filter((name) => cuts[name] > 0)
          .map((name) => tCount(`transfer_cut_${name}`, cuts[name]))
  const listed = preview.skips.slice(0, listedSkips)
  return (
    <>
      {preview.skipped > 0 && (
        <Notice kind="warn">{tCount('transfer_skipped', preview.skipped)}</Notice>
      )}
      {preview.skips.length > 0 && (
        <Section title={tCount('transfer_skips_title', preview.skips.length)}>
          <Group>
            {listed.map((skip, index) => (
              <div class="row" key={`${skip.title}-${index}`}>
                <span class="grow">
                  <span class="strong">{skip.title}</span>
                  <span class="muted small">
                    {' '}
                    {t(`transfer_skip_${skip.reason}`)}
                    {skip.detail !== undefined && skip.detail !== '' ? ` (${skip.detail})` : ''}
                  </span>
                </span>
              </div>
            ))}
            {preview.skips.length > listed.length && (
              <p class="muted small pad">
                {tCount('transfer_skips_more', preview.skips.length - listed.length)}
              </p>
            )}
          </Group>
        </Section>
      )}
      {preview.notices.map((notice, index) => (
        <Notice kind="info" key={`${notice.title}-${index}`}>
          {t(`transfer_notice_${notice.reason}`, notice.title)}
        </Notice>
      ))}
      {cutLines.map((line) => (
        <Notice kind="warn" key={line}>
          {line}
        </Notice>
      ))}
      {preview.spaceItems > 0 && (
        <Notice kind="info">{tCount('transfer_review_spaces', preview.spaceItems)}</Notice>
      )}
      {preview.attachedFiles > 0 && (
        <Notice kind="warn">{tCount('transfer_attached', preview.attachedFiles)}</Notice>
      )}
      {props.archiveFiles > 0 && preview.attachedFiles === 0 && (
        <Notice kind="info">{tCount('transfer_archive', props.archiveFiles)}</Notice>
      )}
    </>
  )
}

function Done(props: { result: TransferResult; onAgain: () => void }) {
  const added = transferKinds.filter((kind) => props.result.added[kind] > 0)
  return (
    <div class="card">
      <Notice kind="ok">
        {t(props.result.replaced ? 'transfer_done_replaced' : 'transfer_done_title')}
      </Notice>
      <Group>
        {added.map((kind) => (
          <div class="row" key={kind}>
            <span class="grow strong">{kindLabel(kind)}</span>
            <span class="mono">{props.result.added[kind]}</span>
          </div>
        ))}
      </Group>
      {props.result.skipped !== undefined && props.result.skipped > 0 && (
        <Notice kind="info">{tCount('transfer_done_skipped', props.result.skipped)}</Notice>
      )}
      <p class="muted small">{t('transfer_done_sync')}</p>
      <div class="actions start">
        <Button onClick={props.onAgain}>{t('transfer_done_again')}</Button>
      </div>
    </div>
  )
}
