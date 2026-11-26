// A core that lives in memory, for the tests and for a development build (`KEMLOCK_FAKE_CORE=1`,
// the `__FAKE_CORE__` define): a vault with a password, a count of wrong passwords, codes that
// compute real TOTP, logins matched by an approximation of the registrable domain, the generator,
// health and a pretend sync. It follows `CoreApi`'s contract, not the app's formats.
import type { AccountRequest, AccountResult } from '../../shared/account'
import { FakeAccount } from './fake-account'
import type {
  AdminFieldDef,
  BackupCodesInput,
  BackupCodeView,
  CardFull,
  CardInput,
  CardView,
  CodeInput,
  CodeType,
  CodeView,
  CoreApi,
  CustomFieldDefs,
  FileFull,
  FileInput,
  FileSync,
  FileView,
  GeneratedPassword,
  GeneratorOptions,
  HealthReport,
  IdentityFull,
  IdentityInput,
  IdentityView,
  ItemKind,
  ItemRef,
  KemlockSignIn,
  LinkedItemView,
  LiveCode,
  LoginHealth,
  LoginInput,
  LoginSecret,
  LoginView,
  NewPasskey,
  PasskeyEnrolOptions,
  PasskeyUnlockAnswer,
  PasskeyUnlockInfo,
  PasskeyUnlockResult,
  NoteFull,
  NoteInput,
  NoteView,
  Opened,
  Settings,
  SignInStep,
  StagedAttachment,
  RemovalItem,
  SecurityKeyChallenge,
  ServerCheck,
  SiteMatch,
  StepAnswer,
  SyncPlace,
  SyncStatus,
  UnlockResult,
  VaultState,
  VaultwardenSignIn,
  WebdavSignIn,
  WebsiteRuleView,
} from '../../shared/api'
import { FakeSends } from './fake-sends'
import type {
  NewSendInput,
  ReceivedSendView,
  SendDetail,
  SendPatch,
  SendResult,
  SendsListing,
} from '../../shared/sends'

import { forgetPasskeys, passkeysOf } from './fake-passkey'
import { KeysFake } from './fake-keys'
import type { ToolsCoreApi } from '../../shared/tools-api'
import { fakeToolsMethods } from './fake-tools'
import type {
  CreatedPasskey,
  PasskeyCreationOptions,
  PasskeyCredentialJson,
  PasskeyView,
} from '../../shared/passkeys'
import * as fakePasskeys from './fake-passkeys'
import type { StoredPasskey } from './fake-passkeys'
import { FakeTransfer } from './fake-transfer'
import { emptyItems, FakeItems, type ItemsDisk } from './fake-items'
import { FakeExtras } from './fake-extras'
import { FakeFiles } from './fake-files'

/* ----------------------------------------------------------------------------------------------- */
/* Codes                                                                                             */
/* ----------------------------------------------------------------------------------------------- */

const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const steamAlphabet = '23456789BCDFGHJKMNPQRTVWXY'

/** RFC 4648 base32, in any case, with spaces and padding left out. */
export function decodeBase32(text: string): Uint8Array {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const index = base32.indexOf(char)
    if (index < 0) throw new FakeError('badSecret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

type Algorithm = 'SHA-1' | 'SHA-256' | 'SHA-512'

/** RFC 4226's HMAC-based value for a counter, before it is cut to digits (31 bits). */
async function hotpValue(
  secret: Uint8Array,
  counter: number,
  algorithm: Algorithm,
): Promise<number> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const message = new Uint8Array(8)
  new DataView(message.buffer).setBigUint64(0, BigInt(counter))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  const offset = mac[mac.length - 1] & 0xf
  return (
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3]
  )
}

/** The code for a counter: digits for HOTP and TOTP, Steam's five letters for Steam. */
export async function codeFor(
  secret: Uint8Array,
  counter: number,
  digits: number,
  type: CodeType,
  algorithm: Algorithm = 'SHA-1',
): Promise<string> {
  let value = await hotpValue(secret, counter, algorithm)
  if (type === 'steam') {
    let out = ''
    for (let i = 0; i < 5; i++) {
      out += steamAlphabet[value % steamAlphabet.length]
      value = Math.floor(value / steamAlphabet.length)
    }
    return out
  }
  return String(value % 10 ** digits).padStart(digits, '0')
}

/** A fake's error: the background passes its message on as the word the page shows. */
export class FakeError extends Error {
  constructor(word: string) {
    super(word)
    this.name = 'KemlockError'
  }
}

/* ----------------------------------------------------------------------------------------------- */
/* Sites                                                                                             */
/* ----------------------------------------------------------------------------------------------- */

const secondLevel = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'co.jp', 'co.nz'])
/** Hosts under these belong to someone else each: they match only exactly. */
const sharedSuffixes = ['github.io', 'herokuapp.com', 'blogspot.com', 'pages.dev', 'vercel.app']
/** Tenant hosts: the registrable domain says nothing, so they match only exactly. */
const tenants = new Set(['okta.com', 'slack.com'])

const hostOf = (address: string): string | null => {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

const isIp = (host: string) => /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost'

/** The registrable domain, by a short list instead of the Public Suffix List. */
export function registrable(host: string): string {
  if (isIp(host)) return host
  const shared = sharedSuffixes.find((suffix) => host.endsWith(`.${suffix}`))
  const labels = host.split('.')
  if (shared !== undefined) return labels.slice(-(shared.split('.').length + 1)).join('.')
  if (labels.length <= 2) return host
  return labels.slice(secondLevel.has(labels.slice(-2).join('.')) ? -3 : -2).join('.')
}

const exactOnly = (host: string) =>
  isIp(host) || tenants.has(registrable(host)) || sharedSuffixes.some((s) => host.endsWith(`.${s}`))

function hostsMatch(page: string, website: string): boolean {
  const known = hostOf(website)
  if (known === null) return false
  if (exactOnly(page) || exactOnly(known)) return page === known
  return registrable(page) === registrable(known)
}

const confusables: [RegExp, string][] = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/0/g, 'o'],
  [/[1i]/g, 'l'],
]
const fold = (name: string) =>
  confusables.reduce((text, [from, to]) => text.replace(from, to), name)

/** Damerau-Levenshtein distance (optimal string alignment). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** The known domain a page looks like without being it, if any. */
function lookAlike(page: string, known: string): boolean {
  if (page === known) return false
  const [pageName, ...pageSuffix] = page.split('.')
  const [knownName, ...knownSuffix] = known.split('.')
  if (pageSuffix.join('.') !== knownSuffix.join('.')) return false
  if (fold(pageName) === fold(knownName)) return true
  return knownName.length >= 6 && distance(pageName, knownName) === 1
}

/* ----------------------------------------------------------------------------------------------- */
/* Generator, strength                                                                               */
/* ----------------------------------------------------------------------------------------------- */

const symbolChars = '!#%&-_?'
const wordList = [
  'acorn',
  'badge',
  'camel',
  'dune',
  'ember',
  'fjord',
  'grove',
  'harbor',
  'island',
  'jasper',
  'kettle',
  'lantern',
  'meadow',
  'nectar',
  'orchid',
  'pebble',
  'quartz',
  'river',
  'saddle',
  'tundra',
  'umber',
  'velvet',
  'willow',
  'xenon',
  'yonder',
  'zephyr',
  'anchor',
  'breeze',
  'cobalt',
  'dragon',
]

function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buffer = new Uint32Array(1)
  do crypto.getRandomValues(buffer)
  while (buffer[0] >= limit)
  return buffer[0] % max
}

const pick = <T>(items: readonly T[]): T => items[randomInt(items.length)]

/** The cap and floor a site's rules put on the length (`maxlength`, `minlength`). */
function lengthRules(rules: string | undefined): { min?: number; max?: number } {
  if (rules === undefined) return {}
  const number = (name: string) => {
    const found = new RegExp(`${name}\\D{0,3}(\\d+)`, 'i').exec(rules)
    return found === null ? undefined : Number(found[1])
  }
  return { min: number('minlength'), max: number('maxlength') }
}

