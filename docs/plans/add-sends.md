# Sends in the browser

The extension makes, lists, edits and deletes Sends on Kemlock Server, and opens a Send from its
link, as the app does (`docs/plans/add-sends.md` in the app's repository, `../kemlock`). A Send is
a text or a file that opens from a link until it is deleted, expires or has been opened as often as
the owner allows. The key is only ever in the link's fragment, which no request carries, so
Kemlock Server can't read it.

Every byte is the server's contract (`docs/crypto.md` "Sends", `crates/kemlock-api-kem/src/routes/sends.rs`
in `../kemlock-server`). The extension adds nothing to it: Kemlock-core's own Sends client does the
sealing, the proof of a password and the routes, and the extension shows what it gives.

## Why

The extension is a finished product only if it can do what the phone does with the vault, and Sends
are free for every account (the owner, 2026-11-23: Kemlock is free, nothing is gated). The popup
shows codes, backup codes and logins, and has no Sends. A person at a computer who wants to hand
someone a password or a file by a link that ends has to take the phone out.

## What changes

- **The client logic moves into Kemlock-core**, where the browser's core reaches it
  (`parity/sends` of Kemlock-core, the `c-sends` worktree). The app's `send_link.dart`,
  `sends_service.dart` and `sends_recipient.dart` have no Flutter in them, and the wire format and
  crypto (`crypto/account/send.dart`, `km_sends_api.dart`) are in the core already. They arrive at
  `lib/features/sends/` unchanged, with the rules of `sends_support.dart` that need no UI
  (`sends_rules.dart`) and the app's tests over the core's fake server. **The app is left as it
  is**: it should drop its copies and import the core's later (see "Not in this plan").
- **A Sends list in the popup**, from a card on Home: each Send's name, kind (text or file),
  status (active, expired, used up, off, waiting for its file), opens used of the limit, and when
  it is deleted. A Send made in a Bitwarden app is listed apart and can be deleted, never opened,
  edited or shared, as in the app. A Send whose name doesn't open here is listed with Delete only.
- **A Send's page in the popup**: its state and notes, its text (hidden until asked), Copy link,
  the on and off switch, Edit and Delete. Copying goes through the background's clipboard, which
  clears itself (`src/background/clipboard.ts`): the core rebuilds the link from the Send's
  sealed key and hands it to the background, and **no page ever holds it**.
- **Edit** changes the name and text (of a text Send), the deletion date (1 to 30 days), when the
  link stops working, the open limit (not under the opens used), the password (set, change or
  remove), "Hide my email" and the notes. Only what changed goes to the core, which keeps the rest
  as the Send has it. A file Send's file and name never change.
- **New Send, in a tab of its own** (`src/sends/`, like `src/setup/`), because choosing a file
  closes the popup: a text, or a file up to 50 MiB, with the app's options (deleted after 1 to 30
  days, 7 by default; an earlier expiry; a limit on opens; a password; "Hide my email"; notes only
  the owner sees). A file crosses to the core in pieces of 1 MiB (a message is JSON), and the core
  seals it. The page then offers Copy link and never shows the link.
- **Opening a received Send**, in the same tab (`#open`): the person pastes a link, or a message
  that holds one. The core reads it strictly and asks the link's own server for the sealed Send
  with no account, token or proof of device, opens it with the key from the fragment, and the page
  shows the text (Copy, through the clipboard that clears itself) or the file's name, type and size
  (Save, which fetches it, counts an open and hands the browser a download). A password is asked
  only when the server says so; the Argon2id proof is made in the core and only it is sent. The
  vault must be unlocked, as the app's vault must be open; no Kemlock Server sync is needed.
  A Bitwarden Send's link is refused with an offer to open it in a browser tab.
- **Access to the link's server** is asked from the click that opens it
  (`permissions.request` for `https://<host>/*`), since a link may name any server; the sync
  server's access was asked at setup.
- **Where Sends can't be**, the popup and the tab say so: "Sends need Kemlock Server sync" for a
  vault that syncs with a WebDAV folder or Vaultwarden (named) or with nothing, with a button to
  the setup tab. Opening a Send someone gave you still works. The app supports Sends on Kemlock
  Server only, so Vaultwarden has none here either.
