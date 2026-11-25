// The test base: launches Chromium with the built extension loaded, over a fixture server that
// answers for every site the tests use. Each test gets a fresh browser profile, so a vault never
// leaks from one test into the next.
//
// The extension comes from dist/chrome (`npm run build`), or from $KEMLOCK_E2E_EXTENSION. It is
// copied to a temporary folder first, and its manifest gets a fixed `key` (extension-key.ts), so the
// extension's id is the same on every run. With `allSites` (the default) the copy's manifest also holds the
// all-sites permission as a granted one: the browser's permission prompt is not something a test
// can click, and "Allow access to all sites" is asked for by the extension, not decided by it.
// The code that runs is the build's, byte for byte, but for those lines of the manifest.
// `test.use({ allSites: false })` loads the stock manifest instead.
import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Frame,
  type Page,
  type TestInfo,
  type Worker,
} from '@playwright/test'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PageApi } from '../../src/shared/api'
import { EXTENSION_KEY } from './extension-key'
import { SiteServer } from './site-server'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const builtExtension = process.env.KEMLOCK_E2E_EXTENSION ?? join(root, 'dist', 'chrome')

/** The hosts of the real servers the run was pointed at: the browser reaches those for real. */
function realServers(): string[] {
  return [process.env.KEMLOCK_SERVER_URL, process.env.VAULTWARDEN_URL].flatMap((url) => {
    try {
      return url ? [new URL(url).hostname] : []
    } catch {
      return []
    }
  })
}

/** The password of the browser's vault in every test. */
export const PASSWORD = 'browser password 1'

/** The login and code the popup and autofill tests share (the spec's own examples). */
export const ORBIT = {
  name: 'Orbit Cloud',
  username: 'sam@example.com',
  password: 'Orbit-Cloud-p4ss!',
  website: 'orbit-cloud.com',
  secret: 'JBSWY3DPEHPK3PXP',
  otpauth:
    'otpauth://totp/Orbit%20Cloud:sam@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Orbit%20Cloud',
}

export type Call = <K extends keyof PageApi>(
  kind: K,
  ...args: Parameters<PageApi[K]>
) => Promise<Awaited<ReturnType<PageApi[K]>>>

export interface LaunchOptions {
  allSites: boolean
  headless: boolean
  slowMo: number
}

/** A running browser with the extension in it. */
export class Kemlock {
  context!: BrowserContext
  worker!: Worker
  id!: string
  private bridgePage?: Page
  private traces: string[] = []

  private constructor(
    readonly site: SiteServer,
    readonly options: LaunchOptions,
    readonly profileDir: string,
    readonly extensionDir: string,
    private readonly testInfo: TestInfo,
  ) {}

