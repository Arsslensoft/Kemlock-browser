// Export: the vault as Kemlock's own file (encrypted, as the phone imports it, or plain), as a CSV of logins, as a list of code links,
// as Credential Exchange, or as QR codes drawn on the screen. Every export asks the vault's password again. The text of a file lives
// in this page until the download starts; a plain format asks the person to confirm what it is first, as the app does.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { CxfKind, ExportedFile, ExportInfo, QrExport, TransferKind } from '../shared/transfer'
import { cxfKinds, transferKinds } from '../shared/transfer'
import { Badge, Button, Group, Notice, Section, Switch, TextField } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { download, type Saved } from './files'
import { QrImage } from './qr'
import { ask, AskError } from './send'
import { errorLine, kindLabel, tCount } from './text'

type Choice =
  'encrypted' | 'plain' | 'csv' | 'links' | 'cxf' | 'qrGoogle' | 'qrKemlock' | 'qrKemlockPlain'

/** Each way to export, whether what it writes is readable by anyone who holds it, and whether it is QR codes. */
const choices: readonly { id: Choice; plain: boolean; qr: boolean }[] = [
  { id: 'encrypted', plain: false, qr: false },
  { id: 'plain', plain: true, qr: false },
  { id: 'csv', plain: true, qr: false },
  { id: 'links', plain: true, qr: false },
  { id: 'cxf', plain: true, qr: false },
  { id: 'qrGoogle', plain: true, qr: true },
  { id: 'qrKemlock', plain: false, qr: true },
  { id: 'qrKemlockPlain', plain: true, qr: true },
]

const minPassword = 8
/** How long QR codes stay on the screen, in milliseconds. */
export const qrShownMs = 120_000

type Result =
  | {
      kind: 'file'
      name: string
      counts: ExportedFile['counts']
      leftOut: ExportedFile['leftOut']
      saved: Saved
    }
  | { kind: 'qr'; qr: QrExport; page: number }

/** What an export of [choice] holds, by kind. */
function heldBy(
  choice: Choice,
  info: ExportInfo,
  kinds: CxfKind[],
): Partial<Record<TransferKind, number>> {
  const counts = info.counts
  switch (choice) {
    case 'encrypted':
    case 'plain':
      return counts
    case 'csv':
      return { logins: counts.logins, notes: counts.notes }
    case 'links':
    case 'qrGoogle':
      return { codes: counts.codes }
    case 'cxf': {
      // The Credential Exchange kinds are kinds of item by the same names
      const out: Partial<Record<TransferKind, number>> = {}
      for (const kind of kinds) out[kind] = info.cxf.sendable[kind]
      return out
    }
    case 'qrKemlock':
    case 'qrKemlockPlain':
      return { codes: counts.codes, backupServices: counts.backupServices }
  }
}

