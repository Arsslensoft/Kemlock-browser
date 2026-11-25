# Shared spaces in the browser

The extension syncs the person's shared spaces on Kemlock Server (and the WebDAV spaces they joined), keeps their items in
the browser's vault the way the phone does, shows them in the popup, fills their logins and codes on pages, and lets the
person do what their role allows: add, edit and move items, answer an invitation, leave, and manage members and grants.

This plan is the "later plan over `add-server-spaces`' engine" that `add-kemlock-server-sync.md` ("Not in this plan: Shared
spaces") and `add-browser-extension` left. Where those disagree with this one, this one wins for spaces.

## Why

Until now the extension held the personal vault only: a person whose team keeps its logins and codes in a shared space saw
none of them in the browser, which is where they are used most. The app's engine is in Kemlock-core
(`lib/features/spaces/*`, `lib/features/sync/space_bridge_run.dart`) and the app's plan is `../kemlock/docs/plans/add-server-spaces.md`.
The extension already signs in to Kemlock Server and runs the vault's own scope through `core/lib/src/sync_service.dart`;
a space is one more scope of the same run (`KmSpaceSync`), with the same chain checks, keys and removal guard.

## What changes

- **Spaces sync in the same run.** After the vault's own scope, the run lists the account's spaces on the server
  (`GET /kem/v1/spaces`), and syncs each space the account is a confirmed member of as a scope of its own, by its UUID, with
  `KmSpaceSync.sync` exactly as the app's scheduler does: chain verified against the device's anchor, keys opened through the
  chain's commitments, the signed manifest checked, items merged by `mergeScope` and applied by `applyScope`, the removal
  guard, the collection of each item kept in the scope state. A space's items live in the browser's vault lists with their
  `spaceId`, as on the phone, so nothing about storage changes.
- **First contact and anchors.** A space nobody on this device has compared the fingerprint of holds nothing: no key opens
  and no item merges. The popup shows the app's first-contact step (the inviter's or confirmer's 12 groups of 5 digits, typed
  or compared by eye; there is no camera scan in a popup) and stores the anchor only once the digits match. Anchors are
  kept with the vault and carried between the account's devices by the vault's own sync (`SyncedSpaceAnchorStore`), as the
  app's are.
- **What the chain finds is shown, never trusted.** A chain that forks, goes back or carries an unauthorised signature shows
  the space as "Can't be checked" (`spaceCantBeChecked`) with nothing stored; an older copy, a withheld or resurrected item or a
  failing manifest shows `kemlockOlder`; a space waiting for new keys shows `spaceKeysPending`; a removal that would take
  many entries stops at the removal guard, which the popup already asks about. The problem of each space is shown on its row.
- **Popup.** A Spaces section (name, member count, the person's role, a problem or "Compare fingerprint" / "Waiting to be
  confirmed" / "Invited"), and a space page: the items by kind, the members with their roles and states, the collections with
  grants, the policies the chain records, the keys, and the items the server holds back. Space logins and codes appear in
  the normal lists and in the "site in front" block with a space badge, and fill on pages like the personal ones: the matcher
  already matches every login and code of the vault, and a space's are in it.
- **Hidden passwords, fail closed.** A grant of "view, hide passwords" or "edit, hide passwords" hides a space login's password
  from the person (no Show, no Copy), while filling still works, as on the phone. A login of a space whose chain has not been
  verified in this session counts as hidden until it has (`HiddenPasswords`).
- **Items.** Add a login, a code or any other item the person can add, edit one, move it into or out of a space, and put it
  in one of the space's collections, each as the verified chain allows (edit on the collection, a key of its current
  version, no key marked). A move into a space is a change of the entry's `spaceId`; the engine does the rest.
- **Invitations and members.** Accept or decline an invitation (after first contact), leave, make a space, invite by email, confirm a member after
  comparing their fingerprint, change roles, remove or revoke, give and take grants, and send an invitation again, each
  offered only where the chain's own authority check (`checkAction`) says the person may, and sent to the space's home
  alone. While the home is away the actions wait and say so.
- **WebDAV spaces.** The WebDAV spaces the person joined (`SyncSettings.spaces`) are listed and synced as the app's
  scheduler syncs them (`runWebDavScope`): join with an invite and its one-time code, leave, items as for server spaces
  without roles. A space that has moved to the server (it carries a `SpaceOnServer` note) is left to the phone, which
  holds the bridge and its WebDAV key; the browser lists it as "Moved to Kemlock Server" and leaves it alone, so its entries stay
  as they are and hidden, as the phone hides them until their chain is read. A vault that syncs nowhere else has no alarm to run
  its WebDAV spaces: they sync when the person refreshes the Spaces page.

## Not in this plan

- **Replacing keys after a removal** (`KmSpaceSync.replaceKeys`). The app doesn't wire it either: it needs the text of every
  name, which the server has no route for yet. The space shows "Keys need replacing" and writes pause (`spaceKeysPending`)
  until a phone does it.
