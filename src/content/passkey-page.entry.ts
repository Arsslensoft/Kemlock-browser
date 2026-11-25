// The page script's entry (built as `passkey-main.js`, registered in the page's own world at `document_start`): see passkey-page.ts.
import { installPasskeyPage } from './passkey-page'

installPasskeyPage(window)