- **The server's own words** (a space policy's reason, the biggest file, the wait after too many
  tries, "home server offline since …", "session ended") reach the page, as text, with the app's
  wording and its French.

## Not in this plan

- **Switching the app to the core's copy.** The app keeps its own `features/sends/send_link.dart`,
  `sends_service.dart` and `sends_recipient.dart`; a later change in the app should replace each
  with an `export` of Kemlock-core's, as `add-kemlock-server-sync` did for the other moved files,
  and pin the new commit. The two copies are byte for byte the same until then.
- **Recognising a Send link where it is opened.** A link is `https://<host>/#/send/…` on whatever
  server the sender uses, so no content script, `externally_connectable` or context-menu pattern
  can name it in advance: a match pattern has no fragment, and a menu on every link would be noise.
  The person pastes the link. (The web vault's own recipient page opens it in the browser anyway.)
- **Saving a received text as a note, and making a Send from a login or a note.** The extension
  shows and edits logins and codes only; notes and the owner check come with the items work.
- **The app's share sheet and its pending-link hand-over**, which have no browser counterpart.
- **Sends owned by a space, email-verified recipients, a QR code of a link.** The app's plan
  leaves them out too.
- **Streaming a file.** A file is held whole in the core (up to 50 MiB, plus its sealed copy)
  while it is made or opened, and dropped, zeroed, when the Send is made, the page goes, or the
  vault locks. Bytes reach no disk until the person's browser saves the download.
- **A Bitwarden app's Sends opened, edited or shared.** The server keeps them in another format
  ("a client never mixes the two").
- **Offline mode.** The extension has none; a Send request that can't reach the server says so.

## Design

- **Where the code lives.** Kemlock-core: `lib/features/sends/{send_link,sends_service,
sends_recipient,sends_rules}.dart` (moved), with its tests. The browser's core:
  `core/lib/src/sends.dart` (`SendsApi`: JSON in and out, over the sync's `KmHost` through two
  getters of `SyncService`, `kemlockPlace` and `syncPlace`), wired in `core_service.dart`.
  TypeScript: `src/shared/sends*.ts(x)` (types, texts, the form's options and fields),
  `src/background/sends.ts` (who may ask, the clipboard), `src/popup/sends.tsx` and
  `send-page.tsx`, `src/sends/` (the tab), and `locales/parts/sends.{en,fr}.json`.
- **Who may ask.** A new page, `/src/sends/index.html`, is a sender the background knows
  (`senders.ts`). The popup and the tab may list, read, copy, change and delete Sends; making
  one, staging a file and opening or downloading a received one are the tab's alone. No other
  page, menu frame or content script is answered. Every message is parsed into a fresh object of
  its known fields with bounded sizes (`messages.ts`).
- **Results, not exceptions.** Every Send call answers `{ok: true, value}` or `{ok: false,
problem, ...}`, so the server's words reach the page (`SendResult`). A locked vault throws, as
  everywhere.
- **Secrets.** The link, the link key, the payload and meta keys, the password and its proof stay
  in the core. The owner's link goes from the core to the clipboard in the background. A received
  link's key stays in the core, and so does the received file until the page asks for its pieces.
  The page holds a received Send's content, which is what opening it is for, and drops it on Close.
  Nothing logs a link: errors reach the background as codes and kinds only.
- **Handles.** The core holds a staged file or a received Send for one tab, under a random handle it
  answers that tab alone (the first `sendStageFile`, `sendOpen`). Every later call about it names the
  handle (stage, make, download, read, copy, close), so two Sends tabs never meet each other's file
  or Send. A file Send is made from the file under its handle, and only if the core holds as many
  bytes as the page counted (`size`). At most four of each are held; the oldest goes. A handle the
  core doesn't know is `lost`: the page says to open the link or choose the file again.
- **The worker stopping.** Chrome stops an idle service worker after about 30 seconds, and what the
  core holds goes with it. While a Send is open in the tab, or a file is going up, the tab holds a
  port to the background and pings it every 15 seconds (a message starts the idle time over); the
  background keeps a port from the Sends tab only. If the worker stops all the same, the next call
  finds no handle and the page says so.
- **Only the link found goes on.** The page sends the core, and asks the browser for the access of,
  the one link its pattern found (22 characters of access id, a key of 43 or 22 and nothing after
  it), never the whole text.
- **Staged bytes** are kept as the pieces they came in, each zeroed when the file is made, closed
  or locked; the file is put together once, for the Send.
- **Locking** zeroes every received Send, its file and every staged file (`SendsApi.unload`).

## Tasks

### 1. Kemlock-core

- [x] 1.1 Move `send_link.dart`, `sends_service.dart` and `sends_recipient.dart` to
      `lib/features/sends/`, and the non-UI rules of `sends_support.dart` to `sends_rules.dart`.
      Verify: `dart analyze`, and the tests below.
- [x] 1.2 The app's link, service and recipient tests over the core's fake server (minus the
      app's offline-mode gate), and a test of `sends_rules.dart`. Verify: `dart test`.

### 2. The browser's core

- [x] 2.1 `core/pubspec_overrides.yaml` over the worktree (gitignored), so the core builds against
      the moved files. The pin in `pubspec.yaml` and `pubspec.lock` moves later (4.2).
- [x] 2.2 `SendsApi` and its wiring: the owner's list, detail, link, make (with a file staged in
      pieces), update, delete; a received Send's open, download, file pieces, text and close.
      Verify: `core/test/sends_test.dart` (no sync, staging, a Send opened over a fake public route,
      the lock).

### 3. The extension

- [x] 3.1 The contract: `CoreApi` and `PageApi` (`api.ts`, `shared/sends.ts`), the page messages
      (`messages.ts`), the sender (`senders.ts`), the bridge's methods, `FakeCore`'s Sends.
- [x] 3.2 The background's handlers (`background/sends.ts`). Verify: Vitest.
- [x] 3.3 Strings in `locales/parts/sends.{en,fr}.json`, the app's wording.
- [x] 3.4 The popup: the card on Home, the list, a Send's page and its edit form. Verify: Vitest.
- [x] 3.5 The Sends tab: New Send (text, file, options), Open a Send (permission, password, text,
      file), added to the build. Verify: Vitest.
- [x] 3.6 Playwright: the pages without a server, and the whole round trip on a real server
      (skipped without `KEMLOCK_SERVER_URL`).

- [x] 3.7 Review fixes: a handle for every staged file and received Send, the worker held while a
      tab has one, the one link found sent on, expiry choices counted from what is left of a kept
      deletion date, staged pieces zeroed, file names without a backslash or a bidi control, and
      the core's decoding errors answered as `server`. Verify: Vitest and `dart test`.

### 4. Left to the main session

- [ ] 4.1 One combined pass: `dart format`, `dart analyze --fatal-infos`, `dart test` in
      `core/`; `npm run lint`, `typecheck`, `test`, `build`, `test:e2e`; and Kemlock-core's own
      checks (`dart test`, and `dart test -p chrome -c dart2wasm -t wasm`).
- [ ] 4.2 Merge Kemlock-core's `parity/sends`, move the pin in `core/pubspec.yaml` and
      `pubspec.lock` to its commit, and delete `core/pubspec_overrides.yaml`.
- [ ] 4.3 In the app: replace its three copies with exports of the core's (a later change).

## Risks

- **A file is held whole in memory.** Up to 50 MiB in the background (the staged bytes, then the
  plain bytes, then the sealed copy), and a received file's plain and sealed bytes. A service
  worker has no hard limit on it, but a computer short of memory may feel it. The pieces cross as
  base64 JSON, about 1.4 MiB at a time. Four files and four received Sends at most may be held
  at once, so the worst case is several hundred MiB; the usual case is one.
- **The server's CORS.** The background's `fetch` reaches a server it has host access to, which
  is asked for at setup (the sync server) or from the click (a link's server). Without access the
  request is not made at all.
- **The proof's cost.** Argon2id at 19 MiB runs on the core's own thread under dart2wasm (there are
  no isolates), so a password-protected Send freezes the background for a moment, as the sign-in's
  proofs do.
- **The pin.** The browser's core builds against a Kemlock-core commit that is not on `main` yet;
  the override makes a local build work, and CI will fail until step 4.2.
