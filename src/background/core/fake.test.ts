import { describe, expect, it } from 'vitest'
import { codeFor, decodeBase32, FakeCore, registrable, strengthOf } from './fake'

const ascii = new TextEncoder().encode('12345678901234567890')

describe('codes', () => {
  it('computes the RFC 6238 test codes', async () => {
    for (const [time, code] of [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ] as const) {
      expect(await codeFor(ascii, Math.floor(time / 30), 8, 'totp')).toBe(code)
    }
  })

  it('computes the RFC 4226 test codes', async () => {
    const codes = ['755224', '287082', '359152', '969429', '338314']
    for (const [counter, code] of codes.entries())
      expect(await codeFor(ascii, counter, 6, 'hotp')).toBe(code)
  })

  it('reads base32 in any case, with spaces', () => {
    expect(new TextDecoder().decode(decodeBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'))).toBe(
      '12345678901234567890',
    )
    expect(() => decodeBase32('not base32!')).toThrow()
  })

  it('gives Steam five letters', async () => {
    expect(await codeFor(ascii, 1, 5, 'steam')).toMatch(/^[2-9B-HJ-KM-NP-RT-WY]{5}$/)
  })

  it('lists live codes with their end, and counts an HOTP up', async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    const [code] = await core.codes()
    const at = 1_800_000_010_000
    const [live] = await core.liveCodes([code.id], at)
    expect(live.code).toMatch(/^\d{6}$/)
    expect(live.expiresAt).toBe((Math.floor(at / 30_000) + 1) * 30_000)
    const hotp = await core.addCode('otpauth://hotp/Mail:sam?secret=GEZDGNBVGY3TQOJQ&counter=0')
    const first = await core.nextHotp(hotp.id)
    expect(first.code).toBe(await codeFor(ascii.slice(0, 10), 1, 6, 'hotp'))
    expect(first.expiresAt).toBeUndefined()
  })

  it('adds a code from a link, once, linked and with its site', async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    const link =
      'otpauth://totp/GitHub:sam?secret=JBSWY3DPEHPK3PXQ&issuer=GitHub&digits=8&period=60'
    const login = await core.saveLogin(null, {
      name: 'GitHub',
      username: 'sam',
      password: 'pw-pw-pw-pw-1A',
      websites: ['github.com'],
    })
    const code = await core.addCode(link, 'gist.github.com', login.id)
    expect(code).toMatchObject({
      issuer: 'GitHub',
      account: 'sam',
      digits: 8,
      period: 60,
      websites: ['github.com'],
      loginId: login.id,
    })
    expect((await core.logins()).find((l) => l.id === login.id)?.codeId).toBe(code.id)
    await expect(core.addCode(link)).rejects.toMatchObject({
      name: 'KemlockError',
      message: 'duplicate',
    })
    await expect(core.addCode('https://example.com')).rejects.toMatchObject({ message: 'badLink' })
  })

  it('reads a fake QR image', async () => {
    const core = new FakeCore()
    expect(await core.readQr('data:image/png;kemlock-fake-qr,otpauth%3A%2F%2Ftotp%2Fx')).toBe(
      'otpauth://totp/x',
    )
    expect(await core.readQr('data:image/png;base64,AAAA')).toBeNull()
  })
})

