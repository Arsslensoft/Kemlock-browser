// @vitest-environment jsdom
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from '../send'
import type { BackupDetail, DuplicatesView, MergePlan } from '../../shared/tools-api'
import { ToastProvider } from '../../shared/ui/components'
import { App } from '../app'
import {
  backup,
  background,
  button,
  change,
  click,
  code,
  input,
  installChrome,
  login,
  message,
  mount,
  settings,
  settle,
  text,
  unlockedHandlers,
  unmountAll,
  type World,
} from '../testing'

vi.mock('../send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('../testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

const openPopup = () => mount(h(ToastProvider, null, h(App, null)))
const t = (name: string, ...subs: string[]) => message('en', name, subs)

const orbitCode = code({ id: 'c1', loginId: 'l1', tags: ['Work'] })
const spare = code({ id: 'c2', issuer: 'Spare', account: 'sam', websites: [], order: 1 })
const orbitLogin = login({ id: 'l1', codeId: 'c1', tags: ['Work'] })
const docs = login({
  id: 'l3',
  name: 'Docs',
  username: 'sam',
  websites: ['https://docs.example.org'],
  order: 1,
})

const world = (over: Partial<World> = {}): World => ({
  codes: [orbitCode, spare],
  logins: [orbitLogin, docs],
  ...over,
})

/** Waits a little longer than the pause the pasted-codes preview makes before it asks. */
const pause = async () => {
  await new Promise((resolve) => setTimeout(resolve, 260))
  await settle()
}

async function press(element: Element | null, key: string): Promise<void> {
  if (element === null) throw new Error('nothing to press')
  await act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  await settle()
}

/** The button that confirms the question asked in place (its row has other buttons that read the same). */
const confirmButton = (root: HTMLElement): Element | null =>
  root.querySelector('[role="alertdialog"] .btn.danger')

/** What every page the tools add says, which must say nothing of a price. */
const premium = /premium|paywall|upgrade|subscri|purchase|unlock more/i

beforeEach(() => {
  installChrome()
  background.reset()
})

afterEach(() => {
  unmountAll()
})

describe('tags', () => {
  const handlers = (over = {}) => ({
    ...unlockedHandlers(world()),
    tags: (() => [
      { name: 'Personal', count: 1 },
      { name: 'Work', count: 2 },
    ]) as never,
    renameTag: (() => ({ changed: 2, skipped: 0 })) as never,
    deleteTag: (() => ({ changed: 2, skipped: 0 })) as never,
    setTags: ((args: { tags: string[] }) => args.tags) as never,
    ...over,
  })

  it('open from Home, with every tag and how many items hold it', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    expect(text(root)).toContain('Work')
    expect(text(root)).toContain(t('tools_tagCount', '2'))
    expect(text(root)).toContain('Spare')
    expect(text(root)).not.toMatch(premium)
  })

  it('are renamed everywhere, from the tag’s row', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    await click(button(root, t('tools_renameTagOf', 'Work')))
    await change(input(root, t('tools_renameTagOf', 'Work')), 'Job')
    await click(button(root, t('popup_save')))
    expect(background.of('renameTag')[0]?.args).toEqual({ from: 'Work', to: 'Job' })
  })

  it('say how many items a rename left as they are, in a space the account can only read', async () => {
    background.reset(handlers({ renameTag: (() => ({ changed: 1, skipped: 2 })) as never }))
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    await click(button(root, t('tools_renameTagOf', 'Work')))
    await change(input(root, t('tools_renameTagOf', 'Work')), 'Job')
    await click(button(root, t('popup_save')))
    expect(text(root)).toContain(t('tools_tagRenamedSkipped', '1', '2'))
  })

  it('are deleted everywhere, after a question', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    await click(button(root, t('tools_deleteTagTitle', 'Work')))
    expect(text(root)).toContain(t('tools_deleteTagBody', '2'))
    expect(background.of('deleteTag')).toHaveLength(0)
    await click(confirmButton(root))
    expect(background.of('deleteTag')[0]?.args).toEqual({ name: 'Work' })
  })

  it('are put on a code from its own page of tags', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_tagsTitle')))
    await click(button(root, t('tools_editTagsOf', 'Spare')))
    await change(input(root, t('tools_tags')), 'Home')
    await press(input(root, t('tools_tags')), 'Enter')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'code',
      id: 'c2',
      tags: ['Home'],
    })
    // The tags other items hold are offered, and a tap adds one
    await click(button(root, t('tools_addTagOf', 'Work')))
    expect(background.of('setTags')[1]?.args).toEqual({
      itemKind: 'code',
      id: 'c2',
      tags: ['Home', 'Work'],
    })
  })

  it('are changed on a login’s page: one more, and one fewer, with a comma ending a tag', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Logins 2'))
    await click(button(root, 'Open Orbit Cloud'))
    expect(text(root)).toContain('Work')
    await change(input(root, t('tools_tags')), 'Home,')
    expect(background.of('setTags')[0]?.args).toEqual({
      itemKind: 'login',
      id: 'l1',
      tags: ['Work', 'Home'],
    })
    await click(button(root, t('tools_removeTag', 'Work')))
    expect(background.of('setTags')[1]?.args).toEqual({
      itemKind: 'login',
      id: 'l1',
      tags: ['Home'],
    })
  })

  it('are not added twice whatever their case, and not at all when empty', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Logins 2'))
    await click(button(root, 'Open Orbit Cloud'))
    await change(input(root, t('tools_tags')), 'work')
    await press(input(root, t('tools_tags')), 'Enter')
    await change(input(root, t('tools_tags')), '   ')
    await press(input(root, t('tools_tags')), 'Enter')
    expect(background.of('setTags')).toHaveLength(0)
  })
})

