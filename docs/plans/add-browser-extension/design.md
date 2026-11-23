# Design

## Context

See proposal.md for why. What shapes the approach:

- **Every format is the app's.** The vault in storage, sync files,
  Vaultwarden items, sealed values, logins (`add-passwords`, decisions 1, 3
  and 7) and the generator's output must stay byte for byte what the app
  writes, or a phone and the browser stop understanding each other.
  `CLAUDE.md` holds that line for every format other versions read.
- **The app's logic is Dart, and most of it has no Flutter in it.**
  - These import neither Flutter nor `dart:io`:
    - `mobile/lib/crypto` (ML-KEM-1024, ML-DSA, Keccak, scrypt, PBKDF2,
      HKDF, AES-GCM through `package:cryptography`, Bitwarden's
      encryption);
    - `mobile/lib/models`;
    - in `mobile/lib/features/sync`: `sync_merge.dart`, `sync_crypto.dart`
      and `webdav.dart` (over `package:http`);
    - the Vaultwarden engine (`vw_sync`, `vw_items`, `vw_codec`,
      `vw_formats`, `vw_backend`, `vw_key_step`, `vw_webauthn`);
    - `otp.dart` and `otpauth.dart`.
  - The exceptions are small:
    - `kdf.dart` and `bitwarden.dart` derive keys in `Isolate.run`;
    - `sync_kdf.dart` uses Flutter's `compute`;
    - `vw_http.dart` pins certificates through `dart:io`'s `HttpClient`;
    - `vw_api.dart` reads `Platform.isIOS` for Bitwarden's device type.
- **Keccak needs 64-bit integers.** `keccak.dart` keeps its lanes in an
  `Int64List` and says "needs a 64-bit platform (no web build)". ML-DSA's
  Montgomery steps also rely on native 64-bit products. Dart compiled to
  JavaScript has neither.
- **The phone's field rules are Kotlin.** `FieldFinder.kt`
  (`mobile/android/.../autofill`) with its JUnit cases. The
  `fix/autofill-suggestions` work adds word splitting, recovery words,
  boxes in a row and accessible names.
- **Manifest V3.**
  - Chrome and Edge run the background as a service worker that the
    browser stops between events. Firefox runs it as an event page.
  - Both give extensions memory-only session storage, alarms, idle state,
    context menus and optional host permissions.
  - Chrome's service worker has no DOM: a clipboard needs an offscreen
    document there.
- **`add-passwords` is merged** (11916475). Logins, the generator, health,
  the Public Suffix List and `websites` on accounts come from it, under
  these names in `mobile/lib`:
  - `Login` (`models/login.dart`), with `websites`, `previousPasswords`,
    `accountId` (its code), `codeWarning` and `source`, and
    `GeneratedPassword` (`models/generated_password.dart`);
  - `websites` on `OtpAccount` as on `Login`;
  - `PublicSuffixList` (`core/public_suffixes.dart`), and the top-level
    `registrableDomain(host, suffixes:)`, `sharedHosts` and
    `autofillDomains` (`features/autofill/autofill_copy.dart`);
  - `hostMatches`, `loginDomains` and `offeredAccount`
    (`features/logins/login_sites.dart`);
  - `generatePassword`, `generatePassphrase`, `PasswordChoices`,
    `PassphraseChoices` and `FixedByteSource`
    (`features/generator/generator.dart`), and `PasswordRules`
    (`password_rules.dart`), held to `test/fixtures/generator/cases.json`;
  - `loginHealth`, `LoginWarning`, `isWeakPassword` and `lacksItsCode`
    (`features/logins/login_health.dart`), and `passwordScore` and
    `strengthLevel` (`features/lock/password_strength.dart`).

  Site rules by domain are read only by Android's `SiteRules.kt`, from
  `mobile/android/app/src/main/assets/password-manager-resources/password-rules.json`.

## Goals / Non-Goals

**Goals:**

- One implementation of every format and of the sync engines, shared by the
  app and the extension.
- The page never holds more than the value typed into its field. Secrets,
  item lists and the menu stay in extension contexts.
