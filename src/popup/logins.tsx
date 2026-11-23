// A login on show: its row with health badges, and its password line (dots until shown).
import { useEffect, useState } from 'preact/hooks'
import type { LoginView } from '../shared/api'
import { Badge, Button, IconButton, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { useCopy } from './copy'
import { hostOf, healthTags, type HealthTag } from './format'
import { ask } from './send'

const tagKinds: Record<HealthTag, 'warn' | 'danger' | 'neutral'> = {
  breached: 'danger',
  reused: 'warn',
  weak: 'warn',
  withoutItsCode: 'neutral',
}

const tagText: Record<HealthTag, string> = {
  breached: 'popup_tagBreached',
  reused: 'popup_tagReused',
  weak: 'popup_tagWeak',
  withoutItsCode: 'popup_tagWithoutCode',
}

export function HealthBadges(props: { login: LoginView; breachedOn: boolean }) {
  const tags = healthTags(props.login, props.breachedOn)
  if (tags.length === 0) return null
  return (
    <>
      {tags.map((tag) => (
        <Badge key={tag} kind={tagKinds[tag]}>
          {t(tagText[tag])}
        </Badge>
      ))}
    </>
  )
}

/**
 * A login's row. Clicking it copies its password; its arrow opens its page. The password never
 * reaches this list: the background copies it.
 */
export function LoginRow(props: {
  login: LoginView
  breachedOn: boolean
  onOpen: (id: string) => void
}) {
  const { login } = props
  const copy = useCopy()
  const site = login.websites[0] === undefined ? '' : hostOf(login.websites[0])
  const detail = [login.username, site].filter((part) => part !== '').join(' · ')
  return (
    <li class="item login-item">
      <button
        type="button"
        class="item-main"
        aria-label={t('popup_copyPasswordOf', login.name)}
        title={t('popup_copyPasswordOf', login.name)}
        disabled={!login.hasPassword}
        onClick={() => void copy('password', login.id)}
      >
        <span class="avatar" aria-hidden="true">
          {login.name.slice(0, 1).toUpperCase()}
        </span>
        <span class="grow">
          <span class="strong ellipsis">{login.name}</span>
          {detail !== '' && <span class="muted small ellipsis">{detail}</span>}
          {healthTags(login, props.breachedOn).length > 0 && (
            <span class="chips">
              <HealthBadges login={login} breachedOn={props.breachedOn} />
            </span>
          )}
        </span>
      </button>
      <IconButton
        icon="chevron"
        label={t('popup_openLogin', login.name)}
        onClick={() => props.onOpen(login.id)}
      />
    </li>
  )
}

/** A password as dots, with Show (asks the background, which may ask for the vault password) and Copy. */
export function PasswordLine(props: { login: LoginView }) {
  const { login } = props
  const copy = useCopy()
  const say = useToast()
  const [shown, setShown] = useState<string | null>(null)

  // A shown password hides again after half a minute, and when the page goes.
  useEffect(() => {
    if (shown === null) return
    const timer = setTimeout(() => setShown(null), 30_000)
    return () => clearTimeout(timer)
  }, [shown])

  if (!login.hasPassword) return <span class="muted">{t('popup_noPassword')}</span>

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
    <div class="row password-line">
      {shown === null ? (
        <span class="mono grow secret">
          <span aria-hidden="true">••••••••••</span>
          <span class="visually-hidden">{t('popup_passwordHidden')}</span>
        </span>
      ) : (
        <span class="mono grow secret revealed">{shown}</span>
      )}
      <Button
        label={t(shown === null ? 'popup_showPasswordOf' : 'popup_hidePasswordOf', login.name)}
        onClick={() => void toggle()}
      >
        {t(shown === null ? 'popup_show' : 'popup_hide')}
      </Button>
      <IconButton
        icon="copy"
        label={t('popup_copyPasswordOf', login.name)}
        onClick={() => void copy('password', login.id)}
      />
    </div>
  )
}
