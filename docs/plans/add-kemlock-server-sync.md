# Kemlock Server sync in the browser

The extension signs in to a Kemlock account on Kemlock Server and syncs the account's vault
through the Kemlock API (`/kem/v1`), as the phone does since `add-kemlock-server-sync` in the app.
Every Kemlock kind comes through as a `kem1` item and is kept. Codes, backup codes and logins are
shown and filled, and cards and identities too once their matching lands. The extension becomes a
device of the account: it is approved from the phone, listed in the device list, and signed out
from there.

This plan changes `add-browser-extension` (`docs/plans/add-browser-extension/`), the extension's
first plan, carried here from the app's history when the extension got its own repository. Where
the two disagree, this one wins.

## Why

The owner asked on 23 November 2026 that the extension "also sync to Kemlock Server" and "support
Kemlock". `add-browser-extension` was written before Kemlock Server existed. It joins the vault's
Vaultwarden or WebDAV sync, and Vaultwarden can't carry logins. The app moves people off both:
`move-off-vaultwarden-sync` moves a vault into `kem1` items at its first Kemlock API sign-in,
after which its own entries stop syncing through the old store. So an extension that knows only
Vaultwarden and WebDAV stops seeing the vault of anyone who has moved. The app's plan left this
for later on purpose ("A Kemlock Server backend in the browser extension. It is a later plan over
the same engine."), and wrote the engine to make it cheap: `lib/features/sync/kemlock/` is about
10,000 lines of Dart with two `dart:io` uses and no Flutter.

"Support Kemlock" means the Kemlock API and its account, not only the Kemlock vault format that
`add-browser-extension` already keeps (the owner, D1).

## What changes

- **Kemlock Server in setup.** The setup tab's place step offers Kemlock Server first, then
  WebDAV and Vaultwarden, which stay as `add-browser-extension` has them (D2). For Kemlock
  Server:
  - The server's address. `/kem/v1/config` is read before anything is sent, https only, with the
    certificate pins the app keeps.
  - The access step asks for that one host, and for nothing else.
  - Sign-in, by the app's steps (`KmSignIn`): the master password through OPAQUE, a second step
    when the account has one (an authenticator code, an email code or a security key), and SSO.
  - The account's key is opened by an approval from a device already signed in (the five words,
    computed in both places, never taken from the server), or by the master password.
  - The browser's own vault password stays what it is today: it seals the browser's vault on
    this computer. The Kemlock account's password is never stored.
- **A device of the account.** The extension makes its own device key and signs every request
  with it (DPoP). It appears in the phone's device list as "Kemlock · Chrome", "· Edge" or
  "· Firefox". Removing it from the phone ends its session: the next sync says so, and nothing
  in the browser is deleted until the person chooses to.
- **Sync as the phone does.** The engine's run (`km_sync.dart`) unchanged: the cursor, the
  signed manifest and its checks (an older copy, a fork), the deleted-id record and the removal
  guard. The problems are the app's (`sync_problem_kemlock*`, `sessionEnded`, `sessionReused`,
  `older`) and show in the popup with the app's words, which `npm run locales` already brings in.
- **When it runs.** As `add-browser-extension` decision 12: an alarm every five minutes while the
  vault is open, on unlock, ten seconds after a change made in the browser, and Sync now. While the
  popup or a setup tab is open, the background also holds the live socket (`/kem/v1/live`), so a
  change on the phone shows at once.
- **Failover.** The server list and switching of `km_failover.dart`: when the home server is down
  and a replica answers, the extension reads from it as the phone does, and says so.
- **Every kind is kept.** Items the extension doesn't show (keys, notes, passkeys, cards and
  identities until they are filled, Sends) are kept as they came and written back unchanged, so a
  sync never reads them as deleted.
- **Settings › Sync** shows the server, the account's email, the device name, the last sync and
  Sync now, and has "Sign out of Kemlock Server", which ends the session on the server.

