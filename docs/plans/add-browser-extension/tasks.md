# Tasks

**Where commands run.** Flutter commands run from `mobile/`, Dart commands
for the core from `packages/kemlock_core/`, and Node commands from
`extension/`.

**What "passes" means**, unless a task says otherwise: the named tests
pass, and the usual checks stay clean.

- For Dart code: `flutter analyze` (or `dart analyze` in the core) and
  `dart format --output=none --set-exit-if-changed`.
- For the extension: `npm run lint` and `npm run typecheck`.

**Commits** follow `CLAUDE.md`: one change each, a feature's tests in their
own commit after it, and a fix's regression test with the fix. No fixture
under `mobile/test/fixtures` is regenerated; new fixtures go beside the old.

**Order.** This change needs `add-passwords` merged first: its logins, its
generator, its Public Suffix List matching and `websites` on accounts. It
was merged into `main` in 11916475.

**Servers.** Tests against a real Vaultwarden run when `VAULTWARDEN_URL` is
set, as `mobile/test/vaultwarden_server/server_kit.dart` describes. Without
one, they are skipped, and the task leaves a `- Not done:` note.

## 1. Groundwork

- [x] 1.1 Read what `add-passwords` shipped: the final names of the `Login` model, `registrableDomain` and `sharedHosts`, the generator's entry point and `cases.json`, and the `websites` key on accounts. Correct design.md decisions 1, 8 and 11 to those names. Verify `openspec validate add-browser-extension --strict` passes.
  - Done 2026-11-21. The names are in the design's context.
  - Five files mix logic with Flutter or Riverpod, so 2.5 splits them.
  - Site rules by domain were Kotlin only, so 2.5 also ports `SiteRules.kt`'s lookup.
  - The proposal now cites the plans a337b39c removed through the history.
- [x] 1.2 Spike dart2wasm in a scratch package that imports the crypto from `mobile/lib/crypto` by path.
  - Run the ML-KEM, ML-DSA, Keccak, scrypt, AES-GCM and Bitwarden vector tests with `dart test -p chrome -c dart2wasm`, and in Firefox.
  - Load the compiled module in a Manifest V3 service worker (Chrome) and an event page (Firefox).
  - Measure the cold wake to a first answer, a scrypt unlock at the vault's parameters, and Argon2id at 64 MiB and 3 rounds.
  - Record the results and the lowest browser versions that pass under design decisions 1 and 17.
  - Verify the record exists. If the vectors fail, write the dart2js fallback into design decision 1 before going on.
  - Done 2026-11-21. The crypto was copied into the scratch package rather than imported, as its `Isolate.run` calls had to run inline there. All 63 vectors pass in Chrome 158 and 119 and Firefox 160 and 131. The floor is Chrome and Edge 119, and Firefox 131, not 121. Large data can't be compiled into the core for Firefox 131. Decisions 1, 2 and 17 and the risks hold the record.
- [x] 1.3 Spike a `package:http` client over `fetch` written with `dart:js_interop`. From the spike's service worker, with a host permission, send `PROPFIND`, `PUT` with `If-Match`, and `GET` to a WebDAV container. Record under design decision 12, and verify that the ETags come back as the app's `webdav.dart` expects.
  - Done 2026-11-21 in Chrome, with `webdav.dart` unchanged over `BrowserClient` and over a no-store client (decisions 2 and 12).
  - Not done: Firefox, whose event page needs the test server's certificate trusted. Task 5.1 runs it.
- [x] 1.4 From Vaultwarden's source, record the client ids and the Bitwarden device types it accepts for the Chrome, Edge and Firefox extensions. With `VAULTWARDEN_URL` set, sign in from the spike's service worker with those values. Record them under design decision 12 and in `mobile/test/fixtures/vaultwarden/browser/README.md`. Verify that the sign-in succeeds, or leave a `- Not done:` note.
  - Done 2026-11-21 against a local `vaultwarden/server:1.37.5`, from Chrome's and Edge's service workers and Firefox's event page. The server sends no CORS headers, so setup now asks for the server's origin before its first request (browser-sync spec, decision 15).
- [x] 1.5 Against a real Vaultwarden with its web vault and `DOMAIN` set, find the WebAuthn connector page Bitwarden's clients open. Record its address, the parameters it takes and the answer it returns, and save the answer as a fixture beside the README of 1.4. Use Chrome DevTools' virtual authenticator for the key. Verify the token signs in, or leave a `- Not done:` note and keep the API key path.
  - Done 2026-11-21 in Chrome 158 and 119 and Edge 157: the fallback connector in a tab, and the iframe connector in an extension page, both signed in (decision 13). The answers were for the challenge without `appid`, which Chrome refuses on the plain-http test server.
