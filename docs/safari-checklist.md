# Safari checklist

Safari can be built and run only on a Mac, so nothing of Safari is checked by the tests that run in
CI (`npm test`, `npm run test:e2e`, which is Chromium). They check what can be checked without a Mac:
the manifest, the build, the settings written into the Xcode project, and each fallback in code
(`src/background/safari*.test.ts`). The `Safari (macOS)` job in `checks.yml` checks that the Xcode project
builds, unsigned. What it does when Safari runs it is checked here, by hand, step by step, as
[firefox-checklist.md](firefox-checklist.md) does for Firefox.

Run it on two Safari versions and record each run at the end of this file:

- **The minimum**: the first Safari that runs the core. The manifest says 18.4
  (`browser_specific_settings.safari.strict_min_version` in `manifests/safari.json`), which is a guess
  from what dart2wasm needs: WasmGC (Safari 18.2) and `WebAssembly.JSTag` (step 1.4). Step 1 finds the real
  one; then change the manifest, and the number the test in `tool/safari.test.mjs` asks for.
- **The current release**.

Run the Mac steps (1 to 12) in a new Safari profile (Safari › File › New Profile), so that nothing is
left over. Step 13 is for an iPhone or iPad.

## What you need

- A Mac with the Xcode that has the Safari you test (Xcode's Settings › Components has the macOS and iOS
  SDKs), and Node 26.13.0 for the build.
- A build, in either of two ways:
  - from the repository: `npm ci`, `cd core && dart pub get --enforce-lockfile` (the Dart SDK 3.13.5 compiles
    the core), then `npm run build:safari`; or
  - from a release: unzip `kemlock-<version>-safari.zip`, or take the release's
    `kemlock-<version>-safari-xcode.zip`, which is the project of step 1 already made.
- A sync place you can reach over https that your phone's Kemlock also uses, or a throwaway one: a Kemlock
  Server account (with a phone to approve the device), a WebDAV folder with a sync file the app wrote and its
  passphrase, and/or a Vaultwarden with a Kemlock home and its master password.
- A website where you can sign in and sign up with a throwaway account, one that asks for a one-time code,
  and a password-change page, for the save step.
- A second place you can type text into, to check the clipboard, and, if you have one, a clipboard manager
  (Maccy, Pastebot, Raycast) to check that copies are left out of its history (step 6).
- Safari's Develop menu (Safari › Settings › Advanced › Show features for web developers), for the consoles.

An https test server with a certificate Safari does not trust fails the sync steps: Safari takes the
macOS keychain's trust. Trust the certificate there first (Keychain Access › System), or use a server with
a real one.

## 1. The project and the install

1. Make the project: `npm run safari:project` (it runs `tool/safari/convert.sh`; the inputs are listed at its
   top and in [store/safari.md](store/safari.md)). Expect: `dist/safari-xcode/Kemlock/Kemlock.xcodeproj`, and
   no error. The script prints the version it took from the manifest.
2. Open it in Xcode. Expect: two targets named Kemlock and Kemlock Extension (and the iOS pair, unless
   `KEMLOCK_SAFARI_PLATFORMS=macos`). Under Signing & Capabilities, choose your own team for both, or
   "Sign to Run Locally". Run the app's macOS scheme (Product › Scheme; `xcodebuild -list -project <the .xcodeproj>` names them, and `convert.sh` prints the one it found).
3. Expect: a window that says Kemlock's extension is not turned on, with a button for Safari's extensions.
   If you don't sign, turn on Safari › Develop › Allow Unsigned Extensions first (it resets when Safari quits).
4. In Safari › Settings › Extensions, tick Kemlock. Expect: its toolbar button, and the list of what it can
   read: nothing yet ("Allow Kemlock on no websites"). The toolbar icon is grey.
5. Open the background page's console: Develop › Web Extension Background Pages › Kemlock. Expect: no
   "Kemlock: the core did not load" in it, and in it:
   - `typeof WebAssembly.JSTag` is `"function"` (dart2wasm's exceptions need it: Firefox 131 was the same
     step, and Firefox 130 failed at it);
   - `chrome.runtime.getManifest().version` is the version you built;
   - `await chrome.runtime.sendNativeMessage('application.id', {kemlock: 1, cmd: 'screenLocked'})` answers
     `{kemlock: 1, ok: true, locked: false}`. That is the Mac app's handler. An answer with `echo` in it is
     the converter's own handler: `convert.sh` didn't replace it.
