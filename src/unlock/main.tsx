// The tab that asks the browser for a passkey, Windows Hello or a security key (docs/plans/add-passkey-unlock.md).
import '../shared/fonts.css'
import '../shared/tokens.css'
import '../shared/ui/ui.css'
import './unlock.css'
import { render } from 'preact'
import { App } from './App'

try {
  document.documentElement.lang = chrome.i18n.getUILanguage()
} catch {
  // The page keeps the language its HTML says.
}

render(<App />, document.getElementById('app')!)
