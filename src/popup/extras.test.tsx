// @vitest-environment jsdom
// Custom fields, links, match rules, and the names and websites of MFA codes and backup codes, over a fake background: the
// components on their own, then the pages that use them (docs/plans/add-item-format.md).
import { h, type ComponentChild } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import extrasEn from '../../locales/parts/extras.en.json'
import extrasFr from '../../locales/parts/extras.fr.json'
import type * as Send from './send'
import type {
  CustomFieldDefs,
  FieldInput,
  FieldView,
  ItemKind,
  ItemRef,
  LinkedItemView,
} from '../shared/api'
import type { ContactView } from '../shared/keys-api'
import { ToastProvider } from '../shared/ui/components'
import { CodeRow } from './codes'
import { BackupEditPage, CodeEditPage } from './code-edit'
import type { Vault } from './data'
import { EditLogin } from './edit'
import { FieldsEditor, FieldsSection, LinkPicker, LinksSection } from './item-extras'
import { AddContact, ContactPage } from './keys/contacts'
import type { KeysData } from './keys/data'
import {
  backup,
  background,
  button,
  change,
  choose,
  click,
  code,
  input,
  installChrome,
  login,
  mount,
  selectOf,
  settings,
  settle,
  submit,
  switchOf,
  text,
  toggle,
  unlockedHandlers,
  unmountAll,
} from './testing'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('./testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

/** The strings of this stream, with their `{name}` placeholders filled in order of first appearance. */
const say = (lang: 'en' | 'fr', name: string, ...subs: (string | number)[]): string => {
  const raw = ((lang === 'en' ? extrasEn : extrasFr) as Record<string, string>)[name]
  if (raw === undefined) throw new Error(`no string ${name}`)
  const names: string[] = []
  return raw.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
    if (!names.includes(placeholder)) names.push(placeholder)
    return String(subs[names.indexOf(placeholder)] ?? '')
  })
}
const t = (name: string, ...subs: (string | number)[]) => say('en', name, ...subs)

function installStrings(lang: 'en' | 'fr' = 'en') {
  installChrome(lang)
  const base = chrome.i18n.getMessage.bind(chrome.i18n)
  Object.assign(chrome.i18n, {
    getMessage: (name: string, subs?: string | string[]) =>
      name.startsWith('extras_')
        ? say(lang, name, ...(subs === undefined ? [] : Array.isArray(subs) ? subs : [subs]))
        : base(name, subs),
  })
}

