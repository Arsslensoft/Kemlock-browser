// The toolbar popup (design decision 3).
import '../shared/fonts.css'
import '../shared/tokens.css'
import '../shared/ui/ui.css'
import './popup.css'
import './tools/tools.css'
import { render } from 'preact'
import { ToastProvider } from '../shared/ui/components'
import { App } from './app'

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
