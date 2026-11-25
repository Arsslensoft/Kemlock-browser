import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendsKeepAlivePort, sendsPingMs } from '../shared/sends'
import { holdBackground } from './keepalive'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('holding the background', () => {
  it('opens the port the background knows, pings it so the worker is not stopped, and lets go', () => {
    vi.useFakeTimers()
    const port = { postMessage: vi.fn(), disconnect: vi.fn() }
    const connect = vi.fn(() => port)
    vi.stubGlobal('chrome', { runtime: { connect } })
    const release = holdBackground()
    expect(connect).toHaveBeenCalledWith({ name: sendsKeepAlivePort })
    // The worker stops after about 30 seconds with nothing to do: the pings come well inside that
    expect(sendsPingMs).toBeLessThan(30_000)
    vi.advanceTimersByTime(sendsPingMs * 3)
    expect(port.postMessage).toHaveBeenCalledTimes(3)
    expect(port.postMessage).toHaveBeenCalledWith({ kind: 'ping' })
    release()
    vi.advanceTimersByTime(sendsPingMs * 3)
    expect(port.postMessage).toHaveBeenCalledTimes(3)
    expect(port.disconnect).toHaveBeenCalledTimes(1)
  })

  it('goes on when there is no background to hold, or the port has closed', () => {
    vi.useFakeTimers()
    vi.stubGlobal('chrome', {
      runtime: {
        connect: () => {
          throw new Error('no background')
        },
      },
    })
    expect(() => holdBackground()()).not.toThrow()
    const port = {
      postMessage: vi.fn(() => {
        throw new Error('closed')
      }),
      disconnect: vi.fn(() => {
        throw new Error('closed')
      }),
    }
    vi.stubGlobal('chrome', { runtime: { connect: () => port } })
    const release = holdBackground()
    expect(() => vi.advanceTimersByTime(sendsPingMs)).not.toThrow()
    expect(() => release()).not.toThrow()
  })
})
