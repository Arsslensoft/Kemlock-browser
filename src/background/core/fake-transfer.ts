// The fake core's import and export (the tests' and the development build's): files in a small format of its own (a plain or "encrypted"
// JSON, a CSV of logins, or a list of otpauth:// links), merged into the fake vault's logins and codes. It follows `CoreApi`'s contract
// (src/shared/api.ts), not the app's formats, which are Kemlock-core's and are tested there.
import type {
  ExportedFile,
  ExportFormat,
  ExportInfo,
  ExportRequest,
  QrExport,
  QrExportRequest,
  TransferCounts,
  TransferFormat,
  TransferOpened,
  TransferOptions,
  TransferPlan,
  TransferPreview,
  TransferResult,
  TransferSample,
} from '../../shared/transfer'
import { transferKinds } from '../../shared/transfer'
import type { FakeDisk } from './fake'

/** What a fake import says to the page when it fails: the words the real core uses. */
class TransferError extends Error {
  constructor(word: string) {
    super(word)
    this.name = 'KemlockError'
  }
}

/** What the fake takes from the fake core. */
export interface FakeTransferHost {
  /** The open vault's disk; throws when it is locked. */
  need(): FakeDisk
  now(): number
  id(prefix: string): string
  /** Adds a code from its link; throws `duplicate` for one the vault holds. */
  addCode(link: string): void
  /** Whether the vault holds a code with this link's secret. */
  hasCode(link: string): boolean
  /** Forgets every code (a replace). */
  clearCodes(): void
  /** A code's link. */
  codeLink(index: number): string
}

interface Item {
  login?: { name: string; username: string; password: string; websites: string[]; note?: string }
  link?: string
}

interface Opened {
  format: TransferFormat
  encrypted: boolean
  check?: string
  /** The Recovery Kit the file can also be opened with, and (the fake's own stand-in for its wrap) the pieces that open it. */
  kit?: { id: string; pieces: string[] }
  items: Item[]
  read: boolean
}

/** What a Recovery Kit piece looks like, as the core reads one (kit_pieces.dart): its prefix, kit id, counts, share and check. */
const piecePattern = /^BMCKIT1-([A-Z2-7]{8})-(\d)(\d)(\d)-[A-Z2-7]{52}-[A-Z2-7]{4}$/

const zero = (): TransferCounts =>
  Object.fromEntries(transferKinds.map((kind) => [kind, 0])) as TransferCounts

const decodeBase64 = (data: string): string => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** The fields of a CSV record, quotes and doubled quotes as RFC 4180 has them. */
function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const csvField = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function encodeBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += base32Alphabet[(value >> bits) & 31]
    }
  }
  if (bits > 0) out += base32Alphabet[(value << (5 - bits)) & 31]
  return out
}

export class FakeTransfer {
  private opened = new Map<string, Opened>()
  private next = 1

  constructor(private readonly host: FakeTransferHost) {}

  forget(): void {
    this.opened.clear()
  }

  private open(
    format: TransferFormat,
    encrypted: boolean,
    items: Item[],
    check?: string,
    kit?: Opened['kit'],
  ): TransferOpened {
    this.host.need()
    this.opened.clear()
    const token = `fake-transfer-${this.next++}`
    this.opened.set(token, {
      format,
      encrypted,
      items,
      read: false,
      ...(check === undefined ? {} : { check }),
      ...(kit === undefined ? {} : { kit }),
    })
    return { token, format, encrypted, archiveFiles: 0 }
  }

  private get(token: string): Opened {
    this.host.need()
    const opened = this.opened.get(token)
    if (opened === undefined) throw new TransferError('notFound')
    return opened
  }

  async transferOpen(data: string): Promise<TransferOpened> {
    const text = decodeBase64(data).replace(/^\uFEFF/, '')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    if (typeof json === 'object' && json !== null && (json as { app?: unknown }).app === 'BackMyCodes') {
      const file = json as {
        scheme?: string
        check?: string
        /** The kit wrap of an export made by a vault with a Recovery Kit: its id, and (for the fake) the pieces that open it. */
        kit?: { id: string; pieces: string[] }
        payload?: object
      } & Record<string, unknown>
      const encrypted = file.scheme !== 'plaintext'
      const body = (encrypted ? file.payload : file) as {
        accounts?: { link: string }[]
        logins?: Item['login'][]
      }
      const items: Item[] = [
        ...(body?.accounts ?? []).map((a) => ({ link: a.link })),
        ...(body?.logins ?? []).map((login) => ({ login })),
      ]
      return this.open('kemlock', encrypted, items, file.check, file.kit)
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length > 0 && lines.every((line) => /^otpauth:\/\//i.test(line)))
      return this.open('uris', false, lines.map((link) => ({ link })))
    const rows = csvRows(text)
    const header = (rows[0] ?? []).map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''))
    if (header.includes('password') && (header.includes('url') || header.includes('name') || header.includes('username'))) {
      const column = (name: string) => header.indexOf(name)
      const items: Item[] = rows.slice(1).map((row) => ({
        login: {
          name: row[column('name')] ?? row[column('url')] ?? '',
          username: row[column('username')] ?? '',
          password: row[column('password')] ?? '',
          websites: row[column('url')] ? [row[column('url')]] : [],
        },
      }))
      return this.open('csv', false, items)
    }
    throw new TransferError('importUnsupported')
  }

