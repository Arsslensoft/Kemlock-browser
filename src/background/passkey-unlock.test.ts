// The credentials that open the vault beside its password, through the router: who may ask what, the unlock that opens the vault like
// a password does (session, icon, idle time), and the rules for when the password is needed instead (docs/plans/add-passkey-unlock.md).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PasskeyEnrolOptions,
  PasskeyUnlockInfo,
  PasskeyUnlockResult,
  PopupView,
} from '../shared/api'
import { content, harness, popup, setup, useClock, type Harness } from './test/harness'

/** The unlock tab, which makes and asks the credentials. */
const unlockPage = {
  ...popup,
  url: 'chrome-extension://kemlockid/src/unlock/index.html',
}

/** 43 characters of base64url: 32 bytes. */
const prf = (seed: string) => seed.padEnd(43, 'A').slice(0, 43)

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const add = (name: string, seed: string, extra: object = {}) =>
  h.ok<PasskeyUnlockInfo>(
    {
      kind: 'addPasskeyUnlock',
      name,
      password: 'correct horse',
      credentialId: `cred-${seed}`,
      prfOutput: prf(seed),
      attachment: 'platform',
      ...extra,
    },
    unlockPage,
  )

const enrol = async (name = 'Windows Hello', seed = 'one') => {
  await h.ok<PasskeyEnrolOptions>({ kind: 'passkeyUnlockPrepare' }, unlockPage)
  return add(name, seed)
}

const unlockBy = (seed: string, prfSeed = seed) =>
  h.send<PasskeyUnlockResult>(
    { kind: 'unlockWithPasskey', credentialId: `cred-${seed}`, prfOutput: prf(prfSeed) },
    unlockPage,
  )

const lock = () => h.ok({ kind: 'lock' })
const state = async () => (await h.ok<PopupView>({ kind: 'popup' })).state

describe('who may ask', () => {
  it('lets only the unlock page prepare, add and unlock; the popup and setup are refused', async () => {
    for (const sender of [popup, setup]) {
      expect(await h.send({ kind: 'passkeyUnlockPrepare' }, sender)).toEqual({
        ok: false,
        error: 'refused',
      })
      expect(
        await h.send(
          {
            kind: 'addPasskeyUnlock',
            name: 'x',
            password: 'correct horse',
            credentialId: 'c',
            prfOutput: prf('a'),
          },
          sender,
        ),
      ).toEqual({ ok: false, error: 'refused' })
      expect(
        await h.send({ kind: 'unlockWithPasskey', credentialId: 'c', prfOutput: prf('a') }, sender),
      ).toEqual({ ok: false, error: 'refused' })
    }
  })

  it('refuses a content script every one of them, and a message that is not well formed', async () => {
    const page = content('https://orbit-cloud.com/sign-in')
    for (const message of [
      { kind: 'passkeyUnlockInfo' },
      { kind: 'passkeyUnlockPrepare' },
      { kind: 'renamePasskeyUnlock', id: 'a', name: 'b' },
      { kind: 'removePasskeyUnlock', id: 'a' },
      { kind: 'unlockWithPasskey', credentialId: 'c', prfOutput: prf('a') },
    ])
      expect(await h.send(message, page)).toEqual({ ok: false, error: 'refused' })
    // A PRF output that is not 32 bytes of base64url, and a credential id that is not base64url
    expect(
      await h.send(
        { kind: 'unlockWithPasskey', credentialId: 'c', prfOutput: 'short' },
        unlockPage,
      ),
    ).toEqual({
      ok: false,
      error: 'malformed',
    })
    expect(
      await h.send(
        { kind: 'unlockWithPasskey', credentialId: 'c d', prfOutput: prf('a') },
        unlockPage,
      ),
    ).toEqual({
      ok: false,
      error: 'malformed',
    })
  })

  it('lets the popup and the unlock page list, rename and remove', async () => {
    const info = await enrol()
    const id = info.credentials[0]!.id
    const renamed = await h.ok<PasskeyUnlockInfo>(
      { kind: 'renamePasskeyUnlock', id, name: 'Work laptop' },
      popup,
    )
    expect(renamed.credentials[0]!.name).toBe('Work laptop')
    expect(
      (await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).credentials,
    ).toHaveLength(1)
    expect(
      (await h.ok<PasskeyUnlockInfo>({ kind: 'removePasskeyUnlock', id }, popup)).credentials,
    ).toEqual([])
  })

  it('needs the vault open to add, rename or remove, but not to list', async () => {
    const info = await enrol()
    await lock()
    expect(
      (await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).credentials,
    ).toHaveLength(1)
    expect(await h.send({ kind: 'passkeyUnlockPrepare' }, unlockPage)).toEqual({
      ok: false,
      error: 'locked',
    })
    expect(await add('Another', 'two').catch((error: Error) => error.message)).toMatch(/locked/)
    expect(
      await h.send({ kind: 'renamePasskeyUnlock', id: info.credentials[0]!.id, name: 'x' }, popup),
    ).toEqual({ ok: false, error: 'locked' })
    expect(
      await h.send({ kind: 'removePasskeyUnlock', id: info.credentials[0]!.id }, popup),
    ).toEqual({ ok: false, error: 'locked' })
  })
})

