// The Sends tab: making a Send and opening one from a link. A tab of its own, since choosing a file closes the popup.
import '../shared/fonts.css'
import '../shared/tokens.css'
import '../shared/ui/ui.css'
import './sends.css'
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
