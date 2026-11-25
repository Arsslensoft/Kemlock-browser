// Helpers for the Sends tests: `installChrome` of testing.ts with the Sends strings added to its messages, and fixtures. Nothing here
// is imported by the extension itself.
import appEn from '../../locales/app/en.json'
import appFr from '../../locales/app/fr.json'
import baseEn from '../../locales/en.json'
import baseFr from '../../locales/fr.json'
import popupEn from '../../locales/parts/popup.en.json'
import popupFr from '../../locales/parts/popup.fr.json'
import sendsEn from '../../locales/parts/sends.en.json'
import sendsFr from '../../locales/parts/sends.fr.json'
import type { ForeignSendView, SendDetail, SendView } from '../shared/sends'
import { installChrome, type FakeChrome } from './testing'

const sets = {
  en: { ...baseEn, ...appEn, ...popupEn, ...sendsEn } as Record<string, string>,
  fr: { ...baseFr, ...appFr, ...popupFr, ...sendsFr } as Record<string, string>,
}

/** A message with its `{name}` placeholders filled in order of first appearance, as the browser does. */
export function sendsMessage(
  lang: 'en' | 'fr',
  name: string,
  subs: (string | number)[] = [],
): string {
  const text = sets[lang][name]
  if (text === undefined) return ''
  const names: string[] = []
  return text.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
    if (!names.includes(placeholder)) names.push(placeholder)
    return String(subs[names.indexOf(placeholder)] ?? '')
  })
}

/** A fake `chrome` whose messages include the Sends strings. */
export function installSendsChrome(lang: 'en' | 'fr' = 'en'): FakeChrome {
  const fake = installChrome(lang)
  const i18n = (globalThis as unknown as { chrome: { i18n: { getMessage: unknown } } }).chrome.i18n
  i18n.getMessage = (name: string, subs?: string | string[]) =>
    sendsMessage(lang, name, subs === undefined ? [] : Array.isArray(subs) ? subs : [subs])
  return fake
}

export const sendView = (over: Partial<SendView> = {}): SendView => ({
  id: 's1',
  kind: 'text',
  readable: true,
  name: 'Wi-Fi',
  status: 'active',
  accessCount: 1,
  maxAccess: 3,
  deletionAt: Date.parse('2026-12-01T12:00:00Z'),
  disabled: false,
  hasPassword: false,
  hideEmail: false,
  ...over,
})

export const sendDetail = (over: Partial<SendDetail> = {}): SendDetail => ({
  ...sendView(),
  notes: 'for the guests',
  text: 'the password is on the fridge',
  ...over,
})

export const foreignSend = (over: Partial<ForeignSendView> = {}): ForeignSendView => ({
  id: 'f1',
  kind: 'text',
  status: 'active',
  accessCount: 0,
  deletionAt: Date.parse('2026-12-01T12:00:00Z'),
  disabled: false,
  ...over,
})
