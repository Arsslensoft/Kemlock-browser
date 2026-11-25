// The background's handlers for the keys, contacts and PGP tools (docs/plans/add-keys.md): the extension's own pages ask, the
// core does the work. Only the popup and the keys tab may ask; a content script and the in-page menu never reach these (the
// router refuses what its sender may not send, and each handler checks the page again). A private key is handed to a page
// only by `exportKey`, which the page asks after its own warning, and copied only by the background itself.
import type { PageRequest } from '../shared/api'
import type { KeysPageApi } from '../shared/keys-api'
import type { Deps } from './deps'
import { BackgroundError } from './errors'
import type { ExtensionPage, PageSender } from './senders'

/** What the background's own steps give these handlers (the vault open, the idle time, the sync). */
export interface KeysSteps {
  needOpen: () => Promise<void>
  touch: () => Promise<void>
  /** A change was made in the browser: sync it soon. */
  changed: () => Promise<void>
}

type Impl = {
  [K in keyof KeysPageApi]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<KeysPageApi[K]>
}

/** The pages that may ask: the toolbar popup, and the tab that holds the same screens for files and long jobs. */
const askers: readonly ExtensionPage[] = ['popup', 'keys']

/** The message without its `kind`: the arguments the core takes. */
function argsOf<M extends { kind: string }>(message: M): Omit<M, 'kind'> {
  const { kind: _kind, ...rest } = message
  return rest
}

export function keysPageHandlers(d: Deps, steps: KeysSteps): Impl {
  const { core } = d
  /** The page may ask, and the vault is open: reading keys counts as using Kemlock. */
  const open = async (sender: PageSender): Promise<void> => {
    if (!askers.includes(sender.page)) throw new BackgroundError('refused')
    await steps.needOpen()
    await steps.touch()
  }
  /** As `open`, for a call that changes the vault: sync follows it. */
  const change = async <T>(sender: PageSender, work: () => Promise<T>): Promise<T> => {
    await open(sender)
    const result = await work()
    await steps.changed()
    return result
  }
  return {
    keysState: async (_message, sender) => {
      if (!askers.includes(sender.page)) throw new BackgroundError('refused')
      return core.state()
    },
    keys: async (_message, sender) => {
      await open(sender)
      return core.keys()
    },
    keyPublic: async ({ id }, sender) => {
      await open(sender)
      return core.keyPublic(id)
    },
    exportKey: async (message, sender) => {
      await open(sender)
      return core.exportKey(argsOf(message))
    },
    copyKey: async ({ id }, sender) => {
      await open(sender)
      const { text } = await core.exportKey({ id, purpose: 'copy' })
      await d.clipboard.copy(text, (await core.settings()).clipboardSeconds)
    },
    saveKey: async (message, sender) => change(sender, () => core.saveKey(argsOf(message))),
    deleteKey: async ({ id }, sender) => change(sender, () => core.deleteKey(id)),
    generateKey: async ({ input }, sender) => change(sender, () => core.generateKey(input)),
    previewKey: async (message, sender) => {
      await open(sender)
      return core.previewKey(argsOf(message))
    },
    importKey: async (message, sender) => change(sender, () => core.importKey(argsOf(message))),

    contacts: async (_message, sender) => {
      await open(sender)
      return core.contacts()
    },
    previewContacts: async (message, sender) => {
      await open(sender)
      return core.previewContacts(argsOf(message))
    },
    addContacts: async (message, sender) => change(sender, () => core.addContacts(argsOf(message))),
    saveContact: async (message, sender) => change(sender, () => core.saveContact(argsOf(message))),
    contactPublic: async ({ id }, sender) => {
      await open(sender)
      return core.contactPublic(id)
    },
    deleteContact: async ({ id }, sender) => change(sender, () => core.deleteContact(id)),

    pgpEncrypt: async ({ data, ...recipients }, sender) => {
      await open(sender)
      return core.pgpEncrypt({ ...data, ...argsOf(recipients) })
    },
    pgpDecrypt: async (message, sender) => {
      await open(sender)
      return core.pgpDecrypt(argsOf(message))
    },
    pgpSign: async (message, sender) => {
      await open(sender)
      return core.pgpSign(argsOf(message))
    },
    pgpVerify: async (message, sender) => {
      await open(sender)
      return core.pgpVerify(argsOf(message))
    },
    sshSign: async (message, sender) => {
      await open(sender)
      return core.sshSign(argsOf(message))
    },
    sshVerify: async (message, sender) => {
      await open(sender)
      return core.sshVerify(argsOf(message))
    },
  }
}
