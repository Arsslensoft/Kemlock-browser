// Backup codes, a page of their own: one card per service with how many are left, Copy and Mark used.
import { Button, PageHeader } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { BackupCodes } from './codes'
import type { Vault } from './data'
import type { Route } from './route'

export function BackupCodesPage(props: {
  vault: Vault
  onBack: () => void
  /** Opens a tool of the backup codes (adding a service's, one service's page, which codes have none). */
  onRoute?: (route: Route) => void
}) {
  return (
    <div class="screen">
      <PageHeader
        title={t('popup_backupCodes')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        {props.onRoute !== undefined && (
          <div class="actions start">
            <Button icon="plus" onClick={() => props.onRoute?.({ name: 'addBackup' })}>
              {t('tools_addServiceCodes')}
            </Button>
            <Button onClick={() => props.onRoute?.({ name: 'coverage' })}>
              {t('tools_missingCodes')}
            </Button>
          </div>
        )}
        <BackupCodes
          backups={props.vault.backups}
          onChanged={props.vault.reload}
          onRoute={props.onRoute}
          onOpen={
            props.onRoute === undefined
              ? undefined
              : (serviceId) => props.onRoute?.({ name: 'backupService', serviceId })
          }
          onEdit={
            props.onRoute === undefined
              ? undefined
              : (serviceId) => props.onRoute?.({ name: 'backupEdit', id: serviceId })
          }
        />
      </div>
    </div>
  )
}
