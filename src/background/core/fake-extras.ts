// Custom fields and links of every kind of item, in the fake core (docs/plans/add-item-format.md): the same rules as the real core's
// item_extras.dart, over plain objects. A list of fields is saved in place (an entry the browser can't edit stays where it was, a
// nameless row is dropped), a hidden value leaves one at a time, and a link is written on both ends (an end that can't be written is
// named and left half made). A missing `fields` or `links` keeps what there is.
import type {
  FieldInput,
  FieldView,
  ItemExtras,
  ItemExtrasInput,
  ItemKind,
  ItemRef,
  LinkedItemView,
} from '../../shared/api'

/** One custom field as stored: its value too, a hidden one's included. */
export interface StoredField {
  name: string
  kind: FieldView['kind']
  value: string
  adminField?: string
}

/** What an item keeps of the format: its fields, and the links it names (the other end is the other item's own). */
export interface StoredExtras {
  fields: StoredField[]
  links: ItemRef[]
}

/** The key of an item in the store: its kind and entry id. */
export const refKey = (ref: ItemRef): string => `${ref.kind}:${ref.id}`
const sameRef = (a: ItemRef, b: ItemRef): boolean => a.kind === b.kind && a.id === b.id

function parseKey(key: string): ItemRef {
  const at = key.indexOf(':')
  return { kind: key.slice(0, at) as ItemKind, id: key.slice(at + 1) }
}

/** The kinds that carry no custom fields: a passkey and a File item. */
const noFields: ReadonlySet<ItemKind> = new Set<ItemKind>(['file', 'passkey'])
const maxFieldRows = 100
const maxLinkRefs = 100

/** A person can edit a field of a kind the browser knows that has a name; a nameless one and a linked one are kept as they are. */
const editable = (field: StoredField): boolean =>
  (field.kind === 'text' || field.kind === 'hidden' || field.kind === 'boolean') &&
  field.name.trim() !== ''

/** What `FakeExtras` asks of the fake core around it: what the items are called, and the links the vault keeps apart from `links`. */
export interface ExtrasHost {
  /** The item's name, and the line under it, or undefined when there is no such item. */
  find(ref: ItemRef): { name: string; detail?: string; space?: Record<string, unknown> } | undefined
  /** Every item that may be linked. */
  all(): { ref: ItemRef; name: string; detail?: string }[]
  /** The link a code and its login keep apart from `links` (`linkedLoginId`): two-way, whichever end names the other. */
  legacy(ref: ItemRef): ItemRef[]
  /** Clears that link between two items. */
  unlegacy(a: ItemRef, b: ItemRef): void
  /** Items whose end of a link can't be written (a space that is read only), by `refKey`. */
  unwritable(): ReadonlySet<string>
}

export class FakeExtras {
  constructor(
    private readonly store: () => Record<string, StoredExtras>,
    private readonly host: ExtrasHost,
    private readonly fail: (word: string) => Error,
  ) {}

  private held(ref: ItemRef): StoredExtras | undefined {
    return this.store()[refKey(ref)]
  }

  private mine(ref: ItemRef): StoredExtras {
    return (this.store()[refKey(ref)] ??= { fields: [], links: [] })
  }

  /** Leaves an item with nothing out of the store: an empty member is not written. */
  private tidy(ref: ItemRef): void {
    const extras = this.held(ref)
    if (extras !== undefined && extras.fields.length === 0 && extras.links.length === 0)
      delete this.store()[refKey(ref)]
  }

  /** The item is gone: its fields, its links and every link to it. */
  forget(ref: ItemRef): void {
    const store = this.store()
    for (const other of this.host.legacy(ref)) this.host.unlegacy(ref, other)
    delete store[refKey(ref)]
    for (const [key, extras] of Object.entries(store)) {
      extras.links = extras.links.filter((link) => !sameRef(link, ref))
      this.tidy(parseKey(key))
    }
  }

  /* Fields ---------------------------------------------------------------------------------- */

