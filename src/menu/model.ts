// What the menu lists, as functions of the background's MenuView: which items match the page, which
// screen opens first, and how the picker's search filters.

import type { CodeView, LoginView, MenuView } from '../shared/api'

export type Screen = 'list' | 'picker' | 'guard'

/** The logins the page's site matched, in the order the background gave them. */
export function matchedLogins(view: MenuView): LoginView[] {
  const ids = new Set(view.match.logins)
  return view.logins.filter((login) => ids.has(login.id))
}

/** The codes the page's site matched. */
export function matchedCodes(view: MenuView): CodeView[] {
  const ids = new Set(view.match.codes)
  return view.codes.filter((code) => ids.has(code.id))
}

/** Whether the field wants a code rather than a login. */
export const wantsCode = (view: MenuView) => view.field.kind === 'code'

/** Nothing of the vault matches this site: the picker, or the guard for a look-alike. */
export const knowsNothing = (view: MenuView) =>
  view.match.logins.length === 0 &&
  view.match.codes.length === 0 &&
  (view.passkeys ?? []).length === 0

/** The screen a menu opens on. A new password asks for suggestions, never a login. */
export function firstScreen(view: MenuView): Screen {
  if (view.field.kind === 'newPassword') return 'list'
  if (!knowsNothing(view)) return 'list'
  return view.match.lookAlikeOf !== undefined ? 'guard' : 'picker'
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** The items whose words hold every word of [query]. */
export function search<T>(items: T[], query: string, words: (item: T) => string[]): T[] {
  const wanted = fold(query)
    .split(/\s+/)
    .filter((word) => word !== '')
  if (wanted.length === 0) return items
  return items.filter((item) => {
    const hay = fold(words(item).join(' '))
    return wanted.every((word) => hay.includes(word))
  })
}

export const loginWords = (login: LoginView) => [login.name, login.username, ...login.websites]
export const codeWords = (code: CodeView) => [code.issuer, code.account, ...code.websites]

/**
 * The hue of an item's tile (the mockups': a hash of the lower-cased name, so the same name always gets
 * the same colour, in every menu and every browser).
 */
export function tileHue(name: string): number {
  const text = name.toLowerCase()
  let hash = 7
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 4294967296
  return hash % 360
}

/** The letter on an item's tile: the first of its name, in capitals. */
export const tileLetter = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? '?'