6. Click the toolbar button. Expect: the popup asks to set Kemlock up, and a tab opens.

Record: the first Safari version at which 5 and 6 pass, and the version below it that fails, and why. That
is the number for `strict_min_version`.

## 2. Setup

1. Type two passwords that differ and continue. Expect: it doesn't go on, and says they don't match.
2. Type the same password twice. Expect: the strength meter moves, and setup goes on.
3. "Where does your phone sync?": Expect Kemlock Server, WebDAV folder and Vaultwarden.
4. Kemlock Server: type the server's address. Expect: a Safari prompt to allow Kemlock on that website
   ("Always Allow" / "Allow for One Day" / "Don't Allow"; say who it is for), before anything is sent. The
   sign-in form has the email and password only: **no** "Sign in with SSO" and no "Use a passkey or security
   key", and the line "Single sign-on and passkeys aren't available in this browser…" instead. Sign in with the
   master password. Expect: the approval from the phone (the five words, the same in both places), then the
   first sync.
5. WebDAV folder: type an `http://` address. Expect: refused. Type the real folder, its login and a wrong sync
   passphrase. Expect: Safari asks for access to that website first, then setup says the passphrase doesn't
   open the sync file, and nothing is stored.
6. Refuse the access prompt once. Expect: setup stays on the access step and says sync needs it.
7. Now with the right passphrase and the access allowed. Expect: the first sync is shown before it runs, with
   the counts. Go on.
8. Vaultwarden, if you have one: sign in. A security key as a second step opens a tab on the server's own
   address and takes the answer back (design decision 13). Expect: the account's device list shows one device,
   "Kemlock · Safari".
9. Access to all websites: allow it when setup asks, or in Safari › Settings › Extensions › Kemlock. Expect:
   Safari's own prompt, then "Always Allow on Every Website" shown for Kemlock. If setup's request shows no
   prompt, say so: Safari may need the setting changed there, and the settings screen should then say what it
   found (it reads the grant, never assumes it).

Record: any step above that behaved otherwise.

## 3. Unlock and lock

1. Click the icon. Expect: the popup shows codes (the same as on the phone), azure icon.
2. Lock now. Expect: the lock screen; the icon is grey with no count; no item name anywhere.
3. Type a wrong password three times, close the popup, open it. Expect: "3 wrong tries since the vault last
   opened" and the time of the last. The right password opens it and says it once.
4. Settings › Auto-lock: pick 1 minute, close the popup, wait 90 seconds without using Kemlock. Expect: locked.
   (The beat is the alarm each minute: allow for two.)
5. **The screen**. Leave "Lock when the computer sleeps" on. Unlock, then lock the Mac's screen (Control +
   Command + Q), wait two minutes, log in again. Expect: the vault is locked. Safari has no `idle` API: it is
   the Mac app that says the screen was locked, at the next beat. Turn the setting off and repeat. Expect:
   still open.
6. **Sleep**. Unlock, close the lid for three minutes (or `pmset sleepnow`), open it. Expect: locked.
7. Quit Safari (Command + Q) and open it again. Expect: locked, and unlocking shows the same items.
8. "Remove Kemlock from this browser" from the lock screen, confirm. Expect: the setup tab opens; nothing was
   deleted on the sync server or the phone. Set it up again with a new password and the same sync: the same
   items are back.

## 4. A fill

Use the site with the throwaway account, saved in Kemlock on the phone (or add the login in the popup first).

1. Open its sign-in page. Expect: nothing is filled by itself.
2. With access to all websites: Kemlock's button is in the username and password fields. Click it, or press the
   down arrow in the field. Expect: a menu with the site's login, drawn by the extension. The page's own
   console (`document.querySelector('iframe')?.contentDocument`) can't read it.
3. Wait half a second, pick the login. Expect: both fields filled, and the form's own sign-in works. Click a
   different item within a tenth of a second of the menu opening: expect nothing filled.
4. A site that asks for a code: the code field shows the button. Pick the code. Expect: the six digits in the
   field. A "recovery code" field has no button.
