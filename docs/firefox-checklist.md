# Firefox checklist

Playwright can't run this extension in Firefox: its Firefox build loads no extension, and
Firefox's remote protocol installs only temporary add-ons with no page to drive them from. So
what the end-to-end tests (`npm run test:e2e`, Chromium) check on Chrome and Edge is checked here
by hand, step by step, for Firefox. `npm run lint:firefox` (`web-ext lint`) runs in CI for what a
linter can see.

Run it on two Firefox versions and record each run at the end of this file:

- **The minimum**: Firefox 140 (`strict_min_version` in `manifests/firefox.json`; the owner's choice,
  design decision 17). Firefox's ESR 140 is the one to install, from
  <https://www.mozilla.org/firefox/all/#product-desktop-esr>.
- **The current release**.

Use a new profile for each run (`firefox -P`, Create Profile), so that nothing is left over.

## What you need

- A build: `npm ci`, `cd core && dart pub get --enforce-lockfile` (the Dart SDK 3.13.5 compiles the
  core), then `npm run build`, then `dist/firefox/` (or the release's
  `kemlock-<version>-firefox.zip` unzipped).
- A sync place you can reach over https that your phone's Kemlock also uses, or a throwaway one:
  - a WebDAV folder (Nextcloud, ownCloud, Synology, Koofr, or any server with a certificate your
    computer trusts), holding a sync file the app wrote, with its sync passphrase; and/or
  - a Vaultwarden with a Kemlock home, and its master password.
- A website where you can sign in and sign up with a throwaway account, and one that asks for a
  one-time code. A password-change page too, for the save step.
- A second tab you can type text into, to check the clipboard.

An https test server with a certificate Firefox does not trust fails the sync steps: the event page
can't use a certificate the browser doesn't know (spike 1.3). Trust the server's certificate in
this profile first (Settings › Privacy & Security › View Certificates › Authorities › Import), or
use a server with a real one.

## 1. Install

1. Open `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, pick
   `dist/firefox/manifest.json`.
2. Firefox's install prompt says the extension collects no data. Accept it.
3. Expect the Kemlock icon in the toolbar (pin it from the puzzle-piece menu if it isn't), grey,
   and the setup tab opened by itself.

Check: the add-on's id in `about:support`, under Extensions, is `kemlock@arsslensoft.com`.

## 2. Setup

1. In the setup tab, "A password for this browser": type two different passwords and continue.
   Expect: it doesn't go on and says they don't match.
2. Type the same password twice. Expect: the strength meter moves, and setup goes on.
3. "Where does your phone sync?": Expect Kemlock Server, WebDAV folder and Vaultwarden, and the line
   that the phone shows it under Settings › Sync.
4. WebDAV folder: type an `http://` address. Expect: refused, only https is accepted.
5. Type the real folder, its username and password and a wrong sync passphrase. Expect: Firefox
   asks for access to the server's address before anything is sent (say who it is for), then setup
   says the passphrase doesn't open the sync file, and nothing is stored (the popup still shows no
   sync).
6. Refuse the access prompt once. Expect: setup stays on the access step and says sync needs it.
7. Now with the right passphrase and the access allowed. Expect: the first sync is shown before it
   runs, with the counts of codes, logins and backup-code lists. Go on.
8. Optional access to all websites: Allow it when setup asks (or later in Settings › Site access).
   Expect: Firefox's own prompt; "Kemlock" listed under `about:addons` › Kemlock › Permissions.

Record: any step above that behaved otherwise.

## 3. Unlock and lock

1. Click the icon. Expect: the popup shows codes (the same as on the phone), azure icon.
2. Lock now. Expect: the lock screen; the icon is grey with no count; no item name anywhere.
3. Type a wrong password three times, close the popup, open it. Expect: "3 wrong tries since the
   vault last opened" and the time of the last.
4. Type the right password. Expect: it opens and says once how many wrong tries there were. Close
   and open it again: not said again.
5. Settings › Auto-lock: pick 1 minute, close the popup, wait 90 seconds without using Kemlock.
   Expect: locked, icon grey.
6. Restart Firefox (not the profile). Expect: the vault is locked, and unlocking shows the same items.
7. "Remove Kemlock from this browser" from the lock screen, confirm. Expect: the setup tab opens;
   nothing was deleted on the sync server or the phone. Set it up again with a new password and the
   same sync: after the first sync the same items are back.

