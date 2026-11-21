import { describe, expect, it, vi } from 'vitest'
import { route, type Handlers } from './router'
import type { Identity } from './senders'

const self: Identity = { id: 'kemlockid', origins: ['chrome-extension://kemlockid'] }

const tab = (id: number) => ({ id }) as chrome.tabs.Tab

/** A content script in frame 3 of tab 7, on evil.example. */
const evilFrame: chrome.runtime.MessageSender = {
  id: 'kemlockid',
  url: 'https://evil.example/login',
  origin: 'https://evil.example',
  tab: tab(7),
  frameId: 3,
  documentId: 'doc-1',
}

const page = (path: string, extra: Partial<chrome.runtime.MessageSender> = {}) => ({
  id: 'kemlockid',
  url: `chrome-extension://kemlockid${path}`,
  origin: 'chrome-extension://kemlockid',
  ...extra,
})

function handlers(): Handlers {
  return {
    content: {
      suggestions: vi.fn((message, sender) => ({ message, sender })),
      fields: vi.fn((message, sender) => ({ message, sender })),
    },
    page: {
      state: vi.fn((message, sender) => ({ message, sender })),
      unlock: vi.fn(() => 'unlocked'),
    },
  }
}

describe('a content script', () => {
  it('is answered for its own frame, whatever site its message names', async () => {
    const h = handlers()
    const answer = await route(
      { kind: 'suggestions', origin: 'https://bank.example', url: 'https://bank.example/' },
      evilFrame,
      self,
      h,
    )
    expect(answer).toEqual({
      ok: true,
      value: {
        message: { kind: 'suggestions' },
        sender: {
          from: 'content',
          tabId: 7,
          frameId: 3,
          documentId: 'doc-1',
          url: 'https://evil.example/login',
          origin: 'https://evil.example',
        },
      },
    })
  })

  it('reports fields with only the fields it may name', async () => {
    const answer = await route(
      {
        kind: 'fields',
        frameId: 0,
        fields: [{ id: 'f1', kind: 'code', boxes: 6, origin: 'https://bank.example' }],
      },
      evilFrame,
      self,
      handlers(),
    )
    expect(answer).toMatchObject({
      ok: true,
      value: {
        message: { kind: 'fields', fields: [{ id: 'f1', kind: 'code', boxes: 6 }] },
        sender: { frameId: 3, origin: 'https://evil.example' },
      },
    })
    expect(Object.keys((answer as { value: { message: object } }).value.message)).toEqual([
      'kind',
      'fields',
    ])
  })

  it('takes the origin Chrome reports for an about:blank frame', async () => {
    const answer = await route(
      { kind: 'suggestions' },
      { ...evilFrame, url: 'about:blank', origin: 'https://shop.example' },
      self,
      handlers(),
    )
    expect(answer).toMatchObject({
      ok: true,
      value: { sender: { origin: 'https://shop.example' } },
    })
  })

  it('has no origin to match where the browser gives none', async () => {
    for (const sender of [
      { ...evilFrame, url: 'about:blank', origin: undefined },
      { ...evilFrame, url: 'https://sandboxed.example/', origin: 'null' },
      { ...evilFrame, url: 'data:text/html,<input>', origin: undefined },
    ]) {
      const answer = await route({ kind: 'suggestions' }, sender, self, handlers())
      expect(answer).toMatchObject({ ok: true, value: { sender: { origin: null } } })
    }
  })

  it("takes a web address's origin where Firefox reports none", async () => {
    const answer = await route(
      { kind: 'suggestions' },
      { ...evilFrame, origin: undefined, url: 'https://accounts.orbit-cloud.com/sign-in' },
      self,
      handlers(),
    )
    expect(answer).toMatchObject({
      ok: true,
      value: { sender: { origin: 'https://accounts.orbit-cloud.com' } },
    })
  })
})