beforeEach(() => {
  installStrings()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

const page = (node: ComponentChild) => mount(h(ToastProvider, null, node))

const field = (over: Partial<FieldView> = {}): FieldView => ({
  index: 0,
  name: 'Account no.',
  kind: 'text',
  value: '12-34',
  hasValue: true,
  editable: true,
  ...over,
})

const loginRef: ItemRef = { kind: 'login', id: 'l1' }

const vaultOf = (over: Partial<Vault> = {}): Vault => ({
  codes: [],
  logins: [],
  backups: [],
  settings: settings(),
  notes: [],
  cards: [],
  identities: [],
  reload: async () => undefined,
  ...over,
})

describe('the custom fields on a page', () => {
  const fields = [
    field(),
    field({ index: 1, name: 'PIN', kind: 'hidden', value: undefined }),
    field({ index: 2, name: 'Remote', kind: 'boolean', value: 'true' }),
    field({ index: 3, name: 'Off', kind: 'boolean', value: 'false' }),
    field({ index: 4, name: 'Linked', kind: 'linked', value: undefined, editable: false }),
  ]

  it('shows a text field with Copy, a hidden one as dots until Show, and a checkbox as Yes or No', async () => {
    background.reset({
      revealField: (() => '4321') as never,
      copy: () => undefined,
    })
    const root = await page(h(FieldsSection, { item: loginRef, fields }))
    expect(text(root)).toContain(t('extras_fieldsTitle'))
    expect(text(root)).toContain('Account no.')
    expect(text(root)).toContain('12-34')
    expect(text(root)).toContain(t('extras_yes'))
    expect(text(root)).toContain(t('extras_no'))
    expect(text(root)).not.toContain('4321')

    await click(button(root, t('extras_showField', 'PIN')))
    expect(background.of('revealField')[0]?.args).toEqual({ ref: loginRef, index: 1 })
    expect(text(root)).toContain('4321')

    await click(button(root, t('extras_copyField', 'Account no.')))
    expect(background.of('copy')[0]?.args).toEqual({ what: 'field', ref: loginRef, index: 0 })
    expect(button(root, t('extras_copyField', 'Remote'))).toBeNull()
  })

  it('says nothing when there is none', async () => {
    const root = await page(h(FieldsSection, { item: loginRef, fields: [] }))
    expect(text(root)).toBe('')
  })
})

/** A form's fields held in state, as a page holds them. */
function Fields(props: {
  kind: ItemKind
  start: FieldInput[]
  views?: FieldView[]
  seen: { value: FieldInput[] }
}) {
  const [value, setValue] = useState(props.start)
  props.seen.value = value
  return h(FieldsEditor, {
    kind: props.kind,
    value,
    fields: props.views ?? [],
    onChange: setValue,
  })
}

const defs: CustomFieldDefs = {
  fields: [
    { id: 'a1', name: 'Employee id', type: 'text', kinds: ['login'] },
    { id: 'a2', name: 'Badge', type: 'checkbox', kinds: 'all' },
    { id: 'a3', name: 'Only notes', type: 'text', kinds: ['note'] },
  ],
  allowOwn: true,
}

const pick = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button.extras-pick')].find((element) =>
    element.textContent?.includes(name),
  ) ?? null

describe('the custom fields editor', () => {
  it('adds the admin’s fields for this kind once each, and a field of your own', async () => {
    background.reset({ customFieldDefs: (() => defs) as never })
    const seen = { value: [] as FieldInput[] }
    const root = await page(h(Fields, { kind: 'login', start: [], seen }))
    expect(text(root)).toContain(t('extras_noFields'))

    await click(button(root, t('extras_addField')))
    expect(pick(root, 'Employee id')).not.toBeNull()
    expect(pick(root, 'Badge')).not.toBeNull()
    expect(pick(root, 'Only notes')).toBeNull()
    await click(pick(root, 'Employee id'))
    expect(seen.value).toEqual([{ name: 'Employee id', kind: 'text', value: '', adminField: 'a1' }])
    expect(text(root)).toContain(t('extras_admin'))

    await change(input(root, t('extras_fieldValue')), 'E-77')
    expect(seen.value[0]?.value).toBe('E-77')

    await click(button(root, t('extras_addField')))
    expect(pick(root, 'Employee id')).toBeNull()
    await click(pick(root, t('extras_ownField')))
    expect(seen.value).toHaveLength(2)
    await change(input(root, t('extras_fieldNameN', 2)), 'Remote')
    await choose(selectOf(root, t('extras_fieldTypeN', 2)), 'boolean')
    expect(seen.value[1]).toMatchObject({ name: 'Remote', kind: 'boolean', value: 'false' })
    await toggle(switchOf(root, t('extras_fieldValueN', 2)), true)
    expect(seen.value[1]).toMatchObject({ value: 'true' })

    await click(button(root, t('extras_removeField', 'Remote')))
    expect(seen.value).toHaveLength(1)
  })

  it('offers no field of your own when an admin turned them off', async () => {
    background.reset({ customFieldDefs: (() => ({ fields: [], allowOwn: false })) as never })
    const root = await page(h(Fields, { kind: 'login', start: [], seen: { value: [] } }))
    expect(button(root, t('extras_addField'))).toBeNull()
    expect(text(root)).toContain(t('extras_fieldsHintAdmin'))
  })

  it('keeps a hidden value it never read, until something is typed over it', async () => {
    background.reset({ customFieldDefs: (() => defs) as never })
    const seen = { value: [] as FieldInput[] }
    const start: FieldInput[] = [{ origin: 3, name: 'PIN', kind: 'hidden', keepValue: true }]
    const root = await page(h(Fields, { kind: 'login', start, seen }))
    const box = input(root, t('extras_fieldValueN', 1))
    expect(box?.placeholder).toBe(t('extras_keptValue'))
    expect(seen.value[0]?.keepValue).toBe(true)
    await change(box, '9999')
    expect(seen.value).toEqual([{ origin: 3, name: 'PIN', kind: 'hidden', value: '9999' }])
  })

  it('counts the fields it can’t edit and leaves them out', async () => {
    background.reset({ customFieldDefs: (() => defs) as never })
    const views = [field({ index: 0, kind: 'linked', editable: false })]
    const root = await page(h(Fields, { kind: 'login', start: [], views, seen: { value: [] } }))
    expect(text(root)).toContain(t('extras_notEditable', 1))
  })
})

describe('the links on a page', () => {
  const linked: LinkedItemView[] = [
    { ref: { kind: 'note', id: 'n1' }, name: 'Wi-Fi', detail: '2 files' },
    { ref: { kind: 'otp', id: 'c1' }, name: 'Orbit Cloud', halfMade: true },
  ]

  it('lists the linked items, opens one, and unlinks one from both ends', async () => {
    background.reset({
      linkedItems: (() => linked) as never,
      setLinks: (() => ({ linkFailures: [] })) as never,
    })
    const opened: unknown[] = []
    const root = await page(
      h(LinksSection, { item: loginRef, onRoute: (route: unknown) => opened.push(route) }),
    )
    expect(text(root)).toContain(t('extras_linksTitle'))
    expect(text(root)).toContain('Wi-Fi')
    expect(text(root)).toContain(t('extras_oneWay'))

    await click(button(root, t('extras_openLinked', 'Wi-Fi')))
    expect(opened).toEqual([{ name: 'note', id: 'n1' }])

    await click(button(root, t('extras_unlinkOf', 'Wi-Fi')))
    expect(background.of('setLinks')[0]?.args).toEqual({
      ref: loginRef,
      refs: [{ kind: 'otp', id: 'c1' }],
    })
  })

  it('says nothing when nothing is linked', async () => {
    background.reset({ linkedItems: (() => []) as never })
    const root = await page(h(LinksSection, { item: loginRef }))
    expect(text(root)).toBe('')
  })
})

function Picker(props: { start: ItemRef[]; seen: { value: ItemRef[] } }) {
  const [value, setValue] = useState(props.start)
  props.seen.value = value
  return h(LinkPicker, { item: loginRef, value, onChange: setValue })
}

describe('the link picker', () => {
  const wifi: LinkedItemView = { ref: { kind: 'note', id: 'n1' }, name: 'Wi-Fi', detail: '2 files' }
  const visa: LinkedItemView = { ref: { kind: 'card', id: 'k1' }, name: 'Everyday Visa' }

  it('searches the other items, links one, and unlinks it again', async () => {
    background.reset({
      linkedItems: (() => []) as never,
      linkCandidates: ((args: { query: string }) =>
        [wifi, visa].filter((view) =>
          view.name.toLowerCase().includes(args.query.toLowerCase()),
        )) as never,
    })
    const seen = { value: [] as ItemRef[] }
    const root = await page(h(Picker, { start: [], seen }))
    expect(text(root)).toContain(t('extras_noLinks'))

    await click(button(root, t('extras_linkAnItem')))
    expect(background.of('linkCandidates')[0]?.args).toEqual({ ref: loginRef, query: '' })
    expect(pick(root, 'Wi-Fi')).not.toBeNull()
    expect(pick(root, 'Everyday Visa')).not.toBeNull()

    await change(input(root, t('extras_searchItems')), 'visa')
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 260)))
    await settle()
    expect(background.of('linkCandidates').at(-1)?.args).toEqual({ ref: loginRef, query: 'visa' })
    expect(pick(root, 'Wi-Fi')).toBeNull()

    await click(pick(root, 'Everyday Visa'))
    expect(seen.value).toEqual([{ kind: 'card', id: 'k1' }])
    expect(text(root)).toContain('Everyday Visa')

    await click(button(root, t('extras_unlinkOf', 'Everyday Visa')))
    expect(seen.value).toEqual([])
  })

  it('names what is linked already, and says so for an item it can’t name', async () => {
    background.reset({ linkedItems: (() => [wifi]) as never })
    const seen = { value: [] as ItemRef[] }
    const start = [wifi.ref, { kind: 'file', id: 'f9' } as ItemRef]
    const root = await page(h(Picker, { start, seen }))
    expect(text(root)).toContain('Wi-Fi')
    expect(text(root)).toContain(t('extras_missing'))
  })
})

