// The vault tools' page requests (docs/plans/add-vault-tools.md): tags, pins and order, backup codes, the duplicate cleaner and the
// breach checks. Each one is for the extension's own pages (the popup, the setup tab) only, after the sender is checked and the vault
// is known to be open, and each change tells sync, which follows shortly. The core does the work; a backup code leaves it only for
// `backupDetail`, which the page that shows a service's codes asks.
import type { PageRequest } from '../shared/api'
import type { ToolsPageApi } from '../shared/tools-api'
import type { Deps } from './deps'
import type { ExtensionPage, PageSender } from './senders'

/** What the tools take from the background's own class. */
export interface ToolsContext {
  d: Deps
  check(sender: PageSender, allowed: readonly ExtensionPage[]): void
  needOpen(): Promise<void>
  touch(): Promise<void>
  changed(): Promise<void>
}

export type ToolsImpl = {
  [K in keyof ToolsPageApi]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<ToolsPageApi[K]>
}

const pages: readonly ExtensionPage[] = ['popup', 'setup']
const popupOnly: readonly ExtensionPage[] = ['popup']

export function toolsHandlers(c: ToolsContext): ToolsImpl {
  const { core } = c.d
  /** The sender must be a page of the extension, and the vault open; the idle time starts over. */
  const gate = async (
    sender: PageSender,
    allowed: readonly ExtensionPage[] = pages,
  ): Promise<void> => {
    c.check(sender, allowed)
    await c.needOpen()
    await c.touch()
  }
  return {
    tags: async (_message, sender) => {
      await gate(sender)
      return core.tags()
    },
    setTags: async ({ itemKind, id, tags }, sender) => {
      await gate(sender)
      const saved = await core.setTags(itemKind, id, tags)
      await c.changed()
      return saved
    },
    renameTag: async ({ from, to }, sender) => {
      await gate(sender)
      const done = await core.renameTag(from, to)
      if (done.changed > 0) await c.changed()
      return done
    },
    deleteTag: async ({ name }, sender) => {
      await gate(sender)
      const done = await core.deleteTag(name)
      if (done.changed > 0) await c.changed()
      return done
    },
    setPinned: async ({ itemKind, id, pinned }, sender) => {
      await gate(sender)
      await core.setPinned(itemKind, id, pinned)
      await c.changed()
    },
    reorder: async ({ itemKind, ids }, sender) => {
      await gate(sender)
      if (itemKind === 'code') {
        await core.reorderCodes(ids)
        await c.changed()
      } else {
        // The browser's own order of logins: sealed in the vault, never synced
        await core.reorderLogins(ids)
      }
    },

    backupDetail: async ({ serviceId }, sender) => {
      // The codes themselves: only the popup, which shows them, may ask
      await gate(sender, popupOnly)
      return core.backupDetail(serviceId)
    },
    parseBackupCodes: async ({ text }, sender) => {
      await gate(sender)
      return core.parseBackupCodes(text)
    },
    addBackupService: async ({ name, text }, sender) => {
      await gate(sender)
      const added = await core.addBackupService(name, text)
      await c.changed()
      return added
    },
    editBackupService: async ({ serviceId, name, note, clearNote }, sender) => {
      await gate(sender)
      const edited = await core.editBackupService(
        serviceId,
        name ?? null,
        note ?? null,
        clearNote === true,
      )
      await c.changed()
      return edited
    },
    addBackupCodes: async ({ serviceId, text }, sender) => {
      await gate(sender)
      const result = await core.addBackupCodes(serviceId, text)
      if (result.added > 0) await c.changed()
      return result
    },
    setBackupCodeUsed: async ({ serviceId, index, used, code }, sender) => {
      await gate(sender)
      const view = await core.setBackupCodeUsed(serviceId, index, used, code)
      await c.changed()
      return view
    },
    removeBackupCode: async ({ serviceId, index, code }, sender) => {
      await gate(sender)
      const view = await core.removeBackupCode(serviceId, index, code)
      await c.changed()
      return view
    },
    deleteBackupService: async ({ serviceId }, sender) => {
      await gate(sender)
      await core.deleteBackupService(serviceId)
      await c.changed()
    },
    backupCoverage: async (_message, sender) => {
      await gate(sender)
      return core.backupCoverage()
    },
    setNoBackupCodes: async ({ codeId, none }, sender) => {
      await gate(sender)
      await core.setNoBackupCodes(codeId, none)
      await c.changed()
    },

    duplicates: async (_message, sender) => {
      await gate(sender)
      return core.duplicates()
    },
    duplicateReview: async ({ key }, sender) => {
      // It names the copies, and the merge's choices: the popup's page
      await gate(sender, popupOnly)
      return core.duplicateReview(key)
    },
    duplicateMerge: async ({ key, keptId, picks }, sender) => {
      await gate(sender)
      const done = await core.duplicateMerge(key, keptId, picks)
      await c.changed()
      return done
    },
    duplicateDismiss: async ({ key }, sender) => {
      await gate(sender)
      return core.duplicateDismiss(key)
    },
    duplicateRestore: async ({ key }, sender) => {
      await gate(sender)
      await core.duplicateRestore(key)
    },
    duplicateUndo: async ({ recordId, overwrite }, sender) => {
      await gate(sender)
      const result = await core.duplicateUndo(recordId, overwrite === true)
      if (result === 'undone') await c.changed()
      return result
    },
    setDuplicateMatching: async ({ on }, sender) => {
      await gate(sender)
      const matching = await core.setDuplicateMatching(on)
      // The next run sends (or stops sending) the logins' tags beside its writes
      await c.changed()
      return matching
    },

    breaches: async (_message, sender) => {
      await gate(sender)
      return core.breaches()
    },
    dismissBreach: async ({ name, accountIds, serviceIds }, sender) => {
      await gate(sender)
      await core.dismissBreach(name, accountIds, serviceIds)
      await c.changed()
    },
    checkBreaches: async (_message, sender) => {
      await gate(sender)
      return core.checkBreaches()
    },
    toolsSettings: async (_message, sender) => {
      await gate(sender)
      return core.toolsSettings()
    },
    saveToolsSettings: async ({ settings }, sender) => {
      await gate(sender)
      return core.saveToolsSettings(settings)
    },
  }
}