## 4. A fill

Use the site with the throwaway account, saved in Kemlock on the phone (or add the login in the popup
first).

1. Open its sign-in page. Expect: nothing is filled by itself.
2. With site access allowed: Kemlock's button is in the username and password fields. Click it, or
   press the down arrow in the field. Expect: a menu with the site's login. The page's own console
   (`document.querySelector('iframe')?.contentDocument`) can't read it.
3. Wait half a second, pick the login. Expect: both fields filled, and the form's own sign-in works.
   Click a different item fast, within a tenth of a second of the menu opening: expect nothing
   filled.
4. A site that asks for a code: the code field shows the button. Pick the code. Expect: the six digits
   in the field, the same as on the phone. A "recovery code" field has no button.
5. Look-alike: only if you can serve a sign-in page at a look-alike name of a site you have a login
   for (a hosts-file entry to a local server will do, with a certificate Firefox trusts). Expect: the
   menu says "This isn't <the real site>", shows both addresses with the difference marked, and
   "Don't fill" is the main action. If you can't, write "skipped" in the record.
6. Settings › Site access: remove the all-sites access, reload the sign-in page. Expect: no button.
   Open the popup on that tab: "Fill login" still fills it. Turn the access on again: the button is
   back after the next page load.
7. Right-click an editable field. Expect: Kemlock › Fill login, Fill code, New password.
8. Sign-up page: click in the new-password field, pick "Use a strong password". Expect: the same
   password in the field and its confirmation, and under Recently generated in the popup.

## 5. A save

1. Create an account on the throwaway site (or change a password) and send the form. Expect:
   "Save to Kemlock?" with the site, the username and the vault, after the next page loads.
2. Click Save. Expect: a login for the site's host in the popup's Logins list.
3. Change that account's password on the site. Expect: "Update in Kemlock?". Update. Expect: the new
   password; the old one is first under Previous passwords on the login's page.
4. Sign in with the password the vault holds. Expect: no prompt.

## 6. A copy that clears

1. In the popup, copy a code. Paste into the second tab. Expect: the code.
2. Wait the clipboard time (30 seconds by default) without copying anything. Paste again. Expect:
   nothing (the clipboard was cleared).
3. Copy a code, then within 30 seconds copy some other text from a page. Wait past the 30 seconds,
   paste. Expect: the other text is still there.
4. Click a login in the Logins list. Expect: its password is copied, and cleared the same way.

## 7. Sync

1. On the phone, add a code and sync. In the browser: Sync now (Settings › Sync). Expect: the code is
   listed.
2. In the browser, add a code ("Add a code", paste an `otpauth://` link, Add). Sync the phone.
   Expect: the phone has it.
3. With WebDAV: save a login in the browser; after both sync, the phone has it. With Vaultwarden:
   the Logins list says logins aren't synced with Vaultwarden yet, and the phone doesn't get it.
4. Sign out in Settings › Sync. Expect: sync stops, the browser keeps its items, nothing is deleted
   on the server.
5. Take the network down (airplane mode) and Sync now. Expect: it says when it last synced; codes and
   logins still fill.
6. Only with Vaultwarden: a remembered browser signs in again without the second step; the account's
   device list shows one device, "Kemlock · Firefox".

## 8. Add a code from a page

1. On a page that shows a setup QR code, click Add a code. Expect: the account, its name editable;
   Add. The page's site is the account's website.
2. On a page whose only QR code holds a web address. Expect: "no code was found", nothing added.
3. Right-click an image of a setup QR code. Expect: "Add code to Kemlock".

## 9. Look and language

1. Switch the system to dark: the popup, the menu and setup follow it.
2. Set Firefox's language to Français (Settings › General › Language), restart. Expect: the popup, the
   menus and setup in French, sync problems in the app's own French.

## Record

Copy a block for each run. Write "ok", or what happened, beside every section.

```
Date:
Firefox version:  (minimum, 140.x)
Build:            (commit or release)
Sync place:       WebDAV (server)  /  Vaultwarden (version)
1 Install:
2 Setup:
3 Unlock and lock:
4 A fill:
5 A save:
6 A copy that clears:
7 Sync:
8 Add a code from a page:
9 Look and language:
Problems found (and the issue for each):
```

### Runs

- Not run yet on the minimum (140).
- Not run yet on the current release.
