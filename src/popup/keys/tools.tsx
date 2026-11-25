// The PGP tools: Encrypt and Decrypt here, Sign and Verify in tools-sign.tsx. Each takes pasted text, or a file in the keys tab,
// works in the background's core with the vault's keys and contacts, and gives its result to copy or save.
import { useState } from 'preact/hooks'
import type { KeyView, PgpDecrypted, PgpEncrypted, SignerView, Source } from '../../shared/keys-api'
import { Button, Notice, PageHeader, SelectField, Switch, Tabs } from '../../shared/ui/components'
import { t } from '../../shared/ui/i18n'
import { ask } from '../send'
import type { KeysData } from './data'
import { keysError, wantsPassphrase, wordOf } from './data'
import { base64ToBytes, download } from './files'
import type { PickedFile } from './files'
import { CopyBox, Passphrase, SignatureLine, SourceBox, sourceOf } from './parts'
import type { KeysRoute, Tool } from './route'
import { Sign, Verify } from './tools-sign'

/** The vault's own PGP keys that can be used here: those whose secret half is in the vault. */
export const ownPgpKeys = (keys: KeyView[]): KeyView[] =>
  keys.filter((key) => key.kind === 'pgp' && !key.onCard)

function Output(props: { text?: string; base64?: string; fileName: string; label: string }) {
  if (props.text !== undefined)
    return <CopyBox label={props.label} text={props.text} fileName={props.fileName} />
  return (
    <Button icon="copy" onClick={() => download(props.fileName, base64ToBytes(props.base64 ?? ''))}>
      {t('keys_downloadFile', props.fileName)}
    </Button>
  )
}

