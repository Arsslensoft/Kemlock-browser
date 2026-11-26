// An identity's page, and the page that adds or edits one (mobile/lib/features/identities): the person's names, company, email,
// phone and birth date, one postal address, and their documents with each number hidden until shown, Copy through the clipboard
// that clears itself, and Expired on a document past its date. A document is edited here as in the app; the identity's tags and
// the app's order stay as they are.
import { useId, useState } from 'preact/hooks'
import type {
  IdentityDocumentFull,
  IdentityDocumentInput,
  IdentityFull,
  IdentityInput,
  TabView,
} from '../shared/api'
import { countries, countryLabel, countryName, countryStored } from '../shared/countries'
import {
  Button,
  Group,
  IconButton,
  Notice,
  PageHeader,
  Section,
  SelectField,
  Switch,
  TextField,
  useLoad,
  useToast,
  useToastBottom,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { useCopy } from './copy'
import type { Vault } from './data'
import { allTags } from './format'
import { addressLines, dateOk, dateText } from './items-data'
import { FieldsEditor, FieldsSection, LinkPicker, LinksSection, useItemExtras } from './item-extras'
import { DeleteQuestion, DetailRow, ItemBar, SecretRow, uiLanguage, useFillForm } from './items-ui'
import type { Route } from './route'
import { ask } from './send'
import { TagEditor } from './tools/tag-editor'

/** The kinds of document the app offers, by the type it stores. */
export const documentTypes = ['passport', 'driversLicence', 'idCard', 'taxNumber', 'other'] as const

const documentLabel = (type: string): string =>
  (documentTypes as readonly string[]).includes(type)
    ? t(`items_doc_${type}`)
    : t('items_doc_other')

function Gone(props: { onBack: () => void }) {
  return (
    <div class="screen">
      <PageHeader title={t('items_identities')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Notice>{t('items_identityGone')}</Notice>
      </div>
    </div>
  )
}

export function IdentityPage(props: {
  id: string
  vault: Vault
  tab: TabView | undefined
  onBack: () => void
  onRoute: (route: Route) => void
}) {
  const { vault, tab } = props
  const identity = vault.identities.find((candidate) => candidate.id === props.id)
  const copy = useCopy()
  const say = useToast()
  const fill = useFillForm(tab)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  useToastBottom(tab === undefined ? 16 : 76)
  if (identity === undefined) return <Gone onBack={props.onBack} />

  const remove = async () => {
    setBusy(true)
    try {
      await ask('deleteIdentity', { id: identity.id })
      await vault.reload()
      props.onBack()
    } catch (error) {
      say(errorMessage(error))
      setBusy(false)
      setAsking(false)
    }
  }
  const language = uiLanguage()
  const lines = identity.address === undefined ? [] : addressLines(identity.address, language)
  const person =
    identity.fullName === undefined
      ? undefined
      : [identity.title, identity.fullName].filter((part) => part !== undefined).join(' ')
  return (
    <div class="screen">
      <ItemBar
        name={identity.name}
        onBack={props.onBack}
        onEdit={() => props.onRoute({ name: 'identityEdit', id: identity.id })}
        onDelete={() => setAsking(true)}
        deleteLabel={t('items_deleteIdentity')}
      />
      {asking && (
        <DeleteQuestion
          title={t('items_deleteIdentityTitle')}
          body={t('items_deleteBody', identity.name)}
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
      <div class="body tight items-page">
        <Group>
          {person !== undefined && <DetailRow label={t('items_name')} value={person} />}
          {identity.company !== undefined && (
            <DetailRow label={t('items_company')} value={identity.company} />
          )}
          {identity.email !== undefined && (
            <DetailRow
              label={t('items_email')}
              value={identity.email}
              copyLabel={t('items_copyEmail')}
              onCopy={() => void copy('email', identity.id)}
            />
          )}
          {identity.phone !== undefined && (
            <DetailRow
              label={t('items_phone')}
              value={identity.phone}
              copyLabel={t('items_copyPhone')}
              onCopy={() => void copy('phone', identity.id)}
            />
          )}
          {identity.username !== undefined && (
            <DetailRow label={t('items_username')} value={identity.username} />
          )}
          {identity.birthDate !== undefined && (
            <DetailRow
              label={t('items_birthDate')}
              value={dateText(identity.birthDate, language)}
            />
          )}
          {lines.length > 0 && <DetailRow label={t('items_address')} value={lines.join('\n')} />}
        </Group>
        {identity.documents.length > 0 && (
          <Section title={t('items_documents')}>
            <Group>
              {identity.documents.map((document) => {
                const line = [
                  documentLabel(document.type),
                  document.issuingCountry === undefined
                    ? ''
                    : countryLabel(document.issuingCountry, language),
                  document.expiresOn === undefined
                    ? ''
                    : t('items_docExpires', dateText(document.expiresOn, language)),
                ]
                  .filter((part) => part !== '')
                  .join(' · ')
                return (
                  <div key={document.id} class="document-view">
                    <DetailRow
                      label={t('items_document')}
                      value={
                        <>
                          {line}
                          {document.expired && (
                            <span class="expired-mark">{t('items_expired')}</span>
                          )}
                        </>
                      }
                    />
                    {document.hasNumber && (
                      <SecretRow
                        label={t('items_number')}
                        hidden="••••••••"
                        load={() =>
                          ask('showSecret', {
                            what: 'documentNumber',
                            id: identity.id,
                            documentId: document.id,
                          })
                        }
                        showLabel={t('items_showDocumentNumber')}
                        hideLabel={t('items_hideDocumentNumber')}
                        copyLabel={t('items_copyDocumentNumber')}
                        onCopy={() =>
                          void copy('documentNumber', identity.id, undefined, document.id)
                        }
                      />
                    )}
                  </div>
                )
              })}
            </Group>
          </Section>
        )}
        {identity.note !== undefined && (
          <Section title={t('items_noteLabel')}>
            <Group pad>
              <p class="note-text">{identity.note}</p>
            </Group>
          </Section>
        )}
        {/* Tags are changed in place; an identity in a space the account may only read shows them */}
        {identity.space?.canEdit === false ? (
          identity.tags.length > 0 && <p class="strength-line">{identity.tags.join(' · ')}</p>
        ) : (
          <Section title={t('tools_tags')}>
            <Group pad>
              <TagEditor
                kind="identity"
                id={identity.id}
                tags={identity.tags}
                suggestions={allTags(
                  vault.codes,
                  vault.logins,
                  vault.notes,
                  vault.cards,
                  vault.identities,
                )}
                onChange={() => void vault.reload()}
              />
            </Group>
          </Section>
        )}
        <FieldsSection item={{ kind: 'identity', id: identity.id }} fields={identity.fields} />
        <LinksSection
          item={{ kind: 'identity', id: identity.id }}
          onRoute={props.onRoute}
          onChanged={() => void vault.reload()}
        />
      </div>
      {tab !== undefined && (
        <div class="foot-bar">
          <Button
            kind="primary"
            label={t('items_fillIdentityOf', identity.name)}
            onClick={() => void fill({ identityId: identity.id })}
          >
            {t('items_fillIdentity')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The page that edits an identity: it reads the whole identity first, document numbers too. */
export function EditIdentity(props: {
  id: string | null
  vault: Vault
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const full = useLoad<IdentityFull | undefined>(
    () =>
      props.id === null ? Promise.resolve(undefined) : ask('revealIdentity', { id: props.id }),
    [props.id],
  )
  if (props.id !== null && full.value === undefined) {
    return (
      <div class="screen">
        <PageHeader
          title={t('items_editIdentity')}
          onBack={props.onBack}
          backLabel={t('popup_back')}
        />
        <div class="body">
          {full.error !== undefined ? (
            <Notice kind="error">{full.error}</Notice>
          ) : (
            <p class="muted" role="status">
              {t('popup_loading')}
            </p>
          )}
        </div>
      </div>
    )
  }
  return (
    <IdentityForm
      id={props.id}
      initial={full.value}
      vault={props.vault}
      onBack={props.onBack}
      onSaved={props.onSaved}
    />
  )
}

/** A document as the form holds it. */
export interface DocumentDraft {
  /** Its own id when the identity has it already. */
  id?: string
  /** For keys of the list: a draft has no id until it is saved. */
  key: number
  type: string
  number: string
  country: string
  authority: string
  issuedOn: string
  expiresOn: string
}

/** An identity's own fields as the form holds them: text, as it is typed. */
export interface IdentityDraft {
  name: string
  title: string
  givenName: string
  middleName: string
  familyName: string
  company: string
  email: string
  phone: string
  username: string
  birthDate: string
  line1: string
  line2: string
  line3: string
  city: string
  region: string
  postalCode: string
  country: string
  note: string
  pinned: boolean
  documents: DocumentDraft[]
}

const documentDraft = (
  document: IdentityDocumentFull | undefined,
  key: number,
  language: string,
): DocumentDraft => ({
  ...(document === undefined ? {} : { id: document.id }),
  key,
  type: document?.type ?? 'passport',
  number: document?.number ?? '',
  country:
    document?.issuingCountry === undefined ? '' : countryLabel(document.issuingCountry, language),
  authority: document?.issuingAuthority ?? '',
  issuedOn: document?.issuedOn ?? '',
  expiresOn: document?.expiresOn ?? '',
})

export function draftOf(identity: IdentityFull | undefined, language: string): IdentityDraft {
  const address = identity?.address
  return {
    name: identity?.name ?? '',
    title: identity?.title ?? '',
    givenName: identity?.givenName ?? '',
    middleName: identity?.middleName ?? '',
    familyName: identity?.familyName ?? '',
    company: identity?.company ?? '',
    email: identity?.email ?? '',
    phone: identity?.phone ?? '',
    username: identity?.username ?? '',
    birthDate: identity?.birthDate ?? '',
    line1: address?.lines[0] ?? '',
    line2: address?.lines[1] ?? '',
    line3: address?.lines[2] ?? '',
    city: address?.city ?? '',
    region: address?.region ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country === undefined ? '' : countryLabel(address.country, language),
    note: identity?.note ?? '',
    pinned: identity?.pinned ?? false,
    documents: (identity?.documents ?? []).map((document, index) =>
      documentDraft(document, index, language),
    ),
  }
}

const blank = (text: string) => text.trim() === ''
const given = (text: string): string | undefined => (blank(text) ? undefined : text.trim())

/** What a draft says to the core, or the message of what is wrong with it. */
export function inputOf(draft: IdentityDraft): { input: IdentityInput } | { problem: string } {
  const name = draft.name.trim()
  if (name === '') return { problem: t('items_needsName') }
  if (!dateOk(draft.birthDate)) return { problem: t('items_dateFormat') }
  const lines = [draft.line1, draft.line2, draft.line3]
    .map((line) => line.trim())
    .filter((l) => l !== '')
  const address = {
    ...(lines.length === 0 ? {} : { lines }),
    ...(given(draft.city) === undefined ? {} : { city: given(draft.city) }),
    ...(given(draft.region) === undefined ? {} : { region: given(draft.region) }),
    ...(given(draft.postalCode) === undefined ? {} : { postalCode: given(draft.postalCode) }),
    ...(blank(draft.country) ? {} : { country: countryStored(draft.country) }),
  }
  const documents: IdentityDocumentInput[] = []
  for (const document of draft.documents) {
    if (blank(document.number)) return { problem: t('items_documentNeedsNumber') }
    if (!dateOk(document.issuedOn) || !dateOk(document.expiresOn))
      return { problem: t('items_dateFormat') }
    documents.push({
      ...(document.id === undefined ? {} : { id: document.id }),
      type: document.type,
      number: document.number.trim(),
      ...(blank(document.country) ? {} : { issuingCountry: countryStored(document.country) }),
      ...(given(document.authority) === undefined
        ? {}
        : { issuingAuthority: given(document.authority) }),
      ...(given(document.issuedOn) === undefined ? {} : { issuedOn: given(document.issuedOn) }),
      ...(given(document.expiresOn) === undefined ? {} : { expiresOn: given(document.expiresOn) }),
    })
  }
  const input: IdentityInput = {
    name,
    ...(given(draft.title) === undefined ? {} : { title: given(draft.title) }),
    ...(given(draft.givenName) === undefined ? {} : { givenName: given(draft.givenName) }),
    ...(given(draft.middleName) === undefined ? {} : { middleName: given(draft.middleName) }),
    ...(given(draft.familyName) === undefined ? {} : { familyName: given(draft.familyName) }),
    ...(given(draft.company) === undefined ? {} : { company: given(draft.company) }),
    ...(given(draft.email) === undefined ? {} : { email: given(draft.email) }),
    ...(given(draft.phone) === undefined ? {} : { phone: given(draft.phone) }),
    ...(given(draft.username) === undefined ? {} : { username: given(draft.username) }),
    ...(given(draft.birthDate) === undefined ? {} : { birthDate: given(draft.birthDate) }),
    address,
    documents,
    ...(given(draft.note) === undefined ? {} : { note: draft.note.trim() }),
    pinned: draft.pinned,
  }
  const details = Object.entries(input).some(
    ([key, value]) =>
      !['name', 'pinned', 'address', 'documents'].includes(key) && value !== undefined,
  )
  if (!details && lines.length === 0 && Object.keys(address).length === 0 && documents.length === 0)
    return { problem: t('items_identityNeedsDetail') }
  return { input }
}

/** A text field with the countries to pick from, as a list the browser shows while typing; any other text is kept as typed. */
function CountryField(props: { label: string; value: string; onInput: (value: string) => void }) {
  const list = useId()
  const id = useId()
  const language = uiLanguage()
  return (
    <div class="field">
      <label for={id}>{props.label}</label>
      <div class="box">
        <input
          id={id}
          type="text"
          list={list}
          autocomplete="off"
          spellcheck={false}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
        <datalist id={list}>
          {countries.map((country) => (
            <option key={country.code} value={countryName(country, language)} />
          ))}
        </datalist>
      </div>
    </div>
  )
}

function IdentityForm(props: {
  id: string | null
  initial: IdentityFull | undefined
  vault: Vault
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const language = uiLanguage()
  const [draft, setDraft] = useState<IdentityDraft>(() => draftOf(props.initial, language))
  const [next, setNext] = useState(() => (props.initial?.documents.length ?? 0) + 1)
  const [shown, setShown] = useState<Record<number, boolean>>({})
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof IdentityDraft>(key: K, value: IdentityDraft[K]) =>
    setDraft((before) => ({ ...before, [key]: value }))
  const extras = useItemExtras(
    'identity',
    props.id === null ? null : { kind: 'identity', id: props.id },
    props.initial?.fields,
  )
  const change = (key: number, patch: Partial<DocumentDraft>) =>
    setDraft((before) => ({
      ...before,
      documents: before.documents.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    }))

  const save = async () => {
    const made = inputOf(draft)
    if ('problem' in made) {
      setError(made.problem)
      return
    }
    if (extras.problem !== undefined) {
      setError(extras.problem)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const saved = await ask('saveIdentity', {
        id: props.id,
        input: { ...made.input, ...extras.members() },
      })
      await props.vault.reload()
      props.onSaved(saved.id)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  const text = (key: keyof IdentityDraft, label: string, extra: { mono?: boolean } = {}) => (
    <TextField
      label={label}
      value={String(draft[key])}
      {...extra}
      onInput={(value) => set(key, value as never)}
    />
  )
  const kinds = [
    ...documentTypes,
    // A type a later version wrote stays as it was
    ...draft.documents
      .map((document) => document.type)
      .filter((type) => !(documentTypes as readonly string[]).includes(type)),
  ]
  return (
    <div class="screen">
      <PageHeader
        title={props.id === null ? t('items_newIdentity') : t('items_editIdentity')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div class="body form-body">
          {error !== undefined && <Notice kind="error">{error}</Notice>}
          {text('name', t('items_fieldName'))}
          <div class="two-fields">
            {text('title', t('items_fieldTitlePerson'))}
            {text('givenName', t('items_fieldGivenName'))}
          </div>
          <div class="two-fields">
            {text('middleName', t('items_fieldMiddleName'))}
            {text('familyName', t('items_fieldFamilyName'))}
          </div>
          {text('company', t('items_fieldCompany'))}
          {text('email', t('items_fieldEmail'))}
          {text('phone', t('items_fieldPhone'))}
          {text('username', t('items_fieldUsername'))}
          <TextField
            label={t('items_fieldBirthDate')}
            value={draft.birthDate}
            placeholder="yyyy-mm-dd"
            invalid={!dateOk(draft.birthDate)}
            {...(dateOk(draft.birthDate) ? {} : { hint: t('items_dateFormat') })}
            onInput={(value) => set('birthDate', value)}
          />
          <Section title={t('items_address')}>
            <div class="stack">
              {text('line1', t('items_fieldLine1'))}
              {text('line2', t('items_fieldLine2'))}
              {text('line3', t('items_fieldLine3'))}
              <div class="two-fields">
                {text('city', t('items_fieldCity'))}
                {text('postalCode', t('items_fieldPostalCode'))}
              </div>
              {text('region', t('items_fieldRegion'))}
              <CountryField
                label={t('items_fieldCountry')}
                value={draft.country}
                onInput={(value) => set('country', value)}
              />
            </div>
          </Section>
          <Section title={t('items_documents')}>
            <div class="stack">
              {draft.documents.map((document, index) => (
                <div
                  key={document.key}
                  class="document-edit"
                  role="group"
                  aria-label={t('items_documentN', index + 1)}
                >
                  <div class="document-head">
                    <span>{t('items_documentN', index + 1)}</span>
                    <IconButton
                      icon="trash"
                      size={16}
                      label={t('items_documentRemove')}
                      onClick={() =>
                        setDraft((before) => ({
                          ...before,
                          documents: before.documents.filter((d) => d.key !== document.key),
                        }))
                      }
                    />
                  </div>
                  <SelectField
                    stacked
                    label={t('items_fieldDocumentType')}
                    value={document.type}
                    options={kinds.map((type) => ({ value: type, label: documentLabel(type) }))}
                    onChange={(type) => change(document.key, { type })}
                  />
                  <TextField
                    label={t('items_fieldDocumentNumber')}
                    value={document.number}
                    mono
                    type={shown[document.key] ? 'text' : 'password'}
                    autocomplete="off"
                    trailing={
                      <IconButton
                        icon={shown[document.key] ? 'eyeOff' : 'eye'}
                        label={
                          shown[document.key] ? t('popup_hide') : t('items_showDocumentNumber')
                        }
                        pressed={shown[document.key] === true}
                        onClick={() =>
                          setShown((before) => ({
                            ...before,
                            [document.key]: !before[document.key],
                          }))
                        }
                      />
                    }
                    onInput={(number) => change(document.key, { number })}
                  />
                  <CountryField
                    label={t('items_fieldIssuingCountry')}
                    value={document.country}
                    onInput={(country) => change(document.key, { country })}
                  />
                  <TextField
                    label={t('items_fieldIssuingAuthority')}
                    value={document.authority}
                    onInput={(authority) => change(document.key, { authority })}
                  />
                  <div class="two-fields">
                    <TextField
                      label={t('items_fieldIssuedOn')}
                      value={document.issuedOn}
                      placeholder="yyyy-mm-dd"
                      invalid={!dateOk(document.issuedOn)}
                      onInput={(issuedOn) => change(document.key, { issuedOn })}
                    />
                    <TextField
                      label={t('items_fieldExpiresOn')}
                      value={document.expiresOn}
                      placeholder="yyyy-mm-dd"
                      invalid={!dateOk(document.expiresOn)}
                      onInput={(expiresOn) => change(document.key, { expiresOn })}
                    />
                  </div>
                </div>
              ))}
              <div class="actions start">
                <Button
                  kind="ghost"
                  icon="plus"
                  onClick={() => {
                    setNext((n) => n + 1)
                    setDraft((before) => ({
                      ...before,
                      documents: [...before.documents, documentDraft(undefined, next, language)],
                    }))
                  }}
                >
                  {t('items_documentAdd')}
                </Button>
              </div>
            </div>
          </Section>
          <TextField
            label={t('items_fieldNote')}
            value={draft.note}
            multiline
            onInput={(value) => set('note', value)}
          />
          <FieldsEditor {...extras.fieldsProps} />
          <Group>
            <Switch
              checked={draft.pinned}
              label={t('items_pin')}
              onChange={(on) => set('pinned', on)}
            />
          </Group>
          <LinkPicker {...extras.linkProps} />
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy} disabled={extras.loading}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