  async transferOpenQr(images: string[]): Promise<TransferOpened> {
    // The fake reads an image as the text it is named for: `fake-qr:<text>`
    const links = images.flatMap((image) => (image.startsWith('fake-qr:') ? [image.slice(8)] : []))
    if (links.length === 0 || !links.every((link) => /^otpauth:\/\//i.test(link)))
      throw new TransferError('importUnsupported')
    return { ...this.open('qr', false, links.map((link) => ({ link }))), codesRead: links.length, imagesUnread: images.length - links.length }
  }

  async transferPreview(token: string, password?: string): Promise<TransferPreview> {
    const opened = this.get(token)
    if (opened.encrypted && password !== opened.check) throw new TransferError('importBadPassword')
    opened.read = true
    const held = this.counts(opened)
    const samples: TransferSample[] = opened.items.slice(0, 5).map((item) =>
      item.login === undefined
        ? { kind: 'code', name: item.link ?? '', detail: '' }
        : { kind: 'login', name: item.login.name, detail: item.login.username },
    )
    if (opened.items.length === 0) throw new TransferError('importEmpty')
    return { format: opened.format, held, skipped: 0, skips: [], notices: [], units: [], samples, attachedFiles: 0, spaceItems: 0 }
  }

  async transferPreviewKit(token: string, pieces: string[]): Promise<TransferPreview> {
    const opened = this.get(token)
    if (!opened.encrypted || opened.kit === undefined) throw new TransferError('importNoKit')
    const seen: string[] = []
    const kitIds = new Set<string>()
    for (const piece of pieces) {
      const found = piecePattern.exec(piece.toUpperCase().replace(/\s+/g, ''))
      if (found === null) throw new TransferError('importKitFormat')
      if (seen.includes(found[4]!)) throw new TransferError('importKitDuplicate')
      seen.push(found[4]!)
      kitIds.add(found[1]!)
    }
    if (kitIds.size > 1 || (kitIds.size === 1 && !kitIds.has(opened.kit.id)))
      throw new TransferError('importKitOtherKit')
    if (seen.length < 2) throw new TransferError('importKitNotEnough')
    const wanted = new Set(opened.kit.pieces)
    if (!pieces.every((piece) => wanted.has(piece.toUpperCase().replace(/\s+/g, ''))))
      throw new TransferError('importKitWrong')
    // What a password would have opened
    return this.transferPreview(token, opened.check)
  }

  private counts(opened: Opened): TransferCounts {
    const held = zero()
    for (const item of opened.items) {
      if (item.login === undefined) held.codes++
      else held.logins++
    }
    return held
  }

  private plan(opened: Opened, options: TransferOptions): { plan: TransferPlan; fresh: Item[] } {
    const disk = this.host.need()
    const replace = options.mode === 'replace'
    const held = this.counts(opened)
    const adding = zero()
    const fresh: Item[] = []
    const seen = new Set<string>()
    for (const item of opened.items) {
      if (item.login !== undefined) {
        const { name, username, password } = item.login
        const key = `${name}\u0000${username}\u0000${password}`
        const dup = disk.logins.some((l) => l.name === name && l.username === username && l.password === password)
        if (dup || seen.has(key)) continue
        seen.add(key)
        adding.logins++
        fresh.push(item)
      } else if (item.link !== undefined) {
        if (!replace && this.host.hasCode(item.link)) continue
        adding.codes++
        fresh.push(item)
      }
    }
    const duplicates = zero()
    for (const kind of transferKinds) duplicates[kind] = Math.max(0, held[kind] - adding[kind])
    const hasCodes = held.codes > 0
    const total = Object.values(adding).reduce((sum, n) => sum + n, 0)
    return {
      plan: { adding, held, duplicates, canImport: replace ? hasCodes : total > 0, contacts: [] },
      fresh,
    }
  }

  async transferPlan(token: string, options: TransferOptions): Promise<TransferPlan> {
    return this.plan(this.get(token), options).plan
  }

  async transferApply(token: string, options: TransferOptions): Promise<TransferResult> {
    const opened = this.get(token)
    const disk = this.host.need()
    const { plan, fresh } = this.plan(opened, options)
    if (!plan.canImport) throw new TransferError('importNothing')
    const replace = options.mode === 'replace'
    if (replace) this.host.clearCodes()
    for (const item of fresh) {
      if (item.login !== undefined) {
        disk.logins.push({
          id: this.host.id('login'),
          name: item.login.name,
          username: item.login.username,
          password: item.login.password,
          websites: item.login.websites,
          tags: [],
          order: disk.logins.length,
          ...(item.login.note === undefined ? {} : { note: item.login.note }),
          passwordChangedAt: this.host.now(),
          previous: [],
          ignored: false,
        })
      } else if (item.link !== undefined) this.host.addCode(item.link)
    }
    this.opened.delete(token)
    return { added: plan.adding, replaced: replace }
  }

  async transferCancel(token: string): Promise<void> {
    this.opened.delete(token)
  }

  async transferExportInfo(): Promise<ExportInfo> {
    const disk = this.host.need()
    const counts = zero()
    counts.codes = disk.codes.length
    counts.logins = disk.logins.length
    return {
      counts,
      spaceItems: 0,
      attachedFiles: 0,
      cxf: {
        sendable: { logins: disk.logins.length, codes: disk.codes.length, passkeys: 0, notes: 0, cards: 0, identities: 0, keys: 0 },
        leftOut: {},
      },
    }
  }

  /** The vault's own password, as the real core asks it; a wrong one counts as one at the lock screen. */
  private confirm(password: string): FakeDisk {
    const disk = this.host.need()
    if (password !== disk.password) {
      disk.wrongPasswords++
      disk.lastWrongAt = this.host.now()
      throw new TransferError('badPassword')
    }
    disk.wrongPasswords = 0
    delete disk.lastWrongAt
    return disk
  }

  private stamp(): string {
    return new Date(this.host.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  }

  async transferExport(request: ExportRequest): Promise<ExportedFile> {
    const disk = this.confirm(request.password)
    const counts = zero()
    counts.codes = disk.codes.length
    counts.logins = disk.logins.length
    const links = disk.codes.map((_, index) => this.host.codeLink(index))
    const logins = disk.logins.map((l) => ({
      name: l.name,
      username: l.username,
      password: l.password,
      websites: l.websites,
      ...(l.note === undefined ? {} : { note: l.note }),
    }))
    const file = (name: string, mime: string, text: string, held: Partial<TransferCounts> = counts): ExportedFile => ({
      name,
      mime,
      text,
      counts: held,
      leftOut: [],
      spaceItems: 0,
      attachedFiles: 0,
    })
    const format: ExportFormat = request.format
    const body = { accounts: links.map((link) => ({ link })), logins }
    switch (format) {
      case 'encrypted': {
        const secret = request.exportPassword ?? ''
        if (secret.length < 8) throw new TransferError('exportTooShort')
        return file(
          `kemlock-export-${this.stamp()}.json`,
          'application/json',
          JSON.stringify({ app: 'BackMyCodes', version: 2, scheme: 'fake-encrypted', check: secret, payload: body }),
        )
      }
      case 'plain':
        return file(
          `kemlock-export-${this.stamp()}.json`,
          'application/json',
          JSON.stringify({ app: 'BackMyCodes', version: 2, scheme: 'plaintext', ...body }),
        )
      case 'csv':
        return file(
          `kemlock-logins-${this.stamp()}.csv`,
          'text/csv',
          `${['name,url,username,password', ...logins.map((l) => [l.name, l.websites[0] ?? '', l.username, l.password].map(csvField).join(','))].join('\n')}\n`,
          { logins: logins.length },
        )
      case 'links':
        return file(`kemlock-codes-${this.stamp()}.txt`, 'text/plain', links.length === 0 ? '' : `${links.join('\n')}\n`, {
          codes: links.length,
        })
      case 'cxf': {
        if ((request.kinds ?? []).length === 0) throw new TransferError('invalid')
        return file(
          `kemlock-credentials-${this.stamp()}.json`,
          'application/json',
          JSON.stringify({ version: { major: 1, minor: 0 }, exporterDisplayName: 'Kemlock', accounts: [] }),
        )
      }
    }
  }

  async transferExportQr(request: QrExportRequest): Promise<QrExport> {
    const disk = this.confirm(request.password)
    if (request.format === 'kemlock' && (request.transferPassword ?? '').length < 8)
      throw new TransferError('exportTooShort')
    const batches = Math.max(1, Math.ceil(disk.codes.length / 10))
    // A 21 by 21 code with a finder pattern's corners: not a code any reader reads, only one the page can draw
    const size = 21
    const modules = Array.from({ length: size * size }, (_, i) => ((i % size) + Math.floor(i / size)) % 3 === 0 ? '1' : '0').join('')
    return {
      codes: Array.from({ length: disk.codes.length === 0 ? 0 : batches }, () => ({ size, modules })),
      exported: disk.codes.length,
      backupServices: 0,
      leftOut: [],
    }
  }

  /** A secret as a link needs it. */
  static secretOf(bytes: Uint8Array): string {
    return encodeBase32(bytes)
  }
}
