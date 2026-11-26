# Kemlock Server's item format in the browser

The extension reads and writes the item format Kemlock Server's web vault and the app now share:
custom fields, two-way links between items, File items, files attached to notes, the contact
details of a contact, a name and websites for a code, and a match rule for each website of a
login. Today the browser carries all of it through a sync untouched and shows none of it. This plan
makes it first-class, as `add-items` did for notes, cards and identities.

It changes `add-items` (`docs/plans/add-items.md`, decision 3: a note's files are no longer always
read-only) and builds on `add-kemlock-server-sync`. The format is described in the server's
`docs/crypto.md` ("Item bodies") and `docs/custom-fields.md`; the web vault's `features/vault`
(`forms/extras.ts`, `links.ts`, `attachments.ts`, `saveFlow.ts`) is the reference the popup follows.
The models live in Kemlock-core (`feat/item-fields-links`, `feat/file-items`): this plan codes as if
they are already merged and pinned.

## Why

The owner asked on 25 November 2026 for the browser to catch up with the format the server's web
vault already writes. A person who keeps a recovery PIN in a hidden field, links a login to its
card, or attaches a scan to a note on the web expects to see it in the browser and to change an
item without losing it. The browser keeps what it doesn't show, but it shows too little: a note's
files can't be opened, a File item is invisible, a code has no name of its own, and a contact must
hold a PGP key.

## What changes

- **Custom fields.** Every kind but passkeys and files carries a list of fields: Text, Hidden
  (masked) and Checkbox, each with a name and a value, never required. A field can be the
  person's own or an admin's definition (`GET /kem/v1/custom-fields`, Kemlock Server only), which
  fixes its name and kind and leaves the value to the person.
  - The popup lists the fields on each page, a hidden one behind Show and Copy, a checkbox as Yes
    or No, and edits them on each edit page: add, rename, change, remove. Where the account has
    admin-defined fields for the kind they are offered first; "Your own field" is offered when the
    account allows its own.
  - Fields the browser can't edit (a `linked` field the Bitwarden import writes, a kind this
    version doesn't know, a field with no name) stay where they were.
- **Links.** An item can link to others, and a link is two-way: saving one writes both items.
  A code's `linkedLoginId` counts as a link. The popup lists an item's linked items (each opens
  its own page) with Unlink, and the edit pages hold a picker that searches the vault. A link only one
  side holds is shown, marked as one-way.
- **Files, with Kemlock Server sync.** A File item holds one file, and a secure note up to 100 (50
  MiB each). Upload, download and delete go through the server's file routes, one file at a time
  and on demand; no file bytes are kept on disk.
  - A new tab of the extension (`src/files/`) takes the file, because a popup closes when the
    person picks one. It stages the file in 1 MiB pieces and keeps the background awake while it
    works. The note page's "Add files" and the File item's Replace open it.
  - Download reads the file back in 1 MiB pieces and saves it as a download.
  - With WebDAV or Vaultwarden the files are listed, read-only, with the notice "Files need
    Kemlock Server sync".
- **Contacts.** A contact carries a company, an email, a phone and an address, and the PGP key is
  optional: a contact with no key is a plain contact (`source: manual`).
- **MFA codes and backup codes** carry a name and websites. A code linked to a login shows that
  login's websites ("From <login>, change it there"). The code is called "MFA code" everywhere in
  the popup, never "Code".
- **A match rule for each website of a login** (Default, Base domain, Host, Starts with, Exact,
  Regular expression, Never), edited in a row beside each website and shown on the login's page,
  as `add-items` task 5 already matches them.

## Decisions

1. **The browser adds, and never rewrites what it didn't edit.** A save leaves every member the
   person didn't change as the body held it, byte for byte: missing `fields` or `links` in an input
   mean "keep", entries the browser can't edit (linked fields, nameless fields, links or
   attachments it doesn't know) stay in place, and an empty member is left out. A body written by
   a newer version round-trips.
