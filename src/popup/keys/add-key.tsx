// Adding a key: make one (SSH, signing, exchange or PGP, with the app's algorithms and options), or bring one in from pasted
// text or a file, asking the passphrase of a protected key and saying what it is before anything is added.
import { useState } from 'preact/hooks'
import type {
  GenerateKeyInput,
  KeyKind,
  KeyPreview,
  PgpKeyType,
  Source,
} from '../../shared/keys-api'
import {
  Button,
  Notice,
  PageHeader,
  SelectField,
  Switch,
  Tabs,
  TextField,
  useToast,
} from '../../shared/ui/components'
import { t } from '../../shared/ui/i18n'
import { ask } from '../send'
import type { KeysData } from './data'
import { keysError, wordOf } from './data'
import type { PickedFile } from './files'
import { kindNames } from './format'
import { Aside, Passphrase, SourceBox, sourceOf } from './parts'
import type { KeysRoute } from './route'

/** What each kind makes, the default first: the app's own list (`generatedAlgorithms`). */
const algorithms: Record<'ssh' | 'signing' | 'exchange', string[]> = {
  ssh: ['ed25519', 'ecdsa-p256', 'rsa:3072', 'rsa:4096'],
  signing: ['ed25519', 'ecdsa-p256', 'ecdsa-p384', 'rsa:3072', 'rsa:4096', 'ml-dsa-65'],
  exchange: ['x25519', 'ml-kem-768', 'ml-kem-1024'],
}

const algorithmLabels: Record<string, string> = {
  ed25519: 'Ed25519',
  'ecdsa-p256': 'ECDSA P-256',
  'ecdsa-p384': 'ECDSA P-384',
  'rsa:3072': 'RSA 3072',
  'rsa:4096': 'RSA 4096',
  x25519: 'X25519',
  'ml-kem-768': 'ML-KEM-768',
  'ml-kem-1024': 'ML-KEM-1024',
  'ml-dsa-65': 'ML-DSA-65',
}

const pgpTypes: PgpKeyType[] = ['pqStandard', 'pqGnupg', 'ed25519', 'rsa4096']
/** The expiries offered, in years; 0 is never. The app's own default is two years. */
const expiries = [1, 2, 5, 0] as const

type Mode = 'generate' | 'import'
type GenKind = 'ssh' | 'signing' | 'exchange' | 'pgp'
const kinds: GenKind[] = ['ssh', 'signing', 'exchange', 'pgp']