export function ExportPanel(props: { info: ExportInfo; onLocked: () => void }) {
  const { info } = props
  const [choice, setChoice] = useState<Choice>('encrypted')
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [again, setAgain] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [kinds, setKinds] = useState<CxfKind[]>(() =>
    cxfKinds.filter((kind) => info.cxf.sendable[kind] > 0),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<Result | undefined>()
  const saved = useRef<Saved | undefined>(undefined)

  // What was saved is forgotten when the tab goes, and the codes leave the screen after a while
  useEffect(
    () => () => {
      saved.current?.revoke()
    },
    [],
  )
  // Each new set of codes (not a turn of its page) has its own two minutes
  const shown = result?.kind === 'qr' ? result.qr : undefined
  useEffect(() => {
    if (shown === undefined) return
    const timer = setTimeout(() => setResult(undefined), qrShownMs)
    return () => clearTimeout(timer)
  }, [shown])

  const current = choices.find((one) => one.id === choice)!
  const encrypts = choice === 'encrypted' || choice === 'qrKemlock'
  const held = heldBy(choice, info, kinds)
  const items = transferKinds.reduce((sum, kind) => sum + (held[kind] ?? 0), 0)
  const mismatch = encrypts && again !== '' && again !== secret
  const ready =
    password !== '' &&
    items > 0 &&
    (!encrypts || (secret.length >= minPassword && secret === again)) &&
    (!current.plain || understood) &&
    (choice !== 'cxf' || kinds.length > 0)

  const pick = (next: Choice) => {
    setChoice(next)
    setUnderstood(false)
    setError(undefined)
    setResult(undefined)
  }

  const forget = () => {
    setPassword('')
    setSecret('')
    setAgain('')
    setUnderstood(false)
  }

  const run = async (event: Event) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(undefined)
    saved.current?.revoke()
    saved.current = undefined
    try {
      if (current.qr) {
        const format =
          choice === 'qrGoogle' ? 'google' : choice === 'qrKemlock' ? 'kemlock' : 'kemlockPlain'
        const qr = await ask('transferExportQr', {
          format,
          password,
          ...(choice === 'qrKemlock' ? { transferPassword: secret } : {}),
        })
        setResult({ kind: 'qr', qr, page: 0 })
      } else {
        const format = choice as 'encrypted' | 'plain' | 'csv' | 'links' | 'cxf'
        const file = await ask('transferExport', {
          format,
          password,
          ...(choice === 'encrypted' ? { exportPassword: secret } : {}),
          ...(choice === 'cxf' ? { kinds } : {}),
        })
        const { text, ...rest } = file
        const kept = download(file.name, file.mime, text)
        saved.current = kept
        setResult({
          kind: 'file',
          name: rest.name,
          counts: rest.counts,
          leftOut: rest.leftOut,
          saved: kept,
        })
      }
      forget()
    } catch (failure) {
      if (failure instanceof AskError && failure.code === 'locked') props.onLocked()
      else {
        setError(errorLine(failure))
        // A wrong password is tried again; what else was typed stays
        setPassword('')
      }
    } finally {
      setBusy(false)
    }
  }

  const nothing = items === 0

  return (
    <form class="stack" onSubmit={(event) => void run(event)}>
      <p class="muted">{t('transfer_export_body')}</p>

      {info.spaceItems > 0 && (
        <Notice kind="info">{tCount('transfer_export_spaces', info.spaceItems)}</Notice>
      )}
      {info.attachedFiles > 0 && (
        <Notice kind="info">{tCount('transfer_export_attached', info.attachedFiles)}</Notice>
      )}

      <Section title={t('transfer_export_format')}>
        <fieldset class="options" aria-label={t('transfer_export_format')}>
          {choices.map((one) => (
            <label key={one.id} class={choice === one.id ? 'option on' : 'option'}>
              <input
                type="radio"
                name="format"
                checked={choice === one.id}
                onChange={() => pick(one.id)}
              />
              <span class="grow">
                <span class="strong">{t(`transfer_export_${one.id}_title`)}</span>
                <span class="muted small">{t(`transfer_export_${one.id}_body`)}</span>
              </span>
              <Badge kind={one.plain ? 'warn' : 'accent'}>
                {t(one.plain ? 'transfer_tag_plain' : 'transfer_tag_encrypted')}
              </Badge>
            </label>
          ))}
        </fieldset>
      </Section>

      {choice === 'cxf' && (
        <Section title={t('transfer_export_cxfKinds')}>
          <Group>
            {cxfKinds.map((kind) => (
              <label class="row unit" key={kind}>
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  disabled={info.cxf.sendable[kind] === 0}
                  onChange={(event) =>
                    setKinds(
                      event.currentTarget.checked
                        ? [...kinds, kind]
                        : kinds.filter((other) => other !== kind),
                    )
                  }
                />
                <span class="grow strong">{kindLabel(kind)}</span>
                <span class="mono muted">{info.cxf.sendable[kind]}</span>
              </label>
            ))}
          </Group>
          {Object.entries(info.cxf.leftOut).map(([reason, count]) => (
            <Notice kind="info" key={reason}>
              {tCount(`transfer_export_cxfLeft_${reason}`, count)}
            </Notice>
          ))}
        </Section>
      )}

      <Section title={t('transfer_export_holds')}>
        {nothing ? (
          <Notice kind="info">{t('transfer_export_nothing')}</Notice>
        ) : (
          <div class="chips">
            {transferKinds
              .filter((kind) => (held[kind] ?? 0) > 0)
              .map((kind) => (
                <span class="chip" key={kind}>
                  {kindLabel(kind)} <span class="mono">{held[kind]}</span>
                </span>
              ))}
          </div>
        )}
        {choice === 'qrGoogle' && <p class="muted small">{t('transfer_export_googleNote')}</p>}
        {(choice === 'qrKemlock' || choice === 'qrKemlockPlain') && (
          <p class="muted small">{t('transfer_export_kemlockQrNote')}</p>
        )}
        {choice === 'csv' && <p class="muted small">{t('transfer_export_csvNote')}</p>}
      </Section>

      {encrypts && (
        <Section title={t('transfer_export_protect')}>
          <Group pad>
            <TextField
              label={t(
                choice === 'qrKemlock'
                  ? 'transfer_export_transferPassword'
                  : 'transfer_export_password',
              )}
              type="password"
              value={secret}
              autocomplete="new-password"
              hint={t('transfer_export_passwordHint')}
              onInput={setSecret}
            />
            <TextField
              label={t('transfer_export_confirm')}
              type="password"
              value={again}
              autocomplete="new-password"
              invalid={mismatch}
              hint={mismatch ? t('transfer_export_mismatch') : undefined}
              onInput={setAgain}
            />
            {secret !== '' && secret.length < minPassword && (
              <p class="muted small">{t('transfer_export_short')}</p>
            )}
          </Group>
        </Section>
      )}

      {current.plain && (
        <Notice kind="warn">
          <span>{t(`transfer_export_${choice}_warning`)}</span>
        </Notice>
      )}
      {current.plain && (
        <Switch
          label={t('transfer_export_understood')}
          checked={understood}
          onChange={setUnderstood}
        />
      )}

      <Section title={t('transfer_export_you')}>
        <Group pad>
          <TextField
            label={t('transfer_export_vaultPassword')}
            type="password"
            value={password}
            autocomplete="current-password"
            hint={t('transfer_export_vaultPasswordHint')}
            onInput={setPassword}
          />
        </Group>
      </Section>

      {error !== undefined && <Notice kind="error">{error}</Notice>}

      <div class="actions start">
        <Button
          kind={current.plain ? 'warn' : 'primary'}
          type="submit"
          icon="arrowRight"
          busy={busy}
          disabled={!ready}
        >
          {t(current.qr ? 'transfer_export_showCodes' : 'transfer_export_button')}
        </Button>
      </div>

      {result?.kind === 'file' && (
        <div class="card">
          <Notice kind="ok">{t('transfer_export_done', result.name)}</Notice>
          <div class="chips">
            {transferKinds
              .filter((kind) => (result.counts[kind] ?? 0) > 0)
              .map((kind) => (
                <span class="chip" key={kind}>
                  {kindLabel(kind)} <span class="mono">{result.counts[kind]}</span>
                </span>
              ))}
          </div>
          {result.leftOut.length > 0 && (
            <Notice kind="info">
              {result.leftOut
                .map((one) =>
                  one.title === ''
                    ? t(`transfer_export_left_${one.reason}`)
                    : `${one.title}: ${t(`transfer_export_left_${one.reason}`)}`,
                )
                .join(' · ')}
            </Notice>
          )}
          <p class="muted small">{t('transfer_export_savedNote')}</p>
          <div class="actions start">
            <Button onClick={() => result.saved.again()}>{t('transfer_export_again')}</Button>
          </div>
        </div>
      )}

      {result?.kind === 'qr' && (
        <QrResult
          result={result}
          onPage={(page) => setResult({ ...result, page })}
          onHide={() => setResult(undefined)}
        />
      )}
    </form>
  )
}