describe('a login’s page of websites and rules', () => {
  const open = async (over: Parameters<typeof login>[0] = {}) => {
    const item = login({
      fields: [
        field({ index: 0, name: 'Account no.', value: '12-34' }),
        field({ index: 1, name: 'PIN', kind: 'hidden', value: undefined }),
      ],
      links: 0,
      websiteRules: [{ uri: 'https://orbit-cloud.com', match: 'host' }],
      ...over,
    } as never)
    background.reset({
      ...unlockedHandlers({ logins: [item] }),
      showPassword: (() => 'pw') as never,
      customFieldDefs: (() => defs) as never,
      revealFields: (() => [{ index: 1, value: '4321' }]) as never,
      linkedItems: (() => []) as never,
      saveLogin: (() => item) as never,
    })
    const root = await page(
      h(EditLogin, {
        id: 'l1',
        vault: vaultOf({ logins: [item] }),
        onBack: () => undefined,
        onSaved: () => undefined,
      }),
    )
    return root
  }
  const saved = () =>
    (background.of('saveLogin')[0]?.args as { input: Record<string, unknown> }).input

  it('saves the rules, and sends no fields or links it was not asked to change', async () => {
    const root = await open()
    expect(selectOf(root, t('extras_ruleOfN', 1))?.value).toBe('host')
    await submit(root.querySelector('form'))
    const input = saved()
    expect(input.websiteRules).toEqual([{ uri: 'https://orbit-cloud.com', match: 'host' }])
    expect(input.websites).toEqual(['https://orbit-cloud.com'])
    expect('fields' in input).toBe(false)
    expect('links' in input).toBe(false)
  })

  it('sends the fields once one is changed, hidden values read for the form included', async () => {
    const root = await open()
    await change(input(root, t('extras_fieldValueN', 1)), '56-78')
    await submit(root.querySelector('form'))
    expect(saved().fields).toEqual([
      { origin: 0, name: 'Account no.', kind: 'text', value: '56-78' },
      { origin: 1, name: 'PIN', kind: 'hidden', value: '4321' },
    ])
  })

  it('refuses a website that is no address, and a regular expression that isn’t one', async () => {
    const root = await open()
    await change(input(root, 'Website'), 'javascript:alert(1)')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('extras_siteBad'))
    expect(background.of('saveLogin')).toHaveLength(0)

    await choose(selectOf(root, t('extras_ruleOfN', 1)), 'regex')
    await change(input(root, 'Website'), 'a(b')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('extras_siteBadRegex'))
    expect(background.of('saveLogin')).toHaveLength(0)
  })

  it('keeps a regular expression out of the plain websites', async () => {
    const root = await open()
    await choose(selectOf(root, t('extras_ruleOfN', 1)), 'regex')
    await change(input(root, 'Website'), '^https://orbit\\.[a-z]+/')
    await submit(root.querySelector('form'))
    expect(saved().websiteRules).toEqual([{ uri: '^https://orbit\\.[a-z]+/', match: 'regex' }])
    expect(saved().websites).toEqual([])
  })
})

