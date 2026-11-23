import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clipboardAlarm, ClipboardManager, offscreenBackend } from './clipboard'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'
import { MemoryClipboard, start, useClock } from './test/harness'

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
  useClock()
})
afterEach(() => {
  vi.useRealTimers()
  mock.uninstall()
})

describe('ClipboardManager', () => {
  it('clears what it copied after the delay, if nothing else was copied', async () => {
    const backend = new MemoryClipboard()
    const manager = new ClipboardManager(backend)
    await manager.copy('482913', 30)
    expect(backend.text).toBe('482913')
    expect(mock.alarms.get(clipboardAlarm)).toEqual({ when: start + 30_000 })
    await vi.advanceTimersByTimeAsync(29_000)
    expect(backend.text).toBe('482913')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(backend.text).toBe('')
    expect(mock.alarms.has(clipboardAlarm)).toBe(false)
  })

  it('leaves something else the person copied meanwhile', async () => {
    const backend = new MemoryClipboard()
    const manager = new ClipboardManager(backend)
    await manager.copy('482913', 30)
    backend.text = 'my shopping list'
    await vi.advanceTimersByTimeAsync(31_000)
    expect(backend.text).toBe('my shopping list')
    expect(backend.writes).toEqual(['482913'])
  })

  it('keeps no copy of the value, only a digest, in session storage', async () => {
    const manager = new ClipboardManager(new MemoryClipboard())
    await manager.copy('secret-value', 10)
    expect(JSON.stringify([...mock.session.entries()])).not.toContain('secret-value')
  })

  it('clears from the alarm when the worker was stopped meanwhile', async () => {
    const backend = new MemoryClipboard()
    await new ClipboardManager(backend).copy('482913', 60)
    // A woken worker has a new manager and no timer
    vi.setSystemTime(start + 61_000)
    await new ClipboardManager(backend).alarm(clipboardAlarm)
    expect(backend.text).toBe('')
  })

  it('does not clear before the latest copy is due', async () => {
    const backend = new MemoryClipboard()
    const manager = new ClipboardManager(backend)
    await manager.copy('first', 10)
    await vi.advanceTimersByTimeAsync(5_000)
    await manager.copy('second', 10)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(backend.text).toBe('second')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(backend.text).toBe('')
  })

  it('leaves the clipboard if it cannot be read', async () => {
    const backend = new MemoryClipboard()
    backend.read = async () => {
      throw new Error('no focus')
    }
    const manager = new ClipboardManager(backend)
    await manager.copy('x', 10)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(backend.text).toBe('x')
  })
})

describe('offscreenBackend', () => {
  it('opens the offscreen document once and writes and reads through it', async () => {
    const backend = offscreenBackend()
    await backend.write('hello')
    await backend.write('again')
    expect(mock.offscreen).toEqual({ open: true, created: 1 })
    expect(mock.clipboard).toBe('again')
    expect(await backend.read()).toBe('again')
    expect(mock.runtimeMessages[0]).toEqual({ target: 'offscreen', kind: 'write', value: 'hello' })
  })
})
