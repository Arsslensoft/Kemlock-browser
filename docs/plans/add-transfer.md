# Import, export and credential exchange in the browser

The extension can import files from other apps and export its vault, in a tab of its own. It reads
every format the app reads, merges what it reads into the vault as the app's import does, and writes
Kemlock's own export (encrypted, so the phone imports it), plain files, Credential Exchange files and
QR codes. The code that reads and writes the formats moves into Kemlock-core, so the app and the
extension share one copy.

This plan adds to `add-browser-extension` (`docs/plans/add-browser-extension/`), which listed
"Importing into the extension" among what it did not do. This plan does it, so that line is no
longer on the not-done list. The older plans are not changed. The app side is
`add-credential-exchange` in the app's repository (`docs/plans/add-credential-exchange.md`).

## Why

A browser is where people bring their passwords from: Chrome's, Firefox's or Bitwarden's export is a
file on the computer, and Google Authenticator's transfer code is a screenshot away. Until now the
extension could take none of it, and could give nothing back: its vault could only be reached by
typing items in or by sync. The owner asked for a finished product, with import and export like the
phone's.

## What changes

- **A transfer tab**, `src/transfer/`, opened from Settings › Import and Settings › Export in the
  popup. A tab, because the toolbar popup closes the moment a file dialog opens. It has a lock screen
  of its own, since the popup's is not there.
- **Import.** Choose a file (or drop it) or pictures of QR codes (or paste a screenshot). The core
  tells what it is by its content, as the app does:
  - Kemlock's own export, encrypted or not, and the `.zip` an export with attached files comes in;
  - Google Authenticator's transfer codes, Aegis and 2FAS backups (encrypted or not), Bitwarden's
    JSON, and lists of `otpauth://` links;
  - Credential Exchange files (CXF 1.0), with the preview's places, skips, notices and cuts;
  - **new in Kemlock-core**: CSV files of logins, as Chrome, Edge, Brave, Firefox, Safari, Bitwarden,
    1Password, LastPass, NordPass, KeePass and Dashlane write them, found by header;
  - Kemlock's own QR transfer (`BMC1`, encrypted, and `BMCP`, plain).

  An encrypted file asks for its password. The preview then counts what the file holds by kind, what is
  new and what the vault holds already, names the first of each, lists what is left out and why, and
  shows other people's keys with their fingerprints (they come in not checked unless the person keeps
  the file's checks). A Credential Exchange file's places can be left out one by one. Codes can be
  merged (the default) or replace the vault's. Importing is the app's `import_merge.dart`, unchanged:
  duplicates are skipped by the shared rules, logins linked to a code that is held are relinked, keys
  are combined, and the lists are saved with their change times bumped and counted as a change made
  here, so that the next sync carries them.

- **Export.** Every export asks for the vault's password again, and a wrong one counts as one at the lock
  screen. The formats:
  - Kemlock's export, **encrypted** (the app's format, with its own password; it is opened again
    before it is offered, as the app offers) or **plain**, with the app's warning and a confirmation;
  - **logins as CSV** in Bitwarden's layout, and **codes as links** (new in Kemlock-core);
  - **Credential Exchange**, of the kinds the person picks, with what it leaves out listed;
  - **QR codes** drawn on the screen: Google Authenticator's transfer codes (new in Kemlock-core), or
    Kemlock's own transfer, encrypted or plain. They are shown one at a time and leave the screen
    after two minutes.

  A file is made in the core, answered to the transfer tab, handed to the browser through a Blob URL and
  dropped from the page's memory. Nothing else sees it.

