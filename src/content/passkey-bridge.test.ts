import { describe, expect, it, vi } from 'vitest'
import { startPasskeyBridge, type BridgeRuntime } from './passkey-bridge'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await tick()
}

const id = '0123456789abcdef0123456789abcdef'
const options = { challenge: 'AQID' }
const begin = (over: Record<string, unknown> = {}) => ({
  kemlockPasskey: 1,
  op: 'begin',
  id,
  type: 'create',
  conditional: false,
  options,
  ...over,
})

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (response: unknown) => void,
) => boolean | undefined

/** The bridge over a window that is only its message listeners, a runtime that is only the background, and real ports. */
function setup(
  background: (message: Record<string, unknown>) => unknown | Promise<unknown>,
  windowExtras: Record<string, unknown> = {},
) {
  const listeners: ((event: MessageEvent) => void)[] = []
  const win = {
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.push(listener)
    },
    ...windowExtras,
  } as unknown as Window
  const sent: Record<string, unknown>[] = []
  let heard: Listener | undefined
  const runtime: BridgeRuntime = {
    id: 'kemlockid',
    sendMessage: vi.fn(async (message: unknown) => {
      sent.push(message as Record<string, unknown>)
      return background(message as Record<string, unknown>)
    }),
    onMessage: {
      addListener: (listener) => {
        heard = listener as Listener
      },
    },
  }
  startPasskeyBridge(win, runtime)
  return {
    sent,
    /** A page script's message to its own window, or another's, with a port of its own unless told not to. */
    post(data: unknown, options: { from?: unknown; port?: boolean } = {}) {
      const channel = new MessageChannel()
      const got: unknown[] = []
      channel.port1.onmessage = (event: MessageEvent) => got.push(event.data)
      for (const listener of listeners)
        listener({
          source: 'from' in options ? options.from : win,
          data,
          ports: options.port === false ? [] : [channel.port2],
        } as unknown as MessageEvent)
      return { got, port: channel.port1, close: () => channel.port1.close() }
    },
    /** What the background says to the frame, with the answer the bridge gives. */
    fromBackground(message: unknown, sender: { id?: string } = { id: 'kemlockid' }) {
      let answer: unknown
      const result = heard!(message, sender, (response) => (answer = response))
      return { answer, keptOpen: result }
    },
    win,
  }
}

const ok = (value: unknown) => ({ ok: true, value })