- Every in-page decision (which field, which site, which item) is made
  where the page can't tamper with it.
- One build for Chrome, Edge and Firefox, with a manifest per browser.

**Non-Goals:**

- A second UI framework shared with Flutter. The extension's screens are
  web pages written to the canvas, not Flutter web.
- Running when the vault is locked beyond recognising fields and asking to
  unlock (no index of names outside the vault, unlike the phone's AutoFill
  index).
- Spaces, Safari, passkeys as a WebAuthn provider, and unlocking with
  biometrics or a key: see proposal.md.

## Decisions

### 1. The core is the app's Dart, compiled to WebAssembly

`packages/kemlock_core/` becomes a pure Dart package holding the
platform-free code listed in Context, moved with `git mv`:

- the crypto, the models and the vault store over a storage interface;
- the sync merge, its crypto and the WebDAV client;
- the Vaultwarden engine, its formats and its sign-in steps (not its
  sheets);
- codes and otpauth links (`otp.dart`, `otpauth.dart`);
- from `add-passwords`: the generator and its rules parser,
  `core/websites.dart`, `autofill_copy.dart` and `login_sites.dart`, and a
  Dart port of `SiteRules.kt`'s lookup (decision 11);
- the logic of five files that also hold Flutter or Riverpod. Each is
  split, so the logic moves and the asset loading, provider or widget
  stays in the app:
  - `core/public_suffixes.dart` and `features/backup/two_factor_directory.dart`
    (parsing and lookups);
  - `features/logins/login_health.dart` (the health rules);
  - `features/lock/password_strength.dart` (`passwordScore` and
    `strengthLevel`; the meter widget stays);
  - `features/breaches/pwned_passwords.dart` (the padded range check).

QR reading stays out of the core, so the store build, which reads QR codes
with ML Kit, doesn't gain `zxing2`. The extension's Dart entry depends on
`zxing2` itself, as the free build does.

Each moved file leaves a one-line `export` at its old path, so no import in
the app changes in this change. The app depends on the package by path. A
later cleanup can drop the exports.

The extension compiles an entry in `extension/core/` with
`dart compile wasm` (dart2wasm). In WebAssembly a Dart `int` is a true
64-bit integer, so Keccak's `Int64List` and ML-DSA's products behave
exactly as on the phone, and the app's own test vectors prove it.

**Spike (task 1.2, 21 November 2026).** The app's `lib/crypto` was copied
unchanged, but for its three `Isolate.run` calls, and compiled with the
Flutter SDK's Dart 3.13.5.

- All 63 of the app's ML-KEM, ML-DSA (NIST's ACVP), Keccak, scrypt,
  AES-GCM, PBKDF2, HKDF and Bitwarden vector tests pass with
  `dart test -c dart2wasm`, in Chrome 158 and 119 and in Firefox 160 and
  131, as they do on the VM. In the test runner, Chrome 119 needs
  `--headless=new` and Edge doesn't start, so Edge ran through Playwright
  only.
- The module holding ML-KEM, scrypt and Argon2id is 100 KB of WebAssembly
  (39 KB gzipped), with an 8.8 KB `.mjs` loader.
- It loads in a module service worker (Chrome, Edge) and a module event
  page (Firefox), with `'wasm-unsafe-eval'` in the extension pages' CSP.
- A module holding one very long string constant (375 KB in the spike)
  doesn't compile in Firefox 131 ("expected valid import field name").
  Firefox 160 reads it in 13 ms, and the same data in 16 KB pieces loads in
  both. So the core bundles no large data as constants:
  - the Public Suffix List, the password rules, the word list and the 2FA
    directory ship as extension files;
  - the background reads them and hands them to the core.

  Tests that read their fixtures through `dart:io` need another way in the
  browser (task 2.6). The spike embedded them in 16 KB pieces.

Timed from the background's own start, on the development machine
(Windows 11). The first answer is an ML-KEM-1024 decapsulation of a fixture
vector.