- [x] 1.6 Ask the owner for an `extension` commit scope in `CLAUDE.md` and, on their OK, add it beside `pwa`. Verify `CLAUDE.md` lists it.
  - The owner agreed on 2026-11-21.

## 2. The shared core

- [ ] 2.1 Add `packages/kemlock_core` as a pure Dart package (no Flutter), with `package:cryptography`, `package:http`, `package:xml` and `package:crypto` at the app's versions. Make the app depend on it by path. Verify `flutter pub get --enforce-lockfile` and `flutter analyze` in `mobile/`, and `dart analyze` in the core.
- [ ] 2.2 Cut the platform seams of design decision 2, still in `mobile/lib`. That is: a key-derivation runner taken by `kdf.dart`, `bitwarden.dart` and `sync_kdf.dart`; device info taken by `vw_api.dart`; and an `http.Client` taken wherever `vw_http.dart` was called. The app passes today's isolate, `Platform` and pinned client. Verify that the app's whole test suite passes unchanged.
- [ ] 2.3 With `git mv`, move into the core `lib/core/storage/key_value_store.dart`, `lib/crypto`, `lib/models` and `lib/vault/vault_store.dart`, with their tests. Each old path keeps a one-line `export`. Verify that the app's whole suite passes with no import changed, and that `dart test` passes in the core.
- [ ] 2.4 Move the same way the sync merge, sync crypto and WebDAV client, the Vaultwarden engine and formats (not its sheets), with their tests and `fake_vaultwarden.dart`. Verify that the app's suite passes, and the core's tests on the VM.
- [ ] 2.5 Move the same way `otp.dart`, `otpauth.dart`, the generator, the Public Suffix List matching and the password rules parser of `add-passwords`, the strength meter, and `pwned_passwords.dart`, with their data files and tests. Split the five files decision 1 names, so their logic moves and their Flutter stays. Port `SiteRules.kt`'s lookup to Dart in the core. Verify the app's suite, and that `test/fixtures/generator/cases.json` still passes on the VM.
- [ ] 2.6 Run the core's vector, sync-merge, Vaultwarden-format, generator and fixture tests with `dart test -p chrome -c dart2wasm`, and add that run to the project's checks. Verify that it passes.

## 3. The extension's skeleton

- [x] 3.1 Add `extension/`:
  - `package.json` with pinned versions and a lockfile (TypeScript, Vite, Preact, Vitest, Playwright, `web-ext`);
  - `tsconfig.json` and the Vite entries of design decision 3;
  - `manifests/base.json`, `chrome.json` and `firefox.json`, with decision 15's permissions and decision 17's minimum versions.

  Verify that `npm ci && npm run build` writes `dist/chrome` and `dist/firefox`, and that `npm run lint:firefox` passes. That is, `web-ext lint` finds no error, notice or warning but Preact's own `innerHTML` assignment, which the owner accepted on 2026-11-21. ESLint keeps markup out of the extension's own code.
  - Done 2026-11-21. Firefox's minimum is 140, the owner's choice that day (decision 17).

- [ ] 3.2 Add `extension/core/`: a Dart entry over `kemlock_core` that exposes the background's calls through `dart:js_interop`, built by `dart compile wasm` into the background bundle with its loader. Add the Dart SDK to 3.5's image and the compile to `tool/build.sh`, and check that two clean builds still match. Verify a Playwright test: the unpacked Chrome build's background answers an ML-KEM decapsulation of a fixture vector, through the core.
- [x] 3.3 Add the token and locale generators of design decision 3, with tests that fail when `tokens.dart` or the app's `en.json` and `fr.json` change without them. Bundle Geist from `mobile/assets/fonts`, and make the toolbar icons for the five states of the popup spec from `tool/icons/brand.svg`. Verify `npm test`.
  - Done 2026-11-21. `npm run tokens` and `npm run locales` write the files. Each guard was seen to fail on a changed colour and a reworded message.
  - The app's strings taken so far are the `sync.problem.*` messages. The app has no Save or Update prompts, as Android and iOS show their own, so the extension writes its own.
  - Three toolbar images (locked, unlocked, sync stopped) come from `tool/icons/render.sh`. The count and "!" states are the browser's badge over the unlocked one, as the canvas draws them.