describe('the vault', () => {
  it('opens with its password, counts wrong ones and says how many on opening', async () => {
    let time = 1000
    const core = new FakeCore({ sample: true, now: () => time })
    expect(await core.state()).toMatchObject({ exists: true, unlocked: false, wrongPasswords: 0 })
    expect(await core.unlock('nope')).toEqual({ ok: false, wrongPasswords: 1 })
    time = 2000
    expect(await core.unlock('still no')).toEqual({ ok: false, wrongPasswords: 2 })
    expect(await core.state()).toMatchObject({ wrongPasswords: 2, lastWrongAt: 2000 })
    expect(await core.unlock('correct horse')).toEqual({ ok: true, wrongPasswords: 2 })
    expect(await core.state()).toMatchObject({ unlocked: true, wrongPasswords: 0 })
  })

  it('holds nothing out while locked', async () => {
    const core = new FakeCore({ sample: true })
    await expect(core.logins()).rejects.toMatchObject({ message: 'locked' })
    await expect(core.codes()).rejects.toMatchObject({ message: 'locked' })
    await expect(new FakeCore().logins()).rejects.toMatchObject({ message: 'noVault' })
  })

  it('opens again from its session blob on the same disk, until locked', async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    const blob = await core.exportSession()
    const woken = new FakeCore({ disk: core.disk })
    expect(await woken.state()).toMatchObject({ unlocked: false })
    expect(await woken.restoreSession('another browser session')).toBe(false)
    expect(await woken.restoreSession(blob)).toBe(true)
    expect(await woken.state()).toMatchObject({ unlocked: true })
    await woken.lock()
    expect(await new FakeCore({ disk: core.disk }).restoreSession(blob)).toBe(false)
  })

  it('creates a vault, and removes it', async () => {
    const core = new FakeCore()
    await core.createVault('hunter two')
    expect(await core.state()).toMatchObject({ exists: true, unlocked: true })
    await core.removeVault()
    expect(await core.state()).toMatchObject({ exists: false, unlocked: false })
  })
})

describe('logins', () => {
  it('keeps the old password among the previous ones on a change', async () => {
    let time = 5
    const core = new FakeCore({ sample: true, now: () => time })
    await core.unlock('correct horse')
    const [login] = await core.logins()
    time = 9
    const saved = await core.saveLogin(login.id, {
      name: login.name,
      username: login.username,
      password: 'A-brand-new-pass-9',
      websites: login.websites,
    })
    expect(saved).toMatchObject({ previousPasswords: 1, passwordChangedAt: 9 })
    expect((await core.revealLogin(login.id)).password).toBe('A-brand-new-pass-9')
  })

  it('reports health', async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    const input = { name: 'a', username: 'u', websites: ['github.com'] }
    const weak = await core.saveLogin(null, { ...input, password: 'short' })
    const same1 = await core.saveLogin(null, { ...input, password: 'Same-Strong-Pass-123' })
    const same2 = await core.saveLogin(null, { ...input, password: 'Same-Strong-Pass-123' })
    const report = await core.health()
    expect(report.weak).toEqual([weak.id])
    expect(report.reused.sort()).toEqual([same1.id, same2.id].sort())
    expect(report.withoutItsCode).toContain(weak.id)
    await core.ignoreHealth(weak.id, true)
    expect((await core.health()).weak).toEqual([])
    expect(strengthOf('short')).toBe(0)
    expect(strengthOf('Correct-Horse-Battery-9')).toBeGreaterThanOrEqual(3)
  })
})

describe('matching', () => {
  const orbit = async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    return core
  }

  it('offers a login on another subdomain of its domain', async () => {
    const core = await orbit()
    const match = await core.match('https://app.orbit-cloud.com/sign-in')
    expect(match.site).toBe('orbit-cloud.com')
    expect(match.logins).toHaveLength(1)
    expect(match.codes).toHaveLength(1)
  })

  it('does not offer it on a host that only looks like it', async () => {
    const core = await orbit()
    for (const address of [
      'https://orbit-cloud.com.evil.io/',
      'https://evilorbit-cloud.com/',
      'ftp://orbit-cloud.com/',
      'not an address',
    ])
      expect(await core.match(address)).toMatchObject({ logins: [], codes: [] })
  })

  it('holds a shared suffix to the exact host', async () => {
    const core = await orbit()
    await core.saveLogin(null, {
      name: 'Sam',
      username: 'sam',
      password: 'pw',
      websites: ['sam.github.io'],
    })
    expect((await core.match('https://sam.github.io/')).logins).toHaveLength(1)
    expect((await core.match('https://alex.github.io/')).logins).toHaveLength(0)
    expect(registrable('alex.github.io')).toBe('alex.github.io')
    expect(registrable('a.b.example.co.uk')).toBe('example.co.uk')
  })

  it('warns of a look-alike, not of a different site with a similar name', async () => {
    const core = await orbit()
    expect((await core.match('https://orbit-c1oud.com/')).lookAlikeOf).toBe('orbit-cloud.com')
    expect((await core.match('https://orbit-clouds.com/')).lookAlikeOf).toBe('orbit-cloud.com')
    expect((await core.match('https://orbit-cloud.com/')).lookAlikeOf).toBeUndefined()
    await core.saveLogin(null, {
      name: 'GitHub',
      username: 'sam',
      password: 'pw',
      websites: ['github.com'],
    })
    expect((await core.match('https://gitlab.com/')).lookAlikeOf).toBeUndefined()
  })
})