/** 0 (weakest) to 4. */
export function strengthOf(password: string): number {
  if (password.length < 8) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((re) => re.test(password)).length
  const score = Math.floor(password.length / 6) + kinds
  return Math.max(1, Math.min(4, Math.floor(score / 2)))
}

/* ----------------------------------------------------------------------------------------------- */
/* The fake's disk and parts                                                                         */
/* ----------------------------------------------------------------------------------------------- */

export interface StoredLogin {
  id: string
  name: string
  username: string
  password: string
  websites: string[]
  tags: string[]
  order: number
  note?: string
  codeId?: string
  passwordChangedAt?: number
  previous: string[]
  ignored: boolean
  pinned?: boolean
  /** The rule of each website that has one other than the default (item format). */
  websiteRules?: WebsiteRuleView[]
}

export interface StoredCode {
  id: string
  /** Its own name (item format). */
  name?: string
  note?: string
  issuer: string
  account: string
  type: CodeType
  digits: number
  period: number
  algorithm: Algorithm
  secret: Uint8Array
  counter: number
  tags: string[]
  order: number
  onSecurityKey: boolean
  websites: string[]
  loginId?: string
  pinned?: boolean
  /** The service gives no backup codes (the app's `noBackupCodes`). */
  noBackupCodes?: boolean
  /** Breaches marked dealt with. */
  breachesDismissed?: string[]
}

export interface StoredBackup {
  serviceId: string
  /** Its own name and websites (item format). */
  name?: string
  websites?: string[]
  issuer: string
  codes: string[]
  used: number
  /** Which codes are used, when the tools changed one by index; `used` is its count. */
  flags?: boolean[]
  note?: string
  breachesDismissed?: string[]
}

/** What survives a restart of the background: the same disk given to a new `FakeCore`. */
export interface FakeDisk {
  exists: boolean
  password: string
  wrongPasswords: number
  lastWrongAt?: number
  logins: StoredLogin[]
  codes: StoredCode[]
  backups: StoredBackup[]
  settings: Settings
  recent: GeneratedPassword[]
  picks: Record<string, string[]>
  /** Added by passkeys. */
  passkeys?: StoredPasskey[]
  sync: SyncStatus | null
  /** The sealed keys of the open vault: what the browser's session storage would hold. */
  session: string | null
  nextId: number
  /** What the vault tools keep (src/background/core/fake-tools.ts). */
  tools?: {
    refreshOn?: boolean
    dismissed?: string[]
    merges?: { id: string; at: number; label: string; kept: unknown; removed: unknown[] }[]
    matching?: boolean
    listCheckedAt?: number
  }
  /** Notes, cards and identities (fake-items.ts). */
  items: ItemsDisk
}

export const defaultSettings: Settings = {
  autoLockMinutes: 5,
  lockOnSleep: true,
  codeAfterPassword: true,
  buttonsOnPages: true,
  breachedPasswords: false,
  offerToSave: true,
  clipboardSeconds: 30,
}

export function emptyDisk(): FakeDisk {
  return {
    exists: false,
    password: '',
    wrongPasswords: 0,
    logins: [],
    codes: [],
    backups: [],
    settings: { ...defaultSettings },
    recent: [],
    picks: {},
    passkeys: [],
    sync: null,
    session: null,
    nextId: 1,
    items: emptyItems(),
  }
}

export interface FakeCoreOptions {
  disk?: FakeDisk
  now?: () => number
  /** Starts with a vault (password `correct horse`) holding a few logins and codes. */
  sample?: boolean
}

const parseOtpauth = (link: string) => {
  const url = new URL(link)
  if (url.protocol !== 'otpauth:') throw new FakeError('badLink')
  const kind = url.hostname.toLowerCase()
  const type: CodeType =
    kind === 'steam' || url.searchParams.get('encoder') === 'steam'
      ? 'steam'
      : kind === 'hotp'
        ? 'hotp'
        : 'totp'
  if (kind !== 'totp' && kind !== 'hotp' && kind !== 'steam') throw new FakeError('badLink')
  const secret = url.searchParams.get('secret')
  if (secret === null) throw new FakeError('badLink')
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const [labelIssuer, labelAccount] = label.includes(':') ? label.split(/:(.*)/s) : ['', label]
  const algorithm = `SHA-${(url.searchParams.get('algorithm') ?? 'SHA1').replace(/^SHA-?/i, '')}`
  return {
    type,
    secret: decodeBase32(secret),
    issuer: url.searchParams.get('issuer') ?? labelIssuer,
    account: labelAccount.trim(),
    digits: type === 'steam' ? 5 : Number(url.searchParams.get('digits') ?? 6),
    period: Number(url.searchParams.get('period') ?? 30),
    counter: Number(url.searchParams.get('counter') ?? 0),
    algorithm: (['SHA-1', 'SHA-256', 'SHA-512'].includes(algorithm)
      ? algorithm
      : 'SHA-1') as Algorithm,
  }
}

/** The schemes a website may use: the web, and the package names the phone apps write (web/src/features/vault/forms/siteRows.ts). */
const siteSchemes = ['http', 'https', 'androidapp', 'iosapp']

