// Helpers for the popup's tests: a fake background behind `ask`, a fake `chrome`, and a few DOM
// helpers over Preact's `act`. Nothing here is imported by the popup itself.
import { render, type ComponentChild } from 'preact'
import { act } from 'preact/test-utils'
import { vi } from 'vitest'
import baseEn from '../../locales/en.json'
import baseFr from '../../locales/fr.json'
import appEn from '../../locales/app/en.json'
import appFr from '../../locales/app/fr.json'
import popupEn from '../../locales/parts/popup.en.json'
import popupFr from '../../locales/parts/popup.fr.json'
import spacesEn from '../../locales/parts/spaces.en.json'
import spacesFr from '../../locales/parts/spaces.fr.json'
import toolsEn from '../../locales/parts/tools.en.json'
import toolsFr from '../../locales/parts/tools.fr.json'
import passkeysEn from '../../locales/parts/passkeys.en.json'
import passkeysFr from '../../locales/parts/passkeys.fr.json'
import itemsEn from '../../locales/parts/items.en.json'
import itemsFr from '../../locales/parts/items.fr.json'
import transferEn from '../../locales/parts/transfer.en.json'
import transferFr from '../../locales/parts/transfer.fr.json'
import accountEn from '../../locales/parts/account.en.json'
import accountFr from '../../locales/parts/account.fr.json'
import unlockEn from '../../locales/parts/unlock.en.json'
import unlockFr from '../../locales/parts/unlock.fr.json'
import keysEn from '../../locales/parts/keys.en.json'
import keysFr from '../../locales/parts/keys.fr.json'
import sendsEn from '../../locales/parts/sends.en.json'
import sendsFr from '../../locales/parts/sends.fr.json'
import safariEn from '../../locales/parts/safari.en.json'
import safariFr from '../../locales/parts/safari.fr.json'
import type {
  BackupCodeView,
  CardView,
  CodeView,
  IdentityView,
  LiveCode,
  LoginView,
  NoteView,
  PageApi,
  PopupView,
  Settings,
  SyncStatus,
  VaultState,
} from '../shared/api'
import { lockChannel } from '../shared/vault-lock-testing'

/* The test run */

// A full run starts dozens of jsdom workers at once, so a test that takes a fraction of a second
// alone can take seconds then. Give the popup's tests room, and wake the date formatters (their
// first use loads the language data) before any test's clock starts.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
for (const language of ['en', 'fr']) {
  new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(0)
}

/* The background */

type Handler = (args: never) => unknown

export interface Call {
  kind: string
  args: Record<string, unknown>
}

/** Answers `ask` from handlers by kind; a kind with no handler fails like an unsupported one. */
export class FakeBackground {
  calls: Call[] = []
  /** Asks sent and not yet answered, so a test knows when the popup is quiet. */
  pending = 0
  handlers: Partial<Record<keyof PageApi, Handler>> = {}

  reset(handlers: Partial<Record<keyof PageApi, Handler>> = {}): void {
    this.calls = []
    this.pending = 0
    this.handlers = handlers
  }

  set(handlers: Partial<Record<keyof PageApi, Handler>>): void {
    this.handlers = { ...this.handlers, ...handlers }
  }

  ask = async (kind: string, args?: Record<string, unknown>): Promise<unknown> => {
    this.calls.push({ kind, args: args ?? {} })
    this.pending += 1
    try {
      const handler = this.handlers[kind as keyof PageApi]
      if (handler === undefined) throw new Error('unsupported')
      return await handler((args ?? {}) as never)
    } finally {
      this.pending -= 1
    }
  }

  /** The calls of one kind, in order. */
  of(kind: keyof PageApi): Call[] {
    return this.calls.filter((call) => call.kind === kind)
  }
}

export const background = new FakeBackground()

/* Fixtures */

export const settings = (over: Partial<Settings> = {}): Settings => ({
  autoLockMinutes: 5,
  lockOnSleep: true,
  codeAfterPassword: true,
  buttonsOnPages: false,
  breachedPasswords: false,
  offerToSave: true,
  clipboardSeconds: 30,
  ...over,
})

export const vaultState = (over: Partial<VaultState> = {}): VaultState => ({
  exists: true,
  unlocked: true,
  wrongPasswords: 0,
  ...over,
})

export const code = (over: Partial<CodeView> = {}): CodeView => ({
  id: 'c1',
  issuer: 'Orbit Cloud',
  account: 'sam@example.com',
  type: 'totp',
  digits: 6,
  period: 30,
  tags: [],
  order: 0,
  onSecurityKey: false,
  websites: ['orbit-cloud.com'],
  ...over,
})

export const login = (over: Partial<LoginView> = {}): LoginView => ({
  id: 'l1',
  name: 'Orbit Cloud',
  username: 'sam@example.com',
  websites: ['https://orbit-cloud.com'],
  tags: [],
  order: 0,
  hasPassword: true,
  strength: 3,
  previousPasswords: 0,
  health: { reused: false, weak: false, withoutItsCode: false, ignored: false },
  ...over,
})

