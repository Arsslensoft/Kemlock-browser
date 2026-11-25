// The transfer tab: importing into the vault and exporting from it (docs/plans/add-transfer.md). A tab, because the toolbar popup
// closes the moment a file dialog opens.
import '../shared/fonts.css'
import '../shared/tokens.css'
import '../shared/ui/ui.css'
import './transfer.css'
import { render } from 'preact'
import { ToastProvider } from '../shared/ui/components'
import { App } from './App'

try {
  document.documentElement.lang = chrome.i18n.getUILanguage()
  document.title = chrome.i18n.getMessage('transfer_tabTitle') || 'Kemlock'
} catch {
  // The page keeps the language and title its HTML says.
}

render(
  <ToastProvider>
    <App />
  </ToastProvider>,
  document.getElementById('app')!,
)