- [x] 3.4 Add the typed messages and the background's sender checks of design decision 4. Verify Vitest: a content-script message naming another origin is answered for the sender's own frame only; a message from a page that isn't the extension's is refused; extension pages are recognised by their origin.
  - Done 2026-11-21. In Chrome 158, the menu frame, loaded from its per-session address, was seen to send from the extension's own origin.
- [x] 3.5 Add `extension/tool/build.sh`, and a target in the Docker image beside `mobile/tool/docker/flutter.sh`. Document the steps in `docs/reproducible-builds.md`. Verify that two clean builds give zips with the same SHA-256.
  - Done 2026-11-21, ahead of the core. Two clean container builds gave the same SHA-256, the second with an empty npm cache. A build with Node 26.7.0 on Windows gave it too.
  - The image holds Node only for now. Task 3.2 adds the Dart SDK at the Flutter SDK's version and the core's compile step, then checks the bytes again.

## 4. The browser's vault

- [ ] 4.1 Implement `KeyValueStore` over `storage.local`, and the setup's first step (a password typed twice, with the strength meter), making a vault through the core. Verify Playwright: setup makes a vault, and a scan of the profile's extension storage finds none of the test items' names, usernames, websites or secrets.
- [ ] 4.2 Unlocking and locking in the background, with the keys in `storage.session` (design decision 5) and the wrong-password count. Tell 4.3's auto-lock when the vault unlocks, is used and locks, and add its listeners. Verify Playwright:
  - stopping the service worker through DevTools keeps the vault open;
  - restarting the browser locks it;
  - three wrong passwords show the count and time after the popup reopens;
  - the right one clears it and says so once.
- [x] 4.3 Auto-lock at 1, 5, 15 and 60 minutes and the lock on screen lock, through `idle` and `alarms`. Verify Vitest with a fake clock and idle state, for each setting and for activity resetting it.
  - Done 2026-11-21 in `src/background/autolock.ts`, ahead of the core while group 2 waits for the security-audit merges. It covers the sleep lock too.
  - Task 4.2 calls `unlocked`, `used` and `locked` from the vault, and adds `listenForAutoLock` at the background's start.
- [ ] 4.4 Build the lock screen, unlocking from the in-page menu, and "Remove Kemlock from this browser" from the lock screen and from Settings, all per the canvas. Verify Playwright: unlocking in the menu frame opens the vault, and the page's script can't read the field; removing empties the extension's storage and reopens setup.
- [ ] 4.5 Add `mobile/test/fixtures/browser/storage.json`, a dump of a browser vault holding one of each item kind, written once. Add a test in `mobile/test/vault/` that the app's vault store opens it with its password and lists those items. Verify it passes.

## 5. Sync

- [ ] 5.1 Setup's place step, the WebDAV step (folder, username, password, passphrase), and the access step asking for the server's origin. Verify Playwright against a WebDAV container: a folder made by the app's code joins; a wrong passphrase stores nothing; refusing access keeps setup on the access step.
- [ ] 5.2 The Vaultwarden steps:
  - the server check: https only, Vaultwarden, version;
  - the master password, with "Opening the key" for Argon2id;
  - the second steps: an authenticator code, an email code with "Send it again", a YubiKey OTP, and the API key for Duo and otherwise;
  - "Remember this browser";
  - the device name.

  Verify Vitest over the core's fake Vaultwarden for each method and refusal, and Playwright with `VAULTWARDEN_URL`: a remembered browser signs in again without the step, and the device list shows "Kemlock · Chrome".

- [ ] 5.3 The security key step of design decision 13, using 1.5's connector. Verify Playwright with a DevTools virtual authenticator against `VAULTWARDEN_URL`: the key signs in; a server reached at another name shows the address to use before a key is asked; a server with no web vault offers the other methods.
- [ ] 5.4 Homes: the list with storage and counts, joining, the sealed passphrase checked against the seal, the plain warning, "no home yet", and the first-sync summary (with the line that logins aren't synced with Vaultwarden). Verify Vitest over the fake for each, and that setup can't make a home.
- [ ] 5.5 The schedule of design decision 12, Sync now, and the problems: the popup's messages, and the badge's dot for a stopped sync. Verify Vitest with a fake clock (runs on unlock, every five minutes, ten seconds after a change; none while locked), and that each of the five problems shows the app's message and leaves the browser's items alone.
- [ ] 5.6 Round-trip tests through the browser, by WebDAV and by Vaultwarden:
  - a key, a note with an attached file, a passkey and an item kind the core doesn't know come back to the phone's side unchanged, and the file is still on the server;
  - the removal guard stops a run that would remove 6 of 22 items.

  Verify they pass.

- [ ] 5.7 Logins in sync: through WebDAV in `add-passwords`' format, with the old password pushed into `previousPasswords` on a change in the browser and on a lost merge; left local with Vaultwarden. Verify the spec's "two passwords at once" scenario, and that a Vaultwarden run writes no cipher for a login.
- [ ] 5.8 The settings' sync card: server, account, storage, home, last sync, device, the Logins line, Sync now, Change storage (with the engine's acknowledgement and warnings) and Sign out. Verify Vitest: signing out keeps the browser's items and sends no delete to the fake server.