function QrResult(props: {
  result: { kind: 'qr'; qr: QrExport; page: number }
  onPage: (page: number) => void
  onHide: () => void
}) {
  const { qr, page } = props.result
  const total = qr.codes.length
  const code = qr.codes[page]
  return (
    <div class="card" aria-live="polite">
      <Notice kind="warn">{tCount('transfer_qr_shown', total)}</Notice>
      {qr.leftOut.length > 0 && (
        <Notice kind="info">
          {qr.leftOut
            .map((one) => `${one.title}: ${t(`transfer_qr_left_${one.reason}`)}`)
            .join(' · ')}
        </Notice>
      )}
      {code !== undefined ? (
        <div class="qr-frame">
          <QrImage code={code} label={t('transfer_qr_label', page + 1, total)} />
          <p class="mono small">{t('transfer_qr_label', page + 1, total)}</p>
        </div>
      ) : (
        <p class="muted">{t('transfer_qr_none')}</p>
      )}
      <div class="actions start">
        {total > 1 && (
          <>
            <Button disabled={page === 0} onClick={() => props.onPage(page - 1)}>
              {t('transfer_qr_previous')}
            </Button>
            <Button disabled={page >= total - 1} onClick={() => props.onPage(page + 1)}>
              {t('transfer_qr_next')}
            </Button>
          </>
        )}
        <Button kind="ghost" onClick={props.onHide}>
          {t('transfer_qr_hide')}
        </Button>
      </div>
      <p class="muted small">{t('transfer_qr_note')}</p>
    </div>
  )
}