describe('order', () => {
  const handlers = (over = {}) => ({
    ...unlockedHandlers(world()),
    reorder: (() => undefined) as never,
    setPinned: (() => undefined) as never,
    ...over,
  })
  const rows = (root: HTMLElement) =>
    [...root.querySelectorAll('li.reorder-row .name')].map((name) => name.textContent)

  it('moves a code by its Move up and Move down buttons, which are buttons, so the keyboard reaches them', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_reorderCodes')))
    expect(rows(root)).toEqual(['Orbit Cloud', 'Spare'])
    expect(button(root, t('tools_moveUp', 'Orbit Cloud'))?.disabled).toBe(true)
    expect(button(root, t('tools_moveDown', 'Spare'))?.disabled).toBe(true)
    await click(button(root, t('tools_moveUp', 'Spare')))
    expect(background.of('reorder')[0]?.args).toEqual({ itemKind: 'code', ids: ['c2', 'c1'] })
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      t('tools_movedTo', 'Spare', '1', '2'),
    )
  })

  it('moves a row by dragging it onto another', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, t('tools_reorderCodes')))
    const [first, second] = [...root.querySelectorAll('li.reorder-row')]
    await act(() => {
      second!.dispatchEvent(new Event('dragstart', { bubbles: true }))
    })
    await act(() => {
      first!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    })
    await settle()
    expect(background.of('reorder')[0]?.args).toEqual({ itemKind: 'code', ids: ['c2', 'c1'] })
  })

  it('orders logins too, and pins one to the top', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await click(button(root, 'Logins 2'))
    await click(button(root, t('tools_reorderLogins')))
    expect(text(root)).toContain(t('tools_reorderLoginsNote'))
    await click(button(root, t('tools_moveUp', 'Docs')))
    expect(background.of('reorder')[0]?.args).toEqual({ itemKind: 'login', ids: ['l3', 'l1'] })
    await click(button(root, t('tools_pin', 'Docs')))
    expect(background.of('setPinned')[0]?.args).toEqual({
      itemKind: 'login',
      id: 'l3',
      pinned: true,
    })
  })

  it('shows a pinned code before the others on Home', async () => {
    background.reset(unlockedHandlers(world({ codes: [orbitCode, { ...spare, pinned: true }] })))
    const root = await openPopup()
    expect([...root.querySelectorAll('li.item .name')].map((n) => n.textContent)).toEqual([
      'Spare',
      'Orbit Cloud',
    ])
  })
})

