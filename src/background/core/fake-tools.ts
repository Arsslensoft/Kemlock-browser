// The vault tools of the fake core (docs/plans/add-vault-tools.md): tags, pins and order, backup codes, duplicates and breach alerts
// on the fake's disk, as `ToolsCoreApi` says them. Like the rest of the fake, it follows the contract, not the app's formats: the
// real rules are Kemlock-core's (core/lib/src/tools_service.dart), and the Dart tests hold them.
import type { BackupCodeView } from '../../shared/api'
import type {
  BackupCoverage,
  BackupDetail,
  BreachAlert,
  BreachCheck,
  BreachesView,
  DuplicateGroup,
  DuplicateItem,
  DuplicateMatching,
  DuplicatesView,
  ItemKind,
  MergeDone,
  MergePlan,
  OrderedKind,
  TagChange,
  TagCount,
  ToolsCoreApi,
  ToolsSettings,
  UndoResult,
} from '../../shared/tools-api'
import type { FakeDisk, StoredBackup, StoredCode, StoredLogin } from './fake'
import type { FakeExtras } from './fake-extras'

/** What the fake core lends the tools: its disk and its small helpers (private members of the class, reached by name). */
interface Internals {
  disk: FakeDisk
  need(): FakeDisk
  now: () => number
  /** A service's backup codes as a view shows them, with the item format's name, websites, fields and links. */
  backupView(backup: StoredBackup): BackupCodeView
  extras: FakeExtras
}

const failure = (word: string): Error => Object.assign(new Error(word), { name: 'KemlockError' })

const maxTagLength = 24
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

/** The tags as the app's tag input makes them: trimmed, cut to 24 characters, each once whatever its case. */
export function normaliseTags(raw: string[]): string[] {
  const tags: string[] = []
  for (const text of raw) {
    let tag = text.trim()
    if (tag.length > maxTagLength) tag = tag.slice(0, maxTagLength).trimEnd()
    if (tag !== '' && !tags.some((held) => fold(held) === fold(tag))) tags.push(tag)
  }
  return tags
}

/** Which codes are used, the fake keeping them as a count first and as flags once one is marked by its place. */
function flagsOf(backup: StoredBackup): boolean[] {
  backup.flags ??= backup.codes.map((_, index) => index < backup.used)
  return backup.flags
}

const syncUsed = (backup: StoredBackup): void => {
  backup.used = flagsOf(backup).filter(Boolean).length
}

/** The codes in pasted text, as the app splits them: lines, commas, tabs and spaces; two short groups ("1234 5678") stay whole. */
export function parseCodes(text: string): string[] {
  const codes: string[] = []
  for (const line of text.split(/[\r\n]+/)) {
    for (const piece of line.split(/[,\t]+|\s{2,}/)) {
      const parts = piece.split(/\s+/).filter((part) => part !== '')
      if (parts.length === 2 && parts.every((part) => part.length <= 5)) codes.push(parts.join(' '))
      else codes.push(...parts)
    }
  }
  return [...new Set(codes)]
}

interface Taggable {
  tags: string[]
}

/** Every item that holds tags, with its kind (the fake keeps codes and logins only). */
function taggable(disk: FakeDisk): { kind: ItemKind; item: Taggable & { id: string } }[] {
  return [
    ...disk.codes.map((item) => ({ kind: 'code' as const, item })),
    ...disk.logins.map((item) => ({ kind: 'login' as const, item })),
  ]
}

function sameLogin(a: StoredLogin, b: StoredLogin): 'sameSignIn' | 'sameAccount' | null {
  if (a.username === '' || a.username.toLowerCase() !== b.username.toLowerCase()) return null
  const site = (login: StoredLogin) => login.websites.map((w) => w.toLowerCase()).sort().join(',')
  if (site(a) !== site(b)) return null
  return a.password === b.password ? 'sameSignIn' : 'sameAccount'
}

