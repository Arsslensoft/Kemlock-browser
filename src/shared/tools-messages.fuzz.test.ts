import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parsePageMessage } from './messages'

const kinds = [
  'tags',
  'setTags',
  'renameTag',
  'deleteTag',
  'setPinned',
  'reorder',
  'backupDetail',
  'parseBackupCodes',
  'addBackupService',
  'editBackupService',
  'addBackupCodes',
  'setBackupCodeUsed',
  'removeBackupCode',
  'deleteBackupService',
  'backupCoverage',
  'setNoBackupCodes',
  'duplicates',
  'duplicateReview',
  'duplicateMerge',
  'duplicateDismiss',
  'duplicateRestore',
  'duplicateUndo',
  'setDuplicateMatching',
  'breaches',
  'dismissBreach',
  'checkBreaches',
  'toolsSettings',
  'saveToolsSettings',
]

const anything = fc.anything({ maxDepth: 3 })
const numRuns = 300

describe('the vault tools’ requests, whatever they carry', () => {
  it('are never made to throw, and give a fresh object or nothing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.dictionary(fc.string({ maxLength: 12 }), anything, { maxKeys: 6 }),
        (kind, rest) => {
          const raw = { ...rest, kind }
          const parsed = parsePageMessage(raw)
          expect(parsed === null || (typeof parsed === 'object' && parsed !== raw)).toBe(true)
        },
      ),
      { numRuns },
    )
  })

  it('give back only what the request names, and read what they gave back the same way again', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.dictionary(fc.string({ maxLength: 12 }), anything, { maxKeys: 6 }),
        (kind, rest) => {
          const parsed = parsePageMessage({ ...rest, kind })
          if (parsed === null) return
          expect(parsePageMessage(parsed)).toEqual(parsed)
          // Nothing a sender adds, an address or a prototype's name, gets through
          for (const key of ['origin', 'url', 'host', '__proto__', 'constructor'])
            expect(Object.hasOwn(parsed, key)).toBe(false)
        },
      ),
      { numRuns },
    )
  })

  it('are refused when the kind is an inherited name, not one of the requests', () => {
    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'setTagsX'])
      expect(parsePageMessage({ kind, id: 'x', tags: [] })).toBeNull()
  })
})
