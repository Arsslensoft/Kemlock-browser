// Sends for `FakeCore` (src/background/core/fake.ts): the owner's list, making, editing and deleting, and opening a Send from its link, all in
// memory. It follows `CoreApi`'s contract (src/shared/sends.ts), not the formats: the "link" is `https://fake.example/#/send/<id>/<key>`
// with an id of 22 characters and a key of 43 (a Kemlock Send) or 22 (a Bitwarden one, which is refused as the core refuses it).
import type { SyncPlace } from '../../shared/api'
import {
  sendChunkBytes,
  sendFileLimit,
  sendMaxDeleteDays,
  type ForeignSendView,
  type NewSendInput,
  type ReceivedSendView,
  type SendDetail,
  type SendFailure,
  type SendInvalid,
  type SendPatch,
  type SendResult,
  type SendStatus,
  type SendsListing,
  type SendView,
} from '../../shared/sends'

/** What a fake's error says: the background passes its message on as the word the page shows. */
class SendsFakeError extends Error {
  constructor(word: string) {
    super(word)
    this.name = 'KemlockError'
  }
}

/** What `FakeSends` takes from its `FakeCore`. */
export interface FakeSendsHost {
  /** Throws `locked` or `noVault`. */
  need(): void
  /** Where the vault syncs. */
  place(): SyncPlace | null
  now(): number
}

/** A Send the fake holds. `key` stands for the link key: whoever has it opens the Send. */
export interface StoredSend {
  id: string
  key: string
  kind: 'text' | 'file'
  name: string
  notes: string
  text?: string
  mime?: string
  file?: Uint8Array
  maxAccess?: number
  accessCount: number
  deletionAt: number
  expiresAt?: number
  disabled: boolean
  password?: string
  hideEmail: boolean
}

const day = 24 * 3600_000

const fail = (problem: SendFailure['problem'], more: Partial<SendFailure> = {}): SendResult<never> => ({
  ok: false,
  problem,
  ...more,
})
const invalid = (reason: SendInvalid): SendResult<never> => fail('invalid', { reason })

