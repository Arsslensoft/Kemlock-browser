// The background's side of the transfer tab (docs/plans/add-transfer.md): importing a file or QR images into the vault and exporting
// it as a file or QR codes. Only the transfer tab may ask. A file's items stay in the core until they are merged; what an export
// answers is the plain text of the file, which goes to that one extension page and which the background neither keeps nor logs.
// Every export asks the vault's own password again, in the core, before anything is written.
import type { CoreApi, PageApi, PageRequest } from '../shared/api'
import { BackgroundError } from './errors'
import type { PageSender } from './senders'

type Kinds =
  | 'transferUnlock'
  | 'transferOpen'
  | 'transferOpenQr'
  | 'transferPreview'
  | 'transferPreviewKit'
  | 'transferPlan'
  | 'transferApply'
  | 'transferCancel'
  | 'transferExportInfo'
  | 'transferExport'
  | 'transferExportQr'

/** The transfer requests' handlers, as `pageHandlers` takes them. */
export type TransferImpl = {
  [K in Kinds]: (
    message: Extract<PageRequest, { kind: K }>,
    sender: PageSender,
  ) => ReturnType<PageApi[K]>
}

/** What the handlers use of the background. */
export interface TransferHost {
  core: CoreApi
  /** Throws unless the vault is open. */
  needOpen(): Promise<void>
  /** Kemlock was used: the idle time starts over. */
  touch(): Promise<void>
  /** What opening the vault does besides the core's. */
  opened(): Promise<void>
  /** A change was made in the browser: sync follows shortly. */
  changed(): Promise<void>
}

/** Only the transfer tab may ask: the popup closes with a file dialog, and no other page has a use for it. */
function check(sender: PageSender): void {
  if (sender.page !== 'transfer') throw new BackgroundError('refused')
}

export function transferHandlers(host: TransferHost): TransferImpl {
  const { core } = host
  /** The steps that read or write the vault: open, and counted as use. */
  const use = async (sender: PageSender): Promise<void> => {
    check(sender)
    await host.needOpen()
    await host.touch()
  }
  return {
    transferUnlock: async ({ password }, sender) => {
      check(sender)
      if (!(await core.state()).exists) throw new BackgroundError('noVault')
      const result = await core.unlock(password)
      if (result.ok) await host.opened()
      return result
    },
    transferOpen: async ({ data }, sender) => {
      await use(sender)
      return core.transferOpen(data)
    },
    transferOpenQr: async ({ images }, sender) => {
      await use(sender)
      return core.transferOpenQr(images)
    },
    transferPreview: async ({ token, password }, sender) => {
      await use(sender)
      return core.transferPreview(token, password)
    },
    transferPreviewKit: async ({ token, pieces }, sender) => {
      await use(sender)
      return core.transferPreviewKit(token, pieces)
    },
    transferPlan: async ({ token, options }, sender) => {
      await use(sender)
      return core.transferPlan(token, options)
    },
    transferApply: async ({ token, options }, sender) => {
      await use(sender)
      const result = await core.transferApply(token, options)
      // What was imported is a change made here: sync carries it, and the badge counts it
      await host.changed()
      return result
    },
    transferCancel: async ({ token }, sender) => {
      check(sender)
      // A locked vault has dropped the file already
      if ((await core.state()).unlocked) await core.transferCancel(token)
    },
    transferExportInfo: async (_message, sender) => {
      await use(sender)
      return core.transferExportInfo()
    },
    transferExport: async (request, sender) => {
      await use(sender)
      return core.transferExport({
        format: request.format,
        password: request.password,
        ...(request.exportPassword === undefined ? {} : { exportPassword: request.exportPassword }),
        ...(request.kinds === undefined ? {} : { kinds: request.kinds }),
      })
    },
    transferExportQr: async (request, sender) => {
      await use(sender)
      return core.transferExportQr({
        format: request.format,
        password: request.password,
        ...(request.transferPassword === undefined
          ? {}
          : { transferPassword: request.transferPassword }),
      })
    },
  }
}