function groupsOf(disk: FakeDisk): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const dismissed = new Set(disk.tools?.dismissed ?? [])
  const view = (id: string, name: string, detail: string): DuplicateItem => ({
    id,
    name,
    detail,
    changedAt: 1,
  })
  const push = (group: DuplicateGroup) => {
    if (!dismissed.has(group.key)) groups.push(group)
  }
  const seen = new Set<string>()
  for (const a of disk.logins) {
    for (const b of disk.logins) {
      if (a.id >= b.id || seen.has(a.id) || seen.has(b.id)) continue
      const reason = sameLogin(a, b)
      if (reason === null) continue
      seen.add(a.id).add(b.id)
      push({
        key: [a.id, b.id].sort().join('|'),
        reason,
        kind: 'login',
        items: [a, b].map((l) => view(l.id, l.name, l.username)),
      })
    }
  }
  const byIssuer = new Map<string, StoredCode[]>()
  for (const code of disk.codes) {
    const key = code.secret.join(',')
    byIssuer.set(key, [...(byIssuer.get(key) ?? []), code])
  }
  for (const same of byIssuer.values()) {
    if (same.length < 2) continue
    push({
      key: same.map((c) => c.id).sort().join('|'),
      reason: 'sameCode',
      kind: 'account',
      items: same.map((c) => view(c.id, c.issuer, c.account)),
    })
  }
  return groups
}

/** The fake's breach list: one breach, of "Orbit Cloud", listed after the sample vault was made. */
const breachList = [
  {
    name: 'OrbitCloud',
    title: 'Orbit Cloud',
    domain: 'orbit-cloud.com',
    breachDate: '2026-02-01',
    addedDate: '2026-02-10',
    pwnCount: 1_200_000,
    passwords: true,
  },
]

const nameOf = (code: StoredCode) => (code.account === '' ? code.issuer : `${code.issuer} · ${code.account}`)

