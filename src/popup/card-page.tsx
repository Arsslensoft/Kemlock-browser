// A card's page, and the page that adds or edits one (mobile/lib/features/cards): the cardholder, the number showing its last four
// digits until it is shown, the expiry, and the security code and PIN hidden until shown, each with Copy through the clipboard that
// clears itself. The number is kept as its digits, a brand is offered from them, and a number that fails the Luhn check is warned
// about and still saves, as in the app.
import { useState } from 'preact/hooks'
import type { CardFull, CardInput, TabView } from '../shared/api'
import {
  cardBrandOf,
  cardBrands,
  cardDateOk,
  cardDigits,
  cardNumberMaxDigits,
  cardNumberMinDigits,
  groupedCardNumber,
  isCardNumberText,
  luhnValid,
  monthYearText,
  parseCardExpiry,
} from '../shared/card'
import {
  Button,
  Group,
  IconButton,
  Notice,
  PageHeader,
  Section,
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
import { DeleteQuestion, DetailRow, ItemBar, SecretRow, useFillForm } from './items-ui'
import type { Route } from './route'
import { ask } from './send'
import { TagEditor } from './tools/tag-editor'

function Gone(props: { onBack: () => void }) {
  return (
    <div class="screen">
      <PageHeader title={t('items_cards')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Notice>{t('items_cardGone')}</Notice>
      </div>
    </div>
  )
}

export function CardPage(props: {
  id: string
  vault: Vault
  tab: TabView | undefined
  onBack: () => void
  onRoute: (route: Route) => void
}) {
  const { vault, tab } = props
  const card = vault.cards.find((candidate) => candidate.id === props.id)
  const copy = useCopy()
  const say = useToast()
  const fill = useFillForm(tab)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  useToastBottom(tab === undefined ? 16 : 76)
  if (card === undefined) return <Gone onBack={props.onBack} />

  const remove = async () => {
    setBusy(true)
    try {
      await ask('deleteCard', { id: card.id })
      await vault.reload()
      props.onBack()
    } catch (error) {
      say(errorMessage(error))
      setBusy(false)
      setAsking(false)
    }
  }
  const expiry = monthYearText(card.expMonth, card.expYear)
  const validFrom = monthYearText(card.validFromMonth, card.validFromYear)
  const secret = (what: 'cardNumber' | 'cardCode' | 'cardPin') => () =>
    ask('showSecret', { what, id: card.id })
  return (
    <div class="screen">
      <ItemBar
        name={card.name}
        onBack={props.onBack}
        onEdit={() => props.onRoute({ name: 'cardEdit', id: card.id })}
        onDelete={() => setAsking(true)}
        deleteLabel={t('items_deleteCard')}
      />
      {asking && (
        <DeleteQuestion
          title={t('items_deleteCardTitle')}
          body={t('items_deleteBody', card.name)}
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
      <div class="body tight items-page">
        <Group>
          {card.cardholder !== undefined && (
            <DetailRow
              label={t('items_cardholder')}
              value={card.cardholder}
              copyLabel={t('items_copyCardholder')}
              onCopy={() => void copy('cardholder', card.id)}
            />
          )}
          {card.hasNumber && (
            <SecretRow
              label={t('items_number')}
              hidden={card.lastFour === undefined ? '••••' : `•••• ${card.lastFour}`}
              load={secret('cardNumber')}
              format={groupedCardNumber}
              showLabel={t('items_showNumber')}
              hideLabel={t('items_hideNumber')}
              copyLabel={t('items_copyCardNumber')}
              onCopy={() => void copy('cardNumber', card.id)}
              {...(card.brand === undefined ? {} : { caption: card.brand })}
            />
          )}
          {expiry !== '' && (
            <DetailRow
              label={t('items_expiry')}
              mono
              value={
                <>
                  {expiry}
                  {card.expired && <span class="expired-mark">{t('items_expired')}</span>}
                </>
              }
            />
          )}
          {validFrom !== '' && <DetailRow label={t('items_validFrom')} mono value={validFrom} />}
          {card.hasCode && (
            <SecretRow
              label={t('items_securityCode')}
              hidden="••••"
              load={secret('cardCode')}
              showLabel={t('items_showCode')}
              hideLabel={t('items_hideCode')}
              copyLabel={t('items_copyCode')}
              onCopy={() => void copy('cardCode', card.id)}
            />
          )}
          {card.hasPin && (
            <SecretRow
              label={t('items_pinLabel')}
              hidden="••••"
              load={secret('cardPin')}
              showLabel={t('items_showPin')}
              hideLabel={t('items_hidePin')}
              copyLabel={t('items_copyPin')}
              onCopy={() => void copy('cardPin', card.id)}
            />
          )}
        </Group>
        {card.note !== undefined && (
          <Section title={t('items_noteLabel')}>
            <Group pad>
              <p class="note-text">{card.note}</p>
            </Group>
          </Section>
        )}
        {/* Tags are changed in place; a card in a space the account may only read shows them */}
        {card.space?.canEdit === false ? (
          card.tags.length > 0 && <p class="strength-line">{card.tags.join(' · ')}</p>
        ) : (
          <Section title={t('tools_tags')}>
            <Group pad>
              <TagEditor
                kind="card"
                id={card.id}
                tags={card.tags}
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
      </div>
      {tab !== undefined && (
        <div class="foot-bar">
          <Button
            kind="primary"
            label={t('items_fillCardOf', card.name)}
            onClick={() => void fill({ cardId: card.id })}
          >
            {t('items_fillCard')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The page that edits a card: it reads the whole card first, as a login's page reads its password. */
export function EditCard(props: {
  id: string | null
  vault: Vault
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const full = useLoad<CardFull | undefined>(
    () => (props.id === null ? Promise.resolve(undefined) : ask('revealCard', { id: props.id })),
    [props.id],
  )
  if (props.id !== null && full.value === undefined) {
    return (
      <div class="screen">
        <PageHeader title={t('items_editCard')} onBack={props.onBack} backLabel={t('popup_back')} />
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
    <CardForm
      id={props.id}
      initial={full.value}
      vault={props.vault}
      onBack={props.onBack}
      onSaved={props.onSaved}
    />
  )
}

/** A card's own fields as the form holds them: text, as it is typed. */
export interface CardDraft {
  name: string
  holder: string
  number: string
  /** The brand the person picked; null until they do, and the brand then follows the number. */
  brand: string | null
  expiry: string
  validFrom: string
  code: string
  pin: string
  note: string
  pinned: boolean
}

export function draftOf(card: CardFull | undefined): CardDraft {
  return {
    name: card?.name ?? '',
    holder: card?.cardholder ?? '',
    number: groupedCardNumber(card?.number ?? ''),
    brand: card?.brand ?? null,
    expiry: monthYearText(card?.expMonth, card?.expYear),
    validFrom: monthYearText(card?.validFromMonth, card?.validFromYear),
    code: card?.code ?? '',
    pin: card?.pin ?? '',
    note: card?.note ?? '',
    pinned: card?.pinned ?? false,
  }
}

/** What a draft says to the core, or the message of what is wrong with it. */
export function inputOf(draft: CardDraft): { input: CardInput } | { problem: string } {
  const name = draft.name.trim()
  const holder = draft.holder.trim()
  if (!isCardNumberText(draft.number)) return { problem: t('items_numberDigits') }
  const digits = cardDigits(draft.number)
  if (digits !== '' && (digits.length < cardNumberMinDigits || digits.length > cardNumberMaxDigits))
    return { problem: t('items_numberLength') }
  if (name === '' || (digits === '' && holder === '')) return { problem: t('items_needsDetail') }
  if (!cardDateOk(draft.expiry) || !cardDateOk(draft.validFrom))
    return { problem: t('items_dateInvalid') }
  const expiry = parseCardExpiry(draft.expiry)
  const from = parseCardExpiry(draft.validFrom)
  const brand = draft.brand ?? cardBrandOf(digits) ?? undefined
  const input: CardInput = {
    name,
    ...(holder === '' ? {} : { cardholder: holder }),
    ...(digits === '' ? {} : { number: digits }),
    ...(brand === undefined ? {} : { brand }),
    ...(expiry.month === null ? {} : { expMonth: expiry.month }),
    ...(expiry.year === null ? {} : { expYear: expiry.year }),
    // A code and a PIN are kept as typed
    ...(draft.code === '' ? {} : { code: draft.code }),
    ...(draft.pin === '' ? {} : { pin: draft.pin }),
    ...(from.month === null ? {} : { validFromMonth: from.month }),
    ...(from.year === null ? {} : { validFromYear: from.year }),
    ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
    pinned: draft.pinned,
  }
  return { input }
}

function CardForm(props: {
  id: string | null
  initial: CardFull | undefined
  vault: Vault
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const [draft, setDraft] = useState<CardDraft>(() => draftOf(props.initial))
  const [showCode, setShowCode] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof CardDraft>(key: K, value: CardDraft[K]) =>
    setDraft((before) => ({ ...before, [key]: value }))

  const digits = cardDigits(draft.number)
  const offered = cardBrandOf(digits)
  const brand = draft.brand ?? offered
  const numberProblem = !isCardNumberText(draft.number)
    ? t('items_numberDigits')
    : digits !== '' && (digits.length < cardNumberMinDigits || digits.length > cardNumberMaxDigits)
      ? t('items_numberLength')
      : undefined
  const luhnWarning =
    numberProblem === undefined && digits.length >= cardNumberMinDigits && !luhnValid(digits)

  const save = async () => {
    const made = inputOf(draft)
    if ('problem' in made) {
      setError(made.problem)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const saved = await ask('saveCard', { id: props.id, input: made.input })
      await props.vault.reload()
      props.onSaved(saved.id)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  const eye = (shown: boolean, toggle: () => void, label: string) => (
    <IconButton
      icon={shown ? 'eyeOff' : 'eye'}
      label={shown ? t('popup_hide') : label}
      pressed={shown}
      onClick={toggle}
    />
  )

  return (
    <div class="screen">
      <PageHeader
        title={props.id === null ? t('items_newCard') : t('items_editCard')}
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
          <TextField
            label={t('items_fieldName')}
            value={draft.name}
            onInput={(value) => set('name', value)}
          />
          <TextField
            label={t('items_fieldCardholder')}
            value={draft.holder}
            onInput={(value) => set('holder', value)}
          />
          <TextField
            label={t('items_fieldNumber')}
            value={draft.number}
            mono
            autocomplete="off"
            invalid={numberProblem !== undefined}
            {...(numberProblem === undefined ? {} : { hint: numberProblem })}
            onInput={(value) => set('number', value)}
          />
          {luhnWarning && <Notice kind="warn">{t('items_numberLuhn')}</Notice>}
          <div class="brand-chips" role="group" aria-label={t('items_fieldBrand')}>
            {cardBrands.map((name) => (
              <button
                key={name}
                type="button"
                class={brand === name ? 'chip on' : 'chip'}
                aria-pressed={brand === name ? 'true' : 'false'}
                onClick={() => set('brand', brand === name ? '' : name)}
              >
                <span>{name}</span>
              </button>
            ))}
          </div>
          {offered !== null && draft.brand === null && (
            <p class="strength-line">{t('items_brandOffered', offered)}</p>
          )}
          <div class="two-fields">
            <TextField
              label={t('items_fieldExpiry')}
              value={draft.expiry}
              placeholder="MM/YY"
              invalid={!cardDateOk(draft.expiry)}
              onInput={(value) => set('expiry', value)}
            />
            <TextField
              label={t('items_fieldValidFrom')}
              value={draft.validFrom}
              placeholder="MM/YY"
              invalid={!cardDateOk(draft.validFrom)}
              onInput={(value) => set('validFrom', value)}
            />
          </div>
          <TextField
            label={t('items_fieldCode')}
            value={draft.code}
            mono
            type={showCode ? 'text' : 'password'}
            autocomplete="off"
            trailing={eye(showCode, () => setShowCode((on) => !on), t('items_showCode'))}
            onInput={(value) => set('code', value)}
          />
          <TextField
            label={t('items_fieldPin')}
            value={draft.pin}
            mono
            type={showPin ? 'text' : 'password'}
            autocomplete="off"
            trailing={eye(showPin, () => setShowPin((on) => !on), t('items_showPin'))}
            onInput={(value) => set('pin', value)}
          />
          <TextField
            label={t('items_fieldNote')}
            value={draft.note}
            multiline
            onInput={(value) => set('note', value)}
          />
          <Group>
            <Switch
              checked={draft.pinned}
              label={t('items_pin')}
              onChange={(on) => set('pinned', on)}
            />
          </Group>
        </div>
        <div class="foot-bar">
          <Button tall onClick={props.onBack}>
            {t('popup_cancel')}
          </Button>
          <Button kind="primary" tall type="submit" busy={busy}>
            {t('popup_save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
