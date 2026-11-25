import { describe, expect, it, vi } from 'vitest'
import { sendChunkBytes, type SendResult } from '../shared/sends'
import { fromBase64, readFile, stageFile, toBase64, type Staged } from './files'

const bytesOf = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 7 + 3) & 0xff)

describe('bytes as base64', () => {
  it('go and come back, whatever their length', () => {
    for (const length of [0, 1, 2, 3, 100, 0x2000, 0x2000 + 1, 70_000])
      expect([...fromBase64(toBase64(bytesOf(length)))]).toEqual([...bytesOf(length)])
  })

  it('are the standard alphabet, as the core reads it', () => {
    expect(toBase64(Uint8Array.from([250, 251, 252, 253, 254, 255]))).toBe('+vv8/f7/')
  })
})

describe('giving a file to the core', () => {
  it('goes a piece at a time, the first piece starting a file and the others naming it', async () => {
    const file = new Blob([bytesOf(sendChunkBytes * 2 + 5)])
    const seen: { length: number; handle: string | undefined }[] = []
    const stage = vi.fn(
      async (data: string, handle: string | undefined): Promise<SendResult<Staged>> => {
        seen.push({ length: fromBase64(data).length, handle })
        return {
          ok: true,
          value: { handle: 'h1', length: seen.reduce((sum, piece) => sum + piece.length, 0) },
        }
      },
    )
    const progress = vi.fn()
    const done = await stageFile(file, stage, progress)
    expect(seen).toEqual([
      { length: sendChunkBytes, handle: undefined },
      { length: sendChunkBytes, handle: 'h1' },
      { length: 5, handle: 'h1' },
    ])
    expect(done).toEqual({ ok: true, value: { handle: 'h1', length: sendChunkBytes * 2 + 5 } })
    expect(progress.mock.calls.map(([sent]) => sent)).toEqual([
      sendChunkBytes,
      sendChunkBytes * 2,
      sendChunkBytes * 2 + 5,
    ])
  })

  it('stops at the first piece the core refuses, and says why', async () => {
    const file = new Blob([bytesOf(sendChunkBytes * 3)])
    let calls = 0
    const released: string[] = []
    const done = await stageFile(
      file,
      async (): Promise<SendResult<Staged>> => {
        calls += 1
        return calls === 2
          ? { ok: false, problem: 'invalid', reason: 'fileTooBig' }
          : { ok: true, value: { handle: 'h1', length: calls } }
      },
      undefined,
      async (handle) => void released.push(handle),
    )
    expect(done).toEqual({ ok: false, problem: 'invalid', reason: 'fileTooBig' })
    expect(calls).toBe(2)
    // What went up before the refusal is let go of
    expect(released).toEqual(['h1'])
  })
})

describe('reading the file the core holds', () => {
  it('joins its pieces until the core answers an empty one', async () => {
    const whole = bytesOf(sendChunkBytes + 10)
    const pieces = [whole.subarray(0, sendChunkBytes), whole.subarray(sendChunkBytes)]
    const asked: number[] = []
    const blob = await readFile(async (index) => {
      asked.push(index)
      return index < pieces.length ? toBase64(pieces[index]!) : ''
    }, 'text/plain')
    expect(asked).toEqual([0, 1, 2])
    expect(blob.type).toBe('text/plain')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(whole)
  })
})