describe('backup codes', () => {
  const detail = (over: Partial<BackupDetail> = {}): BackupDetail => ({
    serviceId: 'c1',
    name: 'Orbit Cloud',
    low: false,
    codes: [
      { code: 'aaaa-1111', used: false },
      { code: 'bbbb-2222', used: true, usedAt: 1 },
    ],
    accounts: [{ id: 'c1', name: 'Orbit Cloud' }],
    logins: [{ id: 'l1', name: 'Orbit Cloud' }],
    ...over,
  })
  const handlers = (over = {}) => ({
    ...unlockedHandlers(world({ backups: [backup({ total: 2, left: 1 })] })),
    backupDetail: (() => detail()) as never,
    parseBackupCodes: ((args: { text: string }) =>
      args.text.split(/\s+/).filter((part) => part !== '')) as never,
    addBackupService: ((args: { name: string }) =>
      backup({ serviceId: 's9', issuer: args.name })) as never,
    setBackupCodeUsed: (() => backup()) as never,
    removeBackupCode: (() => backup()) as never,
    deleteBackupService: (() => undefined) as never,
    editBackupService: (() => backup()) as never,
    addBackupCodes: (() => ({ added: 1, duplicates: 0 })) as never,
    backupCoverage: (() => ({
      total: 2,
      covered: 1,
      missing: [{ id: 'c2', name: 'Spare', account: 'sam' }],
    })) as never,
    setNoBackupCodes: (() => undefined) as never,
    ...over,
  })
  const openList = async (root: HTMLElement) => {
    await click(root.querySelector('button.link-card'))
  }

  it('say on Home how to add a service’s when there are none', async () => {
    background.reset(unlockedHandlers(world({ backups: [] })))
    const root = await openPopup()
    expect(text(root)).toContain(t('tools_addServiceCodes'))
  })

  it('are added by pasting them: the codes found are shown, and saved with the name', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openList(root)
    await click(button(root, t('tools_addServiceCodes')))
    await change(input(root, t('tools_serviceName')), 'Google')
    await change(input(root, t('tools_backupCodes')), 'abcd-1234 efgh-5678')
    await pause()
    expect(text(root)).toContain(t('tools_codesDetected', '2'))
    expect(text(root)).toContain('efgh-5678')
    await click(button(root, t('tools_saveCodes', '2')))
    expect(background.of('addBackupService')[0]?.args).toEqual({
      name: 'Google',
      text: 'abcd-1234 efgh-5678',
    })
    // Back on the list
    expect(text(root)).toContain(t('popup_backupCodes'))
  })

  it('cannot be saved without a name or without any code', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openList(root)
    await click(button(root, t('tools_addServiceCodes')))
    expect(button(root, t('tools_saveCodes', '0'))?.disabled).toBe(true)
    await change(input(root, t('tools_backupCodes')), '   ')
    await pause()
    expect(button(root, t('tools_saveCodes', '0'))?.disabled).toBe(true)
  })

  it('stay hidden on a service’s page until shown, then are marked used or unused by place', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openList(root)
    await click(button(root, t('tools_manageCodesOf', 'Orbit Cloud')))
    expect(text(root)).toContain(t('tools_codesLeft', '1', '2'))
    expect(text(root)).not.toContain('aaaa-1111')
    await click(button(root, t('tools_showCodesOf', 'Orbit Cloud')))
    expect(text(root)).toContain('aaaa-1111')
    await click(button(root, t('tools_markUsedNumber', '1')))
    // With the code the page shows at that place, so a list that changed since is refused
    expect(background.of('setBackupCodeUsed')[0]?.args).toEqual({
      serviceId: 'c1',
      index: 0,
      used: true,
      code: 'aaaa-1111',
    })
    await click(button(root, t('tools_markUnusedNumber', '2')))
    expect(background.of('setBackupCodeUsed')[1]?.args).toEqual({
      serviceId: 'c1',
      index: 1,
      used: false,
      code: 'bbbb-2222',
    })
    expect(text(root)).not.toMatch(premium)
  })

  it('warn when two or fewer are left, and say what they belong to', async () => {
    background.reset(handlers({ backupDetail: (() => detail({ low: true })) as never }))
    const root = await openPopup()
    await openList(root)
    await click(button(root, t('tools_manageCodesOf', 'Orbit Cloud')))
    expect(text(root)).toContain(t('tools_lowCodes', 'Orbit Cloud'))
    expect(text(root)).toContain(t('tools_usedBy'))
    // The login it belongs to opens
    await click(button(root, 'Open Orbit Cloud'))
    expect(text(root)).toContain(t('popup_twoStepCode'))
  })

  it('lose a code only after a question, and a service after another', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openList(root)
    await click(button(root, t('tools_manageCodesOf', 'Orbit Cloud')))
    await click(button(root, t('tools_removeCodeNumber', '2')))
    expect(background.of('removeBackupCode')).toHaveLength(0)
    await click(confirmButton(root))
    expect(background.of('removeBackupCode')[0]?.args).toEqual({
      serviceId: 'c1',
      index: 1,
      code: 'bbbb-2222',
    })
    await click(button(root, t('tools_deleteBackup')))
    expect(background.of('deleteBackupService')).toHaveLength(0)
    expect(text(root)).toContain(t('tools_deleteBackupTitle', 'Orbit Cloud'))
    await click(button(root, t('tools_deleteBackup')))
    expect(background.of('deleteBackupService')[0]?.args).toEqual({ serviceId: 'c1' })
  })

  it('get more codes added, with the ones held left out by the core, and the note and name edited', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openList(root)
    await click(button(root, t('tools_manageCodesOf', 'Orbit Cloud')))
    await click(button(root, t('tools_addMoreCodes')))
    await change(input(root, t('tools_backupCodes')), 'zzzz-9999')
    await pause()
    await click(button(root, t('tools_addCodes')))
    expect(background.of('addBackupCodes')[0]?.args).toEqual({ serviceId: 'c1', text: 'zzzz-9999' })
    expect(text(root)).toContain(t('tools_codesAdded', '1', '0'))
    await change(input(root, t('popup_fieldNote')), 'on paper')
    await click(button(root, t('popup_save')))
    expect(background.of('editBackupService')[0]?.args).toEqual({
      serviceId: 'c1',
      name: 'Orbit Cloud',
      note: 'on paper',
    })
  })

  it('list the codes that have none saved, to add them or to say the service gives none', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openList(root)
    await click(button(root, t('tools_missingCodes')))
    expect(text(root)).toContain(t('tools_coverageNote', '1', '2'))
    expect(text(root)).toContain('Spare')
    await click(button(root, t('tools_givesNoneLabel', 'Spare')))
    expect(background.of('setNoBackupCodes')[0]?.args).toEqual({ codeId: 'c2', none: true })
    await click(button(root, t('tools_addCodesFor', 'Spare')))
    expect((input(root, t('tools_serviceName')) as HTMLInputElement).value).toBe('Spare')
  })
})

