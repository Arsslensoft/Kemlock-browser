import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptCore, KemlockError, methods, open, type CoreBridge } from './bridge'

// The Dart loader exists only in a build (tool/build.mjs): its module is stood in for here.
const loader = vi.hoisted(() => ({
  compileStreaming: vi.fn(),
  compile: vi.fn(),
}))
vi.mock('./loader', () => loader)

const { browserHint, loadCore } = await import('./wasm')

const ok = (value: unknown) => JSON.stringify({ ok: true, value })
const failed = (code: unknown, message = '') =>
  JSON.stringify({ ok: false, error: { code, message } })

describe('open', () => {
  it('gives the value of an answer', () => {
    expect(open(ok({ exists: true }))).toEqual({ exists: true })
    expect(open(ok(null))).toBeNull()
  })

  it('throws a KemlockError whose message is the code word', () => {
    expect.assertions(4)
    try {
      open(failed('locked', 'the vault is shut'))
    } catch (error) {
      expect(error).toBeInstanceOf(KemlockError)
      expect((error as Error).name).toBe('KemlockError')
      expect((error as Error).message).toBe('locked')
      expect((error as KemlockError).detail).toBe('the vault is shut')
    }
  })

  it('says failed for a code that is not one word, and for an answer that is not JSON', () => {
    expect(() => open(failed('not a word'))).toThrow(expect.objectContaining({ message: 'failed' }))
    expect(() => open(failed(42))).toThrow(expect.objectContaining({ message: 'failed' }))
    expect(() => open('<html>')).toThrow(expect.objectContaining({ message: 'failed' }))
  })
})

function bridgeWith(answer: (method: string, args: unknown[]) => string) {
  const calls: { method: string; args: unknown[] }[] = []
  const bridge: CoreBridge = {
    init: vi.fn(async () => ok(null)),
    call: async (method, argsJson) => {
      const args = JSON.parse(argsJson) as unknown[]
      calls.push({ method, args })
      return answer(method, args)
    },
  }
  return { bridge, calls }
}

describe('adaptCore', () => {
  it('has every method of the core', () => {
    const { bridge } = bridgeWith(() => ok(null))
    const core = adaptCore(bridge) as unknown as Record<string, unknown>
    for (const method of methods) expect(typeof core[method]).toBe('function')
    expect(new Set(methods).size).toBe(methods.length)
  })

  it('calls the method by name with its arguments as a JSON array', async () => {
    const { bridge, calls } = bridgeWith(() => ok({ ok: true, wrongPasswords: 0 }))
    const core = adaptCore(bridge)
    expect(await core.unlock('correct horse')).toEqual({ ok: true, wrongPasswords: 0 })
    await core.saveLogin(null, { name: 'Orbit', username: 'sam', password: 'x', websites: [] })
    await core.liveCodes(['a', 'b'], 1_700_000_000_000)
    expect(calls).toEqual([
      { method: 'unlock', args: ['correct horse'] },
      {
        method: 'saveLogin',
        args: [null, { name: 'Orbit', username: 'sam', password: 'x', websites: [] }],
      },
      { method: 'liveCodes', args: [['a', 'b'], 1_700_000_000_000] },
    ])
  })

  it('sends an argument left out as none', async () => {
    const { bridge, calls } = bridgeWith(() => ok(null))
    await adaptCore(bridge).addCode('otpauth://totp/x?secret=ABC', undefined)
    expect(calls[0]?.args).toEqual(['otpauth://totp/x?secret=ABC', null])
  })

  it('answers nothing as undefined', async () => {
    const { bridge } = bridgeWith(() => ok(null))
    const core = adaptCore(bridge)
    expect(await core.lock()).toBeUndefined()
    expect(await core.deleteLogin('x')).toBeUndefined()
    // ...but a null that is an answer stays one
    expect(await core.syncStatus()).toBeNull()
    expect(await core.readQr('data:image/png;base64,AA')).toBeNull()
  })

  it('throws what the core failed with', async () => {
    const { bridge } = bridgeWith(() => failed('notAnOtpauth', 'not a code link'))
    await expect(adaptCore(bridge).addCode('hello')).rejects.toMatchObject({
      name: 'KemlockError',
      message: 'notAnOtpauth',
    })
  })
})