|                                      | Chrome 158 | Chrome 119 | Edge 157  | Firefox 160 | Firefox 131 |
| ------------------------------------ | ---------- | ---------- | --------- | ----------- | ----------- |
| First start, to the first answer     | 39–72 ms   | 43 ms      | 44 ms     | 910 ms¹     | 749 ms¹     |
| A wake, to the first answer          | 15–16 ms   | 21–24 ms   | 16–18 ms  | 19–21 ms    | 58–62 ms    |
| scrypt, N=2^17, r=8, p=1 (an unlock) | 0.5–0.7 s  | 0.6–1.0 s  | 0.5–0.8 s | 1.4 s       | 1.8–2.0 s   |
| Argon2id, 64 MiB, 3 rounds, 4 lanes  | 3.8–3.9 s  | 5.1–5.4 s  | 3.6–4.2 s | 5.7–6.3 s   | 9.4–10.3 s  |

¹ The temporary add-on's first start on a new profile; the page itself
started about 700 ms in.

In Chrome and Edge a wake is a worker stopped through DevTools
(`ServiceWorker.stopAllWorkers`) and woken by a message. In Firefox it is a
reload of the add-on. Under automation, `runtime.reload()` doesn't bring an
unpacked Chrome extension back, so tasks 3.2 and 4.2 stop the worker the
same way.

- _Alternative: a TypeScript port._ Revive `src/utils/crypto.ts` and
  `src/lib/sync.ts` from abcb758 and add Bitwarden's crypto, the
  Vaultwarden engine, logins and the generator in TypeScript. Rejected:
  - a second copy of every format and engine, which must agree with the
    Dart one forever;
  - the Vaultwarden engine and its formats alone are about 4,600 lines of
    Dart, held by about 8,000 lines of tests.
- _Alternative: dart2js._ Rejected: `Int64List` is unsupported, and
  ML-DSA's arithmetic would need rewriting for 53-bit numbers, a second
  copy of the riskiest code.
- _Alternative: Flutter web for the popup._ Rejected: a multi-megabyte
  engine that starts slowly in a popup opened dozens of times a day, and
  no help for the content script or the menu frame.

### 2. Platform seams in the core

The core takes from its host:

- **Storage**: the vault store already reads and writes through
  `lib/core/storage/key_value_store.dart`. That interface moves into the
  core, and the extension implements it over `storage.local` with string
  values exactly as the app's preferences hold them.
- **HTTP**: an `http.Client`. On the phone, today's `IOClient`, with
  pinning. In the extension, a client over `fetch` written with
  `dart:js_interop`, since a service worker has no `XMLHttpRequest`.
  - `package:http`'s own `BrowserClient` already runs on the global
    `fetch`, and works from a service worker (spike 1.3).
  - The extension's client is a small one beside it, so its requests say
    `cache: 'no-store'` and `credentials: 'omit'`. A sync file must never
    come from the browser's cache, and no cookie of the server's goes with
    them.
  - The spike couldn't make Chrome serve a stale file through
    `BrowserClient`, but servers differ in the cache headers they send.
- **Key derivation**: a runner. The phone's runs in `Isolate.run`; the
  web's runs inline, already off any UI because the core lives in the
  background. `kdf.dart`, `bitwarden.dart` and `sync_kdf.dart` take the
  runner instead of calling `Isolate.run` or `compute`.
  - Under dart2wasm, `Isolate.run` compiles but throws
    `Unsupported operation: RawReceivePort` when called (spike 1.2).
  - Inline, scrypt holds the background for its whole length: a message
    sent during a 590 ms run waited 483 ms.
  - Argon2id yields between blocks: a message sent during a 4.2 s run
    waited 6 ms.
  - The vault's scrypt runs at unlock and when a sync passphrase is typed.
    Then nothing waits on the background but the screen that asked, so the
    runner stays inline.
- **Device**: Bitwarden's device type and name, the client name and
  version, and the `client_id`. `vw_api.dart` stops reading `Platform`,
  and the `mobile` it sends as `client_id` in two places becomes the
  host's: `browser` in the extension (spike 1.4).
- **Randomness and time**: `Random.secure()` and `DateTime`, both of which
  work under dart2wasm; tests pass fixed ones, as now.

