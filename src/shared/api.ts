// The contract between the extension's parts (design decisions 3 and 4).
//
// - `CoreApi` is what the background calls in the Dart core (core/, compiled with dart2wasm over
//   Kemlock-core). Only the background holds it. Secrets stay inside it: a code's secret never
//   leaves, and a password leaves only through `revealLogin`, which the background calls to copy or
//   fill, never to answer a page.
// - `PageApi` is what the extension's own pages (popup, setup, menu) may ask the background.
// - `ContentApi` is what a content script may ask; it names no site, the background answers for the
//   frame the browser reports.
//
// Every value here is JSON: messages cross `runtime.sendMessage`, and the core answers through
// JS interop with plain objects. Times are milliseconds since the epoch.

/* ----------------------------------------------------------------------------------------------- */
/* What the vault holds, as the browser shows it                                                     */
/* ----------------------------------------------------------------------------------------------- */

export type CodeType = 'totp' | 'hotp' | 'steam'

/** A code's account, with no secret. */
export interface CodeView {
  id: string
  issuer: string
  account: string
  type: CodeType
  digits: number
  /** TOTP and Steam: seconds per code. */
  period: number
  tags: string[]
  /** The vault's own order (spec: shown, not changed). */
  order: number
  /** Kept on a security key: named, never computed or filled (spec). */
  onSecurityKey: boolean
  /** Its websites and the issuer's domains, for matching and the hint. */
  websites: string[]
  /** The login it is linked to, if any. */
  loginId?: string
  /** Backup codes left for the service, when the vault has them. */
  backupCodesLeft?: number
}

/** A live code: only the digits leave the core. */
export interface LiveCode {
  id: string
  code: string
  /** When it stops being valid (TOTP, Steam); absent for HOTP. */
  expiresAt?: number
}

export interface LoginHealth {
  reused: boolean
  weak: boolean
  /** The site offers two-step sign-in and no code is linked. */
  withoutItsCode: boolean
  /** Known from a breach (only behind the breached-passwords switch). */
  breached?: boolean
  /** "Don't warn for this login". */
  ignored: boolean
}

/** A login, with no password. */
export interface LoginView {
  id: string
  name: string
  username: string
  websites: string[]
  tags: string[]
  order: number
  note?: string
  hasPassword: boolean
  /** Strength 0 (weakest) to 4, the app's meter. */
  strength: number
  passwordChangedAt?: number
  previousPasswords: number
  codeId?: string
  health: LoginHealth
}

export interface LoginSecret {
  username: string
  password: string
}

export interface LoginInput {
  name: string
  username: string
  password: string
  websites: string[]
  note?: string
  tags?: string[]
}

export interface BackupCodeView {
  /** The service's id; one row per service. */
  serviceId: string
  issuer: string
  total: number
  left: number
}

/** What fills on a page or a tab's address: every match is offered (spec). */
export interface SiteMatch {
  /** The address's registrable domain, shown in the picker. */
  site: string
  logins: string[]
  codes: string[]
  /** The address looks like a known site's but isn't it (the look-alike guard). */
  lookAlikeOf?: string
}

export interface GeneratorOptions {
  mode: 'random' | 'passphrase'
  /** Random: 8 to 128. */
  length?: number
  lowercase?: boolean
  uppercase?: boolean
  digits?: boolean
  symbols?: boolean
  /** Passphrase: 3 to 20 words from the EFF list. */
  words?: number
  separator?: string
  capitalize?: boolean
  includeNumber?: boolean
  /** A site's rules (maxlength, minlength, pattern, password-rules), when filling a new-password field. */
  siteRules?: string
  // Added by popup
  /** Leave out look-alike characters (l, 1, I, O, 0); true when not given. */
  avoidLookAlikes?: boolean
}

export interface GeneratedPassword {
  value: string
  at: number
  site?: string
}

export interface HealthReport {
  reused: string[]
  weak: string[]
  withoutItsCode: string[]
  breached: string[]
}

/* ----------------------------------------------------------------------------------------------- */
/* The vault's state, and sync                                                                       */
/* ----------------------------------------------------------------------------------------------- */

export type SyncPlace = 'kemlock' | 'webdav' | 'vaultwarden'