describe('a request from the page script', () => {
  it('is taken, passed to the background as the frame’s own, and answered when the background says so', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }))
    const page = bridge.post(begin())
    await settle()
    expect(page.got).toEqual([{ op: 'ack' }])
    expect(bridge.sent).toEqual([
      { kind: 'passkeyBegin', id, type: 'create', conditional: false, options },
    ])
    // The end comes later, as the background's message to this frame
    const result = { outcome: 'credential', credential: { id: 'x' } }
    expect(bridge.fromBackground({ kind: 'passkeyDone', id, result }).answer).toEqual({ ok: true })
    await settle()
    expect(page.got).toEqual([{ op: 'ack' }, { op: 'done', result }])
    // It was the only end: another is for no one
    expect(bridge.fromBackground({ kind: 'passkeyDone', id, result }).answer).toEqual({ ok: false })
    page.close()
  })

  it('ends at once when the background answers with an end', async () => {
    for (const result of [
      { outcome: 'fallback' },
      { outcome: 'error', name: 'InvalidStateError' },
      { outcome: 'credential', credential: { id: 'x' } },
    ]) {
      const bridge = setup(() => ok(result))
      const page = bridge.post(begin())
      await settle()
      expect(page.got).toEqual([{ op: 'ack' }, { op: 'done', result }])
      page.close()
    }
  })

  it('goes to the browser’s own way when the background fails, or answers anything else', async () => {
    const answers = [
      () => {
        throw new Error('the extension went away')
      },
      () => undefined,
      () => ({ ok: false, error: 'failed' }),
      () => ok('what?'),
      () => ok({ outcome: 'surprise' }),
      () => ok(null),
    ]
    for (const answer of answers) {
      const bridge = setup(answer)
      const page = bridge.post(begin())
      await settle()
      expect(page.got).toEqual([{ op: 'ack' }, { op: 'done', result: { outcome: 'fallback' } }])
      page.close()
    }
  })

  it('is cancelled when the page script says so', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }))
    const page = bridge.post(begin())
    await settle()
    page.port.postMessage({ op: 'cancel' })
    await settle()
    expect(bridge.sent.at(-1)).toEqual({ kind: 'passkeyCancel', id })
    expect(
      bridge.fromBackground({ kind: 'passkeyDone', id, result: { outcome: 'fallback' } }).answer,
    ).toEqual({
      ok: false,
    })
    // Nothing else cancels it
    page.port.postMessage({ op: 'other' })
  })

  it('is refused, with the browser’s own way, when it is not shaped as one', async () => {
    for (const over of [
      { id: 'short' },
      { id: 'Z'.repeat(32) },
      { type: 'delete' },
      { conditional: 'no' },
      { options: null },
      { options: [] },
    ]) {
      const bridge = setup(() => ok({ outcome: 'pending' }))
      const page = bridge.post(begin(over))
      await settle()
      expect(bridge.sent, JSON.stringify(over)).toEqual([])
      expect(page.got).toEqual([{ op: 'done', result: { outcome: 'fallback' } }])
      page.close()
    }
  })

  it('is not taken twice under one id', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }))
    const first = bridge.post(begin())
    const second = bridge.post(begin())
    await settle()
    expect(bridge.sent).toHaveLength(1)
    expect(second.got).toEqual([{ op: 'done', result: { outcome: 'fallback' } }])
    first.close()
  })

  it('is heard only from this window, with the marker and a port', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }))
    const other = {} as Window
    for (const [data, options] of [
      [begin(), { from: other }],
      [begin(), { from: null }],
      [begin(), { from: undefined }],
      [{ ...begin(), kemlockPasskey: 2 }, {}],
      [{ op: 'begin', id }, {}],
      ['begin', {}],
      [null, {}],
      [begin(), { port: false }],
      [{ ...begin(), op: 'delete' }, {}],
    ] as [unknown, { from?: unknown; port?: boolean }][]) {
      const page = bridge.post(data, options)
      await settle()
      expect(page.got, JSON.stringify(data)).toEqual([])
      page.close()
    }
    expect(bridge.sent).toEqual([])
  })
})

describe('a framed document', () => {
  const seesTop = { location: { href: 'https://top.example/' } }
  const blindToTop = {
    get location(): never {
      throw new DOMException('Blocked a frame', 'SecurityError')
    },
  }
  const policy = (allowed: string[]) => ({
    allowsFeature: (name: string) => allowed.includes(name),
  })
  const framed = (
    over: { top?: unknown; document?: unknown; navigator?: unknown } = {},
  ): Record<string, unknown> => ({
    top: seesTop,
    self: {},
    document: {
      permissionsPolicy: policy(['publickey-credentials-get', 'publickey-credentials-create']),
    },
    navigator: {},
    ...over,
  })
  const refused = { op: 'done', result: { outcome: 'fallback' } }

  it('is served as it is at the top of a page, whatever it has of a policy', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }), { top: {}, document: {} })
    ;(bridge.win as unknown as { self: unknown }).self = (
      bridge.win as unknown as { top: unknown }
    ).top
    const page = bridge.post(begin())
    await settle()
    expect(page.got).toEqual([{ op: 'ack' }])
    page.close()
  })

  it('is left to the browser when its permissions policy does not allow the feature, or can’t be read', async () => {
    for (const document of [
      {},
      { permissionsPolicy: policy([]) },
      { permissionsPolicy: policy(['publickey-credentials-create']) },
      { permissionsPolicy: {} },
    ]) {
      const bridge = setup(() => ok({ outcome: 'pending' }), framed({ document }))
      const page = bridge.post(begin({ type: 'get' }))
      await settle()
      expect(bridge.sent, JSON.stringify(document)).toEqual([])
      expect(page.got).toEqual([refused])
      page.close()
    }
  })

  it('is served when the policy allows the feature, from the policy of the older name too', async () => {
    for (const document of [
      { permissionsPolicy: policy(['publickey-credentials-get']) },
      { featurePolicy: policy(['publickey-credentials-get']) },
    ]) {
      const bridge = setup(() => ok({ outcome: 'pending' }), framed({ document }))
      const page = bridge.post(begin({ type: 'get' }))
      await settle()
      expect(page.got).toEqual([{ op: 'ack' }])
      expect(bridge.sent).toHaveLength(1)
      page.close()
    }
  })

  it('asks the feature of the request’s own kind', async () => {
    const document = { permissionsPolicy: policy(['publickey-credentials-get']) }
    const bridge = setup(() => ok({ outcome: 'pending' }), framed({ document }))
    const create = bridge.post(begin({ id: 'a'.repeat(32) }))
    const get = bridge.post(begin({ id: 'b'.repeat(32), type: 'get' }))
    await settle()
    expect(create.got).toEqual([refused])
    expect(get.got).toEqual([{ op: 'ack' }])
    create.close()
    get.close()
  })

  it('is served from a frame of the same site with no activity needed', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }), framed())
    const page = bridge.post(begin())
    await settle()
    expect(page.got).toEqual([{ op: 'ack' }])
    page.close()
  })

  it('wants the person’s recent activity in a frame that can’t see its top page, to create', async () => {
    const quiet = setup(() => ok({ outcome: 'pending' }), framed({ top: blindToTop }))
    const refusedCreate = quiet.post(begin())
    await settle()
    expect(quiet.sent).toEqual([])
    expect(refusedCreate.got).toEqual([refused])
    refusedCreate.close()
    for (const navigator of [{}, { userActivation: {} }, { userActivation: { isActive: false } }]) {
      const bridge = setup(() => ok({ outcome: 'pending' }), framed({ top: blindToTop, navigator }))
      const page = bridge.post(begin())
      await settle()
      expect(page.got, JSON.stringify(navigator)).toEqual([refused])
      page.close()
    }
    const active = setup(
      () => ok({ outcome: 'pending' }),
      framed({ top: blindToTop, navigator: { userActivation: { isActive: true } } }),
    )
    const page = active.post(begin())
    await settle()
    expect(page.got).toEqual([{ op: 'ack' }])
    page.close()
  })

  it('needs no activity to sign in from such a frame', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }), framed({ top: blindToTop }))
    const page = bridge.post(begin({ type: 'get' }))
    await settle()
    expect(page.got).toEqual([{ op: 'ack' }])
    page.close()
  })
})