Certificate pinning stays phone-only. A browser can't accept a certificate
its operating system doesn't trust, and the spec says so.

### 3. The extension's parts

```
extension/
  core/            Dart entry compiled to core.wasm (+ its .mjs loader)
  src/background/  service worker / event page: loads the core, owns the vault,
                   sync, alarms, idle, context menus, badge, messaging
  src/content/     content script, every frame: finds fields, places the
                   button and the menu frame, fills, watches forms being sent
  src/menu/        the in-page menu, an extension page shown in an iframe
  src/popup/       the toolbar popup
  src/setup/       the setup tab, also the "set up again" and access steps
  src/offscreen/   Chrome and Edge only: the clipboard
  src/shared/      message types, tokens, i18n, the icon
  manifests/       chrome.json, firefox.json, merged over base.json at build
```

- **TypeScript with Preact**, built by Vite into one folder per browser.
  The screens follow the canvas.
- **Tokens.** A script generates `src/shared/tokens.css` from
  `mobile/lib/ui/theme/tokens.dart`, and a test fails when the two differ.
- **Fonts.** Geist and Geist Mono are bundled from `mobile/assets/fonts`,
  under the OFL.
- **Strings.** `_locales/en` and `_locales/fr` are generated from the app's
  `en.json` and `fr.json` for the keys the app already has: the
  `sync.problem.*` messages, and others as the screens that share them are
  built. The app has no Save or Update prompts, as Android and iOS show
  their own, so the extension's are its own strings. Those live beside the
  app's.

### 4. Who knows what

- **The background** holds the core and the only copy of keys and secrets.
  It answers typed messages.
  - For a content script, it trusts only the sender the browser reports
    (`sender.tab.id`, `sender.frameId`, `sender.url`, `sender.origin`) and
    ignores any address in the message.
  - Extension pages (popup, menu, setup) are recognised by their
    extension origin.
- **The content script** holds no item. It reports what it found (field
  kinds and boxes) and receives one value to fill, for the field it named,
  after a click in the menu.
- **The menu frame** is a `web_accessible_resources` page with
  `use_dynamic_url`, so pages can't probe for it by a fixed address. It
  lists what the background sends it. Being another origin, it can't be
  read by the page.
- **A code's secret** never leaves the background. The core computes the
  code, and only the six or eight digits travel.

A fill:

1. A click in the menu goes to the background.
2. The background checks that the frame's site still matches the item.
3. It sends the value to that tab and frame (`tabs.sendMessage` with
   `frameId`).
4. The content script checks that the field is the one it registered,
   still visible and not replaced.
5. It sets the value through the element's own value setter, then fires
   `input` and `change` so frameworks see it. Boxes take one character
   each.

### 5. An open vault survives the background being stopped

On unlock, the background keeps the unwrapped private key and the
session's derived keys in memory and in `storage.session`, limited to
trusted contexts. That storage is memory-only, so it is lost when the
browser closes. A restarted service worker reads them back without asking
for the password.

Locking clears both.

Idle time is the time since Kemlock was last used: the popup, the menu or
a fill, as the spec counts it, not the system's own idle state.

- Each use sets an alarm at the end of the chosen time, kept with the
  times in `storage.session`.
- A screen lock is `idle.onStateChanged` reporting `locked`.
- A sleep shows as the alarm each minute firing more than two and a half
  minutes late, since alarms don't fire while the computer sleeps.

- _Alternative: derive again on each wake._ Rejected: it would ask for the
  password every few minutes.
- _Alternative: keep the background alive._ Rejected: Chrome stops an idle
  service worker after about 30 seconds, whatever the extension does.

### 6. Storage is the app's

`storage.local` holds the app's keys and values unchanged: `backmycodes_*`,
the vault registry with one vault, the sealed lists, the sync settings and
state, and the Vaultwarden session and cache. That is why the app's vault
store reads it (the spec's scenario, and a test with the app's code).

The extension adds a few keys of its own, all sealed except the
wrong-password count, as on the phone:

- remembered picks per host;
- the generator's choices;
- the extension's settings;
- recently generated passwords.

A new fixture, `test/fixtures/browser/storage.json`, freezes a dump. It is
never regenerated.

