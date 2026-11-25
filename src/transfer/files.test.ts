// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { download, modulesPath, toBase64 } from './files'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('toBase64', () => {
  it('is the bytes as base64, for a small file and for one larger than a call can take', () => {
    expect(toBase64(new Uint8Array([72, 105, 33]))).toBe('SGkh')
    expect(toBase64(new Uint8Array())).toBe('')
    const large = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7 + 3) & 0xff)
    const back = Uint8Array.from(atob(toBase64(large)), (c) => c.charCodeAt(0))
    expect(back).toEqual(large)
  })
})

describe('modulesPath', () => {
  it('draws each run of dark modules as one rectangle, inside the quiet zone', () => {
    // 1 0
    // 1 1
    expect(modulesPath(2, '1011', 0)).toBe('M0 0h1v1h-1zM0 1h2v1h-2z')
    expect(modulesPath(2, '1011', 4)).toBe('M4 4h1v1h-1zM4 5h2v1h-2z')
  })

  it('is empty for a code with no dark module', () => {
    expect(modulesPath(3, '000000000')).toBe('')
  })
})

describe('download', () => {
  function setUp() {
    const created: Blob[] = []
    const revoked: string[] = []
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: (blob: Blob) => {
          created.push(blob)
          return `blob:kemlock/${created.length}`
        },
        revokeObjectURL: (url: string) => revoked.push(url),
      }),
    )
    const links: { href: string; name: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      links.push({ href: this.href, name: this.download })
    })
    return { created, revoked, links }
  }

  it('hands the text to the browser as a file of that name, through a Blob address', async () => {
    const { created, links } = setUp()

    const saved = download('kemlock-export.json', 'application/json', '{"a":1}')

    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('application/json')
    expect(await created[0]!.text()).toBe('{"a":1}')
    expect(links).toEqual([{ href: 'blob:kemlock/1', name: 'kemlock-export.json' }])
    // No link is left in the page
    expect(document.querySelector('a[download]')).toBeNull()
    saved.revoke()
  })

  it('saves again while the address lives, and forgets it after a minute', () => {
    vi.useFakeTimers()
    const { revoked, links } = setUp()

    const saved = download('a.csv', 'text/csv', 'x')
    saved.again()
    expect(links).toHaveLength(2)

    vi.advanceTimersByTime(59_000)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(2_000)
    expect(revoked).toEqual(['blob:kemlock/1'])
    saved.again()
    expect(links).toHaveLength(2)
  })

  it('forgets the address at once when told to, and only once', () => {
    const { revoked } = setUp()

    const saved = download('a.csv', 'text/csv', 'x')
    saved.revoke()
    saved.revoke()

    expect(revoked).toEqual(['blob:kemlock/1'])
  })
})
