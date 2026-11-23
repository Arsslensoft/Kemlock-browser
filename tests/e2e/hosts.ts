import { domainToASCII } from 'node:url'

// The names the tests browse to. The browser maps every name to the fixture server
// (--host-resolver-rules), so these are plain https addresses with no port.
export const hosts = {
  /** The site the vault's Orbit Cloud login belongs to. */
  orbit: 'orbit-cloud.com',
  /** Another subdomain of it: the login is offered here. */
  orbitApp: 'app.orbit-cloud.com',
  /** A sign-in host the login doesn't name; the picker's "Always suggest here". */
  orbitAuth: 'id.orbitauth.net',
  /** A digit for a letter: the look-alike guard. */
  lookAlike: 'orbit-c1oud.com',
  /** A Cyrillic o for a Latin one: the same guard. */
  homograph: domainToASCII('оrbit-cloud.com'),
  /** The site's name as a subdomain of another, and as the end of another name. */
  suffixTrick: 'orbit-cloud.com.evil.io',
  endTrick: 'evilorbit-cloud.com',
  /** A site of its own, with a frame the Orbit Cloud page embeds. */
  evil: 'evil.test',
  /** A new site: sign-up and save. */
  harbor: 'harbornotes.app',
  /** Similar to github.com, but a different site: the picker, not the guard. */
  gitlab: 'gitlab.com',
  /** Two tenants of a shared suffix. */
  samGithub: 'sam.github.io',
  alexGithub: 'alex.github.io',
  /** The WebDAV server. */
  dav: 'dav.kemlock.test',
} as const

export const allHosts: string[] = Object.values(hosts)
