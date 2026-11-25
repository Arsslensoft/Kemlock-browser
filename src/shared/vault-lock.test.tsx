// @vitest-environment jsdom
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { isLockedMessage, lockedMessage, useVaultLock, fromExtension } from './vault-lock'

type Listener = (message: unknown, sender: { id?: string; url?: string }) => unknown

let listeners: Listener[]
let onLocked: Mock<() => void>

beforeEach(() => {
  listeners = []
  onLocked = vi.fn()
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        id: 'kemlock',
        getURL: (path: string) => `chrome-extension://kemlock/${path}`,
        onMessage: {
          addListener: (listener: Listener) => listeners.push(listener),
          removeListener: (listener: Listener) => {
            listeners = listeners.filter((other) => other !== listener)
          },
        },
      },
    },
  })
})

// Each test's probe is taken down after it, so its listeners don't hear the next test's events
const mounted: HTMLElement[] = []

afterEach(() => {
  for (const root of mounted.splice(0)) render(null, root)
  document.body.replaceChildren()
})

const background = { id: 'kemlock', url: 'chrome-extension://kemlock/background.js' }
const web = { id: 'kemlock', url: 'https://evil.example/page' }

function Probe(props: { isOpen?: () => Promise<boolean> }) {
  useVaultLock(() => onLocked(), props.isOpen)
  return h('p', null, 'open')
}

async function mountProbe(isOpen?: () => Promise<boolean>): Promise<HTMLElement> {
  const root = document.createElement('div')
  document.body.append(root)
  mounted.push(root)
  await act(() => {
    render(h(Probe, { isOpen }), root)
  })
  return root
}

const visible = async (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  await act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('the lock message', () => {
  it('is exactly the one message, from the extension and not from a web page', () => {
    expect(isLockedMessage(lockedMessage)).toBe(true)
    for (const raw of [null, 'locked', {}, { kemlock: 'unlocked' }, { kemlock: 'locked', x: 1 }])
      expect(isLockedMessage(raw), JSON.stringify(raw)).toBe(false)
    expect(fromExtension(background)).toBe(true)
    expect(fromExtension(web)).toBe(false)
    expect(fromExtension({ id: 'other', url: background.url })).toBe(false)
    expect(fromExtension({ id: 'kemlock' })).toBe(false)
  })
})

describe('useVaultLock', () => {
  it('calls back when the background says the vault locked, and only then', async () => {
    await mountProbe()
    expect(listeners).toHaveLength(1)
    await act(() => {
      listeners[0]!({ kemlock: 'locked' }, background)
    })
    expect(onLocked).toHaveBeenCalledTimes(1)
    // A web page's message, or another message, locks nothing
    listeners[0]!({ kemlock: 'locked' }, web)
    listeners[0]!({ kind: 'keys' }, background)
    expect(onLocked).toHaveBeenCalledTimes(1)
  })

  it('answers nothing, so the sender is not kept waiting', async () => {
    await mountProbe()
    expect(listeners[0]!({ kemlock: 'locked' }, background)).toBe(false)
  })

  it('asks again when the page becomes visible, and calls back only if the vault is not open', async () => {
    let open = true
    await mountProbe(async () => open)
    await visible('hidden')
    await visible('visible')
    expect(onLocked).not.toHaveBeenCalled()
    open = false
    await visible('hidden')
    expect(onLocked).not.toHaveBeenCalled()
    await visible('visible')
    await act(async () => {
      await Promise.resolve()
    })
    expect(onLocked).toHaveBeenCalledTimes(1)
  })

  it('takes a failing check as a lock, and listens no more once the page is gone', async () => {
    const root = await mountProbe(async () => {
      throw new Error('locked')
    })
    await visible('visible')
    await act(async () => {
      await Promise.resolve()
    })
    expect(onLocked).toHaveBeenCalledTimes(1)
    await act(() => {
      render(null, root)
    })
    expect(listeners).toHaveLength(0)
    await visible('visible')
    expect(onLocked).toHaveBeenCalledTimes(1)
  })
})