/** Whether a website's text is one the web vault would take: a host, a web address or an app's package, or a regex that compiles. */
function siteIsFine(uri: string, match: WebsiteRuleView['match']): boolean {
  if (match === 'regex') {
    try {
      new RegExp(uri)
      return true
    } catch {
      return false
    }
  }
  // `localhost:8080` looks like a scheme and is a host with a port
  if (/^[a-z0-9.-]+:\d{1,5}(?:[/?#].*)?$/i.test(uri)) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1]?.toLowerCase()
  if (scheme === undefined) return !/\s/.test(uri)
  if (!siteSchemes.includes(scheme)) return false
  if (scheme === 'http' || scheme === 'https') {
    try {
      return new URL(uri).host !== ''
    } catch {
      return false
    }
  }
  return true
}

// The vault tools' methods join the class through the interface of the same name at the end of this file
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class FakeCore implements CoreApi {
  readonly disk: FakeDisk
  private unlocked = false
  private readonly now: () => number
  /** The sign-in step the last sign-in returned. */
  private step: { place: SyncPlace; server: string; account?: string; at: string } | null = null
  /** Set it to make the next syncs stop with this problem, as a sync that can't go on does. */
  syncProblem: string | undefined
  /**
   * A run the removal guard stops: `syncNow` ends with `problem: 'removals'` and these numbers until the person answers
   * `confirmRemovals` (the removals go) or `keepRemovals` (everything stays); each is logged and clears the stop.
   */
  guard: { count: number; scope: number; items?: RemovalItem[] } | undefined
  /** What the last answer to the guard was, for tests. */
  guardAnswer: 'remove' | 'keep' | undefined
  /** Sign-ins by SSO or passkey end as this when set (a step the fake would otherwise finish with `done`). */
  waysStep: SignInStep | undefined
  /** Calls made, by name, for the tests. */
  readonly calls: string[] = []
  /** Sends (src/background/core/fake-sends.ts): its Sends, and what a test plants in it. */
  readonly sends = new FakeSends({
    need: () => void this.need(),
    place: () => this.disk.sync?.place ?? null,
    now: () => this.now(),
  })

  /** The administrator's custom fields, as Kemlock Server would answer them (only when the vault syncs with it). */
  adminFields: AdminFieldDef[] = []
  /** Whether the server lets people add fields of their own. */
  allowOwn = true
  /** Set it to make files go up and down (`kemlock`) or not (`readOnly`), whatever the vault syncs with. */
  fileSync: FileSync | undefined
  /** Items whose end of a link can't be written (a space that is read only), by `refKey` (`login:login-1`). */
  readonly unwritable = new Set<string>()

  /** Custom fields and links of every kind (src/background/core/fake-extras.ts). */
  readonly extras = new FakeExtras(
    () => this.disk.items.extras,
    {
      find: (ref) => this.findItem(ref),
      all: () => this.allItems(),
      legacy: (ref) => this.legacyLinks(ref),
      unlegacy: (a, b) => this.clearLegacy(a, b),
      unwritable: () => this.unwritable,
    },
    (word) => new FakeError(word),
  )

  /** File items and note attachments (src/background/core/fake-files.ts). */
  readonly fileStore = new FakeFiles({
    need: () => void this.need(),
    fileSync: () => this.fileSyncNow(),
    now: () => this.now(),
    items: () => this.disk.items,
    extras: this.extras,
    revealNote: (id) => this.revealNote(id),
  })

  // Added by transfer (begin): import and export (fake-transfer.ts)
  private readonly transfer = new FakeTransfer({
    need: () => this.need(),
    now: () => this.now(),
    id: (prefix) => this.id(prefix),
    addCode: (link) => void this.newCode(link, []),
    hasCode: (link) => {
      const secret = parseOtpauth(link).secret
      return this.need().codes.some((c) => bytesEqual(c.secret, secret))
    },
    clearCodes: () => {
      const disk = this.need()
      disk.codes = []
      for (const login of disk.logins) login.codeId = undefined
    },
    codeLink: (index) => {
      const code = this.need().codes[index]
      const issuer = encodeURIComponent(code.issuer)
      const scheme = code.type === 'hotp' ? 'hotp' : 'totp'
      return `otpauth://${scheme}/${issuer}:${encodeURIComponent(code.account)}?secret=${FakeTransfer.secretOf(code.secret)}&issuer=${issuer}`
    },
  })
  transferOpen: CoreApi['transferOpen'] = (data) => this.transfer.transferOpen(data)
  transferOpenQr: CoreApi['transferOpenQr'] = (images) => this.transfer.transferOpenQr(images)
  transferPreview: CoreApi['transferPreview'] = (token, password) =>
    this.transfer.transferPreview(token, password)
  transferPreviewKit: CoreApi['transferPreviewKit'] = (token, pieces) =>
    this.transfer.transferPreviewKit(token, pieces)
  transferPlan: CoreApi['transferPlan'] = (token, options) =>
    this.transfer.transferPlan(token, options)
  transferApply: CoreApi['transferApply'] = (token, options) =>
    this.transfer.transferApply(token, options)
  transferCancel: CoreApi['transferCancel'] = (token) => this.transfer.transferCancel(token)
  transferExportInfo: CoreApi['transferExportInfo'] = () => this.transfer.transferExportInfo()
  transferExport: CoreApi['transferExport'] = (request) => this.transfer.transferExport(request)
  transferExportQr: CoreApi['transferExportQr'] = (request) =>
    this.transfer.transferExportQr(request)
  // End of added by transfer

  /** The account's own calls (devices, approvals, emergency access, the Recovery Kit, second steps, the move). */
  readonly accounts: FakeAccount

  constructor(options: FakeCoreOptions = {}) {
    this.disk = options.disk ?? emptyDisk()
    this.now = options.now ?? (() => Date.now())
    this.accounts = new FakeAccount(this.now)
    if (options.sample === true && !this.disk.exists) this.seed()
  }

  private seed(): void {
    const disk = this.disk
    disk.exists = true
    disk.password = 'correct horse'
    const code = this.newCode(
      'otpauth://totp/Orbit%20Cloud:sam@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Orbit%20Cloud',
      ['orbit-cloud.com'],
    )
    const login: StoredLogin = {
      id: this.id('login'),
      name: 'Orbit Cloud',
      username: 'sam@example.com',
      password: 'Orbit-Cloud-7731!',
      websites: ['orbit-cloud.com'],
      tags: [],
      order: 0,
      previous: [],
      ignored: false,
      codeId: code.id,
    }
    code.loginId = login.id
    disk.logins.push(login)
    disk.backups.push({
      serviceId: 'orbit',
      issuer: 'Orbit Cloud',
      codes: ['1111-2222', '3333-4444', '5555-6666'],
      used: 0,
    })
  }

  private id(prefix: string): string {
    return `${prefix}-${this.disk.nextId++}`
  }

  private newCode(link: string, websites: string[]): StoredCode {
    const parsed = parseOtpauth(link)
    if (this.disk.codes.some((c) => bytesEqual(c.secret, parsed.secret)))
      throw new FakeError('duplicate')
    const code: StoredCode = {
      id: this.id('code'),
      ...parsed,
      tags: [],
      order: this.disk.codes.length,
      onSecurityKey: false,
      websites,
    }
    this.disk.codes.push(code)
    return code
  }

  private need(): FakeDisk {
    if (!this.disk.exists) throw new FakeError('noVault')
    if (!this.unlocked) throw new FakeError('locked')
    return this.disk
  }

  private log(name: string): void {
    this.calls.push(name)
  }

  /* The vault ------------------------------------------------------------------------------- */

  async state(): Promise<VaultState> {
    const { exists, wrongPasswords, lastWrongAt, sync } = this.disk
    return {
      exists,
      unlocked: this.unlocked,
      wrongPasswords,
      ...(lastWrongAt === undefined ? {} : { lastWrongAt }),
      ...(this.unlocked && sync !== null
        ? { sync: { ...structuredClone(sync), fileSync: this.fileSyncNow() } }
        : {}),
      fileSync: this.fileSyncNow(),
    }
  }

  async createVault(password: string): Promise<void> {
    this.log('createVault')
    if (this.disk.exists) throw new FakeError('exists')
    Object.assign(this.disk, emptyDisk(), { exists: true, password })
    this.unlocked = true
    passkeysOf(this.disk, this.now).passwordUsed()
  }

  async unlock(password: string): Promise<UnlockResult> {
    this.log('unlock')
    if (!this.disk.exists) throw new FakeError('noVault')
    const before = this.disk.wrongPasswords
    if (password === this.disk.password) {
      this.disk.wrongPasswords = 0
      this.unlocked = true
      passkeysOf(this.disk, this.now).passwordUsed()
      return { ok: true, wrongPasswords: before }
    }
    this.disk.wrongPasswords = before + 1
    this.disk.lastWrongAt = this.now()
    return { ok: false, wrongPasswords: this.disk.wrongPasswords }
  }

  async lock(): Promise<void> {
    this.log('lock')
    this.unlocked = false
    this.sends.unload()
    this.fileStore.unload()
    this.transfer.forget()
    this.disk.session = null
  }

  async removeVault(): Promise<void> {
    this.log('removeVault')
    forgetPasskeys(this.disk)
    Object.assign(this.disk, emptyDisk())
    this.unlocked = false
  }

  async exportSession(): Promise<string> {
    this.need()
    this.disk.session = `fake-session-${this.now()}-${randomInt(1e9)}`
    return this.disk.session
  }

  async restoreSession(blob: string): Promise<boolean> {
    this.log('restoreSession')
    if (!this.disk.exists || this.disk.session === null || blob !== this.disk.session) return false
    this.unlocked = true
    return true
  }

  /* What it holds --------------------------------------------------------------------------- */

  /** The websites an item holds itself, whatever its kind: a login's, a code's or backup codes'. */
  private ownWebsites(ref: ItemRef): string[] {
    switch (ref.kind) {
      case 'login':
        return this.disk.logins.find((l) => l.id === ref.id)?.websites ?? []
      case 'otp':
        return this.disk.codes.find((c) => c.id === ref.id)?.websites ?? []
      case 'backup-codes':
        return this.disk.backups.find((b) => b.serviceId === ref.id)?.websites ?? []
      default:
        return []
    }
  }

  /** The websites of the items an item is linked to, and those items: what a code or backup codes show in place of their own. */
  private lent(ref: ItemRef): { websites: string[]; from: ItemRef[] } {
    const websites: string[] = []
    const from: ItemRef[] = []
    for (const item of this.extras.linked(ref)) {
      const own = this.ownWebsites(item.ref)
      if (own.length === 0) continue
      from.push(item.ref)
      for (const site of own) if (!websites.includes(site)) websites.push(site)
    }
    return { websites, from }
  }

  private codeView(code: StoredCode, failures: string[] = []): CodeView {
    const ref: ItemRef = { kind: 'otp', id: code.id }
    const lent = this.lent(ref)
    return {
      id: code.id,
      ...(code.name === undefined ? {} : { name: code.name }),
      ...(code.note === undefined ? {} : { note: code.note }),
      ...this.extras.view(ref),
      ...(failures.length > 0 ? { linkFailures: failures } : {}),
      issuer: code.issuer,
      account: code.account,
      type: code.type,
      digits: code.digits,
      period: code.period,
      tags: [...code.tags],
      order: code.order,
      ...(code.pinned === true ? { pinned: true } : {}),
      onSecurityKey: code.onSecurityKey,
      websites: lent.from.length > 0 ? lent.websites : [...code.websites],
      ownWebsites: [...code.websites],
      ...(lent.from.length > 0 ? { websitesFrom: lent.from } : {}),
      ...(code.loginId === undefined ? {} : { loginId: code.loginId }),
      ...this.backupLeft(code),
    }
  }

  private backupLeft(code: StoredCode): { backupCodesLeft?: number } {
    const backup = this.disk.backups.find(
      (b) => b.issuer.toLowerCase() === code.issuer.toLowerCase(),
    )
    return backup === undefined ? {} : { backupCodesLeft: backup.codes.length - backup.used }
  }

  async codes(): Promise<CodeView[]> {
    return this.need().codes.map((code) => this.codeView(code))
  }

  async liveCodes(ids: string[], now: number): Promise<LiveCode[]> {
    const out: LiveCode[] = []
    for (const id of ids) {
      const code = this.need().codes.find((c) => c.id === id)
      if (code === undefined || code.onSecurityKey) continue
      if (code.type === 'hotp') {
        out.push({
          id,
          code: await codeFor(code.secret, code.counter, code.digits, 'hotp', code.algorithm),
        })
        continue
      }
      const counter = Math.floor(now / 1000 / code.period)
      out.push({
        id,
        code: await codeFor(code.secret, counter, code.digits, code.type, code.algorithm),
        expiresAt: (counter + 1) * code.period * 1000,
      })
    }
    return out
  }

  async nextHotp(id: string): Promise<LiveCode> {
    const code = this.need().codes.find((c) => c.id === id && c.type === 'hotp')
    if (code === undefined) throw new FakeError('notFound')
    code.counter += 1
    return {
      id,
      code: await codeFor(code.secret, code.counter, code.digits, 'hotp', code.algorithm),
    }
  }

  private health1(login: StoredLogin): LoginHealth {
    const all = this.disk.logins
    return {
      reused:
        login.password !== '' &&
        all.some((o) => o.id !== login.id && o.password === login.password),
      weak: login.password !== '' && strengthOf(login.password) < 2,
      withoutItsCode:
        login.codeId === undefined &&
        login.websites.some((w) => twoStepSites.has(registrableOf(w))),
      ...(this.disk.settings.breachedPasswords
        ? { breached: breachedPasswords.has(login.password) }
        : {}),
      ignored: login.ignored,
    }
  }

  private loginView(login: StoredLogin, failures: string[] = []): LoginView {
    return {
      id: login.id,
      name: login.name,
      username: login.username,
      websites: [...login.websites],
      websiteRules: login.websites.map((uri) => ({
        uri,
        match: login.websiteRules?.find((rule) => rule.uri === uri)?.match ?? 'default',
      })),
      ...this.extras.view({ kind: 'login', id: login.id }),
      ...(failures.length > 0 ? { linkFailures: failures } : {}),
      tags: [...login.tags],
      order: login.order,
      ...(login.pinned === true ? { pinned: true } : {}),
      ...(login.note === undefined ? {} : { note: login.note }),
      hasPassword: login.password !== '',
      strength: strengthOf(login.password),
      ...(login.passwordChangedAt === undefined
        ? {}
        : { passwordChangedAt: login.passwordChangedAt }),
      previousPasswords: login.previous.length,
      ...(login.codeId === undefined ? {} : { codeId: login.codeId }),
      health: this.health1(login),
    }
  }

  async logins(): Promise<LoginView[]> {
    return this.need().logins.map((login) => this.loginView(login))
  }

  private findLogin(id: string): StoredLogin {
    const login = this.need().logins.find((l) => l.id === id)
    if (login === undefined) throw new FakeError('notFound')
    return login
  }

  async revealLogin(id: string): Promise<LoginSecret> {
    this.log('revealLogin')
    const { username, password } = this.findLogin(id)
    return { username, password }
  }

  /** The websites a save names and the rules they carry; `websiteRules` win over `websites`, and are checked as the web vault checks them. */
  private sitesOf(
    input: LoginInput,
    held: WebsiteRuleView[] | undefined,
  ): { websites: string[]; rules: WebsiteRuleView[] } {
    if (input.websiteRules === undefined) {
      const websites = [...input.websites]
      return { websites, rules: (held ?? []).filter((rule) => websites.includes(rule.uri)) }
    }
    const rules: WebsiteRuleView[] = []
    for (const rule of input.websiteRules) {
      const uri = rule.uri.trim()
      if (uri === '') continue
      if (!siteIsFine(uri, rule.match)) throw new FakeError('invalid')
      if (!rules.some((other) => other.uri === uri)) rules.push({ uri, match: rule.match })
    }
    return {
      websites: rules.map((rule) => rule.uri),
      rules: rules.filter((rule) => rule.match !== 'default'),
    }
  }

  async saveLogin(id: string | null, input: LoginInput): Promise<LoginView> {
    this.log('saveLogin')
    const disk = this.need()
    if (id === null) {
      this.extras.check('login', input)
      const sites = this.sitesOf(input, undefined)
      const login: StoredLogin = {
        id: this.id('login'),
        name: input.name,
        username: input.username,
        password: input.password,
        websites: sites.websites,
        ...(sites.rules.length === 0 ? {} : { websiteRules: sites.rules }),
        tags: [...(input.tags ?? [])],
        order: disk.logins.length,
        ...(input.note === undefined ? {} : { note: input.note }),
        passwordChangedAt: this.now(),
        previous: [],
        ignored: false,
      }
      disk.logins.push(login)
      return this.loginView(login, this.extras.apply({ kind: 'login', id: login.id }, input))
    }
    const login = this.findLogin(id)
    const sites = this.sitesOf(input, login.websiteRules)
    this.extras.validate({ kind: 'login', id }, input)
    if (login.password !== input.password) {
      if (login.password !== '') login.previous.unshift(login.password)
      login.passwordChangedAt = this.now()
    }
    Object.assign(login, {
      name: input.name,
      username: input.username,
      password: input.password,
      websites: sites.websites,
      tags: [...(input.tags ?? login.tags)],
      note: input.note,
    })
    if (sites.rules.length === 0) delete login.websiteRules
    else login.websiteRules = sites.rules
    return this.loginView(login, this.extras.apply({ kind: 'login', id: login.id }, input))
  }

  async deleteLogin(id: string): Promise<void> {
    const disk = this.need()
    const login = this.findLogin(id)
    this.extras.forget({ kind: 'login', id })
    disk.logins = disk.logins.filter((l) => l !== login)
    for (const code of disk.codes) if (code.loginId === id) code.loginId = undefined
  }

  async ignoreHealth(id: string, ignored: boolean): Promise<void> {
    this.findLogin(id).ignored = ignored
  }

  /** A service's backup codes as a view shows them (the tools' calls answer with it too). */
  backupView(b: StoredBackup, failures: string[] = []): BackupCodeView {
    const ref: ItemRef = { kind: 'backup-codes', id: b.serviceId }
    const lent = this.lent(ref)
    return {
      serviceId: b.serviceId,
      ...(b.name === undefined ? {} : { name: b.name }),
      issuer: b.issuer,
      websites: lent.from.length > 0 ? lent.websites : [...(b.websites ?? [])],
      total: b.codes.length,
      left: b.codes.length - b.used,
      low: b.codes.length > 0 && b.codes.length - b.used <= 2,
      ...this.extras.view(ref),
      ...(failures.length > 0 ? { linkFailures: failures } : {}),
    }
  }

  async backupCodes(): Promise<BackupCodeView[]> {
    return this.need().backups.map((b) => this.backupView(b))
  }

  async useBackupCode(serviceId: string): Promise<string> {
    this.log('useBackupCode')
    const backup = this.need().backups.find((b) => b.serviceId === serviceId)
    if (backup === undefined || backup.used >= backup.codes.length)
      throw new FakeError('noBackupCodes')
    const index = backup.flags === undefined ? backup.used : backup.flags.indexOf(false)
    if (backup.flags !== undefined) backup.flags[index] = true
    backup.used++
    return backup.codes[index]
  }

  async addCode(otpauth: string, website?: string, linkTo?: string): Promise<CodeView> {
    this.log('addCode')
    const disk = this.need()
    const host = website === undefined ? null : (hostOf(website) ?? website)
    const code = this.newCode(otpauth, host === null ? [] : [registrable(host)])
    if (linkTo !== undefined) await this.linkCode(code.id, linkTo)
    return this.codeView(disk.codes.find((c) => c.id === code.id)!)
  }

  async previewCode(
    otpauth: string,
  ): Promise<{ issuer: string; account: string; existing: CodeView | null }> {
    this.log('previewCode')
    const disk = this.need()
    const parsed = parseOtpauth(otpauth)
    const held = disk.codes.find((c) => bytesEqual(c.secret, parsed.secret))
    return {
      issuer: parsed.issuer,
      account: parsed.account,
      existing: held === undefined ? null : this.codeView(held),
    }
  }

  async readQr(imageDataUrl: string): Promise<string | null> {
    this.log('readQr')
    const prefix = 'data:image/png;kemlock-fake-qr,'
    return imageDataUrl.startsWith(prefix)
      ? decodeURIComponent(imageDataUrl.slice(prefix.length))
      : null
  }

  async linkCode(codeId: string, loginId: string | null): Promise<void> {
    const disk = this.need()
    const code = disk.codes.find((c) => c.id === codeId)
    if (code === undefined) throw new FakeError('notFound')
    for (const login of disk.logins) if (login.codeId === codeId) login.codeId = undefined
    code.loginId = undefined
    if (loginId !== null) {
      const login = this.findLogin(loginId)
      login.codeId = codeId
      code.loginId = loginId
    }
  }

  /* Notes, cards and identities (fake-items.ts) --------------------------------------------- */

  private items(): FakeItems {
    const disk = this.need()
    return new FakeItems(() => disk.items, this.now, (word) => new FakeError(word), this.extras)
  }

  async notes(): Promise<NoteView[]> {
    return this.items().notes()
  }

  async revealNote(id: string): Promise<NoteFull> {
    return this.items().revealNote(id)
  }

  async saveNote(id: string | null, input: NoteInput): Promise<NoteView> {
    this.log('saveNote')
    return this.items().saveNote(id, input)
  }

  async deleteNote(id: string): Promise<void> {
    this.log('deleteNote')
    return this.items().deleteNote(id)
  }

  async cards(): Promise<CardView[]> {
    return this.items().cards()
  }

  async revealCard(id: string): Promise<CardFull> {
    this.log('revealCard')
    return this.items().revealCard(id)
  }

  async saveCard(id: string | null, input: CardInput): Promise<CardView> {
    this.log('saveCard')
    return this.items().saveCard(id, input)
  }

  async deleteCard(id: string): Promise<void> {
    this.log('deleteCard')
    return this.items().deleteCard(id)
  }

  async identities(): Promise<IdentityView[]> {
    return this.items().identities()
  }

  async revealIdentity(id: string): Promise<IdentityFull> {
    this.log('revealIdentity')
    return this.items().revealIdentity(id)
  }

  async saveIdentity(id: string | null, input: IdentityInput): Promise<IdentityView> {
    this.log('saveIdentity')
    return this.items().saveIdentity(id, input)
  }

  async deleteIdentity(id: string): Promise<void> {
    this.log('deleteIdentity')
    return this.items().deleteIdentity(id)
  }

  /* Remembered picks, recent passwords (the optional parts of CoreApi) ----------------------- */

  async rememberPick(host: string, itemId: string): Promise<void> {
    this.need()
    const picks = (this.disk.picks[host] ??= [])
    if (!picks.includes(itemId)) picks.push(itemId)
  }

  async picks(host: string): Promise<string[]> {
    return [...(this.need().picks[host] ?? [])]
  }

  async pickedHosts(itemId: string): Promise<string[]> {
    return Object.entries(this.need().picks)
      .filter(([, ids]) => ids.includes(itemId))
      .map(([host]) => host)
      .sort()
  }

  async forgetPick(host: string, itemId: string): Promise<void> {
    const picks = this.need().picks
    picks[host] = (picks[host] ?? []).filter((id) => id !== itemId)
    if (picks[host].length === 0) delete picks[host]
  }

  /* Passkeys (docs/plans/add-passkeys.md) ---------------------------------------------------- */

  private passkeyList(): StoredPasskey[] {
    const disk = this.need()
    return (disk.passkeys ??= [])
  }

  async passkeys(): Promise<PasskeyView[]> {
    return this.passkeyList().map((passkey, order) => fakePasskeys.view(passkey, order))
  }

  async deletePasskey(id: string): Promise<void> {
    this.log('deletePasskey')
    const list = this.passkeyList()
    if (!list.some((passkey) => passkey.id === id)) throw new FakeError('notFound')
    this.disk.passkeys = list.filter((passkey) => passkey.id !== id)
  }

  async checkPasskeyRp(origin: string, rpId?: string): Promise<string> {
    return fakePasskeys.checkRp(origin, rpId)
  }

  async findPasskeys(rpId: string, allowed: string[]): Promise<PasskeyView[]> {
    return fakePasskeys
      .findIn(this.passkeyList(), rpId, allowed)
      .map(({ passkey, order }) => fakePasskeys.view(passkey, order))
  }

  async createPasskey(
    options: PasskeyCreationOptions,
    origin: string,
    topOrigin?: string,
  ): Promise<CreatedPasskey> {
    this.log('createPasskey')
    const list = this.passkeyList()
    const { passkey, made } = await fakePasskeys.create(
      list,
      options,
      origin,
      topOrigin,
      this.now(),
      this.id('passkey'),
    )
    list.push(passkey)
    return made
  }

  async signPasskey(
    id: string,
    challenge: string,
    origin: string,
    topOrigin?: string,
  ): Promise<PasskeyCredentialJson> {
    this.log('signPasskey')
    const passkey = this.passkeyList().find((candidate) => candidate.id === id)
    if (passkey === undefined) throw new FakeError('notFound')
    return fakePasskeys.sign(passkey, challenge, origin, topOrigin)
  }

  async recentPasswords(): Promise<GeneratedPassword[]> {
    const cutoff = this.now() - 30 * 24 * 3600_000
    const held = new Set(this.need().logins.map((l) => l.password))
    this.disk.recent = this.disk.recent.filter((p) => p.at >= cutoff && !held.has(p.value))
    return structuredClone(this.disk.recent)
  }

  async addRecentPassword(password: GeneratedPassword): Promise<void> {
    this.need().recent.unshift({ ...password })
  }

  /* Matching, generating, health ------------------------------------------------------------ */

  async match(address: string): Promise<SiteMatch> {
    const disk = this.need()
    const host = hostOf(address)
    if (host === null) return { site: '', logins: [], codes: [] }
    const logins = disk.logins.filter((l) => l.websites.some((w) => hostsMatch(host, w)))
    const codes = new Set(
      disk.codes.filter((c) => c.websites.some((w) => hostsMatch(host, w))).map((c) => c.id),
    )
    for (const login of logins) if (login.codeId !== undefined) codes.add(login.codeId)
    const site = registrable(host)
    const match: SiteMatch = { site, logins: logins.map((l) => l.id), codes: [...codes] }
    const passkeyIds = (disk.passkeys ?? [])
      .filter((passkey) => host === passkey.rpId || host.endsWith(`.${passkey.rpId}`))
      .map((passkey) => passkey.id)
    if (passkeyIds.length > 0) match.passkeys = passkeyIds
    if (match.logins.length === 0 && match.codes.length === 0 && passkeyIds.length === 0) {
      const known = [...disk.logins, ...disk.codes]
        .flatMap((item) => item.websites)
        .map((w) => hostOf(w))
        .filter((h): h is string => h !== null)
        .map(registrable)
      const found = known.find((k) => lookAlike(site, k))
      if (found !== undefined) match.lookAlikeOf = found
    }
    return match
  }

  async generate(options: GeneratorOptions): Promise<string> {
    this.log('generate')
    if (options.mode === 'passphrase') {
      const words = Math.max(3, Math.min(20, options.words ?? 5))
      const capitalize = options.capitalize ?? true
      const parts = Array.from({ length: words }, () => {
        const word = pick(wordList)
        return capitalize ? word[0].toUpperCase() + word.slice(1) : word
      })
      if (options.includeNumber === true) parts[randomInt(parts.length)] += String(randomInt(10))
      return parts.join(options.separator ?? '-')
    }
    const rules = lengthRules(options.siteRules)
    let length = Math.max(8, Math.min(128, options.length ?? 20))
    if (rules.max !== undefined) length = Math.min(length, rules.max)
    if (rules.min !== undefined) length = Math.max(length, rules.min)
    const plain = options.avoidLookAlikes !== false
    const classes = [
      options.lowercase !== false
        ? plain
          ? 'abcdefghijkmnopqrstuvwxyz'
          : 'abcdefghijklmnopqrstuvwxyz'
        : '',
      options.uppercase !== false
        ? plain
          ? 'ABCDEFGHJKLMNPQRSTUVWXYZ'
          : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        : '',
      options.digits !== false ? (plain ? '23456789' : '0123456789') : '',
      options.symbols !== false ? symbolChars : '',
    ].filter((chars) => chars !== '')
    const pool = (classes.length === 0 ? ['abcdefghijkmnopqrstuvwxyz'] : classes).filter(Boolean)
    const out = pool.map((chars) => pick([...chars]))
    while (out.length < length) out.push(pick([...pick(pool)]))
    for (let i = out.length - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out.slice(0, length).join('')
  }

  async health(): Promise<HealthReport> {
    const logins = this.need().logins
    const flagged = (flag: (health: LoginHealth) => boolean | undefined) =>
      logins.filter((l) => !l.ignored && flag(this.health1(l))).map((l) => l.id)
    return {
      reused: flagged((h) => h.reused),
      weak: flagged((h) => h.weak),
      withoutItsCode: flagged((h) => h.withoutItsCode),
      breached: flagged((h) => h.breached),
    }
  }

  /* Sync ------------------------------------------------------------------------------------ */

  async syncStatus(): Promise<SyncStatus | null> {
    this.need()
    return this.disk.sync === null
      ? null
      : { ...structuredClone(this.disk.sync), fileSync: this.fileSyncNow() }
  }

  private joined(place: SyncPlace, server: string, account?: string): SignInStep {
    const status: SyncStatus = {
      place,
      server,
      ...(account === undefined ? {} : { account }),
      deviceName: 'Kemlock · Chrome',
      running: false,
      ...(place === 'vaultwarden' ? { loginsNotSynced: true } : {}),
    }
    this.disk.sync = status
    this.step = null
    return { step: 'done', status: structuredClone(status) }
  }

  async signInKemlock(input: KemlockSignIn): Promise<SignInStep> {
    this.log('signInKemlock')
    this.need()
    if (input.password === 'bad') return { step: 'error', problem: 'auth' }
    if (input.email.startsWith('second@')) {
      this.step = { place: 'kemlock', server: input.server, account: input.email, at: 'second' }
      return { step: 'second', methods: ['authenticator', 'email', 'securityKey'], unsupported: [] }
    }
    return this.joined('kemlock', input.server, input.email)
  }

  async signInKemlockSso(input: { server: string; email?: string }): Promise<SignInStep> {
    this.log('signInKemlockSso')
    this.need()
    return this.waysStep ?? this.joined('kemlock', input.server, input.email ?? 'sso@kemlock.example')
  }

  async signInKemlockPasskey(input: { server: string; email?: string }): Promise<SignInStep> {
    this.log('signInKemlockPasskey')
    this.need()
    return this.waysStep ?? this.joined('kemlock', input.server, input.email ?? 'key@kemlock.example')
  }

  async signInWebdav(input: WebdavSignIn): Promise<SignInStep> {
    this.log('signInWebdav')
    this.need()
    if (input.password === 'bad') return { step: 'error', problem: 'auth' }
    this.step = { place: 'webdav', server: input.folder, account: input.username, at: 'passphrase' }
    return { step: 'passphrase' }
  }

  async signInVaultwarden(input: VaultwardenSignIn): Promise<SignInStep> {
    this.log('signInVaultwarden')
    this.need()
    if (input.password === 'bad') return { step: 'error', problem: 'auth' }
    this.step = { place: 'vaultwarden', server: input.server, account: input.email, at: 'homes' }
    return {
      step: 'homes',
      homes: [{ id: 'home-1', name: 'Kemlock', storage: 'sealed', items: 9 }],
    }
  }

  async answerStep(answer: StepAnswer): Promise<SignInStep> {
    this.log('answerStep')
    const step = this.step
    if (step === null || step.at !== answer.step) return { step: 'error', problem: 'unsupported' }
    switch (answer.step) {
      case 'homes':
        step.at = 'firstSync'
        return { step: 'firstSync', adds: 9, removes: 0 }
      case 'firstSync':
        if (!answer.go) {
          this.step = null
          return { step: 'error', problem: 'sessionEnded' }
        }
        return this.joined(step.place, step.server, step.account)
      case 'second':
        return answer.code === '000000'
          ? { step: 'error', problem: 'auth' }
          : this.joined(step.place, step.server, step.account)
      default:
        return this.joined(step.place, step.server, step.account)
    }
  }

  async checkServer(place: 'kemlock' | 'vaultwarden', server: string): Promise<ServerCheck> {
    this.log('checkServer')
    void place
    if (server.startsWith('http://')) return { ok: false, problem: 'insecure' }
    return server.startsWith('https://') ? { ok: true } : { ok: false, problem: 'kemlockAddress' }
  }

  async securityKeyChallenge(): Promise<SecurityKeyChallenge | null> {
    const step = this.step
    if (step === null || step.at !== 'second') return null
    return {
      domain: step.server,
      path: step.place === 'kemlock' ? '/kem/v1/webauthn' : '/webauthn-fallback-connector.html',
      data: 'fake-challenge',
    }
  }

  async account(request: AccountRequest): Promise<AccountResult> {
    this.log(`account:${request.op}`)
    this.need()
    return this.accounts.call(request)
  }

  async syncNow(): Promise<SyncStatus> {
    this.log('syncNow')
    const disk = this.need()
    if (disk.sync === null) throw new FakeError('notSignedIn')
    if (this.guard !== undefined) {
      const { count, scope, items } = this.guard
      disk.sync = {
        ...disk.sync,
        running: false,
        problem: 'removals',
        pendingRemovals: count,
        scopeSize: scope,
        ...(items === undefined ? {} : { pendingRemovalItems: items }),
      }
    } else if (this.syncProblem !== undefined) {
      disk.sync = { ...disk.sync, running: false, problem: this.syncProblem }
    } else {
      const {
        problem: _problem,
        pendingRemovals: _count,
        scopeSize: _scope,
        pendingRemovalItems: _items,
        ...rest
      } = disk.sync
      disk.sync = { ...rest, running: false, lastSync: this.now() }
    }
    return structuredClone(disk.sync)
  }

  async confirmRemovals(): Promise<SyncStatus> {
    this.log('confirmRemovals')
    this.guard = undefined
    this.guardAnswer = 'remove'
    return this.syncNow()
  }

  async keepRemovals(): Promise<SyncStatus> {
    this.log('keepRemovals')
    this.guard = undefined
    this.guardAnswer = 'keep'
    return this.syncNow()
  }

  async signOut(): Promise<void> {
    this.log('signOut')
    this.need().sync = null
  }

  async settings(): Promise<Settings> {
    return { ...this.need().settings }
  }

  async saveSettings(settings: Partial<Settings>): Promise<Settings> {
    const disk = this.need()
    disk.settings = { ...disk.settings, ...settings }
    return { ...disk.settings }
  }

  /* Passkey unlock (added by unlock) ---------------------------------------------------------- */

  async passkeyUnlockInfo(): Promise<PasskeyUnlockInfo> {
    return passkeysOf(this.disk, this.now).info()
  }

  async passkeyUnlockPrepare(): Promise<PasskeyEnrolOptions> {
    this.need()
    return passkeysOf(this.disk, this.now).prepare()
  }

  async addPasskeyUnlock(input: NewPasskey): Promise<PasskeyUnlockInfo> {
    this.log('addPasskeyUnlock')
    const disk = this.need()
    // Checked as an unlock is, and counted when it is wrong
    if (input.password !== disk.password) {
      disk.wrongPasswords += 1
      disk.lastWrongAt = this.now()
      throw new FakeError('wrongPassword')
    }
    disk.wrongPasswords = 0
    passkeysOf(this.disk, this.now).passwordUsed()
    return passkeysOf(this.disk, this.now).add(input)
  }

  async renamePasskeyUnlock(id: string, name: string): Promise<PasskeyUnlockInfo> {
    this.need()
    return passkeysOf(this.disk, this.now).rename(id, name)
  }

  async removePasskeyUnlock(id: string): Promise<PasskeyUnlockInfo> {
    this.log('removePasskeyUnlock')
    this.need()
    return passkeysOf(this.disk, this.now).remove(id)
  }

  async unlockWithPasskey(answer: PasskeyUnlockAnswer): Promise<PasskeyUnlockResult> {
    this.log('unlockWithPasskey')
    if (!this.disk.exists) throw new FakeError('noVault')
    const before = this.disk.wrongPasswords
    const outcome = passkeysOf(this.disk, this.now).open(answer)
    if (outcome !== 'opened') return { ok: false, wrongPasswords: before, reason: outcome }
    this.disk.wrongPasswords = 0
    this.unlocked = true
    return { ok: true, wrongPasswords: before }
  }
  /* Sends (added by sends): src/background/core/fake-sends.ts does the work ------------------- */

  sendsList(): Promise<SendResult<SendsListing>> {
    return this.sends.list()
  }

  sendsGet(id: string): Promise<SendResult<SendDetail>> {
    return this.sends.get(id)
  }

  sendsLink(id: string): Promise<SendResult<string>> {
    return this.sends.link(id)
  }

  sendsStageFile(
    data: string,
    handle: string | null,
  ): Promise<SendResult<{ handle: string; length: number }>> {
    return this.sends.stageFile(data, handle)
  }

  sendsMake(input: NewSendInput): Promise<SendResult<{ id: string; link: string }>> {
    this.log('sendsMake')
    return this.sends.make(input)
  }

  sendsUpdate(id: string, patch: SendPatch): Promise<SendResult<null>> {
    return this.sends.update(id, patch)
  }

  sendsDelete(id: string): Promise<SendResult<null>> {
    return this.sends.delete(id)
  }

  sendsOpen(link: string, password?: string): Promise<SendResult<ReceivedSendView>> {
    this.log('sendsOpen')
    return this.sends.open(link, password)
  }

  sendsDownload(handle: string): Promise<SendResult<{ size: number }>> {
    return this.sends.download(handle)
  }

  async sendsReadFile(handle: string, index: number): Promise<string> {
    return this.sends.readFile(handle, index)
  }

  async sendsReceivedText(handle: string): Promise<string> {
    return this.sends.receivedText(handle)
  }

  async sendsClose(handle: string): Promise<void> {
    this.sends.close(handle)
  }
  /* Custom fields, links, code details, files (item format) ------------------------------- */

  /** Whether files go up and down now: the switch, else whether the vault syncs with Kemlock Server. */
  private fileSyncNow(): FileSync {
    return this.fileSync ?? (this.disk.sync?.place === 'kemlock' ? 'kemlock' : 'readOnly')
  }

  /** The item a ref names: what it is called and the line under it. */
  private findItem(ref: ItemRef): { name: string; detail?: string } | undefined {
    const disk = this.disk
    const named = (name: string, detail?: string) => ({
      name,
      ...(detail === undefined || detail === '' ? {} : { detail }),
    })
    switch (ref.kind) {
      case 'login': {
        const login = disk.logins.find((l) => l.id === ref.id)
        return login === undefined ? undefined : named(login.name, login.username)
      }
      case 'otp': {
        const code = disk.codes.find((c) => c.id === ref.id)
        return code === undefined ? undefined : named(code.name ?? code.issuer, code.account)
      }
      case 'backup-codes': {
        const backup = disk.backups.find((b) => b.serviceId === ref.id)
        return backup === undefined ? undefined : named(backup.name ?? backup.issuer)
      }
      case 'note': {
        const note = disk.items.notes.find((n) => n.id === ref.id)
        return note === undefined ? undefined : named(note.title)
      }
      case 'card': {
        const card = disk.items.cards.find((c) => c.id === ref.id)
        return card === undefined ? undefined : named(card.name, card.brand)
      }
      case 'identity': {
        const identity = disk.items.identities.find((i) => i.id === ref.id)
        return identity === undefined ? undefined : named(identity.name, identity.email)
      }
      case 'file': {
        const file = disk.items.files.find((f) => f.id === ref.id)
        return file === undefined ? undefined : named(file.name, file.fileName)
      }
      default:
        return this.keysFake.nameOf(ref)
    }
  }

  /** Every item that may be linked, for the candidates. */
  private allItems(): { ref: ItemRef; name: string; detail?: string }[] {
    const disk = this.disk
    const kinds: [ItemKind, string[]][] = [
      ['login', disk.logins.map((l) => l.id)],
      ['otp', disk.codes.map((c) => c.id)],
      ['backup-codes', disk.backups.map((b) => b.serviceId)],
      ['note', disk.items.notes.map((n) => n.id)],
      ['card', disk.items.cards.map((c) => c.id)],
      ['identity', disk.items.identities.map((i) => i.id)],
      ['file', disk.items.files.map((f) => f.id)],
    ]
    const out: { ref: ItemRef; name: string; detail?: string }[] = []
    for (const [kind, ids] of kinds)
      for (const id of ids) {
        const ref = { kind, id }
        const found = this.findItem(ref)
        if (found !== undefined) out.push({ ref, ...found })
      }
    return [...out, ...this.keysFake.items()]
  }

  /** The link a code and its login keep apart from `links` (`linkedLoginId`). */
  private legacyLinks(ref: ItemRef): ItemRef[] {
    const disk = this.disk
    if (ref.kind === 'otp') {
      const code = disk.codes.find((c) => c.id === ref.id)
      return code?.loginId === undefined ? [] : [{ kind: 'login', id: code.loginId }]
    }
    if (ref.kind === 'login')
      return disk.codes.filter((c) => c.loginId === ref.id).map((c) => ({ kind: 'otp' as const, id: c.id }))
    return []
  }

  private clearLegacy(a: ItemRef, b: ItemRef): void {
    const code = [a, b].find((ref) => ref.kind === 'otp')
    const login = [a, b].find((ref) => ref.kind === 'login')
    if (code === undefined || login === undefined) return
    const held = this.disk.codes.find((c) => c.id === code.id)
    if (held?.loginId !== login.id) return
    held.loginId = undefined
    for (const other of this.disk.logins) if (other.codeId === code.id) other.codeId = undefined
  }

  private itemOf(ref: ItemRef): ItemRef {
    this.need()
    if (this.findItem(ref) === undefined) throw new FakeError('notFound')
    return ref
  }

  async customFieldDefs(_refresh?: boolean): Promise<CustomFieldDefs> {
    this.log('customFieldDefs')
    this.need()
    // Off Kemlock Server there are no definitions, and a person may add fields of their own
    return this.disk.sync?.place === 'kemlock'
      ? { fields: structuredClone(this.adminFields), allowOwn: this.allowOwn }
      : { fields: [], allowOwn: true }
  }

  async revealField(ref: ItemRef, index: number): Promise<string> {
    this.log('revealField')
    return this.extras.revealField(this.itemOf(ref), index)
  }

  async revealFields(ref: ItemRef): Promise<{ index: number; value: string }[]> {
    this.log('revealFields')
    return this.extras.revealFields(this.itemOf(ref))
  }

  async linkedItems(ref: ItemRef): Promise<LinkedItemView[]> {
    return this.extras.linked(this.itemOf(ref))
  }

  async linkCandidates(ref: ItemRef | null, query: string): Promise<LinkedItemView[]> {
    this.need()
    return this.extras.candidates(ref, query)
  }

  async setLinks(ref: ItemRef, refs: ItemRef[]): Promise<{ linkFailures: string[] }> {
    this.log('setLinks')
    return { linkFailures: this.extras.setLinks(this.itemOf(ref), refs) }
  }

  private findCode(id: string): StoredCode {
    const code = this.need().codes.find((c) => c.id === id)
    if (code === undefined) throw new FakeError('notFound')
    return code
  }

  async saveCode(id: string, input: CodeInput): Promise<CodeView> {
    this.log('saveCode')
    const code = this.findCode(id)
    this.extras.validate({ kind: 'otp', id }, input)
    const lent = this.lent({ kind: 'otp', id }).from.length > 0
    const name = input.name?.trim()
    if (input.name !== undefined) {
      if (name === '') delete code.name
      else code.name = name
    }
    // The websites a linked item lends are changed there, not here
    if (input.websites !== undefined && !lent)
      code.websites = input.websites.map((site) => site.trim()).filter((site) => site !== '')
    if (input.note !== undefined) {
      if (input.note.trim() === '') delete code.note
      else code.note = input.note
    }
    if (input.pinned !== undefined) code.pinned = input.pinned
    return this.codeView(code, this.extras.apply({ kind: 'otp', id }, input))
  }

  async saveBackupCodes(serviceId: string, input: BackupCodesInput): Promise<BackupCodeView> {
    this.log('saveBackupCodes')
    const backup = this.need().backups.find((b) => b.serviceId === serviceId)
    if (backup === undefined) throw new FakeError('notFound')
    this.extras.validate({ kind: 'backup-codes', id: serviceId }, input)
    if (input.name !== undefined) {
      if (input.name.trim() === '') delete backup.name
      else backup.name = input.name.trim()
    }
    if (input.websites !== undefined)
      backup.websites = input.websites.map((site) => site.trim()).filter((site) => site !== '')
    if (input.note !== undefined) {
      if (input.note.trim() === '') delete backup.note
      else backup.note = input.note
    }
    return this.backupView(backup, this.extras.apply({ kind: 'backup-codes', id: serviceId }, input))
  }

  // File items and note attachments: src/background/core/fake-files.ts does the work
  files(): Promise<FileView[]> {
    return this.fileStore.files()
  }

  revealFile(id: string): Promise<FileFull> {
    return this.fileStore.revealFile(id)
  }

  deleteFile(id: string): Promise<void> {
    this.log('deleteFile')
    return this.fileStore.deleteFile(id)
  }

  saveFile(id: string | null, input: FileInput): Promise<FileView> {
    this.log('saveFile')
    return this.fileStore.saveFile(id, input)
  }

  stageItemFile(data: string, handle: string | null): Promise<{ handle: string; length: number }> {
    return this.fileStore.stageItemFile(data, handle)
  }

  releaseStaged(handle: string): Promise<void> {
    return this.fileStore.releaseStaged(handle)
  }

  addAttachments(noteId: string, files: StagedAttachment[]): Promise<NoteFull> {
    this.log('addAttachments')
    return this.fileStore.addAttachments(noteId, files)
  }

  removeAttachment(noteId: string, attachmentId: string): Promise<NoteFull> {
    this.log('removeAttachment')
    return this.fileStore.removeAttachment(noteId, attachmentId)
  }

  openItemFile(ref: ItemRef, attachmentId?: string): Promise<Opened> {
    this.log('openItemFile')
    return this.fileStore.openItemFile(ref, attachmentId)
  }

  readOpened(handle: string, index: number): Promise<string> {
    return this.fileStore.readOpened(handle, index)
  }

  closeOpened(handle: string): Promise<void> {
    return this.fileStore.closeOpened(handle)
  }

  // Added by keys: keys, contacts and the PGP tools, in fake-keys.ts
  private keysState: KeysFake | undefined
  private get keysFake(): KeysFake {
    return (this.keysState ??= new KeysFake(
      this.disk,
      () => this.unlocked && this.disk.exists,
      () => this.now(),
      this.extras,
    ))
  }
  keys: CoreApi['keys'] = () => this.keysFake.keys()
  keyPublic: CoreApi['keyPublic'] = (id) => this.keysFake.keyPublic(id)
  exportKey: CoreApi['exportKey'] = (args) => this.keysFake.exportKey(args)
  saveKey: CoreApi['saveKey'] = (args) => this.keysFake.saveKey(args)
  deleteKey: CoreApi['deleteKey'] = (id) => this.keysFake.deleteKey(id)
  generateKey: CoreApi['generateKey'] = (args) => this.keysFake.generateKey(args)
  previewKey: CoreApi['previewKey'] = (args) => this.keysFake.previewKey(args)
  importKey: CoreApi['importKey'] = (args) => this.keysFake.importKey(args)
  contacts: CoreApi['contacts'] = () => this.keysFake.contacts()
  previewContacts: CoreApi['previewContacts'] = (args) => this.keysFake.previewContacts(args)
  addContacts: CoreApi['addContacts'] = (args) => this.keysFake.addContacts(args)
  saveContact: CoreApi['saveContact'] = (args) => this.keysFake.saveContact(args)
  contactPublic: CoreApi['contactPublic'] = (id) => this.keysFake.contactPublic(id)
  deleteContact: CoreApi['deleteContact'] = (id) => this.keysFake.deleteContact(id)
  pgpEncrypt: CoreApi['pgpEncrypt'] = (args) => this.keysFake.pgpEncrypt(args)
  pgpDecrypt: CoreApi['pgpDecrypt'] = (args) => this.keysFake.pgpDecrypt(args)
  pgpSign: CoreApi['pgpSign'] = (args) => this.keysFake.pgpSign(args)
  pgpVerify: CoreApi['pgpVerify'] = (args) => this.keysFake.pgpVerify(args)
  sshSign: CoreApi['sshSign'] = (args) => this.keysFake.sshSign(args)
  sshVerify: CoreApi['sshVerify'] = (args) => this.keysFake.sshVerify(args)
}

// Added by tools: the vault tools' methods (src/background/core/fake-tools.ts) join the class
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface FakeCore extends ToolsCoreApi {}
Object.assign(FakeCore.prototype, fakeToolsMethods)

const twoStepSites = new Set(['github.com', 'orbit-cloud.com'])
const breachedPasswords = new Set(['password', '123456', 'qwerty'])
const registrableOf = (website: string) => {
  const host = hostOf(website)
  return host === null ? website : registrable(host)
}
const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])
