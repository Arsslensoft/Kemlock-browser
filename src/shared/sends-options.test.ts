import { describe, expect, it } from 'vitest'
import {
  dayMs,
  deleteInMs,
  draftOf,
  expiryChoices,
  fitExpiry,
  keepsExpiry,
  newDraft,
  newSendInput,
  parseMaxAccess,
  sendPatch,
} from './sends-options'
import type { SendDetail } from './sends'

const now = 1_800_000_000_000

const detail = (over: Partial<SendDetail> = {}): SendDetail => ({
  id: 's1',
  kind: 'text',
  readable: true,
  name: 'Wi-Fi',
  status: 'active',
  accessCount: 1,
  maxAccess: 3,
  deletionAt: now + 5 * dayMs,
  disabled: false,
  hasPassword: false,
  hideEmail: false,
  notes: 'for the guests',
  text: 'the password is on the fridge',
  ...over,
})

describe('a new Send’s options', () => {
  it('start as the app’s do: deleted in 7 days, no early expiry, no limit, no password, the email shown', () => {
    expect(newDraft()).toEqual({
      deleteDays: 7,
      expiry: 'never',
      limited: false,
      maxAccess: '',
      password: '',
      passwordMode: 'change',
      hideEmail: false,
      notes: '',
    })
  })

  it('become what the core takes, leaving out what is not set', () => {
    expect(
      newSendInput({ kind: 'text', name: ' Wi-Fi ', text: 'secret' }, newDraft(), now),
    ).toEqual({
      kind: 'text',
      name: 'Wi-Fi',
      text: 'secret',
      notes: '',
      deleteInDays: 7,
      hideEmail: false,
    })
  })

  it('carry the expiry as a time, the limit as a number, the password and the choices', () => {
    const draft = {
      ...newDraft(),
      deleteDays: 14,
      expiry: 3,
      limited: true,
      maxAccess: ' 5 ',
      password: 'hunter2',
      hideEmail: true,
      notes: 'mine',
    }
    expect(
      newSendInput({ kind: 'file', name: 'scan.pdf', mime: 'application/pdf' }, draft, now),
    ).toEqual({
      kind: 'file',
      name: 'scan.pdf',
      mime: 'application/pdf',
      notes: 'mine',
      deleteInDays: 14,
      expiresAt: now + 3 * dayMs,
      maxAccess: 5,
      password: 'hunter2',
      hideEmail: true,
    })
  })

  it('refuse an open limit that is not a number from 1', () => {
    for (const typed of ['', '0', 'x', '-1', '1.5', '1234567890'])
      expect(
        newSendInput(
          { kind: 'text', name: 'a', text: 'b' },
          { ...newDraft(), limited: true, maxAccess: typed },
          now,
        ),
      ).toBe('maxAccess')
  })

  it('offer an early expiry only before the deletion, and put one that no longer fits back', () => {
    expect(expiryChoices(7 * dayMs)).toEqual([1, 2, 3])
    expect(expiryChoices(1 * dayMs)).toEqual([])
    expect(expiryChoices(30 * dayMs)).toEqual([1, 2, 3, 7, 14])
    const draft = { ...newDraft(), deleteDays: 14, expiry: 7 }
    expect(fitExpiry(draft, undefined, now)).toBe(draft)
    expect(fitExpiry({ ...draft, deleteDays: 7 }, undefined, now).expiry).toBe('never')
    expect(fitExpiry({ ...draft, deleteDays: 3 }, undefined, now).expiry).toBe('never')
  })
})

describe('the open limit', () => {
  it('is a whole number from the least given', () => {
    expect(parseMaxAccess('3')).toBe(3)
    expect(parseMaxAccess('3', 4)).toBeNull()
    expect(parseMaxAccess('4', 4)).toBe(4)
    expect(parseMaxAccess('007')).toBe(7)
  })
})