export const backup = (over: Partial<BackupCodeView> = {}): BackupCodeView => ({
  serviceId: 'c1',
  issuer: 'Orbit Cloud',
  total: 10,
  left: 8,
  ...over,
})

export const note = (over: Partial<NoteView> = {}): NoteView => ({
  id: 'n1',
  title: 'Wi-Fi',
  tags: [],
  order: 0,
  pinned: false,
  files: 0,
  changedAt: 1,
  ...over,
})

export const card = (over: Partial<CardView> = {}): CardView => ({
  id: 'k1',
  name: 'Everyday Visa',
  cardholder: 'Sam Rivera',
  brand: 'Visa',
  lastFour: '1111',
  expMonth: 5,
  expYear: 2029,
  expired: false,
  hasNumber: true,
  hasCode: true,
  hasPin: false,
  tags: [],
  order: 0,
  pinned: false,
  changedAt: 1,
  ...over,
})

export const identity = (over: Partial<IdentityView> = {}): IdentityView => ({
  id: 'i1',
  name: 'Me',
  givenName: 'Sam',
  familyName: 'Rivera',
  fullName: 'Sam Rivera',
  email: 'sam@example.com',
  documents: [],
  tags: [],
  order: 0,
  pinned: false,
  changedAt: 1,
  ...over,
})

export const syncStatus = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  place: 'webdav',
  server: 'https://dav.example.com/kemlock',
  running: false,
  ...over,
})

export interface World {
  state?: VaultState
  tab?: PopupView['tab']
  codes?: CodeView[]
  logins?: LoginView[]
  backups?: BackupCodeView[]
  settings?: Settings
  notes?: NoteView[]
  cards?: CardView[]
  identities?: IdentityView[]
  /** The live code each id shows; every code shows 123456 ending in 20 seconds by default. */
  live?: (id: string, now: number) => LiveCode
}

/** The handlers of an unlocked vault, over fixtures; tests add or replace handlers by kind. */
export function unlockedHandlers(world: World = {}): Partial<Record<keyof PageApi, Handler>> {
  const handlers: Partial<Record<keyof PageApi, Handler>> = {
    popup: () => ({ state: world.state ?? vaultState(), tab: world.tab }),
    pageState: () => world.state ?? vaultState(),
    codes: () => world.codes ?? [],
    logins: () => world.logins ?? [],
    backupCodes: () => world.backups ?? [],
    settings: () => world.settings ?? settings(),
    notes: () => world.notes ?? [],
    cards: () => world.cards ?? [],
    identities: () => world.identities ?? [],
    liveCodes: ((args: { ids: string[] }) =>
      args.ids.map(
        (id) =>
          world.live?.(id, Date.now()) ?? { id, code: '123456', expiresAt: Date.now() + 20_000 },
      )) as Handler,
    nextCodes: ((args: { ids: string[] }) =>
      args.ids.map((id) => ({ id, code: '654321' }))) as Handler,
    copy: () => undefined,
    fill: () => undefined,
    lock: () => undefined,
    rememberedSites: () => [],
    allSitesGranted: () => false,
    syncStatus: () => null,
  }
  return handlers
}

/* The browser */

const messageSets = {
  en: {
    ...baseEn,
    ...appEn,
    ...popupEn,
    ...spacesEn,
    ...toolsEn,
    ...passkeysEn,
    ...itemsEn,
    ...transferEn,
    ...accountEn,
    ...unlockEn,
    ...keysEn,
    ...sendsEn,
    ...safariEn,
  } as Record<string, string>,
  fr: {
    ...baseFr,
    ...appFr,
    ...popupFr,
    ...spacesFr,
    ...toolsFr,
    ...passkeysFr,
    ...itemsFr,
    ...transferFr,
    ...accountFr,
    ...unlockFr,
    ...keysFr,
    ...sendsFr,
    ...safariFr,
  } as Record<string, string>,
}

/** The text of a message with its `{name}` placeholders filled in order of first appearance. */
export function message(lang: 'en' | 'fr', name: string, subs: string[] = []): string {
  const text = messageSets[lang][name]
  if (text === undefined) return ''
  const names: string[] = []
  return text.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
    if (!names.includes(placeholder)) names.push(placeholder)
    return subs[names.indexOf(placeholder)] ?? ''
  })
}

export interface FakeChrome {
  tabsCreated: string[]
  permissionRequests: unknown[]
  permissionRemovals: unknown[]
  /** What `permissions.contains` answers. */
  held: boolean
  /** What `permissions.request` answers. */
  grant: boolean
  storage: Record<string, unknown>
  /** The background tells every open page that the vault locked (`useVaultLock` hears it). */
  lock: () => void
  /** How many pages are listening for that message now. */
  listening: () => number
}