  /** The fields as a view shows them: those with a name, each by its place in the item's whole list (a nameless one is kept, unseen). */
  fieldViews(ref: ItemRef): FieldView[] {
    const views: FieldView[] = []
    ;(this.held(ref)?.fields ?? []).forEach((field, index) => {
      if (field.name.trim() === '') return
      views.push({
        index,
        name: field.name,
        kind: field.kind,
        // Only a text field and a checkbox show their value; a linked or other one shows none
        ...(field.kind === 'text' || field.kind === 'boolean' ? { value: field.value } : {}),
        hasValue: field.kind === 'boolean' || field.value !== '',
        ...(field.adminField === undefined ? {} : { adminField: field.adminField }),
        editable: editable(field),
      })
    })
    return views
  }

  /** One field's value, hidden or not; a field a person can't edit (linked, nameless) has none to give. */
  revealField(ref: ItemRef, index: number): string {
    const field = this.held(ref)?.fields[index]
    if (field === undefined || !editable(field)) throw this.fail('notFound')
    return field.value
  }

  revealFields(ref: ItemRef): { index: number; value: string }[] {
    const out: { index: number; value: string }[] = []
    ;(this.held(ref)?.fields ?? []).forEach((field, index) => {
      if (editable(field)) out.push({ index, value: field.value })
    })
    return out
  }

  /** The fields these rows make of the ones there are, or the word of what is wrong with them. Saves nothing. */
  private plan(
    kind: ItemKind,
    existing: readonly StoredField[],
    rows: readonly FieldInput[],
  ): StoredField[] {
    if (noFields.has(kind) || rows.length > maxFieldRows) throw this.fail('invalid')
    const byOrigin = new Map<number, FieldInput>()
    const added: FieldInput[] = []
    for (const row of rows) {
      const target = row.origin === undefined ? undefined : existing[row.origin]
      // An entry the browser can't edit (linked, nameless) stays as it was, whatever the row says; a place named twice is added
      if (target === undefined || !editable(target) || byOrigin.has(row.origin!)) added.push(row)
      else byOrigin.set(row.origin!, row)
    }
    const make = (row: FieldInput, was: StoredField | undefined): StoredField | undefined => {
      const name = row.name.trim()
      if (name === '') return undefined
      let value = row.value ?? ''
      // A checkbox holds `true` or `false`, and anything else is `false`
      if (row.kind === 'boolean') value = value === 'true' ? 'true' : 'false'
      // A hidden value the page never held is the field's own, unless the row is changed to another kind
      if (row.kind === 'hidden' && row.keepValue === true && was?.kind === 'hidden') value = was.value
      const adminField = row.adminField ?? was?.adminField
      return {
        name,
        kind: row.kind,
        value,
        ...(adminField === undefined ? {} : { adminField }),
      }
    }
    const out: StoredField[] = []
    existing.forEach((field, index) => {
      if (!editable(field)) {
        out.push(field)
        return
      }
      const row = byOrigin.get(index)
      const made = row === undefined ? undefined : make(row, field)
      if (made !== undefined) out.push(made)
    })
    for (const row of added) {
      const made = make(row, undefined)
      if (made !== undefined) out.push(made)
    }
    return out
  }

  /** Refuses what saving a new item with this input would, before it is made. */
  check(kind: ItemKind, input: ItemExtrasInput): void {
    if (input.fields !== undefined) this.plan(kind, [], input.fields)
    if (input.links !== undefined && input.links.length > maxLinkRefs) throw this.fail('invalid')
  }

  /** Refuses what applying this input to the item that is there would, before anything of it is changed. */
  validate(ref: ItemRef, input: ItemExtrasInput): void {
    if (input.fields !== undefined) this.plan(ref.kind, this.held(ref)?.fields ?? [], input.fields)
    if (input.links !== undefined && input.links.length > maxLinkRefs) throw this.fail('invalid')
  }

  /** Saves the fields and links the input carries; answers the names of the items whose end of a link was not written. */
  apply(ref: ItemRef, input: ItemExtrasInput): string[] {
    if (input.fields !== undefined) {
      this.mine(ref).fields = this.plan(ref.kind, this.held(ref)?.fields ?? [], input.fields)
      this.tidy(ref)
    }
    return input.links === undefined ? [] : this.setLinks(ref, input.links)
  }

  /* Links ----------------------------------------------------------------------------------- */