### 7. Fields are found by FieldFinder's rules, held to shared cases

`src/content/fields.ts` ports `FieldFinder`'s rules, as they stand after
`fix/autofill-suggestions`:

- `autocomplete` values;
- strict and soft words, split at camelCase, dashes and underscores;
- recovery words;
- four to ten one-character boxes;
- username, password and new-password fields.

Its input is a field's description (type, `autocomplete`, `inputmode`,
`maxlength`, name, id, placeholder, labels, accessible name, visibility).
The DOM reader builds that description; the rules never touch the DOM.

`mobile/test/fixtures/autofill/fields.json` becomes the cases both suites
read: `FieldFinderTest.kt` and Vitest. A case added for one platform runs
on both.

- Chrome's `ONE_TIME_CODE` prediction isn't visible to extensions, so the
  cases that use it are marked Android-only.
- Visibility is the extension's: on screen, not `display: none`, not
  `visibility: hidden`, opacity above 0.1 along the ancestors, and on top
  at its centre by `elementsFromPoint`.
- A `MutationObserver` re-runs the rules on forms that appear later.

### 8. Sites are matched in the core

The background matches the frame's address as the phone does, with
`add-passwords`' own functions:

- logins by `loginDomains` and `hostMatches` (`login_sites.dart`), over
  `registrableDomain` and `sharedHosts` (`autofill_copy.dart`): the
  registrable domain by the Public Suffix List, and a tenant host or an
  address only on itself;
- accounts by `autofillDomains`, which adds the 2FA directory's domains to
  their websites.

Remembered picks match their host exactly.

**The look-alike check** runs only when nothing matches. It compares the
page's registrable domain with each known one:

- Equal after folding look-alikes: IDN decoded, then a small confusables
  table (`0→o`, `1→l`, `i→l`, `rn→m`, `vv→w`, Cyrillic and Greek letters
  that look Latin).
- Or a Damerau–Levenshtein distance of 1 between the first labels, with
  the same suffix, when the known label has six letters or more.

Two letters off, or a short name, isn't a look-alike. `gitlab.com` stays
apart from `github.com`, and the spec has the case.

- _Alternative: distance 2._ Rejected for exactly that pair.

### 9. The menu resists clickjacking

Published research in 2025 showed password managers' in-page menus filled
after clicks the person never saw: the page faded or covered the menu,
then asked for a click elsewhere. The menu defends three ways:

- **Visibility tracking.** It accepts input only while an
  `IntersectionObserver` with `trackVisibility` reports its frame visible.
  That covers occlusion, opacity and transforms in Chrome and Edge.
- **The content script's check.** It checks its host element and every
  ancestor up to `html` for opacity, `visibility`, `clip-path` and
  `filter`, and `elementsFromPoint` at the click.
- **A delay.** It ignores input for 500 ms after it becomes visible or
  moves.

Firefox lacks visibility tracking, so it relies on the second and third
defences.

The menu's host element sits in a closed shadow root at the end of `body`,
on the top layer through the Popover API where available.

### 10. Saving logins

The content script records a username and password when a form is
submitted, when a button press on a form with a password field is followed
by navigation or the form being removed, or on a sign-in made in two
steps. The pair goes to the background at once and waits in
`storage.session` per tab.

When the next page has loaded, or the form is gone, the background
compares the pair with the vault:

- no login for that site and username: "Save to Kemlock?";
- a different password: "Update in Kemlock?";
- the same password: nothing.

The prompt is a second extension frame at the top right of the page. Saving
writes the login with the form's host as its website and
`source: "autofill"`, and records the old password in `previousPasswords`
(`add-passwords`, decision 7). The pair is dropped after the answer or
five minutes.

### 11. New passwords and site rules

The generator is the core's (`add-passwords`, decision 5):
`generatePassword` and `generatePassphrase`, with the person's
`PasswordChoices` or `PassphraseChoices`. The app's
`test/fixtures/generator/cases.json` already proves the browser's output.

