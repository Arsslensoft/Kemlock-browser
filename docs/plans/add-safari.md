# Safari

The extension ships to Chrome, Edge and Firefox. This plan adds Safari on macOS (and the same web
extension on iOS and iPadOS, which share the build), which `add-browser-extension` left for "a
later change". Safari runs a web extension only inside a signed Mac app, so the change has two
halves: a `safari` build of the extension, like Chrome's and Firefox's, and a script and a CI job
that wrap that build in an Xcode project.

Nothing here can be built or run on Windows or Linux. The extension's own build, its tests and the
unit tests of every fallback run anywhere; the Xcode project, Safari itself and the signing run
on a Mac, and `docs/safari-checklist.md` says what to check there.

## Why

The owner asked for a finished product: Chrome, Edge, Firefox and Safari. Safari is the default
browser of every Mac and iPhone, and a person who keeps their Kemlock codes on the phone expects
them in Safari on the Mac too.

Safari is a WebKit web extension. It takes the manifest and most of the `chrome.*` API, but not all
of it, and the extension leaned on four things Safari lacks:

- `chrome.offscreen`: Chrome's clipboard goes through an offscreen document. Safari has none.
- `chrome.idle`: the auto-lock's "lock when the screen locks".
- `chrome.identity`: `launchWebAuthFlow`, which Kemlock Server's single sign-on and passkey
  sign-in ride on.
- Smaller gaps that throw when an API is missing at the top of the background, which would stop it
  from starting at all: `storage.session.setAccessLevel`, `contextMenus` (absent on iOS) and
  `scripting.registerContentScripts` (absent before Safari 17.4).

## What changes