describe('an MFA code’s page of details', () => {
  const open = async (over: Parameters<typeof code>[0] = {}) => {
    const item = code({ fields: [], links: 0, ownWebsites: [], ...over } as never)
    background.reset({
      ...unlockedHandlers({ codes: [item] }),
      customFieldDefs: (() => defs) as never,
      revealFields: (() => []) as never,
      linkedItems: (() => [{ ref: { kind: 'login', id: 'l1' }, name: 'Orbit login' }]) as never,
      saveCode: (() => item) as never,
    })
    return page(
      h(CodeEditPage, { id: 'c1', vault: vaultOf({ codes: [item] }), onBack: () => undefined }),
    )
  }

  it('shows the websites a linked item lends, and says where to change them', async () => {
    const root = await open({
      websites: ['orbit-cloud.com'],
      websitesFrom: [{ kind: 'login', id: 'l1' }],
    })
    expect(text(root)).toContain('orbit-cloud.com')
    expect(text(root)).toContain(t('extras_websitesFrom', 'Orbit login'))
    expect(input(root, 'Website')).toBeNull()
    await change(input(root, 'Name'), 'Work VPN')
    await submit(root.querySelector('form'))
    expect(background.of('saveCode')[0]?.args).toEqual({ id: 'c1', input: { name: 'Work VPN' } })
  })

  it('edits its own websites, and sends only what changed', async () => {
    const root = await open({ ownWebsites: ['orbit-cloud.com'], websites: ['orbit-cloud.com'] })
    await change(input(root, 'Website'), 'orbit.example')
    await submit(root.querySelector('form'))
    expect(background.of('saveCode')[0]?.args).toEqual({
      id: 'c1',
      input: { websites: ['orbit.example'] },
    })
  })

  it('shows its name and websites in the list, with a way to edit it', async () => {
    const live = { entries: {}, now: 0, hold: () => undefined }
    const edited: string[] = []
    const root = await page(
      h(CodeRow, {
        code: code({ name: 'Work VPN', websites: ['a.example', 'https://b.example/x'] }),
        live,
        onEdit: (id: string) => edited.push(id),
      }),
    )
    expect(text(root)).toContain('Work VPN')
    expect(text(root)).toContain('a.example · b.example')
    await click(button(root, t('extras_editCodeOf', 'Work VPN')))
    expect(edited).toEqual(['c1'])
  })
})

