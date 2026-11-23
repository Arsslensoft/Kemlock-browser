// The rail beside the card: the stages of setup (four on a first run, three when set up again), the current one open with its
// sub-steps. It shows where you are; the card's own buttons are the only way on or back.
import { parseAddress } from './address'
import type { FlowState, ScreenName } from './flow'
import { t } from './i18n'
import { Glyph } from './icons'

export interface RailSub {
  label: string
  current: boolean
}

export interface RailStage {
  label: string
  /** The number shown (1-based, among the stages listed). */
  number: number
  state: 'done' | 'current' | 'todo'
  subs: RailSub[]
}

/** The stage a screen belongs to (0 password, 1 place, 2 sign-in, 3 first sync), or -1 for the screens apart from the flow. */
export function stageOf(screen: ScreenName): number {
  switch (screen) {
    case 'password':
      return 0
    case 'place':
    case 'address':
    case 'access':
      return 1
    case 'form':
    case 'second':
    case 'approval':
    case 'masterPassword':
      return 2
    case 'homes':
    case 'noHome':
    case 'passphrase':
    case 'firstSync':
      return 3
    default:
      return -1
  }
}

export function railOf(state: FlowState): RailStage[] {
  const place = state.place ?? 'kemlock'
  const screen = state.screen.name
  const stage = stageOf(screen)
  const finished = screen === 'done'
  const parsed = parseAddress(state.address)
  const placeLabel = t(`setup_place_${place}`)
  const folder = place === 'webdav'

  const sub = (name: ScreenName, label: string): RailSub => ({ label, current: screen === name })
  const stages: { id: number; label: string; subs: RailSub[] }[] = [
    { id: 0, label: t('setup_password_title'), subs: [] },
    {
      id: 1,
      label: t('setup_place_title'),
      subs: [
        sub('place', t('setup_place_title')),
        sub(
          'address',
          folder ? t('setup_address_title_folder') : t('setup_address_title', placeLabel),
        ),
        sub('access', parsed.ok ? t('setup_access_title', parsed.host) : t('setup_rail_access')),
      ],
    },
    {
      id: 2,
      label: t(`setup_form_title_${place}`),
      subs: [
        sub('form', t('setup_form_button')),
        ...(folder
          ? []
          : [
              sub('second', t('setup_second_title')),
              sub('approval', t('setup_approval_title')),
              sub('masterPassword', t('setup_master_title')),
            ]),
      ],
    },
    {
      id: 3,
      label: place === 'vaultwarden' ? t('setup_homes_title') : t('setup_first_title'),
      subs:
        place === 'vaultwarden'
          ? [
              sub('homes', t('setup_homes_title')),
              sub('passphrase', t('setup_passphrase_title_home')),
              sub('firstSync', t('setup_first_title')),
            ]
          : [
              // A WebDAV folder's passphrase is asked again only when the one typed with the sign-in was wrong
              ...(folder && screen === 'passphrase'
                ? [sub('passphrase', t('setup_passphrase_title_folder'))]
                : []),
              sub('firstSync', t('setup_first_title')),
            ],
    },
  ]
  const listed = state.mode === 'first' ? stages : stages.slice(1)
  return listed.map((entry, index) => {
    const current = !finished && stage === entry.id
    const done = finished || (stage >= 0 && stage > entry.id)
    return {
      label: entry.label,
      number: index + 1,
      state: current ? 'current' : done ? 'done' : 'todo',
      subs: current ? entry.subs : [],
    }
  })
}

export function Rail({ state }: { state: FlowState }) {
  const stages = railOf(state)
  return (
    <nav aria-label={t('setup_title')}>
      <ol class="rail">
        {stages.map((stage) => (
          <li key={stage.number}>
            <div
              class={`stage ${stage.state}`}
              aria-current={stage.state === 'current' ? 'step' : undefined}
            >
              <span class="dot mono" aria-hidden="true">
                {stage.state === 'done' ? (
                  <Glyph name="check" size={13} weight={3} />
                ) : (
                  stage.number
                )}
              </span>
              <span class="stage-name">{stage.label}</span>
            </div>
            {stage.subs.length > 0 ? (
              <ol class="subs">
                {stage.subs.map((entry) => (
                  <li
                    key={entry.label}
                    class={entry.current ? 'sub current' : 'sub'}
                    aria-current={entry.current ? 'step' : undefined}
                  >
                    {entry.label}
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  )
}
