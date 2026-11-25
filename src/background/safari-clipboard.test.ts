// Safari's clipboard (docs/plans/add-safari.md): the Mac app writes it and answers the pasteboard's change count, and clears it
// later only if that count is still the pasteboard's; the page's own commands are the fallback, and can't tell.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipboardManager, pageBackend, safariBackend, type ClipboardBackend } from './clipboard'
import { nativeProtocol, type NativeCall } from './native'
import { installChromeMock, type ChromeMock } from './test/chrome-mock'
import { until, useClock } from './test/harness'

let mock: ChromeMock
beforeEach(() => {
  mock = installChromeMock()
  useClock()
})
afterEach(() => {
  vi.useRealTimers()
  mock.uninstall()
})

interface MacApp {
  board: string
  /** The pasteboard's change count: every write and every clear is one. */
  count: number
  /** What the handler was asked, in order. */
  asked: Record<string, unknown>[]
  call: NativeCall
  /** What the person does: copies something else. */
  copy(text: string): void
}

/** The Mac app's handler over a pasteboard in memory, as tool/safari/SafariWebExtensionHandler.swift answers. */
function macApp(): MacApp {
  const app: MacApp = {
    board: '',
    count: 0,
    asked: [],
    copy: (text) => {
      app.board = text
      app.count += 1
    },
    call: async (message) => {
      app.asked.push(message)
      if (message.cmd === 'write') {
        app.board = String(message.value)
        app.count += 1
        return { kemlock: nativeProtocol, ok: true, count: app.count }
      }
      if (message.cmd === 'clear') {
        if (message.count === app.count) {
          app.board = ''
          app.count += 1
        }
        return { kemlock: nativeProtocol, ok: true }
      }
      return { kemlock: nativeProtocol, ok: false }
    },
  }
  return app
}

/** The page's own clipboard, in memory, which writes only when `allowed`. */
function page(options: { allowed?: boolean; commands?: boolean } = {}) {
  const log = { board: '', viaApi: 0, viaCommand: 0 }
  const backend = pageBackend({
    writeText: async (text) => {
      if (options.allowed === false) throw new Error('NotAllowedError')
      log.viaApi += 1
      log.board = text
    },
    copy: (text) => {
      if (options.commands === false) throw new Error('copy')
      log.viaCommand += 1
      log.board = text
    },
  })
  return { log, backend }
}

describe('pageBackend', () => {
  it("writes with the page's clipboard API when the browser lets it", async () => {
    const { log, backend } = page()
    await backend.write('482913')
    expect(log).toEqual({ board: '482913', viaApi: 1, viaCommand: 0 })
  })

  it('writes with the editing commands when the API refuses (no click behind it)', async () => {
    const { log, backend } = page({ allowed: false })
    await backend.write('482913')
    expect(log).toEqual({ board: '482913', viaApi: 0, viaCommand: 1 })
  })

  it('fails when both refuse', async () => {
    const { backend } = page({ allowed: false, commands: false })
    await expect(backend.write('482913')).rejects.toThrow('copy')
  })

  it('writes with the commands where the page has no clipboard API', async () => {
    let board = ''
    const backend = pageBackend({
      copy: (text) => {
        board = text
      },
    })
    await backend.write('x')
    expect(board).toBe('x')
  })

  it('reads nothing: a page can only paste after a click', async () => {
    await expect(page().backend.read()).rejects.toThrow('unreadable')
  })
})

