// Where the popup is: a stack of one page over the home screen.
import type { ToolsRoute } from './tools/routes'

/** What a new login starts with, from a recently generated password. */
export interface Prefill {
  name: string
  password: string
  websites: string[]
  /** A new login starts in this space (the space's page). */
  space?: string
}

export type Route =
  | { name: 'home' }
  | { name: 'login'; id: string }
  | { name: 'passkey'; id: string }
  | { name: 'edit'; id: string | null; prefill?: Prefill }
  | { name: 'addCode' }
  | { name: 'health' }
  | { name: 'backupCodes' }
  | { name: 'generator' }
  | { name: 'recent' }
  | { name: 'settings' }
  | { name: 'spaces'; open?: string }
  // Added by sends
  | { name: 'sends' }
  | { name: 'send'; id: string }
  // Keys, contacts and the PGP tools, which keep their own pages (src/popup/keys)
  | { name: 'keys' }
  // Added by tools: the vault tools' pages (src/popup/tools/)
  | ToolsRoute
  // Notes, cards and identities (items.css, note-page.tsx, card-page.tsx, identity-page.tsx)
  | { name: 'note'; id: string }
  | { name: 'noteEdit'; id: string | null }
  | { name: 'card'; id: string }
  | { name: 'cardEdit'; id: string | null }
  | { name: 'identity'; id: string }
  | { name: 'identityEdit'; id: string | null }
  // Files (src/popup/file-page.tsx, file-edit.tsx)
  | { name: 'file'; id: string }
  | { name: 'fileEdit'; id: string | null }
  // The MFA code's and a service's backup codes' own edit pages (src/popup/code-edit.tsx)
  | { name: 'codeEdit'; id: string }
  | { name: 'backupEdit'; id: string }
