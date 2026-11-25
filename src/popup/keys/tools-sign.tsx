// The signing tools: Sign (a PGP key's clear-signed text or detached signature, or an SSH key's `ssh-keygen -Y` block) and
// Verify (PGP messages and signatures against contacts and own keys, SSH signatures, and the SSH signature of a git commit
// or tag).
import { useState } from 'preact/hooks'
import type { KeyView, PgpVerified, SshVerified } from '../../shared/keys-api'
import { Button, Notice, SelectField, TextField } from '../../shared/ui/components'
import { t } from '../../shared/ui/i18n'
import { ask } from '../send'
import type { KeysData } from './data'
import { keysError, wantsPassphrase, wordOf } from './data'
import { base64ToBytes, download } from './files'
import type { PickedFile } from './files'
import { CopyBox, Passphrase, SignatureLine, SourceBox, sourceOf } from './parts'
import { kindNames } from './format'

type Purpose = 'file' | 'git' | 'other'

/** The namespace an SSH signature is for: `file`, `git` (what git signs commits under), or one the person types. */
function NamespaceChoice(props: {
  purpose: Purpose
  onPurpose: (purpose: Purpose) => void
  namespace: string
  onNamespace: (namespace: string) => void
}) {
  return (
    <>
      <SelectField
        stacked
        label={t('keys_namespaceFor')}
        value={props.purpose}
        options={[
          { value: 'file', label: t('keys_namespaceFile') },
          { value: 'git', label: t('keys_namespaceGit') },
          { value: 'other', label: t('keys_namespaceOther') },
        ]}
        onChange={props.onPurpose}
      />
      {props.purpose === 'other' && (
        <TextField
          label={t('keys_namespace')}
          value={props.namespace}
          mono
          onInput={props.onNamespace}
        />
      )}
    </>
  )
}

const namespaceOf = (purpose: Purpose, typed: string): string =>
  purpose === 'other' ? typed.trim() : purpose

/** The keys that can sign here: the vault's PGP keys with a secret half, and its SSH keys. */
const signingKeys = (keys: KeyView[]): KeyView[] =>
  keys.filter(
    (key) =>
      (key.kind === 'pgp' && !key.onCard && key.pgp?.canSign !== false) ||
      (key.kind === 'ssh' && key.hasSshForm),
  )

type PgpForm = 'cleartext' | 'detachedArmored' | 'detached'

