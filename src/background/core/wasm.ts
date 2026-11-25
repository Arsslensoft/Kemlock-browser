// Loads the Dart core (core/, compiled to WebAssembly) and gives the background its `CoreApi` (design decisions 1 and 2).
//
// The module and its loader sit in core/ of the extension's own files; the data it doesn't hold (design decision 1: the Public
// Suffix List, the word list, the 2FA directory) is read here and handed to it, with the callbacks it needs from the browser
// (the sign-in flow of SSO, the page that asks a passkey) and the key that seals the open vault's keys for `storage.session`.
import { adaptCore, KemlockError, open, type CoreBridge } from './bridge'
import { compile, compileStreaming, type CompiledApp } from './loader'
import type { CoreApi } from '../../shared/api'
import { detect } from '../../shared/capabilities'

/** What the background lets the core ask of the browser. Each is optional: without one, the way it serves is not offered. */
export interface CoreHooks {
  /** `identity.launchWebAuthFlow`: opens the provider's page and answers the address the trip ends at, or null if cancelled. */
  launchWebAuthFlow?(url: string): Promise<string | null>
  cancelWebAuthFlow?(): Promise<void>
  /**
   * Asks a passkey or security key, in a page of the extension (WebAuthn needs a page). Takes the options as JSON
   * (`challenge`, `rpId`, `credentialIds`, `userVerification`, `prfInput`, binary values base64url) and the server's address;
   * answers the assertion as JSON (`credentialId`, `authenticatorData`, `clientData`, `signature`, `userHandle?`, `prfOutput?`).
   */
  passkeyAssertion?(optionsJson: string, server: string): Promise<string | null>
  /** Where the identity API ends a trip (`identity.getRedirectURL()`). */
  redirectUrl?: string
}

const sessionKeyName = 'kemlock.sessionKey'

function base64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

/** The key the core seals the open vault's keys with: random for the browser session, kept in `storage.session`. */
async function sessionKey(): Promise<string> {
  const held = (await chrome.storage.session.get(sessionKeyName))[sessionKeyName]
  if (typeof held === 'string' && held.length > 0) return held
  const made = base64(crypto.getRandomValues(new Uint8Array(32)))
  await chrome.storage.session.set({ [sessionKeyName]: made })
  return made
}

/** A file of the extension, as text; undefined when it can't be read (the core goes without it). */
async function readText(path: string): Promise<string | undefined> {
  try {
    const response = await fetch(chrome.runtime.getURL(path))
    return response.ok ? await response.text() : undefined
  } catch {
    return undefined
  }
}

/** The browser's own sign-in flow, and where it ends. */
function identityHooks(): CoreHooks {
  if (!detect().identity) return {}
  const { identity } = chrome
  return {
    async launchWebAuthFlow(url) {
      try {
        return (await identity.launchWebAuthFlow({ url, interactive: true })) ?? null
      } catch {
        // The person closed the window, or the provider refused: the sign-in goes on as cancelled
        return null
      }
    },
    redirectUrl: identity.getRedirectURL(),
  }
}

/**
 * The browser the core is told it runs in, when the build knows better than the user agent: Safari's says neither Chrome nor
 * Firefox, so the core would call it Chrome (core/lib/src/browser.dart). Chrome's own zip also runs in Edge, which only the user
 * agent tells, so the others are left to it.
 */
export function browserHint(built: string | undefined): { browser?: string } {
  return built === 'safari' ? { browser: 'safari' } : {}
}

async function compileCore(): Promise<CompiledApp> {
  const url = chrome.runtime.getURL('core/core.wasm')
  try {
    return await compileStreaming(fetch(url))
  } catch (error) {
    // A server that doesn't call it application/wasm is a TypeError here; the bytes compile all the same
    if (!(error instanceof TypeError)) throw error
    return compile(await (await fetch(url)).arrayBuffer())
  }
}

/** Loads the core. Call it once, at the background's start. */
export async function loadCore(hooks: CoreHooks = {}): Promise<CoreApi> {
  const [app, key, publicSuffixList, wordList, twoFactorDirectory, breachList] = await Promise.all([
    compileCore(),
    sessionKey(),
    readText('core/data/public_suffix_list.dat'),
    readText('core/data/eff_large_wordlist.txt'),
    readText('core/data/two_factor_directory.json'),
    readText('core/data/breaches.json'),
  ])
  const instance = await app.instantiate({})
  instance.invokeMain()
  const bridge = (globalThis as { kemlockCore?: CoreBridge }).kemlockCore
  if (bridge === undefined) throw new KemlockError('failed', 'the core did not register itself')
  open(
    await bridge.init({
      ...identityHooks(),
      ...hooks,
      ...browserHint(typeof __BROWSER__ === 'undefined' ? undefined : __BROWSER__),
      version: chrome.runtime.getManifest().version,
      sessionKey: key,
      publicSuffixList,
      wordList,
      twoFactorDirectory,
      breachList,
    }),
  )
  return adaptCore(bridge)
}