describe('duplicates', () => {
  const group = {
    key: 'l1|l2',
    reason: 'sameSignIn',
    kind: 'login',
    items: [
      {
        id: 'l1',
        name: 'Orbit Cloud',
        detail: 'sam · orbit-cloud.com',
        changedAt: 1_700_000_000_000,
      },
      {
        id: 'l2',
        name: 'Orbit again',
        detail: 'sam · orbit-cloud.com',
        changedAt: 1_700_000_100_000,
      },
    ],
  }
  const view = (over: Partial<DuplicatesView> = {}): DuplicatesView => ({
    checkedAt: 1,
    groups: [group],
    records: [],
    matching: { available: false, on: false },
    ...over,
  })
  const plan: MergePlan = {
    key: 'l1|l2',
    keptId: 'l2',
    items: group.items,
    fields: [
      {
        id: 'name',
        picked: 'l2',
        options: [
          { itemId: 'l1', text: 'Orbit Cloud' },
          { itemId: 'l2', text: 'Orbit again' },
        ],
      },
    ],
  }
  const handlers = (over = {}) => ({
    ...unlockedHandlers(world()),
    duplicates: (() => view()) as never,
    duplicateReview: (() => plan) as never,
    duplicateMerge: (() => ({ removed: 1, recordId: 'm1' })) as never,
    duplicateDismiss: (() => true) as never,
    duplicateRestore: (() => undefined) as never,
    duplicateUndo: (() => 'undone') as never,
    setDuplicateMatching: (() => ({ available: true, on: true })) as never,
    ...over,
  })
  const openPage = async (root: HTMLElement) => {
    await click(button(root, 'Logins 2'))
    await click(
      [...root.querySelectorAll('button.link-card')].find((b) =>
        b.textContent?.includes(t('tools_duplicatesTitle')),
      ) ?? null,
    )
  }

  it('show each group with why it matched, and say everything is found here', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openPage(root)
    expect(text(root)).toContain(t('tools_reason_sameSignIn'))
    expect(text(root)).toContain('Orbit again')
    expect(text(root)).toContain(t('tools_onDevice'))
    expect(text(root)).not.toMatch(premium)
  })

  it('say when there is nothing', async () => {
    background.reset(handlers({ duplicates: (() => view({ groups: [] })) as never }))
    const root = await openPopup()
    await openPage(root)
    expect(text(root)).toContain(t('tools_noDuplicates'))
  })

  it('are reviewed, with the newest preselected, and merged as the person picks', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openPage(root)
    await click(button(root, t('tools_reviewGroup', t('tools_reason_sameSignIn'))))
    const kept = [...root.querySelectorAll<HTMLInputElement>('input[name="kept"]')]
    expect(kept.map((radio) => radio.checked)).toEqual([false, true])
    expect(text(root)).toContain(t('tools_field_name'))
    // The person keeps the older one, and its name
    await click(kept[0]!)
    await click(root.querySelector('input[name="field-name"]'))
    await click(button(root, t('tools_mergeItems', '2')))
    expect(background.of('duplicateMerge')[0]?.args).toEqual({
      key: 'l1|l2',
      keptId: 'l1',
      picks: { name: 'l1' },
    })
  })

  it('say how many items a merge left out, in a space the account can only read', async () => {
    background.reset(
      handlers({
        duplicateReview: (() => ({ ...plan, skipped: 1 })) as never,
        duplicateMerge: (() => ({ removed: 1, recordId: 'm1', skipped: 1 })) as never,
      }),
    )
    const root = await openPopup()
    await openPage(root)
    await click(button(root, t('tools_reviewGroup', t('tools_reason_sameSignIn'))))
    expect(text(root)).toContain(t('tools_reviewSkipped', '1'))
    await click(button(root, t('tools_mergeItems', '2')))
    expect(text(root)).toContain(t('tools_mergedSkipped', '1', '1'))
  })

  it('are dismissed with "Not duplicates", which Undo takes back', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openPage(root)
    await click(button(root, t('tools_notDuplicates')))
    expect(background.of('duplicateDismiss')[0]?.args).toEqual({ key: 'l1|l2' })
    expect(text(root)).toContain(t('tools_notDuplicatesSaved'))
    await click(button(root, t('tools_undo')))
    expect(background.of('duplicateRestore')[0]?.args).toEqual({ key: 'l1|l2' })
  })

  it('offer to undo a merge, and say it can be done for 30 days', async () => {
    background.reset(
      handlers({
        duplicates: (() =>
          view({
            records: [{ id: 'm1', at: 1_700_000_000_000, label: 'Orbit', count: 1 }],
          })) as never,
      }),
    )
    const root = await openPopup()
    await openPage(root)
    expect(text(root)).toContain(t('tools_undoMergeNote'))
    await click(button(root, t('tools_undoMergeOf', 'Orbit')))
    expect(background.of('duplicateUndo')[0]?.args).toEqual({ recordId: 'm1' })
  })

  it('ask before an Undo that would lose what was changed since the merge, and say so', async () => {
    let answers: string[] = ['edited', 'undone']
    background.reset(
      handlers({
        duplicates: (() =>
          view({
            records: [{ id: 'm1', at: 1_700_000_000_000, label: 'Orbit', count: 1 }],
          })) as never,
        duplicateUndo: (() => answers.shift()) as never,
      }),
    )
    const root = await openPopup()
    await openPage(root)
    await click(button(root, t('tools_undoMergeOf', 'Orbit')))
    expect(text(root)).toContain(t('tools_undoEditedTitle', 'Orbit'))
    expect(background.of('duplicateUndo')).toHaveLength(1)
    expect(background.of('duplicateUndo')[0]?.args).toEqual({ recordId: 'm1' })
    await click(button(root, t('tools_undoAnyway')))
    expect(background.of('duplicateUndo')[1]?.args).toEqual({ recordId: 'm1', overwrite: true })
    answers = []
  })

  it('say a group changed when the core says so, and go back to the list', async () => {
    background.reset(
      handlers({
        duplicateMerge: (() => {
          throw new Error('stale')
        }) as never,
      }),
    )
    const root = await openPopup()
    await openPage(root)
    await click(button(root, t('tools_reviewGroup', t('tools_reason_sameSignIn'))))
    await click(button(root, t('tools_mergeItems', '2')))
    expect(text(root)).toContain(t('tools_stale'))
    expect(text(root)).toContain(t('tools_duplicatesTitle'))
  })

  it('show the switch for server matching only with a Kemlock Server, and ask before it goes on', async () => {
    background.reset(
      handlers({ duplicates: (() => view({ matching: { available: true, on: false } })) as never }),
    )
    const root = await openPopup()
    await openPage(root)
    const row = [...root.querySelectorAll('label.switch')].find((label) =>
      label.textContent?.includes(t('tools_serverMatchingSwitch')),
    )
    expect(row).toBeDefined()
    await act(() => {
      const box = row!.querySelector<HTMLInputElement>('input')!
      box.checked = true
      box.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(text(root)).toContain(t('tools_matchingExplainTitle'))
    expect(background.of('setDuplicateMatching')).toHaveLength(0)
    await click(button(root, t('tools_matchingTurnOn')))
    expect(background.of('setDuplicateMatching')[0]?.args).toEqual({ on: true })
  })
})

