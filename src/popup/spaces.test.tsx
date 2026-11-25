// @vitest-environment jsdom
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { LoginView } from '../shared/api'
import type { SpaceContactView, SpaceRow, SpaceView, SpacesView } from '../shared/spaces-api'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  click,
  installChrome,
  login,
  mount,
  text,
  unlockedHandlers,
  unmountAll,
  type World,
} from './testing'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('./testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

const openPopup = () => mount(h(ToastProvider, null, h(App, null)))

const digits = '12345 67890 11111 22222 33333 44444 55555 66666 77777 88888 99999 00000'

const row = (over: Partial<SpaceRow> = {}): SpaceRow => ({
  id: 's1',
  kind: 'server',
  name: 'Example Co',
  status: 'admin',
  compared: true,
  role: 'admin',
  members: 4,
  items: 3,
  ...over,
})

const listing = (rows: SpaceRow[], over: Partial<SpacesView> = {}): SpacesView => ({
  available: true,
  server: rows,
  webdav: [],
  ...over,
})

const spaceView = (over: Partial<SpaceView> = {}): SpaceView => ({
  id: 's1',
  name: 'Example Co',
  status: 'admin',
  compared: true,
  role: 'admin',
  memberStatus: 'confirmed',
  members: [
    {
      id: 'u1',
      name: 'Sam',
      role: 'admin',
      status: 'confirmed',
      you: true,
      canRemove: false,
      roles: [],
      canConfirm: false,
      canResend: false,
    },
    {
      id: 'u2',
      name: 'Theo',
      role: 'member',
      status: 'accepted',
      you: false,
      canRemove: true,
      roles: [],
      canConfirm: true,
      canResend: false,
      digits,
    },
  ],
  collections: [],
  items: [
    { id: 'l1', kind: 'login', name: 'Orbit', canEdit: true },
    { id: 'n1', kind: 'note', name: 'Wi-Fi', canEdit: false },
  ],
  policies: { flags: [] },
  accountRecovery: false,
  keys: { spaceKeyVersion: 1, needReplacing: false },
  canInvite: true,
  canLeave: true,
  onlyOwner: false,
  ...over,
})

const world = (over: Partial<World> = {}): World => ({ codes: [], logins: [], ...over })

/** Opens the spaces' list from Home's card. */
async function openList(root: HTMLElement): Promise<void> {
  await click(root.querySelector('.spaces-card'))
}

beforeEach(() => {
  installChrome()
})

afterEach(() => {
  unmountAll()
  background.reset()
})

describe('the spaces list', () => {
  it('says on Home what waits for the person, and lists each space with its role and counts', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () =>
        listing([
          row(),
          row({ id: 's2', name: 'Studio', status: 'invited', compared: false, role: undefined }),
        ]),
    })
    const root = await openPopup()
    expect(text(root.querySelector('.spaces-card')!)).toContain('2 spaces · 1 need you')
    await openList(root)
    expect(text(root)).toContain('Example Co')
    expect(text(root)).toContain('Admin · 4 members · 3 items')
    expect(text(root)).toContain('Invited')
  })

  it('shows no card for a vault with no space and no Kemlock Server', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () => ({ available: false, server: [], webdav: [] }) satisfies SpacesView,
    })
    const root = await openPopup()
    expect(root.querySelector('.spaces-card')).toBeNull()
  })

  it('shows the problem the last run of a space met, in the app’s words', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () => listing([row({ status: 'cantBeChecked', problem: 'spaceCantBeChecked' })]),
    })
    const root = await openPopup()
    await openList(root)
    expect(text(root)).toContain('Can’t be checked')
  })
})

describe('first contact', () => {
  const contact = (over: Partial<SpaceContactView> = {}): SpaceContactView => ({
    id: 's2',
    name: 'Studio',
    kind: 'compare',
    invited: true,
    person: 'u9',
    personName: 'Ana',
    digits,
    bundleSigned: true,
    candidates: [],
    ownKeyMismatch: false,
    members: 3,
    accountRecovery: false,
    ...over,
  })
  const invited = row({
    id: 's2',
    name: 'Studio',
    status: 'invited',
    compared: false,
    role: undefined,
  })

  it('stores nothing until the digits match, and accepts only after', async () => {
    const trust = vi.fn()
    const answer = vi.fn()
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () => listing([invited]),
      spaceContact: () => contact(),
      spaceTrust: trust as never,
      spaceAnswer: answer as never,
    })
    const root = await openPopup()
    await openList(root)
    await click(root.querySelector('.item-main'))
    expect(text(root)).toContain('12345')
    expect(trust).not.toHaveBeenCalled()
    expect(button(root, 'Accept')?.disabled).toBe(true)
    await click(button(root, 'It matches'))
    expect(trust).toHaveBeenCalledWith({ id: 's2', digits })
    expect(button(root, 'Accept')?.disabled).toBe(false)
    await click(button(root, 'Accept'))
    expect(answer).toHaveBeenCalledWith({ id: 's2', accept: true })
  })

  it('stores nothing when the digits differ', async () => {
    const trust = vi.fn()
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () => listing([invited]),
      spaceContact: () => contact(),
      spaceTrust: trust as never,
    })
    const root = await openPopup()
    await openList(root)
    await click([...root.querySelectorAll<HTMLElement>('.item-main')][0] ?? null)
    await click(button(root, 'Not now'))
    expect(trust).not.toHaveBeenCalled()
    expect(text(root)).toContain('Nothing was stored')
  })

  it('refuses a space the chain records another key of this account for', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () => listing([invited]),
      spaceContact: () => contact({ ownKeyMismatch: true }),
    })
    const root = await openPopup()
    await openList(root)
    await click([...root.querySelectorAll<HTMLElement>('.item-main')][0] ?? null)
    expect(text(root)).toContain('another key for your account')
    expect(button(root, 'It matches')).toBeNull()
  })
})

