// A login on show: its row with its health word, and its password line (dots until shown).
import { useEffect, useState } from 'preact/hooks'
import type { LoginView } from '../shared/api'
import { IconButton, Tile, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { useCopy, useFlash } from './copy'
import { hostOf, healthTags, type HealthTag } from './format'
import { ask } from './send'
import { SpaceBadge } from './spaces'

const tagText: Record<HealthTag, string> = {
  breached: 'popup_tagBreached',
  reused: 'popup_tagReused',
  weak: 'popup_tagWeak',
  withoutItsCode: 'popup_tagWithoutCode',
}

/**
 * A login's row. A tap copies its password; its arrow opens its page. The password never reaches
 * this list: the background copies it.
 */
export function LoginRow(props: {
  login: LoginView
  breachedOn: boolean
  onOpen: (id: string) => void
}) {
  const { login } = props
  const copy = useCopy()
  const [copied, flash] = useFlash()
  const site = login.websites[0] === undefined ? '' : hostOf(login.websites[0])
  const detail = [login.username, site].filter((part) => part !== '').join(' · ')
  const tags = healthTags(login, props.breachedOn)
  const first = tags[0]
  return (
    <li class={copied ? 'item copied' : 'item'}>
      <button
        type="button"
        class="item-main hov"
        aria-label={t('popup_copyPasswordOf', login.name)}
        title={t('popup_copyPasswordOf', login.name)}
        disabled={!login.hasPassword || login.space?.passwordHidden === true}
        onClick={() =>
          void copy('password', login.id).then((ok) => {
            if (ok) flash()
          })
        }
      >
        <Tile name={login.name} />
        <span class="grow lines">
          <span class="name ellipsis">{login.name}</span>
          {detail !== '' && <span class="label ellipsis">{detail}</span>}
          <SpaceBadge space={login.space} />
        </span>
        <span class="value">
          <span class="secret-dots" aria-hidden="true">
            ••••••••
          </span>
          <span
            class={
              copied
                ? 'mono sub copied-mark'
                : first !== undefined
                  ? 'mono sub warn-text'
                  : 'mono sub'
            }
          >
            {copied
              ? t('popup_copied')
              : first !== undefined
                ? t(tagText[first])
                : login.codeId !== undefined
                  ? t('popup_withCode')
                  : ''}
          </span>
        </span>
      </button>
      <IconButton
        icon="chevron"
        size={16}
        weight={2}
        label={t('popup_openLogin', login.name)}
        onClick={() => props.onOpen(login.id)}
      />
    </li>
  )
}

/**
 * A password as dots, with Show (asks the background, which may ask for the vault password) and
 * Copy. `inline` is the line of a card, `detail` the one of a login's page.
 */
export function PasswordLine(props: { login: LoginView; variant?: 'inline' | 'detail' }) {
  const { login } = props
  const variant = props.variant ?? 'inline'
  const copy = useCopy()
  const say = useToast()
  const [shown, setShown] = useState<string | null>(null)

  // A shown password hides again after half a minute, and when the page goes.
  useEffect(() => {
    if (shown === null) return
    const timer = setTimeout(() => setShown(null), 30_000)
    return () => clearTimeout(timer)
  }, [shown])

  if (!login.hasPassword)
    return (
      <div class={`password-line ${variant}`}>
        <span class="muted">{t('popup_noPassword')}</span>
      </div>
    )
  // A grant that hides passwords: no Show and no Copy; filling still works (docs/plans/add-spaces.md)
  if (login.space?.passwordHidden === true)
    return (
      <div class={`password-line ${variant}`}>
        <span class="muted">{t('spaces_passwordHidden')}</span>
      </div>
    )

  const toggle = async () => {
    if (shown !== null) {
      setShown(null)
      return
    }
    try {
      setShown(await ask('showPassword', { id: login.id }))
    } catch (error) {
      say(errorMessage(error))
    }
  }

  return (
    <div class={`password-line ${variant}`}>
      {variant === 'inline' ? (
        <span class="lead" aria-hidden="true">
          <Icon name="key" size={16} />
        </span>
      ) : (
        <span class="lead-label">{t('popup_password')}</span>
      )}
      {shown === null ? (
        <span class="mono grow secret">
          <span aria-hidden="true">••••••••••••</span>
          <span class="visually-hidden">{t('popup_passwordHidden')}</span>
        </span>
      ) : (
        <span class="mono grow secret revealed">{shown}</span>
      )}
      <IconButton
        icon={shown === null ? 'eye' : 'eyeOff'}
        size={16}
        label={t(shown === null ? 'popup_showPasswordOf' : 'popup_hidePasswordOf', login.name)}
        onClick={() => void toggle()}
      />
      <IconButton
        icon="copy"
        size={16}
        label={t('popup_copyPasswordOf', login.name)}
        onClick={() => void copy('password', login.id)}
      />
    </div>
  )
}