5. Look-alike: only if you can serve a sign-in page at a look-alike name (a hosts-file entry to a local server
   with a certificate Safari trusts). Expect: "This isn't <the real site>", both addresses with the difference
   marked, "Don't fill" the main action. Otherwise write "skipped". Safari has no `IntersectionObserver` v2
   (`trackVisibility`): the menu leans on the content script's check and the delay, as in Firefox.
6. Safari › Settings › Extensions › Kemlock: remove the all-websites access, reload the sign-in page. Expect:
   no button. Open the popup on that tab: "Fill login" still fills it (activeTab). Allow it again: the button is
   back after the next page load.
7. Right-click an editable field. Expect: Kemlock › Fill login, Fill code, New password. (Not on iOS.)
8. Sign-up page: click in the new-password field, pick "Use a strong password". Expect: the same password in
   the field and its confirmation, and under Recently generated in the popup.
9. A page with a login in a frame from another site (a payment or sign-in iframe), and a page that builds its
   form late. Expect: the button in each, and a fill only into the frame that asked.

## 5. A save

1. Create an account on the throwaway site (or change a password) and send the form. Expect: "Save to
   Kemlock?" with the site, the username and the vault, after the next page loads.
2. Click Save. Expect: a login for the site's host in the popup's Logins list.
3. Change that account's password. Expect: "Update in Kemlock?". Update. Expect: the new password; the old one
   first under Previous passwords.
4. Sign in with the password the vault holds. Expect: no prompt.

## 6. A copy that clears

Safari copies through the Mac app, not the page: a background timer has no click to write the clipboard with.

1. In the popup, copy a code. Paste into the second place. Expect: the code. If it doesn't paste, say so: the
   page's own commands are the fallback, and the console says which failed.
2. With a clipboard manager running, copy a code and a password. Expect: neither is kept in its history (the
   copy is marked `org.nspasteboard.ConcealedType`).
3. Wait the clipboard time (30 seconds by default) without copying anything. Paste again. Expect: nothing.
4. Copy a code, then within 30 seconds copy some other text. Wait past the 30 seconds, paste. Expect: **the
   other text is still there**. Nothing reads the clipboard: the app answers the pasteboard's change count at the
   copy and clears only if it is still that count. (If the other text was cleared, the count was not kept: write
   what the background console says.)
5. Click a login in the Logins list. Expect: its password is copied, and cleared the same way.
6. Close the popup right after copying and wait. Expect: it clears all the same (no click is needed).
7. iOS, step 13: the same by the change count (reading it asks nothing of the person), and the copy also
   expires on its own at the clear time, as the system drops it.
8. With the handler replaced by the converter's own (an echo): the copy still works through the page, and is
   **not cleared** (nothing can say whether it is unchanged). Say which you see.

## 7. Sync

1. On the phone, add a code and sync. In the browser: Sync now (Settings › Sync). Expect: the code is listed.
2. In the browser, add a code ("Add a code", paste an `otpauth://` link, Add). Sync the phone. Expect: the
   phone has it.
3. With Kemlock Server or WebDAV: save a login in the browser; after both sync, the phone has it. With
   Vaultwarden: the Logins list says logins aren't synced with Vaultwarden yet.
4. Sign out in Settings › Sync. Expect: sync stops, the browser keeps its items, nothing is deleted on the
   server.
5. Take the network down and Sync now. Expect: it says when it last synced; codes and logins still fill.
6. Wait ten minutes with Safari open and the vault unlocked, then use the popup. Expect: **locked**, with the
   lock screen: Safari unloads a background page it isn't using, and, with no `setAccessLevel`, nothing that opens
   the vault is kept in `storage.session` (the other browsers keep it there, design decision 5). Unlock, and the
   five-minute sync, an alarm, goes on. How soon it locks is the cost of that: note how long the vault stayed open
   in a day of use. Once step 10.1 shows that Safari's session storage is closed to content scripts, the
   background can keep the keys there as the others do (`limitSessionToTrusted` answers true).

## 8. Add a code from a page

1. On a page that shows a setup QR code, click Add a code. Expect: the account, its name editable; Add. The
   page's site is the account's website. (`tabs.captureVisibleTab` needs the click on the toolbar button:
   `activeTab`.)
2. On a page whose only QR code holds a web address. Expect: "no code was found", nothing added.
3. Right-click an image of a setup QR code. Expect: "Add code to Kemlock".

## 9. Look and language