- **Moving a WebDAV space to the server and the bridge** (design 7 of the app's plan), and closing the WebDAV copy. They
  hold the WebDAV key and need the phone's move screens; the browser leaves any space with a move note alone.
- **A camera scan of a fingerprint's QR code.** A popup has no reliable camera; the digits are compared by eye.
- **Changes queued by outside clients** (`SpacePendingClient`) and **account recovery enrolment**: the Admin's approval of a
  queued change and "Agree" to recovery stay on the phone and the web vault. The space page says when either is waiting.
- **Policies that need a phone's own state**: "no export" (the extension has no export of space items; the transfer stream
  must use `hiddenLoginIds`/`spaceItemIds` when it adds one), "one space per member" is shown, not enforced beyond the server's
  own refusal, and the minimum master password length concerns the account's password, which the browser never types.
- **Editing a login whose password a grant hides** shows its other fields and keeps the password as it is (`keepPassword`); the
  generator and the password field are not offered.
- **Items of kinds other parts add** (notes, cards, identities, keys): a space page lists and moves them, and the core refuses any
  change to one the chain doesn't let this account edit (`VaultService.editGuard`); the parts that save those kinds call it.
- **The in-page menu** does not show the space badge: it lists names only.
- **Naming collections.** Their names are sealed items the server has no route for yet; the page shows a collection by the
  start of its id, as the app does.

## Decisions

Taken as the app has them; none was asked of the owner.

| #   | Question                                                 | Decision                                                                                                                                                  |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Where the app's non-core space code lives.               | Copied into `core/lib/src/spaces/` (listing, invites, members, contact, fingerprint: pure Dart, no Flutter), and moved to Kemlock-core when the app does. |
| D2  | How a space's chain and keys are opened for one request. | `KmHost.withAccount`, which wipes the account's keys when the request returns, as the app's `KmServerSpaces` does.                                        |
| D3  | When spaces sync.                                        | In the same run as the vault's own scope (alarm, unlock, after a change, Sync now), after it.                                                             |
| D4  | What a hidden password blocks.                           | Show and Copy in the popup (`showPassword`, `copy`); filling and the page's "Save" comparison read it inside the background, as the phone does.           |

## Tasks

Written without a build: the checks are the main session's one combined run (`dart format`, `dart analyze`, `dart test`, `npm run
lint`, `typecheck`, `test` and `test:e2e`).

### 1. Core (Dart)

- [x] 1.1 Copy the app's pure-Dart space code the engine doesn't carry (`space_listing`, `space_invites`, `space_members`,
      `space_contact`, `fingerprint`) into `core/lib/src/spaces/`.
- [x] 1.2 `SpacesService`: list, read a space, first contact, accept/decline, make, leave, invite, confirm, role, remove, grants,
      resend, held items, own fingerprint. Verify: `core/test/spaces_test.dart` for what needs no server. What reads a chain (list,
      page, contact, trust) has no Dart test here: the engine's chain fixtures are in Kemlock-core's own `test/`, which a package
      doesn't export. Next step: a chain kit of its own, or Kemlock-core exporting its test kit.
- [x] 1.3 Spaces in the sync run (`SyncService`): list, run each confirmed space as a scope, the problems per space, anchors carried
      by the vault's sync, the hidden-passwords holds. Verify: `core/test/spaces_test.dart` (the WebDAV scopes), `tests/e2e/spaces.spec.ts`.
- [x] 1.4 Items: `space` on the views, moves into and out of a space, `hiddenLoginIds`, `editGuard`, `keepPassword`.
- [x] 1.5 WebDAV spaces: join with an invite, sync, leave. Verify: `core/test/spaces_test.dart`.

### 2. Contract and background (TypeScript)

- [x] 2.1 `src/shared/spaces-api.ts` (types, merged into `CoreApi`, `PageApi` and the item views), `spaces-messages.ts` (validated
      requests), one spread in `messages.ts`.
- [x] 2.2 `src/background/spaces.ts`: the page handlers, sender checks, the hidden-password refusal in `showPassword` and `copy`.
- [x] 2.3 The spaces' methods in `bridge.ts`. Verify: `src/background/spaces.test.ts`, and the core's test that the methods are the bridge's.

### 3. Popup

- [x] 3.1 Spaces card on Home, the list of spaces, and the space page (items, members, collections, policies, keys, held).
- [x] 3.2 First contact, accept/decline, make a space, invite, confirm with the fingerprint, roles, grants, leave.
- [x] 3.3 Space badge on logins and codes (lists and the site block); where an item lives on a login's page and in a new login's form;
      "Add one of yours" for codes and backup codes on the space page; a hidden password hides Show and Copy.
- [x] 3.4 Strings: `locales/parts/spaces.en.json` and `.fr.json`. Verify: `src/popup/spaces.test.tsx`, `tests/e2e/spaces.spec.ts`.