describe('a check of whether Kemlock answers here', () => {
  it('asks the background and tells the page script', async () => {
    for (const active of [true, false]) {
      const bridge = setup(() => ok({ active }))
      const page = bridge.post({ kemlockPasskey: 1, op: 'status' })
      await settle()
      expect(bridge.sent).toEqual([{ kind: 'passkeyStatus' }])
      expect(page.got).toEqual([{ op: 'status', active }])
      page.close()
    }
  })

  it('is a no when the background doesn’t say', async () => {
    const bridge = setup(() => {
      throw new Error('gone')
    })
    const page = bridge.post({ kemlockPasskey: 1, op: 'status' })
    await settle()
    expect(page.got).toEqual([{ op: 'status', active: false }])
    page.close()
  })
})

describe('what the background says to the frame', () => {
  it('is believed only from the extension itself', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }))
    const page = bridge.post(begin())
    await settle()
    const done = { kind: 'passkeyDone', id, result: { outcome: 'fallback' } }
    expect(bridge.fromBackground(done, { id: 'another-extension' }).answer).toBeUndefined()
    expect(bridge.fromBackground(done, {}).answer).toBeUndefined()
    expect(bridge.fromBackground(done).answer).toEqual({ ok: true })
    page.close()
  })

  it('answers a check that the request is still waiting here', async () => {
    const bridge = setup(() => ok({ outcome: 'pending' }))
    const page = bridge.post(begin())
    await settle()
    expect(bridge.fromBackground({ kind: 'passkeyPing', id }).answer).toEqual({ ok: true })
    expect(bridge.fromBackground({ kind: 'passkeyPing', id: 'other' }).answer).toEqual({
      ok: false,
    })
    bridge.fromBackground({ kind: 'passkeyDone', id, result: { outcome: 'fallback' } })
    expect(bridge.fromBackground({ kind: 'passkeyPing', id }).answer).toEqual({ ok: false })
    page.close()
  })

  it('leaves what is not its own to the other listeners', () => {
    const bridge = setup(() => undefined)
    for (const message of [
      { kind: 'closeMenus' },
      { kind: 'passkeyPrompt' },
      null,
      'x',
      { kind: 'passkeyDone' },
    ]) {
      const heard = bridge.fromBackground(message)
      expect(heard.keptOpen).toBe(false)
      expect(heard.answer).toBeUndefined()
    }
  })
})