export function Sign(props: { data: KeysData; keyId?: string }) {
  const keys = signingKeys(props.data.keys)
  const [keyId, setKeyId] = useState(
    keys.find((key) => key.id === props.keyId)?.id ?? keys[0]?.id ?? '',
  )
  const [form, setForm] = useState<PgpForm>('cleartext')
  const [purpose, setPurpose] = useState<Purpose>('file')
  const [namespace, setNamespace] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [passphrase, setPassphrase] = useState('')
  // A key protected in part says it needs its passphrase only when it signs: the field then shows, and the signing is tried again
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [out, setOut] = useState<{ text?: string; base64?: string } | undefined>()

  const key = keys.find((candidate) => candidate.id === keyId)
  const ssh = key?.kind === 'ssh'
  const cleartext = !ssh && form === 'cleartext'
  const source = sourceOf(text, cleartext ? null : file)
  const ready =
    key !== undefined &&
    source !== null &&
    (!ssh || namespaceOf(purpose, namespace) !== '') &&
    (ssh || !(key.protected || needsPassphrase) || passphrase !== '')

  const run = async () => {
    if (key === undefined || source === null) return
    setBusy(true)
    setError(undefined)
    setOut(undefined)
    try {
      setOut(
        ssh
          ? await ask('sshSign', {
              ...source,
              keyId: key.id,
              namespace: namespaceOf(purpose, namespace),
            })
          : await ask('pgpSign', {
              ...source,
              keyId: key.id,
              form,
              ...(passphrase !== '' && (key.protected || needsPassphrase) ? { passphrase } : {}),
            }),
      )
    } catch (failure) {
      if (wantsPassphrase(failure)) setNeedsPassphrase(true)
      setError(wordOf(failure) === 'pgpPassphraseNeeded' ? undefined : keysError(failure))
    } finally {
      setBusy(false)
    }
  }

  if (keys.length === 0) return <Notice>{t('keys_signNoKey')}</Notice>

  const base = file?.name
  const outName = ssh
    ? `${base ?? 'signature'}.sig`
    : form === 'cleartext'
      ? 'signed.asc'
      : form === 'detached'
        ? `${base ?? 'signature'}.sig`
        : `${base ?? 'signature'}.asc`

  return (
    <form
      class="stack-12 keys-form"
      onSubmit={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      <SelectField
        stacked
        label={t('keys_signWithKey')}
        value={keyId}
        options={keys.map((candidate) => ({
          value: candidate.id,
          label: `${candidate.name} · ${t(kindNames[candidate.kind])}`,
        }))}
        onChange={(next) => {
          setKeyId(next)
          setNeedsPassphrase(false)
          setPassphrase('')
          setOut(undefined)
        }}
      />
      {ssh ? (
        <NamespaceChoice
          purpose={purpose}
          onPurpose={setPurpose}
          namespace={namespace}
          onNamespace={setNamespace}
        />
      ) : (
        <SelectField
          stacked
          label={t('keys_signForm')}
          value={form}
          options={[
            { value: 'cleartext', label: t('keys_signCleartext') },
            { value: 'detachedArmored', label: t('keys_signDetachedArmored') },
            { value: 'detached', label: t('keys_signDetached') },
          ]}
          onChange={(next) => {
            setForm(next)
            setOut(undefined)
          }}
        />
      )}
      <SourceBox
        label={t('keys_signMessage')}
        text={text}
        onText={(next) => {
          setText(next)
          setOut(undefined)
        }}
        file={cleartext ? null : file}
        onFile={(next) => {
          setFile(next)
          setOut(undefined)
        }}
        textOnly={cleartext}
        tabHash="tools/sign"
        onTooLarge={() => setError(t('keys_error_tooLarge'))}
      />
      {!ssh && key !== undefined && (key.protected || needsPassphrase) && (
        <Passphrase
          label={t('keys_keyPassphrase', key.name)}
          value={passphrase}
          onInput={setPassphrase}
        />
      )}
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <div class="actions">
        <Button kind="primary" tall type="submit" icon="edit" busy={busy} disabled={!ready}>
          {t('keys_signButton')}
        </Button>
      </div>
      {out?.text !== undefined && (
        <CopyBox label={t('keys_signResult')} text={out.text} fileName={outName} />
      )}
      {out?.base64 !== undefined && (
        <Button icon="copy" onClick={() => download(outName, base64ToBytes(out.base64 ?? ''))}>
          {t('keys_downloadFile', outName)}
        </Button>
      )}
    </form>
  )
}

type Kind = 'pgp' | 'ssh' | 'git'

/** What an SSH signature came to, in words. */
function SshResult(props: { result: SshVerified; wanted: string }) {
  const { result } = props
  if (result.verdict === 'good') {
    if (result.matches === false) return <Notice kind="error">{t('keys_sshOtherKey')}</Notice>
    if (result.matches === true) return <Notice kind="ok">{t('keys_sshGoodGiven')}</Notice>
    if (result.own !== null)
      return <Notice kind="ok">{t('keys_sshGoodOwn', result.own.name)}</Notice>
    return (
      <Notice kind="warn">
        <p>{t('keys_sshGoodUnknown')}</p>
        <p class="mono keys-fingerprint">{result.fingerprint}</p>
      </Notice>
    )
  }
  const text =
    result.verdict === 'bad'
      ? t('keys_sshBad')
      : result.verdict === 'wrongNamespace'
        ? t('keys_sshNamespace', result.detail ?? '', props.wanted)
        : result.verdict === 'unsupported'
          ? t('keys_sshUnsupported', result.detail ?? result.keyType)
          : result.verdict === 'weak'
            ? t('keys_sshWeak')
            : t('keys_sshWeakKey', result.detail ?? '')
  return <Notice kind="error">{text}</Notice>
}

export function Verify(_props: { data: KeysData }) {
  const [kind, setKind] = useState<Kind>('pgp')
  const [text, setText] = useState('')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [signature, setSignature] = useState('')
  const [purpose, setPurpose] = useState<Purpose>('file')
  const [namespace, setNamespace] = useState('')
  const [signer, setSigner] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [pgp, setPgp] = useState<PgpVerified | undefined>()
  const [ssh, setSsh] = useState<SshVerified | undefined>()

  const git = kind === 'git'
  const source = sourceOf(text, git ? null : file)
  const wanted = git ? 'git' : namespaceOf(purpose, namespace)
  const ready =
    source !== null && (kind === 'pgp' || (git ? true : signature.trim() !== '' && wanted !== ''))

  const reset = () => {
    setPgp(undefined)
    setSsh(undefined)
    setError(undefined)
  }

  const run = async () => {
    if (source === null) return
    setBusy(true)
    reset()
    try {
      if (kind === 'pgp') {
        setPgp(
          await ask('pgpVerify', { ...source, ...(signature.trim() === '' ? {} : { signature }) }),
        )
      } else {
        setSsh(
          await ask('sshVerify', {
            ...source,
            ...(git ? { git: true } : { signature, namespace: wanted }),
            ...(signer.trim() === '' ? {} : { signer }),
          }),
        )
      }
    } catch (failure) {
      setError(keysError(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      class="stack-12 keys-form"
      onSubmit={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      <SelectField
        stacked
        label={t('keys_verifyKind')}
        value={kind}
        options={[
          { value: 'pgp', label: t('keys_verifyPgp') },
          { value: 'ssh', label: t('keys_verifySsh') },
          { value: 'git', label: t('keys_verifyGit') },
        ]}
        onChange={(next) => {
          setKind(next)
          reset()
        }}
      />
      <SourceBox
        label={git ? t('keys_verifyGitObject') : t('keys_verifyMessage')}
        text={text}
        onText={(next) => {
          setText(next)
          reset()
        }}
        file={git ? null : file}
        onFile={(next) => {
          setFile(next)
          reset()
        }}
        textOnly={git}
        placeholder={git ? 'tree 4b825dc…' : '-----BEGIN PGP SIGNED MESSAGE-----'}
        tabHash="tools/verify"
        onTooLarge={() => setError(t('keys_error_tooLarge'))}
      />
      {!git && (
        <TextField
          label={kind === 'pgp' ? t('keys_verifySignatureApart') : t('keys_verifySignature')}
          value={signature}
          multiline
          mono
          class="keys-text"
          placeholder={
            kind === 'pgp' ? '-----BEGIN PGP SIGNATURE-----' : '-----BEGIN SSH SIGNATURE-----'
          }
          onInput={(next) => {
            setSignature(next)
            reset()
          }}
        />
      )}
      {kind !== 'pgp' && (
        <>
          {!git && (
            <NamespaceChoice
              purpose={purpose}
              onPurpose={setPurpose}
              namespace={namespace}
              onNamespace={setNamespace}
            />
          )}
          <TextField
            label={t('keys_verifySigner')}
            value={signer}
            mono
            hint={t('keys_verifySignerBody')}
            placeholder="ssh-ed25519 AAAA…"
            onInput={(next) => {
              setSigner(next)
              reset()
            }}
          />
        </>
      )}
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <div class="actions">
        <Button kind="primary" tall type="submit" icon="shieldCheck" busy={busy} disabled={!ready}>
          {t('keys_verifyButton')}
        </Button>
      </div>
      {pgp?.signatures.map((result, index) => (
        <SignatureLine key={index} signature={result} />
      ))}
      {pgp?.text !== undefined && <CopyBox label={t('keys_verifyContent')} text={pgp.text} />}
      {ssh !== undefined && <SshResult result={ssh} wanted={wanted} />}
    </form>
  )
}