- **A `safari` target.** `manifests/safari.json`, merged over `manifests/base.json` like the
  others, and built by `tool/build.mjs safari` into `dist/safari`, then zipped by `tool/zip.mjs`
  as `kemlock-<version>-safari.zip`.
  - The background is a non-persistent page (`scripts`, as Firefox's), which Safari runs with a
    DOM, so the clipboard needs no offscreen document, and the offscreen page is left out of the
    Safari folder.
  - The manifest asks for nothing Safari ignores: `idle`, `identity` and `clipboardRead` are
    taken out of the permissions (`$remove` in the browser's manifest), `offscreen` is Chrome's
    own, and `nativeMessaging` is added (below). `strict_min_version` in
    `browser_specific_settings.safari` is the first Safari that runs the core: 18.4 is a first
    value, from what dart2wasm needs, for the checklist's step 1 to confirm.
- **Feature detection, not browser sniffing.** `src/shared/capabilities.ts` asks the browser
  what it has (`offscreen`, `idle`, `identity`, `contextMenus`, `scripting.registerContentScripts`,
  `storage.session.setAccessLevel`). The background asks it, so a future Safari that gains an API
  gets it without a change, and so do the browsers that have all of them.
  - No `idle`: no listener. Locking after the idle time and when the computer sleeps (the
    one-minute alarm that fires late) work as everywhere, and the lock on a locked screen comes
    from the Mac app instead (below).
  - No `identity`: no browser hooks, so Kemlock Server sign-in by single sign-on and by passkey
    isn't offered, and setup doesn't show those two buttons.
  - No `contextMenus`: no right-click menu, and no listener.
  - No `registerContentScripts`: the content script comes from `activeTab`, as when access to
    all sites isn't given.
  - A content script that Safari registers with fewer options than Chrome: three spellings are
    tried in turn.
  - No `setAccessLevel`: the session storage is used as it is, and the checklist checks that a
    content script can't read it.
- **The Mac app as the native side.** Safari lets a page write the clipboard only after a click,
  and a background timer has none, so Safari's background asks the app that holds the extension
  (`runtime.sendNativeMessage`, the `nativeMessaging` permission; Safari sends only to its own
  app). `tool/safari/SafariWebExtensionHandler.swift` replaces the handler Xcode generates, and
  `src/background/native.ts` is its other half, in one small protocol that both files state the
  version of, and a test holds them to.
  - The clipboard: the app writes the copy as concealed, so clipboard managers leave it out (on
    iOS it stays on the device and expires at the extension's clear time), and answers the
    pasteboard's change count. The clear later sends that count back, and the app clears only if it
    is still the pasteboard's, so something copied since is never erased, on a Mac or on iOS, and
    nothing is read (iOS asks the person before a read). Where the app is not ours or fails, the
    page's own `navigator.clipboard`, then `execCommand('copy')`, write instead; with no count that
    copy is not cleared.
  - The session storage: Safari has no `setAccessLevel`, so it may be open to content scripts, and
    the open vault's keys are not kept in it: the vault locks when the background unloads. The
    checklist's step 10 finds Safari's default, and the answer can then change.
  - The locked screen: the app says whether the session's screen is locked, asked at each beat of
    the auto-lock (the alarm each minute), so the vault locks within a minute of it, as Chrome
    and Firefox lock at once from `idle`.
- **The core knows Safari.** `Browser.safari` in the core (Bitwarden's device type for a Safari
  extension, 20), found from the user agent and given by the build, so the account's device list
  says "Kemlock · Safari".
- **An Xcode wrapper.** `tool/safari/convert.sh` runs `xcrun safari-web-extension-converter` on
  `dist/safari` with the app name, the bundle identifier and the icon, then patches the generated
  project's settings (the deployment targets, the team left empty, the marketing version taken
  from the manifest). The inputs the owner gives are documented; signing is theirs.
- **GitHub Actions.** A `macos-latest` job in `checks.yml` builds the Safari folder's project
  unsigned (`xcodebuild ... CODE_SIGNING_ALLOWED=NO`) from the Build job's folder. The release
  workflow's builds make the Safari zip with the other two, so it is in the release and its
  `SHA256SUMS`; a `macos-latest` job then builds the release's unsigned Xcode project from that
  zip and attaches it.
- **Docs.** `docs/store/safari.md` (the Mac App Store and TestFlight listing, like `chrome.md` and
  `firefox.md`) and `docs/safari-checklist.md` (what to check by hand on a Mac). The
  reproducible-builds doc names the third zip.
- **Tests.** The manifest and the build target (`tool/safari.test.mjs`), the wrapper's
  arguments and settings patch, and a unit test for each fallback.

## Not in this plan

What Safari can't do, and why:

- **Single sign-on and passkey sign-in on Kemlock Server.** Both ride on
  `identity.launchWebAuthFlow`, which Safari doesn't have. A tab with a watcher could stand in
  for the window, but the redirect would have to end on an address the server allows, and
  Safari's own address (`safari-web-extension://<uuid>/`) has a new random id for each person's
  install, so the server can't list it as it lists Chrome's and Firefox's. Safari signs in with
  the master password (and the second steps, and the approval from a phone); setup hides the two
  buttons. A later change can add a callback address on the server itself.
- **Locking at once when the screen locks.** `idle.onStateChanged` is how Chrome and Firefox hear
  a locked screen; Safari has no `idle`. The Mac app is asked once a minute, so the lock comes
  within a minute, not at once. On iOS and iPadOS there is nothing to ask (the extension does
  not run while the device is locked).
- **Clearing a copy the page alone wrote.** Without the app's handler (a stock Xcode project) the
  copy is written by the page and nothing can say whether it is unchanged, so it is left.
- **An open vault across the background unloading.** The other browsers keep the unlocked vault's
  keys in `storage.session`; Safari does not until its default is known to be safe (above), so the
  vault locks more often there.
- **The page reading the clipboard** (`clipboardRead`). Safari has no such permission: the app
  does it.
- **Fixed per-session menu addresses (`use_dynamic_url`)**, which are Chrome's. Safari's
  extension address already has a random id per install.
- **A Swift handler that has been compiled and run.** It is a page of Swift that nobody could build
  on the machine it was written on. The `Safari (macOS)` job compiles it on every change, and
  `docs/safari-checklist.md` steps 1.5, 3.5 and 6 run it.
- **The Xcode project and the signing in the repository.** The project is generated each time
  (`xcrun safari-web-extension-converter` is the only tool that writes one correctly), and a
  signed build needs the owner's Apple Developer team, a certificate and an App Store Connect
  record, which no workflow here holds. The owner builds and signs from the generated project.
- **iOS and iPadOS specifics.** The build is the same, and the converter makes an iOS target
  too, but the popup's size, the missing right-click menu and the Mac-only checks are for the
  owner to run on a device once. No iOS job in CI.

## Tasks

### 1. The target

- [x] 1.1 `manifests/safari.json`, `$remove` in the manifest merge, and the `safari` browser in
      `tool/build.mjs`, `tool/zip.mjs`, `package.json` and `src/shared/env.d.ts`.
- [x] 1.2 `tool/safari.test.mjs`: the merged manifest, the removals, the pages, the zip's name.

### 2. What Safari lacks

- [x] 2.1 `src/shared/capabilities.ts` and its use at the top of the background, in the
      vault's restore, the menus, the content scripts and the browser hooks.
- [x] 2.2 The clipboard and the locked screen through the Mac app: `native.ts`, the Swift handler,
      the page fallback, the clear by the pasteboard's change count, the auto-lock's
      `screenLocked`.
- [x] 2.3 Setup: no SSO or passkey buttons where there is no sign-in window (strings in
      `locales/parts/safari.*.json`).
- [x] 2.4 The core: `Browser.safari`, from the user agent and from the build.
- [x] 2.5 Tests for each fallback.

### 3. The Xcode project

- [x] 3.1 `tool/safari/convert.sh`, `project.mjs` and the Swift handler, with their tests.
- [x] 3.2 `.github/workflows/checks.yml`: the `macos-latest` job.
- [x] 3.3 `.github/workflows/safari-project.yml`: the Safari zip is in the release, and the Xcode project
      attached from `macos-latest`.

### 4. Docs

- [x] 4.1 `docs/store/safari.md`.
- [x] 4.2 `docs/safari-checklist.md`.
- [x] 4.3 `docs/reproducible-builds.md` and `CLAUDE.md`: the third zip.

### 5. Left to a Mac

- [ ] 5.1 The first run of `tool/safari/convert.sh`, the Xcode build, and every step of
      `docs/safari-checklist.md`, on the minimum Safari and the current one.
- [ ] 5.2 The minimum Safari: measure which first runs the core (WasmGC and `WebAssembly.JSTag`),
      and set `strict_min_version` in `manifests/safari.json` to it.
- [ ] 5.3 Signing, the App Store Connect record and the first TestFlight build.
