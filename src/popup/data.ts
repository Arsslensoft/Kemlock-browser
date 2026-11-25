// What the unlocked popup holds: the vault's lists as the background shows them (no secrets).
import type {
  BackupCodeView,
  CardView,
  CodeView,
  IdentityView,
  LoginView,
  NoteView,
  Settings,
} from '../shared/api'
import { ask } from './send'

export interface VaultData {
  codes: CodeView[]
  logins: LoginView[]
  backups: BackupCodeView[]
  settings: Settings
  notes: NoteView[]
  cards: CardView[]
  identities: IdentityView[]
}

export interface Vault extends VaultData {
  /** Asks the background again, after a change. */
  reload: () => Promise<void>
}

export async function loadVault(): Promise<VaultData> {
  const [codes, logins, backups, settings, notes, cards, identities] = await Promise.all([
    ask('codes'),
    ask('logins'),
    ask('backupCodes'),
    ask('settings'),
    ask('notes'),
    ask('cards'),
    ask('identities'),
  ])
  return { codes, logins, backups, settings, notes, cards, identities }
}

/** The codes that are computed here: a code kept on a security key is named, never computed. */
export const computable = (codes: CodeView[]): CodeView[] =>
  codes.filter((code) => !code.onSecurityKey)

/** The backup codes of a service by the code it belongs to: its id, or the issuer's name. */
export function backupsFor(backups: BackupCodeView[], code: CodeView): BackupCodeView[] {
  return backups.filter(
    (backup) =>
      backup.serviceId === code.id || backup.issuer.toLowerCase() === code.issuer.toLowerCase(),
  )
}
