// The transfer tab's requests through the real router over the fake core: who may ask, what an import does to the vault and to sync,
// what an export asks first, and that a file's items never reach the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeView, LoginView, UnlockResult } from '../shared/api'
import type {
  ExportedFile,
  ExportInfo,
  QrExport,
  TransferOpened,
  TransferPlan,
  TransferPreview,
  TransferResult,
} from '../shared/transfer'
import { syncSoonAlarm } from './sync'
import { content, harness, popup, setup, useClock, type Harness } from './test/harness'

const transfer: chrome.runtime.MessageSender = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/transfer/index.html',
  origin: 'chrome-extension://kemlockid',
}

const file = (text: string) => btoa(text)
const csv =
  'name,url,username,password\nGitHub,https://github.com,me,hunter2\nMail,https://mail.example.com,me,pw\n'
const link =
  'otpauth://totp/Harbor%20Notes:alex@harbornotes.app?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Harbor%20Notes'

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const ask = <T>(message: object) => h.ok<T>(message, transfer)
const logins = () => h.ok<LoginView[]>({ kind: 'logins' })
const codes = () => h.ok<CodeView[]>({ kind: 'codes' })

/** A file opened, read and planned: the token it is held under. */
async function opened(
  text: string,
  password?: string,
): Promise<{ token: string; plan: TransferPlan }> {
  const first = await ask<TransferOpened>({ kind: 'transferOpen', data: file(text) })
  await ask<TransferPreview>({
    kind: 'transferPreview',
    token: first.token,
    ...(password === undefined ? {} : { password }),
  })
  return {
    token: first.token,
    plan: await ask<TransferPlan>({ kind: 'transferPlan', token: first.token, options: {} }),
  }
}

describe('who may ask', () => {
  const requests = [
    { kind: 'transferOpen', data: file('x') },
    { kind: 'transferOpenQr', images: ['data:image/png;base64,AAAA'] },
    { kind: 'transferPreview', token: 't' },
    { kind: 'transferPreviewKit', token: 't', pieces: ['a', 'b'] },
    { kind: 'transferPlan', token: 't', options: {} },
    { kind: 'transferApply', token: 't', options: {} },
    { kind: 'transferCancel', token: 't' },
    { kind: 'transferExportInfo' },
    { kind: 'transferExport', format: 'plain', password: 'correct horse' },
    { kind: 'transferExportQr', format: 'google', password: 'correct horse' },
    { kind: 'transferUnlock', password: 'correct horse' },
  ]

  it('is the transfer tab only: the popup, the setup tab and a content script are refused', async () => {
    for (const request of requests) {
      expect(await h.send(request, popup), request.kind).toEqual({ ok: false, error: 'refused' })
      expect(await h.send(request, setup), request.kind).toEqual({ ok: false, error: 'refused' })
      expect(
        await h.send(request, content('https://accounts.orbit-cloud.com/sign-in')),
        request.kind,
      ).toEqual({
        ok: false,
        error: 'refused',
      })
    }
  })

  it('is answered "locked" while the vault is locked, except for the request that unlocks it', async () => {
    await h.ok({ kind: 'lock' })
    for (const request of requests.filter(
      (r) => !['transferUnlock', 'transferCancel'].includes(r.kind),
    ))
      expect(await h.send(request, transfer), request.kind).toEqual({ ok: false, error: 'locked' })

    expect(await ask<UnlockResult>({ kind: 'transferUnlock', password: 'wrong' })).toEqual({
      ok: false,
      wrongPasswords: 1,
    })
    expect(
      await ask<UnlockResult>({ kind: 'transferUnlock', password: 'correct horse' }),
    ).toMatchObject({ ok: true })
    expect((await ask<ExportInfo>({ kind: 'transferExportInfo' })).counts.logins).toBeGreaterThan(0)
    expect(h.mock.icons.at(-1)).toBe('icons/unlocked-16.png')
  })

  it('is malformed when the message does not fit: no data, a format it does not write, a mode it does not have', async () => {
    expect(await h.send({ kind: 'transferOpen', data: '' }, transfer)).toEqual({
      ok: false,
      error: 'malformed',
    })
    expect(
      await h.send({ kind: 'transferExport', format: 'rtf', password: 'x' }, transfer),
    ).toEqual({ ok: false, error: 'malformed' })
    expect(
      await h.send({ kind: 'transferApply', token: 't', options: { mode: 'both' } }, transfer),
    ).toEqual({ ok: false, error: 'malformed' })
  })
})