/** The app's sync problems (sync_problem_* in _locales): sync stops and says why. */
export type SyncProblem =
  | 'signedOut'
  | 'modeChanged'
  | 'homeMissing'
  | 'removals'
  | 'unsupported'
  | 'older'
  | 'auth'
  | 'network'
  | 'server'
  | 'kemlockAddress'
  | 'kemlockOlder'
  | 'sessionEnded'
  | 'sessionReused'
  | 'spaceCantBeChecked'
  | 'spaceKeysPending'
  | (string & {})

export interface SyncStatus {
  place: SyncPlace
  /** The server or folder address. */
  server: string
  account?: string
  deviceName?: string
  lastSync?: number
  running: boolean
  problem?: SyncProblem
  /** A removal guard asked first (spec): how many would go. */
  pendingRemovals?: number
  /** Vaultwarden: logins travel through WebDAV only (spec), so the popup says so. */
  loginsNotSynced?: boolean
  // Added by popup
  storage?: 'sealed' | 'plain'
  /** The home's name. */
  home?: string
}

export interface VaultState {
  exists: boolean
  unlocked: boolean
  /** Wrong passwords since the vault last opened, and the last one's time (spec). */
  wrongPasswords: number
  lastWrongAt?: number
  sync?: SyncStatus
}

export interface UnlockResult {
  ok: boolean
  wrongPasswords: number
}

/** Sign-in as steps, the engine's own (KmSignIn, VwSignInStep), as data. */
export type SignInStep =
  | { step: 'done'; status: SyncStatus }
  /** A second step: the methods the browser can answer, the others named. */
  | { step: 'second'; methods: SecondMethod[]; unsupported: string[] }
  /** Kemlock Server: approve from another device, which shows these five words. */
  | { step: 'approval'; phrase: string[]; requestId: string }
  /** Kemlock Server: the account key opens with the master password (no trusted device). */
  | { step: 'masterPassword' }
  /** Vaultwarden: the vault's Kemlock homes to join, with their storage and counts. */
  | { step: 'homes'; homes: HomeView[] }
  /** A WebDAV folder or a sealed home asks for the sync passphrase. */
  | { step: 'passphrase' }
  /** The first sync is shown before it runs (spec). */
  | { step: 'firstSync'; adds: number; removes: number }
  | { step: 'error'; problem: SyncProblem; message?: string }

// Added by setup
export type ServerCheck = { ok: true } | { ok: false; problem: SyncProblem }

/** The connector page of the last sign-in's security-key step, opened on the server's own address. */
export interface SecurityKeyChallenge {
  domain: string
  path: string
  data: string
}
// End of added by setup

export type SecondMethod = 'authenticator' | 'email' | 'yubikey' | 'securityKey' | 'duo' | 'apiKey'

export interface HomeView {
  id: string
  name: string
  storage: 'sealed' | 'plain'
  items: number
}

export interface KemlockSignIn {
  server: string
  email: string
  password: string
}

export interface WebdavSignIn {
  folder: string
  username: string
  password: string
}

export interface VaultwardenSignIn {
  server: string
  email: string
  password: string
}

export interface Settings {
  /** Minutes: 1, 5, 15 or 60. */
  autoLockMinutes: 1 | 5 | 15 | 60
  lockOnSleep: boolean
  /** The code is offered on the page after the password (spec). */
  codeAfterPassword: boolean
  /** Buttons in fields on every site (the optional all-sites permission). */
  buttonsOnPages: boolean
  /** Look passwords up in known breaches (k-anonymity, off by default). */
  breachedPasswords: boolean
  /** Save and update prompts. */
  offerToSave: boolean
  clipboardSeconds: number
}

/* ----------------------------------------------------------------------------------------------- */
/* The core                                                                                          */
/* ----------------------------------------------------------------------------------------------- */

/**
 * The Dart core, as the background sees it (src/background/core/). Implemented by core/ through
 * dart2wasm; `FakeCore` (src/background/core/fake.ts) stands in for it in tests.
 */
