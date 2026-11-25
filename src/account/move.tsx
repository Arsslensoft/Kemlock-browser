// Moving a vault off Vaultwarden or WebDAV into Kemlock Server (move-off-vaultwarden-sync, as the phone runs it): the old store's last run,
// the copy that creates only what is absent, the check that reads everything back, and the old store. It runs once, resumes where it
// stopped, and is refused while another device's move is half done. A sign-in to Kemlock Server from a vault on the old store begins it
// (setup shows what moves and what stays first); this panel follows it, and goes on with one that stopped.
import { Button, Group, Notice, Section } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { moveFraction, moveStepNumber, moveSteps } from './model'
import { movedCount, problemName, useMove } from './move-run'

/** The setup tab, at the step that picks where the browser syncs. */
export function openSetup(step: 'again' | 'signin'): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`src/setup/index.html#${step}`) })
}

export function MovePanel() {
  const move = useMove()
  const status = move.status

  return (
    <Section title={t('account_move_title')}>
      <p class="lead">{t('account_move_lead')}</p>
      {move.error !== null ? <Notice kind="error">{move.error}</Notice> : null}
      {status === undefined ? (
        <p class="muted" role="status">
          {t('account_loading')}
        </p>
      ) : status.running ? (
        <Group pad>
          <p role="status" aria-live="polite">
            {t(
              'account_move_running',
              moveStepNumber(status.step),
              moveSteps.length,
              t(`account_move_step_${status.step ?? 'sync'}`),
            )}
          </p>
          <progress
            max={1}
            value={moveFraction(status) ?? undefined}
            aria-label={t('account_move_progress')}
          />
          <p class="muted small">{t('account_move_wait')}</p>
        </Group>
      ) : status.finished ? (
        <Group pad>
          <Notice kind="ok">
            <strong>{t('account_move_done')}</strong>
            <p>{t('account_move_doneCount', movedCount(status.result))}</p>
            {status.result?.oldStore !== undefined ? (
              <p>{t(`account_move_old_${status.result.oldStore}`)}</p>
            ) : null}
          </Notice>
        </Group>
      ) : (
        <Group pad>
          {status.problem !== undefined ? (
            <Notice kind="warn">{t(`account_move_problem_${problemName(status.problem)}`)}</Notice>
          ) : null}
          {status.held ? (
            <>
              <p>{t('account_move_held')}</p>
              <div class="actions start">
                <Button kind="primary" onClick={() => openSetup('again')}>
                  {t('account_move_continue')}
                </Button>
                <Button disabled={move.busy} onClick={() => void move.cancel()}>
                  {t('account_move_cancel')}
                </Button>
              </div>
            </>
          ) : status.offered && status.step !== undefined ? (
            <>
              <p>{t('account_move_stopped', t(`account_move_step_${status.step}`))}</p>
              <div class="actions start">
                {status.problem === 'removals' ? (
                  <>
                    <Button kind="primary" busy={move.busy} onClick={() => void move.start('keep')}>
                      {t('account_move_keep')}
                    </Button>
                    <Button
                      kind="danger"
                      disabled={move.busy}
                      onClick={() => void move.start('remove')}
                    >
                      {t('account_move_remove')}
                    </Button>
                  </>
                ) : (
                  <Button kind="primary" busy={move.busy} onClick={() => void move.start()}>
                    {t('account_move_retry')}
                  </Button>
                )}
                <Button disabled={move.busy} onClick={() => void move.cancel()}>
                  {t('account_move_abandon')}
                </Button>
              </div>
            </>
          ) : status.offered ? (
            <>
              <p>
                {t(
                  status.source === 'webdav'
                    ? 'account_move_offeredWebdav'
                    : 'account_move_offeredVaultwarden',
                )}
              </p>
              <div class="actions start">
                <Button kind="primary" onClick={() => openSetup('again')}>
                  {t('account_move_signIn')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>{t('account_move_nothing')}</p>
              <div class="actions start">
                <Button onClick={() => openSetup('again')}>{t('account_move_setUp')}</Button>
              </div>
            </>
          )}
        </Group>
      )}
    </Section>
  )
}