describe('a space’s page', () => {
  const open = async (view: SpaceView, extra: Parameters<typeof background.set>[0] = {}) => {
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () => listing([row()]),
      space: () => view,
      ...extra,
    })
    const root = await openPopup()
    await openList(root)
    await click([...root.querySelectorAll<HTMLElement>('.item-main')][0] ?? null)
    return root
  }

  it('lists the items by kind, and marks the ones the person may only view', async () => {
    const root = await open(spaceView())
    expect(text(root)).toContain('Logins')
    expect(text(root)).toContain('Orbit')
    expect(text(root)).toContain('Notes')
    expect(text(root)).toContain('Wi-Fi')
    expect(text(root)).toContain('View only')
  })

  it('confirms a member only over the digits that were compared', async () => {
    const confirm = vi.fn()
    const root = await open(spaceView(), { spaceConfirm: confirm as never })
    await click(button(root, 'Confirm'))
    expect(text(root)).toContain('12345')
    expect(confirm).not.toHaveBeenCalled()
    await click(button(root, 'It matches'))
    expect(confirm).toHaveBeenCalledWith({ id: 's1', member: 'u2', digits })
  })

  it('offers no action the chain doesn’t allow', async () => {
    const root = await open(
      spaceView({
        role: 'member',
        canInvite: false,
        members: [
          {
            id: 'u2',
            name: 'Theo',
            role: 'member',
            status: 'accepted',
            you: false,
            canRemove: false,
            roles: [],
            canConfirm: false,
            canResend: false,
          },
        ],
      }),
    )
    expect(button(root, 'Invite')).toBeNull()
    expect(button(root, 'Confirm')).toBeNull()
    expect(button(root, 'Remove')).toBeNull()
    expect(button(root, 'Revoke')).toBeNull()
  })

  it('shows what the chain’s check found instead of the space', async () => {
    background.reset({
      ...unlockedHandlers(world()),
      spaces: () => listing([row()]),
      space: () => {
        throw new Error('space_sync_cantBeChecked')
      },
    })
    const root = await openPopup()
    await openList(root)
    await click([...root.querySelectorAll<HTMLElement>('.item-main')][0] ?? null)
    expect(text(root)).toContain('can’t be checked')
    expect(root.querySelector('.member-row')).toBeNull()
  })

  it('leaves after a question, and says when the keys need replacing', async () => {
    const leave = vi.fn()
    const root = await open(spaceView({ keys: { spaceKeyVersion: 2, needReplacing: true } }), {
      spaceLeave: leave as never,
    })
    expect(text(root)).toContain('Keys need replacing')
    await click(button(root, 'Leave the space'))
    expect(leave).not.toHaveBeenCalled()
    await click([...root.querySelectorAll<HTMLButtonElement>('.confirm .btn.danger')][0] ?? null)
    expect(leave).toHaveBeenCalledWith({ id: 's1' })
  })
})

describe('items of a space', () => {
  const hidden: LoginView = login({
    id: 'l1',
    space: { id: 's1', name: 'Example Co', canEdit: true, passwordHidden: true },
  })
  const viewOnly: LoginView = login({
    id: 'l2',
    name: 'Docs',
    space: { id: 's1', name: 'Example Co', canEdit: false },
  })

  it('wears the space’s name in the list', async () => {
    background.reset(unlockedHandlers(world({ logins: [hidden] })))
    const root = await openPopup()
    await click(button(root, 'Logins 1'))
    expect(text(root)).toContain('Example Co')
  })

  it('hides a password a grant hides: no Show and no Copy', async () => {
    background.reset(unlockedHandlers(world({ logins: [hidden] })))
    const root = await openPopup()
    await click(button(root, 'Logins 1'))
    await click(button(root, 'Open Orbit Cloud'))
    expect(text(root)).toContain('hidden by this space')
    expect(root.querySelector('[aria-label^="Show the password"]')).toBeNull()
    expect(button(root, 'Copy the password of Orbit Cloud')).toBeNull()
  })

  it('offers no Edit or Delete on a login the person may only view', async () => {
    background.reset(unlockedHandlers(world({ logins: [viewOnly] })))
    const root = await openPopup()
    await click(button(root, 'Logins 1'))
    await click(button(root, 'Open Docs'))
    expect(button(root, 'Edit')).toBeNull()
    expect(button(root, 'Delete login')).toBeNull()
  })
})