describe("a message from a page that isn't the extension's", () => {
  it('is refused when a content script sends what only pages may', async () => {
    const h = handlers()
    expect(await route({ kind: 'unlock', password: 'pw' }, evilFrame, self, h)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(await route({ kind: 'state' }, evilFrame, self, h)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(h.page.unlock).not.toHaveBeenCalled()
    expect(h.page.state).not.toHaveBeenCalled()
  })

  it('is refused from another extension', async () => {
    const h = handlers()
    for (const sender of [
      { ...evilFrame, id: 'otherid' },
      page('/src/popup/index.html', { id: 'otherid' }),
    ]) {
      expect(await route({ kind: 'state' }, sender, self, h)).toEqual({
        ok: false,
        error: 'refused',
      })
      expect(await route({ kind: 'suggestions' }, sender, self, h)).toEqual({
        ok: false,
        error: 'refused',
      })
    }
    expect(h.page.state).not.toHaveBeenCalled()
    expect(h.content.suggestions).not.toHaveBeenCalled()
  })

  it("is refused from another extension's page, or from no frame", async () => {
    const h = handlers()
    const senders: chrome.runtime.MessageSender[] = [
      {
        id: 'kemlockid',
        url: 'chrome-extension://otherid/popup.html',
        origin: 'chrome-extension://otherid',
      },
      { id: 'kemlockid', url: 'https://evil.example/', origin: 'https://evil.example' },
      { id: 'kemlockid', origin: 'https://evil.example', tab: tab(7), frameId: 0 },
    ]
    for (const sender of senders) {
      expect(await route({ kind: 'suggestions' }, sender, self, h)).toEqual({
        ok: false,
        error: 'refused',
      })
    }
    expect(h.content.suggestions).not.toHaveBeenCalled()
  })
})

describe('extension pages', () => {
  it('are recognised by their origin and page', async () => {
    const answer = await route({ kind: 'state' }, page('/src/popup/index.html'), self, handlers())
    expect(answer).toEqual({
      ok: true,
      value: {
        message: { kind: 'state' },
        sender: { from: 'page', page: 'popup', tabId: undefined, frameId: undefined },
      },
    })
  })

  it('include the menu frame inside a web page, with its tab', async () => {
    const answer = await route(
      { kind: 'state' },
      page('/src/menu/index.html', { tab: tab(7), frameId: 4 }),
      self,
      handlers(),
    )
    expect(answer).toMatchObject({
      ok: true,
      value: { sender: { from: 'page', page: 'menu', tabId: 7, frameId: 4 } },
    })
  })

  it("are recognised in Firefox by their address's origin", async () => {
    const firefox: Identity = { id: 'kemlock@arsslensoft.com', origins: ['moz-extension://1b2c3d'] }
    const answer = await route(
      { kind: 'state' },
      { id: 'kemlock@arsslensoft.com', url: 'moz-extension://1b2c3d/src/setup/index.html' },
      firefox,
      handlers(),
    )
    expect(answer).toMatchObject({ ok: true, value: { sender: { from: 'page', page: 'setup' } } })
  })

  it("aren't a page the extension doesn't build", async () => {
    const h = handlers()
    expect(await route({ kind: 'state' }, page('/evil.html'), self, h)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(h.page.state).not.toHaveBeenCalled()
  })

  it("aren't one whose reported origin isn't its address's", async () => {
    const sender = page('/src/popup/index.html', { origin: 'https://evil.example' })
    expect(await route({ kind: 'state' }, sender, self, handlers())).toEqual({
      ok: false,
      error: 'refused',
    })
  })

  it("may not send a content script's messages", async () => {
    expect(
      await route({ kind: 'suggestions' }, page('/src/popup/index.html'), self, handlers()),
    ).toEqual({ ok: false, error: 'refused' })
  })
})

describe('answers', () => {
  it('say a message is malformed, unsupported or failed', async () => {
    const h = handlers()
    h.page.unlock = () => {
      throw new Error('wrong password')
    }
    const popup = page('/src/popup/index.html')
    expect(await route({ kind: 'nope' }, popup, self, h)).toEqual({ ok: false, error: 'malformed' })
    expect(await route('state', popup, self, h)).toEqual({ ok: false, error: 'malformed' })
    expect(await route({ kind: 'lock' }, popup, self, h)).toEqual({
      ok: false,
      error: 'unsupported',
    })
    expect(await route({ kind: 'unlock', password: 'pw' }, popup, self, h)).toEqual({
      ok: false,
      error: 'failed',
    })
  })
})
