# Passkeys in the browser

The extension shows the vault's passkeys and becomes the browser's passkey provider: a site that asks
for a passkey (`navigator.credentials.create` and `.get`) can be answered by Kemlock, with a passkey
that is the same record the phone keeps, so one made here signs in there and the other way round.

This plan changes `add-browser-extension` (`docs/plans/add-browser-extension/`), whose proposal listed
"Passkeys as a browser credential provider" under "Not in this change". Where the two disagree, this
one wins; the old text stays as it was.

## Why

The vault already carries passkeys (the phone's credential providers write them, sync carries them),
but the extension keeps them untouched and invisible. On a computer the person then signs in with a
passkey through the browser's own store or a phone, while the passkeys in Kemlock sit unused. The
owner asked for browser parity: the passkeys listed, and Kemlock offered where the browser asks.

## What changes

- **Popup.**
  - A Passkeys list on Home (a third tab beside Codes and Logins): the site (or the name the site gave
    itself, or the person's label), the user name and when it was made. Search covers it.
  - A passkey's page: site, user name, display name, created and changed times, a link that opens the
    site, a link to the login of that site when the vault has one, and Delete (with a confirmation).
    The key is never shown.
  - The passkeys of the site in front show in "On this site" on Home, and the passkeys of a login's
    site show on the login's page.
- **The provider.** Two small scripts the extension registers for every frame, at `document_start`,
  while it holds access to all sites:
  - `passkey-main.js`, in the page's own world (`world: "MAIN"`, Chrome 111 and Firefox 128 and later):
    wraps `navigator.credentials.create` and `.get` for `publicKey` requests (and the two
    `PublicKeyCredential` availability checks). It turns the request into plain data, and gives back
    a `PublicKeyCredential`-shaped object, or calls the browser's own function when Kemlock does not
    answer.
  - `passkey-bridge.js`, in the extension's isolated world: takes the request over a `MessagePort`
    the page script hands it with `window.postMessage`, refuses anything that does not come from its
    own window, and passes it to the background. The answer comes back by the background's message to
    the frame and on that port.
- **Who decides what.** The page script decides nothing: it asks. The background decides whether to
  offer (provider on, a vault, the site not excluded, a request Kemlock can serve: ES256, no PRF, no
  cross-platform-only request, https or localhost), checks the relying party against the frame's real
  origin (the browser's `sender.origin`, never the request), and hands the person the choice in a menu
  frame the page cannot read:
  - Creating: "Save a passkey in Kemlock" or "Use another device or key".
  - Signing in: the matching passkeys, or "Use another device or key"; with none that match, the
    browser's own prompt appears at once.
  - The person's click, through the menu's click gate, is the user presence; the vault being open is
    the user verification. A locked vault shows the unlock form in the same card.
  - A "Don't offer here" link keeps Kemlock out of that site's passkey prompts.
- **Conditional mediation.** A page that asks with `mediation: "conditional"` gets the browser's own
  request running as before, and Kemlock registers the request with the background; the existing
  field button and its menu then list the site's passkeys for that frame, and picking one answers the
  page. Whichever answers first wins and the other is cancelled.
- **The core.** The platform-free part is in Kemlock-core (`features/passkeys/passkey_bytes.dart`,
  moved from the app unchanged, and `passkey_provider.dart`): the ES256 (P-256) key, the credential
  id (16 random bytes, as the phone makes it), the record in the vault (`Passkey`, PKCS#8 key in
  base64), authenticator data (flags 0x5D on creation and 0x1D on sign-in: UP, UV, BE, BS; counter 0;
  Kemlock's AAGUID), attestation `none`, the assertion's signature (low-s DER, as the phone), and the
  relying-party check by the Public Suffix List. The extension's core exposes `passkeys`,
  `deletePasskey`, `checkPasskeyRp`, `createPasskey` and `signPasskey`.
- **Settings.** "Passkeys in this browser" switch (on by default; off, the scripts are not registered
  and the browser behaves as if Kemlock were not there). It needs access to all sites, which the
  Site access section already holds.
- **Sync.** A passkey made here is a `Passkey` with its change time set, so the next sync carries it,
  and a delete is a delete of that entry, as for every other kind.

## Not in this plan

- **EdDSA and RS256.** The app makes ES256 passkeys only (`coseEs256`), and a request that does not
  list -7 goes to the browser.
- **PRF, large blob and other extensions.** The app's providers ignore them. A request that asks for
  `prf` goes to the browser, so a site that needs it is not answered with a credential it can't use.
  `credProps` is answered.
- **A signature counter.** Counters stay 0, as the phone's do (the passkey is synced, so a counter
  could not be kept in step).
- **Replacing a passkey for the same account.** WebAuthn asks an authenticator to overwrite a
  credential with the same relying party and user id; the phone adds a new one and so does this. An
  old one is deleted by hand.
- **Passkeys without access to all sites.** The page script has to run before the page's own, which
  only a registered script does, and that needs the host permission. With activeTab alone there is no
  provider; the passkeys are still listed and deleted in the popup.
- **Editing a passkey's label, note or tags** (the phone's sheet does). The browser lists, links and
  deletes, as asked.
- **Passkey inbox.** The phone seals a passkey made while its vault is locked to an inbox; the
  extension opens the vault (or asks for its password) before it makes one, so it needs none.
- **Cross-origin iframes without the permissions policy.** They go to the browser; with it, the
  assertion's client data says `crossOrigin: true` and the top origin the browser reports.
- **Safari.** As the rest of the extension.

## Tasks

- [x] 1. Plan: this file.
- [x] 2. Kemlock-core: `passkey_bytes.dart` moved from the app (byte for byte), and
      `passkey_provider.dart` (request parsing, relying-party check, creation, assertion).
- [x] 3. Kemlock-core tests: the app's fixture's bytes (registration, assertion, signature checked
      with `es256Verify`), the relying-party rules, creation and assertion round trips, and refusals.
- [x] 4. The extension's core: `passkeys`, `deletePasskey`, `checkPasskeyRp`, `createPasskey`,
      `signPasskey`, the `passkeys` setting, the site match's passkeys, and their Dart tests.
- [x] 5. Contract: `PasskeyView`, requests and answers in `src/shared/api.ts`, parsers in
      `src/shared/messages.ts`, `CoreApi` in the bridge and in `FakeCore` (with WebCrypto ES256).
- [x] 6. Background: the provider (`src/background/passkey-provider.ts`), the requests' store, the
      handlers, the registration of the scripts, the preference mirror and the never-here list.
- [x] 7. The page side: `src/content/passkey-main.ts` and `passkey-bridge.ts`, their build, and the
      controller's prompt.
- [x] 8. The menu: the passkey card (create, sign in, unlock, never here) and the passkeys in a field's
      menu for a conditional request.
- [x] 9. The popup: the list on Home, the passkey's page, the site card and the login page lines, and
      the switch in Settings.
- [x] 10. Strings: `locales/parts/passkeys.en.json` and `.fr.json`.
- [x] 11. Tests: Vitest for the parsers, the provider, the page scripts, the menu and the popup; a
      Playwright spec for create and sign-in on a local page.
- [x] 12. `add-browser-extension/proposal.md`: note that "Passkeys as a browser credential provider"
      is now this plan's.

## Merging

`core/pubspec.yaml` pins Kemlock-core by commit. The browser's core needs `features/passkeys/` of Kemlock-core's
`parity/passkeys` branch, so once that merges the `ref` in `core/pubspec.yaml` and `core/pubspec.lock` move to its
commit. Until then a local `core/pubspec_overrides.yaml` (ignored by git) points at a checkout of that branch. The app's
own `mobile/lib/features/passkeys/passkey_bytes.dart` can then become a one-line export of the core's copy.

## After the review

- The card never takes the keyboard, and a key answers it only once the person has moved into it (Tab or an arrow key); a
  pointer press always does. Each card has a secret the background gives to the top frame's content script alone, and the card
  asks and answers under it, so no other request of the tab and no page framing the menu page can speak for it.
- A page learns nothing of the vault before the person is asked: a conditional request and a creation that names a held credential
  look as they do for an empty vault, and the availability checks say only whether the switch is on.
- The permissions policy is judged in the bridge (the extension's world). A frame is cross-origin when any ancestor differs, read
  from `webNavigation.getAllFrames`; a chain
  that can't be read goes to the browser.
- Requests end with the browser's own way when their document goes (not on a single-page site's change of address), their tab
  closes, or the vault locks.
- What a page can still see of the wrapper: a getter or proxy of its own that runs while our function reads its options can read
  `new Error().stack` and see our frame, and so the extension's address. Each option is read once, and errors that pass through lose
  the lines with the address, but that read can't be avoided.
- `webNavigation` is an optional permission, not asked for at install (Chrome words it as reading the browsing history). The
  passkey switch asks for it and for all sites in one `permissions.request`, from its own click, and the scripts are registered only
  while both are held. Where it isn't held, a request from a frame that isn't the page's top frame goes to the browser; the top
  frame is served, since it is cross-origin with nothing.
