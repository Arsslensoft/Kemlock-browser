# Safari: the Mac App Store, TestFlight and outside the store

Safari runs a web extension only from inside a Mac (or iOS) app, signed by an Apple Developer team. So
there is no store zip to upload as there is for Chrome, Edge and Firefox: the release's
`kemlock-<version>-safari.zip` is the extension's folder, and the app that carries it is made from it, signed
and uploaded by the owner. The texts and the screenshots are [chrome.md](chrome.md)'s; what differs is here.

What this repository gives:

- The extension's folder, built and zipped, the same bytes on any machine: `kemlock-<version>-safari.zip`,
  with its line in `SHA256SUMS`.
- The Xcode project made from it, unsigned: `tool/safari/convert.sh`, and the release's
  `kemlock-<version>-safari-xcode.zip`.
- A check that the project builds: the `Safari (macOS)` job in `checks.yml`.

What is the owner's: an Apple Developer Program membership, a team id, certificates and provisioning; the
App Store Connect record with its texts, screenshots, privacy answers and review; and the archive, the
upload, TestFlight and the release.

## The inputs of `tool/safari/convert.sh`

`npm run safari:project` (or `bash tool/safari/convert.sh [<folder> [<output>]]`) on a Mac with Xcode. Every
input is an environment variable, and the defaults make an unsigned project that builds.

- `KEMLOCK_SAFARI_APP_NAME`: the app's name, in the Dock and the Mac App Store. The extension takes it too.
  Default `Kemlock`.
- `KEMLOCK_SAFARI_BUNDLE_ID`: the app's bundle identifier. The extension's is this plus `.Extension`. Default
  `com.kemlock.browser`.
- `KEMLOCK_SAFARI_TEAM`: your Apple Developer team id (ten characters, in the membership page). Set, the project
  signs automatically with it. Default none: unsigned.
- `KEMLOCK_SAFARI_BUILD`: the build number (`CFBundleVersion`). App Store Connect wants it to go up with each
  upload of one version. Default `1`.
- `KEMLOCK_SAFARI_MACOS`: the Mac app's minimum macOS (11.0 or later). The extension's own minimum is the
  manifest's Safari version. Default `14.0`.
- `KEMLOCK_SAFARI_IOS`: the iOS app's minimum iOS (15.0 or later). Default `17.0`.
- `KEMLOCK_SAFARI_PLATFORMS`: `all`, `macos` or `ios`. Default `all`.
- `KEMLOCK_SAFARI_ICON`: a square PNG, 1024 pixels for the best result. The script redraws the app's icon set
  from it, at each size the set holds. Default `icons/kemlock-128.png`.

The marketing version is the extension's: `manifests/base.json`'s, or the release's tag, so the app and its zip
say the same version. The bundle identifier is chosen once: the App Store Connect record
and the TestFlight builds are named by it. `com.kemlock.browser` is a suggestion beside the phone app's
`com.kemlock.app`; the owner may want the Mac app under another name.

The icon set is redrawn from `KEMLOCK_SAFARI_ICON`. The app's own master (`mobile/assets/brand` in the Kemlock
app's repository) is the one to give: the repository holds only the extension's 128-pixel icon, which
looks soft in the Dock.

`tool/safari/SafariWebExtensionHandler.swift` is put over the handler Xcode generates. It is what the
extension asks for the clipboard and the locked screen (`src/background/native.ts`); without it the
extension still works, and copies through the page, which Safari lets write the clipboard only after a click.

## Signing and the first build

1. `tool/build.sh v<version>` rebuilds the release's zip from the tag (to check its SHA-256), or unzip the
   release's zip. Then, on the Mac, run `tool/safari/convert.sh <folder>` with `KEMLOCK_SAFARI_TEAM` and
   `KEMLOCK_SAFARI_BUILD` set. Or take the release's `kemlock-<version>-safari-xcode.zip`, the project made with the defaults,
   and set the team in Xcode.
2. In Xcode, open `Kemlock.xcodeproj`. For each of the app and the extension targets, under Signing &
   Capabilities: your team, "Automatically manage signing", the bundle identifiers above. The app sandbox is
   on for both (the converter sets it; the Mac App Store requires it). Nothing else is needed: the handler uses
   the pasteboard and the session's lock state, which the sandbox allows, and no network.
3. Check the build with [safari-checklist.md](../safari-checklist.md) (at least step 1 and 6) before
   archiving.
4. Product › Archive, then Distribute App:
   - **TestFlight / the Mac App Store**: App Store Connect. Needs the record (below).
   - **Outside the store (macOS)**: Developer ID, then notarize and staple, and give the `.app` in a disk
     image or a zip. Safari accepts a Developer ID extension, and the person turns it on in Safari › Settings ›
     Extensions. There is no store review, and no iOS.

## App Store Connect

- **Name**: Kemlock. **Subtitle** (30 characters): Codes and logins in Safari.
- **Category**: Utilities; second, Productivity. **Price**: free, with no in-app purchase and no Premium.
- **Age rating**: 4+. No user-generated content, no browsing of the web by the app itself.
- **Promotional text** (170 characters): Your Kemlock one-time codes and logins in Safari, filled only on the sites
  they belong to. Synced with your own Kemlock Server, Vaultwarden or WebDAV folder.