function Encrypt(props: { data: KeysData }) {
  const { keys, contacts } = props.data
  const own = ownPgpKeys(keys)
  const people = contacts.filter((contact) => contact.canEncrypt)
  const [mode, setMode] = useState<'people' | 'passphrase'>('people')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [alsoTo, setAlsoTo] = useState('')
  const [signAs, setSignAs] = useState('')
  const [signPassphrase, setSignPassphrase] = useState('')
  // A key protected in part says it needs its passphrase only when it signs: the field then shows, and the work is tried again
  const [signNeeds, setSignNeeds] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [again, setAgain] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [out, setOut] = useState<PgpEncrypted | undefined>()

  const signer = own.find((key) => key.id === signAs)
  const source: Source | null = sourceOf(text, file)
  const unchecked = people.filter((contact) => chosen.has(contact.id) && !contact.checked)
  const mismatch = mode === 'passphrase' && again !== '' && passphrase !== again
  const recipients = chosen.size + (alsoTo === '' ? 0 : 1)
  const ready =
    source !== null &&
    (mode === 'people' ? recipients > 0 : passphrase !== '' && passphrase === again) &&
    (signer === undefined || !(signer.protected || signNeeds) || signPassphrase !== '')

  const run = async () => {
    if (source === null || !ready) return
    setBusy(true)
    setError(undefined)
    setOut(undefined)
    try {
      const toPeople = mode === 'people'
      setOut(
        await ask('pgpEncrypt', {
          data: { ...source, ...(file === null ? {} : { fileName: file.name }) },
          contactIds: toPeople ? [...chosen] : [],
          keyIds: toPeople && alsoTo !== '' ? [alsoTo] : [],
          ...(toPeople ? {} : { passphrase }),
          ...(signer === undefined ? {} : { signWith: signer.id }),
          ...(signer !== undefined && signPassphrase !== '' && (signer.protected || signNeeds)
            ? { signPassphrase }
            : {}),
        }),
      )
    } catch (failure) {
      if (signer !== undefined && wantsPassphrase(failure)) setSignNeeds(true)
      setError(wordOf(failure) === 'pgpPassphraseNeeded' ? undefined : keysError(failure))
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
      <Tabs
        label={t('keys_encryptMode')}
        selected={mode}
        onSelect={(id) => setMode(id === 'passphrase' ? 'passphrase' : 'people')}
        tabs={[
          { id: 'people', label: t('keys_encryptToPeople') },
          { id: 'passphrase', label: t('keys_encryptWithPassphrase') },
        ]}
      />
      {mode === 'people' ? (
        <>
          {people.length === 0 && own.length === 0 ? (
            <Notice>{t('keys_encryptNoOne')}</Notice>
          ) : (
            <fieldset class="keys-people">
              <legend class="label-caps">{t('keys_encryptTo')}</legend>
              {people.map((contact) => (
                <Switch
                  key={contact.id}
                  label={contact.name}
                  detail={
                    contact.checked ? contact.line : `${contact.line} · ${t('keys_notChecked')}`
                  }
                  checked={chosen.has(contact.id)}
                  onChange={(on) =>
                    setChosen((previous) => {
                      const next = new Set(previous)
                      if (on) next.add(contact.id)
                      else next.delete(contact.id)
                      return next
                    })
                  }
                />
              ))}
            </fieldset>
          )}
          {own.length > 0 && (
            <SelectField
              stacked
              label={t('keys_encryptAlsoToMe')}
              value={alsoTo}
              options={[
                { value: '', label: t('keys_encryptNotToMe') },
                ...own.map((key) => ({ value: key.id, label: key.name })),
              ]}
              onChange={setAlsoTo}
            />
          )}
          {unchecked.length > 0 && (
            <Notice kind="warn">
              {unchecked.length === 1
                ? t('keys_encryptUnchecked', unchecked[0]?.name ?? '')
                : t('keys_encryptUncheckedMany', unchecked.length)}
            </Notice>
          )}
        </>
      ) : (
        <>
          <Passphrase
            label={t('keys_encryptPassphrase')}
            value={passphrase}
            onInput={setPassphrase}
            hint={t('keys_encryptPassphraseBody')}
          />
          <Passphrase
            label={t('keys_encryptPassphraseAgain')}
            value={again}
            onInput={setAgain}
            invalid={mismatch}
            hint={mismatch ? t('keys_exportMismatch') : undefined}
          />
        </>
      )}
      <SourceBox
        label={t('keys_encryptMessage')}
        text={text}
        onText={(next) => {
          setText(next)
          setOut(undefined)
        }}
        file={file}
        onFile={(next) => {
          setFile(next)
          setOut(undefined)
        }}
        tabHash="tools/encrypt"
        onTooLarge={() => setError(t('keys_error_tooLarge'))}
      />
      {own.length > 0 && (
        <SelectField
          stacked
          label={t('keys_encryptSignAs')}
          value={signAs}
          options={[
            { value: '', label: t('keys_encryptNoSign') },
            ...own
              .filter((key) => key.pgp?.canSign !== false)
              .map((key) => ({ value: key.id, label: key.name })),
          ]}
          onChange={(next) => {
            setSignAs(next)
            setSignNeeds(false)
            setSignPassphrase('')
          }}
        />
      )}
      {signer !== undefined && (signer.protected || signNeeds) && (
        <Passphrase
          label={t('keys_keyPassphrase', signer.name)}
          value={signPassphrase}
          onInput={setSignPassphrase}
        />
      )}
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <div class="actions">
        <Button kind="primary" tall type="submit" icon="lock" busy={busy} disabled={!ready}>
          {t('keys_encryptButton')}
        </Button>
      </div>
      {out !== undefined && (
        <Output
          label={t('keys_encryptResult')}
          {...('text' in out ? { text: out.text } : { base64: out.base64 })}
          fileName={file === null ? 'message.asc' : `${file.name}.gpg`}
        />
      )}
      {out !== undefined && <p class="muted">{t('keys_encryptedDone')}</p>}
    </form>
  )
}

/** Who opened a message, and with what: a line under the result. */
function OpenedWith(props: { signer?: SignerView; passphrase: boolean }) {
  if (props.passphrase) return <p class="muted">{t('keys_openedPassphrase')}</p>
  if (props.signer === undefined) return null
  return <p class="muted">{t('keys_openedWith', props.signer.name)}</p>
}

function Decrypt(props: { data: KeysData }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [out, setOut] = useState<PgpDecrypted | undefined>()
  const source = sourceOf(text, file)
  const keys = ownPgpKeys(props.data.keys)

  const run = async () => {
    if (source === null) return
    setBusy(true)
    setError(undefined)
    setOut(undefined)
    try {
      setOut(
        await ask('pgpDecrypt', {
          ...source,
          ...(passphrase === '' ? {} : { passphrase }),
          ...(file === null ? {} : { fileName: file.name }),
        }),
      )
      setNeedsPassphrase(false)
    } catch (failure) {
      const word = wordOf(failure)
      if (word === 'pgpPassphraseNeeded' || word === 'pgpWrongPassphrase') setNeedsPassphrase(true)
      setError(word === 'pgpPassphraseNeeded' ? undefined : keysError(failure))
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
      {keys.length === 0 && <Notice>{t('keys_decryptNoKey')}</Notice>}
      <SourceBox
        label={t('keys_decryptMessage')}
        text={text}
        onText={(next) => {
          setText(next)
          setOut(undefined)
        }}
        file={file}
        onFile={(next) => {
          setFile(next)
          setOut(undefined)
        }}
        placeholder="-----BEGIN PGP MESSAGE-----"
        tabHash="tools/decrypt"
        onTooLarge={() => setError(t('keys_error_tooLarge'))}
      />
      {needsPassphrase && (
        <Passphrase
          label={t('keys_decryptPassphrase')}
          hint={t('keys_decryptPassphraseBody')}
          value={passphrase}
          onInput={setPassphrase}
          autofocus
        />
      )}
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <div class="actions">
        <Button
          kind="primary"
          tall
          type="submit"
          icon="eye"
          busy={busy}
          disabled={source === null || (needsPassphrase && passphrase === '')}
        >
          {t('keys_decryptButton')}
        </Button>
      </div>
      {out !== undefined && (
        <>
          {!out.encrypted && <Notice>{t('keys_decryptNotEncrypted')}</Notice>}
          <Output
            label={t('keys_decryptResult')}
            {...(out.isText ? { text: out.text ?? '' } : { base64: out.base64 ?? '' })}
            fileName={out.fileName === '' ? 'message.txt' : out.fileName}
          />
          <OpenedWith signer={out.openedWith} passphrase={out.openedWithPassphrase} />
          {out.signatures.map((signature, index) => (
            <SignatureLine key={index} signature={signature} />
          ))}
        </>
      )}
    </form>
  )
}

const toolNames: Record<Tool, string> = {
  encrypt: 'keys_toolEncrypt',
  decrypt: 'keys_toolDecrypt',
  sign: 'keys_toolSign',
  verify: 'keys_toolVerify',
}

export function Tools(props: {
  data: KeysData
  tool?: Tool
  keyId?: string
  onBack: () => void
  onRoute: (route: KeysRoute) => void
}) {
  const [tool, setTool] = useState<Tool>(props.tool ?? 'encrypt')
  return (
    <div class="screen">
      <PageHeader title={t('keys_tools')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Tabs
          label={t('keys_toolsLabel')}
          selected={tool}
          onSelect={(id) => setTool(id as Tool)}
          tabs={(Object.keys(toolNames) as Tool[]).map((id) => ({ id, label: t(toolNames[id]) }))}
        />
        <div role="tabpanel" id={`panel-${tool}`} aria-labelledby={`tab-${tool}`}>
          {tool === 'encrypt' && <Encrypt data={props.data} />}
          {tool === 'decrypt' && <Decrypt data={props.data} />}
          {tool === 'sign' && <Sign data={props.data} keyId={props.keyId} />}
          {tool === 'verify' && <Verify data={props.data} />}
        </div>
      </div>
    </div>
  )
}
