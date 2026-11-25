// The passkeys, Windows Hello, Touch ID and security keys that open the vault beside its password (docs/plans/add-passkey-unlock.md).
// The unlock page, a tab of the extension, makes and asks the credentials (WebAuthn can't be asked from the popup, which closes when
// the browser's prompt takes focus) and hands the answers here; the core wraps and unwraps the vault's key, so no secret is kept
// here. Only the unlock page may add a credential or unlock with one; the popup may list, rename and remove.
import type { PageApi, PageRequest } from '../shared/api'
import type { Deps } from './deps'
import { BackgroundError } from './errors'
import type { ExtensionPage, PageSender } from './senders'

const unlockPage: readonly ExtensionPage[] = ['unlock']
const popupAndUnlockPage: readonly ExtensionPage[] = ['popup', 'unlock']

type Kind =
  | 'passkeyUnlockInfo'
  | 'passkeyUnlockPrepare'
  | 'addPasskeyUnlock'
  | 'renamePasskeyUnlock'
  | 'removePasskeyUnlock'
  | 'unlockWithPasskey'

export type PasskeyUnlockHandlers = {
  [K in Kind]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<PageApi[K]>
}

/** What the background lends these handlers of its own. */
export interface PasskeyUnlockContext {
  check(sender: PageSender, allowed: readonly ExtensionPage[]): void
  /** The vault must be open to go on. */
  needOpen(): Promise<void>
  /** Kemlock was used: the idle time starts over. */
  touch(): Promise<void>
  /** What opening the vault does besides the core's (the session, the idle time, the icon, the first sync). */
  opened(): Promise<void>
}

export function passkeyUnlockHandlers(
  d: Deps,
  context: PasskeyUnlockContext,
): PasskeyUnlockHandlers {
  const { core } = d
  return {
    // Answers while the vault is locked: the lock screen asks it to know whether to offer a passkey
    passkeyUnlockInfo: async (_message, sender) => {
      context.check(sender, popupAndUnlockPage)
      return core.passkeyUnlockInfo()
    },
    passkeyUnlockPrepare: async (_message, sender) => {
      context.check(sender, unlockPage)
      await context.needOpen()
      return core.passkeyUnlockPrepare()
    },
    addPasskeyUnlock: async (message, sender) => {
      context.check(sender, unlockPage)
      await context.needOpen()
      await context.touch()
      return core.addPasskeyUnlock({
        name: message.name,
        password: message.password,
        credentialId: message.credentialId,
        prfOutput: message.prfOutput,
        ...(message.rpId === undefined ? {} : { rpId: message.rpId }),
        ...(message.attachment === undefined ? {} : { attachment: message.attachment }),
        ...(message.transports === undefined ? {} : { transports: message.transports }),
      })
    },
    renamePasskeyUnlock: async ({ id, name }, sender) => {
      context.check(sender, popupAndUnlockPage)
      await context.needOpen()
      await context.touch()
      return core.renamePasskeyUnlock(id, name)
    },
    removePasskeyUnlock: async ({ id }, sender) => {
      context.check(sender, popupAndUnlockPage)
      await context.needOpen()
      await context.touch()
      return core.removePasskeyUnlock(id)
    },
    unlockWithPasskey: async ({ credentialId, prfOutput }, sender) => {
      context.check(sender, unlockPage)
      const state = await core.state()
      if (!state.exists) throw new BackgroundError('noVault')
      // Opened already, by the password in the popup while this page waited: nothing more to do
      if (state.unlocked) return { ok: true, wrongPasswords: 0 }
      const result = await core.unlockWithPasskey({ credentialId, prfOutput })
      if (result.ok) await context.opened()
      return result
    },
  }
}
