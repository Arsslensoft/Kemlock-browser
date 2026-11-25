// The account page: approving devices, the device list, emergency access, the Recovery Kit, second steps and the move
// (docs/plans/add-browser-account.md, decision A2). One tab, opened from the popup's sync card or a notification.
import '../shared/fonts.css'
import '../shared/tokens.css'
import '../shared/ui/ui.css'
import './account.css'
import { render } from 'preact'
import { ToastProvider } from '../shared/ui/components'
import { App } from './App'

try {
  document.documentElement.lang = chrome.i18n.getUILanguage()
} catch {
  // The page keeps the language its HTML says.
}

render(
  <ToastProvider>
    <App />
  </ToastProvider>,
  document.getElementById('app')!,
)