function Generate(props: { onAdded: (id: string) => void; data: KeysData }) {
  const [kind, setKind] = useState<GenKind>('ssh')
  const [algorithm, setAlgorithm] = useState('ed25519')
  const [pgpType, setPgpType] = useState<PgpKeyType>('pqStandard')
  const [years, setYears] = useState<number>(2)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const pgp = kind === 'pgp'
  const slow = pgp ? pgpType === 'rsa4096' : algorithm.startsWith('rsa:')
  const nameMissing = name.trim() === ''
  const emailMissing = pgp && email.trim() === ''

  const pick = (next: GenKind) => {
    setKind(next)
    if (next !== 'pgp') setAlgorithm(algorithms[next][0] ?? 'ed25519')
  }

  const generate = async () => {
    setTried(true)
    if (nameMissing || emailMissing) return
    let input: GenerateKeyInput
    if (kind === 'pgp') {
      input = {
        kind,
        type: pgpType,
        name: name.trim(),
        email: email.trim(),
        expiresInYears: years === 0 ? null : years,
      }
    } else {
      const [id = algorithm, bits] = algorithm.split(':')
      input = {
        kind,
        algorithm: id,
        ...(bits === undefined ? {} : { bits: Number(bits) }),
        name: name.trim(),
      }
    }
    setBusy(true)
    setError(undefined)
    try {
      const made = await ask('generateKey', { input })
      await props.data.reload()
      props.onAdded(made.id)
    } catch (failure) {
      setError(keysError(failure))
      setBusy(false)
    }
  }

  return (
    <form
      class="stack-12 keys-form"
      onSubmit={(event) => {
        event.preventDefault()
        void generate()
      }}
    >
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      <SelectField
        stacked
        label={t('keys_generateKind')}
        value={kind}
        disabled={busy}
        options={kinds.map((value) => ({
          value,
          label: value === 'pgp' ? t('keys_kindPgp') : t(kindNames[value as KeyKind]),
        }))}
        onChange={pick}
      />
      <p class="muted">{t(`keys_generate_${kind}`)}</p>
      {pgp ? (
        <>
          <SelectField
            stacked
            label={t('keys_generateAlgorithm')}
            value={pgpType}
            disabled={busy}
            options={pgpTypes.map((value) => ({
              value,
              label:
                value === 'pqStandard'
                  ? `${t(`keys_pgp_${value}`)} · ${t('keys_recommended')}`
                  : t(`keys_pgp_${value}`),
            }))}
            onChange={setPgpType}
          />
          <p class="muted">{t(`keys_pgp_${pgpType}_caption`)}</p>
        </>
      ) : (
        <SelectField
          stacked
          label={t('keys_generateAlgorithm')}
          value={algorithm}
          disabled={busy}
          options={algorithms[kind].map((value, index) => ({
            value,
            label:
              index === 0
                ? t('keys_defaultAlgorithm', algorithmLabels[value] ?? value)
                : (algorithmLabels[value] ?? value),
          }))}
          onChange={setAlgorithm}
        />
      )}
      <TextField
        label={pgp ? t('keys_pgpName') : t('keys_fieldName')}
        value={name}
        placeholder={pgp ? 'Ada Lovelace' : t('keys_namePlaceholder')}
        invalid={tried && nameMissing}
        hint={
          tried && nameMissing ? t(pgp ? 'keys_pgpNameMissing' : 'keys_nameMissing') : undefined
        }
        onInput={setName}
      />
      {pgp && (
        <>
          <TextField
            label={t('keys_pgpEmail')}
            value={email}
            type="text"
            placeholder="ada@example.org"
            invalid={tried && emailMissing}
            hint={tried && emailMissing ? t('keys_pgpEmailMissing') : undefined}
            onInput={setEmail}
          />
          <SelectField
            stacked
            label={t('keys_expires')}
            value={years}
            disabled={busy}
            options={expiries.map((value) => ({
              value,
              label: value === 0 ? t('keys_neverExpires') : t('keys_expiresIn', value),
            }))}
            onChange={setYears}
          />
        </>
      )}
      {slow && <Aside>{t('keys_generateSlow')}</Aside>}
      {busy && (
        <Notice>
          <span role="status">{t('keys_generating')}</span>
        </Notice>
      )}
      <div class="actions">
        <Button kind="primary" tall type="submit" busy={busy} icon="plus">
          {t('keys_generateButton')}
        </Button>
      </div>
    </form>
  )
}