Not in this plan:

- Shared spaces. The personal vault only, as `add-browser-extension` already said for WebDAV
  spaces. A later plan, over `add-server-spaces`' engine.
- Moving a vault off Vaultwarden or WebDAV from the browser. That stays the phone's job, so it
  runs once, where the old store's checks already are.
- Approving other devices from the browser.
- Making an account. Accounts are made in the web vault or the app.
- Sends, emergency access and account recovery.

Of these, `docs/plans/add-browser-account.md` takes up approving other devices, making an account, emergency
access, account recovery and the move off Vaultwarden or WebDAV.

## Decisions

The owner answered D1, D2, D3 and the server changes on 23 November 2026. D4 to D6 were not
asked and are taken as recommended; the owner may overturn them.

| #   | Question                                                                   | Decision                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | What "support Kemlock" covers.                                             | The Kemlock API and account.                                                                                                                                                                                                                                                  |
| D2  | Which backends the first release offers.                                   | All three: Kemlock Server, WebDAV and Vaultwarden. `add-browser-extension` tasks 5.1 to 5.3 stay.                                                                                                                                                                             |
| D3  | How the extension gets the app's Dart now that the repositories are apart. | A new repository, Kemlock-core (`git@github.com:Arsslensoft/Kemlock-core.git`), holding the pure-Dart `kemlock_core` package. The app and the extension both depend on it at a pinned commit (design 6).                                                                      |
| D4  | Which sign-in ways the first release supports.                             | Master password, the second steps, device approval, SSO through `chrome.identity.launchWebAuthFlow`, and a passkey or security key with PRF through the browser's own WebAuthn. The browser has WebAuthn and PRF built in, so none of the phone's NFC and USB code is needed. |
| D5  | The server's device kind for the extension.                                | A new `KemlockBrowser` kind, with the browser in the device name. `KemlockWeb` is the web vault, and the device list would show the two alike.                                                                                                                                |
| D6  | Where the device key is kept.                                              | A WebCrypto P-256 key made non-extractable, kept in the extension's IndexedDB. The page and the content scripts can't read it, and it can't be copied out of the browser's profile as a key. The server's key copy takes it with a new protection value `browser`.            |
| —   | The server's changes (design 5).                                           | Made in kemlock-server as part of this work.                                                                                                                                                                                                                                  |

## Design

### 1. The engine runs in the core, unchanged

`add-browser-extension` decision 1 compiles the app's Dart to WebAssembly (dart2wasm) and runs it
in the background. This plan adds `lib/features/sync/kemlock/` and `lib/crypto/account`,
`lib/crypto/opaque` to what task 2.4 moves into `packages/kemlock_core`. The two `dart:io` uses
go behind seams first, in the app:

- `km_api.dart` catches `HandshakeException` to tell a bad certificate. The seam is a
  `TlsFailure` the `http` client maps to. In the browser, `fetch` gives a `TypeError` with no
  detail, so a certificate problem reads as "can't reach the server", and the setup step says to
  open the address in a tab to see why.
- `km_dpop.dart` formats a date with `HttpDate`. It becomes a small formatter in the core.

### 2. The browser's side of the engine's interfaces

