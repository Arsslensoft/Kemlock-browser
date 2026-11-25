// First contact with a space (docs/plans/add-spaces.md): before a space holds anything here, or an invitation is accepted, the person
// compares the fingerprint of the one who invited or confirmed them with what that person's own Kemlock shows. A consistent chain
// proves nothing about people: a server could make a whole space of its own. Nothing is stored until the digits match.
import { useState } from 'preact/hooks'
import type { SpaceContactView } from '../shared/spaces-api'
import { Button, Group, Notice, PageHeader, useLoad } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { ask } from './send'
import { digitRows, spaceError } from './spaces-ui'

/** The 12 groups of 5 digits as three or four rows, set in the mono face so they are read and compared group by group. */
export function Digits(props: { digits: string; label: string }) {
  return (
    <div class="digits mono" role="group" aria-label={props.label}>
      {digitRows(props.digits).map((row, index) => (
        <div key={index} class="digits-row">
          {row.map((group, at) => (
            <span key={at}>{group}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

export function SpaceContact(props: { id: string; onBack: () => void; onDone: () => void }) {
  const [person, setPerson] = useState<string | undefined>()
  const loaded = useLoad<SpaceContactView>(async () => {
    try {
      return await ask('spaceContact', {
        id: props.id,
        ...(person === undefined ? {} : { person }),
      })
    } catch (error) {
      throw new Error(spaceError(error), { cause: error })
    }
  }, [props.id, person])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [trusted, setTrusted] = useState(false)
  const [refused, setRefused] = useState(false)
  const [answered, setAnswered] = useState(false)
  const own = useLoad(() => ask('ownFingerprint').catch(() => null), [answered])
  const view = loaded.value

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await work()
    } catch (failure) {
      setError(spaceError(failure))
    } finally {
      setBusy(false)
    }
  }

  const title = view?.name ?? t('spaces_title')
  const matches = () =>
    run(async () => {
      await ask('spaceTrust', {
        id: props.id,
        ...(person === undefined ? {} : { person }),
        ...(view?.digits === undefined ? {} : { digits: view.digits }),
      })
      setTrusted(true)
      // A space that was only to be opened is done; an invitation goes on to its answer
      if (view?.invited !== true) props.onDone()
    })
  const answer = (accept: boolean) =>
    run(async () => {
      await ask('spaceAnswer', { id: props.id, accept })
      if (accept) setAnswered(true)
      else props.onDone()
    })

  const who = view?.personName ?? view?.person ?? ''
  return (
    <div class="screen">
      <PageHeader title={title} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        {loaded.error !== undefined && <Notice kind="error">{loaded.error}</Notice>}
        {view === undefined && loaded.error === undefined && (
          <p class="muted" role="status">
            {t('popup_loading')}
          </p>
        )}
        {error !== undefined && <Notice kind="error">{error}</Notice>}
        {view?.ownKeyMismatch === true && <Notice kind="error">{t('spaces_ownKey')}</Notice>}
        {view !== undefined && view.ownKeyMismatch !== true && !answered && (
          <>
            <p>
              {view.invited
                ? t('spaces_inviteIntro', view.name, view.members)
                : t('spaces_compareIntro', view.name)}
            </p>
            {view.accountRecovery && <Notice kind="warn">{t('spaces_recoveryNotice')}</Notice>}
            {view.kind === 'pickOwner' && (
              <Group pad>
                <p>{t('spaces_pickOwner')}</p>
                <ul class="list">
                  {view.candidates.map((candidate) => (
                    <li key={candidate.id} class="item">
                      <button
                        type="button"
                        class="item-main hov"
                        onClick={() => setPerson(candidate.id)}
                      >
                        <span class="grow ellipsis mono">{candidate.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            {view.kind === 'compare' && view.digits !== undefined && !trusted && !refused && (
              <Group pad>
                <p>{t('spaces_compareWith', who)}</p>
                <Digits digits={view.digits} label={t('spaces_digitsOf', who)} />
                {!view.bundleSigned && <Notice kind="warn">{t('spaces_notSigned')}</Notice>}
                <div class="actions">
                  <Button onClick={() => setRefused(true)}>{t('spaces_noMatch')}</Button>
                  <Button
                    kind="primary"
                    busy={busy}
                    disabled={!view.bundleSigned}
                    onClick={() => void matches()}
                  >
                    {t('spaces_itMatches')}
                  </Button>
                </div>
              </Group>
            )}
            {refused && <Notice kind="error">{t('spaces_differ')}</Notice>}
            {(view.kind === 'creator' || view.kind === 'vouched') && !trusted && (
              <Group pad>
                <p>{t('spaces_nothingToCompare')}</p>
                <div class="actions">
                  <Button kind="primary" busy={busy} onClick={() => void matches()}>
                    {t('spaces_open')}
                  </Button>
                </div>
              </Group>
            )}
            {view.invited && (
              <div class="actions">
                <Button busy={busy} onClick={() => void answer(false)}>
                  {t('spaces_decline')}
                </Button>
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={!trusted}
                  onClick={() => void answer(true)}
                >
                  {t('spaces_accept')}
                </Button>
              </div>
            )}
          </>
        )}
        {answered && (
          <>
            <Notice kind="ok">{t('spaces_waiting')}</Notice>
            {own.value != null && <Digits digits={own.value} label={t('spaces_yourDigits')} />}
            <div class="actions">
              <Button kind="primary" onClick={props.onDone}>
                {t('spaces_done')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
