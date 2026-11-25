// Where the vault tools' pages are: they stack over Home as the popup's other pages do (src/popup/route.ts).
import type { ItemKind, OrderedKind } from '../../shared/tools-api'

export type ToolsRoute =
  | { name: 'tags' }
  /** The tags of one item, changed with the shared tag editor. */
  | { name: 'itemTags'; kind: ItemKind; id: string }
  | { name: 'reorder'; kind: OrderedKind }
  | { name: 'backupService'; serviceId: string }
  /** Add a service's backup codes; `prefill` is the service's name when it comes from the coverage list. */
  | { name: 'addBackup'; prefill?: string }
  | { name: 'coverage' }
  | { name: 'duplicates' }
  | { name: 'duplicate'; key: string }
  | { name: 'breaches' }

const names: readonly string[] = [
  'tags',
  'itemTags',
  'reorder',
  'backupService',
  'addBackup',
  'coverage',
  'duplicates',
  'duplicate',
  'breaches',
]

/** Whether a route of the popup is one of the tools'. */
export const isToolsRoute = (route: { name: string }): route is ToolsRoute =>
  names.includes(route.name)