| Interface             | Browser implementation                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DeviceKey`           | WebCrypto ECDSA P-256, non-extractable, in IndexedDB (D6). Signing goes through `crypto.subtle.sign`.                                                                                                                                                                                                                                                                    |
| `KmPasskeyAsserter`   | `navigator.credentials.get` with the `prf` extension, from the setup tab (WebAuthn needs a page, not the service worker). The relying party is the server's, which an extension may only claim from a page on that server's origin: the setup tab opens the server's own `/kem/v1/webauthn` connector page, as `add-browser-extension` decision 13 does for Vaultwarden. |
| `KmBrowserAuth` (SSO) | `chrome.identity.launchWebAuthFlow` (Firefox: `browser.identity.launchWebAuthFlow`), with the PKCE and device key binding the app already sends. The redirect address is the browser's `identity` address, which the server's SSO allows for `KemlockBrowser` devices.                                                                                                   |
| `LiveSocketConnector` | The browser's `WebSocket`, from the background. Chrome keeps a service worker running while a socket sends at least every 30 seconds; the socket is closed when the popup and the setup tabs close.                                                                                                                                                                      |
| Key-derivation runner | The core's existing web runner (decision 2 of `add-browser-extension`), for OPAQUE's Argon2id.                                                                                                                                                                                                                                                                           |

### 3. What the browser keeps

Under the browser vault's keys, sealed with it, the same three values the phone keeps
(`backmycodes_kemlock_session`, `backmycodes_kemlock_account`, `backmycodes_kemlock_cache`), in
the same format, so a test can open one with the app's code. The device key is the only thing
outside the vault, in IndexedDB, and it is useless without the session's tokens, which are inside.
Locking the vault drops the account key from memory; the next unlock opens it again from the
sealed value, with no sign-in.

### 4. Permissions

One new optional host permission: the Kemlock Server's own origin, asked for at the access step.
`identity` is added for SSO (Chrome shows no warning for it). Nothing else. A replica named by the
server list is asked for the first time failover would use it; until it is granted, failover says
so.

### 5. The server's changes

Small, and in the server's own repository:

- `DeviceKind::KemlockBrowser`, from the device type the extension sends at sign-in (D5), shown
  as "Kemlock for browsers" in the web vault's device list.
- The protection value `browser` for a device key copy (D6).
- The SSO redirect: `https://<extension id>.chromiumapp.org/` and Firefox's
  `https://<hash>.extensions.allizom.org/`, allowed for `KemlockBrowser` devices only.
- The `/kem/v1/webauthn` connector page, if the server has none yet.

The extension sends no `Origin` the server needs to trust: a request from the background with a
host permission is not a page's cross-origin request, and Kemlock Server sends no CORS headers.

### 6. Kemlock-core, a repository of its own

`add-browser-extension` task 2 planned `packages/kemlock_core` inside the app. With the
extension in its own repository, the package gets one too (D3):

- **What it holds.** What task 2 moves (the crypto, the models, the vault store, the sync merge,
  the WebDAV client, the Vaultwarden engine, OTP, the generator and site matching), and this
  plan's additions: `lib/features/sync/kemlock`, `lib/crypto/account`, `lib/crypto/opaque`. Pure
  Dart, no Flutter, licensed GPL-3.0-or-later like the app. Its tests and the fixtures they read
  move with it. The app's fixtures that other formats pin stay in the app too, and a test there
  checks they are byte for byte the core's copies.
- **History.** Carried over with `git subtree split` per moved folder, as the extension's was,
  so `git log` and blame still work in the new repository.
- **The app.** `mobile/pubspec.yaml` depends on it as a git dependency pinned to a commit
  (`ref:` a full hash), in both lockfiles (`pubspec.lock` and `pubspec.free.lock`). F-Droid
  builds take a pinned git dependency as source. The old import paths keep an `export` each, as
  task 2.3 planned, so the app's code changes only its imports.
- **The extension.** `core/` here is the Dart entry over `kemlock_core` (task 3.2), with
  `kemlock_core` as a git dependency at a pinned commit. `tool/build.sh` already builds in a
  container from the commit's files; the container also gets the Dart SDK, pinned by SHA-256 as
  Node is, and `dart pub get --enforce-lockfile` fetches the core at its locked commit, so a
  release stays reproducible.
- **Keeping in step.** A change to the core lands in Kemlock-core first, then the app and the
  extension each move their pin in their own commit. Renovate proposes the pin moves.
- **CI.** Kemlock-core runs its tests on the VM and under `dart test -p chrome -c dart2wasm`, with
  the same Checks as the extension (Lint, Title, Dependencies, DCO, Licences, Security).

