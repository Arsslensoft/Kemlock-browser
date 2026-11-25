# Proposal

## Why

On a computer, Kemlock's codes and, with `add-passwords`, its logins are on
the phone, so signing in means unlocking the phone, finding the account and
typing the code across. A browser extension can fill them where they are
asked for. It needs no server: the extension is one more device on the sync
the person already runs, Vaultwarden or a WebDAV folder, as a second phone
is. That avoids the relay to the phone that the password manager plan
declined ("Not ported"). That plan, `docs/plans/password-manager-features.md`,
is in the history; a337b39c removed it from the tree.

The owner chose on 2026-11-21: the extension's sync is free, and this change
ships to Chrome, Edge and Firefox, with Safari in a later change. The
screens are on the design canvas
https://claude.ai/artifact/DBRz5HrXKCHC4zCsHPLz5Y.

## What Changes

- **A Kemlock vault in the browser.** The extension keeps its own vault,
  under a password chosen for this browser, sealed exactly as the app seals
  one (scrypt, ML-KEM-1024, AES-256-GCM) and in the same storage format. It
  locks after a chosen idle time, when the computer sleeps or its screen
  locks, and when the browser closes. It counts wrong passwords as the lock
  screen does, without erasing anything.
- **Sync as another device.** Setup in a tab joins the vault's existing
  sync:
  - Vaultwarden: server and email, master password, every second step the
    app offers (an authenticator code, an email code, a YubiKey OTP or a
    security key, with the personal API key otherwise), and the vault's
    Kemlock home, sealed or plain.
  - A WebDAV folder, with its sync passphrase.

  Then it syncs as the phone does: item by item with Vaultwarden, through
  the sync file with WebDAV, with the same merge, the same removal guard
  and the same problems. It keeps every kind of item it receives, keys,
  notes and passkeys included, though it shows only codes, backup codes
  and logins, so a sync never reads them as deleted. Logins travel through
  WebDAV only until Vaultwarden carries them, and the extension says so.

- **The toolbar popup.**
  - The login and code of the site in front.
  - Codes and logins, with search, and copying through a clipboard that
    clears itself.
  - A login's page: its previous passwords, linked code and backup codes.
  - Password health, recently generated passwords, the password generator
    and the settings.
- **Filling on the page.** A Kemlock button in the sign-in, code and
  new-password fields it recognises, by the rules the app's AutoFill uses.
  It opens a menu drawn by the extension, out of the page's reach. A login,
  a code (also one split across a row of boxes) or a suggested password
  fills only on a click, and only on the item's own site:
  - The site is judged by the field's own frame and by the Public Suffix
    List.
  - On an unknown site, a picker; on a look-alike of a known one, a guard.
  - The code is offered on the page after the password.
  - Any field can be filled from its right-click menu.
- **Saving logins.** After a sign-up or a password change, the extension
  offers to save the login or update it. The old password goes to its
  previous passwords, as the app does.
- **Adding codes.** A two-step setup QR code shown on the page, or a pasted
  `otpauth://` link, adds a code to the vault, with the page's site as its
  website and an offer to link it to that site's login.
- **Free.** Nothing in the extension needs Premium or shows a paywall:
  - sync is free;
  - the lists follow the vault's own order and tags, which the extension
    also changes (`docs/plans/add-vault-tools.md`);
  - accounts whose code is on a security key are listed by name only;
  - the backup-code tools, once Premium's, are free and in the extension
    (`docs/plans/add-vault-tools.md`).

  The owner settled this on 2026-11-21, and made Kemlock free on
  2026-11-23.

Not in this change:

- Safari.
- Shared spaces in the browser: their items stay on the phones.
- Passkeys as a browser credential provider. (Taken up later by `docs/plans/add-passkeys.md`, which
  supersedes this line: the extension lists the vault's passkeys and answers the browser's requests.)
- Importing into the extension.
- A desktop app.

## Capabilities

### New Capabilities

- `browser-vault`: the extension's own vault: creating it, how it is
  stored, unlocking, locking, wrong passwords, and removing it.
- `browser-sync`: joining the vault's Vaultwarden or WebDAV sync from the
  browser, syncing as another device, which items it keeps and carries,
  what it says when sync stops, and the access it asks for.
- `browser-popup`: the toolbar popup: the site's login and code, the code
  and login lists with the vault's order and tags, copying, adding a code
  from the page, a login's page, password health, the generator, recently
  generated passwords, the settings and the toolbar icon, all without
  Premium.
- `browser-autofill`: filling on web pages: which fields get Kemlock's
  button, the in-page menu, which site an item fills on, the picker and the
  look-alike guard, codes in boxes, the code after the password, the
  right-click menu, suggesting new passwords, and saving and updating
  logins.

### Modified Capabilities

None. `openspec/specs/` holds no archived specs. The rules this change
shares with the app are those of `add-passwords` (logins, the generator,
health, site matching), and those of the AutoFill and Vaultwarden plans,
`docs/plans/autofill.md` and `docs/plans/vaultwarden.md`, in the history
since a337b39c removed them from the tree. The extension follows them
without changing them.

## Impact

- **New `extension/`**: a Manifest V3 extension in TypeScript for Chrome,
  Edge and Firefox. It has:
  - a background service worker;
  - a content script for every frame;
  - the in-page menu, the popup and the setup tab, as extension pages.
- **New `packages/kemlock_core/`**: the app's platform-free Dart, moved out
  of `mobile/lib` and compiled to WebAssembly for the extension:
  - the crypto, the models and the vault store;
  - sync: the merge, the WebDAV client and the Vaultwarden engine;
  - codes, the generator and site matching.

  The app depends on it by path, and the moved files leave one-line
  exports behind, so the app's imports don't change.

- **No format changes.** The extension reads and writes the vault, sync
  files and Vaultwarden items with the app's own code. A new fixture holds
  the browser's storage.
- **Dependencies**:
  - Node tooling: TypeScript, Vite, Preact, Vitest, Playwright and
    `web-ext`.
  - The Dart SDK's `dart2wasm`.
  - Data the app already bundles: the Public Suffix List, the password
    rules, the EFF word list and the 2FA directory.
- **Docs and release**:
  - The README gets a section on the extension: what it keeps where, and
    the permissions it asks for.
  - Store listings for the Chrome Web Store, Edge Add-ons and Firefox
    Add-ons, with the privacy text.
  - Build instructions beside `docs/reproducible-builds.md`.
  - An `extension` commit scope in `CLAUDE.md`, with the owner's OK.
