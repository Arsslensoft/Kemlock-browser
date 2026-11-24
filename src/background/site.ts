// Which items a site offers: the core's matching, and the picks the person asked to keep for a host.
import type { CoreApi, SiteMatch } from '../shared/api'
import { picksOn } from './picks'

/** The host of a web address, or null for anything else. */
export function hostOf(address: string): string | null {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname : null
  } catch {
    return null
  }
}

/** What the core matches the address with, and the items picked on this host before ("Always suggest here"). */
export async function siteMatch(core: CoreApi, address: string | null): Promise<SiteMatch> {
  const host = address === null ? null : hostOf(address)
  if (address === null || host === null) return { site: '', logins: [], codes: [] }
  const match = await core.match(address)
  const picked = await picksOn(core, host)
  if (picked.length === 0) return match
  const [logins, codes] = await Promise.all([core.logins(), core.codes()])
  const loginIds = new Set(logins.map((login) => login.id))
  const codeIds = new Set(codes.map((code) => code.id))
  const merged: SiteMatch = {
    site: match.site,
    logins: [...new Set([...match.logins, ...picked.filter((id) => loginIds.has(id))])],
    codes: [...new Set([...match.codes, ...picked.filter((id) => codeIds.has(id))])],
  }
  if (merged.logins.length + merged.codes.length === 0 && match.lookAlikeOf !== undefined)
    merged.lookAlikeOf = match.lookAlikeOf
  return merged
}