2. **Files work only with Kemlock Server sync.** The vault's file bytes live apart from the vault
   (`KMA1`, sealed with the item's own key) and are fetched when the person asks, so WebDAV and
   Vaultwarden have nowhere the browser can put or read them. There they are listed with the
   notice and offer no action. A File item added without the server is refused (`unavailable`).
3. **Secrets leave the core one at a time.** A list view carries no hidden field's value and no
   file key. The page asks for one hidden value on Show or Copy (`revealField`); the edit page asks
   for all of an item's hidden values, as a login's edit page asks for its password. A file's key
   never leaves the Dart core: the popup receives plain bytes, a piece at a time.
4. **A file is uploaded by the run that syncs, not by the browser.** The core seals the staged
   bytes in memory, saves the item without the file's server reference, and runs one sync that
   uploads it and stamps the reference. If the item names no file afterwards, the save is taken
   back and fails (`failed`); a File item that fails is removed. Ids waiting for upload are kept
   in an encrypted extension value, and are removed at the next unlock if they still lack the
   reference, so an interrupted upload leaves no half-made item.
5. **Links are by entry id.** A link names the item's UUID, never the server's own item id, as
   the web vault and the app do; unlinking removes both ends. If one end can't be written (a
   space the person may only read) the other stays and the answer names the item whose end
   failed. The links to an item follow it: a delete takes them off the items that named it, a
   move to another owner renames them, and a duplicate merge points them at the kept item (Undo
   puts them back), each in the same write as the change, with kemlock-core's helpers. An end
   the person may only read is left as it is, one-way, and never fails the change.
6. **"MFA code", not "Code".** The word is the app's; the rename covers `popup.*` and `items.*`
   strings, the popup's tabs and its pages.
7. **The Files row is in the lists as every kind is.** Home shows Files beside Notes, with the same
   search; a File item's page offers Download and Copy name, and Replace and Delete with the
   server.

## Not in this plan

- Custom fields on passkeys and File items (the format has none), and a required field (never).
- Editing a `linked` field, or an attachment's name: they are kept as they are.
- Previewing a file in the browser: Download is the only way to read one.
- Pushing the Files tab's work through WebDAV or Vaultwarden: there are no file routes there.
- Admin fields for the kinds the server doesn't list; a definition applies to the kinds it names.
- Moving a vault with files to another Kemlock Server account from the browser: the account move
  refuses (`filesNeedPhone`) a vault that holds a File item or an attachment, as it does today.

## Tasks

- [x] 1. The core
  - [x] 1.1 Fields and links (`item_extras.dart`): read, edit and write per the models, two-way
        links with `linkedLoginId`, byte-stable saves.
  - [x] 1.2 Files (`item_files.dart`): staged and opened handles, upload through the sync run,
        download on demand, the pending list and its clean-up, `fileSync` in the state.
  - [x] 1.3 Admin definitions (`custom_fields.dart`), contacts and codes with the new members,
        website rules, File items in every list the core copies, `filesNeedPhone`.
  - [x] 1.4 Dart tests.
- [x] 2. The contract and the background
  - [x] 2.1 Types in `api.ts` first, then messages with their bounds, the keepalive port, the
        senders' gates, handlers (`items.ts`, `item-files.ts`) and the fake core.
  - [x] 2.2 Vitest: parsing and fuzz, the gates, the handlers, the fakes.
- [x] 3. The popup
  - [x] 3.1 Fields, links and rules (`item-extras.tsx`, `site-rules.tsx`), codes and contacts.
  - [x] 3.2 The Files row, a File item's pages, the note's attachments, the Files tab
        (`src/files/`), strings in `locales/parts/extras.*` and `locales/parts/files.*`, the
        "MFA code" rename.
  - [x] 3.3 Vitest component tests and the locales tests.
- [x] 4. End to end
  - [x] 4.1 `tests/e2e/items-extras.spec.ts` over a WebDAV vault: display, Show and Copy of a
        hidden field, a save that keeps what it didn't edit, links added and removed from either
        end, rules, a contact with no key, a code with a name and websites, files read-only with
        the notice.
  - [x] 4.2 New cases in `tests/e2e/kemlock-server.spec.ts` (skipped without the server): attach
        a file to a note, download it and compare the bytes, remove it, add, download and delete a
        File item, the admin's fields offered in the editor.
- [x] 5. This plan
  - [x] 5.1 Decision 3 of `add-items` points here.
