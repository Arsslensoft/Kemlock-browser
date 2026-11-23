# Chrome Web Store listing

Everything the store's dashboard asks for, in the order it asks. The same zip goes to Chrome and
Edge (`kemlock-<version>-chrome.zip`). Fill in what is in `< >` at submission time. The privacy
statement the answers rest on is the README's
[What the extension keeps, and where it goes](../../README.md#what-the-extension-keeps-and-where-it-goes):
keep the two the same.

## Store listing

- **Name**: Kemlock
- **Summary** (132 characters at most, from the manifest's description):
  Your Kemlock codes and logins in the browser, synced with your own Kemlock Server, Vaultwarden or WebDAV folder.
  (`locales/en.json`'s `extDescription` still names Vaultwarden and WebDAV only: change it to this
  before the first release.)
- **Category**: Productivity.
- **Languages**: English and French. The listing takes one text per language, the French below.
- **Homepage URL**: https://github.com/Arsslensoft/Kemlock-browser
- **Support URL**: https://github.com/Arsslensoft/Kemlock-browser/issues (SUPPORT.md says where to ask what)
- **Privacy policy URL**: https://github.com/Arsslensoft/Kemlock-browser#what-the-extension-keeps-and-where-it-goes
- **Icon**: `icons/kemlock-128.png`.
- **Screenshots** (1280×800, at least one, up to five), taken from the built extension in a window of
  that size, English, light theme, with the fixture vault of `tests/e2e` (no real account's data). The
  e2e tests run headed, so a screenshot is one `await page.screenshot(...)` away from any step:
  1. The popup on a matching site: the Orbit Cloud card with its live code, Fill code and Fill login.
  2. The in-page menu open under a sign-in field, with the login listed.
  3. The Codes list with the countdown ring and one code in its last five seconds.
  4. The look-alike guard: "This isn't orbit-cloud.com" with the difference marked.
  5. Setup: "Where does your phone sync?".

  Take them again after any change that moves a screen. A dark-theme and a French set may be added.

- **Small promo tile** (440×280), if the store asks: the wordmark,
  `.github/assets/kemlock-wordmark-light.svg`, on the app's background colour.

### Description (English)

```
Kemlock for browsers puts your Kemlock one-time codes and logins in Chrome and Edge, and fills them
into the sites they belong to.

It syncs with the place your phone's Kemlock already syncs with: your own Kemlock Server, a Vaultwarden,
or a WebDAV folder. There is no Kemlock cloud in between and no account with us.

- One-time codes with live countdowns, copied or filled with one click. Codes kept on a security key are named, never filled.
- Logins filled on their own site only. Nothing fills until you pick an item, and a look-alike address
  (orbit-c1oud.com for orbit-cloud.com) gets a guard instead of your password.
- The menu in the page is drawn by the extension, so the page can't read it or what you type in it.
- New passwords from the app's generator, following the site's own rules, and "Save to Kemlock?" after a sign-up.
- "Add a code" reads a setup QR code on the page in front, or a pasted otpauth:// link.
- Password health, worked out in the browser: reused, weak, and logins without their code.
- Locks itself when the browser is idle or the computer sleeps. The vault is sealed as the phone seals one,
  and the app's own code opens it.
- English and French. Light and dark. Free: no paywall, no Premium.

It installs with no access to websites. Access to all sites is optional and only adds Kemlock's button in
fields: without it, the toolbar popup and the right-click menu still fill the tab in front.

Open source (GPL-3.0-or-later). Every release is built twice and compared byte for byte:
https://github.com/Arsslensoft/Kemlock-browser
```

### Description (Français)

```
Kemlock pour les navigateurs met vos codes à usage unique et vos identifiants Kemlock dans Chrome et
Edge, et les remplit sur les sites auxquels ils appartiennent.

Il se synchronise avec le lieu où le Kemlock de votre téléphone se synchronise déjà : votre propre
Kemlock Server, un Vaultwarden ou un dossier WebDAV. Aucun cloud Kemlock au milieu, aucun compte chez nous.

- Codes à usage unique avec compte à rebours, copiés ou remplis en un clic.
- Identifiants remplis sur leur propre site seulement. Rien ne se remplit avant que vous choisissiez, et une
  adresse trompeuse (orbit-c1oud.com pour orbit-cloud.com) déclenche une alerte au lieu de votre mot de passe.
- Le menu dans la page est dessiné par l'extension : la page ne peut lire ni son contenu ni ce que vous y tapez.
- Nouveaux mots de passe du générateur de l'app, selon les règles du site, et « Enregistrer dans Kemlock ? » après une inscription.
- « Ajouter un code » lit un QR code de configuration sur la page, ou un lien otpauth:// collé.
- Verrouillage automatique à l'inactivité ou à la mise en veille. Gratuit, sans Premium.

L'extension s'installe sans accès aux sites web. L'accès à tous les sites est facultatif et n'ajoute que
le bouton Kemlock dans les champs.

Logiciel libre (GPL-3.0-or-later) : https://github.com/Arsslensoft/Kemlock-browser
```

## Privacy practices tab

- **Single purpose**: Fill the person's one-time codes and logins from their own Kemlock vault into the
  websites they belong to, and keep that vault in sync with the sync place the person chose.

- **Permission justifications** (one box each):
  - `storage`: Keeps the sealed vault, the sync state and the settings in the extension's own storage, and the unlocked vault's keys in its memory-only session storage.
  - `alarms`: Runs the idle auto-lock timer and the five-minute sync while the vault is open.
  - `idle`: Locks the vault when the computer sleeps or its screen locks.
  - `contextMenus`: Adds the right-click menu on editable fields (Fill login, Fill code, New password) and on images ("Add code to Kemlock").
  - `activeTab`: Fills a login or a code into, and reads a setup QR code from, the tab in front only when the person asks from the popup or the right-click menu.
  - `scripting`: Puts the content script into that tab for that use, and registers it for all sites once the person grants them.
  - `clipboardWrite`: Copies a code or a password the person asked to copy.
  - `clipboardRead`: Reads the clipboard only to clear a copied code or password after the chosen time, and only if it still holds that value, so other text the person copied is never erased.
  - `offscreen`: Gives the background service worker a document to use the clipboard from (Chrome has none for it).
  - Optional host permission, all sites (`<all_urls>`): Asked for at setup and in Settings, only for Kemlock's button in sign-in and code fields. Refused, the extension keeps working through the popup and the right-click menu.
  - Optional host permission, the sync server: Asked for the one address the person types, before any request to it. Browsers send an extension no CORS headers, so the server can't be reached without it.
  - `identity` (with Kemlock Server single sign-on): Opens the browser's own sign-in window for the server's SSO (`identity.launchWebAuthFlow`).
  - `web_accessible_resources` (the menu page): Shows the in-page menu as an extension page in a frame, at an address that changes each browser session, so a page can't read it.

- **Remote code**: No. All code is in the package. The Dart core is compiled to WebAssembly and bundled
  in it; the manifest's `'wasm-unsafe-eval'` is for loading that bundled module and nothing else.

- **Data usage**: tick none of the collected-data boxes. The extension holds the person's vault, which
  never reaches us: it stays in their browser and goes only to the sync place they chose. Certify all
  three: not sold to third parties, not used or transferred for purposes unrelated to the single
  purpose, not used for creditworthiness or lending. If the dashboard insists that "authentication
  information" is ticked because the extension handles passwords, tick it and say in the justification:
  "Stored sealed in the person's own browser and sent only to the sync server they configured; never to
  the developer."

## Test instructions (for the reviewers)

```
The extension needs a Kemlock vault to be useful, and syncs with a place the person chooses.
1. Install, click the toolbar icon: setup opens. Type a password for the browser twice.
2. "Where does your phone sync?" asks for one of three places. A WebDAV folder with a sync file made by
   the Kemlock app, its login and passphrase, are given below for this review: <address, username,
   password, passphrase>.
3. After the first sync the codes appear in the popup. Open a site, click in a sign-in field: the menu.
No account with us is needed, and none exists.
Source: https://github.com/Arsslensoft/Kemlock-browser at tag v<version>. Builds are reproducible
(docs/reproducible-builds.md). `npm run build && npm run test:e2e` loads this extension in Chromium
against local test sites and shows every screen working.
```

Make the WebDAV folder for the review from the fixture `tests/e2e/fixtures/app/sync-personal.json`
(its `text` is the sync file, `backmycodes-sync.json`; its passphrase is in the file), and delete it
after.

## Submitting

1. `kemlock-<version>-chrome.zip` from the release, its SHA-256 checked against `SHA256SUMS`.
2. Fill the tabs above. Distribution: public, all regions.
3. Chrome and Edge 119 are the minimum (`minimum_chrome_version`).
4. After the review, record the extension's id (the 32 letters in its store address) in the README's
   Kemlock Server paragraph: a self-hoster adds it to `KEMLOCK_BROWSER_EXTENSION_IDS` for SSO.