## 6. The popup

- [ ] 6.1 The Codes and Logins lists per the canvas:
  - live codes, the shared ring, the warning colour and next code in the last five seconds, and HOTP's next-code button;
  - the vault's order and tags as a filter (changed on their own pages: `docs/plans/add-vault-tools.md`);
  - "On your security key" for accounts kept on a key;
  - search.

  Verify Vitest component tests for each.

- [ ] 6.2 The site card: the background matches the active tab, there is a card per match, and Fill code and Fill login act on the tab. Verify Playwright: a fixture page on a mapped orbit-cloud.com shows the card, and Fill login fills it.
- [ ] 6.3 Copying, and clearing only an unchanged clipboard, per design decision 14: the offscreen document in Chrome and the event page in Firefox. Verify Playwright with clipboard permissions: after 30 seconds the clipboard is empty; text copied meanwhile stays.
- [ ] 6.4 A login's page: websites, username, the password hidden until shown, its strength and change date, the linked code and backup codes, previous passwords newest first, remembered sites with Forget, Edit (with Generate) and Delete. Also backup codes: copy, mark used, the count left. Verify Vitest, and that a changed password lands first in `previousPasswords`.
- [ ] 6.5 Health worked out in the browser (Reused, Weak, "Without its code", "Don't warn for this login"), and the breach check behind its off-by-default switch, through the core's Pwned Passwords client with padding. Verify Vitest:
  - the counts row reads "2 reused · 1 without its code" for the fixture vault;
  - with the switch off, the fake range server gets no request;
  - with it on, only five hex characters and padding are sent.
- [ ] 6.6 The generator (Random and Passphrase, the app's defaults, the separator, remembered choices that aren't synced) and Recently generated (Copy, "Save as login"). Verify Vitest: the UI's output for fixed bytes equals a `cases.json` case; Save as login removes the entry.
- [ ] 6.7 "Add a code":
  - capture the visible tab, decode QR codes with `zxing2` in the extension's Dart entry, and parse with the core's `otpauth.dart`;
  - pasting a link;
  - the right-click menu on an image;
  - the page's site as the account's website;
  - the duplicate check, and the offer to link to the site's login.

  Verify Playwright on a fixture page showing a setup QR code: the account is added with that website; a URL-only QR code adds nothing; a duplicate names the existing account.

- [ ] 6.8 Settings, the toolbar icon's five states and badge count, the system theme, and French. Verify Playwright screenshots of the popup in light, dark and French, looked at against the canvas, and Vitest for each icon state.
- [ ] 6.9 Check that nothing asks for Premium. Verify a Vitest test that renders every popup and setup screen and finds no paywall and no Premium badge, and that the backup codes view has no coverage or "get new codes" tool.

## 7. Filling on pages

