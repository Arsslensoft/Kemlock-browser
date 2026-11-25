// Backup-code tools, as the app has them: add a service's codes by pasting or typing them, see how many are left and the low
// warning, mark a code used or unused, add more, remove one, change the service's name and note, delete it, and see which
// codes have none saved. The codes themselves stay hidden until shown, and hide again.
import { useEffect, useState } from 'preact/hooks'
import {
  Button,
  Confirm,
  Group,
  LinkButton,
  Notice,
  PageHeader,
  Section,
  TextField,
  useLoad,
  useToast,
} from '../../shared/ui/components'
import { t } from '../../shared/ui/i18n'
import type { Vault } from '../data'
import { isStale, toolsError } from './errors'
import { ask } from '../send'
import type { ToolsRoute } from './routes'

/** The codes a pasted text holds, asked of the core after the person pauses (the rules are the app's). */
function useParsedCodes(text: string): string[] | undefined {
  const [codes, setCodes] = useState<string[] | undefined>(undefined)
  useEffect(() => {
    if (text.trim() === '') {
      setCodes([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      ask('parseBackupCodes', { text })
        .then((parsed) => current && setCodes(parsed))
        .catch(() => current && setCodes(undefined))
    }, 200)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [text])
  return codes
}

/** The codes found in a pasted text, as chips, so what will be saved is seen before it is. */
function Detected(props: { text: string; codes: string[] | undefined }) {
  if (props.text.trim() === '') return null
  // Until the core has answered there is nothing to say
  if (props.codes === undefined) return null
  if (props.codes.length === 0) return <Notice kind="warn">{t('tools_noCodesDetected')}</Notice>
  return (
    <div class="stack">
      <p class="muted small">{t('tools_codesDetected', props.codes.length)}</p>
      <ul class="plain code-chips">
        {props.codes.map((code) => (
          <li key={code} class="mono code-chip">
            {code}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Add a service's backup codes. */
export function AddBackupPage(props: {
  prefill?: string
  vault: Vault
  onBack: () => void
  onDone: () => void
}) {
  const say = useToast()
  const [name, setName] = useState(props.prefill ?? '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const codes = useParsedCodes(text)
  const canSave = name.trim() !== '' && codes !== undefined && codes.length > 0

  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const added = await ask('addBackupService', { name: name.trim(), text })
      await props.vault.reload()
      say(t('tools_backupSaved', added.issuer))
      props.onDone()
    } catch (failure) {
      setError(toolsError(failure))
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t('tools_addBackupTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) void save()
        }}
      >
        <div class="body form-body">
          <p class="note-text">{t('tools_addBackupNote')}</p>
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          <TextField
            label={t('tools_serviceName')}
            value={name}
            placeholder={t('tools_serviceNamePlaceholder')}
            autofocus={props.prefill === undefined}
            onInput={setName}
          />
          <TextField
            label={t('tools_backupCodes')}
            value={text}
            multiline
            mono
            placeholder={t('tools_backupCodesPlaceholder')}
            hint={t('tools_backupCodesHint')}
            onInput={setText}
          />
          <Detected text={text} codes={codes} />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={!canSave}>
            {t('tools_saveCodes', codes?.length ?? 0)}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** One service: its codes, and what can be done with them. */
export function BackupServicePage(props: {
  serviceId: string
  vault: Vault
  onBack: () => void
  onOpenLogin: (id: string) => void
}) {
  const { serviceId, vault } = props
  const say = useToast()
  const detail = useLoad(() => ask('backupDetail', { serviceId }), [serviceId])
  const [shown, setShown] = useState(false)
  const [adding, setAdding] = useState('')
  const [addingOpen, setAddingOpen] = useState(false)
  const [name, setName] = useState<string | undefined>()
  const [note, setNote] = useState<string | undefined>()
  const [asking, setAsking] = useState<'delete' | number | null>(null)
  const [busy, setBusy] = useState(false)
  const parsed = useParsedCodes(adding)

  // The codes hide again after a minute, and when the page goes
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(false), 60_000)
    return () => clearTimeout(timer)
  }, [shown])

  const data = detail.value
  const refresh = async () => {
    await Promise.all([detail.reload(), vault.reload()])
  }
  const run = async (work: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await work()
      await refresh()
      if (done !== undefined) say(done)
      return true
    } catch (error) {
      say(toolsError(error))
      // The list the page shows is not the vault's: show the vault's
      if (isStale(error)) await refresh().catch(() => undefined)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (data === undefined)
    return (
      <div class="screen">
        <PageHeader
          title={t('popup_backupCodes')}
          onBack={props.onBack}
          backLabel={t('popup_back')}
        />
        <div class="body">
          {detail.error !== undefined ? (
            <Notice kind="error">{detail.error}</Notice>
          ) : (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          )}
        </div>
      </div>
    )

  const left = data.codes.filter((code) => !code.used).length
  const nameDraft = name ?? data.name
  const noteDraft = note ?? data.note ?? ''

  return (
    <div class="screen">
      <PageHeader title={data.name} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Group pad>
          <div class="row">
            <span class="grow lines">
              <span class="name">{t('tools_codesLeft', left, data.codes.length)}</span>
              {data.codes.length === 0 && <span class="label">{t('tools_noCodesSaved')}</span>}
            </span>
            <Button
              icon={shown ? 'eyeOff' : 'eye'}
              label={t(shown ? 'tools_hideCodesOf' : 'tools_showCodesOf', data.name)}
              onClick={() => setShown((value) => !value)}
            >
              {t(shown ? 'popup_hide' : 'popup_show')}
            </Button>
          </div>
          {data.low && <Notice kind="warn">{t('tools_lowCodes', data.name)}</Notice>}
          <ul class="plain backup-list">
            {data.codes.map((code, index) => (
              <li key={`${index}:${code.code}`} class="backup-code-row">
                {asking === index ? (
                  <Confirm
                    danger
                    busy={busy}
                    title={t('tools_removeCodeTitle')}
                    confirmLabel={t('tools_removeCode')}
                    cancelLabel={t('popup_cancel')}
                    onCancel={() => setAsking(null)}
                    onConfirm={() =>
                      void run(() =>
                        ask('removeBackupCode', { serviceId, index, code: code.code }),
                      ).then(() => setAsking(null))
                    }
                  />
                ) : (
                  <>
                    <span
                      class={code.used ? 'mono code-text used' : 'mono code-text'}
                      aria-label={
                        shown
                          ? undefined
                          : t(code.used ? 'tools_codeHiddenUsed' : 'tools_codeHidden', index + 1)
                      }
                    >
                      {shown ? code.code : '••••••••••'}
                    </span>
                    <LinkButton
                      label={t(
                        code.used ? 'tools_markUnusedNumber' : 'tools_markUsedNumber',
                        index + 1,
                      )}
                      onClick={() =>
                        void run(() =>
                          ask('setBackupCodeUsed', {
                            serviceId,
                            index,
                            used: !code.used,
                            code: code.code,
                          }),
                        )
                      }
                    >
                      {t(code.used ? 'tools_markUnused' : 'popup_markUsed')}
                    </LinkButton>
                    <LinkButton
                      quiet
                      label={t('tools_removeCodeNumber', index + 1)}
                      onClick={() => setAsking(index)}
                    >
                      {t('tools_removeCode')}
                    </LinkButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Group>

        {addingOpen ? (
          <Section title={t('tools_addMoreCodes')}>
            <Group pad>
              <TextField
                label={t('tools_backupCodes')}
                value={adding}
                multiline
                mono
                autofocus
                placeholder={t('tools_backupCodesPlaceholder')}
                onInput={setAdding}
              />
              <Detected text={adding} codes={parsed} />
              <div class="actions">
                <Button
                  onClick={() => {
                    setAddingOpen(false)
                    setAdding('')
                  }}
                >
                  {t('popup_cancel')}
                </Button>
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={parsed === undefined || parsed.length === 0}
                  onClick={() =>
                    void ask('addBackupCodes', { serviceId, text: adding })
                      .then(async (result) => {
                        await refresh()
                        say(t('tools_codesAdded', result.added, result.duplicates))
                        setAdding('')
                        setAddingOpen(false)
                      })
                      .catch((error) => say(toolsError(error)))
                  }
                >
                  {t('tools_addCodes')}
                </Button>
              </div>
            </Group>
          </Section>
        ) : (
          <div class="actions start">
            <Button icon="plus" onClick={() => setAddingOpen(true)}>
              {t('tools_addMoreCodes')}
            </Button>
          </div>
        )}

        <Section title={t('tools_serviceDetails')}>
          <Group pad>
            <TextField label={t('tools_serviceName')} value={nameDraft} onInput={setName} />
            <TextField
              label={t('popup_fieldNote')}
              value={noteDraft}
              multiline
              placeholder={t('tools_notePlaceholder')}
              onInput={setNote}
            />
            <div class="actions">
              <Button
                kind="primary"
                busy={busy}
                disabled={
                  nameDraft.trim() === '' ||
                  (nameDraft === data.name && noteDraft === (data.note ?? ''))
                }
                onClick={() =>
                  void run(async () => {
                    await ask('editBackupService', {
                      serviceId,
                      name: nameDraft.trim(),
                      ...(noteDraft.trim() === '' ? { clearNote: true } : { note: noteDraft }),
                    })
                    setName(undefined)
                    setNote(undefined)
                  }, t('tools_backupUpdated'))
                }
              >
                {t('popup_save')}
              </Button>
            </div>
          </Group>
        </Section>

        {(data.accounts.length > 0 || data.logins.length > 0) && (
          <Section title={t('tools_usedBy')}>
            <Group>
              {data.accounts.map((account) => (
                <div class="row pad-row" key={account.id}>
                  <span class="grow lines">
                    <span class="name ellipsis">{account.name}</span>
                    <span class="label">{t('tools_aCode')}</span>
                  </span>
                </div>
              ))}
              {data.logins.map((login) => (
                <div class="row pad-row" key={login.id}>
                  <span class="grow lines">
                    <span class="name ellipsis">{login.name}</span>
                    <span class="label">{t('tools_aLogin')}</span>
                  </span>
                  <LinkButton
                    label={t('popup_openLogin', login.name)}
                    onClick={() => props.onOpenLogin(login.id)}
                  >
                    {t('tools_open')}
                  </LinkButton>
                </div>
              ))}
            </Group>
          </Section>
        )}

        {asking === 'delete' ? (
          <Confirm
            danger
            busy={busy}
            title={t('tools_deleteBackupTitle', data.name)}
            body={t('tools_deleteBackupBody', data.codes.length)}
            confirmLabel={t('tools_deleteBackup')}
            cancelLabel={t('popup_cancel')}
            onCancel={() => setAsking(null)}
            onConfirm={() =>
              void ask('deleteBackupService', { serviceId })
                .then(async () => {
                  await vault.reload()
                  say(t('tools_backupDeleted'))
                  props.onBack()
                })
                .catch((error) => {
                  say(toolsError(error))
                  setAsking(null)
                })
            }
          />
        ) : (
          <div class="actions start">
            <Button kind="danger" icon="trash" onClick={() => setAsking('delete')}>
              {t('tools_deleteBackup')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Which codes have their backup codes saved, and the others to add or to leave out. */
export function CoveragePage(props: {
  vault: Vault
  onBack: () => void
  go: (route: ToolsRoute) => void
}) {
  const say = useToast()
  const coverage = useLoad(() => ask('backupCoverage'))
  const data = coverage.value
  return (
    <div class="screen">
      <PageHeader
        title={t('tools_coverageTitle')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        {coverage.error !== undefined && <Notice kind="error">{coverage.error}</Notice>}
        {data !== undefined && (
          <>
            <p class="note-text">{t('tools_coverageNote', data.covered, data.total)}</p>
            {data.missing.length === 0 ? (
              <Notice kind="ok">{t('tools_coverageAll')}</Notice>
            ) : (
              <Group>
                {data.missing.map((code) => (
                  <div class="row pad-row" key={code.id}>
                    <span class="grow lines">
                      <span class="name ellipsis">{code.name}</span>
                      {code.account !== '' && <span class="label ellipsis">{code.account}</span>}
                    </span>
                    <LinkButton
                      label={t('tools_addCodesFor', code.name)}
                      onClick={() => props.go({ name: 'addBackup', prefill: code.name })}
                    >
                      {t('tools_addCodes')}
                    </LinkButton>
                    <LinkButton
                      quiet
                      label={t('tools_givesNoneLabel', code.name)}
                      onClick={() =>
                        void ask('setNoBackupCodes', { codeId: code.id, none: true })
                          .then(async () => {
                            await Promise.all([coverage.reload(), props.vault.reload()])
                          })
                          .catch((error) => say(toolsError(error)))
                      }
                    >
                      {t('tools_givesNone')}
                    </LinkButton>
                  </div>
                ))}
              </Group>
            )}
          </>
        )}
      </div>
    </div>
  )
}
