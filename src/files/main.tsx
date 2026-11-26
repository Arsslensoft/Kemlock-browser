// The files tab: choosing a file and sending it, for a new File item, a replacement file and a note's attachments. A tab of its own,
// since the file picker closes the popup, and an upload outlasts it.
import '../shared/fonts.css'
import '../shared/tokens.css'
import '../shared/ui/ui.css'
import './files-tab.css'
import { render } from 'preact'
import { ToastProvider } from '../shared/ui/components'
import { FilesTab } from './app'

try {
  document.documentElement.lang = chrome.i18n.getUILanguage()
} catch {
  // The page keeps the language its HTML says.
}

render(
  <ToastProvider>
    <FilesTab />
  </ToastProvider>,
  document.getElementById('app')!,
)
