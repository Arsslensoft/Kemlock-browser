// What the background's parts share: the core, and the pieces around it.
import type { CoreApi } from '../shared/api'
import type { AutoLock } from './autolock'
import type { ClipboardManager } from './clipboard'
import type { SyncScheduler } from './sync'
import type { TabStore } from './tabs'
import type { Toolbar } from './toolbar'
import type { VaultSession } from './vault'

export interface Deps {
  core: CoreApi
  tabs: TabStore
  toolbar: Toolbar
  sync: SyncScheduler
  clipboard: ClipboardManager
  autoLock: AutoLock
  vault: VaultSession
  now: () => number
}