  /** Every item linked to this one, from both ends; one that only one end names is `halfMade`. */
  linked(ref: ItemRef): LinkedItemView[] {
    const key = refKey(ref)
    const seen = new Map<string, { ref: ItemRef; names: boolean; named: boolean }>()
    const note = (other: ItemRef, how: 'names' | 'named' | 'both'): void => {
      const entry = seen.get(refKey(other)) ?? { ref: other, names: false, named: false }
      if (how !== 'named') entry.names = true
      if (how !== 'names') entry.named = true
      seen.set(refKey(other), entry)
    }
    for (const link of this.held(ref)?.links ?? []) note(link, 'names')
    for (const [otherKey, extras] of Object.entries(this.store()))
      if (otherKey !== key && extras.links.some((link) => refKey(link) === key))
        note(parseKey(otherKey), 'named')
    for (const other of this.host.legacy(ref)) note(other, 'both')
    const views: LinkedItemView[] = []
    for (const { ref: other, names, named } of seen.values()) {
      const found = this.host.find(other)
      // A link to an item that isn't here stays in the item, and isn't listed
      if (found === undefined) continue
      views.push({
        ref: other,
        name: found.name,
        ...(found.detail === undefined ? {} : { detail: found.detail }),
        ...(names && named ? {} : { halfMade: true }),
        ...(found.space === undefined ? {} : { space: found.space }),
      })
    }
    return views.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** The fields (no hidden value) and the number of links a view carries. */
  view(ref: ItemRef): ItemExtras {
    return { fields: this.fieldViews(ref), links: this.linked(ref).length }
  }

  candidates(ref: ItemRef | null, query: string): LinkedItemView[] {
    const needle = query.trim().toLowerCase()
    const unwritable = this.host.unwritable()
    // Never the item itself, or one it is linked to already
    const taken = new Set((ref === null ? [] : this.linked(ref)).map((item) => refKey(item.ref)))
    return this.host
      .all()
      .filter(
        (item) =>
          (ref === null || !sameRef(item.ref, ref)) &&
          !taken.has(refKey(item.ref)) &&
          !unwritable.has(refKey(item.ref)) &&
          (needle === '' ||
            item.name.toLowerCase().includes(needle) ||
            (item.detail ?? '').toLowerCase().includes(needle)),
      )
      .slice(0, 50)
      .map((item) => ({
        ref: item.ref,
        name: item.name,
        ...(item.detail === undefined ? {} : { detail: item.detail }),
      }))
  }

  /**
   * Makes the item's links these, writing both ends. A link to an item that isn't there stays where it was; an end that can't be
   * written is left as it was and its item named in the answer.
   */
  setLinks(ref: ItemRef, refs: readonly ItemRef[]): string[] {
    if (refs.length > maxLinkRefs) throw this.fail('invalid')
    const wanted = new Map<string, ItemRef>()
    const failures: string[] = []
    for (const other of refs) {
      if (sameRef(other, ref)) continue
      // An item that isn't here is named in the answer, and the others are made
      if (this.host.find(other) === undefined) failures.push(other.id)
      else wanted.set(refKey(other), other)
    }
    const unwritable = this.host.unwritable()
    const nameOf = (other: ItemRef): string => this.host.find(other)?.name ?? other.id
    const current = this.linked(ref)
    for (const [otherKey, other] of wanted) {
      const have = current.find((item) => refKey(item.ref) === otherKey)
      if (have !== undefined && have.halfMade !== true) continue
      this.addLink(ref, other)
      if (unwritable.has(otherKey)) failures.push(nameOf(other))
      else this.addLink(other, ref)
    }
    for (const item of current) {
      const otherKey = refKey(item.ref)
      if (wanted.has(otherKey)) continue
      this.removeLink(ref, item.ref)
      this.host.unlegacy(ref, item.ref)
      if (unwritable.has(otherKey)) failures.push(nameOf(item.ref))
      else this.removeLink(item.ref, ref)
    }
    this.tidy(ref)
    for (const other of wanted.values()) this.tidy(other)
    for (const item of current) this.tidy(item.ref)
    return failures
  }

  private addLink(from: ItemRef, to: ItemRef): void {
    const extras = this.mine(from)
    if (!extras.links.some((link) => sameRef(link, to))) extras.links.push({ kind: to.kind, id: to.id })
  }

  private removeLink(from: ItemRef, to: ItemRef): void {
    const extras = this.held(from)
    if (extras !== undefined) extras.links = extras.links.filter((link) => !sameRef(link, to))
  }
}
