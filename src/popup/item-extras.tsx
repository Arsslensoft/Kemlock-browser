// What every item but a passkey shares: custom fields (Text, Hidden, Checkbox; an admin's own or ones people make) and links to
// other items. A page shows them (FieldsSection, LinksSection) and its edit page changes them (FieldsEditor, LinkPicker, through
// `useItemExtras`). Nothing here holds a hidden value until it is asked for one: the lists carry none (docs/plans/add-item-format.md).
//
// A prop named `ref` never reaches a Preact component, so the item these take is `item`.
import { useEffect, useRef, useState } from 'preact/hooks'
import type {
  AdminFieldDef,
  CustomFieldDefs,
  FieldInput,
  FieldKind,
  FieldView,
  ItemKind,
  ItemRef,
  LinkedItemView,
} from '../shared/api'
import {
  Badge,
  Button,
  Group,
  IconButton,
  LinkButton,
  Notice,
  Section,
  SelectField,
  Switch,
  TextField,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { DetailRow, SecretRow } from './items-ui'
import type { Route } from './route'
import { ask } from './send'

/** The most fields and links an item takes (the background refuses more). */
export const maxFields = 100
export const maxLinks = 100
/** The most a search offers to link. */
const maxCandidates = 50

const sameRef = (a: ItemRef, b: ItemRef): boolean => a.kind === b.kind && a.id === b.id
const refKey = (item: ItemRef): string => `${item.kind}:${item.id}`

/** The name of a kind of item, as a person says it. */
export function kindName(kind: ItemKind): string {
  return t(`extras_kind_${kind.replace('-', '_')}`)
}

/** The page of an item the popup has one for; a key or a contact opens the keys screens, a code its edit page. */
export function routeOfRef(item: ItemRef): Route | undefined {
  switch (item.kind) {
    case 'login':
    case 'note':
    case 'card':
    case 'identity':
    case 'passkey':
    case 'file':
      return { name: item.kind, id: item.id }
    case 'otp':
      return { name: 'codeEdit', id: item.id }
    case 'backup-codes':
      return { name: 'backupEdit', id: item.id }
    case 'contact':
    case 'ssh-key':
    case 'pgp-key':
    case 'certificate':
      return { name: 'keys' }
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Custom fields on a page                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * The custom fields of an item, on its page: a text field with Copy, a hidden one as dots until Show, a checkbox as Yes or No. A
 * field the browser can't edit (a linked field) is shown when it holds a value. Nothing shows when the item has none.
 */
export function FieldsSection(props: { item: ItemRef; fields: FieldView[] | undefined }) {
  const say = useToast()
  const shown = (props.fields ?? []).filter((field) => field.name.trim() !== '')
  if (shown.length === 0) return null
  const copy = async (field: FieldView) => {
    try {
      await ask('copy', { what: 'field', id: props.item.id, ref: props.item, index: field.index })
      say(t('extras_copiedField', field.name))
    } catch (error) {
      say(errorMessage(error))
    }
  }
  return (
    <Section title={t('extras_fieldsTitle')}>
      <Group class="extras-fields">
        {shown.map((field) => {
          if (field.kind === 'hidden') {
            return field.hasValue ? (
              <SecretRow
                key={field.index}
                label={field.name}
                hidden="••••••••"
                load={() => ask('revealField', { ref: props.item, index: field.index })}
                showLabel={t('extras_showField', field.name)}
                hideLabel={t('extras_hideField', field.name)}
                copyLabel={t('extras_copyField', field.name)}
                onCopy={() => void copy(field)}
              />
            ) : (
              <DetailRow key={field.index} label={field.name} value="–" />
            )
          }
          if (field.kind === 'boolean') {
            return (
              <DetailRow
                key={field.index}
                label={field.name}
                value={field.value === 'true' ? t('extras_yes') : t('extras_no')}
              />
            )
          }
          const value = field.value ?? ''
          return (
            <DetailRow
              key={field.index}
              label={field.name}
              value={value === '' ? '–' : value}
              {...(value === '' || field.kind !== 'text'
                ? {}
                : { copyLabel: t('extras_copyField', field.name), onCopy: () => void copy(field) })}
            />
          )
        })}
      </Group>
    </Section>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* Custom fields in a form                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const typeOptions = (): { value: FieldKind; label: string }[] => [
  { value: 'text', label: t('extras_typeText') },
  { value: 'hidden', label: t('extras_typeHidden') },
  { value: 'boolean', label: t('extras_typeCheckbox') },
]

const kindOfDef = (def: AdminFieldDef): FieldKind =>
  def.type === 'checkbox' ? 'boolean' : def.type

/** Whether the admin offers this field on items of `kind` (a file and a passkey take none). */
function offered(def: AdminFieldDef, kind: ItemKind): boolean {
  if (kind === 'file' || kind === 'passkey') return false
  return def.kinds === 'all' || def.kinds.includes(kind)
}

/** A row with a change put on it; a hidden value that was typed over is no longer "kept as it is". */
function merged(row: FieldInput, patch: Partial<FieldInput>): FieldInput {
  const next = { ...row, ...patch }
  if (next.keepValue === undefined) delete next.keepValue
  return next
}

/** What is wrong with the rows, if anything: a value with no name to go with it. */
export function fieldsProblem(value: FieldInput[]): string | undefined {
  const bad = value.findIndex(
    (field) =>
      field.adminField === undefined &&
      field.name.trim() === '' &&
      (field.kind === 'boolean' ? field.value === 'true' : (field.value ?? '') !== ''),
  )
  return bad < 0 ? undefined : t('extras_nameNeeded', bad + 1)
}

function FieldRow(props: {
  /** The item the row belongs to; null while it is new (its rows hold no unread value). */
  item: ItemRef | null
  field: FieldInput
  n: number
  onChange: (patch: Partial<FieldInput>) => void
  onRemove: () => void
}) {
  const { field, n } = props
  const say = useToast()
  const [reveal, setReveal] = useState(false)
  // The value Show read for this row alone; the row still says "keep it as it is" until something is typed over it
  const [peek, setPeek] = useState<string | undefined>()
  const admin = field.adminField !== undefined
  const title = field.name.trim() === '' ? t('extras_fieldN', n) : field.name
  // A hidden value that was not read stays as it is until something is typed over it
  const kept = field.keepValue === true
  const readable = kept && props.item !== null && field.origin !== undefined
  /** This row's value, asked for by itself; undefined when it can't be read. */
  const read = async (): Promise<string | undefined> => {
    if (props.item === null || field.origin === undefined) return undefined
    try {
      return await ask('revealField', { ref: props.item, index: field.origin })
    } catch (error) {
      say(errorMessage(error))
      return undefined
    }
  }
  const toggle = async () => {
    if (reveal) {
      setReveal(false)
      return
    }
    if (readable && peek === undefined) {
      const value = await read()
      if (value === undefined) return
      setPeek(value)
    }
    setReveal(true)
  }
  const switchKind = async (kind: FieldKind) => {
    if (kind === field.kind) return
    if (kind === 'boolean') {
      props.onChange({ kind, value: 'false', keepValue: undefined })
      return
    }
    // A value nobody has read can't move to another type unseen: read it, or leave the type as it is
    let value = field.kind === 'boolean' ? '' : field.value
    if (kept) {
      const current = peek ?? (await read())
      if (current === undefined) return
      value = current
    }
    setPeek(undefined)
    props.onChange({ kind, value, ...(kind === 'hidden' ? {} : { keepValue: undefined }) })
  }
  const control =
    field.kind === 'boolean' ? (
      <Switch
        checked={field.value === 'true'}
        label={admin ? t('extras_fieldValue') : t('extras_fieldValueN', n)}
        onChange={(on) => props.onChange({ value: on ? 'true' : 'false' })}
      />
    ) : (
      <TextField
        label={admin ? t('extras_fieldValue') : t('extras_fieldValueN', n)}
        value={kept ? (peek ?? '') : (field.value ?? '')}
        mono={field.kind === 'hidden'}
        type={field.kind === 'hidden' && !reveal ? 'password' : 'text'}
        autocomplete="off"
        {...(kept && peek === undefined ? { placeholder: t('extras_keptValue') } : {})}
        onInput={(value) => {
          setPeek(undefined)
          props.onChange({ value, keepValue: undefined })
        }}
        trailing={
          field.kind === 'hidden' ? (
            <IconButton
              icon={reveal ? 'eyeOff' : 'eye'}
              size={16}
              label={reveal ? t('extras_hideField', title) : t('extras_showField', title)}
              pressed={reveal}
              onClick={() => void toggle()}
            />
          ) : undefined
        }
      />
    )
  return (
    <div class="extras-field" role="group" aria-label={title}>
      <div class="extras-head">
        {admin ? (
          <span class="extras-name">
            <span class="ellipsis">{field.name}</span>
            <Badge kind="accent">{t('extras_admin')}</Badge>
            <span class="muted extras-type">
              {typeOptions().find((option) => option.value === field.kind)?.label}
            </span>
          </span>
        ) : (
          <span class="extras-name muted">{t('extras_fieldN', n)}</span>
        )}
        <IconButton
          icon="x"
          size={16}
          weight={2}
          label={t('extras_removeField', title)}
          onClick={props.onRemove}
        />
      </div>
      {!admin && (
        <div class="two-fields">
          <TextField
            label={t('extras_fieldNameN', n)}
            value={field.name}
            placeholder={t('extras_fieldNamePlaceholder')}
            onInput={(name) => props.onChange({ name })}
          />
          <SelectField
            stacked
            label={t('extras_fieldTypeN', n)}
            value={field.kind}
            options={typeOptions()}
            onChange={(kind) => void switchKind(kind)}
          />
        </div>
      )}
      {control}
    </div>
  )
}

/**
 * The custom fields of an item in its form: a row each, with "Add a field" offering the admin's fields for this kind (a fixed
 * name and type; the person fills in the value) and "Your own field" when people may make their own. Every field is optional.
 * `value` is what the form saves; `fields` are the views the item came with, to count the ones that can't be edited here.
 */
export function FieldsEditor(props: {
  kind: ItemKind
  /** The item being edited, so a hidden value is read, for its own row, only when asked for; null or left out for a new item. */
  item?: ItemRef | null
  value: FieldInput[]
  fields: FieldView[]
  onChange: (next: FieldInput[]) => void
  /** The definitions, when the page already has them (a test); else they are asked for. */
  definitions?: CustomFieldDefs
}) {
  const defs = useLoad<CustomFieldDefs>(
    () =>
      props.definitions === undefined
        ? ask('customFieldDefs', {})
        : Promise.resolve(props.definitions),
    [],
  )
  const [adding, setAdding] = useState(false)
  const { value } = props
  const held = new Set(value.map((field) => field.adminField).filter((id) => id !== undefined))
  const choices = (defs.value?.fields ?? []).filter(
    (def) => offered(def, props.kind) && !held.has(def.id),
  )
  const allowOwn = defs.value?.allowOwn ?? true
  const full = value.length >= maxFields
  const apart = props.fields.filter((field) => !field.editable && field.name.trim() !== '').length
  const add = (field: FieldInput) => {
    props.onChange([...value, field])
    setAdding(false)
  }
  return (
    <Section title={t('extras_fieldsTitle')}>
      <div class="stack-12 extras-editor">
        {defs.error !== undefined && <Notice kind="warn">{defs.error}</Notice>}
        {value.length === 0 && <p class="muted">{t('extras_noFields')}</p>}
        {value.map((field, index) => (
          <FieldRow
            key={field.origin ?? `new-${index}`}
            item={props.item ?? null}
            field={field}
            n={index + 1}
            onChange={(patch) =>
              props.onChange(value.map((row, i) => (i === index ? merged(row, patch) : row)))
            }
            onRemove={() => props.onChange(value.filter((_, i) => i !== index))}
          />
        ))}
        {apart > 0 && <p class="muted">{t('extras_notEditable', apart)}</p>}
        {(choices.length > 0 || allowOwn) && !full && (
          <div class="actions start">
            <Button
              kind="ghost"
              icon="plus"
              expanded={adding}
              onClick={() => setAdding((on) => !on)}
            >
              {t('extras_addField')}
            </Button>
          </div>
        )}
        {adding && (
          <Group class="extras-menu">
            {choices.length > 0 && (
              <h3 class="label-caps extras-menu-title">{t('extras_fromAdmin')}</h3>
            )}
            {choices.map((def) => (
              <button
                key={def.id}
                type="button"
                class="link-row hov extras-pick"
                onClick={() =>
                  add({
                    name: def.name,
                    kind: kindOfDef(def),
                    value: def.type === 'checkbox' ? 'false' : '',
                    adminField: def.id,
                  })
                }
              >
                <span class="grow lines">
                  <span class="name">{def.name}</span>
                  <span class="label">
                    {typeOptions().find((option) => option.value === kindOfDef(def))?.label}
                  </span>
                </span>
              </button>
            ))}
            {allowOwn && (
              <button
                type="button"
                class="link-row hov extras-pick"
                onClick={() => add({ name: '', kind: 'text', value: '' })}
              >
                <span class="grow lines">
                  <span class="name">{t('extras_ownField')}</span>
                </span>
              </button>
            )}
          </Group>
        )}
        <p class="strength-line">{t(allowOwn ? 'extras_fieldsHint' : 'extras_fieldsHintAdmin')}</p>
      </div>
    </Section>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* Links on a page                                                                                */
/* ---------------------------------------------------------------------------------------------- */

function LinkedRow(props: {
  linked: LinkedItemView
  onOpen?: () => void
  onUnlink?: () => void
  busy?: boolean
}) {
  const { linked } = props
  const lines = (
    <>
      <span class="grow lines">
        <span class="name ellipsis">{linked.name}</span>
        <span class="label ellipsis">
          {[kindName(linked.ref.kind), linked.detail]
            .filter((part) => part !== undefined && part !== '')
            .join(' · ')}
        </span>
        {linked.halfMade === true && <span class="label warn-text">{t('extras_oneWay')}</span>}
      </span>
    </>
  )
  return (
    <div class="extras-linked">
      {props.onOpen === undefined ? (
        <div class="extras-linked-main">{lines}</div>
      ) : (
        <button
          type="button"
          class="extras-linked-main hov"
          aria-label={t('extras_openLinked', linked.name)}
          onClick={props.onOpen}
        >
          {lines}
        </button>
      )}
      {props.onUnlink !== undefined && (
        <LinkButton
          quiet
          label={t('extras_unlinkOf', linked.name)}
          disabled={props.busy}
          onClick={props.onUnlink}
        >
          {t('extras_unlink')}
        </LinkButton>
      )}
    </div>
  )
}

/**
 * The items linked to this one, on its page: each opens its page (when `onRoute` is given) and has Unlink, which removes the
 * link from both items. Nothing shows when there are none; links are added in the edit page.
 */
export function LinksSection(props: {
  item: ItemRef
  /** Opens a linked item's page. Without it the names are plain text. */
  onRoute?: (route: Route) => void
  /** After an unlink, so the page can load its lists again. */
  onChanged?: () => void
  /** The items already read, when the page has them. */
  linked?: LinkedItemView[]
}) {
  const say = useToast()
  const loaded = useLoad<LinkedItemView[]>(
    () =>
      props.linked === undefined
        ? ask('linkedItems', { ref: props.item })
        : Promise.resolve(props.linked),
    [props.item.kind, props.item.id],
  )
  /** The item can't be changed here (a read-only space's): the links show, with no Unlink. */
  readOnly?: boolean
  const [busy, setBusy] = useState(false)
  const list = loaded.value ?? []
  if (list.length === 0) return null
  const unlink = async (gone: LinkedItemView) => {
    setBusy(true)
    try {
      const result = await ask('setLinks', {
        ref: props.item,
        refs: list.filter((other) => !sameRef(other.ref, gone.ref)).map((other) => other.ref),
      })
      if (result.linkFailures.length > 0)
        say(t('extras_linkFailed', result.linkFailures.join(', ')))
      await loaded.reload()
      props.onChanged?.()
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('extras_linksTitle')}>
      <Group>
        {list.map((linked) => {
          const route = routeOfRef(linked.ref)
          const go = props.onRoute
          return (
            <LinkedRow
              key={refKey(linked.ref)}
              linked={linked}
              busy={busy}
              {...(route === undefined || go === undefined ? {} : { onOpen: () => go(route) })}
              {...(props.readOnly === true ? {} : { onUnlink: () => void unlink(linked) })}
            />
          )
        })}
      </Group>
    </Section>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* Links in a form                                                                                */
/* ---------------------------------------------------------------------------------------------- */

export interface LinkPickerProps {
  /** The item being edited; null while it is new (it can't be linked to itself, and has no links yet). */
  item: ItemRef | null
  value: ItemRef[]
  onChange: (next: ItemRef[]) => void
  /** Links not read yet, or not readable: nothing can be changed. */
  disabled?: boolean
}

/**
 * The links of an item in its form: a chip for each linked item with a button to unlink it, and "Link an item", which searches
 * the vault's other items (the first 50). A link is two-way: saving writes it on both items.
 */
export function LinkPicker(props: LinkPickerProps) {
  const { item, value } = props
  const [known, setKnown] = useState<Record<string, LinkedItemView>>({})
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<LinkedItemView[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const latest = useRef(0)

  // The names of what is linked already
  useEffect(() => {
    if (item === null) return
    let alive = true
    ask('linkedItems', { ref: item }).then(
      (views) => {
        if (alive)
          setKnown((before) => ({
            ...before,
            ...Object.fromEntries(views.map((view) => [refKey(view.ref), view])),
          }))
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [item?.kind, item?.id])

  // What a search finds: after a pause in typing, the newest search wins
  useEffect(() => {
    if (!open) return
    const mine = ++latest.current
    const search = () => {
      ask('linkCandidates', { ref: item, query: query.trim() }).then(
        (views) => {
          if (mine !== latest.current) return
          setFound(views.slice(0, maxCandidates))
          setError(undefined)
        },
        (failure) => mine === latest.current && setError(errorMessage(failure)),
      )
    }
    // The first list comes at once; typing waits for a pause
    if (query === '') {
      search()
      return
    }
    const timer = setTimeout(search, 200)
    return () => clearTimeout(timer)
  }, [open, query, item?.kind, item?.id])

  const choose = (view: LinkedItemView) => {
    setKnown((before) => ({ ...before, [refKey(view.ref)]: view }))
    props.onChange([...value, view.ref])
    setOpen(false)
    setQuery('')
  }
  const candidates = (found ?? []).filter(
    (view) => !value.some((chosen) => sameRef(chosen, view.ref)),
  )
  const full = value.length >= maxLinks
  return (
    <Section title={t('extras_linksTitle')}>
      <div class="stack-12 extras-editor">
        {value.length === 0 ? (
          <p class="muted">{t('extras_noLinks')}</p>
        ) : (
          <Group>
            {value.map((chosen) => {
              const view = known[refKey(chosen)]
              const linked: LinkedItemView = view ?? { ref: chosen, name: t('extras_missing') }
              return (
                <LinkedRow
                  key={refKey(chosen)}
                  linked={linked}
                  busy={props.disabled}
                  onUnlink={() => props.onChange(value.filter((other) => !sameRef(other, chosen)))}
                />
              )
            })}
          </Group>
        )}
        {!full && (
          <div class="actions start">
            <Button
              kind="ghost"
              icon="link"
              expanded={open}
              disabled={props.disabled}
              onClick={() => setOpen((on) => !on)}
            >
              {t('extras_linkAnItem')}
            </Button>
          </div>
        )}
        {open && (
          <div class="extras-pick-box">
            <TextField
              label={t('extras_searchItems')}
              type="search"
              value={query}
              autofocus
              onInput={setQuery}
            />
            {error !== undefined && <Notice kind="error">{error}</Notice>}
            {found !== undefined && candidates.length === 0 && error === undefined && (
              <p class="muted">{t('extras_noCandidates')}</p>
            )}
            {candidates.length > 0 && (
              <Group class="extras-candidates">
                {candidates.map((view) => (
                  <button
                    key={refKey(view.ref)}
                    type="button"
                    class="link-row hov extras-pick"
                    onClick={() => choose(view)}
                  >
                    <span class="grow lines">
                      <span class="name ellipsis">{view.name}</span>
                      <span class="label ellipsis">
                        {[kindName(view.ref.kind), view.detail]
                          .filter((part) => part !== undefined && part !== '')
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                ))}
              </Group>
            )}
          </div>
        )}
        <p class="strength-line">{t('extras_linksHint')}</p>
      </div>
    </Section>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* The two together, for an edit page                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** The fields an item can edit, as the form holds them: a hidden value stays as it is until it is read or typed over. */
function inputsOf(views: FieldView[] | undefined): FieldInput[] {
  return (views ?? [])
    .filter((field) => field.editable && field.kind !== 'linked' && field.kind !== 'other')
    .map((field) => {
      const kind = field.kind as FieldKind
      return {
        origin: field.index,
        name: field.name,
        kind,
        ...(kind === 'hidden'
          ? { keepValue: true as const }
          : { value: field.value ?? (kind === 'boolean' ? 'false' : '') }),
        ...(field.adminField === undefined ? {} : { adminField: field.adminField }),
      }
    })
}

export interface ItemExtras {
  fieldsProps: {
    kind: ItemKind
    item: ItemRef | null
    value: FieldInput[]
    fields: FieldView[]
    onChange: (next: FieldInput[]) => void
  }
  linkProps: LinkPickerProps
  /** The links are being read: a save before that would not know them. */
  loading: boolean
  /** What is wrong with the fields, if anything; the page shows it and does not save. */
  problem: string | undefined
  /** The members a save sends: only what the person changed, so what they left alone is never rewritten. */
  members: () => { fields?: FieldInput[]; links?: ItemRef[] }
  /**
   * Starts over from what was saved: the fields of the saved view, nothing changed, the links read again. A page that stays open after
   * a save calls it, or its next save would send the rows it already wrote a second time.
   */
  reset: (views: FieldView[] | undefined) => void
}

/**
 * The state of an edit page's fields and links. `item` is null for a new item; `views` are the fields the item came with. A hidden
 * value is not read here: its row is kept as it is until the person asks to see it (that row alone) or types over it.
 */
export function useItemExtras(
  kind: ItemKind,
  item: ItemRef | null,
  views: FieldView[] | undefined,
): ItemExtras {
  const [fields, setFields] = useState<FieldInput[]>(() => inputsOf(views))
  const [fieldsChanged, setFieldsChanged] = useState(false)
  const [links, setLinks] = useState<ItemRef[]>([])
  const [linksRead, setLinksRead] = useState(item === null)
  const [linksFailed, setLinksFailed] = useState(false)
  // The links the person changed are never replaced by a read that finishes later
  const linksChanged = useRef(false)
  const [linksTouched, setLinksTouched] = useState(false)
  // Counts the starts over: each reads the links again
  const [round, setRound] = useState(0)
  const itemKey = item === null ? '' : refKey(item)

  useEffect(() => {
    if (item === null) return
    let alive = true
    ask('linkedItems', { ref: item }).then(
      (linked) => {
        if (!alive) return
        if (!linksChanged.current) setLinks(linked.map((view) => view.ref))
        setLinksFailed(false)
        setLinksRead(true)
      },
      () => {
        if (!alive) return
        setLinksFailed(true)
        setLinksRead(true)
      },
    )
    return () => {
      alive = false
    }
  }, [itemKey, round])

  return {
    fieldsProps: {
      kind,
      item,
      value: fields,
      fields: views ?? [],
      onChange: (next) => {
        setFields(next)
        setFieldsChanged(true)
      },
    },
    linkProps: {
      item,
      value: links,
      disabled: !linksRead || linksFailed,
      onChange: (next) => {
        linksChanged.current = true
        setLinksTouched(true)
        setLinks(next)
      },
    },
    loading: !linksRead,
    problem: fieldsProblem(fields),
    members: () => ({
      ...(fieldsChanged ? { fields } : {}),
      ...(linksTouched ? { links } : {}),
    }),
    reset: (next) => {
      setFields(inputsOf(next))
      setFieldsChanged(false)
      linksChanged.current = false
      setLinksTouched(false)
      if (item !== null) {
        setLinksRead(false)
        setRound((before) => before + 1)
      }
    },
  }
}