1. Switch the system to dark: the popup, the menu and setup follow it.
2. Add Français first in System Settings › General › Language & Region, restart Safari. Expect: the popup, the
   menus and setup in French, and the sign-in line of step 2.4 in French.

## 10. What a page and a content script can reach

1. Open a page and Web Inspector (Develop › Show Web Inspector). In the console's context picker, choose the
   extension's content-script context (Kemlock). Run `await chrome.storage.session.get(null)`. Expect: an
   error, or an object with no `kemlock_session` and no `kemlock.sessionKey`. Safari has no `setAccessLevel`,
   so this step is what stands in for the `TRUSTED_CONTEXTS` the other browsers are told. **If the keys are
   there, stop and report it. They are not written in Safari at all (the vault relocks when the background
   unloads), so this step finds whether that can be relaxed: if the session storage is closed to content scripts,
   it can. Also look at what else is kept there: `kemlock_tabs` holds a form's password for up to five minutes,
   and Recently generated passwords are kept for a short time.**
2. From the page's own context: `document.querySelector('iframe')` shows nothing of the menu. In the
   background console: `chrome.storage.local.get(null)` shows only sealed values (no password text).
3. In the content script's context, send the app a message with
   `chrome.runtime.sendNativeMessage('application.id', {kemlock: 1, cmd: 'screenLocked'})`. Expect: a refusal. If a content
   script can talk to the app, say so (Safari sends native messages only from the extension's own pages and its
   background, and it should refuse here).

## 11. The unavailable ones

1. Safari has no sign-in window: confirm that no screen of Kemlock offers single sign-on or a passkey sign-in,
   and that none of them logs a missing `identity`. (A Kemlock Server account that only has SSO can't be added
   in Safari: setup says the password sign-in is the way, and the app's own screens say how to set a password.)
2. Safari lacks `offscreen` and `idle`. In the background console: `typeof chrome.offscreen`,
   `typeof chrome.idle`. Expect: `"undefined"` for both (if one is a function in a newer Safari, the code
   would use it as soon as the manifest asks for it back).
3. The `notifications` permission (the account's "a device is waiting for approval" alert) and the optional `webNavigation`
   (passkeys, which ask for it with all sites) are on WebKit's list of permission names, so the manifest keeps them and
   `tool/safari.test.mjs` allows them. Whether Safari then delivers them is not known: in the background console,
   `typeof chrome.notifications` and `typeof chrome.webNavigation`. Expect: an object each; if one is `"undefined"`, the
   code goes on without it (the account's alert is skipped, and a passkey request is answered for a page's top frame only),
   but move the permission to `$remove` in `manifests/safari.json` so that Xcode doesn't warn about it.

## 12. Updating

1. Install a build with the next version over the first (rebuild with a bigger `KEMLOCK_SAFARI_BUILD` and run
   it from Xcode). Expect: Safari asks nothing, the vault and the sync settings are as they were, the
   right-click menu is made again and the content script stays registered.

## 13. iPhone or iPad (once, by the owner)

The same web extension runs in Safari on iOS and iPadOS from the container app's iOS target.

1. Run the "Kemlock (iOS)" scheme on a device. In Settings › Apps › Safari › Extensions, turn Kemlock on and
   allow it on all websites. Expect: the aA menu in Safari lists Kemlock.
2. Set up as in step 2, with a sync place. Expect: no right-click menu items (iOS has none), the popup fits
   the screen, copying works (the app writes it, marked local-only, and iOS drops it after five minutes), and
   the lock after the idle time works. The screen lock isn't heard: an iPhone doesn't run the extension while
   it is locked.
3. Fill a login on a site: the button, the menu, the fill.

## Record

Copy a block for each run. Write "ok", or what happened, beside every section.

```
Date:
macOS and Safari version:  (minimum, 18.4 or what step 1 found)
Xcode version:
Build:            (commit or release)
Sync place:       Kemlock Server / WebDAV (server)  /  Vaultwarden (version)
1 The project and the install:
2 Setup:
3 Unlock and lock:
4 A fill:
5 A save:
6 A copy that clears:
7 Sync:
8 Add a code from a page:
9 Look and language:
10 What a page and a content script can reach:
11 The unavailable ones:
12 Updating:
13 iPhone or iPad:
Problems found (and the issue for each):
```

### Runs

- Not run yet on the minimum.
- Not run yet on the current release.