/** The tools of the fake core, put on `FakeCore.prototype`; each runs with the core as `this`. */
export const fakeToolsMethods: ToolsCoreApi & ThisType<Internals> = {
  async tags(): Promise<TagCount[]> {
    const disk = this.need()
    const counts = new Map<string, { name: string; count: number }>()
    for (const { item } of taggable(disk))
      for (const tag of item.tags) {
        const held = counts.get(fold(tag))
        if (held === undefined) counts.set(fold(tag), { name: tag, count: 1 })
        else held.count += 1
      }
    return [...counts.values()].sort((a, b) => fold(a.name).localeCompare(fold(b.name)))
  },

  async setTags(kind: ItemKind, id: string, tags: string[]): Promise<string[]> {
    const disk = this.need()
    const found = taggable(disk).find((entry) => entry.kind === kind && entry.item.id === id)
    if (found === undefined) throw failure('notFound')
    found.item.tags = normaliseTags(tags)
    return [...found.item.tags]
  },

  async renameTag(from: string, to: string): Promise<TagChange> {
    const [name] = normaliseTags([to])
    if (name === undefined) throw failure('invalid')
    let changed = 0
    for (const { item } of taggable(this.need())) {
      if (!item.tags.some((tag) => fold(tag) === fold(from))) continue
      item.tags = normaliseTags(item.tags.map((tag) => (fold(tag) === fold(from) ? name : tag)))
      changed += 1
    }
    return { changed, skipped: 0 }
  },

  async deleteTag(name: string): Promise<TagChange> {
    let changed = 0
    for (const { item } of taggable(this.need())) {
      if (!item.tags.some((tag) => fold(tag) === fold(name))) continue
      item.tags = item.tags.filter((tag) => fold(tag) !== fold(name))
      changed += 1
    }
    return { changed, skipped: 0 }
  },

  async setPinned(kind: OrderedKind, id: string, pinned: boolean): Promise<void> {
    const disk = this.need()
    const item = (kind === 'code' ? disk.codes : disk.logins).find((held) => held.id === id)
    if (item === undefined) throw failure('notFound')
    item.pinned = pinned ? true : undefined
  },

  async reorderCodes(ids: string[]): Promise<void> {
    const position = new Map<string, number>()
    for (const id of ids) if (!position.has(id)) position.set(id, position.size)
    for (const code of this.need().codes) {
      const at = position.get(code.id)
      if (at !== undefined) code.order = at
    }
  },

  async reorderLogins(ids: string[]): Promise<void> {
    const logins = this.need().logins
    const first = [...new Set(ids)]
      .map((id) => logins.find((login) => login.id === id))
      .filter((login): login is StoredLogin => login !== undefined)
    const rest = logins.filter((login) => !first.includes(login))
    for (const [index, login] of [...first, ...rest].entries()) login.order = index
  },

  async backupDetail(serviceId: string): Promise<BackupDetail> {
    const disk = this.need()
    const backup = disk.backups.find((held) => held.serviceId === serviceId)
    if (backup === undefined) throw failure('notFound')
    const flags = flagsOf(backup)
    const accounts = disk.codes.filter((code) => code.issuer.toLowerCase() === backup.issuer.toLowerCase())
    const ids = new Set(accounts.map((code) => code.id))
    return {
      serviceId,
      name: backup.issuer,
      ...(backup.note === undefined ? {} : { note: backup.note }),
      low: backup.codes.length > 0 && backup.codes.length - backup.used <= 2,
      codes: backup.codes.map((code, index) => ({ code, used: flags[index] === true })),
      accounts: accounts.map((code) => ({ id: code.id, name: code.issuer })),
      logins: disk.logins
        .filter((login) => login.codeId !== undefined && ids.has(login.codeId))
        .map((login) => ({ id: login.id, name: login.name })),
    }
  },

  async parseBackupCodes(text: string): Promise<string[]> {
    this.need()
    return parseCodes(text)
  },

  async addBackupService(name: string, text: string): Promise<BackupCodeView> {
    const disk = this.need()
    const codes = parseCodes(text)
    if (name.trim() === '' || codes.length === 0) throw failure('invalid')
    const backup: StoredBackup = {
      serviceId: `backup-${disk.nextId++}`,
      issuer: name.trim(),
      codes,
      used: 0,
    }
    disk.backups.push(backup)
    return this.backupView(backup)
  },

  async editBackupService(
    serviceId: string,
    name: string | null,
    note: string | null,
    clearNote: boolean,
  ): Promise<BackupCodeView> {
    const backup = this.need().backups.find((held) => held.serviceId === serviceId)
    if (backup === undefined) throw failure('notFound')
    if (name !== null) {
      if (name.trim() === '') throw failure('invalid')
      backup.issuer = name.trim()
    }
    if (clearNote || (note !== null && note.trim() === '')) delete backup.note
    else if (note !== null) backup.note = note.trim()
    return this.backupView(backup)
  },

  async addBackupCodes(
    serviceId: string,
    text: string,
  ): Promise<{ added: number; duplicates: number }> {
    const backup = this.need().backups.find((held) => held.serviceId === serviceId)
    if (backup === undefined) throw failure('notFound')
    const parsed = parseCodes(text)
    const fresh = parsed.filter((code) => !backup.codes.includes(code))
    const flags = flagsOf(backup)
    backup.codes.push(...fresh)
    flags.push(...fresh.map(() => false))
    return { added: fresh.length, duplicates: parsed.length - fresh.length }
  },

  async setBackupCodeUsed(
    serviceId: string,
    index: number,
    used: boolean,
    code: string,
  ): Promise<BackupCodeView> {
    const backup = this.need().backups.find((held) => held.serviceId === serviceId)
    if (backup === undefined || index < 0 || index >= backup.codes.length) throw failure('notFound')
    if (backup.codes[index] !== code) throw failure('stale')
    flagsOf(backup)[index] = used
    syncUsed(backup)
    return this.backupView(backup)
  },

  async removeBackupCode(serviceId: string, index: number, code: string): Promise<BackupCodeView> {
    const backup = this.need().backups.find((held) => held.serviceId === serviceId)
    if (backup === undefined || index < 0 || index >= backup.codes.length) throw failure('notFound')
    if (backup.codes[index] !== code) throw failure('stale')
    const flags = flagsOf(backup)
    backup.codes.splice(index, 1)
    flags.splice(index, 1)
    syncUsed(backup)
    return this.backupView(backup)
  },

  async deleteBackupService(serviceId: string): Promise<void> {
    const disk = this.need()
    if (!disk.backups.some((held) => held.serviceId === serviceId)) throw failure('notFound')
    this.extras.forget({ kind: 'backup-codes', id: serviceId })
    disk.backups = disk.backups.filter((held) => held.serviceId !== serviceId)
  },

  async backupCoverage(): Promise<BackupCoverage> {
    const disk = this.need()
    const checked = disk.codes.filter((code) => code.noBackupCodes !== true && !code.onSecurityKey)
    const missing = checked
      .filter(
        (code) => !disk.backups.some((b) => b.issuer.toLowerCase() === code.issuer.toLowerCase()),
      )
      .sort((a, b) => fold(a.issuer).localeCompare(fold(b.issuer)))
    return {
      total: checked.length,
      covered: checked.length - missing.length,
      missing: missing.map((code) => ({ id: code.id, name: code.issuer, account: code.account })),
    }
  },

  async setNoBackupCodes(codeId: string, none: boolean): Promise<void> {
    const code = this.need().codes.find((held) => held.id === codeId)
    if (code === undefined) throw failure('notFound')
    code.noBackupCodes = none ? true : undefined
  },

  async duplicates(): Promise<DuplicatesView> {
    const disk = this.need()
    return {
      checkedAt: this.now(),
      groups: groupsOf(disk),
      records: (disk.tools?.merges ?? []).map((m) => ({
        id: m.id,
        at: m.at,
        label: m.label,
        count: m.removed.length,
      })),
      matching: { available: disk.sync?.place === 'kemlock', on: disk.tools?.matching === true },
    }
  },

  async duplicateReview(key: string): Promise<MergePlan> {
    const group = groupsOf(this.need()).find((held) => held.key === key)
    if (group === undefined) throw failure('notFound')
    const logins = group.items.map((item) => this.disk.logins.find((l) => l.id === item.id))
    const fields: MergePlan['fields'] = []
    if (group.kind === 'login') {
      const text = (read: (l: StoredLogin) => string, hide = false) =>
        logins.map((l, i) => ({
          itemId: group.items[i]!.id,
          text: hide ? '••••••••' : l === undefined ? '' : read(l),
        }))
      const differs = (options: { text: string }[]) => new Set(options.map((o) => o.text)).size > 1
      const names = text((l) => l.name)
      if (differs(names)) fields.push({ id: 'name', picked: names[0]!.itemId, options: names })
      const passwords = logins.map((l, i) => ({
        itemId: group.items[i]!.id,
        text: l?.password ?? '',
      }))
      if (new Set(passwords.map((o) => o.text)).size > 1)
        fields.push({
          id: 'password',
          picked: passwords[0]!.itemId,
          options: passwords.map((o) => ({ itemId: o.itemId, text: '••••••••' })),
        })
    }
    return { key, keptId: group.items[0]!.id, items: group.items, fields }
  },

  async duplicateMerge(
    key: string,
    keptId: string,
    picks: Record<string, string>,
  ): Promise<MergeDone> {
    const disk = this.need()
    const group = groupsOf(disk).find((held) => held.key === key)
    if (group === undefined || !group.items.some((item) => item.id === keptId))
      throw failure('notFound')
    const gone = group.items.filter((item) => item.id !== keptId).map((item) => item.id)
    if (group.kind === 'login') {
      const kept = disk.logins.find((l) => l.id === keptId)!
      const from = (field: string) => disk.logins.find((l) => l.id === picks[field])
      const named = from('name')
      if (named !== undefined) kept.name = named.name
      const keptPassword = from('password')
      if (keptPassword !== undefined) kept.password = keptPassword.password
    }
    const list: { id: string }[] = group.kind === 'login' ? disk.logins : disk.codes
    const removed = list.filter((item) => gone.includes(item.id))
    if (group.kind === 'login') disk.logins = disk.logins.filter((l) => !gone.includes(l.id))
    else disk.codes = disk.codes.filter((c) => !gone.includes(c.id))
    const tools = (disk.tools ??= {})
    const id = `merge-${disk.nextId++}`
    ;(tools.merges ??= []).push({
      id,
      at: this.now(),
      label: group.items.find((item) => item.id === keptId)?.name ?? '',
      kept: null,
      removed: structuredClone(removed),
    })
    return { removed: gone.length, recordId: id }
  },

  async duplicateDismiss(key: string): Promise<boolean> {
    const tools = (this.need().tools ??= {})
    tools.dismissed = [...(tools.dismissed ?? []), key]
    return true
  },

  async duplicateRestore(key: string): Promise<void> {
    const tools = (this.need().tools ??= {})
    tools.dismissed = (tools.dismissed ?? []).filter((held) => held !== key)
  },

  async duplicateUndo(recordId: string, _overwrite: boolean): Promise<UndoResult> {
    const disk = this.need()
    const merge = disk.tools?.merges?.find((held) => held.id === recordId)
    if (merge === undefined) return 'unavailable'
    for (const item of merge.removed as (StoredLogin | StoredCode)[]) {
      if ('password' in item) disk.logins.push(item)
      else disk.codes.push(item)
    }
    disk.tools!.merges = disk.tools!.merges!.filter((held) => held.id !== recordId)
    return 'undone'
  },

  async duplicateMatching(): Promise<DuplicateMatching> {
    const disk = this.need()
    return { available: disk.sync?.place === 'kemlock', on: disk.tools?.matching === true }
  },

  async setDuplicateMatching(on: boolean): Promise<DuplicateMatching> {
    const disk = this.need()
    if (disk.sync?.place !== 'kemlock') throw failure('invalid')
    ;(disk.tools ??= {}).matching = on
    return { available: true, on }
  },

  async breaches(): Promise<BreachesView> {
    const disk = this.need()
    const alerts: BreachAlert[] = []
    for (const breach of breachList) {
      const entries: BreachAlert['entries'] = [
        ...disk.codes
          .filter(
            (code) =>
              code.issuer.toLowerCase() === breach.title.toLowerCase() &&
              !(code.breachesDismissed ?? []).includes(breach.name),
          )
          .map((code) => ({ kind: 'code' as const, id: code.id, name: nameOf(code) })),
        ...disk.backups
          .filter(
            (b) =>
              b.issuer.toLowerCase() === breach.title.toLowerCase() &&
              !(b.breachesDismissed ?? []).includes(breach.name),
          )
          .map((b) => ({ kind: 'backup' as const, id: b.serviceId, name: b.issuer })),
      ]
      if (entries.length > 0) alerts.push({ ...breach, entries })
    }
    const checkedAt = disk.tools?.listCheckedAt
    return {
      alerts,
      serviceCount: alerts.length,
      listUpdated: '2026-11-15',
      source: 'https://haveibeenpwned.com',
      license: 'Breach data from Have I Been Pwned, licensed under CC BY 4.0.',
      refreshOn: disk.tools?.refreshOn === true,
      ...(checkedAt === undefined ? {} : { checkedAt }),
    }
  },

  async dismissBreach(name: string, accountIds: string[], serviceIds: string[]): Promise<void> {
    const disk = this.need()
    for (const code of disk.codes)
      if (accountIds.includes(code.id)) code.breachesDismissed = [...(code.breachesDismissed ?? []), name]
    for (const backup of disk.backups)
      if (serviceIds.includes(backup.serviceId))
        backup.breachesDismissed = [...(backup.breachesDismissed ?? []), name]
  },

  async checkBreaches(): Promise<BreachCheck> {
    const disk = this.need()
    const on = disk.settings.breachedPasswords
    const breached = on
      ? disk.logins.filter((login) => ['password', '123456', 'qwerty'].includes(login.password)).length
      : 0
    const refresh = disk.tools?.refreshOn === true
    if (refresh) (disk.tools ??= {}).listCheckedAt = this.now()
    return {
      at: this.now(),
      passwords: { on, breached, failed: 0 },
      list: { on: refresh, checked: refresh, updated: false },
    }
  },

  async toolsSettings(): Promise<ToolsSettings> {
    return { breachRefresh: this.need().tools?.refreshOn === true }
  },

  async saveToolsSettings(settings: Partial<ToolsSettings>): Promise<ToolsSettings> {
    const disk = this.need()
    if (settings.breachRefresh !== undefined) (disk.tools ??= {}).refreshOn = settings.breachRefresh
    return { breachRefresh: disk.tools?.refreshOn === true }
  },
}
