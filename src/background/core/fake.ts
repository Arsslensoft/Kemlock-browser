// A core that lives in memory, for the tests and for a development build (`KEMLOCK_FAKE_CORE=1`,
// the `__FAKE_CORE__` define): a vault with a password, a count of wrong passwords, codes that
// compute real TOTP, logins matched by an approximation of the registrable domain, the generator,
// health and a pretend sync. It follows `CoreApi`'s contract, not the app's formats.
import type {
  BackupCodeView,
  CodeType,
  CodeView,
  CoreApi,
  GeneratedPassword,
  GeneratorOptions,
  HealthReport,
  KemlockSignIn,
  LiveCode,
  LoginHealth,
  LoginInput,
  LoginSecret,
  LoginView,
  Settings,
  SignInStep,
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
} from '../../shared/api'

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

interface StoredLogin {
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
}

interface StoredCode {
  id: string
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
}

interface StoredBackup {
  serviceId: string
  issuer: string
  codes: string[]
  used: number
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
  sync: SyncStatus | null
  /** The sealed keys of the open vault: what the browser's session storage would hold. */
  session: string | null
  nextId: number
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
    sync: null,
    session: null,
    nextId: 1,
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

  constructor(options: FakeCoreOptions = {}) {
    this.disk = options.disk ?? emptyDisk()
    this.now = options.now ?? (() => Date.now())
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
      ...(this.unlocked && sync !== null ? { sync: structuredClone(sync) } : {}),
    }
  }

  async createVault(password: string): Promise<void> {
    this.log('createVault')
    if (this.disk.exists) throw new FakeError('exists')
    Object.assign(this.disk, emptyDisk(), { exists: true, password })
    this.unlocked = true
  }

  async unlock(password: string): Promise<UnlockResult> {
    this.log('unlock')
    if (!this.disk.exists) throw new FakeError('noVault')
    const before = this.disk.wrongPasswords
    if (password === this.disk.password) {
      this.disk.wrongPasswords = 0
      this.unlocked = true
      return { ok: true, wrongPasswords: before }
    }
    this.disk.wrongPasswords = before + 1
    this.disk.lastWrongAt = this.now()
    return { ok: false, wrongPasswords: this.disk.wrongPasswords }
  }

  async lock(): Promise<void> {
    this.log('lock')
    this.unlocked = false
    this.disk.session = null
  }

  async removeVault(): Promise<void> {
    this.log('removeVault')
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

  private codeView(code: StoredCode): CodeView {
    return {
      id: code.id,
      issuer: code.issuer,
      account: code.account,
      type: code.type,
      digits: code.digits,
      period: code.period,
      tags: [...code.tags],
      order: code.order,
      onSecurityKey: code.onSecurityKey,
      websites: [...code.websites],
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

  private loginView(login: StoredLogin): LoginView {
    return {
      id: login.id,
      name: login.name,
      username: login.username,
      websites: [...login.websites],
      tags: [...login.tags],
      order: login.order,
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

  async saveLogin(id: string | null, input: LoginInput): Promise<LoginView> {
    this.log('saveLogin')
    const disk = this.need()
    if (id === null) {
      const login: StoredLogin = {
        id: this.id('login'),
        name: input.name,
        username: input.username,
        password: input.password,
        websites: [...input.websites],
        tags: [...(input.tags ?? [])],
        order: disk.logins.length,
        ...(input.note === undefined ? {} : { note: input.note }),
        passwordChangedAt: this.now(),
        previous: [],
        ignored: false,
      }
      disk.logins.push(login)
      return this.loginView(login)
    }
    const login = this.findLogin(id)
    if (login.password !== input.password) {
      if (login.password !== '') login.previous.unshift(login.password)
      login.passwordChangedAt = this.now()
    }
    Object.assign(login, {
      name: input.name,
      username: input.username,
      password: input.password,
      websites: [...input.websites],
      tags: [...(input.tags ?? login.tags)],
      note: input.note,
    })
    return this.loginView(login)
  }

  async deleteLogin(id: string): Promise<void> {
    const disk = this.need()
    const login = this.findLogin(id)
    disk.logins = disk.logins.filter((l) => l !== login)
    for (const code of disk.codes) if (code.loginId === id) code.loginId = undefined
  }

  async ignoreHealth(id: string, ignored: boolean): Promise<void> {
    this.findLogin(id).ignored = ignored
  }

  async backupCodes(): Promise<BackupCodeView[]> {
    return this.need().backups.map((b) => ({
      serviceId: b.serviceId,
      issuer: b.issuer,
      total: b.codes.length,
      left: b.codes.length - b.used,
    }))
  }

  async useBackupCode(serviceId: string): Promise<string> {
    this.log('useBackupCode')
    const backup = this.need().backups.find((b) => b.serviceId === serviceId)
    if (backup === undefined || backup.used >= backup.codes.length)
      throw new FakeError('noBackupCodes')
    return backup.codes[backup.used++]
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
    if (match.logins.length === 0 && match.codes.length === 0) {
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
    return structuredClone(this.disk.sync)
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
}

const twoStepSites = new Set(['github.com', 'orbit-cloud.com'])
const breachedPasswords = new Set(['password', '123456', 'qwerty'])
const registrableOf = (website: string) => {
  const host = hostOf(website)
  return host === null ? website : registrable(host)
}
const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])
