// Property-based tests of the origin the menu's frame is handed its port at (`postMessage`'s target
// origin): it is the address's scheme and host, and the same as the background reads for the
// extension's own pages.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { originOf } from '../background/senders'
import { originOfUrl } from './frame'

const numRuns = 200

const parsed = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const extensionUrl = fc
  .tuple(
    fc.constantFrom('chrome-extension', 'moz-extension'),
    fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,30}$/),
    fc.constantFrom('', '/', '/src/menu/index.html', '/src/menu/index.html?x=1', '/a#b'),
  )
  .map(([scheme, host, rest]) => ({ scheme, host, url: `${scheme}://${host}${rest}` }))

describe('originOfUrl', () => {
  it('gives a string, or throws the TypeError of an address that does not parse, for any text', () => {
    for (const unit of ['grapheme-ascii', 'binary'] as const) {
      fc.assert(
        fc.property(fc.string({ unit, maxLength: 60 }), (text) => {
          const url = parsed(text)
          if (url === null) {
            expect(() => originOfUrl(text)).toThrow(TypeError)
            return
          }
          const origin = originOfUrl(text)
          expect(typeof origin).toBe('string')
          expect(origin.startsWith(`${url.protocol}//`)).toBe(true)
        }),
        { numRuns },
      )
    }
  })

  it("is the URL standard's origin for a web address", () => {
    fc.assert(
      fc.property(fc.webUrl(), (text) => {
        expect(originOfUrl(text)).toBe(new URL(text).origin)
      }),
      { numRuns },
    )
  })

  it("is the extension's scheme and host for one of its addresses, whatever follows", () => {
    fc.assert(
      fc.property(extensionUrl, ({ scheme, host, url }) => {
        expect(originOfUrl(url)).toBe(`${scheme}://${host}`)
      }),
      { numRuns },
    )
  })

  it('is the origin the background reads for an address, for web and extension addresses', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.webUrl(),
          extensionUrl.map(({ url }) => url),
        ),
        (text) => {
          expect(originOfUrl(text)).toBe(originOf(new URL(text)))
        },
      ),
      { numRuns },
    )
  })

  it('leaves out a path, a query, a fragment and the credentials', () => {
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: true, withFragments: true }), (text) => {
        const origin = originOfUrl(text)
        expect(origin).not.toMatch(/[?#@]/)
        expect(origin.endsWith('/')).toBe(false)
      }),
      { numRuns },
    )
  })
})
