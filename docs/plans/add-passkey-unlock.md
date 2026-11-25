# Unlocking the browser's vault with a passkey, Windows Hello, Touch ID or a security key

The extension's vault opens with its password only. This plan adds a second way in, a WebAuthn
credential with the PRF extension: Windows Hello, Touch ID or another platform passkey, or a roaming
security key. The password still opens the vault, always.

This plan changes `add-browser-extension` (`docs/plans/add-browser-extension/`), the extension's first
plan, which left "Biometric or security-key unlock of the browser's vault" out. Where the two disagree,
this one wins.

## Why

The owner wants a finished product, and the first plan's "not in this change" list held this item. A
password manager that asks for a long password a dozen times a day is one people turn into a short
password or stop using. The phone's lock screen already offers biometrics and security keys; the
extension should too, with the same idea: an extra way to reach the vault key, with the password
untouched beside it.

## What changes

- **A key slot.** Turning it on registers a WebAuthn credential with the PRF extension. The 32-byte
  PRF output goes through HKDF-SHA-256 (salt: a random salt of the vault's, info: a label and the
  vault's id) to a wrapping key, which seals the vault's ML-KEM-1024 private key with AES-256-GCM, the
  way the vault's own password wrap is made (a wrap nonce that says whether the values are
  authenticated; the credential id as additional data). The slot, with the credential id, its name and
  when it was added, is kept in `storage.local` beside the vault's config. It is ciphertext: without
  the authenticator's PRF output it opens nothing. Several credentials are allowed, each named and
  removable.
- **A page for the ceremony.** WebAuthn runs in a tab page of the extension (`src/unlock/`), not in
  the popup: the popup closes when the browser's or system's prompt takes focus (Chrome, Firefox bug
  2026687). The popup's lock screen and Settings open that tab.
- **The lock screen.** When a credential is set up and the password isn't required, the lock screen
  offers "Unlock with a passkey or security key" first, with the password form under it. A wrong
  password is counted as before, and the auto-lock rules are unchanged. Opening by passkey sets the
  wrong-password count to zero, as every open does on the phone.
- **When the password is required again.** The app's biometric unlock has no timed rule of its own,
  only its erase after N wrong passwords. For a browser the extension adds two: the passkey is
  withheld after 5 failed passkey tries in a row (a wrong answer from the authenticator, not a
  cancel), and after 14 days without the password. The lock screen then says so, and one password
  unlock lifts both. When the password was last typed is its own record
  (`backmycodes_extension_password_unlocked_at`), written by every password unlock and by creating
  the vault, with credentials or without. Making, adding or removing a credential never writes it, and
  removing the last one doesn't delete it, so removing and adding a credential can't start the days
  over.
- **Adding asks for the vault password.** Whoever sits at an open browser must not be able to enrol a
  key of their own. `addPasskeyUnlock` carries the password, and the core checks it as an unlock does
  (the try written down first, counted when wrong, cleared when right). The unlock tab asks for it
  beside the name; when it is wrong, the credential already made is kept in the page and only the
  password is asked again.
- **Feature detection.** `PublicKeyCredential.getClientCapabilities()` (`extension:prf`) tells whether
  the browser has PRF. Without it, Settings says so in one line and offers nothing, and the lock
  screen shows no button. Firefox is told why (see below) in Settings, on the unlock tab, and by no
  button on the lock screen, and the core refuses to make, add or ask a credential there. Where a browser can't say, the option is offered and enrolling checks the
  answer (`prf.enabled` or a PRF result), and says plainly when the authenticator has no PRF.
- **Settings › Security.** A section lists the credentials by name with Rename and Remove, and
  "Add a passkey or security key" with the choice of this device or a security key.
- **Password changes and removal.** A new vault password re-wraps the same private key, so every slot
  keeps working (a test with the core's own change of password when it is there, and by the wrap
  itself otherwise). Removing the vault removes the slots, since the core erases every key of storage.
- **Docs.** The item leaves the "Not in this change" list of `add-browser-extension`'s proposal.

## Not in this plan

- Replacing the vault's key pair from the extension: it has none today. A slot of a replaced key pair
  would no longer open the vault; unlocking says so ("use the password, then turn it on again") and
  the slot isn't deleted by itself.
- Unlocking with a security key's PIN alone or with "key and password both" (the app's
  `UnlockMode.both`): the browser's vault keeps one way to open it that always works, the password.
- A slot that opens without a prompt. A passkey unlock always asks the authenticator, with user
  verification required.
