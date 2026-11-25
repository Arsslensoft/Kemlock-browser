// The account's own calls for `FakeCore` (the tests and a development build): devices, approvals, emergency access, a Recovery Kit,
// second steps and the move, in memory, following the contract of src/shared/account.ts and the server's own rules (the states of a
// grant, the proof a change takes, the words an approval is shown in), not its crypto.
import type {
  AccountOp,
  AccountRequest,
  AccountResult,
  ApprovalView,
  DeviceView,
  EmergencyGrant,
  GrantView,
  KitRecord,
  MoveStatus,
  TwoStepMethod,
} from '../../shared/account'
import type { SignInStep } from '../../shared/api'

/** What the core's own failures look like to the pages: a `KemlockError` whose message is one code word. */
export class FakeAccountError extends Error {
  constructor(word: string) {
    super(word)
    this.name = 'KemlockError'
  }
}

/** The proof the fake accepts for a change that asks for one. */
export const fakeProof = '123456'

const iso = (ms: number): string => new Date(ms).toISOString()
const normalizePiece = (text: string): string => text.replace(/\s+/g, '').toUpperCase()

/** A fingerprint of 12 groups of 5 digits, the same for the same text. */
export function fakeFingerprint(text: string): string {
  let h = 2166136261
  const groups: string[] = []
  for (let i = 0; i < 12; i += 1) {
    for (const char of `${text}:${i}`) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0
    groups.push(String(h % 100000).padStart(5, '0'))
  }
  return groups.join(' ')
}

export interface FakeAccountState {
  devices: DeviceView[]
  approvals: ApprovalView[]
  trusted: GrantView[]
  grantors: GrantView[]
  kit: KitRecord | null
  methods: { method: TwoStepMethod; enabled: boolean }[]
  recoveryCode: string | null
  email: string | null
  move: MoveStatus
}

export class FakeAccount {
  readonly state: FakeAccountState
  /** Emails that have an account already. */
  readonly registered = new Set<string>(['taken@example.com'])
  /** The ops asked, in order, for the tests. */
  readonly asked: AccountOp[] = []
  /** The ops that fail, with the code word they fail with. */
  readonly failing = new Map<AccountOp, string>()
  proofs = 0
  private pending: { kitId: string; pieces: string[] } | null = null
  private nextId = 1

  constructor(private readonly now: () => number = () => Date.now()) {
    this.state = {
      devices: [
        {
          id: 'device-this',
          name: 'Kemlock · Chrome',
          kind: 'kemlock-browser',
          current: true,
          trusted: false,
          createdAt: now() - 86_400_000,
          lastSeen: now(),
          lastKemlock: now(),
        },
        {
          id: 'device-phone',
          name: 'Kemlock on Pixel 9',
          kind: 'kemlock-android',
          current: false,
          trusted: true,
          createdAt: now() - 30 * 86_400_000,
          lastSeen: now() - 3_600_000,
          lastKemlock: now() - 3_600_000,
        },
      ],
      approvals: [],
      trusted: [],
      grantors: [],
      kit: null,
      methods: [],
      recoveryCode: null,
      email: null,
      move: {
        offered: false,
        held: false,
        running: false,
        done: 0,
        total: 0,
        finished: false,
      },
    }
  }

  /** A request from a new device, as the core would list it. */
  addApproval(approval: Partial<ApprovalView> = {}): ApprovalView {
    const id = approval.id ?? `request-${this.nextId++}`
    const full: ApprovalView = {
      id,
      deviceName: 'Kemlock · Firefox',
      deviceKind: 'kemlock-browser',
      ip: '203.0.113.0',
      phrase: ['badge', 'fresh', 'jolly', 'moss', 'quartz'],
      agrees: true,
      canApprove: true,
      ageSeconds: 5,
      createdAt: this.now() - 5000,
      expiresAt: this.now() + 14 * 60_000,
      ...approval,
    }
    this.state.approvals.push(full)
    return full
  }