- **The core's side.** Kemlock-core (branch `parity/transfer`) takes the importers, the Credential
  Exchange reader and writer, the merge, the destinations, the QR transfer and the export archive reader
  from the app's `features/import`, `features/export` and `vault/`, at the same paths. Files that mixed
  Flutter were split the way the earlier moves split theirs: the pure part moved, the sheets, the
  providers and the hand-off to other apps on the phone stayed in the app.
  - `import_merge.dart` needed `contactKeyInfo` from `contact_standing.dart` and the site resolver from
    the AutoFill code: `contacts/contact_key_info.dart` and `duplicates/duplicate_sites.dart` carry just
    those, with the same rules.
  - `credential_export.dart` (providers, targets, the switch) gave `export/credential_export_plan.dart`;
    `space_export.dart` (the spaces' policies) gave `export/export_scope.dart`.
  - `qr_transfer.dart` and the archive reader lost `dart:io`: raw deflate comes from `package:archive`,
    and `buildExportArchive` writes an archive in memory.
  - `import_file.dart` is what `import_sheet.dart` does between "choose a file" and "review", as
    functions.
  - The app is not changed. **It should switch to the core's copy later** (the files left behind keep
    working, and Kemlock-core's tests run the app's own cases against the moved code). `ImportSource.csv`
    and the CSV reader exist only in the core's copy until it does.
- **In the extension**: `core/lib/src/transfer_service.dart` holds an opened file between the page's
  steps (a token names it) and merges it into the vault; `VaultService` gains `confirmPassword` and
  `saveImported`. `src/background/transfer.ts` answers the page's requests, for the transfer tab only.

## Decisions

1. **A tab, not the popup.** A file dialog closes the popup, and what it was reading goes with it.
2. **Secrets stay in the core.** A file's items are held in the core under a token, and the page gets
   names, counts and reasons. An export's text is the one thing a page receives that is secret, and
   only the transfer tab may ask for it (`src/background/transfer.ts` checks the sender's page, as
   `design.md` decision 4 asks). The core asks the vault's password before it writes one.
3. **The app's merge, not a new one.** The browser imports as the app does, so a file that imports
   on the phone imports the same here, and sync carries it. Keeping both or replacing a duplicate
   (`planLogins` and the others) is in the core but not offered, because the app's sheet does not
   offer it either.
4. **Shared spaces fail closed.** Whether a space allows export is in its verified chain, which the
   browser does not read. As the app does for a server space whose policy it cannot read, every item
   of a space stays out of every export, and the page says how many.
5. **No destination but the vault.** The app can send a Credential Exchange account to a new space.
   The browser has no destination to give them, so each place is ticked (it goes into the vault) or not (it is left
   out); a place that was shared in the old app comes in as the person's own and says so.
6. **What goes in is the person's own.** An item of a shared space comes in as the person's own, since an
   import has no space to send it to and an item under a space it is not in is stranded; the preview says how
   many. Notes lose the files they name (the browser keeps none).
7. **An export's password check has no side effects.** `VaultStore.passwordOpens` (Kemlock-core) tries the
   active vault's key and nothing else, and each wrong password makes the next try wait longer (1 s, 2 s, 4 s,
   up to 30 s) until the vault locks.
8. **CSV cells are guarded against formulas.** Every cell but the password gets a leading `'` before `=`,
   `+`, `-`, `@`, a tab or a return, and the reader takes it off again. The password is written exactly as
   it is, and the CSV warning says so.
9. **CSV is new.** The app's plan leaves other managers' files to a later plan (`add-manager-imports`).
   A browser is where those files are, so the extension reads CSV logins now, and the reader and the
   Bitwarden-layout writer are in Kemlock-core for the app to use when it gets there. Other managers'
   formats (1PUX, KDBX, Dashlane's zip, Proton Pass) stay out.

## Not in this plan

- Attached files. The extension does not fetch attachments, so a note comes in without its files
  (and says how many), and no export holds them. A `.zip` export is read for its `export.json`.
- Opening an encrypted export with a Recovery Kit. The kit's pieces are the phone's.
- Keeping both or replacing a duplicate, for the reason in decision 3.
- Credential Exchange's hand-off between apps on one device (`ProviderEventsManager`, iOS's
  `ASCredentialImportManager`). A browser has no such broker; it takes and writes the file.