  static async launch(
    site: SiteServer,
    options: LaunchOptions,
    testInfo: TestInfo,
  ): Promise<Kemlock> {
    const profileDir = await mkdtemp(join(tmpdir(), 'kemlock-e2e-profile-'))
    const extensionDir = await mkdtemp(join(tmpdir(), 'kemlock-e2e-extension-'))
    await cp(builtExtension, extensionDir, { recursive: true })
    const path = join(extensionDir, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as {
      key?: string
      host_permissions?: string[]
      permissions?: string[]
      optional_permissions?: string[]
    }
    manifest.key = EXTENSION_KEY
    if (options.allSites) {
      manifest.host_permissions = ['<all_urls>']
      // The frame list the passkey switch asks for with all sites, granted the same way (a test can't answer the prompt)
      manifest.permissions = [...(manifest.permissions ?? []), 'webNavigation']
      manifest.optional_permissions = (manifest.optional_permissions ?? []).filter(
        (name) => name !== 'webNavigation',
      )
    }
    await writeFile(path, JSON.stringify(manifest, null, 2))
    const kemlock = new Kemlock(site, options, profileDir, extensionDir, testInfo)
    await kemlock.open()
    return kemlock
  }

  /** Starts the browser on the profile (again, after a restart). */
  private async open(): Promise<void> {
    const { headless } = this.options
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless,
      // New headless is the only one that runs extensions
      ...(headless ? { channel: 'chromium' as const } : {}),
      slowMo: this.options.slowMo,
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      locale: 'en-US',
      args: [
        `--disable-extensions-except=${this.extensionDir}`,
        `--load-extension=${this.extensionDir}`,
        // Every name goes to the fixture server, at the https port the address has
        `--host-resolver-rules=${this.site.resolverRules(realServers())}`,
        '--ignore-certificate-errors',
        // A display scaled to 125% makes a frame the extension shows in a page lay out 1.25 times wider than its box
        '--force-device-scale-factor=1',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-search-engine-choice-screen',
      ],
    })
    await this.context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await this.context.tracing.start({ screenshots: true, snapshots: true })
    this.worker =
      this.context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) ??
      (await this.context.waitForEvent('serviceworker', {
        predicate: (w) => w.url().startsWith('chrome-extension://'),
        timeout: 30_000,
      }))
    this.id = new URL(this.worker.url()).host
    this.bridgePage = undefined
  }

  url(path: string): string {
    return `chrome-extension://${this.id}/${path.replace(/^\//, '')}`
  }

  /** Closes the browser, keeps the profile, opens it again: "the browser restarts". */
  async restart(): Promise<void> {
    await this.saveTrace(`before-restart-${this.traces.length + 1}`, false)
    await this.context.close()
    await this.open()
  }

  /**
   * Stops the extension's service worker, as DevTools' "Stop" does. Nothing of the extension may be
   * open meanwhile: the popup the bridge shows asks the background every second, and a tab being
   * opened or closed is an event the worker wakes for. So the bridge is closed first, the stop is
   * sent from a page that is already there, and the next `call` opens a bridge, which wakes it.
   */
  async stopWorker(): Promise<void> {
    const page =
      this.context.pages().find((p) => !p.url().startsWith('chrome-extension://')) ??
      (await this.context.newPage())
    await this.closeBridge()
    // What closing the bridge woke the worker for is over before it is stopped
    await page.waitForTimeout(1000)
    const cdp = await this.context.newCDPSession(page)
    // Playwright keeps listing a stopped worker in `serviceWorkers()`, so the browser's own word is
    // waited for: its running status turns to "stopped"
    const stopped = new Promise<void>((resolve) => {
      cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        if (
          versions.some(
            (v) =>
              v.scriptURL.startsWith(`chrome-extension://${this.id}/`) &&
              v.runningStatus === 'stopped',
          )
        )
          resolve()
      })
    })
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')
    await Promise.race([
      stopped,
      new Promise((_, fail) =>
        setTimeout(() => fail(new Error('the service worker did not stop')), 10_000),
      ),
    ])
    await cdp.detach()
  }

  private async saveTrace(name: string, attach: boolean): Promise<void> {
    const path = this.testInfo.outputPath(`${name}.zip`)
    try {
      await this.context.tracing.stop({ path })
      this.traces.push(path)
      if (attach)
        await this.testInfo.attach(`trace-${name}`, { path, contentType: 'application/zip' })
    } catch {
      // Tracing was not running: nothing to keep
    }
  }

  private stopped = false

  /** Closes the browser now and keeps the profile on disk, for a test that reads the profile. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await this.saveTrace('trace', this.testInfo.status !== this.testInfo.expectedStatus)
    await this.context.close().catch(() => undefined)
  }

  /**
   * Closes the browser and reads the extension's storage and IndexedDB files from the profile, as
   * someone with the disk would. Returns each needle found, with the file it is in.
   */
  async scanProfile(needles: string[]): Promise<string[]> {
    await this.stop()
    const found: string[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile()) {
          const bytes = await readFile(path).catch(() => Buffer.alloc(0))
          for (const needle of needles) {
            if (
              bytes.includes(Buffer.from(needle, 'utf8')) ||
              bytes.includes(Buffer.from(needle, 'utf16le'))
            ) {
              found.push(`${needle} in ${path}`)
            }
          }
        }
      }
    }
    await walk(join(this.profileDir, 'Default', 'Local Extension Settings'))
    await walk(join(this.profileDir, 'Default', 'IndexedDB'))
    await walk(join(this.profileDir, 'Default', 'Extension State'))
    return found
  }

  /** Ends the test's browser; a failed test keeps its trace (open it with `npx playwright show-trace`). */
  async close(): Promise<void> {
    const failed = this.testInfo.status !== this.testInfo.expectedStatus
    await this.stop()
    await rm(this.extensionDir, { recursive: true, force: true }).catch(() => undefined)
    // The profile stays when the test failed, for a look; it is in the OS's temporary folder
    if (!failed) await rm(this.profileDir, { recursive: true, force: true }).catch(() => undefined)
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Talking to the background, as the extension's own pages do                                  */
  /* ------------------------------------------------------------------------------------------ */

  /** An extension page that stays open in the background, to send the background's requests from. */
  async bridge(): Promise<Page> {
    if (this.bridgePage && !this.bridgePage.isClosed()) return this.bridgePage
    const page = await this.context.newPage()
    await page.goto(this.url('src/popup/index.html'))
    this.bridgePage = page
    return page
  }

  /** Closes the bridge page, for a test that must not use Kemlock at all for a while. */
  async closeBridge(): Promise<void> {
    await this.bridgePage?.close().catch(() => undefined)
    this.bridgePage = undefined
  }

  /** `PageApi`'s requests: `{ kind, ...args }` to the background, answered `{ ok, value }` or `{ ok: false, error }`. */
  call: Call = async (kind, ...args) => {
    const page = await this.bridge()
    const message = { kind, ...(args[0] ?? {}) }
    const answer = await page.evaluate((m) => chrome.runtime.sendMessage(m), message)
    if (answer && typeof answer === 'object' && 'ok' in answer) {
      const { ok, value, error } = answer as { ok: boolean; value: unknown; error?: string }
      if (!ok) throw new Error(`${kind}: ${error ?? 'failed'}`)
      return value as never
    }
    return answer as never
  }

  /** Makes the browser's vault and leaves it unlocked. */
  async createVault(password = PASSWORD): Promise<void> {
    await this.call('createVault', { password })
    const { state } = await this.call('popup')
    if (!state.unlocked) await this.call('unlock', { password })
    if (this.options.allSites) {
      // The permission is in the manifest: say so to the extension, which registers its content scripts on it
      await this.call('allSitesGranted').catch(() => undefined)
      await this.call('saveSettings', { settings: { buttonsOnPages: true } }).catch(() => undefined)
    }
  }

  /** The Orbit Cloud login, with its code linked, as the spec's examples have it. */
  async seedOrbit(): Promise<{ loginId: string; codeId: string }> {
    const login = await this.call('saveLogin', {
      id: null,
      input: {
        name: ORBIT.name,
        username: ORBIT.username,
        password: ORBIT.password,
        websites: [ORBIT.website],
      },
    })
    const code = await this.call('addCodeFromLink', { otpauth: ORBIT.otpauth, linkTo: login.id })
    return { loginId: login.id, codeId: code.id }
  }

  /** What the extension keeps in `storage.local`, as the browser's own API reads it. */
  async storage(area: 'local' | 'session' = 'local'): Promise<Record<string, unknown>> {
    return this.worker.evaluate((a) => chrome.storage[a].get(null), area)
  }

  /** The tab's id, which the popup is told to act on (see `popup`). */
  async tabId(page: Page): Promise<number> {
    await page.bringToFront()
    return this.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return tab.id!
    })
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Pages                                                                                        */
  /* ------------------------------------------------------------------------------------------ */

  /**
   * The popup, opened as a tab (Playwright can't drive the toolbar's own popup). A popup in a tab has
   * no "tab in front" but itself, so `site` names the page it should act on: the address gets
   * `?tabId=<id>`, which the popup uses in place of `tabs.query({ active })` when present.
   */
  async popup(site?: Page): Promise<Page> {
    const tabId = site ? await this.tabId(site) : undefined
    const page = await this.context.newPage()
    await page.goto(this.url(`src/popup/index.html${tabId === undefined ? '' : `?tabId=${tabId}`}`))
    return page
  }

  /** The setup tab: the one the extension opened on install, or a new one. */
  async setup(): Promise<Page> {
    const open = this.context.pages().find((p) => p.url().includes('/src/setup/'))
    if (open) {
      await open.bringToFront()
      return open
    }
    const page = await this.context.newPage()
    await page.goto(this.url('src/setup/index.html'))
    return page
  }

  /** The account page (approvals, devices, emergency access, the Recovery Kit, second steps, the move), at a section. */
  async account(hash = ''): Promise<Page> {
    const page = await this.context.newPage()
    await page.goto(this.url(`src/account/index.html${hash === '' ? '' : `#${hash}`}`))
    return page
  }

  /** A page of a fixture site, e.g. `visit('orbit-cloud.com', '/signin')`. */
  async visit(host: string, path = '/'): Promise<Page> {
    const page = await this.context.newPage()
    await page.goto(this.site.url(host, path))
    return page
  }

  private clipboardPage?: Page

  /** What is on the clipboard, read by a page that has been granted the permission and the focus. */
  async clipboard(): Promise<string> {
    if (!this.clipboardPage || this.clipboardPage.isClosed()) {
      this.clipboardPage = await this.visit('harbornotes.app', '/welcome')
    }
    await this.clipboardPage.bringToFront()
    return this.clipboardPage.evaluate(() => navigator.clipboard.readText())
  }

  /** The popup the toolbar opens, through `action.openPopup()`; null when this browser doesn't show it as a page. */
  async toolbarPopup(): Promise<Page | null> {
    const opened = this.context
      .waitForEvent('page', { predicate: (p) => p.url().includes('/src/popup/'), timeout: 5000 })
      .catch(() => null)
    await this.worker.evaluate(() => chrome.action.openPopup()).catch(() => undefined)
    return opened
  }

  /* ------------------------------------------------------------------------------------------ */
  /* What the extension puts on pages                                                             */
  /* ------------------------------------------------------------------------------------------ */

  /** The in-page menu's frame: an extension page in an iframe the page can't read. */
  async menu(page: Page, timeout = 10_000): Promise<Frame> {
    let found: Frame | undefined
    await expect
      .poll(
        () => {
          found = page.frames().find((f) => f.url().includes('/src/menu/'))
          return found !== undefined
        },
        { timeout, message: 'the in-page menu did not open' },
      )
      .toBe(true)
    return found!
  }

  menuOpen(page: Page): boolean {
    return page.frames().some((f) => f.url().includes('/src/menu/'))
  }

  /** The frame (of the page, or of the extension's own prompt) whose text matches, for the save prompt. */
  async frameWithText(page: Page, text: RegExp, timeout = 10_000): Promise<Frame> {
    let found: Frame | undefined
    await expect
      .poll(
        async () => {
          for (const frame of page.frames()) {
            const body = await frame
              .locator('body')
              .innerText({ timeout: 500 })
              .catch(() => '')
            if (text.test(body)) {
              found = frame
              return true
            }
          }
          return false
        },
        { timeout, message: `no frame says ${String(text)}` },
      )
      .toBe(true)
    return found!
  }

  async anyFrameSays(page: Page, text: RegExp): Promise<boolean> {
    for (const frame of page.frames()) {
      const body = await frame
        .locator('body')
        .innerText({ timeout: 500 })
        .catch(() => '')
      if (text.test(body)) return true
    }
    return false
  }

  /**
   * Whether Kemlock's button is drawn over a field: something other than the field itself is at its
   * right edge. The button lives in a closed shadow root, which no selector reaches.
   */
  async hasButton(page: Page, field: ReturnType<Page['locator']>): Promise<boolean> {
    const box = await field.boundingBox()
    if (!box) return false
    return page.evaluate(({ x, y, width, height }) => {
      const inside = document.elementFromPoint(x + width - 12, y + height / 2)
      const beyond = document.elementFromPoint(x + width + 12, y + height / 2)
      const isField = (el: Element | null) => el instanceof HTMLInputElement
      return (
        (inside !== null && !isField(inside)) ||
        (beyond !== null &&
          beyond.tagName !== 'BODY' &&
          beyond.tagName !== 'HTML' &&
          beyond.tagName !== 'MAIN' &&
          !isField(beyond))
      )
    }, box)
  }

  /** Opens a field's menu the keyboard way (spec: "pressing the down arrow in the field"). */
  async openMenu(page: Page, field: ReturnType<Page['locator']>): Promise<Frame> {
    await field.focus()
    // As a person would: once Kemlock's button shows in the field, so the page's fields have been found. A field too small for
    // the button (one box of a code split across several) has none, and the arrow still opens its menu: then it is waited for no
    // longer than that.
    await expect
      .poll(() => this.hasButton(page, field), { timeout: 3_000 })
      .toBe(true)
      .catch(() => undefined)
    await page.keyboard.press('ArrowDown')
    return this.menu(page)
  }
}

/** The menu's item, by the name and username or account it lists. */
export function menuItem(menu: Frame, name: string | RegExp) {
  return menu
    .locator('button, [role="button"], [role="menuitem"], [role="option"], li, a')
    .filter({ hasText: name })
    .first()
}

/** The click gate wants the menu in plain view for half a second (autofill spec); a person takes longer than this. */
export const GATE_MS = 700

export const test = base.extend<{ kemlock: Kemlock; allSites: boolean }, { site: SiteServer }>({
  site: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const site = new SiteServer()
      await site.start()
      await use(site)
      await site.stop()
    },
    { scope: 'worker' },
  ],
  allSites: [true, { option: true }],
  kemlock: async ({ site, allSites, headless, launchOptions }, use, testInfo) => {
    site.dav.reset()
    site.posts.length = 0
    const slowMo = launchOptions.slowMo ?? 0
    const kemlock = await Kemlock.launch(site, { allSites, headless, slowMo }, testInfo)
    await use(kemlock)
    await kemlock.close()
  },
})

export { expect }
