# Firefox Add-ons (AMO) listing

`kemlock-<version>-firefox.zip` from the release. Firefox 140 or later (`strict_min_version`; the
current ESR, and the first version that reads `data_collection_permissions`). The texts and the
screenshots are [chrome.md](chrome.md)'s; what differs is here.

## Add-on details

- **Name**: Kemlock. **Add-on id**: `kemlock@arsslensoft.com` (`browser_specific_settings.gecko.id`).
- **Summary** (250 characters at most): Your Kemlock one-time codes and logins in Firefox, filled only
  on the sites they belong to, and synced with your own Kemlock Server, Vaultwarden or WebDAV folder.
- **Description**: chrome.md's, with "Chrome and Edge" read as "Firefox". AMO takes basic Markdown-like
  formatting; the bullet list stays.
- **Categories**: Privacy & Security; Other.
- **Support site**: https://github.com/Arsslensoft/Kemlock-browser/issues
  **Support email**: <the project's address>.
- **License**: GNU General Public License v3.0 or later. **Privacy policy**:
  https://github.com/Arsslensoft/Kemlock-browser#what-the-extension-keeps-and-where-it-goes
- **Tags**: authenticator, 2fa, totp, password manager, autofill.
- **Experimental / requires payment**: neither. It is free, with no paywall.

## Data collection (the manifest's `data_collection_permissions`)

The manifest declares `required: ["none"]`: the extension collects nothing and sends nothing to the
developer. The vault stays in the person's browser and goes only to the sync place they chose. In the
listing's privacy section: "Kemlock does not collect or transmit data to its developers. Your vault is
sealed in your browser and is sent only to the sync server you set up."

Firefox's install prompt shows this as "The developer says this extension doesn't require data
collection". Nothing is optional here, so there is no `optional` list.

## Permissions (as AMO asks them in the notes)

The same as [chrome.md](chrome.md)'s justifications, minus `offscreen` (Firefox's background is an
event page with a document, so it uses the clipboard itself), and with Firefox's own two points:

- `storage`, `alarms`, `idle`, `contextMenus`, `activeTab`, `scripting`, `notifications`, `clipboardRead` and
  `clipboardWrite`: as listed.
- Optional: all sites, `webNavigation` (with all sites, when the person turns on passkeys: it reads a frame's ancestors, and
  without it only a page's top frame is answered), and the sync server's address, each asked for by the extension at the moment
  it is needed. Firefox shows its own prompt for them.
- No remote code: `'wasm-unsafe-eval'` loads the bundled WebAssembly core.

## Notes to the reviewer

```
Kemlock fills the person's one-time codes and logins from a vault that lives in the browser's extension
storage, sealed (ML-KEM-1024 and AES-256-GCM, the key wrapped by scrypt of the person's password).
It syncs with a WebDAV folder, a Vaultwarden or a Kemlock Server the person chooses; there is no server
of ours. A sync place is needed to see it work: use <WebDAV address, username, password, passphrase>,
made for this review.

The code is TypeScript and Preact, built with Vite, plus a core written in Dart and compiled to
WebAssembly (dart2wasm) from https://github.com/Arsslensoft/Kemlock-core at the commit the build pins.
The only innerHTML assignment `web-ext lint` finds is Preact's own, for dangerouslySetInnerHTML,
which our code never uses (ESLint forbids it).

Build, from the source archive: see below. The result is byte for byte the submitted zip.
```

## The source archive

AMO asks for the source of anything built. The same files the release is built from:

1. Check out the release's tag: `git clone --branch v<version> https://github.com/Arsslensoft/Kemlock-browser`.
2. `git archive --format=zip --output kemlock-<version>-source.zip v<version>`. It is what
   `tool/build.sh` builds from (`git archive` of the commit, not the working copy), with
   `package-lock.json` pinning every package.
3. The core's source: the pinned commit of Kemlock-core, in the archive's `core/` or named in the
   build notes, as the build needs it (task 3.2).
4. Build instructions, in the notes above and in the archive's README: Node 26.13.0 and the Dart SDK
   3.13.5, `npm ci && npm run build`, the zip from `dist/firefox`, or `tool/build.sh v<version>` for the
   container build that gives the release's exact bytes
   ([docs/reproducible-builds.md](../reproducible-builds.md)).

Check before uploading: unzip it into an empty folder, follow the notes there, and compare `dist/firefox`
with the submitted zip's files (AMO adds `META-INF/` to what it signs, nothing else).

## Single sign-on

Kemlock Server allows SSO from the extension ids in its `KEMLOCK_BROWSER_EXTENSION_IDS` setting.
Firefox's id is `kemlock@arsslensoft.com` (listed in `about:support`, under Extensions); a self-hoster
who wants SSO from Firefox adds it, with Chrome's and Edge's.

## Submitting

1. The zip, its SHA-256 checked against `SHA256SUMS`, and the source archive.
2. The release workflow has a job for AMO (`AMO_JWT_ISSUER`, `AMO_JWT_SECRET`), off until
   `PUBLISH_STORES` is `true`. It signs and submits the zip; the source archive and these notes go in
   by hand for each version AMO wants them.
3. `npm run lint:firefox` passes (CI's Build job), and [the Firefox checklist](../firefox-checklist.md) is
   recorded for the version.