export interface CoreApi {
  // The vault (browser-vault spec)
  state(): Promise<VaultState>
  createVault(password: string): Promise<void>
  unlock(password: string): Promise<UnlockResult>
  lock(): Promise<void>
  removeVault(): Promise<void>
  /** The open vault's keys, sealed for storage.session, so a restarted worker opens it again. */
  exportSession(): Promise<string>
  /** False when the blob doesn't open (another browser session): the vault stays locked. */
  restoreSession(blob: string): Promise<boolean>

  // What it holds
  codes(): Promise<CodeView[]>
  liveCodes(ids: string[], now: number): Promise<LiveCode[]>
  /** HOTP: the next code, counting it. */
  nextHotp(id: string): Promise<LiveCode>
  logins(): Promise<LoginView[]>
  revealLogin(id: string): Promise<LoginSecret>
  saveLogin(id: string | null, input: LoginInput): Promise<LoginView>
  deleteLogin(id: string): Promise<void>
  /** "Don't warn for this login". */
  ignoreHealth(id: string, ignored: boolean): Promise<void>
  backupCodes(): Promise<BackupCodeView[]>
  /** Marks the next backup code used and returns it. */
  useBackupCode(serviceId: string): Promise<string>
  /** An otpauth:// link (pasted, or read from a QR code), with the page's site as its website. */
  addCode(otpauth: string, website?: string, linkTo?: string): Promise<CodeView>
  /** Decodes a QR code from an image (a PNG data URL, e.g. captureVisibleTab), or null. */
  readQr(imageDataUrl: string): Promise<string | null>
  linkCode(codeId: string, loginId: string | null): Promise<void>

  // Added by background: sealed in the vault where the core can, else the background keeps them
  // for the session only (optional, so a core without them still fits).
  /** "Always suggest here": the items the person picked on a host, remembered in this browser. */
  rememberPick?(host: string, itemId: string): Promise<void>
  picks?(host: string): Promise<string[]>
  /** The hosts an item was picked on, and forgetting one (without these the background keeps an index in storage.local). */
  pickedHosts?(itemId: string): Promise<string[]>
  forgetPick?(host: string, itemId: string): Promise<void>
  /** Recently generated passwords (30 days, never synced), newest first. */
  recentPasswords?(): Promise<GeneratedPassword[]>
  addRecentPassword?(password: GeneratedPassword): Promise<void>
  // End of added by background

  // Matching, generating, health
  match(address: string): Promise<SiteMatch>
  generate(options: GeneratorOptions): Promise<string>
  health(): Promise<HealthReport>

  // Sync (browser-sync spec, and docs/plans/add-kemlock-server-sync.md)
  syncStatus(): Promise<SyncStatus | null>
  signInKemlock(input: KemlockSignIn): Promise<SignInStep>
  signInWebdav(input: WebdavSignIn): Promise<SignInStep>
  signInVaultwarden(input: VaultwardenSignIn): Promise<SignInStep>
  /** Answers the step the last sign-in returned (a code, a passphrase, a home id, `approve` to poll). */
  answerStep(answer: StepAnswer): Promise<SignInStep>
  syncNow(): Promise<SyncStatus>
  /** The removal guard: go on with the run that would remove many. */
  confirmRemovals(): Promise<SyncStatus>
  signOut(): Promise<void>
  // Added by setup
  /** Checks that the address answers as a supported server, before any password is asked. */
  checkServer(place: 'kemlock' | 'vaultwarden', server: string): Promise<ServerCheck>
  /** The connector page for the last sign-in's security-key step, or null. */
  securityKeyChallenge(): Promise<SecurityKeyChallenge | null>
  // End of added by setup

  settings(): Promise<Settings>
  saveSettings(settings: Partial<Settings>): Promise<Settings>
}

export type StepAnswer =
  | { step: 'second'; method: SecondMethod; code: string; remember: boolean }
  /** A security key's assertion, from the setup tab on the server's own address. */
  | { step: 'securityKey'; assertion: string; remember: boolean }
  | { step: 'approval'; requestId: string }
  | { step: 'masterPassword'; password: string }
  | { step: 'homes'; homeId: string }
  | { step: 'passphrase'; passphrase: string }
  | { step: 'firstSync'; go: boolean }

/* ----------------------------------------------------------------------------------------------- */
/* What the extension's pages and content scripts may ask the background                             */
/* ----------------------------------------------------------------------------------------------- */

