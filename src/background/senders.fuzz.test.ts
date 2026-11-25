// Property-based tests of who a message is from, read from what the browser reports of the sender
// (addresses and origins a page and its frames choose, or other extensions): the readers never
// throw, refuse what is not the extension's own, and agree with the URL standard where they mean to.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { frameAddress, identifySender, originOf, type Identity } from './senders'

const numRuns = 200

const extensionId = fc.stringMatching(/^[a-p]{32}$/)
const scheme = fc.constantFrom('chrome-extension', 'moz-extension')
const pages = [
  ['/src/popup/index.html', 'popup'],
  ['/src/setup/index.html', 'setup'],
  ['/src/menu/index.html', 'menu'],
  ['/src/offscreen/index.html', 'offscreen'],
  ['/src/unlock/index.html', 'unlock'],
  ['/src/sends/index.html', 'sends'],
] as const
const notPages = [
  '/',
  '/src/popup/other.html',
  '/src/popup/index.html/',
  '/SRC/popup/index.html',
  '/src/popup',
  '/__proto__',
  '/constructor',
  '/toString',
]
const suffix = fc.constantFrom('', '?tabId=1', '#menu', '?a=b#c')

/** Addresses of every shape a frame may report, including what is no address at all. */
const anyUrl = fc.oneof(
  fc.webUrl(),
  fc.string({ maxLength: 40 }),
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.string({ maxLength: 20 }).map((rest) => `chrome-extension://${rest}`),
  fc.string({ maxLength: 20 }).map((rest) => `moz-extension://${rest}`),
  fc.string({ maxLength: 20 }).map((rest) => `https://${rest}`),
  fc.constantFrom(
    'about:blank',
    'about:srcdoc',
    'data:text/html,<input>',
    'javascript:0',
    'blob:https://shop.example/0f1e',
    'file:///etc/hosts',
    'chrome://settings',
    '',
  ),
)

const parsed = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}
const asSender = (sender: object) => sender as unknown as chrome.runtime.MessageSender
const identity = (id: string, sch = 'chrome-extension'): Identity => ({
  id,
  origins: [`${sch}://${id}`],
})

describe('originOf', () => {
  it('never throws on an address, and gives a string', () => {
    fc.assert(
      fc.property(anyUrl, (text) => {
        const url = parsed(text)
        if (url === null) return
        expect(typeof originOf(url)).toBe('string')
      }),
      { numRuns },
    )
  })

  it("is the URL standard's origin for a web address", () => {
    fc.assert(
      fc.property(fc.webUrl(), (text) => {
        expect(originOf(new URL(text))).toBe(new URL(text).origin)
      }),
      { numRuns },
    )
  })

  it("is the extension's scheme and host for one of its addresses, whatever follows", () => {
    fc.assert(
      fc.property(
        scheme,
        fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/),
        fc.constantFrom('', '/', '/src/popup/index.html', '/a?b#c', '?q', '#h'),
        (sch, host, rest) => {
          expect(originOf(new URL(`${sch}://${host}${rest}`))).toBe(`${sch}://${host}`)
        },
      ),
      { numRuns },
    )
  })

  it("is the URL standard's origin for whatever else it parses, unless that is opaque", () => {
    fc.assert(
      fc.property(anyUrl, (text) => {
        const url = parsed(text)
        if (
          url === null ||
          url.protocol === 'chrome-extension:' ||
          url.protocol === 'moz-extension:'
        )
          return
        expect(originOf(url)).toBe(url.origin)
      }),
      { numRuns },
    )
  })
})