/** Puts a fake `chrome` on the global object: i18n, tabs, permissions, storage and runtime. */
export function installChrome(lang: 'en' | 'fr' = 'en'): FakeChrome {
  const channel = lockChannel()
  const fake: FakeChrome = {
    tabsCreated: [],
    permissionRequests: [],
    permissionRemovals: [],
    held: false,
    grant: true,
    storage: {},
    lock: channel.lock,
    listening: channel.listening,
  }
  const chromeLike = {
    i18n: {
      getMessage: (name: string, subs?: string | string[]) =>
        message(lang, name, subs === undefined ? [] : Array.isArray(subs) ? subs : [subs]),
      getUILanguage: () => lang,
    },
    runtime: channel.runtime,
    tabs: {
      create: async (options: { url: string }) => {
        fake.tabsCreated.push(options.url)
      },
    },
    permissions: {
      contains: async () => fake.held,
      request: async (permissions: unknown) => {
        fake.permissionRequests.push(permissions)
        return fake.grant
      },
      remove: async (permissions: unknown) => {
        fake.permissionRemovals.push(permissions)
        return true
      },
    },
    storage: {
      local: {
        get: async (key: string) => (key in fake.storage ? { [key]: fake.storage[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(fake.storage, items)
        },
      },
    },
  }
  Object.assign(globalThis, { chrome: chromeLike })
  return fake
}

/* The DOM */

/** Renders into a fresh element in the document and lets what it started settle. */
export async function mount(node: ComponentChild): Promise<HTMLElement> {
  const root = document.createElement('div')
  document.body.append(root)
  await act(() => {
    render(node, root)
  })
  await settle()
  return root
}

export function unmountAll(): void {
  const children = [...document.body.children]
  // Inside act, so each page's effect cleanups run now, in the test that mounted it, not in the next test's first render
  void act(() => {
    for (const child of children) render(null, child)
  })
  for (const child of children) child.remove()
}

/**
 * Lets pending answers and the renders they cause finish: one step of the popup's chain (an answer,
 * a render, the effects it starts) per round, until the page and the background are quiet.
 */
export async function settle(): Promise<void> {
  let before = ''
  let calm = 0
  // A turn of the event loop, not a timer: a timer waits a whole clock tick on Windows.
  const immediate = (globalThis as { setImmediate?: (callback: () => void) => unknown })
    .setImmediate
  const turn = (resolve: () => void) =>
    immediate === undefined ? setTimeout(resolve, 0) : immediate(resolve)
  for (let round = 0; round < 200 && calm < 3; round += 1) {
    await act(async () => {
      await new Promise<void>(turn)
    })
    const now = document.body.innerHTML
    calm = now === before && background.pending === 0 ? calm + 1 : 0
    before = now
  }
}

export async function click(element: Element | null): Promise<void> {
  if (element === null) throw new Error('nothing to click')
  await act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
}

export async function change(element: Element | null, value: string): Promise<void> {
  if (element === null) throw new Error('nothing to type in')
  await act(() => {
    const input = element as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

export async function toggle(element: Element | null, checked: boolean): Promise<void> {
  if (element === null) throw new Error('nothing to toggle')
  await act(() => {
    const input = element as HTMLInputElement
    input.checked = checked
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

export async function submit(form: Element | null): Promise<void> {
  if (form === null) throw new Error('nothing to submit')
  await act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle()
}

/** The first button (or link) whose accessible name or text equals `name`. */
export function button(root: ParentNode, name: string): HTMLButtonElement | null {
  const all = [...root.querySelectorAll<HTMLButtonElement>('button')]
  return (
    all.find(
      (element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === name,
    ) ??
    all.find((element) => element.textContent?.trim() === name) ??
    null
  )
}

export function input(root: ParentNode, label: string): HTMLInputElement | null {
  const labels = [...root.querySelectorAll('label')]
  const found = labels.find((element) => element.textContent?.trim() === label)
  if (found?.htmlFor) return root.querySelector<HTMLInputElement>(`[id="${found.htmlFor}"]`)
  return root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
}

/** The switch whose label is `label`. */
export function switchOf(root: ParentNode, label: string): HTMLInputElement | null {
  const row = [...root.querySelectorAll('label.switch')].find(
    (element) => element.querySelector('.strong')?.textContent?.trim() === label,
  )
  return row?.querySelector<HTMLInputElement>('input') ?? null
}

/** The select whose label is `label`. */
export function selectOf(root: ParentNode, label: string): HTMLSelectElement | null {
  const field = [...root.querySelectorAll('.field')].find(
    (element) => element.querySelector('label')?.textContent?.trim() === label,
  )
  return field?.querySelector<HTMLSelectElement>('select') ?? null
}

export async function choose(select: HTMLSelectElement | null, value: string): Promise<void> {
  if (select === null) throw new Error('nothing to choose from')
  await act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

export const text = (root: ParentNode): string =>
  root.textContent?.replace(/\s+/g, ' ').trim() ?? ''
