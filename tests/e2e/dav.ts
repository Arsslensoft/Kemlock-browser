// The WebDAV folder the sync tests join, and the app's sync files that fill it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Kemlock } from './kemlock'
import { hosts } from './hosts'
import { makeSyncFile, openSyncFile, saltOf, type SyncDoc } from './otp'
import type { WebDavServer } from './webdav-server'

const here = dirname(fileURLToPath(import.meta.url))
const app = <T>(name: string): T =>
  JSON.parse(readFileSync(join(here, 'fixtures', 'app', name), 'utf8')) as T

export const FOLDER = `https://${hosts.dav}/kemlock/`
export const SYNC_PATH = '/kemlock/backmycodes-sync.json'
export const DAV_LOGIN = { username: 'sam', password: 'dav-secret' }

/** The app's own "personal" sync file: GitHub, a counter code, Steam, and GitHub's backup codes. */
export const personal = app<{ passphrase: string; text: string; decrypted: SyncDoc }>(
  'sync-personal.json',
)

/** An export-shaped vault file with keys, notes, passkeys and deletions, and its raw key. */
export const everyKind = app<{ own: { key: string; file: string } }>('sync-every-kind.json').own

/** A vault file with an account and two logins, and its raw key. */
export const withLogins = app<{ own: { key: string; file: string } }>('sync-with-logins.json').own

export function seedFile(dav: WebDavServer, text: string): void {
  dav.seed('/kemlock/', { 'backmycodes-sync.json': text })
}

/** What the folder holds now, opened with the passphrase. */
export function readFolder(dav: WebDavServer, passphrase: string): SyncDoc {
  return openSyncFile(dav.text(SYNC_PATH)!, { passphrase })
}

/** The phone writes again: the same file, the same key, a new document. */
export function phoneWrites(dav: WebDavServer, doc: SyncDoc, passphrase: string): void {
  dav.put(SYNC_PATH, makeSyncFile(doc, passphrase, saltOf(dav.text(SYNC_PATH)!)))
}

/**
 * Joins the folder as the setup tab's steps do, through the background: the folder and its login,
 * the sync passphrase, and the first sync's summary. Returns the step it ended on.
 */
export async function joinFolder(kemlock: Kemlock, passphrase: string): Promise<string> {
  let step = await kemlock.call('signInWebdav', { folder: FOLDER, ...DAV_LOGIN })
  for (let i = 0; i < 5 && step.step !== 'done'; i++) {
    if (step.step === 'passphrase') {
      step = await kemlock.call('answerStep', { answer: { step: 'passphrase', passphrase } })
    } else if (step.step === 'firstSync') {
      step = await kemlock.call('answerStep', { answer: { step: 'firstSync', go: true } })
    } else {
      return step.step
    }
  }
  return step.step
}