describe('editing a Send', () => {
  it('starts from the Send as it is: the date kept, the limit and the password mode', () => {
    expect(draftOf(detail())).toEqual({
      deleteDays: 'keep',
      expiry: 'never',
      limited: true,
      maxAccess: '3',
      password: '',
      passwordMode: 'change',
      hideEmail: false,
      notes: 'for the guests',
    })
    const held = draftOf(
      detail({ hasPassword: true, expiresAt: now + dayMs, maxAccess: undefined }),
    )
    expect(held).toMatchObject({ expiry: 'keep', limited: false, passwordMode: 'keep' })
    expect(deleteInMs(held, detail(), now)).toBe(5 * dayMs)
  })

  it('counts a kept deletion date from now, not as 30 days', () => {
    // Made 25 days ago: deleted in 5, so only an expiry before that is offered
    const send = detail({ deletionAt: now + 5 * dayMs, expiresAt: now + 4 * dayMs })
    const kept = draftOf(send)
    expect(deleteInMs(kept, send, now)).toBe(5 * dayMs)
    expect(expiryChoices(deleteInMs(kept, send, now))).toEqual([1, 2, 3])
    expect(fitExpiry({ ...kept, expiry: 7 }, send, now).expiry).toBe('never')
    expect(fitExpiry({ ...kept, expiry: 3 }, send, now).expiry).toBe(3)
    // A deletion date already past is nothing ahead
    expect(deleteInMs(kept, detail({ deletionAt: now - 1 }), now)).toBe(0)
  })

  it('drops the early expiry a Send has when the deletion chosen comes before it', () => {
    const send = detail({ deletionAt: now + 20 * dayMs, expiresAt: now + 10 * dayMs })
    const kept = draftOf(send)
    expect(keepsExpiry(kept, send, now)).toBe(true)
    expect(fitExpiry(kept, send, now)).toBe(kept)
    expect(fitExpiry({ ...kept, deleteDays: 14 }, send, now)).toMatchObject({ expiry: 'keep' })
    for (const days of [7, 3, 1])
      expect(fitExpiry({ ...kept, deleteDays: days }, send, now).expiry).toBe('never')
    // And the edit then says so: the expiry goes
    const fitted = fitExpiry({ ...kept, deleteDays: 7 }, send, now)
    expect(sendPatch(send, { name: 'Wi-Fi', text: send.text }, fitted, now)).toMatchObject({
      deletionAt: now + 7 * dayMs,
      expiresAt: null,
    })
  })

  it('changes nothing when nothing changed', () => {
    const send = detail()
    expect(sendPatch(send, { name: 'Wi-Fi', text: send.text }, draftOf(send), now)).toEqual({})
  })

  it('sends only what changed', () => {
    const send = detail()
    const draft = {
      ...draftOf(send),
      deleteDays: 14,
      expiry: 2,
      maxAccess: '10',
      hideEmail: true,
      notes: 'new notes',
    }
    expect(sendPatch(send, { name: 'Guest Wi-Fi', text: 'new text' }, draft, now)).toEqual({
      name: 'Guest Wi-Fi',
      text: 'new text',
      notes: 'new notes',
      deletionAt: now + 14 * dayMs,
      expiresAt: now + 2 * dayMs,
      maxAccess: 10,
      hideEmail: true,
    })
  })

  it('takes the early expiry and the limit away with null, and only when there was one', () => {
    const send = detail({ expiresAt: now + dayMs })
    const draft = { ...draftOf(send), expiry: 'never' as const, limited: false }
    expect(sendPatch(send, { name: 'Wi-Fi' }, draft, now)).toEqual({
      expiresAt: null,
      maxAccess: null,
    })
    const bare = detail({ maxAccess: undefined })
    expect(sendPatch(bare, { name: 'Wi-Fi' }, draftOf(bare), now)).toEqual({})
  })

  it('refuses a limit under the opens used so far', () => {
    const send = detail({ accessCount: 4, maxAccess: 6 })
    expect(sendPatch(send, { name: 'Wi-Fi' }, { ...draftOf(send), maxAccess: '3' }, now)).toBe(
      'maxAccess',
    )
    expect(sendPatch(send, { name: 'Wi-Fi' }, { ...draftOf(send), maxAccess: '4' }, now)).toEqual({
      maxAccess: 4,
    })
  })

  it('sets, changes or removes the password, never both', () => {
    const none = detail()
    expect(
      sendPatch(none, { name: 'Wi-Fi' }, { ...draftOf(none), password: 'hunter2' }, now),
    ).toEqual({ newPassword: 'hunter2' })
    const held = detail({ hasPassword: true })
    expect(sendPatch(held, { name: 'Wi-Fi' }, draftOf(held), now)).toEqual({})
    expect(
      sendPatch(held, { name: 'Wi-Fi' }, { ...draftOf(held), passwordMode: 'remove' }, now),
    ).toEqual({ removePassword: true })
    expect(
      sendPatch(
        held,
        { name: 'Wi-Fi' },
        { ...draftOf(held), passwordMode: 'change', password: 'new one' },
        now,
      ),
    ).toEqual({ newPassword: 'new one' })
    // "Change" with nothing typed keeps the password
    expect(
      sendPatch(held, { name: 'Wi-Fi' }, { ...draftOf(held), passwordMode: 'change' }, now),
    ).toEqual({})
  })

  it('never changes a file Send’s name', () => {
    const file = detail({ kind: 'file', name: 'scan.pdf', text: undefined })
    expect(sendPatch(file, { name: 'other.pdf' }, draftOf(file), now)).toEqual({})
  })
})