Rules come from the field: `maxlength`, `minlength`, and Apple's
`passwordrules` attribute when a site sets it, read by `PasswordRules`.
Otherwise they come from the list the Android app bundles,
`password-manager-resources/password-rules.json` (Apple's, MIT):

- the extension ships it as a data file (decision 1);
- the core looks a host up as `SiteRules.kt` does, the host itself and then
  each name above it, through a Dart port of that lookup.

A suggested password that fills is added to Recently generated before it
fills: a `GeneratedPassword` (the password, its site and the time), sealed
in the vault. As in the app, it is kept for `generatedPasswordDays` (30)
or until a saved login holds it, and never synced or exported.

### 12. Sync in the browser

The core's engines run unchanged.

**WebDAV.** Requests go over `fetch` with the custom methods (`PROPFIND`,
`MKCOL`), allowed by the host permission granted at setup.

Spike 1.3 ran the app's `webdav.dart`, unchanged, in Chrome's service
worker with the host permission. It used both `BrowserClient` and the
no-store client of decision 2, against Apache's mod_dav
(`bytemark/webdav:2.4`, behind Caddy for TLS). The ETags came back as
`webdav.dart` expects:

- PROPFIND listed the folder (207).
- PUT with `If-None-Match: *` made the file, and got 412 the second time.
- GET gave the text and a strong ETag. PUT with that ETag in `If-Match`
  succeeded once, and got 412 the second time.
- A write from outside the browser was read at once, with its new ETag,
  and the ETag from before it got 412.

Apache gives a weak ETag (`W/"…"`) for a file changed less than a second
before, and `If-Match` never matches a weak ETag. So a read right after a
write can cost one more merge, on the phone too. Firefox wasn't run: its
event page needs the test server's certificate trusted, which task 5.1
sets up.

**Vaultwarden.** The extension signs in with the browser extension's
client id and device type for the browser at hand, and the device name
"Kemlock · Chrome", "· Edge" or "· Firefox". It sends
`Bitwarden-Client-Name` and `Bitwarden-Client-Version`, as the engine does
today.

Spike 1.4 confirmed the values against Vaultwarden 1.37.5, as
`mobile/test/fixtures/vaultwarden/browser/README.md` records:

- `client_id=browser`, with device type 2 (Chrome), 5 (Edge) or 3
  (Firefox), signs in and renews from the extension's background.
- The device list names each device once per device id.
- The server only checks that the client id isn't blank.
- It sends no CORS headers to an extension, so every request rests on the
  host permission for the server.

**When it runs.**

- An alarm every five minutes while the vault is unlocked.
- On unlock.
- Ten seconds after a change made in the browser.
- Sync now.

The revision check keeps idle runs cheap. Problems are the engine's
(`signedOut`, `modeChanged`, `homeMissing`, `removals`, `unsupported`) and
are shown in the popup with the app's messages. The badge carries the
warning dot.

**Items.** Logins are left out of Vaultwarden runs, as on the phone
(`add-passwords`, decision 7). Attached files aren't fetched, and the
engine's attachment step runs in the mode that never deletes.

**Joining.** Setup reuses the engine's home listing and joining. Making a
home isn't offered; Change storage and following a change are the
engine's own flows.

### 13. A security key on the server's own address

A browser decides a WebAuthn request's origin by the page it runs in, and
Vaultwarden compares that origin with its `DOMAIN` exactly. So the
extension can't speak to the key itself the way the phone does over
CTAP2:

1. Setup opens a tab on the server's address, at the web vault's
   `webauthn-fallback-connector.html`, the page Bitwarden's own extension
   uses for the same reason. It passes:
   - the challenge from `TwoFactorProviders2["7"]` as `data`, with `v=1`;
   - its own address as `parent`;
   - the browser's language as `locale`.
2. It injects a small relay into that tab with `scripting.executeScript`,
   under the host permission for the server. The page posts its answer to
   its own window, `{command: "webAuthnResult", data, remember}`, and the
   relay passes it to setup. Setup takes it only from that tab, on the
   server's origin.
3. Setup closes the tab and sends `data` as the token, with
   `twoFactorRemember` from the page's "Don't ask again" box.

Setup holds the step itself, not the background: the spike saw Chrome
restart a service worker that was waiting for the key. For the same reason,
"Sign in to Vaultwarden again" in the popup opens setup at the sign-in
step, since the popup closes when a tab opens.

When the server serves no web vault, the step isn't offered, and the API
key is.

Spike 1.5 recorded both connector pages' addresses, parameters and answers
against Vaultwarden 1.37.5. It signed in with each, in Chrome 158 and 119
and Edge 157, and kept the answers as fixtures in
`mobile/test/fixtures/vaultwarden/browser/`.

- The iframe connector, `webauthn-connector.html`, also works framed in an
  extension page. Vaultwarden 1.37.5 sends that page without framing
  limits, and the key is asked without a tab. It isn't relied on: the web
  vault's other pages already limit framing to Bitwarden's extensions, and
  the connectors could follow.
- Firefox has no virtual authenticator for automation, so its key step is
  on the checklist (8.3).

### 14. The clipboard, cleared only if unchanged

Copying writes through `navigator.clipboard`: from the popup while it is
open, and otherwise from the offscreen document (Chrome and Edge) or the
event page (Firefox).

Clearing is an alarm at the chosen delay. It reads the clipboard and
empties it only if it still holds the copied value. That needs the
`clipboardRead` permission, a line at install ("Read data you copy and
paste"), as other password managers ask.

- _Alternative: clear unconditionally._ Rejected: it would wipe what the
  person copied since.

### 15. Permissions

At install:

- `storage`, `alarms`, `idle`, `contextMenus`, `activeTab`, `scripting`;
- `clipboardRead` and `clipboardWrite`;
- `offscreen` (Chrome and Edge).

No host permissions.

Optional, asked for at setup (spec):

- the sync server's origin, as soon as its address is typed. Vaultwarden
  answers an extension with no CORS headers, so not even the server check
  can be sent without it (spike 1.4);
- `<all_urls>`, for the button in fields. When granted, content scripts
  are registered with `scripting.registerContentScripts` for all frames,
  `about:blank` frames included.

Without `<all_urls>`, the popup and the right-click menu reach the tab in
front through `activeTab` and inject the content script there for that
use. "Add a code" captures the visible tab with `tabs.captureVisibleTab`
(under `activeTab`) and reads QR codes in the core.

Firefox's manifest gives a `gecko.id`, and its data collection declaration
says nothing is collected.

### 16. Adding a code

"Add a code" captures the visible tab as an image. The extension's Dart
entry decodes every QR code in it with `zxing2`, as the free build does,
and the core parses any `otpauth://` link with `otpauth.dart`. The right-click menu's "Add code to
Kemlock" on an image fetches the image from the page's context and does
the same.

The account gets the tab's registrable domain in `websites`
(`add-passwords`). The link offer uses the matching of decision 8 over
logins without a code.

### 17. Minimum browsers

Chrome and Edge 119, and Firefox 140.

The spike (1.2) measured the first versions that run the core:

- Chrome 118 refuses the module (`Unknown type code 0x50`): it has no
  WasmGC.
- Firefox 130 can't link it (`import object field 'JSTag' is not a Tag`).
  dart2wasm's exceptions import `WebAssembly.JSTag`, which Firefox has
  from 131.

Edge numbers its versions as Chromium does, and was run at 157 only.

Firefox's manifest asks 140, the current ESR, not 131. Since 3 November
2025, AMO has required new add-ons to declare their data collection in
`data_collection_permissions`, which Firefox reads from 140. Firefox for
Android reads it from 142, which `gecko_android` asks; Android isn't a
target. The owner chose 140 on 2026-11-21.

The manifests set `minimum_chrome_version` to 119 and
`strict_min_version` to 140.0.

### 18. Build, tests and release

**Build.** `extension/tool/build.sh` builds a commit's files, taken with
`git archive`, in the `extension` target of the image beside
`mobile/tool/docker/flutter.sh`. That is Debian with a pinned Node, and,
once the core is compiled (3.2), the Dart SDK at the Flutter SDK's
version. `--here` uses the machine's own tools.

1. `dart compile wasm` for the core, from task 3.2.
2. Vite for each browser. The tokens and locales are committed files:
   their generators run by hand, and tests hold them to the app's files.
3. A zip with its entries in path order, each dated 1980-01-01.

Two clean builds gave the same SHA-256, and so did a build with Node on
Windows (task 3.5).

`docs/reproducible-builds.md` gains the extension's steps, and AMO gets
the source archive it asks for.

**Tests.**

- The core's existing Dart tests run on the VM as now, and its crypto,
  sync-merge, Vaultwarden-format, generator and fixture tests also run
  with `dart test -p chrome -c dart2wasm`.
- Vitest covers the TypeScript: field rules over the shared cases,
  messaging and sender checks, the menu's visibility gate, and the fill
  setter.
- Playwright with a persistent Chromium context loads the unpacked build
  against local fixture pages:
  - a sign-in;
  - two-step sign-in;
  - boxes;
  - a cross-origin frame;
  - hidden fields;
  - a faded menu;
  - a look-alike host through a hosts mapping;
  - sign-up and password change.
- Sync and setup run against a WebDAV container, and against
  `VAULTWARDEN_URL` when set, as the app's server tests do.
- Firefox gets `web-ext lint`, through `npm run lint:firefox`, which allows only Preact's own `innerHTML` assignment, and a written checklist.

**Commits.** They use an `extension` scope, added to `CLAUDE.md` with the
owner's OK. Moving code into the core uses `refactor(mobile)`.

## Risks / Trade-offs

- [dart2wasm in a service worker is new ground: loading, size, start-up on
  every wake] → Spike 1.2 passed (decision 1):
  - the core's vectors pass in Chrome and Firefox;
  - the module loads in a service worker and an event page;
  - a wake answers in 15–62 ms, well under the 300 ms set.

  The dart2js fallback isn't needed.

- [Argon2id at 64 MiB in WebAssembly may be slow] → Measured: 3.6–6.3 s on
  current browsers, and 9–10 s on Firefox 131. It yields between blocks,
  so the background keeps answering the popup. The setup screen says it is
  opening the key, and the spec asks no time limit.
- [Large data compiled into the core doesn't load in Firefox 131] → The
  data ships as extension files that the core is handed (decision 1).
- [A service worker stopped while it waits for the person] → A step that
  waits, like the security key, is held by the extension page that waits
  (decision 13). The unlocked vault's keys are in `storage.session`
  (decision 5).
- [`package:cryptography` under dart2wasm] → Its pure-Dart algorithms are
  used, as on the phone, never its browser bindings. The vectors prove the
  output.
- [Extracting the core touches many files while other changes are in
  flight] → It lands after `add-passwords` merges. Moves are `git mv` with
  export stubs, so the app's imports and tests don't change. One commit per
  area.
- [The page fights the menu: clickjacking, removed or re-styled hosts] →
  Decision 9. Plus Playwright cases for a faded, covered, moved and
  quick-clicked menu.
- [Content scripts in every frame cost page speed] → The rules run on
  `focusin` and on observed mutations, debounced, never on load for every
  input.
- [Store review of a password manager with broad access] → No host
  permission at install, the reason given at setup, and the source archive
  and build steps for AMO.
- [Vaultwarden may refuse the browser's client id or device type, or
  serve no connector page] → Spikes 1.4 and 1.5 before the screens. The
  API key path always remains.
- [Free sync in the browser while the phone's sync is Premium] → The
  owner's decision. A browser syncs with what a Premium (or free-build)
  phone keeps in sync, and on its own with another browser.
- [The extension writes logins that the app's merge must accept] → It
  writes through the same core, so `add-passwords`' merge tests are the
  browser's too.

## Migration Plan

- **The core extraction** is a pure move with re-exports. It is verified by
  the app's whole test suite before and after, and rolled back by
  reverting its commits.
- **Nothing on phones migrates.** The extension adds a device; phones see
  it as one more writer.
- **Release order**: Chrome Web Store and Edge Add-ons from one zip, then
  Firefox Add-ons. Each store listing can be withdrawn without affecting
  the app.