describe('frameAddress', () => {
  it('never throws, and answers null, the frame address, or the origin it inherits', () => {
    fc.assert(
      fc.property(
        anyUrl,
        fc.oneof(
          fc.constant(null),
          fc.string({ maxLength: 40 }),
          fc.webUrl().map((u) => new URL(u).origin),
        ),
        (url, origin) => {
          const address = frameAddress({ url, origin })
          if (address === null) return
          if (address === url) {
            const web = parsed(url)
            expect(web === null ? '' : web.protocol).toMatch(/^https?:$/)
            return
          }
          expect(origin).not.toBeNull()
          expect(address).toBe(`${origin}/`)
          expect(/^https?:\/\//.test(origin as string)).toBe(true)
        },
      ),
      { numRuns },
    )
  })

  it("is the frame's own address when that is a web address, whatever origin is said", () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.option(fc.string({ maxLength: 30 }), { nil: null }),
        (url, origin) => {
          expect(frameAddress({ url, origin })).toBe(url)
        },
      ),
      { numRuns },
    )
  })

  it('is the web origin an address-less frame inherits, and null for any other', () => {
    const addressless = fc.constantFrom(
      'about:blank',
      'about:srcdoc',
      'data:text/html,<input>',
      'not a url',
      '',
      'chrome-extension://abc/x',
    )
    fc.assert(
      fc.property(addressless, fc.webUrl(), (url, site) => {
        const origin = new URL(site).origin
        expect(frameAddress({ url, origin })).toBe(`${origin}/`)
        expect(new URL(`${origin}/`).origin).toBe(origin)
        expect(frameAddress({ url, origin: null })).toBeNull()
      }),
      { numRuns },
    )
    fc.assert(
      fc.property(
        addressless,
        fc.constantFrom(
          'null',
          'file://',
          'chrome-extension://abc',
          'moz-extension://abc',
          'ftp://x.example',
          '',
        ),
        (url, origin) => {
          expect(frameAddress({ url, origin })).toBeNull()
        },
      ),
      { numRuns },
    )
  })
})

