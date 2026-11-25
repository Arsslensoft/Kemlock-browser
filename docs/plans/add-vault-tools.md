# Vault tools in the browser

The extension changes tags and the order of codes and logins, keeps and edits backup codes, finds
and merges duplicates, and runs the breach checks, as the app does. Until now it showed tags and
the vault's order and left the rest to the phone.

This plan changes `add-browser-extension` (`docs/plans/add-browser-extension/`). Where the two
disagree, this one wins: the proposal's "Premium's backup-code tools stay on the phone" and
"Editing tags or the account order, and the backup-code tools" (not in that change) no longer hold.
Kemlock is free, so none of these tools has a Premium gate, a paywall or a purchase.

## Why

The owner wants a finished product in the browser. A person who tags a code in the extension, or
adds a service's backup codes while setting up two-step sign-in, shouldn't need the phone for it.
The duplicate cleaner and the breach alerts exist in the app already (`add-duplicate-cleaner`,
`breach-alerts`, `password-leak-check`), and their logic is Flutter-free, so the extension can run
the same code over the same sealed values.

## What changes

**Kemlock-core** (`parity/tools`, four commits), copied from the app and left in the app too until
the app pins the new commit:

- `features/backup/backup_codes.dart` and `coverage.dart`: how pasted text splits into codes, the
  low warning, marking a code used, and which accounts have no backup codes.
- `features/breaches/`: the breach list and the scan against it, the daily refresh of the list
  (forced for "Check now") and the padded Pwned Passwords range lookup. The user agent is optional:
  a browser sets its own.
- `features/duplicates/`: the tags cache, the tagger, the matcher (with no isolate), the merge and
  its records, the server hints and the dedup store.
- The app's tests for those files, over the moved ones.

**The extension's core** (Dart, over those files), in new files `tools_service.dart`,
`backup_tools.dart`, `duplicate_tools.dart` and `breach_tools.dart`:

- **Tags.** `setTags` for a code, login, note, card, identity, key or on-key account, the app's rules
  (24 characters, a tag is the same as another when case and accents aside they are equal), and
  `renameTag` and `deleteTag` over the whole vault. Every change stamps the item as just changed, so
  sync carries it.
- **Order.** Codes: `order` on the account, as the app writes it (`reorderAccounts`: the ids given
  take 0, 1, 2, ..., pinned first). Pinning is the app's `pinned`. Logins: the app keeps no order for
  logins (it sorts them by name), and adding a key would change a format, so the order of logins is the
  browser's own: a sealed value of the vault, never synced.
- **Backup codes.** Add a service by pasting its codes, edit its name and note, add codes (duplicates
  of held ones are left out), mark one used or unused, remove one, delete the service, see how many
  are left and the low warning (two or fewer), the codes and logins that belong to the service, and
  coverage: the accounts with no backup codes saved, "Add codes" for one, and "This service gives
  none" (`noBackupCodes`).
- **Duplicates.** The groups of the app's rules, with the reason each matched, Review (the merge
  choices: the item that stays, the value each differing field takes, the newest preselected),
  merge, "Not duplicates" (with Undo), and Undo merge for 30 days. The cache and the answers are the
  app's two sealed values, `backmycodes_dedup` and `backmycodes_dedup_answers`. With a Kemlock Server
  account the switch for server matching (`/kem/v1/duplicates/settings`), the groups it suggests
  (checked against the items before they are shown), and the sharing of "Not duplicates"
  (`/kem/v1/duplicates/dismissals`) are the app's.
