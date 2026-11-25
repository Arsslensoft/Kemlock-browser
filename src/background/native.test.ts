import { describe, expect, it, vi } from 'vitest'
import {
  askNative,
  nativeCall,
  nativeProtocol,
  nativeScreenLocked,
  type NativeCall,
} from './native'

/** An answer the Mac app's handler (tool/safari/SafariWebExtensionHandler.swift) gives. */
const good = (extra: object = {}) => ({ kemlock: nativeProtocol, ok: true, ...extra })

describe('nativeCall', () => {
  it('is none where the browser cannot send to an app', () => {
    expect(nativeCall({})).toBeNull()
    expect(nativeCall({ sendNativeMessage: 'yes' })).toBeNull()
  })

  it('sends the message to the app, whatever its name, as the runtime itself', async () => {
    const seen: unknown[] = []
    const runtime = {
      sendNativeMessage(this: unknown, application: string, message: object) {
        seen.push(this === runtime, application, message)
        return Promise.resolve(good())
      },
    }
    const call = nativeCall(runtime)
    expect(call).not.toBeNull()
    await call?.({ cmd: 'clear' })
    expect(seen).toEqual([true, 'application.id', { cmd: 'clear' }])
  })
})

describe('askNative', () => {
  it('sends the protocol, the command and what it takes', async () => {
    const call = vi.fn<NativeCall>(async () => good())
    await askNative(call, 'write', { value: 'secret', seconds: 30 })
    await askNative(call, 'clear', { count: 7 })
    await askNative(call, 'screenLocked')
    expect(call.mock.calls).toEqual([
      [{ kemlock: 1, cmd: 'write', value: 'secret', seconds: 30 }],
      [{ kemlock: 1, cmd: 'clear', count: 7 }],
      [{ kemlock: 1, cmd: 'screenLocked' }],
    ])
  })

  it('gives the change count or the lock state of a good answer, and only of the right type', async () => {
    expect(await askNative(async () => good({ count: 12 }), 'write', { value: 'x' })).toEqual({
      count: 12,
    })
    expect(await askNative(async () => good({ locked: true }), 'screenLocked')).toEqual({
      locked: true,
    })
    expect(await askNative(async () => good({ count: '5', locked: 'yes' }), 'clear')).toEqual({})
  })

  it("refuses what is not the app's answer: a stock project's echo, a no, another version", async () => {
    const echo = { echo: { kemlock: 1, cmd: 'write', value: 'secret' } }
    const replies = [
      echo,
      undefined,
      null,
      'ok',
      { kemlock: 1, ok: false },
      { kemlock: 2, ok: true },
      { ok: true },
      { kemlock: 1, ok: 'true' },
    ]
    for (const reply of replies) {
      const asked = askNative(async () => reply, 'write', { value: 'x' })
      await expect(asked, JSON.stringify(reply)).rejects.toThrow('native')
    }
  })

  it('lets a failure of the call through', async () => {
    const call: NativeCall = () => Promise.reject(new Error('Could not establish connection'))
    await expect(askNative(call, 'clear', { count: 1 })).rejects.toThrow(
      'Could not establish connection',
    )
  })
})

describe('nativeScreenLocked', () => {
  it('says what the app says', async () => {
    expect(await nativeScreenLocked(async () => good({ locked: true }))()).toBe(true)
    expect(await nativeScreenLocked(async () => good({ locked: false }))()).toBe(false)
  })

  it('says no when the app can not say: no answer, an echo, a failure', async () => {
    expect(await nativeScreenLocked(async () => good())()).toBe(false)
    expect(await nativeScreenLocked(async () => ({ echo: {} }))()).toBe(false)
    expect(await nativeScreenLocked(() => Promise.reject(new Error('gone')))()).toBe(false)
  })
})