- [ ] 7.1 Move `FieldFinderTest.kt`'s cases into `mobile/test/fixtures/autofill/fields.json`: each field's description and the expected kind, with `ONE_TIME_CODE` cases marked Android-only. Make the JUnit test read them. Verify that the JUnit suite passes with the same number of cases as before.
  - Half done 2026-11-21. `fields.json` holds all 98 cases: every `FieldFinder` call of `FieldFinderTest` and `LoginFieldFinderTest`, recorded once while both passed. 31 are marked `androidOnly`, with why: apps' autofill hints, Chrome's predictions, or frames of other sites in one screen.
  - Not done: the JUnit suite reading the file. `build/security-audit-android` edits `FieldFinderTest.kt` (the page's scheme), so the switch waits for that merge.
- [x] 7.2 Add `src/content/fields.ts` (the rules of design decision 7) and its DOM reader, with visibility. Verify Vitest:
  - every shared case not marked Android-only gives the expected kind;
  - jsdom pages for labels, `aria-label`, boxes, recovery fields, hidden fields and two-step sign-in give the right fields.
  - Done 2026-11-21: the 67 shared cases pass, and `src/content/dom.test.ts` covers the pages, plus shadow roots and a covered field.
- [ ] 7.3 The button and the menu frame: a web-accessible page with a dynamic address, a closed shadow host on the top layer, placement under the field, the down arrow and Escape, the unlock prompt while locked, and the "Button in sign-in and code fields" switch. Verify Playwright: the page's script can't reach the menu's text; turning the switch off removes the buttons.
- [ ] 7.4 The click gate of design decision 9. Verify Playwright: a menu faded to opacity 0, covered by another element, moved under the pointer, or clicked within 500 ms fills nothing; a plain click after the delay fills.
- [ ] 7.5 The fill path of design decision 4: the background checks the frame's site again, a single-frame send, the content script's checks, the value setter and events, and boxes one character each. Verify Playwright on fixture pages: a React-controlled field keeps the value; six boxes get their digits; a field in a cross-origin frame is matched by that frame.
- [x] 7.6 Matching in the core (design decision 8). Then the picker with search, its address line and "Always suggest here" (remembered in this browser, not synced), and the guard. Verify Dart tests:
  - accounts.x and app.x match;
  - shared suffixes and tenant hosts match only exactly;
  - orbit-c1oud.com and a Cyrillic look-alike get the guard;
  - gitlab.com against github.com gets the picker.

  Also verify Playwright for the picker remembering a pick on id.orbitauth.net.
  - Done 2026-11-24. The matching, the picker, its "Always suggest here" and the guard were built with the menu; what was left was the website rules'
    cases. `core/test/website_rules_test.dart` runs the app's `rules.json` (copied to `test/fixtures/websites/`, held by `tool/copies.test.mjs`)
    through Kemlock-core's `fillsOn` and `phoneDomains` and through the extension's matcher, for logins and codes. Cards and identities
    carry no websites in Kemlock-core's models, so there is nothing of theirs to match (`docs/plans/add-items.md`, decision 1).

- [ ] 7.7 The code after the password, behind its switch, and the right-click menu (Fill login, Fill code, New password) reaching the tab through `activeTab`. Verify Playwright: after a login fills, the next page's code field opens its menu and stays empty until picked; right-clicking an unrecognised field fills it.
- [ ] 7.8 The optional all-sites permission at setup and in Settings › Site access, with content scripts registered only when it is granted. Verify Playwright: refused, pages have no button and the popup's Fill login still fills the tab; granted later, the next page load has buttons.
- [ ] 7.9 New-password suggestions (a strong password and a passphrase), with site rules from `maxlength`, `minlength`, `passwordrules` and the bundled list, filling the field and its confirmation, and Recently generated. Verify Playwright: a sign-up form gets the same password in both fields; `maxlength="16"` gives 16 characters; the password is under Recently generated.
- [ ] 7.10 Saving and updating (design decision 10): capturing on submit, on a button press followed by navigation, and across a two-step sign-in; the prompt frame; Save, Update and Not now; nothing for an unchanged password. Verify Playwright: a sign-up saves a login with the form's host; a password change offers Update and keeps the old password first under Previous passwords; signing in with the held password shows no prompt.

## 8. Release

- [ ] 8.1 Add the README's extension section: what the browser keeps and where, what never leaves it, each permission and why, that it is free, and the minimum browser versions. Verify that each permission in the manifests is named there.
- [ ] 8.2 Write the Chrome Web Store, Edge Add-ons and Firefox Add-ons listings and privacy answers, with screenshots taken from the built extension. Prepare the AMO source archive with 3.5's steps. Verify that the zips load unpacked in Chrome, Edge and Firefox, and that `npm run lint:firefox` passes.
- [ ] 8.3 Write `extension/docs/firefox-checklist.md`, covering what Playwright can't run in Firefox: setup, unlock, a fill, a save, a copy that clears, and sync. Run it on the minimum Firefox and on the current one, and record the results in it. Verify both runs are recorded.
- [ ] 8.4 Check the whole loop with a phone (a simulator or emulator) and the browser on one WebDAV folder, then on one Vaultwarden:
  - a code added on the phone fills in the browser;
  - a code added in the browser shows on the phone;
  - a login saved in the browser reaches the phone through WebDAV, and stays local with Vaultwarden.

  Record the results in this task. Verify each line is recorded, or leave a `- Not done:` note for what couldn't be reached.

## Workflow follow-up

- Archive the change once the owner has reviewed it and the stores have accepted the first release.
- Update the design canvas for the decisions made after it was drawn: the look-alike rule of design decision 8, the optional all-sites permission, and Add a code.