describe('a service’s backup codes page of details', () => {
  it('saves the name and the websites, and nothing it was not asked to change', async () => {
    const item = backup({ fields: [], links: 0, websites: [] } as never)
    background.reset({
      customFieldDefs: (() => defs) as never,
      linkedItems: (() => []) as never,
      saveBackupCodes: (() => item) as never,
    })
    const root = await page(
      h(BackupEditPage, { id: 'c1', vault: vaultOf({ backups: [item] }), onBack: () => undefined }),
    )
    await change(input(root, 'Name'), 'Orbit spare')
    await change(input(root, 'Website'), 'orbit-cloud.com')
    await submit(root.querySelector('form'))
    expect(background.of('saveBackupCodes')[0]?.args).toEqual({
      serviceId: 'c1',
      input: { name: 'Orbit spare', websites: ['orbit-cloud.com'] },
    })
  })
})

describe('a contact with details and no key', () => {
  const ada = (over: Partial<ContactView> = {}): ContactView =>
    ({
      id: 'p1',
      name: 'Ada Lovelace',
      fingerprint: '1FCD A135',
      line: 'ada@example.org',
      userIds: ['Ada <ada@example.org>'],
      source: 'paste',
      checked: false,
      uncheckedAddresses: [],
      standing: 'ok',
      canEncrypt: true,
      addedAt: 1,
      fields: [],
      links: 0,
      hasKey: true,
      ...over,
    }) as ContactView

  const data = (contacts: ContactView[]): KeysData => ({
    keys: [],
    contacts,
    reload: async () => undefined,
  })

  it('shows its details, and no fingerprint or comparison to make', async () => {
    const plain = ada({
      hasKey: false,
      fingerprint: '',
      company: 'Analytical Engines',
      email: 'ada@example.org',
      phone: '+44 20 7946 0000',
      address: '1 Orbit Way',
    })
    background.reset({
      customFieldDefs: (() => defs) as never,
      linkedItems: (() => []) as never,
      contactPublic: (() => {
        throw new Error('failed')
      }) as never,
    })
    const root = await page(
      h(ContactPage, {
        id: 'p1',
        data: data([plain]),
        onBack: () => undefined,
        onRoute: () => undefined,
      }),
    )
    expect(text(root)).toContain('Analytical Engines')
    expect(text(root)).toContain('ada@example.org')
    expect(text(root)).toContain('+44 20 7946 0000')
    expect(text(root)).toContain(t('extras_contactNoKeyNote'))
    expect(text(root)).not.toContain('Fingerprint')
    expect(button(root, 'I compared it')).toBeNull()
  })

  it('saves only the details that changed', async () => {
    background.reset({
      customFieldDefs: (() => defs) as never,
      linkedItems: (() => []) as never,
      contactPublic: (() => ({ pem: 'x', fileName: 'x.asc' })) as never,
      saveContact: (() => ada()) as never,
    })
    const root = await page(
      h(ContactPage, {
        id: 'p1',
        data: data([ada({ company: 'Analytical Engines' })]),
        onBack: () => undefined,
        onRoute: () => undefined,
      }),
    )
    await change(input(root, 'Company'), 'Babbage & Co')
    await submit(root.querySelector('form.keys-form'))
    expect(background.of('saveContact')[0]?.args).toEqual({ id: 'p1', company: 'Babbage & Co' })
  })

  it('is added from a name and details alone', async () => {
    const added: (string | null)[] = []
    background.reset({
      customFieldDefs: (() => defs) as never,
      saveContact: (() => ada({ id: 'p2', hasKey: false })) as never,
    })
    const root = await page(
      h(AddContact, {
        data: data([]),
        onBack: () => undefined,
        onAdded: (id: string | null) => added.push(id),
      }),
    )
    await click(button(root, t('extras_contactNoKey')))
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('extras_contactNeedsName'))
    expect(background.of('saveContact')).toHaveLength(0)

    await change(input(root, 'Name'), 'Pat Lee')
    await change(input(root, 'Email'), 'not an address')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(t('extras_emailBad'))

    await change(input(root, 'Email'), 'pat@example.org')
    await submit(root.querySelector('form'))
    expect(background.of('saveContact')[0]?.args).toEqual({
      id: null,
      name: 'Pat Lee',
      email: 'pat@example.org',
    })
    expect(added).toEqual(['p2'])
  })
})

describe('in French', () => {
  it('says the fields and links in French', async () => {
    installStrings('fr')
    background.reset({ linkedItems: (() => []) as never, customFieldDefs: (() => defs) as never })
    const root = await page(h(Fields, { kind: 'login', start: [], seen: { value: [] } }))
    expect(text(root)).toContain(say('fr', 'extras_fieldsTitle'))
    expect(button(root, say('fr', 'extras_addField'))).not.toBeNull()
  })
})