function Import(props: {
  data: KeysData
  initialText?: string
  onAdded: (id: string) => void
  onRoute: (route: KeysRoute) => void
}) {
  const say = useToast()
  const [text, setText] = useState(props.initialText ?? '')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [preview, setPreview] = useState<KeyPreview | undefined>()
  const [name, setName] = useState('')
  const [asSsh, setAsSsh] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [publicOnly, setPublicOnly] = useState(false)
  const [busy, setBusy] = useState(false)

  const source = (chosen: PickedFile | null = file): Source | null => sourceOf(text, chosen)

  const read = async (chosen: PickedFile | null = file, typed = passphrase) => {
    const given = source(chosen)
    if (given === null) return
    setBusy(true)
    setError(undefined)
    setPublicOnly(false)
    setPreview(undefined)
    try {
      const found = await ask('previewKey', {
        ...given,
        ...(typed === '' ? {} : { passphrase: typed }),
      })
      setPreview(found)
      setNeedsPassphrase(false)
      setAsSsh(false)
      setName(
        found.defaultName !== ''
          ? found.defaultName
          : chosen !== null
            ? chosen.name.replace(/\.(pem|key|asc|gpg|der|p8|pk8|txt)$/i, '')
            : t('keys_importDefaultName', found.algorithm),
      )
    } catch (failure) {
      const word = wordOf(failure)
      if (word === 'keyPassphraseNeeded' || word === 'keyWrongPassphrase') setNeedsPassphrase(true)
      if (word === 'keyPassphraseNeeded') setError(undefined)
      else setError(keysError(failure))
      setPublicOnly(word === 'keyPublicKeyOnly')
    } finally {
      setBusy(false)
    }
  }

  const add = async (update: boolean) => {
    const given = source()
    if (given === null || (name.trim() === '' && !update)) return
    setBusy(true)
    setError(undefined)
    try {
      const added = await ask('importKey', {
        ...given,
        ...(passphrase === '' ? {} : { passphrase }),
        name: update ? (preview?.held?.name ?? name.trim()) : name.trim(),
        ...(asSsh ? { asSsh: true } : {}),
        ...(update ? { update: true } : {}),
      })
      await props.data.reload()
      if (update) say(t('keys_updated', added.name))
      props.onAdded(added.id)
    } catch (failure) {
      setError(keysError(failure))
      setBusy(false)
    }
  }

  const held = preview?.held ?? null
  return (
    <form
      class="stack-12 keys-form"
      onSubmit={(event) => {
        event.preventDefault()
        void (preview === undefined ? read() : add(false))
      }}
    >
      <p class="muted">{t('keys_importBody')}</p>
      <SourceBox
        label={t('keys_importPaste')}
        text={text}
        onText={(next) => {
          setText(next)
          setPreview(undefined)
        }}
        file={file}
        onFile={(chosen) => {
          setFile(chosen)
          setPreview(undefined)
          setNeedsPassphrase(false)
          if (chosen !== null) void read(chosen)
        }}
        placeholder="-----BEGIN PRIVATE KEY-----"
        tabHash="addKey"
        onTooLarge={() => setError(t('keys_error_tooLarge'))}
      />
      {error !== undefined && <Notice kind="error">{error}</Notice>}
      {publicOnly && (
        <div class="actions start">
          <Button
            icon="plus"
            onClick={() =>
              props.onRoute({ name: 'addContact', ...(file === null ? { text } : {}) })
            }
          >
            {t('keys_importToContacts')}
          </Button>
        </div>
      )}
      {needsPassphrase && (
        <>
          <Passphrase
            label={t('keys_importPassphrase')}
            hint={t('keys_importPassphraseBody')}
            value={passphrase}
            onInput={setPassphrase}
            autofocus
          />
          <div class="actions">
            <Button
              kind="primary"
              disabled={passphrase === ''}
              busy={busy}
              onClick={() => void read(file, passphrase)}
            >
              {t('keys_importOpen')}
            </Button>
          </div>
        </>
      )}
      {preview === undefined && !needsPassphrase && (
        <div class="actions">
          <Button kind="primary" type="submit" busy={busy} disabled={source() === null}>
            {t('keys_importRead')}
          </Button>
        </div>
      )}
      {preview !== undefined && (
        <>
          <div class="keys-found" role="status">
            <p class="strong">{`${t(kindNames[preview.kind])} · ${preview.algorithm}`}</p>
            {preview.fingerprint !== '' && <p class="mono">{preview.fingerprint}</p>}
            {preview.userIds.map((userId) => (
              <p key={userId} class="muted ellipsis">
                {userId}
              </p>
            ))}
          </div>
          {held !== null ? (
            <>
              <Notice kind="warn">{t('keys_importHeld', held.name)}</Notice>
              {held.update && (
                <>
                  <p class="muted">{t('keys_importHeldUpdate')}</p>
                  <div class="actions">
                    <Button kind="primary" busy={busy} onClick={() => void add(true)}>
                      {t('keys_importUpdate')}
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <TextField
                label={t('keys_fieldName')}
                value={name}
                invalid={name.trim() === ''}
                hint={name.trim() === '' ? t('keys_nameMissing') : undefined}
                onInput={setName}
              />
              {preview.canBeSsh && (
                <Switch
                  label={t('keys_importAsSsh')}
                  detail={t('keys_importAsSshBody')}
                  checked={asSsh}
                  onChange={setAsSsh}
                />
              )}
              <div class="actions">
                <Button
                  kind="primary"
                  tall
                  type="submit"
                  icon="plus"
                  busy={busy}
                  disabled={name.trim() === ''}
                >
                  {t('keys_importAdd')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </form>
  )
}

export function AddKey(props: {
  data: KeysData
  initialText?: string
  onBack: () => void
  onRoute: (route: KeysRoute) => void
  /** The key was added: show it. */
  onAdded: (id: string) => void
}) {
  const [mode, setMode] = useState<Mode>(props.initialText === undefined ? 'generate' : 'import')
  return (
    <div class="screen">
      <PageHeader title={t('keys_addKey')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Tabs
          label={t('keys_addMode')}
          selected={mode}
          onSelect={(id) => setMode(id === 'import' ? 'import' : 'generate')}
          tabs={[
            { id: 'generate', label: t('keys_modeGenerate') },
            { id: 'import', label: t('keys_modeImport') },
          ]}
        />
        <div role="tabpanel" id={`panel-${mode}`} aria-labelledby={`tab-${mode}`}>
          {mode === 'generate' ? (
            <Generate data={props.data} onAdded={props.onAdded} />
          ) : (
            <Import
              data={props.data}
              initialText={props.initialText}
              onAdded={props.onAdded}
              onRoute={props.onRoute}
            />
          )}
        </div>
      </div>
    </div>
  )
}