describe('the generator', () => {
  it('makes passwords of the length asked, up to a site cap', async () => {
    const core = new FakeCore({ sample: true })
    expect(await core.generate({ mode: 'random', length: 32 })).toHaveLength(32)
    expect(await core.generate({ mode: 'random' })).toHaveLength(20)
    expect(
      await core.generate({ mode: 'random', length: 40, siteRules: 'maxlength: 16' }),
    ).toHaveLength(16)
    expect(
      await core.generate({ mode: 'random', length: 8, siteRules: 'minlength: 12' }),
    ).toHaveLength(12)
    expect(await core.generate({ mode: 'random', length: 99999 })).toHaveLength(128)
    const digitsOnly = await core.generate({
      mode: 'random',
      lowercase: false,
      uppercase: false,
      symbols: false,
    })
    expect(digitsOnly).toMatch(/^[2-9]+$/)
  })

  it('makes passphrases', async () => {
    const core = new FakeCore({ sample: true })
    const phrase = await core.generate({ mode: 'passphrase', words: 4, separator: '.' })
    expect(phrase.split('.')).toHaveLength(4)
    expect(await core.generate({ mode: 'passphrase', includeNumber: true })).toMatch(/\d/)
  })
})

describe('the pretend sync', () => {
  it('signs in as each place does, in steps', async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    expect(await core.syncStatus()).toBeNull()
    expect(
      await core.signInVaultwarden({
        server: 'https://vw.example',
        email: 'a@b.c',
        password: 'bad',
      }),
    ).toMatchObject({ step: 'error', problem: 'auth' })
    expect(
      await core.signInVaultwarden({
        server: 'https://vw.example',
        email: 'a@b.c',
        password: 'ok',
      }),
    ).toMatchObject({ step: 'homes' })
    expect(await core.answerStep({ step: 'homes', homeId: 'home-1' })).toMatchObject({
      step: 'firstSync',
    })
    const done = await core.answerStep({ step: 'firstSync', go: true })
    expect(done).toMatchObject({
      step: 'done',
      status: { place: 'vaultwarden', loginsNotSynced: true },
    })
    expect(await core.syncStatus()).toMatchObject({ server: 'https://vw.example' })
    expect(
      await core.signInWebdav({ folder: 'https://dav.example/k', username: 'u', password: 'p' }),
    ).toEqual({ step: 'passphrase' })
    expect(await core.answerStep({ step: 'passphrase', passphrase: 'x' })).toMatchObject({
      step: 'done',
    })
    expect(
      await core.signInKemlock({ server: 'https://k.example', email: 'second@x.y', password: 'p' }),
    ).toMatchObject({ step: 'second' })
    expect(await core.securityKeyChallenge()).toEqual({
      domain: 'https://k.example',
      path: '/kem/v1/webauthn',
      data: 'fake-challenge',
    })
    expect(await core.checkServer('kemlock', 'https://k.example')).toEqual({ ok: true })
    expect(await core.checkServer('vaultwarden', 'http://k.example')).toEqual({
      ok: false,
      problem: 'kemlockAddress',
    })
  })

  it('syncs, and stops with a problem when told to', async () => {
    const core = new FakeCore({ sample: true, now: () => 77 })
    await core.unlock('correct horse')
    await core.signInKemlock({ server: 'https://k.example', email: 'a@b.c', password: 'p' })
    expect(await core.syncNow()).toMatchObject({ lastSync: 77 })
    core.syncProblem = 'signedOut'
    expect(await core.syncNow()).toMatchObject({ problem: 'signedOut' })
    core.syncProblem = undefined
    expect((await core.confirmRemovals()).problem).toBeUndefined()
    await core.signOut()
    expect(await core.syncStatus()).toBeNull()
    await expect(core.syncNow()).rejects.toMatchObject({ message: 'notSignedIn' })
  })

  it('stops at the removal guard until it is answered with Keep or Remove', async () => {
    const core = new FakeCore({ sample: true, now: () => 77 })
    await core.unlock('correct horse')
    await core.signInKemlock({ server: 'https://k.example', email: 'a@b.c', password: 'p' })
    core.guard = { count: 6, scope: 22, items: [{ name: 'GitHub', kind: 'code' }] }
    expect(await core.syncNow()).toMatchObject({
      problem: 'removals',
      pendingRemovals: 6,
      scopeSize: 22,
      pendingRemovalItems: [{ name: 'GitHub', kind: 'code' }],
    })
    const kept = await core.keepRemovals()
    expect(kept).toMatchObject({ lastSync: 77 })
    expect(kept).not.toHaveProperty('problem')
    expect(kept).not.toHaveProperty('pendingRemovals')
    expect(kept).not.toHaveProperty('pendingRemovalItems')
    expect(core.guardAnswer).toBe('keep')
    core.guard = { count: 2, scope: 5 }
    await core.syncNow()
    await core.confirmRemovals()
    expect(core.guardAnswer).toBe('remove')
    expect(core.calls).toEqual(expect.arrayContaining(['keepRemovals', 'confirmRemovals']))
  })

  it('signs in by SSO or a passkey as a password does', async () => {
    const core = new FakeCore({ sample: true })
    await core.unlock('correct horse')
    expect(await core.signInKemlockSso({ server: 'https://k.example', email: 'a@b.c' })).toMatchObject({
      step: 'done',
      status: { place: 'kemlock', account: 'a@b.c' },
    })
    expect(await core.signInKemlockPasskey({ server: 'https://k.example' })).toMatchObject({
      step: 'done',
      status: { place: 'kemlock' },
    })
    core.waysStep = { step: 'error', problem: 'cancelled' }
    expect(await core.signInKemlockSso({ server: 'https://k.example' })).toEqual({
      step: 'error',
      problem: 'cancelled',
    })
  })
})

describe('picks and recent passwords', () => {
  it('remembers a pick per host, and passwords for 30 days unless a login holds them', async () => {
    let time = 0
    const core = new FakeCore({ sample: true, now: () => time })
    await core.unlock('correct horse')
    await core.rememberPick('id.orbitauth.net', 'login-1')
    await core.rememberPick('id.orbitauth.net', 'login-1')
    expect(await core.picks('id.orbitauth.net')).toEqual(['login-1'])
    expect(await core.picks('other.example')).toEqual([])
    await core.addRecentPassword({ value: 'one', at: 0, site: 'a.example' })
    await core.addRecentPassword({ value: 'two', at: 0 })
    await core.saveLogin(null, { name: 'x', username: 'u', password: 'two', websites: [] })
    expect((await core.recentPasswords()).map((p) => p.value)).toEqual(['one'])
    time = 31 * 24 * 3600_000
    expect(await core.recentPasswords()).toEqual([])
  })
})
