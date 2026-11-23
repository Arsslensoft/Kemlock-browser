// Editing a login in the browser, or starting one from a recently generated password.
import { useEffect, useState } from 'preact/hooks'
import type { LoginInput } from '../shared/api'
import {
  Button,
  IconButton,
  Notice,
  PageHeader,
  SelectField,
  TextField,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { loadChoices, toOptions } from './choices'
import { codeName } from './codes'
import type { Vault } from './data'
import { hostOf } from './format'
import type { Prefill } from './route'
import { ask } from './send'

export function EditLogin(props: {
  /** The login to change, or null for a new one. */
  id: string | null
  prefill?: Prefill
  vault: Vault
  onBack: () => void
  /** After saving: the saved login's id. */
  onSaved: (id: string) => void
}) {
  const { vault } = props
  const login = props.id === null ? undefined : vault.logins.find((item) => item.id === props.id)
  const [name, setName] = useState(login?.name ?? props.prefill?.name ?? '')
  const [username, setUsername] = useState(login?.username ?? '')
  const [password, setPassword] = useState(props.prefill?.password ?? '')
  const [websites, setWebsites] = useState<string[]>(
    login !== undefined && login.websites.length > 0
      ? login.websites
      : props.prefill !== undefined && props.prefill.websites.length > 0
        ? props.prefill.websites
        : [''],
  )
  const [note, setNote] = useState(login?.note ?? '')
  const [codeId, setCodeId] = useState(login?.codeId ?? '')
  const [reveal, setReveal] = useState(false)
  // Saving an unread password would erase it, so an existing login saves only once it is read.
  const [loaded, setLoaded] = useState(login === undefined)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (login === undefined) return
    let alive = true
    ask('showPassword', { id: login.id }).then(
      (current) => {
        if (!alive) return
        setPassword(current)
        setLoaded(true)
      },
      (failure) => alive && setError(errorMessage(failure)),
    )
    return () => {
      alive = false
    }
  }, [login?.id])

  if (props.id !== null && login === undefined) {
    return (
      <div>
        <PageHeader
          title={t('popup_editLogin')}
          onBack={props.onBack}
          backLabel={t('popup_back')}
        />
        <div class="section">
          <Notice>{t('popup_loginGone')}</Notice>
        </div>
      </div>
    )
  }

  const generate = async () => {
    try {
      setPassword(await ask('generate', { options: toOptions(await loadChoices()) }))
      setReveal(true)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  const save = async () => {
    const sites = websites.map((site) => site.trim()).filter((site) => site !== '')
    if (username.trim() === '' && password === '') {
      setError(t('popup_needsSecret'))
      return
    }
    const input: LoginInput = {
      name:
        name.trim() !== ''
          ? name.trim()
          : sites[0] !== undefined
            ? hostOf(sites[0])
            : username.trim(),
      username: username.trim(),
      password,
      websites: sites,
      note: note.trim() === '' ? undefined : note,
      // The vault's tags are shown, never changed: they go back as they came.
      tags: login?.tags,
    }
    setBusy(true)
    setError(undefined)
    try {
      const saved = await ask('saveLogin', { id: props.id, input })
      const before = login?.codeId ?? ''
      if (before !== codeId) {
        if (before !== '') await ask('linkCode', { codeId: before, loginId: null })
        if (codeId !== '') await ask('linkCode', { codeId, loginId: saved.id })
      }
      await vault.reload()
      props.onSaved(saved.id)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  const choices = vault.codes.filter(
    (code) => code.loginId === undefined || code.loginId === login?.id,
  )

  return (
    <div>
      <PageHeader
        title={props.id === null ? t('popup_newLogin') : t('popup_editLogin')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <form
        class="section"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {error !== undefined && <Notice kind="error">{error}</Notice>}
        <TextField label={t('popup_fieldName')} value={name} onInput={setName} />
        {websites.map((site, index) => (
          <div class="row site-field" key={index}>
            <TextField
              class="grow"
              label={t('popup_fieldWebsite')}
              value={site}
              type="url"
              placeholder="example.com"
              onInput={(value) =>
                setWebsites((previous) => previous.map((s, i) => (i === index ? value : s)))
              }
            />
            {websites.length > 1 && (
              <IconButton
                icon="x"
                label={t('popup_removeWebsite', site === '' ? String(index + 1) : hostOf(site))}
                onClick={() => setWebsites((previous) => previous.filter((_, i) => i !== index))}
              />
            )}
          </div>
        ))}
        <div class="actions start">
          <Button icon="plus" onClick={() => setWebsites((previous) => [...previous, ''])}>
            {t('popup_addWebsite')}
          </Button>
        </div>
        <TextField
          label={t('popup_fieldUsername')}
          value={username}
          autocomplete="off"
          onInput={setUsername}
        />
        <div class="row password-edit">
          <TextField
            class="grow"
            label={t('popup_fieldPassword')}
            value={password}
            type={reveal ? 'text' : 'password'}
            autocomplete="new-password"
            readOnly={!loaded}
            onInput={setPassword}
          />
          <IconButton
            icon={reveal ? 'eyeOff' : 'eye'}
            label={reveal ? t('popup_hide') : t('popup_show')}
            pressed={reveal}
            onClick={() => setReveal((value) => !value)}
          />
          <Button disabled={!loaded} onClick={() => void generate()}>
            {t('popup_generate')}
          </Button>
        </div>
        <TextField label={t('popup_fieldNote')} value={note} multiline onInput={setNote} />
        <SelectField
          label={t('popup_twoStepCode')}
          value={codeId}
          options={[
            { value: '', label: t('popup_noCodeLinked') },
            ...choices.map((code) => ({
              value: code.id,
              label: `${codeName(code)} · ${code.account}`,
            })),
          ]}
          onChange={setCodeId}
        />
        <div class="actions">
          <Button onClick={props.onBack}>{t('popup_cancel')}</Button>
          <Button kind="primary" type="submit" busy={busy} disabled={!loaded}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
