// What the extension's pages ask about shared spaces (docs/plans/add-spaces.md): the handlers of the spaces' `PageApi` methods, over
// the core's. Only the popup and the setup tab may ask; the vault must be open; a change to a space is a change in the browser, so a
// sync follows shortly. The core does the work and its checks: who may do what is the verified chain's, never a page's word.
import type { CoreApi, PageApi, PageRequest } from '../shared/api'
import type { SpacePageKind } from '../shared/spaces-api'
import type { Deps } from './deps'
import { BackgroundError } from './errors'
import type { ExtensionPage, PageSender } from './senders'

/** The background's own steps the handlers share. */
export interface SpaceSteps {
  check(sender: PageSender, allowed: readonly ExtensionPage[]): void
  needOpen(): Promise<void>
  touch(): Promise<void>
  changed(): Promise<void>
}

type Impl = {
  [K in SpacePageKind]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<PageApi[K]>
}

const pages: readonly ExtensionPage[] = ['popup', 'setup']

/** What a core without spaces answers: unsupported. */
function need<T>(answer: Promise<T> | undefined): Promise<T> {
  return answer ?? Promise.reject(new BackgroundError('unsupported'))
}

/**
 * Refuses to show or copy a login's password that this account's grant hides (a "hide passwords" grant, or a space whose chain this
 * session has not verified yet). Filling is not asked here: the phone fills such a login too, reading it inside the background.
 */
export async function refuseHidden(core: CoreApi, id: string): Promise<void> {
  const hidden = (await core.hiddenLoginIds?.()) ?? []
  if (hidden.includes(id)) throw new BackgroundError('refused')
}

export function spacePageHandlers(d: Pick<Deps, 'core'>, steps: SpaceSteps): Impl {
  const { core } = d
  /** A request that reads: the vault is open and the sender is a page of the extension. */
  const read = async (sender: PageSender): Promise<void> => {
    steps.check(sender, pages)
    await steps.needOpen()
    await steps.touch()
  }
  /** A request that changes a space: the same, and a sync follows. */
  const write = async (sender: PageSender): Promise<void> => {
    await read(sender)
  }
  const done = async <T>(answer: Promise<T> | undefined): Promise<T> => {
    const value = await need(answer)
    await steps.changed()
    return value
  }
  return {
    spaces: async ({ refresh }, sender) => {
      await read(sender)
      return need(core.spaces?.(refresh))
    },
    space: async ({ id }, sender) => {
      await read(sender)
      return need(core.space?.(id))
    },
    spaceContact: async ({ id, person }, sender) => {
      await read(sender)
      return need(core.spaceContact?.(id, person))
    },
    spaceTrust: async ({ id, person, digits }, sender) => {
      await write(sender)
      await done(core.spaceTrust?.(id, person, digits))
    },
    spaceAnswer: async ({ id, accept }, sender) => {
      await write(sender)
      await done(core.spaceAnswer?.(id, accept))
    },
    spaceMake: async ({ name }, sender) => {
      await write(sender)
      return done(core.spaceMake?.(name))
    },
    spaceLeave: async ({ id }, sender) => {
      await write(sender)
      await done(core.spaceLeave?.(id))
    },
    spaceInvite: async ({ id, email, role }, sender) => {
      await write(sender)
      await done(core.spaceInvite?.(id, email, role))
    },
    spaceResend: async ({ id, member }, sender) => {
      await write(sender)
      await need(core.spaceResend?.(id, member))
    },
    spaceConfirm: async ({ id, member, digits }, sender) => {
      await write(sender)
      await done(core.spaceConfirm?.(id, member, digits))
    },
    spaceRole: async ({ id, member, role }, sender) => {
      await write(sender)
      await done(core.spaceRole?.(id, member, role))
    },
    spaceRemove: async ({ id, member }, sender) => {
      await write(sender)
      await done(core.spaceRemove?.(id, member))
    },
    spaceGrant: async ({ id, collection, member, permission }, sender) => {
      await write(sender)
      await done(core.spaceGrant?.(id, collection, member, permission))
    },
    spaceHeld: async ({ id }, sender) => {
      await read(sender)
      return need(core.spaceHeld?.(id))
    },
    spaceKeepHeld: async ({ id, item }, sender) => {
      await write(sender)
      await done(core.spaceKeepHeld?.(id, item))
    },
    spaceDeleteHeld: async ({ id, item }, sender) => {
      await write(sender)
      await done(core.spaceDeleteHeld?.(id, item))
    },
    ownFingerprint: async (_message, sender) => {
      await read(sender)
      return need(core.ownFingerprint?.())
    },
    moveItem: async ({ itemKind, id, space, collection }, sender) => {
      await write(sender)
      await done(core.moveItem?.(itemKind, id, space, collection))
    },
    syncSpaces: async (_message, sender) => {
      await read(sender)
      return need(core.syncSpaces?.())
    },
    joinDavSpace: async ({ invite, code, folder, username, password }, sender) => {
      await write(sender)
      return done(core.joinDavSpace?.({ invite, code, folder, username, password }))
    },
    leaveDavSpace: async ({ id }, sender) => {
      await write(sender)
      await done(core.leaveDavSpace?.(id))
    },
  }
}
