// The passkey unlock of `FakeCore` (src/background/core/fake.ts): the slots in memory, with the core's own rules for when the
// password is needed instead (core/lib/src/passkey_unlock.dart). It keeps no key: a slot holds the PRF output it was made with and
// opens when the same one comes back, which is what the real wrap does with cryptography.
import type {
  NewPasskey,
  PasskeyEnrolOptions,
  PasskeySlotView,
  PasskeyUnlockAnswer,
  PasskeyUnlockInfo,
} from '../../shared/api'

/** Failed tries in a row after which the password is required, and the days without it (the core's). */
export const passkeyMaxFailures = 5
export const passkeyMaxDays = 14

interface Slot extends PasskeySlotView {
  prf: string
}

/** What one vault's passkey unlock holds. */
export class FakePasskeys {
  private slots: Slot[] = []
  private salt: string | undefined
  private rp: string | undefined
  private failures = 0
  /** When the vault last opened by its password: kept when the last credential goes, so removing and adding one doesn't restart the days. */
  private passwordAt = 0
  private serial = 0

  constructor(public now: () => number) {}

  info(): PasskeyUnlockInfo {
    if (this.slots.length === 0) return { credentials: [] }
    const why = this.passwordRequired()
    return {
      credentials: this.slots.map(({ prf: _prf, ...view }) => ({ ...view })),
      salt: this.salt ?? '',
      ...(this.rp === undefined ? {} : { rpId: this.rp }),
      ...(why === undefined ? {} : { passwordRequired: why }),
    }
  }

  passwordRequired(): 'tries' | 'days' | undefined {
    if (this.slots.length === 0) return undefined
    if (this.failures >= passkeyMaxFailures) return 'tries'
    if (this.now() - this.passwordAt >= passkeyMaxDays * 24 * 3600 * 1000) return 'days'
    return undefined
  }

  prepare(): PasskeyEnrolOptions {
    if (this.salt === undefined) {
      this.salt = 'c2FsdHNhbHRzYWx0c2FsdHNhbHRzYWx0c2FsdHNhbHQ'
    }
    return {
      salt: this.salt,
      ...(this.rp === undefined ? {} : { rpId: this.rp }),
      exclude: this.slots.map((slot) => slot.credentialId),
    }
  }

  add(input: NewPasskey): PasskeyUnlockInfo {
    if (this.salt === undefined) throw fail('invalid')
    if (this.slots.some((slot) => slot.credentialId === input.credentialId)) throw fail('duplicate')
    if (this.slots.length > 0 && this.rp !== input.rpId) throw fail('invalid')
    this.rp = input.rpId
    this.serial += 1
    this.slots.push({
      id: `slot-${this.serial}`,
      credentialId: input.credentialId,
      name: input.name.trim() === '' ? 'Passkey' : input.name.trim(),
      addedAt: this.now(),
      ...(input.attachment === undefined ? {} : { attachment: input.attachment }),
      transports: input.transports ?? [],
      prf: input.prfOutput,
    })
    return this.info()
  }

  rename(id: string, name: string): PasskeyUnlockInfo {
    const slot = this.slots.find((s) => s.id === id)
    if (slot === undefined) throw fail('notFound')
    if (name.trim() === '') throw fail('invalid')
    slot.name = name.trim()
    return this.info()
  }

  remove(id: string): PasskeyUnlockInfo {
    if (!this.slots.some((s) => s.id === id)) throw fail('notFound')
    this.slots = this.slots.filter((s) => s.id !== id)
    if (this.slots.length === 0) {
      this.salt = this.rp = undefined
      this.failures = 0
    }
    return this.info()
  }

  /** Whether the answer opens a slot; the caller opens the vault. Counts a failed try. */
  open(answer: PasskeyUnlockAnswer): 'wrong' | 'opened' {
    if (this.slots.length === 0) throw fail('notFound')
    const why = this.passwordRequired()
    if (why !== undefined) throw fail('passwordRequired')
    this.failures += 1
    const slot = this.slots.find((s) => s.credentialId === answer.credentialId)
    if (slot === undefined || slot.prf !== answer.prfOutput) return 'wrong'
    this.failures = 0
    slot.lastUsedAt = this.now()
    return 'opened'
  }

  passwordUsed(): void {
    this.failures = 0
    this.passwordAt = this.now()
  }
}

function fail(word: string): Error {
  const error = new Error(word)
  error.name = 'KemlockError'
  return error
}

const states = new WeakMap<object, FakePasskeys>()

/** The passkey unlock that belongs to a fake disk: a new `FakeCore` over the same disk finds the same slots. */
export function passkeysOf(disk: object, now: () => number): FakePasskeys {
  let state = states.get(disk)
  if (state === undefined) {
    state = new FakePasskeys(now)
    states.set(disk, state)
  }
  state.now = now
  return state
}

/** The vault was removed: its slots go with it. */
export function forgetPasskeys(disk: object): void {
  states.delete(disk)
}