- **Passkey unlock in Firefox.** Firefox gives an extension page no relying party of its own: from
  150 it may name only a domain its host permissions cover (MDN, "Use Web Authn API in web
  extensions"), and refuses the default of a `moz-extension` address. A credential made for
  `unlock.kemlock.arsslensoft.com` or any such domain would answer to a page on it or on a
  subdomain, and to another extension with all-sites access, which can then read the same PRF output
  from the salt and credential id the record keeps in the clear. So nothing is offered there, until
  Firefox offers an extension-scoped relying party (the owner decided on 24 November 2026): Settings
  and the unlock tab say why in one sentence, the lock screen shows no button, and the core refuses
  `passkeyUnlockPrepare`, `addPasskeyUnlock` and `unlockWithPasskey` for the Firefox build. There
  is no Firefox code path left to reach. Chrome and Edge are unaffected: their credentials are bound
  to the extension's id.
- Safari: the other stream's. Its extension pages have no WebAuthn with PRF to rely on here.
- Syncing slots: a slot is for one authenticator in one browser. It is in no list and no sync file.

## Design

### The slot

```
prf   = the authenticator's PRF output for salt S         (32 bytes)
wrap  = HKDF-SHA256(prf, salt: S, info: "Kemlock browser passkey unlock v1: wrap " + vaultId)
slot  = AES-256-GCM(wrap, nonce, privateKey, aad: credentialId)
```

`S` is 32 random bytes made when the first credential is added, kept in the record and given to every
credential as its PRF input, so one challenge serves every credential. The record, under the storage
key `backmycodes_extension_passkey_unlock` (a vault key, so a hidden vault's would be apart):

```
{ "v": 1, "salt": b64, "rp": string?,
  "slots": [ { "id": hex, "credential": b64, "name", "addedAt", "lastUsedAt"?, "attachment"?,
               "transports"?: [..], "nonce": b64, "ct": b64 } ] }
```

The failures of passkey tries are `backmycodes_extension_passkey_failures`, `{"count", "last"}`, in the
clear like the wrong-password count: written before the answer is checked and cleared when it opens.

The private key is wrapped with the nonce `authenticatedWrapNonce()` when the vault's values are
authenticated, so a session opened by a slot demands them too and never lowers what the vault demands.

### Where WebAuthn runs, and its relying party

- **Chrome and Edge:** an extension page may use WebAuthn, and leaves the relying party's id out, so
  the browser's default, the extension's id, is used (`content/browser/webauth/origins.md`).
  Credentials belong to this extension and no web page can ask for them.
- **Firefox:** not offered, for the reason under "Not in this plan".
- The credential's id and relying party are kept in the slot, so unlocking asks for what was made.

### The ceremony, in `src/unlock/`

Enrolling (`#add`): the page asks the background for the salt and the credentials already there (to
exclude), then `navigator.credentials.create` with `prf: { eval: { first: salt } }`,
user verification required, no discoverable credential needed, a user handle of its own for each
credential (so an authenticator that keys credentials by it keeps them all), the attachment the person
chose (this device, a security key, or any). It insists on the PRF answer: the credential is created with
`prf.enabled`, and then asked once more (`get`) for the output, which is the one the slot wraps, so
what unlocking later reads is exactly what was wrapped, whatever the authenticator does at creation.
That is two prompts, said on the page.

Unlocking (`#unlock`): the page asks the background for the credentials and the salt, calls
`navigator.credentials.get` over them with the PRF input, and sends the credential id and the output
to the background, which opens the vault, or answers that it didn't. The page starts by itself and has
a "Try again". On success the tab closes.

The PRF output reaches the background in a message from an extension page, as the typed password does;
it is never stored, and the background asks the core, which wipes what it derived.

### Who may ask

The popup and the unlock page may read the credentials list (names and ids: nothing secret). Only the
unlock page may unlock by passkey or add one. The popup may rename and remove. Adding, renaming and
removing need the vault open, and adding needs the vault's password as well. The sender is the browser's report of the page's path, as for every page.

## Tasks

Each task names how it is verified. The checks are one combined run after the branch is written.

- [x] 1. Plan, and the item out of the not-done list.
- [x] 2. The core: `core/lib/src/passkey_unlock.dart` (the record, wrap and unwrap, the rules), and
      `VaultService`/`CoreService` hooks. Verify: `core/test/passkey_unlock_test.dart`.
- [x] 3. The contract: `CoreApi` and `PageApi` methods, the message parsers, `FakeCore`, the bridge's
      method list. Verify: `messages.test.ts`, the methods tests of both sides.
- [x] 4. The background: handlers, the unlock page's sender, the rules for who may ask. Verify:
      `src/background/passkey-unlock.test.ts`.
- [x] 5. The ceremony: `src/unlock/ceremony.ts` (detection, create, get, PRF) and the page. Verify:
      `src/unlock/ceremony.test.ts` over a fake `navigator.credentials`.
- [x] 6. The popup: the lock screen button and Settings › Security. Verify: `src/popup/passkey-unlock.test.tsx`.
- [x] 7. Strings in `locales/parts/unlock.en.json` and `.fr.json`; the build's pages.
- [x] 8. A Playwright spec with a virtual authenticator (`hasPrf`): `tests/e2e/passkey-unlock.spec.ts`.
- [x] 9. The review's fixes: when the password was last typed kept apart from the record; adding asks for
      the password; no passkey unlock in Firefox; a stale slot of any bytes answers `stale`; an open
      vault is left as it is. Verify: the same tests, extended, and `src/unlock/App.test.tsx`.
- [ ] 10. The combined run: `dart test` in `core/`, `npm run lint`, `typecheck`, `test`, `build`,
      `test:e2e`. Left to the main session, which runs one pass.

## Risks

- **Firefox.** Not offered; revisit when Firefox gives an extension an origin-scoped relying party.
- **PRF on Windows Hello and Touch ID.** Browsers and operating systems differ in which platform
  authenticators have PRF. Nothing here assumes it: the feature is detected and enrolling checks it,
  and a security key is the way where a platform has none.
- **Slots of a replaced key pair.** See "Not in this plan".