- Passkeys, keys, cards, identities and contacts are imported, exported and counted, but the
  extension shows none of them yet (that is the other streams').
- Bitwarden's encrypted JSON, other managers' formats (decision 6), printing QR codes, and reading QR
  codes from the camera (a picture or a pasted screenshot does it).

## Tasks

### 1. Kemlock-core (branch `parity/transfer`)

- [x] 1.1 Move the importers, the Credential Exchange formats, the merge and the destinations in, with
      the two splits (`contact_key_info.dart`, `duplicate_sites.dart`). Verify: the app's tests of them
      pass in the core (`test/features/import/`), against the fixtures in `test/fixtures/import`, which are
      the app's own, byte for byte.
- [x] 1.2 Move the QR transfer and the archive reader in without `dart:io`. Verify: the app's
      `qr_transfer_test`, `export_archive_test` and `vault_export_test` pass in the core.
- [x] 1.3 The CSV reader (`formats/csv_logins.dart`) and `ImportSource.csv`. Verify:
      `csv_logins_test.dart`.
- [x] 1.4 The Google Authenticator writer (`formats/google_migration.dart`). Verify:
      `google_migration_test.dart` reads each batch back with `parseGoogleMigration`.
- [x] 1.5 `import_file.dart`, `export/export_scope.dart`, `export/credential_export_plan.dart` and
      `export/csv_export.dart`. Verify: `import_file_test.dart` over the `vault-items` fixtures,
      `export_scope_test.dart`, and the CSV round trip in `csv_logins_test.dart`.

### 2. The extension's core

- [x] 2.1 `transfer_service.dart`, `confirmPassword`, `saveImported`, `qrModules`. Verify:
      `core/test/transfer_test.dart` (a Kemlock export through a second vault, the CSV, the wrong
      password, a second import, replace, sync's change counted, an export asking for the password, QR
      codes read back through the core's own reader).
- [x] 2.2 Point the extension's core at the sibling checkout while the branch is unmerged:
      `core/pubspec_overrides.yaml` (ignored by git). Before merging, move the pin in `core/pubspec.yaml` and
      `core/pubspec.lock` to the merged Kemlock-core commit.

### 3. The tab

- [x] 3.1 `PageApi` and `CoreApi` additions, their parsers, the sender for the transfer page, the
      handlers, and `FakeCore`'s. Verify: `src/background/transfer.test.ts`,
      `src/shared/messages.transfer.test.ts`.
- [x] 3.2 The tab: import, export, QR drawing, the lock screen, and the download through a Blob URL.
      Verify: `src/transfer/transfer.test.tsx`, `files.test.ts`.
- [x] 3.3 Settings › Import and Export in the popup; the build's entry; the strings in
      `locales/parts/transfer.{en,fr}.json`. Verify: `src/transfer/locales.test.ts`.
- [x] 3.4 Playwright, over the real core: `tests/e2e/transfer.spec.ts` (plain and encrypted export,
      the wrong password, the confirm for a plain file, CSV import, an unreadable file, a QR code
      shown and read back from its screenshot, the lock screen, Settings opening the tab).

### 4. Before it merges

- [ ] 4.1 Run the combined pass: `dart format`, `dart analyze --fatal-infos` and `dart test` in both
      Dart packages, `dart test -p chrome -c dart2wasm -t wasm` in Kemlock-core, then `npm run format`,
      `lint`, `typecheck`, `test`, `build` and `test:e2e`. Nothing was run when this was written.
- [ ] 4.2 Merge Kemlock-core, move the pin (task 2.2), and rebuild with `--enforce-lockfile`.
- [ ] 4.3 In the app: switch to the core's import and export code (the files left behind become
      one-line exports, as the earlier moves did), and take the CSV reader into its sheet.

## Risks

- **A large file in a message.** A file crosses `runtime.sendMessage` as base64, and Chrome caps a message
  at 64 MiB, so the limit is 40 MiB of file (54 MiB of text), and 32 MiB of pictures together. The page
  checks it, the parser bounds it, and the core refuses a larger file too.
- **Scrypt in the background.** An encrypted export or import derives its key with the vault's
  parameters, inline (design decision 2: the runner), which holds the background for about a second. A
  message sent meanwhile waits.
- **Plain text in the tab.** An export's text is in the page's memory from the answer to the click on
  the download. It is dropped there; a Blob URL keeps the bytes for a minute for "Save again", and is
  then revoked. A page that is open when the browser is closed with an unlocked vault is no different
  from the popup showing a password.
- **QR codes are read from pixels.** A screenshot at a small scale may not read. The core tries the
  picture at its size and shrunk, as for the codes on a web page.
