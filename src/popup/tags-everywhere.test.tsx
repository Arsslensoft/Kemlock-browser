// @vitest-environment jsdom
// Tags on every kind the core tags: the tag editor on the pages of notes, cards, identities and passkeys, the tag filter and the tags page
// over all of them, and the tag button only where tagging works.
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from './send'
import type { PasskeyView } from '../shared/passkeys'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'
import {
  background,
  button,
  card,
  change,
  click,
  identity,
  input,
  installChrome,
  message,
  mount,
  note,
  unlockedHandlers,
  unmountAll,
  type World,
} from './testing'
import { taggableKind } from './tools/tag-kinds'

vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('./testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

const openPopup = () => mount(h(ToastProvider, null, h(App, null)))
const t = (name: string, ...subs: string[]) => message('en', name, subs)

const wifi = note({ id: 'n1', title: 'Wi-Fi', tags: ['Home'] })
const visa = card({ id: 'k1', tags: ['Money'] })
const me = identity({ id: 'i1', tags: ['Family'] })
const made = Date.parse('2026-10-01T12:00:00Z')
const passkey = (over: Partial<PasskeyView> = {}): PasskeyView => ({
  id: 'p1',
  credentialId: 'AAECAwQFBgcICQoLDA0ODw',
  rpId: 'orbit-cloud.com',
  rpName: 'Orbit Cloud',
  userName: 'sam@example.com',
  name: 'Orbit Cloud',
  createdAt: made,
  changedAt: made,
  order: 0,
  ...over,
})
const travel = passkey({ id: 'p1', tags: ['Travel'] })
const plain = passkey({
  id: 'p2',
  rpId: 'harbornotes.app',
  rpName: undefined,
  name: 'harbornotes.app',
  userName: 'kim@harbor.test',
  order: 1,
})

const world = (over: Partial<World> = {}): World => ({
  codes: [],
  logins: [],
  notes: [wifi],
  cards: [visa],
  identities: [me],
  ...over,
})

const handlers = (over: Parameters<typeof background.reset>[0] = {}, w: Partial<World> = {}) => ({
  ...unlockedHandlers(world(w)),
  passkeys: (() => [travel, plain]) as never,
  setTags: ((args: { tags: string[] }) => args.tags) as never,
  revealNote: (() => ({ ...wifi, text: 'text', attachments: [] })) as never,
  ...over,
})

beforeEach(() => {
  installChrome()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

describe('which lists have a tag button', () => {
  it('names the kind the core tags for each of Home’s lists, and nothing for another', () => {
    expect(
      ['codes', 'logins', 'passkeys', 'notes', 'cards', 'identities', 'files'].map(taggableKind),
    ).toEqual(['code', 'login', 'passkey', 'note', 'card', 'identity', 'file'])
    expect(taggableKind('sends')).toBeUndefined()
  })

  it('shows the tag button on each of Home’s tabs', async () => {
    background.reset(handlers())
    const root = await openPopup()
    for (const tab of [
      'MFA codes 0',
      'Logins 0',
      'Passkeys 2',
      'Notes 1',
      'Cards 1',
      'Identities 1',
    ]) {
      await click(button(root, tab))
      expect(button(root, t('tools_tagsTitle')), tab).not.toBeNull()
    }
  })
})

describe('the tag filter on Home', () => {
  it('offers the tags of passkeys and keeps only the passkeys that hold the one chosen', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Passkeys 2'))
    expect(root.textContent).toContain('harbornotes.app')
    expect(root.textContent).toContain('Orbit Cloud')
    await click(button(root, 'Travel'))
    expect(root.textContent).toContain('Orbit Cloud')
    expect(root.textContent).not.toContain('harbornotes.app')
  })

  it('keeps the notes, cards and identities that hold the tag chosen', async () => {
    background.reset(handlers({}, { notes: [wifi, note({ id: 'n2', title: 'Other', order: 1 })] }))
    const root = await openPopup()
    await click(button(root, 'Notes 2'))
    await click(button(root, 'Home'))
    expect(root.textContent).toContain('Wi-Fi')
    expect(root.textContent).not.toContain('Other')
  })
})

describe('the tag editor on an item’s page', () => {
  const addTag = async (root: HTMLElement, tag: string) => {
    await change(input(root, t('tools_tags')), `${tag},`)
  }

  it('is on a note’s page, and saves a tag as one of a note', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Notes 1'))
    await click(button(root, 'Open Wi-Fi'))
    expect(root.textContent).toContain('Home')
    await addTag(root, 'Work')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'note',
      id: 'n1',
      tags: ['Home', 'Work'],
    })
  })

  it('is on a card’s page, and saves a tag as one of a card', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Cards 1'))
    await click(button(root, 'Open Everyday Visa'))
    await addTag(root, 'Work')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'card',
      id: 'k1',
      tags: ['Money', 'Work'],
    })
  })

  it('is on an identity’s page, and saves a tag as one of an identity', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Identities 1'))
    await click(button(root, 'Open Me'))
    await addTag(root, 'Work')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'identity',
      id: 'i1',
      tags: ['Family', 'Work'],
    })
  })

  it('is on a passkey’s page, and saves a tag as one of a passkey', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Passkeys 2'))
    await click(button(root, t('passkeys_openOf', 'Orbit Cloud')))
    await addTag(root, 'Work')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'passkey',
      id: 'p1',
      tags: ['Travel', 'Work'],
    })
  })

  it('shows the tags and offers no editor for a note in a space the account may only read', async () => {
    const shared = note({
      id: 'n1',
      title: 'Wi-Fi',
      tags: ['Home'],
      space: { id: 's1', name: 'Team', canEdit: false },
    })
    background.reset(handlers({}, { notes: [shared] }))
    const root = await openPopup()
    await click(button(root, 'Notes 1'))
    await click(button(root, 'Open Wi-Fi'))
    expect(root.textContent).toContain('Home')
    expect(root.querySelector('.tag-editor')).toBeNull()
  })
})

describe('the tags page', () => {
  it('lists the items of every kind to tag, and tags a note from there', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    for (const name of ['Wi-Fi', 'Everyday Visa', 'Me', 'Orbit Cloud', 'harbornotes.app'])
      expect(button(root, t('tools_editTagsOf', name)), name).not.toBeNull()
    await click(button(root, t('tools_editTagsOf', 'Wi-Fi')))
    await change(input(root, t('tools_tags')), 'Work,')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'note',
      id: 'n1',
      tags: ['Home', 'Work'],
    })
  })

  it('finds an item of any kind by what the search says of it', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    await change(input(root, t('popup_searchLabel')), 'harbor')
    expect(button(root, t('tools_editTagsOf', 'harbornotes.app'))).not.toBeNull()
    expect(button(root, t('tools_editTagsOf', 'Wi-Fi'))).toBeNull()
  })

  it('tags a passkey from there', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    await click(button(root, t('tools_editTagsOf', 'harbornotes.app')))
    await change(input(root, t('tools_tags')), 'Work,')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'passkey',
      id: 'p2',
      tags: ['Work'],
    })
  })
})