describe('identifySender', () => {
  it('never throws, changes nothing it is given, and says the same twice', () => {
    const self = 'a'.repeat(32)
    const sender = fc.record(
      {
        id: fc.oneof(fc.constant(self), fc.string({ maxLength: 12 })),
        url: fc.oneof(
          anyUrl,
          fc.constantFrom(
            `chrome-extension://${self}/src/popup/index.html`,
            `chrome-extension://${self}/src/menu/index.html?x#y`,
            `chrome-extension://${self}/other`,
          ),
        ),
        origin: fc.oneof(
          fc.constant('null'),
          fc.string({ maxLength: 20 }),
          fc.constant(`chrome-extension://${self}`),
          fc.webUrl().map((u) => new URL(u).origin),
        ),
        tab: fc.record({ id: fc.integer({ min: -1, max: 1000 }) }),
        frameId: fc.integer({ min: 0, max: 1000 }),
        documentId: fc.string({ maxLength: 10 }),
      },
      { requiredKeys: [] },
    )
    fc.assert(
      fc.property(sender, (raw) => {
        const before = structuredClone(raw)
        const found = identifySender(asSender(raw), identity(self))
        expect(raw).toEqual(before)
        expect(identifySender(asSender(raw), identity(self))).toEqual(found)
        if (found === null) return
        if (found.from === 'page') {
          expect(['popup', 'setup', 'menu', 'offscreen', 'unlock']).toContain(found.page)
          expect(raw.id).toBe(self)
          return
        }
        expect(found.url).toBe(raw.url)
        expect(found.tabId).toBe(raw.tab?.id)
        expect(found.frameId).toBe(raw.frameId)
        expect(found.documentId).toBe(raw.documentId)
        expect(found.origin === null || typeof found.origin === 'string').toBe(true)
      }),
      { numRuns },
    )
  })

  it("answers one of the extension's pages by its path, from its own origin", () => {
    fc.assert(
      fc.property(
        extensionId,
        scheme,
        fc.constantFrom(...pages),
        suffix,
        fc.option(fc.nat(1000), { nil: undefined }),
        fc.option(fc.nat(1000), { nil: undefined }),
        fc.boolean(),
        (id, sch, [path, page], rest, tabId, frameId, says) => {
          const origin = `${sch}://${id}`
          const sender = {
            id,
            url: `${origin}${path}${rest}`,
            ...(says ? { origin } : {}),
            ...(tabId === undefined ? {} : { tab: { id: tabId } }),
            frameId,
          }
          expect(identifySender(asSender(sender), identity(id, sch))).toEqual({
            from: 'page',
            page,
            tabId,
            frameId,
          })
        },
      ),
      { numRuns },
    )
  })

  it("refuses the extension's address when the browser says another origin, or the path is no page", () => {
    fc.assert(
      fc.property(
        extensionId,
        scheme,
        fc.constantFrom(...pages),
        fc.constantFrom(...notPages),
        fc.string({ maxLength: 30 }),
        (id, sch, [path], other, said) => {
          const origin = `${sch}://${id}`
          const self = identity(id, sch)
          if (said !== origin) {
            const sender = { id, url: `${origin}${path}`, origin: said }
            expect(identifySender(asSender(sender), self)).toBeNull()
          }
          expect(identifySender(asSender({ id, url: `${origin}${other}` }), self)).toBeNull()
        },
      ),
      { numRuns },
    )
  })

  it("refuses a sender that is not this extension, whatever it says, and another extension's pages", () => {
    fc.assert(
      fc.property(
        extensionId,
        extensionId,
        scheme,
        fc.constantFrom(...pages),
        fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
        anyUrl,
        (id, other, sch, [path], origin, url) => {
          fc.pre(id !== other)
          const self = identity(id, sch)
          const tab = { id: 1 }
          const sender = { id: other, url: `${sch}://${id}${path}`, origin, tab, frameId: 0 }
          expect(identifySender(asSender(sender), self)).toBeNull()
          expect(identifySender(asSender({ ...sender, id: undefined }), self)).toBeNull()
          expect(identifySender(asSender({ ...sender, id, url: undefined }), self)).toBeNull()
          expect(
            identifySender(
              asSender({ id, url: `${sch}://${other}${path}`, tab, frameId: 0 }),
              self,
            ),
          ).toBeNull()
          // Whatever address it says, a sender of another id is refused
          expect(identifySender(asSender({ id: other, url, tab, frameId: 0 }), self)).toBeNull()
        },
      ),
      { numRuns },
    )
  })

  it('answers a content script in a web frame by what the browser reports', () => {
    fc.assert(
      fc.property(
        extensionId,
        fc.webUrl(),
        fc.nat(1000),
        fc.nat(1000),
        fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
        fc.oneof(
          fc.constant(undefined),
          fc.constant('null'),
          fc.string({ minLength: 1, maxLength: 30 }),
        ),
        (id, url, tabId, frameId, documentId, said) => {
          const sender = { id, url, tab: { id: tabId }, frameId, documentId, origin: said }
          const found = identifySender(asSender(sender), identity(id))
          expect(found).toEqual({
            from: 'content',
            tabId,
            frameId,
            documentId,
            url,
            origin: said === undefined ? new URL(url).origin : said === 'null' ? null : said,
          })
          // A web frame is matched by its own address
          expect(found?.from === 'content' ? frameAddress(found) : null).toBe(url)
        },
      ),
      { numRuns },
    )
  })

  it('refuses a content script that has no tab or no frame', () => {
    fc.assert(
      fc.property(extensionId, fc.webUrl(), fc.nat(1000), (id, url, number) => {
        const self = identity(id)
        expect(identifySender(asSender({ id, url, frameId: number }), self)).toBeNull()
        expect(identifySender(asSender({ id, url, tab: {}, frameId: number }), self)).toBeNull()
        expect(identifySender(asSender({ id, url, tab: { id: number } }), self)).toBeNull()
      }),
      { numRuns },
    )
  })

  it('gives a frame with no web address no origin of its own, unless the browser says one', () => {
    fc.assert(
      fc.property(
        extensionId,
        fc.constantFrom(
          'about:blank',
          'about:srcdoc',
          'data:text/html,<input>',
          'file:///etc/hosts',
        ),
        fc.nat(1000),
        (id, url, tabId) => {
          const base = { id, url, tab: { id: tabId }, frameId: 0 }
          const found = identifySender(asSender(base), identity(id))
          expect(found).toMatchObject({ from: 'content', url, origin: null })
          const told = identifySender(
            asSender({ ...base, origin: 'https://shop.example' }),
            identity(id),
          )
          expect(told).toMatchObject({ from: 'content', origin: 'https://shop.example' })
        },
      ),
      { numRuns },
    )
  })
})
