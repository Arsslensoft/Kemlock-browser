// Pure helpers for the lists: grouping a code's digits, searching, health tags and counts.
import type { CodeView, LoginView } from '../shared/api'

/** "123456" as "123 456", "12345678" as "1234 5678"; a Steam code as it is. */
export function groupCode(code: string): string {
  if (/^\d+$/.test(code)) {
    if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
    if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`
  }
  return code
}

/** The host of a website the vault holds, which may be written with or without a scheme. */
export function hostOf(website: string): string {
  try {
    return new URL(website.includes('://') ? website : `https://${website}`).hostname || website
  } catch {
    return website
  }
}

const contains = (haystack: (string | undefined)[], needle: string): boolean =>
  haystack.some((text) => text !== undefined && text.toLowerCase().includes(needle))

/** Search by name, account or website, whatever the case. An empty query matches. */
export function codeMatches(code: CodeView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || contains([code.issuer, code.account, ...code.websites], needle)
}

/** Search by name, username or website, whatever the case. An empty query matches. */
export function loginMatches(login: LoginView, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || contains([login.name, login.username, ...login.websites], needle)
}

/** The vault's tags over codes and logins, sorted, for the filter. */
export function allTags(codes: CodeView[], logins: LoginView[]): string[] {
  const tags = new Set<string>()
  for (const item of [...codes, ...logins]) for (const tag of item.tags) tags.add(tag)
  return [...tags].sort((a, b) => a.localeCompare(b))
}

export type HealthTag = 'reused' | 'weak' | 'breached' | 'withoutItsCode'

/** The tags a login shows. A login set to "Don't warn" doesn't show the one it stopped. */
export function healthTags(login: LoginView, breachedOn = true): HealthTag[] {
  const { health } = login
  const tags: HealthTag[] = []
  if (breachedOn && health.breached === true) tags.push('breached')
  if (health.reused) tags.push('reused')
  if (health.weak) tags.push('weak')
  if (health.withoutItsCode && !health.ignored) tags.push('withoutItsCode')
  return tags
}

export interface HealthCounts {
  reused: number
  weak: number
  withoutItsCode: number
  breached: number
}

export function healthCounts(logins: LoginView[], breachedOn = true): HealthCounts {
  const counts: HealthCounts = { reused: 0, weak: 0, withoutItsCode: 0, breached: 0 }
  for (const login of logins) for (const tag of healthTags(login, breachedOn)) counts[tag] += 1
  return counts
}