- **Description**: [chrome.md](chrome.md)'s, with "Chrome and Edge" read as "Safari", and this paragraph
  after it (it must be said, since the person looks for it):

  ```
  Turn it on in Safari › Settings › Extensions, and allow it on the websites you want its button on.
  Single sign-on and passkey sign-in to Kemlock Server aren't available in Safari: sign in with your
  password. The vault locks after the idle time, when the Mac sleeps, within a minute of its screen
  locking, and when Safari stops the extension's background page.
  ```

- **Keywords** (100 characters): authenticator,2fa,totp,password manager,autofill,otp,passkey,vault,sync
- **Support URL**: https://github.com/Arsslensoft/Kemlock-browser/issues
  **Marketing URL**: https://github.com/Arsslensoft/Kemlock-browser
- **Privacy policy URL**:
  https://github.com/Arsslensoft/Kemlock-browser#what-the-extension-keeps-and-where-it-goes
- **Languages**: English and French (the extension has both; the app Xcode generates is English only, its
  one window just points to Safari's settings).
- **Screenshots**: the Mac App Store takes 1280×800, 1440×900, 2560×1600 or 2880×1800, at least one and up to
  ten, taken in Safari with the fixture vault (no real account's data), light theme: the popup on a
  matching site, the menu in a sign-in field, the Codes list, the look-alike guard, setup. iPhone and iPad
  screenshots (6.9 inch, 13 inch) only if the iOS app ships.

### App Privacy

**Data Not Collected.** The extension holds the person's vault and sends it nowhere but the sync place they
chose. No analytics, no tracking, no account with us. The privacy statement is the README's
[What the extension keeps, and where it goes](../../README.md#what-the-extension-keeps-and-where-it-goes):
keep the two the same.

### Export compliance

The app uses encryption (ML-KEM-1024, AES-256-GCM, scrypt, in the extension; HTTPS to the sync place). Answer
the export questions as the Kemlock phone app's own record does, and keep the same answer for this one. The
build's `Info.plist` (the app's and the extension's) can say `ITSAppUsesNonExemptEncryption` once that is decided,
so that each upload isn't asked again.

### Permissions, as the review notes explain them

The same justifications as [chrome.md](chrome.md)'s, minus `offscreen`, `idle`, `identity` and `clipboardRead`
(Safari has none of them), and with:

- `storage`, `alarms`, `contextMenus`, `activeTab`, `scripting`, `clipboardWrite`: as listed.
- `nativeMessaging`: talks to this app's own extension handler, to write the clipboard without a click, clear
  it only if nothing changed it since (by the pasteboard's change count; it never reads it), and ask the Mac whether the
  screen is locked. Safari sends a native message only to the app that holds the
  extension. Nothing else is sent to the app, and nothing in the handler opens a network connection.
- Optional, all websites: Kemlock's button in fields. Safari asks the person ("Always Allow on Every Website");
  refused, the toolbar popup and the right-click menu still fill the tab in front.
- Optional, the sync server's address: one website, asked for at setup before any request to it.

### Notes for the reviewers

```
Kemlock is a Safari extension that fills the person's one-time codes and logins from a vault kept in the
extension's own storage, sealed (ML-KEM-1024 and AES-256-GCM, the key wrapped by scrypt of a password
chosen for the browser). It syncs with a WebDAV folder, a Vaultwarden or a Kemlock Server the person chooses;
there is no server of ours, and no account with us. The app's window only points to Safari's extension settings.

To see it work: turn Kemlock on in Safari › Settings › Extensions, click its toolbar button and set it up:
choose a password, then a WebDAV folder with a sync file made for this review: <address, username,
password, passphrase>. Safari asks whether Kemlock may use that website: allow it. The codes then appear
in the popup. To see it fill: allow Kemlock on all websites, open <a test sign-in page>, click in the field.

The code is TypeScript and Preact, built with Vite, plus a core in Dart compiled to WebAssembly from
https://github.com/Arsslensoft/Kemlock-core. The source and the build steps (reproducible: the extension's
folder is the same bytes on any machine) are at https://github.com/Arsslensoft/Kemlock-browser, tag v<version>.
```

## Checks before each upload

- The version and the build number: the manifest's version, a build number higher than the last upload.
- `safari-checklist.md`, at least steps 1, 2, 3.5, 4 and 6, on the Safari the review will use.
- The zip's SHA-256 is the release's `SHA256SUMS` line: the extension in the app is that build.
- Archive validation in Xcode (Window › Organizer › Validate App): it warns of an icon set with a missing size
  and of an unsupported manifest key, either of which is a finding for `manifests/safari.json`.

## Single sign-on

Safari can't use Kemlock Server's single sign-on or passkey sign-in (it has no `identity.launchWebAuthFlow`, and
the extension's address has a different random id for each person's install, so the server can't list it as it
lists Chrome's and Firefox's). `KEMLOCK_BROWSER_EXTENSION_IDS` has nothing to add for Safari. The extension's
device is named "Kemlock · Safari" in the account's device list, and Vaultwarden's, with Bitwarden's device
type 20 (Safari extension).
