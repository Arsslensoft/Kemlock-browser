// The fresh proof the server asks for before it replaces or removes a Recovery Kit, turns a second step on beside another, or shows the
// recovery code: a code mailed to the account (`POST /account/two-factor/proof`), or a current code of the authenticator app.
import { useState } from 'preact/hooks'
import { Button, Notice, TextField } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { account } from './send'
import { useRunner } from './use'

export function ProofField(props: { value: string; onInput: (value: string) => void }) {
  const runner = useRunner()
  const [sent, setSent] = useState(false)
  const send = () =>
    void runner.run(async () => {
      await account('proofRequest')
      setSent(true)
    })
  return (
    <div class="proof">
      <TextField
        label={t('account_proof_label')}
        value={props.value}
        onInput={props.onInput}
        autocomplete="one-time-code"
        mono
        hint={sent ? t('account_proof_sent') : t('account_proof_hint')}
      />
      <div class="actions start">
        <Button busy={runner.busy} onClick={send}>
          {sent ? t('account_proof_again') : t('account_proof_send')}
        </Button>
      </div>
      {runner.error !== null ? <Notice kind="error">{runner.error}</Notice> : null}
    </div>
  )
}