describe('breaches', () => {
  const alert = {
    name: 'OrbitCloud',
    title: 'Orbit Cloud',
    domain: 'orbit-cloud.com',
    breachDate: '2026-02-01',
    addedDate: '2026-02-10',
    pwnCount: 1_200_000,
    passwords: true,
    entries: [
      { kind: 'code', id: 'c1', name: 'Orbit Cloud · sam@example.com' },
      { kind: 'backup', id: 's1', name: 'Orbit Cloud' },
    ],
  }
  const handlers = (over = {}) => ({
    ...unlockedHandlers(world({ settings: settings({ breachedPasswords: true }) })),
    health: (() => ({ reused: [], weak: [], withoutItsCode: [], breached: [] })) as never,
    breaches: (() => ({
      alerts: [alert],
      serviceCount: 1,
      listUpdated: '2026-11-15',
      source: 'https://haveibeenpwned.com',
      license: 'Breach data from Have I Been Pwned, licensed under CC BY 4.0.',
      refreshOn: false,
    })) as never,
    dismissBreach: (() => undefined) as never,
    checkBreaches: (() => ({
      at: 1,
      passwords: { on: true, breached: 2, failed: 1 },
      list: { on: false, checked: false, updated: false },
    })) as never,
    saveToolsSettings: (() => ({ breachRefresh: true })) as never,
    ...over,
  })
  const openHealth = async (root: HTMLElement) => {
    await click(button(root, 'Logins 2'))
    await click(
      [...root.querySelectorAll('button.link-card')].find((b) =>
        b.textContent?.startsWith(t('popup_healthTitle')),
      ) ?? null,
    )
  }

  it('have "Check now" in Health, which asks again and says how many were found and how many weren’t asked', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openHealth(root)
    await click(button(root, t('tools_checkNow')))
    expect(background.of('checkBreaches')).toHaveLength(1)
    expect(text(root)).toContain(t('tools_checkedPasswords', '2', '1'))
  })

  it('have no "Check now" in Health while the breached-passwords check is off', async () => {
    background.reset(handlers({ settings: (() => settings()) as never }))
    const root = await openPopup()
    await openHealth(root)
    expect(button(root, t('tools_checkNow'))).toBeNull()
    expect(button(root, t('tools_serviceBreaches'))).not.toBeNull()
  })

  it('list the services with a new breach and "Dealt with" marks them for every entry', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openHealth(root)
    await click(button(root, t('tools_serviceBreaches')))
    expect(text(root)).toContain('Orbit Cloud')
    expect(text(root)).toContain(t('tools_breachPasswords'))
    expect(text(root)).toContain(t('tools_breachEntryCode', 'Orbit Cloud · sam@example.com'))
    expect(text(root)).toContain(t('tools_breachEntryBackup', 'Orbit Cloud'))
    expect(text(root)).toContain('haveibeenpwned.com')
    await click(button(root, t('tools_dealtWithOf', 'Orbit Cloud')))
    expect(background.of('dismissBreach')[0]?.args).toEqual({
      name: 'OrbitCloud',
      accountIds: ['c1'],
      serviceIds: ['s1'],
    })
    expect(text(root)).not.toMatch(premium)
  })

  it('keep the daily refresh of the list off until the switch is turned on', async () => {
    background.reset(handlers())
    const root = await openPopup()
    await openHealth(root)
    await click(button(root, t('tools_serviceBreaches')))
    const row = [...root.querySelectorAll('label.switch')].find((label) =>
      label.textContent?.includes(t('tools_refreshSwitch')),
    )
    expect((row!.querySelector('input') as HTMLInputElement).checked).toBe(false)
    await act(() => {
      const box = row!.querySelector<HTMLInputElement>('input')!
      box.checked = true
      box.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(background.of('saveToolsSettings')[0]?.args).toEqual({
      settings: { breachRefresh: true },
    })
  })

  it('say when no service has a new breach', async () => {
    background.reset(
      handlers({
        breaches: (() => ({
          alerts: [],
          serviceCount: 0,
          listUpdated: '2026-11-15',
          source: 'https://haveibeenpwned.com',
          license: 'CC BY 4.0',
          refreshOn: false,
        })) as never,
      }),
    )
    const root = await openPopup()
    await openHealth(root)
    await click(button(root, t('tools_serviceBreaches')))
    expect(text(root)).toContain(t('tools_noBreaches'))
  })
})
