<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/kemlock-wordmark-dark.svg">
    <img alt="Kemlock" src=".github/assets/kemlock-wordmark-light.svg" width="360">
  </picture>
</p>

<h3 align="center">Kemlock for browsers</h3>

<p align="center">
  Your Kemlock codes and logins in Chrome, Edge, Firefox and Safari.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <a href="https://github.com/Arsslensoft/Kemlock-browser/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Arsslensoft/Kemlock-browser?display_name=tag&include_prereleases"></a>
  <img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-orange">
  <a href="docs/reproducible-builds.md"><img alt="Reproducible builds" src="https://img.shields.io/badge/builds-reproducible-success"></a>
  <br>
  <a href="https://github.com/Arsslensoft/Kemlock-browser/actions/workflows/checks.yml"><img alt="Checks" src="https://github.com/Arsslensoft/Kemlock-browser/actions/workflows/checks.yml/badge.svg"></a>
  <a href="https://github.com/Arsslensoft/Kemlock-browser/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/Arsslensoft/Kemlock-browser/actions/workflows/codeql.yml/badge.svg"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/Arsslensoft/Kemlock-browser"><img alt="OpenSSF Scorecard" src="https://api.securityscorecards.dev/projects/github.com/Arsslensoft/Kemlock-browser/badge"></a>
  <br>
  <img alt="Chrome" src="https://img.shields.io/badge/Chrome-supported-4285F4?logo=googlechrome&logoColor=white">
  <img alt="Edge" src="https://img.shields.io/badge/Edge-supported-0078D7?logo=microsoftedge&logoColor=white">
  <img alt="Firefox" src="https://img.shields.io/badge/Firefox-supported-FF7139?logo=firefoxbrowser&logoColor=white">
  <img alt="Safari" src="https://img.shields.io/badge/Safari-supported-006CFF?logo=safari&logoColor=white">
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-V3-555555">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white">
  <img alt="Preact" src="https://img.shields.io/badge/Preact-11-673AB8?logo=preact&logoColor=white">
</p>

<p align="center">
  <a href="#using-the-extension">Using it</a> ·
  <a href="#what-the-extension-keeps-and-where-it-goes">What it keeps</a> ·
  <a href="#testing">Testing</a> ·
  <a href="#building">Building</a> ·
  <a href="#releases">Releases</a> ·
  <a href="docs/reproducible-builds.md">Reproducible builds</a> ·
  <a href="#what-comes-from-the-app">What comes from the app</a> ·
  <a href="https://github.com/Arsslensoft/Kemlock">Kemlock app</a> ·
  <a href="https://github.com/Arsslensoft/Kemlock-Server">Kemlock Server</a>
</p>

---

