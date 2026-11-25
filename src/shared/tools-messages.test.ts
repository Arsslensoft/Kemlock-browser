import { describe, expect, it } from 'vitest'
import { parsePageMessage } from './messages'

describe('the vault tools’ requests', () => {
  it('keep their known fields and drop what a sender adds', () => {
    expect(
      parsePageMessage({ kind: 'setTags', itemKind: 'login', id: 'l1', tags: ['Work'], host: 'x' }),
    ).toEqual({ kind: 'setTags', itemKind: 'login', id: 'l1', tags: ['Work'] })
    expect(parsePageMessage({ kind: 'renameTag', from: 'a', to: 'b' })).toEqual({
      kind: 'renameTag',
      from: 'a',
      to: 'b',
    })
    expect(parsePageMessage({ kind: 'reorder', itemKind: 'code', ids: ['c2', 'c1'] })).toEqual({
      kind: 'reorder',
      itemKind: 'code',
      ids: ['c2', 'c1'],
    })
    expect(
      parsePageMessage({
        kind: 'editBackupService',
        serviceId: 's',
        name: 'Google',
        clearNote: true,
      }),
    ).toEqual({ kind: 'editBackupService', serviceId: 's', name: 'Google', clearNote: true })
    expect(
      parsePageMessage({
        kind: 'duplicateMerge',
        key: 'a|b',
        keptId: 'a',
        picks: { password: 'b', name: 'a' },
      }),
    ).toEqual({
      kind: 'duplicateMerge',
      key: 'a|b',
      keptId: 'a',
      picks: { password: 'b', name: 'a' },
    })
    expect(
      parsePageMessage({ kind: 'saveToolsSettings', settings: { breachRefresh: true, extra: 1 } }),
    ).toEqual({ kind: 'saveToolsSettings', settings: { breachRefresh: true } })
    expect(
      parsePageMessage({ kind: 'removeBackupCode', serviceId: 's', index: 1, code: 'abcd', x: 1 }),
    ).toEqual({ kind: 'removeBackupCode', serviceId: 's', index: 1, code: 'abcd' })
    expect(parsePageMessage({ kind: 'duplicateUndo', recordId: 'm', overwrite: true })).toEqual({
      kind: 'duplicateUndo',
      recordId: 'm',
      overwrite: true,
    })
    expect(
      parsePageMessage({ kind: 'setTags', itemKind: 'passkey', id: 'p', tags: ['a'], x: 1 }),
    ).toEqual({ kind: 'setTags', itemKind: 'passkey', id: 'p', tags: ['a'] })
    for (const kind of ['tags', 'backupCoverage', 'duplicates', 'breaches', 'checkBreaches'])
      expect(parsePageMessage({ kind })).toEqual({ kind })
  })

  it('refuse a kind of item that holds no tags, a pin on anything but a code or a login, and a missing field', () => {
    for (const raw of [
      { kind: 'setTags', itemKind: 'contact', id: 'p', tags: [] },
      { kind: 'setTags', id: 'l1', tags: [] },
      { kind: 'setTags', itemKind: 'login', id: '', tags: [] },
      { kind: 'setPinned', itemKind: 'note', id: 'n', pinned: true },
      { kind: 'setPinned', itemKind: 'code', id: 'c', pinned: 'yes' },
      { kind: 'reorder', itemKind: 'login' },
      { kind: 'renameTag', from: 'a' },
      { kind: 'deleteTag', name: '' },
      { kind: 'addBackupService', name: '', text: 'abc' },
      { kind: 'setBackupCodeUsed', serviceId: 's', index: -1, used: true, code: 'a' },
      { kind: 'setBackupCodeUsed', serviceId: 's', index: 1.5, used: true, code: 'a' },
      // By place alone, without the code the page showed there, is not a request
      { kind: 'setBackupCodeUsed', serviceId: 's', index: 1, used: true },
      { kind: 'removeBackupCode', serviceId: 's', index: 1 },
      { kind: 'removeBackupCode', serviceId: 's', index: 1, code: '' },
      { kind: 'removeBackupCode', serviceId: 's', index: 1, code: 'x'.repeat(201) },
      { kind: 'duplicateUndo', recordId: 'm', overwrite: 'yes' },
      { kind: 'setNoBackupCodes', codeId: 'c' },
      { kind: 'dismissBreach', name: 'X', accountIds: [], serviceIds: 'y' },
      { kind: 'saveToolsSettings', settings: { breachRefresh: 'on' } },
      { kind: 'setDuplicateMatching' },
    ])
      expect(parsePageMessage(raw), JSON.stringify(raw)).toBeNull()
  })

  it('bound their sizes: tags, ids, pasted codes, a merge’s picks', () => {
    expect(
      parsePageMessage({
        kind: 'setTags',
        itemKind: 'code',
        id: 'c',
        tags: Array.from({ length: 51 }, (_, i) => `t${i}`),
      }),
    ).toBeNull()
    expect(
      parsePageMessage({ kind: 'setTags', itemKind: 'code', id: 'c', tags: ['x'.repeat(101)] }),
    ).toBeNull()
    expect(
      parsePageMessage({
        kind: 'reorder',
        itemKind: 'code',
        ids: Array.from({ length: 5001 }, (_, i) => `c${i}`),
      }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'parseBackupCodes', text: 'a'.repeat(100_001) })).toBeNull()
    expect(
      parsePageMessage({ kind: 'addBackupCodes', serviceId: 's', text: 'a'.repeat(1000) }),
    ).not.toBeNull()
    const picks = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, 'a']))
    expect(parsePageMessage({ kind: 'duplicateMerge', key: 'k', keptId: 'a', picks })).toBeNull()
    expect(
      parsePageMessage({ kind: 'duplicateMerge', key: 'k', keptId: 'a', picks: { password: 3 } }),
    ).toBeNull()
    expect(
      parsePageMessage({ kind: 'duplicateMerge', key: 'k', keptId: 'a', picks: ['a'] }),
    ).toBeNull()
  })

  it('cannot be told apart by the item’s kind: the request’s own kind is what names it', () => {
    // A request that carried `kind: 'code'` for the item would be read as a request named "code"
    expect(parsePageMessage({ kind: 'code', id: 'c', tags: [] })).toBeNull()
  })
})