  private grant(email: string, kind: EmergencyGrant['kind'], waitDays: number): EmergencyGrant {
    return {
      id: `grant-${this.nextId++}`,
      grantorId: 'account-me',
      granteeEmail: email,
      granteeId: `account-${email}`,
      kind,
      waitDays,
      state: 'invited',
      recoveryInitiatedAt: null,
      dueAt: null,
      createdAt: iso(this.now()),
    }
  }

  private find(id: string): GrantView {
    const view = [...this.state.trusted, ...this.state.grantors].find((v) => v.grant.id === id)
    if (view === undefined) throw new FakeAccountError('notFound')
    return view
  }

  private need(methodsOn = this.state.methods.some((m) => m.enabled), proof?: string): void {
    if (!methodsOn) return
    if (proof === undefined || proof === '') throw new FakeAccountError('proofNeeded')
    if (proof !== fakeProof) throw new FakeAccountError('badRequest')
  }

  async call(request: AccountRequest): Promise<AccountResult> {
    this.asked.push(request.op)
    const failure = this.failing.get(request.op)
    if (failure !== undefined) throw new FakeAccountError(failure)
    const { state } = this
    switch (request.op) {
      case 'register': {
        const email = request.email.trim().toLowerCase()
        if (this.registered.has(email))
          return { step: 'error', problem: 'accountExists' } as SignInStep
        if (request.server.startsWith('http://'))
          return { step: 'error', problem: 'insecure' } as SignInStep
        this.registered.add(email)
        return {
          step: 'done',
          status: {
            place: 'kemlock',
            server: request.server,
            account: request.email,
            deviceName: 'Kemlock · Chrome',
            running: false,
          },
        }
      }
      case 'moveStatus':
        return { ...state.move }
      case 'moveStart':
        state.move = {
          ...state.move,
          running: false,
          held: false,
          finished: true,
          step: 'done',
          result: { moved: { login: 2, otp: 1 }, files: 0, oldStore: 'copyKept' },
        }
        return { ...state.move }
      case 'moveCancel':
        state.move = { ...state.move, held: false }
        return { ...state.move }

      case 'devices':
        return { devices: state.devices.map((d) => ({ ...d })) }
      case 'signOutDevice': {
        const device = state.devices.find((d) => d.id === request.deviceId)
        if (device === undefined) throw new FakeAccountError('notFound')
        if (device.current) throw new FakeAccountError('invalid')
        state.devices = state.devices.filter((d) => d.id !== request.deviceId)
        return {}
      }
      case 'approvals':
        return { approvals: state.approvals.map((a) => ({ ...a })) }
      case 'approve': {
        const approval = state.approvals.find((a) => a.id === request.id)
        if (approval === undefined) throw new FakeAccountError('notFound')
        if (!approval.agrees) throw new FakeAccountError('phraseMismatch')
        if (!approval.canApprove) throw new FakeAccountError('noKey')
        state.approvals = state.approvals.filter((a) => a.id !== request.id)
        return {}
      }
      case 'deny': {
        if (!state.approvals.some((a) => a.id === request.id))
          throw new FakeAccountError('notFound')
        state.approvals = state.approvals.filter((a) => a.id !== request.id)
        return {}
      }

      case 'emergency':
        return {
          trusted: structuredClone(state.trusted),
          grantors: structuredClone(state.grantors),
        }
      case 'emergencyInvite': {
        if (state.trusted.some((v) => v.grant.granteeEmail === request.email))
          throw new FakeAccountError('conflict')
        const grant = this.grant(request.email, request.kind, request.waitDays)
        state.trusted.push({ grant, grantorEmail: null, hasKeys: false })
        return { ...grant }
      }
      case 'emergencyRevoke': {
        this.find(request.id)
        state.trusted = state.trusted.filter((v) => v.grant.id !== request.id)
        state.grantors = state.grantors.filter((v) => v.grant.id !== request.id)
        return {}
      }
      case 'emergencyStep': {
        const view = this.find(request.id)
        type State = EmergencyGrant['state']
        const next: Record<typeof request.step, [State, State]> = {
          accept: ['invited', 'accepted'],
          initiate: ['confirmed', 'recovery-initiated'],
          approve: ['recovery-initiated', 'approved'],
          reject: ['recovery-initiated', 'rejected'],
        }
        const [from, to] = next[request.step]
        if (view.grant.state !== from) throw new FakeAccountError('badRequest')
        view.grant.state = to
        if (to === 'recovery-initiated') {
          view.grant.recoveryInitiatedAt = iso(this.now())
          view.grant.dueAt = iso(this.now() + view.grant.waitDays * 86_400_000)
        }
        if (to === 'accepted') view.hasKeys = true
        return { ...view.grant }
      }
      case 'emergencyContact': {
        const { grant, hasKeys } = this.find(request.id)
        if (grant.state !== 'accepted' || !hasKeys) throw new FakeAccountError('invalid')
        return {
          name: grant.granteeEmail,
          kind: grant.kind,
          waitDays: grant.waitDays,
          fingerprint: fakeFingerprint(grant.granteeEmail),
        }
      }
      case 'emergencyConfirm': {
        const view = this.find(request.id)
        if (view.grant.state !== 'accepted') throw new FakeAccountError('invalid')
        if (request.fingerprint !== fakeFingerprint(view.grant.granteeEmail))
          throw new FakeAccountError('changed')
        view.grant.state = 'confirmed'
        return { ...view.grant }
      }
      case 'emergencyKey': {
        const { grant } = this.find(request.id)
        if (grant.state !== 'approved') throw new FakeAccountError('forbidden')
        return { grantorId: grant.grantorId, kind: grant.kind, opens: true }
      }

      case 'recoveryKit':
        return { kit: state.kit === null ? null : { ...state.kit } }
      case 'proofRequest':
        this.proofs += 1
        return {}
      case 'kitMake': {
        const kitId = `K${String(this.nextId++).padStart(7, '0')}`.replace(/[01]/g, '2')
        const pieces = [1, 2, 3].map(
          (n) => `BMCKIT1-${kitId}-23${n}-${'ABCDEFGH'.repeat(6).slice(0, 52)}-ABCD`,
        )
        this.pending = { kitId, pieces }
        return { kitId, pieces: [...pieces] }
      }
      case 'kitCancel':
        this.pending = null
        return {}
      case 'kitKeep': {
        const pending = this.pending
        if (pending === null) throw new FakeAccountError('invalid')
        const typed = normalizePiece(request.piece)
        if (!pending.pieces.some((p) => normalizePiece(p) === typed))
          throw new FakeAccountError('pieceMismatch')
        if (state.kit !== null) this.need(true, request.proof)
        state.kit = {
          kitId: pending.kitId,
          threshold: 2,
          shares: 3,
          keyVersion: 1,
          createdAt: iso(this.now()),
          current: true,
        }
        this.pending = null
        return { kit: { ...state.kit } }
      }
      case 'kitRemove':
        this.need(true, request.proof)
        state.kit = null
        return {}

      case 'twoStep':
        return {
          methods: state.methods.map((m) => ({ ...m })),
          recoveryCodes: state.recoveryCode !== null,
          email: state.email,
          emailOffered: true,
        }
      case 'totpBegin':
        return {
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/Kemlock:sam@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Kemlock',
        }
      case 'totpConfirm':
        if (request.code !== '123456') throw new FakeAccountError('badRequest')
        this.need(state.methods.some((m) => m.enabled && m.method !== 'totp'), request.proof)
        state.methods = [
          ...state.methods.filter((m) => m.method !== 'totp'),
          { method: 'totp', enabled: true },
        ]
        state.recoveryCode ??= 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        return {}
      case 'emailBegin':
        return {}
      case 'emailConfirm':
        if (request.code !== '654321') throw new FakeAccountError('badRequest')
        this.need(state.methods.some((m) => m.enabled && m.method !== 'email'), request.proof)
        state.methods = [
          ...state.methods.filter((m) => m.method !== 'email'),
          { method: 'email', enabled: true },
        ]
        state.email = request.address
        state.recoveryCode ??= 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        return {}
      case 'emailOff':
        this.need(true, request.proof)
        state.methods = state.methods.filter((m) => m.method !== 'email')
        state.email = null
        return {}
      case 'recoveryCode':
        this.need(state.recoveryCode !== null, request.proof)
        return { code: state.recoveryCode }
    }
  }
}
