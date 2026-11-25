// The Recovery Kit (docs/crypto.md, "The Recovery Kit"): three pieces, any two of which open the account without its password. The core
// makes the kit and holds it; its pieces are shown once, and the server is given its record only after one piece is typed back. A kit
// is printed from this tab: the sheet below is hidden on the screen and is all that prints.
import { useState } from 'preact/hooks'
import {
  Badge,
  Button,
  Group,
  Notice,
  Section,
  TextField,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { described } from './errors'
import { dateOf } from './format'
import { displayPiece, isOneOf } from './model'
import { ProofField } from './proof'
import { account, AccountError } from './send'
import { useRunner } from './use'

type Stage =
  { name: 'idle' } | { name: 'made'; kitId: string; pieces: string[] } | { name: 'removing' }

export function RecoveryPanel() {
  const say = useToast()
  const record = useLoad(async () => (await described(account('recoveryKit'))).kit)
  const runner = useRunner()
  const [stage, setStage] = useState<Stage>({ name: 'idle' })
  const [typed, setTyped] = useState('')
  const [proof, setProof] = useState('')
  const kit = record.value

  const make = () =>
    void runner.run(async () => {
      const made = await account('kitMake')
      setTyped('')
      setProof('')
      setStage({ name: 'made', kitId: made.kitId, pieces: made.pieces })
    })

  const cancel = () =>
    void runner.run(async () => {
      await account('kitCancel')
      setStage({ name: 'idle' })
    })

  const keep = (pieces: string[]) =>
    void runner.run(async () => {
      if (!isOneOf(typed, pieces)) {
        // The core checks again; this is the answer before a request is sent
        throw new AccountError('pieceMismatch')
      }
      await account('kitKeep', {
        piece: typed,
        ...(proof.trim() === '' ? {} : { proof: proof.trim() }),
      })
      setStage({ name: 'idle' })
      setTyped('')
      setProof('')
      say(t('account_recovery_kept'))
      await record.reload()
    })

  const remove = () =>
    void runner.run(async () => {
      await account('kitRemove', { proof: proof.trim() })
      setStage({ name: 'idle' })
      setProof('')
      say(t('account_recovery_removed'))
      await record.reload()
    })

  return (
    <Section title={t('account_recovery_title')}>
      <p class="lead">{t('account_recovery_lead')}</p>
      {record.error !== undefined ? <Notice kind="error">{record.error}</Notice> : null}
      {runner.error !== null ? <Notice kind="error">{runner.error}</Notice> : null}

      {stage.name === 'made' ? (
        <>
          <Notice kind="warn">{t('account_recovery_once')}</Notice>
          <Group pad class="kit-sheet">
            <h3 class="subtitle">{t('account_recovery_sheetTitle', stage.kitId)}</h3>
            <p class="muted small">{t('account_recovery_sheetLead')}</p>
            <ol class="pieces">
              {stage.pieces.map((piece, index) => (
                <li key={piece}>
                  <span class="piece-n">{t('account_recovery_piece', index + 1)}</span>
                  <code class="mono piece">{displayPiece(piece)}</code>
                </li>
              ))}
            </ol>
          </Group>
          <div class="actions start no-print">
            <Button icon="copy" onClick={() => window.print()}>
              {t('account_recovery_print')}
            </Button>
          </div>
          <form
            class="stack-12 no-print"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              if (!runner.busy && typed.trim() !== '') keep(stage.pieces)
            }}
          >
            <TextField
              label={t('account_recovery_typeBack')}
              value={typed}
              onInput={setTyped}
              hint={t('account_recovery_typeBackHint')}
              mono
              multiline
            />
            {kit !== null && kit !== undefined ? (
              <>
                <p class="muted small">{t('account_recovery_replaceNote')}</p>
                <ProofField value={proof} onInput={setProof} />
              </>
            ) : null}
            <div class="actions start">
              <Button
                type="submit"
                kind="primary"
                busy={runner.busy}
                disabled={
                  typed.trim() === '' || (kit !== null && kit !== undefined && proof.trim() === '')
                }
              >
                {t('account_recovery_keep')}
              </Button>
              <Button disabled={runner.busy} onClick={cancel}>
                {t('account_cancel')}
              </Button>
            </div>
          </form>
        </>
      ) : (
        <Group pad>
          {kit === undefined ? (
            record.loading ? (
              <p class="muted" role="status">
                {t('account_loading')}
              </p>
            ) : null
          ) : kit === null ? (
            <>
              <p>{t('account_recovery_none')}</p>
              <div class="actions start">
                <Button kind="primary" busy={runner.busy} onClick={make}>
                  {t('account_recovery_make')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div class="row names">
                <span class="strong">{t('account_recovery_have', kit.kitId)}</span>
                {kit.current ? (
                  <Badge kind="accent">{t('account_recovery_current')}</Badge>
                ) : (
                  <Badge kind="warn">{t('account_recovery_stale')}</Badge>
                )}
              </div>
              <p class="muted small">
                {t('account_recovery_made', dateOf(kit.createdAt), kit.threshold, kit.shares)}
              </p>
              {kit.current ? null : <Notice kind="warn">{t('account_recovery_staleNote')}</Notice>}
              <div class="actions start">
                <Button busy={runner.busy} onClick={make}>
                  {t('account_recovery_replace')}
                </Button>
                <Button
                  kind="danger"
                  disabled={runner.busy}
                  onClick={() => setStage({ name: 'removing' })}
                >
                  {t('account_recovery_remove')}
                </Button>
              </div>
            </>
          )}
        </Group>
      )}

      {stage.name === 'removing' ? (
        <Group pad>
          <p>{t('account_recovery_removeBody')}</p>
          <ProofField value={proof} onInput={setProof} />
          <div class="actions start">
            <Button
              kind="danger"
              busy={runner.busy}
              disabled={proof.trim() === ''}
              onClick={remove}
            >
              {t('account_recovery_remove')}
            </Button>
            <Button disabled={runner.busy} onClick={() => setStage({ name: 'idle' })}>
              {t('account_cancel')}
            </Button>
          </div>
        </Group>
      ) : null}
    </Section>
  )
}