function random(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

export class FakeSends {
  /** The account's Sends, newest first. */
  readonly sends: StoredSend[] = []
  /** Sends a Bitwarden app made, which are listed and deleted only. */
  readonly foreign: ForeignSendView[] = []
  /** The files being staged, by the handle their tab was given: the pieces, and how many bytes they make. */
  private readonly staged = new Map<string, { pieces: Uint8Array[]; length: number }>()
  /** The Sends being received, by handle. */
  private readonly received = new Map<string, { send: StoredSend; downloaded?: Uint8Array }>()
  private handles = 0
  /** How many wrong passwords the next open takes before it says "too many tries"; 3 by default. */
  triesBeforeLimit = 3
  private tries = 0

  constructor(private readonly host: FakeSendsHost) {}

  /** The lock, or the worker stopping: what a received Send and a staged file held goes, and every handle with it. */
  unload(): void {
    this.received.clear()
    this.staged.clear()
  }

  private newHandle(): string {
    this.handles += 1
    return `handle-${this.handles}-${random(8)}`
  }

  /** The link that opens [send]. */
  linkOf(send: StoredSend): string {
    return `https://fake.example/#/send/${send.id}/${send.key}`
  }

  /** Puts a Send in the account, as another device would have made it; answers its link. */
  plant(input: Partial<StoredSend> & { name: string }): string {
    const send: StoredSend = {
      id: random(22),
      key: random(43),
      kind: 'text',
      notes: '',
      accessCount: 0,
      deletionAt: this.host.now() + 7 * day,
      disabled: false,
      hideEmail: false,
      ...input,
    }
    this.sends.unshift(send)
    return this.linkOf(send)
  }

  private status(send: StoredSend): SendStatus {
    if (send.disabled) return 'off'
    if (send.expiresAt !== undefined && send.expiresAt <= this.host.now()) return 'expired'
    if (send.maxAccess !== undefined && send.accessCount >= send.maxAccess) return 'usedUp'
    return 'active'
  }

  private view(send: StoredSend): SendView {
    return {
      id: send.id,
      kind: send.kind,
      readable: true,
      name: send.name,
      status: this.status(send),
      accessCount: send.accessCount,
      ...(send.maxAccess === undefined ? {} : { maxAccess: send.maxAccess }),
      deletionAt: send.deletionAt,
      ...(send.expiresAt === undefined ? {} : { expiresAt: send.expiresAt }),
      disabled: send.disabled,
      hasPassword: send.password !== undefined,
      hideEmail: send.hideEmail,
    }
  }

  private owned(): void {
    this.host.need()
  }

  private find(id: string): StoredSend | undefined {
    return this.sends.find((send) => send.id === id)
  }

  /* The owner's Sends --------------------------------------------------------------------- */

  async list(): Promise<SendResult<SendsListing>> {
    this.owned()
    const place = this.host.place()
    if (place !== 'kemlock') return { ok: true, value: { available: false, place } }
    return {
      ok: true,
      value: {
        available: true,
        sends: this.sends.map((send) => this.view(send)),
        foreign: structuredClone(this.foreign),
      },
    }
  }

  private requireKemlock(): SendResult<never> | undefined {
    const place = this.host.place()
    return place === 'kemlock' ? undefined : fail('noSync', { place })
  }

  async get(id: string): Promise<SendResult<SendDetail>> {
    this.owned()
    const refused = this.requireKemlock()
    if (refused) return refused
    const send = this.find(id)
    if (send === undefined) return fail('notFound')
    return {
      ok: true,
      value: {
        ...this.view(send),
        notes: send.notes,
        ...(send.text === undefined ? {} : { text: send.text }),
      },
    }
  }

  async link(id: string): Promise<SendResult<string>> {
    this.owned()
    const refused = this.requireKemlock()
    if (refused) return refused
    const send = this.find(id)
    return send === undefined ? fail('notFound') : { ok: true, value: this.linkOf(send) }
  }

  async stageFile(
    data: string,
    handle: string | null,
  ): Promise<SendResult<{ handle: string; length: number }>> {
    this.owned()
    let id = handle
    if (id === null) {
      id = this.newHandle()
      this.staged.set(id, { pieces: [], length: 0 })
    }
    const staging = this.staged.get(id)
    if (staging === undefined) return fail('lost')
    const bytes = fromBase64(data)
    if (staging.length + bytes.length > sendFileLimit) {
      this.staged.delete(id)
      return invalid('fileTooBig')
    }
    staging.pieces.push(bytes)
    staging.length += bytes.length
    return { ok: true, value: { handle: id, length: staging.length } }
  }

  async make(input: NewSendInput): Promise<SendResult<{ id: string; link: string }>> {
    this.owned()
    const refused = this.requireKemlock()
    if (refused) return refused
    const now = this.host.now()
    if (input.name.trim() === '') return invalid('noName')
    if (input.kind === 'text' && (input.text ?? '') === '') return invalid('noText')
    if (input.deleteInDays < 1 || input.deleteInDays > sendMaxDeleteDays) return invalid('deletion')
    const deletionAt = now + input.deleteInDays * day
    if (input.expiresAt !== undefined && (input.expiresAt > deletionAt || input.expiresAt <= now))
      return invalid('expiry')
    if (input.maxAccess !== undefined && input.maxAccess < 1) return invalid('maxAccess')
    let file: Uint8Array | undefined
    const staging = input.handle === undefined ? undefined : this.staged.get(input.handle)
    if (input.handle !== undefined) this.staged.delete(input.handle)
    if (input.kind === 'file') {
      // What is staged must be the file the page counted
      if (staging === undefined || staging.length === 0 || staging.length !== input.size)
        return fail('lost')
      file = new Uint8Array(staging.length)
      let at = 0
      for (const piece of staging.pieces) {
        file.set(piece, at)
        at += piece.length
      }
    }
    const send: StoredSend = {
      id: random(22),
      key: random(43),
      kind: input.kind,
      name: input.name,
      notes: input.notes,
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.kind === 'file' ? { mime: input.mime ?? 'application/octet-stream' } : {}),
      ...(file === undefined ? {} : { file }),
      ...(input.maxAccess === undefined ? {} : { maxAccess: input.maxAccess }),
      accessCount: 0,
      deletionAt,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      disabled: false,
      ...(input.password === undefined || input.password === '' ? {} : { password: input.password }),
      hideEmail: input.hideEmail,
    }
    this.sends.unshift(send)
    return { ok: true, value: { id: send.id, link: this.linkOf(send) } }
  }

  async update(id: string, patch: SendPatch): Promise<SendResult<null>> {
    this.owned()
    const refused = this.requireKemlock()
    if (refused) return refused
    const send = this.find(id)
    if (send === undefined) return fail('notFound')
    const now = this.host.now()
    if (patch.name !== undefined && patch.name.trim() === '') return invalid('noName')
    if (patch.text === '' && send.kind === 'text') return invalid('noText')
    const deletionAt = patch.deletionAt ?? send.deletionAt
    if (deletionAt <= now || deletionAt > now + sendMaxDeleteDays * day) return invalid('deletion')
    const expiresAt = patch.expiresAt === undefined ? send.expiresAt : (patch.expiresAt ?? undefined)
    if (expiresAt !== undefined && expiresAt > deletionAt) return invalid('expiry')
    const maxAccess = patch.maxAccess === undefined ? send.maxAccess : (patch.maxAccess ?? undefined)
    if (maxAccess !== undefined && (maxAccess < 1 || maxAccess < send.accessCount))
      return invalid('maxAccess')
    // A file Send's file and name never change
    if (send.kind === 'text') {
      if (patch.name !== undefined) send.name = patch.name
      if (patch.text !== undefined) send.text = patch.text
    }
    if (patch.notes !== undefined) send.notes = patch.notes
    send.deletionAt = deletionAt
    send.expiresAt = expiresAt
    send.maxAccess = maxAccess
    if (patch.hideEmail !== undefined) send.hideEmail = patch.hideEmail
    if (patch.disabled !== undefined) send.disabled = patch.disabled
    if (patch.removePassword === true) send.password = undefined
    if (patch.newPassword !== undefined && patch.newPassword !== '') send.password = patch.newPassword
    return { ok: true, value: null }
  }

  async delete(id: string): Promise<SendResult<null>> {
    this.owned()
    const refused = this.requireKemlock()
    if (refused) return refused
    const at = this.sends.findIndex((send) => send.id === id)
    if (at >= 0) this.sends.splice(at, 1)
    const foreign = this.foreign.findIndex((send) => send.id === id)
    if (foreign >= 0) this.foreign.splice(foreign, 1)
    return { ok: true, value: null }
  }

  /* Opening a Send, as a recipient ---------------------------------------------------------- */

  async open(link: string, password?: string): Promise<SendResult<ReceivedSendView>> {
    this.owned()
    const found = /^https:\/\/([^/#?\s]+)[^#\s]*#\/send\/([A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]+)/.exec(
      link.trim().replace(/^.*?(https:\/\/)/, '$1'),
    )
    if (found === null) return fail('badLink')
    const [, host, id, key] = found
    if (key.length === 22) return fail('bitwarden')
    if (key.length !== 43) return fail('badLink')
    const send = this.find(id)
    if (
      send === undefined ||
      send.key !== key ||
      this.status(send) !== 'active' ||
      send.deletionAt <= this.host.now()
    )
      return fail('notFound')
    if (send.password !== undefined) {
      if (password === undefined || password === '') return fail('passwordRequired')
      if (password !== send.password) {
        this.tries += 1
        return this.tries > this.triesBeforeLimit
          ? fail('rateLimited', { seconds: 2 })
          : fail('wrongPassword')
      }
      this.tries = 0
    }
    // A text Send counts an open when it is opened; a file Send, when its file is downloaded
    if (send.kind === 'text') send.accessCount += 1
    const handle = this.newHandle()
    this.received.set(handle, { send })
    return {
      ok: true,
      value: {
        handle,
        kind: send.kind,
        name: send.name,
        ...(send.text === undefined ? {} : { text: send.text }),
        ...(send.kind === 'file'
          ? { mime: send.mime ?? 'application/octet-stream', size: send.file?.length ?? 0 }
          : {}),
        tooBig: send.kind === 'file' && (send.file?.length ?? 0) > sendFileLimit,
        ...(send.expiresAt === undefined ? {} : { expiresAt: send.expiresAt }),
        deletionAt: send.deletionAt,
        ...(send.hideEmail ? {} : { senderEmail: 'sam@example.com' }),
        host,
      },
    }
  }

  async download(handle: string): Promise<SendResult<{ size: number }>> {
    this.owned()
    const received = this.received.get(handle)
    if (received === undefined) return fail('lost')
    const file = received.send.file
    if (received.send.kind !== 'file' || file === undefined) throw new SendsFakeError('notFound')
    if (received.downloaded === undefined) {
      received.send.accessCount += 1
      received.downloaded = file
    }
    return { ok: true, value: { size: file.length } }
  }

  readFile(handle: string, index: number): string {
    this.owned()
    const bytes = this.received.get(handle)?.downloaded
    if (bytes === undefined) throw new SendsFakeError('notFound')
    const start = index * sendChunkBytes
    return start >= bytes.length ? '' : toBase64(bytes.slice(start, start + sendChunkBytes))
  }

  receivedText(handle: string): string {
    this.owned()
    const text = this.received.get(handle)?.send.text
    if (text === undefined) throw new SendsFakeError('notFound')
    return text
  }

  close(handle: string): void {
    this.owned()
    this.received.delete(handle)
    this.staged.delete(handle)
  }
}
