// The keys tab: the popup's keys, contacts and PGP screens in a page of their own, where a file can be chosen and a long job
// (an RSA key, a big message) is not cut off by the popup closing (docs/plans/add-keys.md).
import '../shared/fonts.css'
import '../shared/tokens.css'
import '../shared/ui/ui.css'
import '../popup/popup.css'
import './keys-tab.css'
import { render } from 'preact'
import { ToastProvider } from '../shared/ui/components'
import { KeysTab } from './app'

try {
  document.documentElement.lang = chrome.i18n.getUILanguage()
} catch {
  // The page keeps the language its HTML says.
}

render(
  <ToastProvider>
    <KeysTab />
  </ToastProvider>,
  document.getElementById('app')!,
)
