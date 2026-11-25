import { describe, expect, it, vi, type Mock } from 'vitest'
import type { CoreApi } from '../shared/api'
import { BackgroundError } from './errors'
import { route } from './router'
import type { ExtensionPage, Identity, PageSender } from './senders'
import { refuseHidden, spacePageHandlers, type SpaceSteps } from './spaces'

const self: Identity = { id: 'kemlockid', origins: ['chrome-extension://kemlockid'] }

const fromPage = (path: string): chrome.runtime.MessageSender => ({
  id: 'kemlockid',
  url: `chrome-extension://kemlockid${path}`,
  origin: 'chrome-extension://kemlockid',
})

const popup = fromPage('/src/popup/index.html')
const menu = fromPage('/src/menu/index.html')
const site: chrome.runtime.MessageSender = {
  id: 'kemlockid',
  url: 'https://evil.example/login',
  origin: 'https://evil.example',
  tab: { id: 7 } as chrome.tabs.Tab,
  frameId: 0,
}

/** The steps the background gives its handlers, over the same rule: only the popup and the setup tab, the vault open. */
function steps(
  over: Partial<SpaceSteps> = {},
): SpaceSteps & { changed: Mock<() => Promise<undefined>> } {
  const changed = vi.fn(async () => undefined)
  return {
    check: (sender: PageSender, allowed: readonly ExtensionPage[]) => {
      if (!allowed.includes(sender.page)) throw new BackgroundError('refused')
    },
    needOpen: async () => undefined,
    touch: async () => undefined,
    changed,
    ...over,
  } as SpaceSteps & { changed: Mock<() => Promise<undefined>> }
}

const coreWith = (over: Partial<CoreApi>): CoreApi => over as CoreApi

function handlersOf(core: CoreApi, shared = steps()) {
  return { content: {}, page: spacePageHandlers({ core }, shared) }
}

describe('the spaces’ requests', () => {
  it('are answered by the core for the popup, and a change makes a sync follow', async () => {
    const spaceMake = vi.fn(async () => ({ id: 's1' }))
    const shared = steps()
    const answer = await route(
      { kind: 'spaceMake', name: 'Example Co' },
      popup,
      self,
      handlersOf(coreWith({ spaceMake }), shared),
    )
    expect(answer).toEqual({ ok: true, value: { id: 's1' } })
    expect(spaceMake).toHaveBeenCalledWith('Example Co')
    expect(shared.changed).toHaveBeenCalledTimes(1)
  })

  it('make no sync for a read', async () => {
    const spaces = vi.fn(async () => ({ available: true, server: [], webdav: [] }))
    const shared = steps()
    const answer = await route(
      { kind: 'spaces', refresh: false },
      popup,
      self,
      handlersOf(coreWith({ spaces }), shared),
    )
    expect(answer.ok).toBe(true)
    expect(spaces).toHaveBeenCalledWith(false)
    expect(shared.changed).not.toHaveBeenCalled()
  })

  it('are refused to the in-page menu and to a page of a site', async () => {
    const spaceLeave = vi.fn(async () => undefined)
    const handlers = handlersOf(coreWith({ spaceLeave }))
    expect(await route({ kind: 'spaceLeave', id: 's1' }, menu, self, handlers)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(await route({ kind: 'spaceLeave', id: 's1' }, site, self, handlers)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(spaceLeave).not.toHaveBeenCalled()
  })

  it('are answered unsupported by a core without spaces', async () => {
    const answer = await route({ kind: 'space', id: 's1' }, popup, self, handlersOf(coreWith({})))
    expect(answer).toEqual({ ok: false, error: 'unsupported' })
  })

  it('are cut down to known fields, and a role or permission the chain doesn’t have is malformed', async () => {
    const spaceInvite = vi.fn(async () => undefined)
    const handlers = handlersOf(coreWith({ spaceInvite }))
    const ok = await route(
      { kind: 'spaceInvite', id: 's1', email: 'ana@example.com', role: 'admin', extra: 'dropped' },
      popup,
      self,
      handlers,
    )
    expect(ok.ok).toBe(true)
    expect(spaceInvite).toHaveBeenCalledWith('s1', 'ana@example.com', 'admin')
    for (const bad of [
      { kind: 'spaceInvite', id: 's1', email: 'ana@example.com', role: 'custom' },
      { kind: 'spaceGrant', id: 's1', collection: 'c1', member: 'u1', permission: 'owner' },
      { kind: 'moveItem', id: 'l1', space: 's1' },
      { kind: 'spaceConfirm', id: 's1', member: 'u1' },
    ]) {
      expect(await route(bad, popup, self, handlers)).toEqual({ ok: false, error: 'malformed' })
    }
  })

  it('send a grant, a move and a confirmation to the core with exactly what was asked', async () => {
    const spaceGrant = vi.fn(async () => undefined)
    const moveItem = vi.fn(async () => undefined)
    const spaceConfirm = vi.fn(async () => undefined)
    const handlers = handlersOf(coreWith({ spaceGrant, moveItem, spaceConfirm }))
    await route(
      {
        kind: 'spaceGrant',
        id: 's1',
        collection: 'c1',
        member: 'u1',
        permission: 'view-hide-passwords',
      },
      popup,
      self,
      handlers,
    )
    await route(
      { kind: 'spaceGrant', id: 's1', collection: 'c1', member: 'u1', permission: null },
      popup,
      self,
      handlers,
    )
    await route(
      { kind: 'moveItem', itemKind: 'login', id: 'l1', space: 's1', collection: 'c1' },
      popup,
      self,
      handlers,
    )
    await route({ kind: 'moveItem', id: 'l1', space: null }, popup, self, handlers)
    await route(
      { kind: 'spaceConfirm', id: 's1', member: 'u1', digits: '12345 67890' },
      popup,
      self,
      handlers,
    )
    expect(spaceGrant).toHaveBeenNthCalledWith(1, 's1', 'c1', 'u1', 'view-hide-passwords')
    expect(spaceGrant).toHaveBeenNthCalledWith(2, 's1', 'c1', 'u1', null)
    expect(spaceConfirm).toHaveBeenCalledWith('s1', 'u1', '12345 67890')
    // A move names the kind of its entry: the one without it never got to the core
    expect(moveItem).toHaveBeenCalledTimes(1)
    expect(moveItem).toHaveBeenCalledWith('login', 'l1', 's1', 'c1')
  })
})

describe('a password a grant hides', () => {
  it('is refused to Show and Copy, and any other login goes on', async () => {
    const core = coreWith({ hiddenLoginIds: async () => ['l1'] })
    await expect(refuseHidden(core, 'l1')).rejects.toMatchObject({ code: 'refused' })
    await expect(refuseHidden(core, 'l2')).resolves.toBeUndefined()
  })

  it('is no business of a core that has no spaces', async () => {
    await expect(refuseHidden(coreWith({}), 'l1')).resolves.toBeUndefined()
  })
})