describe('importing', () => {
  it('opens a file, says what it holds against the vault, and merges it in', async () => {
    const before = (await logins()).length
    const { token, plan } = await opened(csv)

    expect(plan.held.logins).toBe(2)
    expect(plan.adding.logins).toBe(2)
    expect(plan.canImport).toBe(true)
    const result = await ask<TransferResult>({ kind: 'transferApply', token, options: {} })

    expect(result.added.logins).toBe(2)
    const after = await logins()
    expect(after).toHaveLength(before + 2)
    expect(after.map((login) => login.name)).toEqual(expect.arrayContaining(['GitHub', 'Mail']))
  })

  it('schedules a sync, so that what was imported goes to the other devices', async () => {
    const { token } = await opened(csv)
    expect(h.mock.alarms.has(syncSoonAlarm)).toBe(false)

    await ask({ kind: 'transferApply', token, options: {} })

    expect(h.mock.alarms.has(syncSoonAlarm)).toBe(true)
  })

  it('finds what the vault holds already, and refuses to import nothing', async () => {
    const first = await opened(csv)
    await ask({ kind: 'transferApply', token: first.token, options: {} })

    const again = await opened(csv)

    expect(again.plan.adding.logins).toBe(0)
    expect(again.plan.duplicates.logins).toBe(2)
    expect(again.plan.canImport).toBe(false)
    expect(
      await h.send({ kind: 'transferApply', token: again.token, options: {} }, transfer),
    ).toEqual({ ok: false, error: 'importNothing' })
    expect(await logins()).toHaveLength(3)
  })

  it('reads a list of links as codes, and replaces the vault’s codes only when asked', async () => {
    const before = await codes()
    const merge = await opened(`${link}\n`)
    expect(merge.plan.adding.codes).toBe(1)
    await ask({ kind: 'transferApply', token: merge.token, options: { mode: 'merge' } })
    expect(await codes()).toHaveLength(before.length + 1)

    const replace = await opened(`${link}\n`)
    await ask({ kind: 'transferApply', token: replace.token, options: { mode: 'replace' } })

    expect((await codes()).map((code) => code.issuer)).toEqual(['Harbor Notes'])
  })

  it('reads QR images, each as the code it holds', async () => {
    const first = await ask<TransferOpened>({
      kind: 'transferOpenQr',
      images: [`fake-qr:${link}`, 'fake-qr:otpauth://totp/x?secret=GEZDGNBVGY3TQOJQ'],
    })
    expect(first).toMatchObject({ format: 'qr', codesRead: 2, imagesUnread: 0 })

    await ask({ kind: 'transferPreview', token: first.token })
    const result = await ask<TransferResult>({
      kind: 'transferApply',
      token: first.token,
      options: {},
    })

    expect(result.added.codes).toBe(2)
  })

  it('opens an encrypted export only with its password, and the wrong one leaves the file open', async () => {
    const exported = await ask<ExportedFile>({
      kind: 'transferExport',
      format: 'encrypted',
      password: 'correct horse',
      exportPassword: 'transfer pw',
    })
    await h.ok({ kind: 'removeVault' })
    h.done()
    h = await harness({ unlocked: false, sample: false })
    await h.ok({ kind: 'createVault', password: 'a new password' })

    const first = await ask<TransferOpened>({ kind: 'transferOpen', data: file(exported.text) })
    expect(first.encrypted).toBe(true)
    expect(await h.send({ kind: 'transferPreview', token: first.token }, transfer)).toEqual({
      ok: false,
      error: 'importBadPassword',
    })
    expect(
      await h.send({ kind: 'transferPreview', token: first.token, password: 'wrong' }, transfer),
    ).toEqual({ ok: false, error: 'importBadPassword' })
    const preview = await ask<TransferPreview>({
      kind: 'transferPreview',
      token: first.token,
      password: 'transfer pw',
    })

    expect(preview.held.logins).toBeGreaterThan(0)
  })

  it('says so for a file it cannot read, and for a token it does not hold', async () => {
    expect(await h.send({ kind: 'transferOpen', data: file('no export here') }, transfer)).toEqual({
      ok: false,
      error: 'importUnsupported',
    })
    expect(await h.send({ kind: 'transferPreview', token: 'nope' }, transfer)).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('drops an opened file when cancelled, and when the vault locks', async () => {
    const first = await ask<TransferOpened>({ kind: 'transferOpen', data: file(csv) })
    await ask({ kind: 'transferCancel', token: first.token })
    expect(await h.send({ kind: 'transferPreview', token: first.token }, transfer)).toEqual({
      ok: false,
      error: 'notFound',
    })

    const second = await ask<TransferOpened>({ kind: 'transferOpen', data: file(csv) })
    await h.ok({ kind: 'lock' })
    // Cancelling a file of a locked vault is not an error: it is gone already
    expect(await h.send({ kind: 'transferCancel', token: second.token }, transfer)).toEqual({
      ok: true,
    })
  })

  it('shows the page no login or code of the file: names and counts only', async () => {
    const first = await ask<TransferOpened>({ kind: 'transferOpen', data: file(csv) })
    const preview = await ask<TransferPreview>({ kind: 'transferPreview', token: first.token })

    const wire = JSON.stringify([first, preview])
    expect(wire).not.toContain('hunter2')
    expect(preview.samples.map((sample) => sample.name)).toEqual(['GitHub', 'Mail'])
  })
})

describe('exporting', () => {
  it('asks for the vault’s password again, counts a wrong one like the lock screen, and answers the file', async () => {
    expect(
      await h.send({ kind: 'transferExport', format: 'plain', password: 'nope' }, transfer),
    ).toEqual({ ok: false, error: 'badPassword' })
    expect(
      (await h.ok<{ state: { wrongPasswords: number } }>({ kind: 'popup' })).state.wrongPasswords,
    ).toBe(1)

    const file = await ask<ExportedFile>({
      kind: 'transferExport',
      format: 'plain',
      password: 'correct horse',
    })

    expect(file.name).toMatch(/^kemlock-export-.*\.json$/)
    expect(file.mime).toBe('application/json')
    expect(file.text).toContain('Orbit Cloud')
    expect(
      (await h.ok<{ state: { wrongPasswords: number } }>({ kind: 'popup' })).state.wrongPasswords,
    ).toBe(0)
  })

  it('writes each format, and wants a password of its own for an encrypted one', async () => {
    const csvFile = await ask<ExportedFile>({
      kind: 'transferExport',
      format: 'csv',
      password: 'correct horse',
    })
    const links = await ask<ExportedFile>({
      kind: 'transferExport',
      format: 'links',
      password: 'correct horse',
    })

    expect(csvFile.text).toContain('Orbit Cloud')
    expect(links.text).toMatch(/^otpauth:\/\/totp\//)
    expect(
      await h.send(
        {
          kind: 'transferExport',
          format: 'encrypted',
          password: 'correct horse',
          exportPassword: 'short',
        },
        transfer,
      ),
    ).toEqual({
      ok: false,
      error: 'exportTooShort',
    })
  })

  it('what it exports, the importer reads back', async () => {
    const exported = await ask<ExportedFile>({
      kind: 'transferExport',
      format: 'plain',
      password: 'correct horse',
    })
    await h.ok({ kind: 'deleteLogin', id: (await logins())[0]!.id })
    expect(await logins()).toHaveLength(0)

    const { token, plan } = await opened(exported.text)
    expect(plan.adding.logins).toBe(1)
    await ask({ kind: 'transferApply', token, options: {} })

    expect((await logins()).map((login) => login.name)).toEqual(['Orbit Cloud'])
  })

  it('answers QR codes as modules the page draws, after the password', async () => {
    expect(
      await h.send({ kind: 'transferExportQr', format: 'google', password: 'nope' }, transfer),
    ).toEqual({ ok: false, error: 'badPassword' })

    const qr = await ask<QrExport>({
      kind: 'transferExportQr',
      format: 'google',
      password: 'correct horse',
    })

    expect(qr.codes).toHaveLength(1)
    expect(qr.codes[0]!.modules).toHaveLength(qr.codes[0]!.size ** 2)
    expect(qr.exported).toBe(1)
  })

  it('says what could be exported without a secret in it', async () => {
    const info = await ask<ExportInfo>({ kind: 'transferExportInfo' })

    expect(info.counts.codes).toBe(1)
    expect(info.counts.logins).toBe(1)
    expect(JSON.stringify(info)).not.toContain('Orbit-Cloud-7731')
  })

  it('counts an export as use, so that the idle lock starts over', async () => {
    await vi.advanceTimersByTimeAsync(10_000)
    const touched = vi.spyOn(h.bg['d'].autoLock, 'used')

    await ask({ kind: 'transferExportInfo' })

    expect(touched).toHaveBeenCalled()
  })
})
