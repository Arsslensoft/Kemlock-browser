# The Kemlock Server account in the browser

The extension makes a Kemlock Server account, approves the account's other devices, lists and signs
them out, holds emergency access and the Recovery Kit, sets up the account's second steps, and moves a
vault off Vaultwarden or WebDAV, with the phone's checks. Everything runs in the background's Dart core
over the same engine the phone and the web vault use, so a secret never leaves it.

This plan changes `add-kemlock-server-sync` (`docs/plans/add-kemlock-server-sync.md`), whose "Not in
this plan" left these out. Where the two disagree, this one wins.

## Why

The owner asked on 24 November 2026 for browser parity: the extension should do what the account's
other clients do, so that a person with only a computer at hand is not stuck. Today a new browser
device waits on a phone to approve it, and a person who lost the phone has no way back from here; an
account is made only in the web vault or the app, and a vault on Vaultwarden or WebDAV moves only from
the phone.

## What changes

- **Making an account.** The Kemlock Server form of setup offers "Create an account": email, name,
  password, and an invite code when the server asks for one. The core does the OPAQUE registration
  (`/accounts/register/start` and `finish`), makes the root key, the key pairs and the password wrap
  as the web vault does, and signs in as the device with the same password, so setup goes on at the
  first sync.
- **Approving devices.** Open requests (`GET /devices/approvals`) are read by an alarm every minute
  while the vault is open, after each sync, and every few seconds while the account page is open. A
  new request raises a browser notification. The account page shows the five words the core computes
  from the request's one-time key (never the server's), the device, the address and the age, and
  approves (seals the root key to the request's key, `device-approval`, bound to the account and the
  request) or denies. A server whose words differ from the computed ones is refused, as on the phone.
- **Devices.** The device list with each device's last use, "this browser" marked, and Sign out for
  any other device.
- **Emergency access.** The account page lists the contacts the account named and the accounts that
  named it: invite a contact (view or takeover, a wait of 1 to 90 days), revoke, accept an invite,
  confirm a contact after comparing their fingerprint (the root key is sealed to their `kx1` key,
  `emergency-access`, bound to their account id), ask for access, approve or refuse a request, and,
  once approved, fetch the sealed key and check that it opens.
- **Recovery Kit.** Show a kit's record, make a new kit (three pieces, any two open the account),
  keep it only after one piece is typed back, replace or remove it behind the fresh proof the server
  asks for, and print the pieces from the account tab. Setup's "master password" and "approval" steps
  offer "Use a Recovery Kit" to open the account with two pieces.
- **Recovery code.** The second step of a sign-in takes the account's recovery code, and the account
  page shows it behind the fresh proof.
- **Second steps.** The account page lists the methods the account has, turns the authenticator app
  on (secret and `otpauth://` link, confirmed by a code) and the email code on and off.
- **Moving a vault.** Signing in to Kemlock Server from a vault that syncs with Vaultwarden on that
  server, or with WebDAV, does not replace the old store: setup shows what moves and what stays, then
  runs the app's move (`km_move.dart`: the old store's last run, the copy that creates only what is
  absent, the check that reads everything back, and the old store). It runs once (a finished record
  stops it), resumes where it stopped (the status says `moveUnfinished` meanwhile, and an alarm goes on with it after a restart),
  can be abandoned before its last step, and is refused when notes have attached files.
- **Core.** Kemlock-core's second-step calls now go to the server's own routes (email, recovery code)
  and a sign-in can ask for the email code to be mailed.

Not in this plan:

- **The live socket.** `/kem/v1/live` authenticates its upgrade with `Authorization` and `DPoP`
  headers, which a browser's `WebSocket` can't set, and the web vault doesn't use it either. The
  extension polls: the alarm, each sync run, and the page while it is open.
- **Push.** Browsers have no APNs or UnifiedPush channel for an extension; the notification comes from
  the poll.
- **Viewing or taking over another account.** The server's part of emergency access ends at releasing
  the sealed key: it has no route to read the other account's items or to set its password, and the
  web vault stops there too. The extension fetches the key and says whether it opens.
- **Security keys, YubiKey and Duo as second steps, and passkeys of the account.** Registering a
  security key is a WebAuthn creation on the server's own address, which an extension page can't make
  (design 13 of `add-browser-extension`); the web vault makes them.
- **Moving files.** The browser keeps no attached files, so a vault whose notes have them is not
  moved from here: the phone moves it (`km_files.dart` needs the files on the device).
- **Going back to Vaultwarden** after a sealed home is closed, and keeping a plain home's Bitwarden
  copy in sync: the browser syncs one place, so after a move it syncs Kemlock Server only.
- **Spaces, Sends, and a second account in one vault.**

## Decisions

| #   | Question                                   | Decision                                                                                                                                                                                                      |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | What stands for the phone's owner check.   | The pages that approve, confirm or show a recovery code are extension pages only (the sender is checked), the vault must be open, and each is its own click. The browser has no screen lock.                  |
| A2  | Where the account's pages live.            | One new extension page, `src/account/`, opened in a tab from the popup's sync card and from a notification. The popup closes when a tab opens, and a kit is printed from a tab.                               |
| A3  | One message for the account's calls.       | `account` carries `{ op, ...args }` and the background validates it per op (`src/shared/account.ts`), so the shared message table grows by one line, not forty.                                               |
| A4  | Whether another device's move is detected. | No: nothing on the server tells a move from a sync (the web vault writes items with no manifest too). The copy creates only what is absent and the item ids are fixed, so two devices moving one vault agree. |

## Tasks

Verified by the one combined run the owner's process asks for; no run is made while writing.

### 1. Core

- [x] 1.1 Kemlock-core: second-step routes for the email and recovery codes, and the mail request
      (branch `parity/account` of Kemlock-core, two commits).
- [x] 1.2 The Recovery Kit in Dart: Shamir over GF(2^8), the piece text, the kit wrap (copies of the
      app's `shamir.dart` and `recovery_shares.dart`, which the web vault's pieces match byte for byte).
- [x] 1.3 Registration, devices, approvals, emergency access, second steps, the kit and the move, as
      the core's `account` call.
- [x] 1.4 Sync: registration as a sign-in, the recovery code and the recovery kit as answers, the move
      in place of replacing the old place, and no run of the vault's entries while a move is unfinished.

### 2. Background

- [x] 2.1 `src/shared/account.ts`: every request and answer, validated.
- [x] 2.2 The background handler, its sender check, the approval watcher and its notifications.
- [x] 2.3 The fake core's account, for the tests and the e2e build.

### 3. Pages

- [x] 3.1 Setup: Create an account, the recovery code and Recovery Kit answers, the move.
- [x] 3.2 The account page: approvals, devices, emergency access, Recovery Kit, second steps, move.
- [x] 3.3 The popup's sync card: links to the account page, and the pending count.
- [x] 3.4 Strings, English and French (`locales/parts/account.*.json`).

### 4. Tests

- [x] 4.1 Dart: kit pieces and wrap, approvals, emergency, registration, move guards, against a fake server.
- [x] 4.2 Vitest: the request parser, the handler's sender checks and the watcher, the pages.
- [x] 4.3 Playwright: the account page with no server, and against a real one when KEMLOCK_SERVER_URL is set.

## Risks

- **Nothing here was run.** The code was written against the engines' types without a build, so the
  combined pass is the first compile.
- **The move is the phone's engine in a new host.** Its steps are the app's; the wiring around them
  (settings, scope states, the old store's session) is new and is what the review should read most
  closely.
- **Another core commit.** The browser needs Kemlock-core's `parity/account` before its pin moves.
