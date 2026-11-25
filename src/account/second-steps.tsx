// The account's second steps, as far as an extension page can set them up: the authenticator app (a secret to type, confirmed by one of
// its codes), the code mailed to an address, and the recovery code. Security keys, YubiKeys and Duo are the web vault's: a key is made by
// a WebAuthn creation on the server's own address, which an extension page can't do. Beside a step that is on, turning another on or any
// off takes the fresh proof the server asks for.
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
import { anyStepOn, groupSecret, otherStepOn } from './model'
import { ProofField } from './proof'
import { account } from './send'
import { useRunner } from './use'

type Flow = 'totp' | 'email' | 'recovery' | null

export function SecondStepsPanel() {
  const say = useToast()
  const view = useLoad(async () => described(account('twoStep')))
  const runner = useRunner()
  const [flow, setFlow] = useState<Flow>(null)
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [mailed, setMailed] = useState(false)
  const [proof, setProof] = useState('')
  const [shown, setShown] = useState<string | null | undefined>(undefined)
  const v = view.value

  const open = (next: Flow) => {
    setFlow(next)
    setSecret(null)
    setCode('')
    setProof('')
    setMailed(false)
    setShown(undefined)
    runner.clear()
  }
  const proofArg = proof.trim() === '' ? {} : { proof: proof.trim() }
  const done = async (message: string) => {
    open(null)
    say(message)
    await view.reload()
  }

  const beginTotp = () =>
    void runner.run(async () => {
      setSecret(await account('totpBegin'))
    })
  const confirmTotp = () =>
    void runner.run(async () => {
      await account('totpConfirm', { code: code.trim(), ...proofArg })
      await done(t('account_steps_totpOn'))
    })
  const beginEmail = () =>
    void runner.run(async () => {
      await account('emailBegin', { address: address.trim() })
      setMailed(true)
    })
  const confirmEmail = () =>
    void runner.run(async () => {
      await account('emailConfirm', { address: address.trim(), code: code.trim(), ...proofArg })
      await done(t('account_steps_emailOn'))
    })
  const emailOff = () =>
    void runner.run(async () => {
      await account('emailOff', { proof: proof.trim() })
      await done(t('account_steps_emailOff'))
    })
  const showRecovery = () =>
    void runner.run(async () => {
      setShown((await account('recoveryCode', proofArg)).code)
    })

  const methodOn = (name: string) => v?.methods.some((m) => m.method === name && m.enabled) === true
  const needsProof = (method: string) => v !== undefined && otherStepOn(v, method)

  return (
    <Section title={t('account_steps_title')}>
      <p class="lead">{t('account_steps_lead')}</p>
      {view.error !== undefined ? <Notice kind="error">{view.error}</Notice> : null}
      {runner.error !== null ? <Notice kind="error">{runner.error}</Notice> : null}

      <Group>
        <div class="item">
          <div class="grow">
            <div class="row names">
              <span class="strong">{t('account_steps_totp')}</span>
              {methodOn('totp') ? <Badge kind="accent">{t('account_steps_on')}</Badge> : null}
            </div>
            <div class="muted small">{t('account_steps_totpHint')}</div>
          </div>
          {methodOn('totp') ? null : (
            <Button
              disabled={runner.busy || v === undefined}
              onClick={() => {
                open('totp')
                beginTotp()
              }}
            >
              {t('account_steps_setUp')}
            </Button>
          )}
        </div>
        <div class="item">
          <div class="grow">
            <div class="row names">
              <span class="strong">{t('account_steps_email')}</span>
              {methodOn('email') ? <Badge kind="accent">{t('account_steps_on')}</Badge> : null}
            </div>
            <div class="muted small">
              {v?.email ? t('account_steps_emailTo', v.email) : t('account_steps_emailHint')}
            </div>
          </div>
          {v?.emailOffered === false ? (
            <span class="muted small">{t('account_steps_noMail')}</span>
          ) : methodOn('email') ? (
            <Button kind="danger" disabled={runner.busy} onClick={() => open('email')}>
              {t('account_steps_turnOff')}
            </Button>
          ) : (
            <Button disabled={runner.busy || v === undefined} onClick={() => open('email')}>
              {t('account_steps_setUp')}
            </Button>
          )}
        </div>
        <div class="item">
          <div class="grow">
            <span class="strong">{t('account_steps_recovery')}</span>
            <div class="muted small">{t('account_steps_recoveryHint')}</div>
          </div>
          <Button disabled={runner.busy || v === undefined} onClick={() => open('recovery')}>
            {t('account_steps_show')}
          </Button>
        </div>
      </Group>
      <p class="muted small">{t('account_steps_webVault')}</p>

      {flow === 'totp' && secret !== null ? (
        <Group pad>
          <p>{t('account_steps_totpHow')}</p>
          <p class="secret mono" aria-label={t('account_steps_secretLabel')}>
            {groupSecret(secret.secret)}
          </p>
          <p class="muted small mono wrap">{secret.uri}</p>
          <form
            class="stack-12"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              if (!runner.busy && code.trim() !== '') confirmTotp()
            }}
          >
            <TextField
              label={t('account_steps_code')}
              value={code}
              onInput={setCode}
              autocomplete="one-time-code"
              mono
            />
            {needsProof('totp') ? <ProofField value={proof} onInput={setProof} /> : null}
            <div class="actions start">
              <Button
                type="submit"
                kind="primary"
                busy={runner.busy}
                disabled={code.trim() === '' || (needsProof('totp') && proof.trim() === '')}
              >
                {t('account_steps_confirm')}
              </Button>
              <Button disabled={runner.busy} onClick={() => open(null)}>
                {t('account_cancel')}
              </Button>
            </div>
          </form>
        </Group>
      ) : null}

      {flow === 'email' && v !== undefined ? (
        <Group pad>
          {methodOn('email') ? (
            <>
              <p>{t('account_steps_emailOffBody')}</p>
              <ProofField value={proof} onInput={setProof} />
              <div class="actions start">
                <Button
                  kind="danger"
                  busy={runner.busy}
                  disabled={proof.trim() === ''}
                  onClick={emailOff}
                >
                  {t('account_steps_turnOff')}
                </Button>
                <Button disabled={runner.busy} onClick={() => open(null)}>
                  {t('account_cancel')}
                </Button>
              </div>
            </>
          ) : (
            <form
              class="stack-12"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                if (runner.busy) return
                if (mailed) confirmEmail()
                else beginEmail()
              }}
            >
              <TextField
                label={t('account_steps_address')}
                value={address}
                onInput={setAddress}
                hint={t('account_steps_addressHint')}
              />
              {mailed ? (
                <>
                  <p class="muted small" role="status">
                    {t('account_steps_mailed', address.trim())}
                  </p>
                  <TextField
                    label={t('account_steps_code')}
                    value={code}
                    onInput={setCode}
                    autocomplete="one-time-code"
                    mono
                  />
                  {needsProof('email') ? <ProofField value={proof} onInput={setProof} /> : null}
                </>
              ) : null}
              <div class="actions start">
                <Button
                  type="submit"
                  kind="primary"
                  busy={runner.busy}
                  disabled={
                    address.trim() === '' ||
                    (mailed && (code.trim() === '' || (needsProof('email') && proof.trim() === '')))
                  }
                >
                  {mailed ? t('account_steps_confirm') : t('account_steps_sendCode')}
                </Button>
                <Button disabled={runner.busy} onClick={() => open(null)}>
                  {t('account_cancel')}
                </Button>
              </div>
            </form>
          )}
        </Group>
      ) : null}

      {flow === 'recovery' && v !== undefined ? (
        <Group pad>
          {shown === undefined ? (
            <>
              <p>{t('account_steps_recoveryBody')}</p>
              {v.recoveryCodes || anyStepOn(v) ? (
                <ProofField value={proof} onInput={setProof} />
              ) : null}
              <div class="actions start">
                <Button
                  kind="primary"
                  busy={runner.busy}
                  disabled={(v.recoveryCodes || anyStepOn(v)) && proof.trim() === ''}
                  onClick={showRecovery}
                >
                  {t('account_steps_show')}
                </Button>
                <Button disabled={runner.busy} onClick={() => open(null)}>
                  {t('account_cancel')}
                </Button>
              </div>
            </>
          ) : shown === null ? (
            <>
              <p>{t('account_steps_recoveryNone')}</p>
              <div class="actions start">
                <Button onClick={() => open(null)}>{t('account_close')}</Button>
              </div>
            </>
          ) : (
            <>
              <p class="secret mono" aria-label={t('account_steps_recoveryLabel')}>
                {groupSecret(shown)}
              </p>
              <Notice kind="warn">{t('account_steps_recoveryKeep')}</Notice>
              <div class="actions start">
                <Button icon="copy" onClick={() => window.print()}>
                  {t('account_recovery_print')}
                </Button>
                <Button onClick={() => open(null)}>{t('account_close')}</Button>
              </div>
            </>
          )}
        </Group>
      ) : null}
    </Section>
  )
}