/** The popup's view of the tab in front. */
export interface TabView {
  tabId: number
  address: string
  match: SiteMatch
}

export interface PopupView {
  state: VaultState
  tab?: TabView
}

// Added by setup (begin): what the setup tab needs beyond the sign-in steps.
/** What `checkServer` found: the address answers as the place's server, or the app's problem. */
export type ServerCheck = { ok: true } | { ok: false; problem: SyncProblem }

/**
 * The security key's connector on the server's own address (design decision 13). Setup opens
 * `domain + path + ?data=<data>&parent=<setup page>&v=1&locale=<language>` in a tab, relays the
 * page's `webAuthnResult` and answers `{ step: 'securityKey', assertion }`. Vaultwarden: the web
 * vault's `/webauthn-fallback-connector.html`; Kemlock Server: `/kem/v1/webauthn`.
 */
export interface SecurityKeyChallenge {
  /** The server's own address (Vaultwarden's DOMAIN, the Kemlock server's address), no trailing slash. */
  domain: string
  /** The connector page's path on it. */
  path: string
  /** The challenge, encoded for the connector's `data` parameter. */
  data: string
}
// Added by setup (end)

/**
 * The extension's own pages' requests. Each is `{ kind, ...args }` on the wire
 * (`PageRequest`), and the answer is the method's result, or `{ error }`.
 */
export interface PageApi {
  popup(): Promise<PopupView>
  createVault(args: { password: string }): Promise<void>
  unlock(args: { password: string }): Promise<UnlockResult>
  lock(): Promise<void>
  removeVault(): Promise<void>

  codes(): Promise<CodeView[]>
  liveCodes(args: { ids: string[] }): Promise<LiveCode[]>
  nextHotp(args: { id: string }): Promise<LiveCode>
  logins(): Promise<LoginView[]>
  saveLogin(args: { id: string | null; input: LoginInput }): Promise<LoginView>
  deleteLogin(args: { id: string }): Promise<void>
  ignoreHealth(args: { id: string; ignored: boolean }): Promise<void>
  /** Shows the password on the login's page, after the vault's password again when it was set so. */
  showPassword(args: { id: string }): Promise<string>
  backupCodes(): Promise<BackupCodeView[]>
  health(): Promise<HealthReport>
  generate(args: { options: GeneratorOptions }): Promise<string>
  recentPasswords(): Promise<GeneratedPassword[]>

  /** Copies through the background (decision 14), cleared later only if unchanged. */
  copy(args: {
    what: 'username' | 'password' | 'code' | 'backupCode' | 'generated'
    id: string
    value?: string
  }): Promise<void>
  /** Fills the tab in front, its frame that holds the field, after the site check (decision 4). */
  fill(args: {
    tabId: number
    frameId?: number
    fieldId?: string
    loginId?: string
    codeId?: string
    // Added by background: a suggested password fills the field and its confirmation, and is
    // kept under Recently generated; `remember` is "Always suggest here" on an unknown site.
    newPassword?: string
    remember?: boolean
  }): Promise<void>

  addCodeFromLink(args: { otpauth: string; linkTo?: string }): Promise<CodeView>
  /** Reads a QR code shown in the tab in front. */
  addCodeFromTab(args: { tabId: number; linkTo?: string }): Promise<CodeView | null>
  linkCode(args: { codeId: string; loginId: string | null }): Promise<void>
  // Added by popup
  /** The code each id will show once its current one ends (the popup asks in a code's last 5 seconds). */
  nextCodes(args: { ids: string[] }): Promise<LiveCode[]>
  /** Marks the next unused backup code used; `copy({what:'backupCode'})` copies that same code. */
  useBackupCode(args: { serviceId: string }): Promise<void>
  /** The sites a login was picked for with "Always fill on this site", and forgetting one. */
  rememberedSites(args: { loginId: string }): Promise<string[]>
  forgetSite(args: { loginId: string; host: string }): Promise<void>
  // End of added by popup

