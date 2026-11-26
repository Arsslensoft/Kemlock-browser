// What each vault-tools request of an extension page may carry, as parsers (docs/plans/add-vault-tools.md). messages.ts gives the
// parsers its own requests are made of and asks for these specs, so a request is read the same way whatever its kind: into a fresh
// object of known fields, with its sizes bounded, and nothing a sender adds goes any further.
import type { ToolsPageApi } from './tools-api'

type Parse = (value: unknown) => unknown

/** A field of a request: how to read it, and whether it may be left out. */
export interface ToolsField {
  parse: Parse
  optional: boolean
}

/** The parsers of messages.ts, handed over so that this file needs nothing from it and the two don't import each other. */
export interface Primitives {
  /** What a parser answers for a value that isn't one. */
  bad: symbol
  text: (max: number, min?: number) => Parse
  id: Parse
  bool: Parse
  int: (min: number, max: number) => Parse
  oneOf: <T extends string | number>(...allowed: readonly T[]) => Parse
  list: (item: Parse, max: number) => Parse
  obj: (spec: Record<string, ToolsField>) => Parse
  req: (parse: Parse) => ToolsField
  opt: (parse: Parse) => ToolsField
}

export type ToolsPageSpecs = { [K in keyof ToolsPageApi]: Record<string, ToolsField> }

export const itemKinds = [
  'code',
  'login',
  'passkey',
  'note',
  'card',
  'identity',
  'file',
  'key',
  'keyAccount',
] as const

export function toolsPageSpecs(p: Primitives): ToolsPageSpecs {
  const { bad, text, id, bool, int, oneOf, list, obj, req, opt } = p
  const tag = text(100, 1)
  const codesText = text(100_000)
  const index = int(0, 10_000)
  /** A backup code as the core keeps it: 200 characters at most. */
  const backupCode = text(200, 1)
  /** `{fieldId: itemId}` of a merge's picks: a few fields, each named by an item of the group. */
  const picks: Parse = (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad
    const entries = Object.entries(value)
    if (entries.length > 20) return bad
    const out: Record<string, string> = {}
    for (const [field, item] of entries) {
      if (text(64, 1)(field) === bad || id(item) === bad) return bad
      out[field] = item as string
    }
    return out
  }
  return {
    tags: {},
    setTags: {
      itemKind: req(oneOf(...itemKinds)),
      id: req(id),
      tags: req(list(tag, 50)),
    },
    renameTag: { from: req(tag), to: req(tag) },
    deleteTag: { name: req(tag) },
    setPinned: { itemKind: req(oneOf('code', 'login')), id: req(id), pinned: req(bool) },
    reorder: { itemKind: req(oneOf('code', 'login')), ids: req(list(id, 5000)) },

    backupDetail: { serviceId: req(id) },
    parseBackupCodes: { text: req(codesText) },
    addBackupService: { name: req(text(200, 1)), text: req(codesText) },
    editBackupService: {
      serviceId: req(id),
      name: opt(text(200, 1)),
      note: opt(text(5000)),
      clearNote: opt(bool),
    },
    addBackupCodes: { serviceId: req(id), text: req(codesText) },
    setBackupCodeUsed: {
      serviceId: req(id),
      index: req(index),
      used: req(bool),
      code: req(backupCode),
    },
    removeBackupCode: { serviceId: req(id), index: req(index), code: req(backupCode) },
    deleteBackupService: { serviceId: req(id) },
    backupCoverage: {},
    setNoBackupCodes: { codeId: req(id), none: req(bool) },

    duplicates: {},
    duplicateReview: { key: req(text(200_000, 1)) },
    duplicateMerge: { key: req(text(200_000, 1)), keptId: req(id), picks: req(picks) },
    duplicateDismiss: { key: req(text(200_000, 1)) },
    duplicateRestore: { key: req(text(200_000, 1)) },
    duplicateUndo: { recordId: req(id), overwrite: opt(bool) },
    setDuplicateMatching: { on: req(bool) },

    breaches: {},
    dismissBreach: {
      name: req(text(200, 1)),
      accountIds: req(list(id, 500)),
      serviceIds: req(list(id, 500)),
    },
    checkBreaches: {},
    toolsSettings: {},
    saveToolsSettings: { settings: req(obj({ breachRefresh: opt(bool) })) },
  }
}
