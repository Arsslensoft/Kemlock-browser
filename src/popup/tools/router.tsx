// The vault tools' pages: which one a route of the popup shows.
import type { Vault } from '../data'
import type { Route } from '../route'
import { AddBackupPage, BackupServicePage, CoveragePage } from './backup-pages'
import { BreachesPage } from './breaches-page'
import { DuplicateReviewPage, DuplicatesPage } from './duplicates-pages'
import { ReorderPage } from './reorder-page'
import type { ToolsRoute } from './routes'
import { ItemTagsPage, TagsPage } from './tags-page'

export function ToolsRouter(props: {
  route: ToolsRoute
  vault: Vault
  onBack: () => void
  go: (route: Route) => void
}) {
  const { route, vault, onBack, go } = props
  switch (route.name) {
    case 'tags':
      return <TagsPage vault={vault} onBack={onBack} go={go} />
    case 'itemTags':
      return <ItemTagsPage kind={route.kind} id={route.id} vault={vault} onBack={onBack} />
    case 'reorder':
      return <ReorderPage kind={route.kind} vault={vault} onBack={onBack} />
    case 'backupService':
      return (
        <BackupServicePage
          serviceId={route.serviceId}
          vault={vault}
          onBack={onBack}
          onOpenLogin={(id) => go({ name: 'login', id })}
        />
      )
    case 'addBackup':
      return <AddBackupPage prefill={route.prefill} vault={vault} onBack={onBack} onDone={onBack} />
    case 'coverage':
      return <CoveragePage vault={vault} onBack={onBack} go={go} />
    case 'duplicates':
      return <DuplicatesPage vault={vault} onBack={onBack} go={go} />
    case 'duplicate':
      return <DuplicateReviewPage keyText={route.key} vault={vault} onBack={onBack} />
    case 'breaches':
      return <BreachesPage vault={vault} onBack={onBack} />
  }
}
