// Opening an encrypted export with Recovery Kit pieces, through the real router over the fake core: who may ask, what each problem
// with the pieces is called, that the file stays open for another try, and that the pieces and what they open reach no other page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferOpened, TransferPreview } from '../shared/transfer'
import { content, harness, popup, setup, useClock, type Harness } from './test/harness'

const transfer: chrome.runtime.MessageSender = {
  id: 'kemlockid',
  url: 'chrome-extension://kemlockid/src/transfer/index.html',
  origin: 'chrome-extension://kemlockid',
}

const share = (letter: string) => letter.repeat(52)
/** A piece as the core's kit_pieces.dart writes one (the fake checks its shape and its kit, not its check). */
const piece = (kit: string, index: number, letter = 'A') =>
  `BMCKIT1-${kit}-23${index}-${share(letter)}-ABCD`

const kit = 'ABCDEFGH'
const pieces = [piece(kit, 1), piece(kit, 2, 'B'), piece(kit, 3, 'C')]

/** An encrypted export the fake reads, with a kit wrap its three pieces open, or none. */
const exportWith = (withKit: boolean) =>
  btoa(
    JSON.stringify({
      app: 'BackMyCodes',
      scheme: 'scrypt',
      check: 'the file password',
      ...(withKit ? { kit: { id: kit, pieces } } : {}),
      payload: {
        logins: [{ name: 'Orbit', username: 'sam', password: 'hunter2', websites: [] }],
      },
    }),
  )

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const open = async (withKit = true) =>
  (await h.ok<TransferOpened>({ kind: 'transferOpen', data: exportWith(withKit) }, transfer)).token
const tryKit = (token: string, list: string[], sender = transfer) =>
  h.send({ kind: 'transferPreviewKit', token, pieces: list }, sender)

describe('opening with Recovery Kit pieces', () => {
  it('is the transfer tab’s to ask, and no other page’s or content script’s', async () => {
    const token = await open()
    for (const sender of [popup, setup, content('https://orbit-cloud.com/')])
      expect(await tryKit(token, [pieces[0]!, pieces[1]!], sender)).toEqual({
        ok: false,
        error: 'refused',
      })
  })

  it('needs the vault open', async () => {
    const token = await open()
    await h.ok({ kind: 'lock' })
    expect(await tryKit(token, [pieces[0]!, pieces[1]!])).toEqual({ ok: false, error: 'locked' })
  })

  it('opens the file with any two of the three pieces, and the preview holds what the password would show', async () => {
    const token = await open()
    const preview = await h.ok<TransferPreview>(
      { kind: 'transferPreviewKit', token, pieces: [pieces[2]!, pieces[0]!] },
      transfer,
    )
    expect(preview.held.logins).toBe(1)
    expect(preview.samples).toEqual([{ kind: 'login', name: 'Orbit', detail: 'sam' }])
    // The pieces and the file's items stay where they are: the preview names them and no more
    expect(JSON.stringify(preview)).not.toContain('hunter2')
    expect(JSON.stringify(preview)).not.toContain('BMCKIT1')
  })

  it('names each problem, and leaves the file open for another try', async () => {
    const token = await open()
    expect(await tryKit(token, [pieces[0]!])).toEqual({ ok: false, error: 'importKitNotEnough' })
    expect(await tryKit(token, [pieces[0]!, pieces[0]!])).toEqual({
      ok: false,
      error: 'importKitDuplicate',
    })
    expect(await tryKit(token, [pieces[0]!, 'not a piece'])).toEqual({
      ok: false,
      error: 'importKitFormat',
    })
    expect(await tryKit(token, [pieces[0]!, piece('ZZZZZZZZ', 2)])).toEqual({
      ok: false,
      error: 'importKitOtherKit',
    })
    expect(await tryKit(token, [pieces[0]!, piece(kit, 2, 'D')])).toEqual({
      ok: false,
      error: 'importKitWrong',
    })
    expect(
      await h.ok<TransferPreview>(
        { kind: 'transferPreviewKit', token, pieces: [pieces[0]!, pieces[1]!] },
        transfer,
      ),
    ).toMatchObject({ held: { logins: 1 } })
  })

  it('says a file with no kit has none, and its password still opens it', async () => {
    const token = await open(false)
    expect(await tryKit(token, [pieces[0]!, pieces[1]!])).toEqual({
      ok: false,
      error: 'importNoKit',
    })
    const preview = await h.ok<TransferPreview>(
      { kind: 'transferPreview', token, password: 'the file password' },
      transfer,
    )
    expect(preview.held.logins).toBe(1)
  })

  it('is malformed when the pieces are not a short list of texts', async () => {
    const token = await open()
    for (const bad of ['a piece', [5], Array.from({ length: 10 }, () => pieces[0]), undefined]) {
      expect(await h.send({ kind: 'transferPreviewKit', token, pieces: bad }, transfer)).toEqual({
        ok: false,
        error: 'malformed',
      })
    }
  })
})
