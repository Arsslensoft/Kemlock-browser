// A small `chrome.*` for the background's tests: just what the background calls, in memory, with the
// calls recorded and the events fireable. `installChromeMock()` puts it on `globalThis.chrome`.

export class MockEvent<A extends unknown[] = unknown[]> {
  readonly listeners: ((...args: A) => unknown)[] = []
  addListener = (listener: (...args: A) => unknown) => {
    this.listeners.push(listener)
  }
  removeListener = (listener: (...args: A) => unknown) => {
    const index = this.listeners.indexOf(listener)
    if (index >= 0) this.listeners.splice(index, 1)
  }
  hasListener = (listener: (...args: A) => unknown) => this.listeners.includes(listener)
  /** Calls the listeners, and gives what they returned. */
  async fire(...args: A): Promise<unknown[]> {
    return Promise.all(this.listeners.map((listener) => listener(...args)))
  }
}

export interface MockTab {
  id: number
  url?: string
  active?: boolean
  windowId?: number
}

export interface SentToTab {
  tabId: number
  message: unknown
  options?: { frameId?: number; documentId?: string }
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

export interface ChromeMock {
  chrome: typeof chrome
  /** The two storage areas. */
  local: Map<string, unknown>
  session: Map<string, unknown>
  sessionAccessLevel: string | undefined
  alarms: Map<string, { when?: number; periodInMinutes?: number; delayInMinutes?: number }>
  /** The icon's last paths, the toolbar's text and colour, per tab or (key -1) for all. */
  icons: string[]
  badgeText: Map<number, string>
  badgeColor: Map<number, string>
  menus: Map<string, chrome.contextMenus.CreateProperties>
  tabs: Map<number, MockTab>
  /** Every `tabs.sendMessage`, and what a tab answers with (set `tabReply`). */
  sentToTabs: SentToTab[]
  tabReply: (sent: SentToTab) => unknown
  /** `scripting.executeScript` targets, and the content scripts registered. */
  injected: { tabId: number; frameIds?: number[]; files?: string[] }[]
  /** Called on each `executeScript`, to make the content script report as it would. */
  onInject: (injection: { tabId: number; frameIds?: number[] }) => void | Promise<void>
  registered: Map<string, chrome.scripting.RegisteredContentScript>
  /** The origins and permissions the extension holds. */
  granted: Set<string>
  /** Whether an offscreen document is open, and the clipboard it and Firefox's page write. */
  offscreen: { open: boolean; created: number }
  clipboard: string
  /** `runtime.sendMessage` calls (the background to its own pages). */
  runtimeMessages: unknown[]
  /** The notifications shown (by id), and the addresses `tabs.create` opened. */
  notifications: Map<string, chrome.notifications.NotificationCreateOptions>
  createdTabs: string[]
  /** What `identity.launchWebAuthFlow` answers (an address), or throws when it is an Error. */
  authReply: string | Error | undefined
  authCalls: { url: string; interactive: boolean }[]
  captured: string
  messages: Record<string, string>
  events: {
    onMessage: MockEvent
    onInstalled: MockEvent
    onStartup: MockEvent
    onAlarm: MockEvent<[chrome.alarms.Alarm]>
    onIdle: MockEvent<[string]>
    onMenuClicked: MockEvent<[chrome.contextMenus.OnClickData, chrome.tabs.Tab | undefined]>
    onTabUpdated: MockEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>
    onTabActivated: MockEvent<[chrome.tabs.OnActivatedInfo]>
    onTabRemoved: MockEvent<[number, chrome.tabs.OnRemovedInfo]>
    onPermissionAdded: MockEvent
    onPermissionRemoved: MockEvent
  }
  uninstall(): void
}

/** A page's clipboard, as the offscreen document answers. */
function offscreenReply(mock: ChromeMock, message: unknown): unknown {
  const m = message as { target?: string; kind?: string; value?: string }
  if (m.target !== 'offscreen') return undefined
  if (m.kind === 'write') mock.clipboard = m.value ?? ''
  if (m.kind === 'read') return { ok: true, value: mock.clipboard }
  return { ok: true }
}

export function installChromeMock(): ChromeMock {
  const events: ChromeMock['events'] = {
    onMessage: new MockEvent(),
    onInstalled: new MockEvent(),
    onStartup: new MockEvent(),
    onAlarm: new MockEvent(),
    onIdle: new MockEvent(),
    onMenuClicked: new MockEvent(),
    onTabUpdated: new MockEvent(),
    onTabActivated: new MockEvent(),
    onTabRemoved: new MockEvent(),
    onPermissionAdded: new MockEvent(),
    onPermissionRemoved: new MockEvent(),
  }
  const mock = {
    local: new Map<string, unknown>(),
    session: new Map<string, unknown>(),
    sessionAccessLevel: undefined as string | undefined,
    alarms: new Map(),
    icons: [] as string[],
    badgeText: new Map<number, string>(),
    badgeColor: new Map<number, string>(),
    menus: new Map(),
    tabs: new Map<number, MockTab>(),
    sentToTabs: [] as SentToTab[],
    tabReply: (() => undefined) as (sent: SentToTab) => unknown,
    injected: [] as ChromeMock['injected'],
    onInject: (() => undefined) as ChromeMock['onInject'],
    registered: new Map(),
    granted: new Set<string>(),
    offscreen: { open: false, created: 0 },
    clipboard: '',
    runtimeMessages: [] as unknown[],
    notifications: new Map<string, chrome.notifications.NotificationCreateOptions>(),
    createdTabs: [] as string[],
    authReply: undefined as string | Error | undefined,
    authCalls: [] as { url: string; interactive: boolean }[],
    captured: 'data:image/png;kemlock-fake-qr,',
    messages: {} as Record<string, string>,
    events,
  } as unknown as ChromeMock

  const area = (store: Map<string, unknown>) => ({
    get: async (keys?: string | string[] | null) => {
      const wanted = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(
        wanted.filter((key) => store.has(key)).map((key) => [key, clone(store.get(key))]),
      )
    },
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) store.set(key, clone(value))
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key)
    },
    clear: async () => store.clear(),
  })

  const matchesTab = (tab: MockTab, query: chrome.tabs.QueryInfo) =>
    query.active === undefined || Boolean(tab.active) === query.active

  const fake = {
    runtime: {
      id: 'kemlockid',
      getURL: (path: string) => `chrome-extension://kemlockid/${path}`,
      onMessage: events.onMessage,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      sendMessage: async (message: unknown) => {
        mock.runtimeMessages.push(message)
        return offscreenReply(mock, message)
      },
    },
    storage: {
      local: area(mock.local),
      session: {
        ...area(mock.session),
        setAccessLevel: async ({ accessLevel }: { accessLevel: string }) => {
          mock.sessionAccessLevel = accessLevel
        },
      },
    },
    alarms: {
      onAlarm: events.onAlarm,
      create: async (name: string, info: object) => {
        mock.alarms.set(name, { ...info })
      },
      clear: async (name: string) => mock.alarms.delete(name),
      clearAll: async () => {
        mock.alarms.clear()
        return true
      },
      getAll: async () => [...mock.alarms.keys()].map((name) => ({ name })),
    },
    idle: { onStateChanged: events.onIdle },
    action: {
      setIcon: async ({ path }: { path: Record<string, string> }) => {
        mock.icons.push(path['16'])
      },
      setBadgeText: async ({ text, tabId }: { text: string; tabId?: number }) => {
        mock.badgeText.set(tabId ?? -1, text)
      },
      setBadgeBackgroundColor: async ({ color, tabId }: { color: string; tabId?: number }) => {
        mock.badgeColor.set(tabId ?? -1, color)
      },
    },
    contextMenus: {
      onClicked: events.onMenuClicked,
      removeAll: async () => mock.menus.clear(),
      create: (props: chrome.contextMenus.CreateProperties) => {
        mock.menus.set(String(props.id), props)
        return props.id
      },
    },
    tabs: {
      onUpdated: events.onTabUpdated,
      onActivated: events.onTabActivated,
      onRemoved: events.onTabRemoved,
      query: async (query: chrome.tabs.QueryInfo) =>
        [...mock.tabs.values()].filter((tab) => matchesTab(tab, query)),
      get: async (tabId: number) => {
        const tab = mock.tabs.get(tabId)
        if (tab === undefined) throw new Error(`No tab with id: ${tabId}`)
        return tab
      },
      sendMessage: async (tabId: number, message: unknown, options?: SentToTab['options']) => {
        const sent = { tabId, message: clone(message), options }
        mock.sentToTabs.push(sent)
        return mock.tabReply(sent)
      },
      captureVisibleTab: async () => mock.captured,
      create: async ({ url }: { url?: string }) => {
        mock.createdTabs.push(url ?? '')
        return { id: 100 + mock.createdTabs.length }
      },
    },
    notifications: {
      create: async (id: string, options: chrome.notifications.NotificationCreateOptions) => {
        mock.notifications.set(id, options)
        return id
      },
      clear: async (id: string) => mock.notifications.delete(id),
    },
    scripting: {
      executeScript: async (injection: {
        target: { tabId: number; frameIds?: number[] }
        files?: string[]
      }) => {
        const entry = {
          tabId: injection.target.tabId,
          frameIds: injection.target.frameIds,
          files: injection.files,
        }
        mock.injected.push(entry)
        await mock.onInject(entry)
        return []
      },
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        for (const script of scripts) {
          if (mock.registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`)
          mock.registered.set(script.id, script)
        }
      },
      unregisterContentScripts: async (filter?: { ids?: string[] }) => {
        for (const id of filter?.ids ?? [...mock.registered.keys()]) mock.registered.delete(id)
      },
      getRegisteredContentScripts: async (filter?: { ids?: string[] }) =>
        [...mock.registered.values()].filter(
          (script) => filter?.ids === undefined || filter.ids.includes(script.id),
        ),
    },
    permissions: {
      onAdded: events.onPermissionAdded,
      onRemoved: events.onPermissionRemoved,
      contains: async ({ origins = [], permissions = [] }: chrome.permissions.Permissions) =>
        [...origins, ...permissions].every((item) => mock.granted.has(item)),
      remove: async ({ origins = [] }: chrome.permissions.Permissions) => {
        for (const origin of origins) mock.granted.delete(origin)
        return true
      },
    },
    offscreen: {
      createDocument: async () => {
        if (mock.offscreen.open) throw new Error('Only a single offscreen document may be created.')
        mock.offscreen = { open: true, created: mock.offscreen.created + 1 }
      },
      closeDocument: async () => {
        mock.offscreen.open = false
      },
      Reason: { CLIPBOARD: 'CLIPBOARD' },
    },
    identity: {
      getRedirectURL: (path = '') => `https://kemlockid.chromiumapp.org/${path}`,
      launchWebAuthFlow: async ({ url, interactive }: { url: string; interactive: boolean }) => {
        mock.authCalls.push({ url, interactive })
        if (mock.authReply instanceof Error) throw mock.authReply
        return mock.authReply
      },
    },
    i18n: { getMessage: (name: string) => mock.messages[name] ?? name },
  }
  // `runtime.getContexts` tells whether the offscreen document is open (Chrome 116+).
  ;(fake.runtime as Record<string, unknown>).getContexts = async () =>
    mock.offscreen.open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []

  const globals = globalThis as { chrome?: unknown }
  const before = globals.chrome
  globals.chrome = fake
  mock.chrome = fake as unknown as typeof chrome
  mock.uninstall = () => {
    globals.chrome = before
  }
  return mock
}