describe('safariBackend', () => {
  it('writes through the Mac app with the clear time, and answers the change count', async () => {
    const app = macApp()
    const { log, backend: fallback } = page()
    const token = await safariBackend(app.call, fallback).write('482913', 30)
    expect(app.board).toBe('482913')
    expect(token).toBe(app.count)
    expect(app.asked).toEqual([{ kemlock: 1, cmd: 'write', value: '482913', seconds: 30 }])
    // The page stays out of it
    expect(log).toEqual({ board: '', viaApi: 0, viaCommand: 0 })
  })

  it("falls back on the page when the handler is not ours (a stock project's echo), with no count", async () => {
    const echo: NativeCall = async (message) => ({ echo: message })
    const { log, backend: fallback } = page()
    expect(await safariBackend(echo, fallback).write('482913', 30)).toBeUndefined()
    expect(log.board).toBe('482913')
  })

  it('falls back on the page when the app cannot be reached, or the browser has no way to it', async () => {
    const gone: NativeCall = () => Promise.reject(new Error('Could not establish connection'))
    const first = page()
    await safariBackend(gone, first.backend).write('482913', 30)
    expect(first.log.board).toBe('482913')
    const second = page()
    await safariBackend(null, second.backend).write('482913', 30)
    expect(second.log.board).toBe('482913')
  })

  it('never reads the clipboard', async () => {
    const app = macApp()
    await expect(safariBackend(app.call, page().backend).read()).rejects.toThrow('unreadable')
    expect(app.asked).toEqual([])
  })

  it('clears by the count it was given, and with no app has nothing to clear', async () => {
    const app = macApp()
    const backend = safariBackend(app.call, page().backend)
    const token = await backend.write('482913', 30)
    await backend.clearIfUnchanged?.(token as number)
    expect(app.asked.at(-1)).toEqual({ kemlock: 1, cmd: 'clear', count: token })
    expect(app.board).toBe('')
    await expect(safariBackend(null, page().backend).clearIfUnchanged?.(1)).resolves.toBeUndefined()
  })
})

describe('the clear in Safari', () => {
  it('clears a copy that nothing replaced, by its count, without reading the clipboard', async () => {
    const app = macApp()
    const manager = new ClipboardManager(safariBackend(app.call, page().backend))
    await manager.copy('482913', 30)
    expect(app.board).toBe('482913')
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => app.board === '')
    expect(app.board).toBe('')
    expect(app.asked.map((message) => message.cmd)).toEqual(['write', 'clear'])
  })

  it('keeps the count across a background that was stopped and woke', async () => {
    const app = macApp()
    await new ClipboardManager(safariBackend(app.call, page().backend)).copy('482913', 60)
    vi.setSystemTime(Date.now() + 61_000)
    await new ClipboardManager(safariBackend(app.call, page().backend)).alarm('kemlock-clipboard')
    expect(app.board).toBe('')
  })

  it('leaves what the person copied since', async () => {
    const app = macApp()
    const manager = new ClipboardManager(safariBackend(app.call, page().backend))
    await manager.copy('482913', 30)
    app.copy('my shopping list')
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => app.asked.some((message) => message.cmd === 'clear'))
    expect(app.board).toBe('my shopping list')
  })

  it('leaves what the page alone copied, which it cannot compare', async () => {
    const { log, backend: fallback } = page()
    const manager = new ClipboardManager(safariBackend(null, fallback))
    await manager.copy('482913', 30)
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => mock.session.size === 0)
    expect(log.board).toBe('482913')
  })

  it('does not fail when the app cannot be reached to clear', async () => {
    let reachable = true
    const call: NativeCall = async (message) => {
      if (!reachable) throw new Error('Could not establish connection')
      return { kemlock: nativeProtocol, ok: true, ...(message.cmd === 'write' ? { count: 1 } : {}) }
    }
    const manager = new ClipboardManager(safariBackend(call, page().backend))
    await manager.copy('482913', 30)
    reachable = false
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => mock.session.size === 0)
    expect(mock.session.size).toBe(0)
  })

  it('still compares by reading where a backend can read and gives no count', async () => {
    let board = ''
    const backend: ClipboardBackend = {
      write: async (text) => {
        board = text
      },
      read: async () => board,
    }
    const manager = new ClipboardManager(backend)
    await manager.copy('482913', 30)
    board = 'my shopping list'
    await vi.advanceTimersByTimeAsync(31_000)
    await until(() => mock.session.size === 0)
    await vi.advanceTimersByTimeAsync(10)
    expect(board).toBe('my shopping list')
  })

  it('keeps the count in the session record, and no copy of the value', async () => {
    const app = macApp()
    await new ClipboardManager(safariBackend(app.call, page().backend)).copy('secret-value', 30)
    const record = JSON.stringify([...mock.session.entries()])
    expect(record).not.toContain('secret-value')
    expect(record).toContain('"token":1')
  })
})