- **Breaches.** The password check is the one that was there (`breachedPasswords`, the app's
  `leakCheck`, off by default). New: "Check now" in Health asks again for every password, and the
  service breach alerts of the app: the bundled list (`core/data/breaches.json`, the app's copy)
  scanned against codes and backup-code lists, "Dealt with" (`breachesDismissed`), and the daily
  refresh of the list from Have I Been Pwned, which is off until the person turns it on (the app's
  `breachRefresh`).

**The background and the popup:**

- Page requests for each tool, parsed in `src/shared/tools-messages.ts` and answered in
  `src/background/tools.ts`; only the popup and setup pages may send them.
- A shared tag editor (`src/popup/tools/tag-editor.tsx`) that other kinds reuse by kind and id.
- Pages: Tags, Reorder, Backup codes (list, a service, add), Coverage, Duplicates (list, review),
  Breaches. Reorder works by drag and by Move up and Move down buttons.
- Health gets "Check now" and a link to the breach alerts; Home gets the Tags and Reorder buttons; a
  login's page gets its tags.

**What the review of this plan changed**

- A merge works on the group as a fresh check finds it, never on the items cached at the last one, and refuses with `stale` ("check
  again") when an item changed between its record and its save. Review does the same; the cleaner keeps no groups between calls.
- `VaultService.saveChanged` writes every list it already wrote (and the one that failed) back as it was when a save fails, so memory and
  storage agree. A merge whose save failed and was written back whole drops its record, since no merge happened; only when the write-back
  fails too (`PartialSave`) the record stays, so that Undo can repair what storage holds.
- Undo merge overwrites nothing the person did since: it brings back the items that went, gives a relinked login back only its
  `accountId` and only while it still points at the code that stayed, and answers `edited` (and changes nothing) when the item that
  stayed was changed after the merge, until the person says "Undo anyway".
- Marking a backup code used, or removing one, goes by place and by the code the page shows there; the core refuses with `stale` when the
  vault's list has another code at that place.
- `backupDetail` (the codes themselves) and `duplicateReview` are for the popup only, not the setup tab.
- Fixes in Kemlock-core's copy of the merge (`c-tools`), which the app's own copy of those files has too and takes when it switches to
  the core's: a code merge keeps the removed copy's tags and websites; a login merge keeps the removed copy's code link when the one that
  stays has none; `planUndo` is the Undo that overwrites nothing.

## Not in this plan

- Reading backup codes from a picture or a PDF (the app's text recognition and PDFium). The browser
  has neither in the extension; pasting and typing work.
- The 2FA directory's links on a backup card (the extension's copy of the directory holds names and
  domains only).
- Spaces: duplicates between the vault and a WebDAV space, server spaces' matching switches and their
  notices. The cleaner takes the items' `spaceId` and the spaces' keys the sync gives it, so it
  follows when spaces land.
- Turning the breach list refresh on from setup, and running it in the background without a screen
  open: it runs when the Breaches or Health page opens, at most once a day.
- A numeric order for logins on the phone. The phones keep sorting logins by name.

## Tasks

- [x] 1. Kemlock-core: backup-code rules, breach files, duplicate files, their tests (`parity/tools`).
- [x] 2. Core: shared edits (`saveChanged`, login order, pinned and low in the views, `health` again, sync hooks).
- [x] 3. Core: tags, pin and order (`tools_service.dart`).
- [x] 4. Core: backup-code tools (`backup_tools.dart`).
- [x] 5. Core: duplicate cleaner (`duplicate_tools.dart`).
- [x] 6. Core: breach checks (`breach_tools.dart`), the bundled list and its host plumbing.
- [x] 7. Dart tests for 3 to 6.
- [x] 8. Contract: `tools-api.ts`, `tools-messages.ts`, the bridge's methods, FakeCore.
- [x] 9. Background: `tools.ts` handlers.
- [x] 10. Popup: tag editor, tags page, reorder page.
- [x] 11. Popup: backup-code pages and coverage.
- [x] 12. Popup: duplicates pages.
- [x] 13. Popup: breaches page, Health's "Check now".
- [x] 14. Strings in `locales/parts/tools.{en,fr}.json`.
- [x] 15. Vitest tests, and a Playwright spec.
- [x] 16. Take the tools out of the not-done lists of the proposal, its popup spec and tasks, and say the README's network use.
- Not done: running any of it. The plan was written without a build, a test run or a type check (the owner runs one combined pass), so
  `npm run format`, `npm run typecheck`, `npm test`, `dart format`, `dart analyze`, `dart test` and the e2e run are still to come.
