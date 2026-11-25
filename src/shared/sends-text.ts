// Sends in words: statuses, sizes, dates and what a Send problem says, shared by the popup and the Sends tab. The words are the
// app's (assets/i18n sends.*), in locales/parts/sends.<lang>.json.
import type { SyncPlace } from './api'
import type { ForeignSendView, SendFailure, SendInvalid, SendStatus, SendView } from './sends'
import { sendFileLimit } from './sends'
import { formatDate, t } from './ui/i18n'

/** "Active", "Used up", "Waiting for its file". */
export const sendStatusText = (status: SendStatus): string => t(`sends_status_${status}`)

/** "Text" or "File". */
export const sendKindText = (kind: 'text' | 'file'): string =>
  t(kind === 'file' ? 'sends_kindFile' : 'sends_kindText')

/** "7 days", "1 day". */
export const sendDaysText = (days: number): string =>
  t(days === 1 ? 'sends_day' : 'sends_days', days)

/** A size in bytes as "3.2 MB". */
export function fileSizeText(bytes: number): string {
  const names = ['sends_sizeB', 'sends_sizeKB', 'sends_sizeMB', 'sends_sizeGB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < names.length - 1) {
    value /= 1024
    unit += 1
  }
  const shown =
    unit === 0 ? String(Math.round(value)) : value >= 10 ? value.toFixed(0) : value.toFixed(1)
  return t(names[unit], shown)
}

/** A clock time, as the browser's language writes it. */
export function formatClock(ms: number): string {
  let language = 'en'
  try {
    language = chrome.i18n.getUILanguage()
  } catch {
    // The page's own language
  }
  return new Intl.DateTimeFormat(language, { timeStyle: 'short' }).format(new Date(ms))
}

/** "Opens: 2" or "Opens: 2 of 5". */
export function sendOpensText(
  send: Pick<SendView | ForeignSendView, 'accessCount' | 'maxAccess'>,
): string {
  return send.maxAccess === undefined
    ? t('sends_opens', send.accessCount)
    : t('sends_opensOf', send.accessCount, send.maxAccess)
}

/** "Deleted on 1 Dec 2026". */
export const sendDeletesText = (deletionAt: number): string =>
  t('sends_deletesOn', formatDate(deletionAt))

/** A row's second line: "Text · Active · Opens: 1 of 3". */
export function sendSummary(send: SendView | ForeignSendView): string {
  return [sendKindText(send.kind), sendStatusText(send.status), sendOpensText(send)].join(' · ')
}

const placeNames: Record<SyncPlace, string> = {
  kemlock: 'popup_placeKemlock',
  webdav: 'popup_placeWebdav',
  vaultwarden: 'popup_placeVaultwarden',
}

const invalidNames: Record<SendInvalid, string> = {
  noName: 'sends_errorNoName',
  noText: 'sends_errorNoText',
  textTooLong: 'sends_errorTextTooLong',
  notesTooLong: 'sends_errorNotesTooLong',
  fileTooBig: 'sends_errorFileTooBig',
  deletion: 'sends_errorDeletion',
  expiry: 'sends_errorExpiry',
  maxAccess: 'sends_errorMaxAccess',
}

/**
 * What a Send problem says. The server's own words (a policy's reason, the biggest file) are shown as text. `received` is for a Send
 * opened from a link, where "no such Send" is the server's one answer for every closed Send.
 */
export function sendProblemText(failure: SendFailure, received = false): string {
  switch (failure.problem) {
    case 'noSync':
      return failure.place === undefined || failure.place === null
        ? t('sends_needsKemlock')
        : t('sends_otherPlace', t(placeNames[failure.place]))
    case 'away':
      return t('sends_away', failure.since === undefined ? '' : formatClock(failure.since))
    case 'sessionEnded':
      return t('sends_sessionEnded')
    case 'network':
      return t('sends_errorNetwork')
    case 'policy':
      return failure.detail === undefined || failure.detail === ''
        ? t('sends_errorPolicyPlain')
        : t('sends_errorPolicy', failure.detail)
    case 'tooLarge':
      return failure.maxSize === undefined
        ? t('sends_errorServer')
        : t('sends_errorTooLarge', fileSizeText(failure.maxSize))
    case 'storage':
      return t('sends_errorStorage')
    case 'notFound':
      return received ? t('sends_notAvailable') : t('sends_errorNotFound')
    case 'rateLimited':
      return t('sends_tooMany', failure.seconds ?? 60)
    case 'upload':
      return t('sends_errorUpload')
    case 'invalid':
      return failure.reason === undefined
        ? t('sends_errorServer')
        : failure.reason === 'fileTooBig'
          ? t('sends_errorFileTooBigLimit', fileSizeText(sendFileLimit))
          : t(invalidNames[failure.reason])
    case 'passwordRequired':
      return t('sends_passwordTitle')
    case 'wrongPassword':
      return t('sends_wrongPassword')
    case 'doesntOpen':
      return t('sends_doesntOpen')
    case 'tooBig':
      return t('sends_receivedTooBig', fileSizeText(sendFileLimit))
    case 'lost':
      return t(received ? 'sends_lostReceived' : 'sends_lostFile')
    case 'badLink':
      return t('sends_notASend')
    case 'bitwarden':
      return t('sends_bitwarden')
    case 'insecure':
      return t('sends_insecure')
    default:
      return t('sends_errorServer')
  }
}