## Tasks

Each task names how it is verified. The checks are one combined run after the branch is written,
as the owner's process asks.

### 1. Groundwork

- [x] 1.1 Ask the owner D1 to D3 and the server changes (answered 23 November 2026).
- [x] 1.2 In the app: cut the platform seams of `add-browser-extension` task 2.2, and those of
      design 1 (`HandshakeException`, `HttpDate`). Verify: the app's analyzer and its whole test
      suite pass unchanged.
- [x] 1.3 Create Kemlock-core (design 6): split the folders out with their history, add its
      pubspec, licence, README and Checks. Verify: its tests pass on the VM and under dart2wasm.
- [x] 1.4 In the app: depend on Kemlock-core at the pinned commit, in both lockfiles, with an
      `export` at each old path, and remove the moved folders. Verify: the app's analyzer and full
      suite pass, `flutter pub get --enforce-lockfile` works for the store and the free build, and
      the free release build still reproduces.
      Done 23 November 2026 (Kemlock-core 8e0e375, the app at bbd81322): the app's full suite (6,202
      passed) and the core's (3,294 on the VM, 168 under dart2wasm) pass, and both lockfiles hold. Not
      yet checked: that the free release build still reproduces. The app's history had been squashed
      to one commit, so the move carried no history.
- [ ] 1.5 In the extension: add `core/` over Kemlock-core, and the Dart SDK to the build
      container. Verify: two builds of one tag give the same zips.
- [ ] 1.6 In the server: the changes of design 5. Verify: the server's contract tests sign in as
      a `KemlockBrowser` device and list it.

### 2. The engine in the browser

- [ ] 2.1 The browser implementations of design 2. Verify: Vitest over the TypeScript side; a
      Dart test under `dart test -p chrome -c dart2wasm` signs DPoP proofs with the WebCrypto key and
      checks them against the app's vectors.
- [ ] 2.2 The engine's run in the background, its schedule, and its problems in the popup. Verify:
      the core's Kemlock sync tests run under dart2wasm against the app's in-memory server fakes.

### 3. Setup and settings

- [ ] 3.1 The Kemlock Server steps of setup: address, access, sign-in, second step, approval or
      master password. Verify: Playwright, headed, against a local Kemlock Server, through each way
      in.
- [ ] 3.2 Settings › Sync for Kemlock Server, and signing out. Verify: Playwright: signing out
      ends the session on the server, and the phone's device list no longer shows the browser.

### 4. Round trips

- [ ] 4.1 Phone and browser on one account: a login, a code and a note made on each show on the
      other; a deletion on either goes through the removal guard. Verify: an emulator and Chrome on a
      local server; Playwright for the browser's side.
- [ ] 4.2 The device removed from the phone: the browser says the session ended and keeps its
      items. Verify: the same set-up.
- [ ] 4.3 Failover to a replica. Verify: two local servers, the home one stopped.

### 5. Release

- [ ] 5.1 README and the store listings: what the extension keeps, what goes to the server (only
      sealed items and the account's public data), and the new permission.

## Risks

- **The core move is still ahead.** Everything here waits for Kemlock-core (tasks 1.2 to 1.4). It
  is the largest piece, and it touches the app: a mistake there could break vaults already on
  phones, so the app's fixture tests run unchanged before and after.
- **Three repositories to keep in step.** A core change needs a pin move in the app and the
  extension. Renovate proposes them, and each repository's tests run on the new pin before it
  merges.
- **WebAuthn on the server's address.** A passkey sign-in needs the server's own page for the
  relying party. If the server has no such page, passkey sign-in waits, and the other ways still
  work.
- **Service worker lifetime.** Chrome stops an idle service worker after 30 seconds. The vault's
  keys already survive that (`add-browser-extension` decision 5); a sync in progress is resumed
  from the cursor, which the engine already allows.