The Kemlock browser extension fills one-time codes and logins from a Kemlock vault into
websites. It syncs with your own Vaultwarden or WebDAV folder, as the
[phone app](https://github.com/Arsslensoft/Kemlock) does.

- 🔢 **One-time codes and logins** found on a page by the same rules as the Android app,
  held to the same test cases.
- 🔒 **Locks itself** when the browser is idle, and shows in the toolbar whether the vault is
  locked, open, or no longer syncing.
- 🛡️ **Asks for sites one by one.** It holds no access to websites until you grant it.
- 🌍 **English and French**, in the app's own words.
- 📦 **Reproducible zips**: anyone can rebuild a release from its tag and compare the bytes.

## Using the extension

**Install.** Take `kemlock-<version>-chrome.zip` (Chrome and Edge), `kemlock-<version>-firefox.zip` or
`kemlock-<version>-safari.zip` (Safari: see below) from the [latest release](https://github.com/Arsslensoft/Kemlock-browser/releases/latest), or build
one (below). To load a build unzipped:

- Chrome: `chrome://extensions`, turn on Developer mode, Load unpacked, pick `dist/chrome`.
- Edge: `edge://extensions`, the same, with `dist/chrome`.
- Firefox: `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, pick
  `dist/firefox/manifest.json`. Firefox keeps a temporary add-on until it restarts.
- Safari: it runs an extension only from a Mac app. On a Mac with Xcode, `npm run build:safari`, then
  `npm run safari:project` makes the Xcode project (`dist/safari-xcode`, or the release's
  `kemlock-<version>-safari-xcode.zip`); run it from Xcode and turn Kemlock on in Safari › Settings ›
  Extensions. Signing for the App Store is the owner's: [docs/store/safari.md](docs/store/safari.md).

**First run.** Click the toolbar icon: the setup tab opens.

1. A password for this browser, typed twice. It opens this browser's vault and nothing else, and
   nothing recovers it: if it is forgotten, remove Kemlock from the browser, set it up again and join
   sync, and every item comes back.
2. Where your phone syncs: Kemlock Server, a Vaultwarden, or a WebDAV folder. The phone shows it under
   Settings › Sync. Setup joins that one place and never makes a new one. Before the first sync it says
   what it will bring to the browser and what it will send.
3. Access to all websites, which is optional. It is only for Kemlock's button in sign-in and code
   fields. Refused, the popup and the right-click menu still fill the tab in front.

**Every day.**

- The popup: the site in front comes first, with its login and its live code, Fill login and Fill
  code. Under it, every code (with the shared countdown) and login, search, the vault's own order
  and tags, password health, the generator, recently generated passwords, and Settings.
- In a page: Kemlock's button in a sign-in or code field, or the down arrow in the field, opens a menu
  drawn by the extension, which the page cannot read. Nothing fills until you pick an item, and an item
  fills only on its own site. On a look-alike address the menu says so and makes "Don't fill" the main
  action.
- Right-click an editable field for Fill login, Fill code and New password, and an image for "Add code
  to Kemlock". "Add a code" in the popup reads a setup QR code on the page in front, or a pasted
  `otpauth://` link.
- After a sign-up or a password change on a site, "Save to Kemlock?" and "Update in Kemlock?" offer to
  keep the login. Turn them off in Settings.
- The icon is grey while locked, azure while unlocked, counts the matches of the site in front, shows an
  orange "!" on a look-alike site and an orange dot while sync is stopped. The vault locks after 1, 5
  (the default), 15 or 60 idle minutes and when the computer sleeps or its screen locks.

**Kemlock Server and single sign-on.** The master password, a second step, a passkey and an approval
from another device work with any Kemlock Server. Single sign-on (SSO) does not, until the server
allows this extension: Kemlock Server accepts SSO only from the extension ids on its allow list, the
setting `KEMLOCK_BROWSER_EXTENSION_IDS` (comma-separated, empty by default). A self-hoster who wants
SSO from the extension adds the extension's id to it, then restarts the server: the ids of the store
builds, or the id of their own build.

- Chrome and Edge: open `chrome://extensions` (`edge://extensions` in Edge), turn on Developer mode,
  and the id, 32 letters, is under the extension's name. For the store build it is also the last part
  of the store page's address.
- Firefox: the id is the one in the manifest, `kemlock@arsslensoft.com`; `about:support`, under
  Extensions, lists it as the add-on's ID.
- An unpacked build has an id of its own, from the folder it was loaded from: add that one to test
  with it. The end-to-end tests load the extension under a fixed id,
  [`tests/e2e/extension-key.ts`](tests/e2e/extension-key.ts).

Without the id on the list, SSO is refused and everything else keeps working.

**The Kemlock Server account.** From the popup's sync card, Account and devices opens one tab for what
the account does beyond syncing ([the plan](docs/plans/add-browser-account.md)):

- Create an account on a server from the setup tab, and sign in as this browser.
- Approve or deny a device that is signing in: the five words are worked out here from its key, never
  taken from the server, and a notification tells you of a request within a minute (the live socket
  can't carry it to a browser, so the extension reads the requests while the vault is open).
- The device list, and signing another device out.
- Emergency access: name a trusted contact after comparing their fingerprint, answer their requests,
  or ask for access to the account that named you. The server's part ends at releasing the sealed key,
  so the extension says whether it opens and goes no further.
- The Recovery Kit (three pieces, any two open the account; printed from the tab) and the recovery
  code, and opening an account with two pieces at sign-in.
- The authenticator app and the mailed code as second steps. Security keys, YubiKeys and Duo are set up
  in the web vault.
- Moving a vault off Vaultwarden or WebDAV into Kemlock Server, with the phone's steps and checks. It
  runs once, resumes where it stopped (the vault doesn't sync meanwhile, and the sync card says so), can be
  abandoned before its last step, and is refused when notes have attached files,
  which a browser doesn't keep.

## What the extension keeps, and where it goes

Kemlock is free: sync, the vault's order and tags, and everything else in it, with no paywall and no
Premium check.

**What the browser keeps, and where.**

- The vault, in the extension's own storage (`storage.local`) in the app's formats and under the app's
  keys. The private key is wrapped under scrypt of your browser password, and every value is sealed to
  its ML-KEM-1024 key with AES-256-GCM. No item name, username, website, count or secret is stored
  readable, and the app's own code opens it with the password. Logins, backup codes, keys, notes and
  the other items the extension doesn't show are sealed alike and written back to the sync place
  unchanged.
- Sealed in the same vault: the sync session and its cache, your remembered picks ("Always suggest
  here", for this browser only), the generator's choices, Recently generated passwords (30 days, never
  synced) and the settings.
- Readable, by design: the count of wrong passwords and the time of the last, which are written before
  each try is checked, as on the phone. A forgotten-password lock never erases the vault.
- Kemlock Server sign-in: the device's key, made non-extractable, in the extension's IndexedDB. It is
  useless without the session's tokens, which are inside the sealed vault.
- In memory only (the browser's session storage, lost when the browser closes): the unlocked vault's
  keys. Closing the browser locks it.
- Removing Kemlock from this browser (Settings, or the lock screen) deletes all of this and forgets the
  sync sign-in. The phone and the sync place are untouched.

**What never leaves the browser.**

- The browser password, and the Vaultwarden or Kemlock account's master password: derived into a key in
  the browser and never stored.
- A code's secret: only the digits go to a page, and only after a click. A password goes only to the
  field you picked it for, on the site it belongs to, after the background checks the frame's address
  again.
- Password health and the generator's work: worked out in the browser. Nothing about them is stored in
  the sync file or sent anywhere.
- No telemetry, no analytics, no account of ours. The extension talks to the sync place you chose and to
  nothing else, with two opt-in exceptions, both off by default and both to Have I Been Pwned:
  "Check for breached passwords" asks Pwned Passwords about a password by the first five characters of
  its SHA-1, with padding, and nothing else; and "Look for newer breaches online" (Service breaches)
  asks once a day for breaches newer than the list the extension ships. The same requests go from
  everyone and carry nothing from your vault.
- The order you give your logins in the extension is kept in the sealed vault, for this browser only
  (the app sorts logins by name). Your codes' order, tags and pins are the app's own and sync.
- Copied codes and passwords are cleared from the clipboard after the chosen time (10, 30, 60 or 120
  seconds, 30 by default), only if the clipboard still holds the same value.

**Permissions, and why.** Each one in the manifests (`manifests/`):

| Permission                                | Why                                                                                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                 | The sealed vault, the sync state and the settings, in the extension's own storage, and the unlocked keys in its memory-only session one.                                                                              |
| `alarms`                                  | The idle auto-lock, and sync every five minutes while the vault is open.                                                                                                                                              |
| `idle`                                    | Lock the vault when the computer sleeps or its screen locks (Settings can turn it off).                                                                                                                               |
| `contextMenus`                            | The right-click menu: Fill login, Fill code, New password, and "Add code to Kemlock" on an image.                                                                                                                     |
| `activeTab`                               | Fill, and read a setup QR code, in the tab in front when you ask from the popup or the right-click menu, with no standing access to it.                                                                               |
| `scripting`                               | Put the content script in that tab for that use, and register it for all sites when you grant them.                                                                                                                   |
| `clipboardWrite`, `clipboardRead`         | Copy a code or a password, and clear the clipboard later only if it still holds that value, which means reading it.                                                                                                   |
| `offscreen` (Chrome and Edge)             | The clipboard from the background, which has no page of its own there. Firefox's background page does it directly.                                                                                                    |
| Optional: all websites (`<all_urls>`)     | Kemlock's button in fields on every site, asked for at setup and in Settings › Site access. Without it nothing here changes but the button.                                                                           |
| Optional: `webNavigation`                 | Passkeys: to tell whether a frame that asks for one is of another site than the page, asked for together with all websites when you turn the passkey switch on. Without it only the page's own top frame is answered. |
| Optional: the sync server's address       | Asked for as soon as you type the address, before anything is sent to it: browsers send an extension no CORS headers, so it can't be reached without it.                                                              |
| `identity` (SSO and passkey sign-in)      | The browser's own sign-in window for single sign-on and for a passkey on the Kemlock Server (`identity.launchWebAuthFlow`).                                                                                           |
| `notifications`                           | Tell you that another device is waiting to sign in to your Kemlock account, so you can approve or deny it. Nothing else raises one.                                                                                   |
| `web_accessible_resources`: the menu page | The in-page menu is an extension page in a frame, at an address that changes each browser session (Chrome and Edge), so a page can't find it.                                                                         |

The extension installs with no access to websites. Firefox's manifest declares that it collects no data
(`data_collection_permissions`: `none`).

**Safari.** Its manifest drops `idle`, `identity` and `clipboardRead` (Safari has none of them) and adds
`nativeMessaging`, to the Mac app's own extension handler, which writes and clears the clipboard without a click
and says whether the screen is locked. What Safari can't do: single sign-on and passkey sign-in to Kemlock
Server (no `identity.launchWebAuthFlow`), locking the instant the screen locks (it is asked once a minute), and keeping
the open vault across the background unloading (the vault locks then, until Safari's session storage is known to be
closed to content scripts). [docs/plans/add-safari.md](docs/plans/add-safari.md) says why.

**Minimum browsers.** Chrome and Edge 119, Firefox 140, Safari 18.4 (a first value, from what the core needs:
[docs/safari-checklist.md](docs/safari-checklist.md) step 1 finds the real one). The Dart core is compiled to
WebAssembly with WasmGC, which older versions lack.

## Testing

`npm test` runs the unit tests. `npm run test:e2e` runs the end-to-end tests: the built extension
(`npm run build` first) in a real Chromium, over local fixture sites and an in-memory WebDAV server.

```bash
npm run build
npx playwright install chromium    # once
npm run test:e2e                   # headed: you watch it
E2E_SLOWMO=400 npm run test:e2e    # slower, to follow each step
npx playwright test vault          # one file
npm run test:e2e -- --debug        # step through, with the inspector
E2E_HEADLESS=1 npm run test:e2e    # hidden (Chromium's new headless mode)
npx playwright show-report         # the last run's report
npx playwright show-trace test-results/<test>/trace.zip   # a failed test's trace
```

On CI the job E2E runs the same under `xvfb-run`. The tests that need a real server are skipped unless
you point them at one:

```bash
# Kemlock Server (https; an account with no other trusted device)
KEMLOCK_SERVER_URL=https://kemlock.example KEMLOCK_SERVER_EMAIL=me@example.com \
KEMLOCK_SERVER_PASSWORD='master password' npm run test:e2e -- kemlock-server
# add KEMLOCK_SERVER_TOTP_SECRET=... for an account with an authenticator, and KEMLOCK_SERVER_SSO=1
# for the SSO test, which needs the server to list the extension id (see above)

# Vaultwarden (https, with a Kemlock home made by the app)
VAULTWARDEN_URL=https://vault.example VAULTWARDEN_EMAIL=me@example.com \
VAULTWARDEN_PASSWORD='master password' npm run test:e2e -- vaultwarden
```

Firefox can't run them: [docs/firefox-checklist.md](docs/firefox-checklist.md) lists what is checked by
hand there, and [docs/safari-checklist.md](docs/safari-checklist.md) what is checked by hand on a Mac for
Safari. The store listings are drafted in [docs/store/](docs/store/).

## Building

The build compiles the Dart core (`core/`) to WebAssembly, so it needs the Dart SDK 3.13.5 (the
version CI and the release container use) beside Node 26.13.0, and `git` to fetch Kemlock-core, which
`core/pubspec.lock` pins to a commit. `tool/build.sh` needs neither: it builds in a container that has them.

```bash
npm ci
(cd core && dart pub get --enforce-lockfile)   # once, and when core/pubspec.lock changes
npm run build       # dist/chrome, dist/firefox and dist/safari
npm test
npm run test:e2e    # needs the build, see Testing
npm run lint
npm run typecheck
```

`tool/build.sh` builds the release zips from a commit, the same bytes on any machine: see
[docs/reproducible-builds.md](docs/reproducible-builds.md).

## Releases

Every push to `main` is released by [`release.yml`](.github/workflows/release.yml) once the checks
pass. The next version comes from the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) since the last
`v*` tag: a `feat` is a minor release, a `fix`, `perf` or `revert` (or git's `Revert "..."`) a
patch, and a `!` or a `BREAKING CHANGE` a major one (a minor one while the major is 0). A push of `docs`, `chore`, `test`,
`ci`, `style`, `refactor` or `build` commits alone releases nothing. Nothing is committed for a
release: the version is its tag's (`v0.2.0`), and the build puts it in the manifests and the zips.

The commit is built twice, on two runners, with `tool/build.sh --version`, and it is tagged and
released only if the two builds are the same bytes. Each
[release](https://github.com/Arsslensoft/Kemlock-browser/releases) holds `kemlock-<version>-chrome.zip`
(for Chrome and Edge), `kemlock-<version>-firefox.zip`, `kemlock-<version>-safari.zip`,
`kemlock-<version>-safari-xcode.zip` (the Safari zip in an unsigned Xcode project, made on a Mac runner by
[`safari-project.yml`](.github/workflows/safari-project.yml) after the release, with its sum in
`SHA256SUMS-safari-xcode`) and `SHA256SUMS`, with the changes since the last release in its notes. To check one, run `tool/build.sh v<version>` and compare the sums
([docs/reproducible-builds.md](docs/reproducible-builds.md)).

The stores are off. A job each for Firefox Add-ons, the Chrome Web Store and Edge Add-ons is in
`release.yml`, and runs only when the repository variable `PUBLISH_STORES` is `true` and the secrets
of its `stores` environment are set.

## What comes from the app

The extension looks like the app and speaks its words, so some of its files are made from
the app's. A checkout of the app next to this one (`../kemlock`, or the path in
`KEMLOCK_APP`) is needed to make them again, never to build:

- `src/shared/tokens.css`, from `mobile/lib/ui/theme/tokens.dart`: `npm run tokens`.
- `locales/app/`, from `mobile/assets/i18n`: `npm run locales`.
- `icons/kemlock-*.png`, from `mobile/assets/brand`: `tool/icons/render.sh`.
- `fonts/`, a copy of `mobile/assets/fonts` (Geist, under the SIL Open Font License).
- `test/fixtures/autofill/fields.json`, a copy of the app's field cases, which the
  extension's field finder and the Android app's are both held to.

When the app's checkout is there, the tests check that each of these still matches it. Without
it, those tests are skipped.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) for a security problem. Every
commit is signed off ([DCO](CONTRIBUTING.md#signing-off-dco)), and the
[Code of Conduct](CODE_OF_CONDUCT.md) applies.

## Licence

Kemlock for browsers is free software under the
[GNU General Public License v3.0 or later](LICENSE). The Geist fonts in `fonts/` are under the
SIL Open Font License ([fonts/OFL.txt](fonts/OFL.txt)).

The zips carry the licences of what is compiled or copied into them, in `licenses/`: Geist's
(`Geist-OFL.txt`); Lucide's, whose icon shapes the pages draw (ISC, with the Feather parts under the MIT licence,
`lucide.txt`, copied from `src/shared/ui/LUCIDE-LICENSE.txt`); the Dart SDK's (`dart-sdk.txt`, its runtime is in the compiled core); the licence files of every Dart package the core is compiled from, kemlock_core,
cryptography, zxing2, http, web and what they need (`licenses/dart/<package>/`, copied from the
packages by `tool/build.mjs`, which fails when one has none); and the notices of the data the core
reads: the Public Suffix List (MPL-2.0, `public-suffix-list.txt`), the EFF's large word list
(CC BY 3.0 US, `eff-wordlist.txt`) and the 2FA directory of 2fa.directory (MIT,
`2fa-directory.txt`). The Licences check holds the npm packages
(`.github/scripts/check-licences.mjs`) and the Dart packages
(`.github/scripts/check-pub-licences.mjs`) to GPL-3.0-or-later compatible licences.
