// Backup codes, a page of their own: one card per service with how many are left, Copy and Mark used.
import { PageHeader } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { BackupCodes } from './codes'
import type { Vault } from './data'

export function BackupCodesPage(props: { vault: Vault; onBack: () => void }) {
  return (
    <div class="screen">
      <PageHeader
        title={t('popup_backupCodes')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        <BackupCodes backups={props.vault.backups} onChanged={props.vault.reload} />
      </div>
    </div>
  )
}
