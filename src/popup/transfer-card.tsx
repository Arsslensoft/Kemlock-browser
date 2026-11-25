// Settings › Import and Export: the transfer tab opens from here. A tab, because the popup closes the moment a file dialog opens.
import { Button, Group, Section } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'

/** Opens the transfer tab on its Import or Export panel (the popup closes when a tab opens). */
export function openTransfer(panel: 'import' | 'export'): void {
  const url = chrome.runtime.getURL(`src/transfer/index.html#${panel}`)
  void chrome.tabs.create({ url })
}

export function TransferCard() {
  return (
    <Section title={t('transfer_settings_title')}>
      <Group pad>
        <p class="muted">{t('transfer_settings_body')}</p>
        <div class="actions start">
          <Button icon="arrowRight" onClick={() => openTransfer('import')}>
            {t('transfer_settings_import')}
          </Button>
          <Button icon="arrowRight" onClick={() => openTransfer('export')}>
            {t('transfer_settings_export')}
          </Button>
        </div>
      </Group>
    </Section>
  )
}
