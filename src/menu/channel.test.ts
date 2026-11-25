// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { connect, parseHash, type Channel, type Init } from './channel'

const nonce = '0123456789abcdef0123456789abcdef'
const later = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

describe('parseHash', () => {
  it('reads the mode and the secret the content script put in the address', () => {
    expect(parseHash(`#menu.${nonce}`)).toEqual({ mode: 'menu', nonce })
    expect(parseHash(`#save.${nonce}`)).toEqual({ mode: 'save', nonce })
    expect(parseHash(`#passkey.${nonce}`)).toEqual({ mode: 'passkey', nonce })
  })

  it('refuses an address without them: a page framing the menu on its own gets nothing', () => {
    expect(parseHash('')).toBeNull()
    expect(parseHash('#menu')).toBeNull()
    expect(parseHash(`#other.${nonce}`)).toBeNull()
    expect(parseHash('#menu.short')).toBeNull()
  })
})

describe('connect', () => {
  const toClose: MessagePort[] = []
  afterEach(() => {
    for (const port of toClose.splice(0)) port.close()
  })

  /** A window that only hears messages, and the content script's end of the port. */
  function setup() {
    const listeners = new Set<(event: MessageEvent) => void>()
    const win = {
      document,
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
        listeners.delete(listener),
    }
    const { port1, port2 } = new MessageChannel()
    toClose.push(port1, port2)
    const clock = { now: 0 }
    const connected = connect(nonce, win as unknown as Window, () => clock.now)
    const deliver = (data: unknown, ports: MessagePort[]) =>
      listeners.forEach((listener) => listener({ data, ports } as unknown as MessageEvent))
    return { port1, port2, clock, connected, deliver, listeners }
  }

  const initMessage = {
    kind: 'init',
    mode: 'menu',
    tabId: 4,
    frameId: 2,
    fieldId: 'f1',
    siteRules: 'maxlength: 16',
  }

  async function opened(): Promise<ReturnType<typeof setup> & { channel: Channel; init: Init }> {
    const parts = setup()
    parts.deliver({ kemlock: 'port', nonce }, [parts.port2])
    parts.port1.postMessage(initMessage)
    const { channel, init } = await parts.connected
    return { ...parts, channel, init }
  }

  it('gives the passkey card its secret, and only as text', async () => {
    for (const [token, expected] of [
      ['abc123', 'abc123'],
      [7, undefined],
      [undefined, undefined],
    ] as const) {
      const parts = setup()
      parts.deliver({ kemlock: 'port', nonce }, [parts.port2])
      parts.port1.postMessage({ ...initMessage, mode: 'passkey', token })
      const { init } = await parts.connected
      expect(init.mode).toBe('passkey')
      expect(init.token).toBe(expected)
    }
  })

  it('takes the port only with the secret from the address', async () => {
    const parts = setup()
    parts.deliver({ kemlock: 'port', nonce: 'f'.repeat(32) }, [parts.port2])
    parts.deliver({ kemlock: 'port', nonce }, [])
    parts.deliver('hello', [])
    expect(parts.listeners.size).toBe(1)
    parts.deliver({ kemlock: 'port', nonce }, [parts.port2])
    expect(parts.listeners.size).toBe(0)
    parts.port1.postMessage(initMessage)
    const { init } = await parts.connected
    expect(init).toEqual({
      mode: 'menu',
      tabId: 4,
      frameId: 2,
      fieldId: 'f1',
      siteRules: 'maxlength: 16',
    })
  })

  it('ignores input until the content script says the menu is in plain view for half a second', async () => {
    const { channel, port1, clock } = await opened()
    expect(await channel.permit(10, 10)).toEqual({ ok: false, why: 'silent' })
    port1.onmessage = (event) => {
      const data = event.data as { kind: string; id: number }
      if (data.kind === 'check') port1.postMessage({ kind: 'checked', id: data.id, ok: true })
    }
    port1.postMessage({ kind: 'state', plain: true, signature: '1,1,320,200' })
    await later()
    clock.now = 100
    expect(await channel.permit(10, 10)).toEqual({ ok: false, why: 'wait' })
    clock.now = 600
    expect(await channel.permit(10, 10)).toEqual({ ok: true })
  })

  it('asks the content script to check the click, and takes its no', async () => {
    const { channel, port1, clock } = await opened()
    const asked: unknown[] = []
    port1.onmessage = (event) => {
      const data = event.data as { kind: string; id: number }
      if (data.kind !== 'check') return
      asked.push(data)
      port1.postMessage({ kind: 'checked', id: data.id, ok: false, why: 'covered' })
    }
    port1.postMessage({ kind: 'state', plain: true, signature: 'a' })
    await later()
    clock.now = 600
    expect(await channel.permit(12, 34)).toEqual({ ok: false, why: 'covered' })
    expect(asked).toEqual([{ kind: 'check', id: 1, x: 12, y: 34 }])
  })

  it('does not ask while the content script says the menu is faded', async () => {
    const { channel, port1, clock } = await opened()
    let asked = 0
    port1.onmessage = () => asked++
    port1.postMessage({ kind: 'state', plain: false, why: 'faded', signature: 'a' })
    await later()
    clock.now = 600
    expect(await channel.permit(10, 10)).toEqual({ ok: false, why: 'faded' })
    expect(asked).toBe(0)
  })

  it('reports its height and closing to the content script', async () => {
    const { channel, port1 } = await opened()
    const heard: unknown[] = []
    port1.onmessage = (event) => heard.push(event.data)
    channel.size(180)
    channel.close(true)
    await later()
    expect(heard).toEqual([
      { kind: 'size', height: 180 },
      { kind: 'close', refocus: true },
    ])
  })
})