  syncStatus(): Promise<SyncStatus | null>
  signInKemlock(args: KemlockSignIn): Promise<SignInStep>
  signInWebdav(args: WebdavSignIn): Promise<SignInStep>
  signInVaultwarden(args: VaultwardenSignIn): Promise<SignInStep>
  answerStep(args: { answer: StepAnswer }): Promise<SignInStep>
  // Added by setup
  checkServer(args: { place: 'kemlock' | 'vaultwarden'; server: string }): Promise<ServerCheck>
  securityKeyChallenge(): Promise<SecurityKeyChallenge | null>
  // End of added by setup
  syncNow(): Promise<SyncStatus>
  confirmRemovals(): Promise<SyncStatus>
  signOut(): Promise<void>

  settings(): Promise<Settings>
  saveSettings(args: { settings: Partial<Settings> }): Promise<Settings>
  /** Asks for the all-sites permission (must run from a user gesture in a page). */
  allSitesGranted(): Promise<boolean>

  // Added by popup: what the popup needs and the contract lacked.
  /** The code each id will show when its current one ends (the popup's "next" in the last 5 seconds). */
  nextCodes(args: { ids: string[] }): Promise<LiveCode[]>
  /** Marks the service's next unused backup code used (copy() with what: 'backupCode' copies it first). */
  useBackupCode(args: { serviceId: string }): Promise<void>
  /** Hosts remembered for a login with "Always suggest here", in this browser only. */
  rememberedSites(args: { loginId: string }): Promise<string[]>
  forgetSite(args: { loginId: string; host: string }): Promise<void>

  /** The in-page menu's list for the frame that opened it. */
  menu(args: { tabId: number; frameId: number; fieldId: string }): Promise<MenuView>
  /** Saving or updating a login the content script saw sent (decision 10). */
  pendingSave(args: { tabId: number }): Promise<PendingSave | null>
  answerSave(args: { tabId: number; save: boolean; never?: boolean }): Promise<void>

  // Added by setup (begin)
  /**
   * Before the master password: the address answers as a Vaultwarden at a supported version, or
   * as a Kemlock Server (its /kem/v1/config). Sends nothing but the check; needs the access step.
   */
  checkServer(args: { place: 'kemlock' | 'vaultwarden'; server: string }): Promise<ServerCheck>
  /**
   * The challenge of the last sign-in's security key step, or null when the server serves no
   * connector page (the other methods and the API key are offered instead).
   */
  securityKeyChallenge(): Promise<SecurityKeyChallenge | null>
  // Added by setup (end)
}

export interface MenuView {
  state: VaultState
  match: SiteMatch
  logins: LoginView[]
  codes: CodeView[]
  /** A new-password field: suggestions, a strong password and a passphrase. */
  suggestions?: string[]
  field: { kind: 'username' | 'password' | 'newPassword' | 'code' }
  /** Added by background: sync's session ended (an SSO-only account has no password to type here), so point to setup. */
  signInAgain?: boolean
}

export interface PendingSave {
  site: string
  username: string
  /** An existing login whose password changed, when it is an update. */
  updateOf?: string
}

/** What a content script may ask (it names no site: the background takes the sender's frame). */
export interface ContentApi {
  /** The fields this frame found (decision 7); the answer says whether to show buttons. */
  fields(args: {
    fields: {
      id: string
      kind: 'username' | 'password' | 'newPassword' | 'code'
      boxes?: number
      /** Added by background: the field's site rules (maxlength, minlength, passwordrules). */
      rules?: string
    }[]
  }): Promise<{ buttons: boolean }>
  /** A form was sent with these values: maybe offer to save (decision 10). */
  sent(args: { username: string; password: string; newPassword?: string }): Promise<void>
  // Added by content
  /** The tab and frame this script is in, which the menu needs to name its field (`menu`). */
  frame(args: Record<string, never>): Promise<{ tabId: number; frameId: number }>
  // End of added by content
  /** The field's menu was opened by a click in plain view (decision 9). */
  openMenu(args: { fieldId: string }): Promise<void>
}

export type PageRequest = {
  [K in keyof PageApi]: { kind: K } & (Parameters<PageApi[K]> extends [infer A] ? A : object)
}[keyof PageApi]
export type ContentRequest = {
  [K in keyof ContentApi]: { kind: K } & Parameters<ContentApi[K]>[0]
}[keyof ContentApi]

/** The wire answer: the result, or an error the page shows in its own words. */
export type Answer<T> = { ok: true; value: T } | { ok: false; error: string }