describe('loadCore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    loader.compileStreaming.mockReset()
    loader.compile.mockReset()
  })

  function browser(files: Record<string, string>) {
    const session = new Map<string, unknown>()
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: (path: string) => `chrome-extension://kemlockid/${path}`,
        getManifest: () => ({ version: '1.2.3' }),
      },
      storage: {
        session: {
          get: async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {}),
          set: async (items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items)) session.set(key, value)
          },
        },
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const text = files[url.replace('chrome-extension://kemlockid/', '')]
        return new Response(text ?? 'nothing', { status: text === undefined ? 404 : 200 })
      }),
    )
    return session
  }

  it('starts the module, hands it the files, the version and a session key, and returns the core', async () => {
    const session = browser({
      'core/data/public_suffix_list.dat': 'com\n',
      'core/data/eff_large_wordlist.txt': '11111\tabacus\n',
    })
    const { bridge, calls } = bridgeWith(() => ok('locked'))
    const main = vi.fn(() => {
      ;(globalThis as { kemlockCore?: CoreBridge }).kemlockCore = bridge
    })
    loader.compileStreaming.mockResolvedValue({
      instantiate: async () => ({ invokeMain: main }),
    })

    const core = await loadCore({ redirectUrl: 'https://kemlockid.chromiumapp.org/' })
    expect(main).toHaveBeenCalledOnce()
    const host = vi.mocked(bridge.init).mock.calls[0]?.[0] as Record<string, unknown>
    expect(host.version).toBe('1.2.3')
    expect(host.publicSuffixList).toBe('com\n')
    expect(host.wordList).toBe('11111\tabacus\n')
    // A file the extension lacks is left out, not an error
    expect(host.twoFactorDirectory).toBeUndefined()
    expect(host.redirectUrl).toBe('https://kemlockid.chromiumapp.org/')
    expect(atob(host.sessionKey as string)).toHaveLength(32)
    expect(session.get('kemlock.sessionKey')).toBe(host.sessionKey)

    expect(await core.exportSession()).toBe('locked')
    expect(calls).toEqual([{ method: 'exportSession', args: [] }])
  })

  it('keeps the session key the browser session already has', async () => {
    const session = browser({})
    session.set('kemlock.sessionKey', 'a2V5')
    const { bridge } = bridgeWith(() => ok(null))
    loader.compileStreaming.mockResolvedValue({
      instantiate: async () => ({
        invokeMain: () => {
          ;(globalThis as { kemlockCore?: CoreBridge }).kemlockCore = bridge
        },
      }),
    })
    await loadCore()
    expect((vi.mocked(bridge.init).mock.calls[0]?.[0] as { sessionKey: string }).sessionKey).toBe(
      'a2V5',
    )
  })

  it('tells the core it runs in Safari when the build is for Safari, and leaves the others to the user agent', async () => {
    for (const [built, expected] of [
      ['safari', 'safari'],
      ['chrome', undefined],
      ['firefox', undefined],
    ] as const) {
      browser({})
      vi.stubGlobal('__BROWSER__', built)
      const { bridge } = bridgeWith(() => ok(null))
      loader.compileStreaming.mockResolvedValue({
        instantiate: async () => ({
          invokeMain: () => {
            ;(globalThis as { kemlockCore?: CoreBridge }).kemlockCore = bridge
          },
        }),
      })
      await loadCore()
      const host = vi.mocked(bridge.init).mock.calls[0]?.[0] as { browser?: string }
      expect(host.browser, built).toBe(expected)
    }
  })

  it('names Safari only for the Safari build', () => {
    expect(browserHint('safari')).toEqual({ browser: 'safari' })
    expect(browserHint('chrome')).toEqual({})
    expect(browserHint('firefox')).toEqual({})
    expect(browserHint(undefined)).toEqual({})
  })

  it('compiles from the bytes when the file is not served as WebAssembly', async () => {
    browser({ 'core/core.wasm': 'bytes' })
    const { bridge } = bridgeWith(() => ok(null))
    loader.compileStreaming.mockRejectedValue(new TypeError('Incorrect response MIME type'))
    loader.compile.mockResolvedValue({
      instantiate: async () => ({
        invokeMain: () => {
          ;(globalThis as { kemlockCore?: CoreBridge }).kemlockCore = bridge
        },
      }),
    })
    await loadCore()
    expect(loader.compile).toHaveBeenCalledOnce()
  })

  it('fails when the module does not register itself', async () => {
    browser({})
    delete (globalThis as { kemlockCore?: CoreBridge }).kemlockCore
    loader.compileStreaming.mockResolvedValue({
      instantiate: async () => ({ invokeMain: () => undefined }),
    })
    await expect(loadCore()).rejects.toMatchObject({ name: 'KemlockError', message: 'failed' })
  })
})