describe('turning it on', () => {
  it('gives the PRF input and keeps each credential, named, with what the browser said of it', async () => {
    const options = await h.ok<PasskeyEnrolOptions>({ kind: 'passkeyUnlockPrepare' }, unlockPage)
    expect(options.salt.length).toBeGreaterThan(0)
    expect(options.exclude).toEqual([])
    const info = await add('Windows Hello', 'one', {
      rpId: 'unlock.example',
      transports: ['internal'],
    })
    expect(info.credentials).toMatchObject([
      {
        credentialId: 'cred-one',
        name: 'Windows Hello',
        attachment: 'platform',
        transports: ['internal'],
      },
    ])
    expect(info.rpId).toBe('unlock.example')
    expect(info.salt).toBe(options.salt)
    // Nothing secret goes back to a page
    expect(JSON.stringify(info)).not.toContain(prf('one'))
    const again = await h.ok<PasskeyEnrolOptions>({ kind: 'passkeyUnlockPrepare' }, unlockPage)
    expect(again.exclude).toEqual(['cred-one'])
  })

  it('refuses a credential twice, and one for another relying party', async () => {
    await h.ok({ kind: 'passkeyUnlockPrepare' }, unlockPage)
    await add('A', 'one', { rpId: 'a.example' })
    expect(
      await h.send(
        {
          kind: 'addPasskeyUnlock',
          name: 'A',
          password: 'correct horse',
          credentialId: 'cred-one',
          prfOutput: prf('one'),
          rpId: 'a.example',
        },
        unlockPage,
      ),
    ).toEqual({ ok: false, error: 'duplicate' })
    expect(
      await h.send(
        {
          kind: 'addPasskeyUnlock',
          name: 'B',
          password: 'correct horse',
          credentialId: 'cred-two',
          prfOutput: prf('two'),
          rpId: 'b.example',
        },
        unlockPage,
      ),
    ).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('adding asks for the vault password', () => {
  const addWith = (password: string | undefined) =>
    h.send(
      {
        kind: 'addPasskeyUnlock',
        name: 'Mine',
        ...(password === undefined ? {} : { password }),
        credentialId: 'cred-mine',
        prfOutput: prf('mine'),
      },
      unlockPage,
    )

  it('and refuses a request with none, as a message that is not well formed', async () => {
    await h.ok({ kind: 'passkeyUnlockPrepare' }, unlockPage)
    expect(await addWith(undefined)).toEqual({ ok: false, error: 'malformed' })
    expect(
      (await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).credentials,
    ).toEqual([])
  })

  it('and refuses a wrong one, counted as a wrong password, with nothing kept', async () => {
    await h.ok({ kind: 'passkeyUnlockPrepare' }, unlockPage)
    expect(await addWith('not the password')).toEqual({ ok: false, error: 'wrongPassword' })
    expect((await state()).wrongPasswords).toBe(1)
    expect(
      (await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).credentials,
    ).toEqual([])
    expect(await addWith('correct horse')).toMatchObject({ ok: true })
    expect((await state()).wrongPasswords).toBe(0)
  })
})

describe('unlocking', () => {
  beforeEach(async () => {
    await enrol()
    await lock()
  })

  it('opens the vault as the password does: the session, the icon, the idle time, and an unlocked popup', async () => {
    expect((await state()).unlocked).toBe(false)
    expect(h.mock.session.get('kemlock_session')).toBeUndefined()
    const answer = await unlockBy('one')
    expect(answer).toEqual({ ok: true, value: { ok: true, wrongPasswords: 0 } })
    expect((await state()).unlocked).toBe(true)
    expect(h.mock.session.get('kemlock_session')).toMatch(/^fake-session/)
    expect(h.mock.icons.at(-1)).toBe('icons/unlocked-16.png')
    // A worker that wakes opens the vault again from that session
    const woken = await h.restart()
    expect((await woken.ok<PopupView>({ kind: 'popup' })).state.unlocked).toBe(true)
  })

  it('stays locked for an answer that opens nothing, and leaves the password working', async () => {
    expect(await unlockBy('one', 'other')).toEqual({
      ok: true,
      value: { ok: false, wrongPasswords: 0, reason: 'wrong' },
    })
    expect((await state()).unlocked).toBe(false)
    expect(await h.ok({ kind: 'unlock', password: 'correct horse' })).toMatchObject({ ok: true })
    expect((await state()).unlocked).toBe(true)
  })

  it('does not count a failed passkey as a wrong password', async () => {
    await unlockBy('one', 'other')
    expect((await state()).wrongPasswords).toBe(0)
  })

  it('says the password is needed after five failed tries, answers `passwordRequired`, and lifts it with the password', async () => {
    for (let i = 0; i < 5; i++) await unlockBy('one', 'other')
    expect(
      (await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).passwordRequired,
    ).toBe('tries')
    expect(await unlockBy('one')).toEqual({ ok: false, error: 'passwordRequired' })
    expect((await state()).unlocked).toBe(false)
    await h.ok({ kind: 'unlock', password: 'correct horse' })
    await lock()
    const info = await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)
    expect(info.passwordRequired).toBeUndefined()
    expect(await unlockBy('one')).toMatchObject({ ok: true, value: { ok: true } })
  })

  it('says the password is needed after two weeks without it', async () => {
    await vi.advanceTimersByTimeAsync(14 * 24 * 3600 * 1000 + 1000)
    expect(
      (await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).passwordRequired,
    ).toBe('days')
    expect(await unlockBy('one')).toEqual({ ok: false, error: 'passwordRequired' })
  })

  it('answers noVault when there is none, and does nothing if the vault is open already', async () => {
    await h.ok({ kind: 'unlock', password: 'correct horse' })
    expect(await unlockBy('one', 'other')).toEqual({
      ok: true,
      value: { ok: true, wrongPasswords: 0 },
    })
    await h.ok({ kind: 'removeVault' }, popup)
    expect(await unlockBy('one')).toEqual({ ok: false, error: 'noVault' })
  })
})

describe('removing', () => {
  it('forgets every credential with the vault', async () => {
    await enrol()
    await h.ok({ kind: 'removeVault' }, popup)
    expect(await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).toEqual({
      credentials: [],
    })
  })

  it('takes the last credential and its failed tries away together', async () => {
    const info = await enrol()
    await lock()
    for (let i = 0; i < 3; i++) await unlockBy('one', 'other')
    await h.ok({ kind: 'unlock', password: 'correct horse' })
    await h.ok({ kind: 'removePasskeyUnlock', id: info.credentials[0]!.id }, popup)
    expect(await h.ok<PasskeyUnlockInfo>({ kind: 'passkeyUnlockInfo' }, popup)).toEqual({
      credentials: [],
    })
    expect(await h.send({ kind: 'passkeyUnlockPrepare' }, unlockPage)).toMatchObject({ ok: true })
  })
})
