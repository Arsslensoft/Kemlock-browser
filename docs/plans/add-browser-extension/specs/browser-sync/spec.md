# Spec Delta

## Purpose

Joins the browser's vault to the sync the person's phone already uses,
Vaultwarden or a WebDAV folder, so the browser holds the same items and
keeps them current as another device, with no Kemlock server.

## ADDED Requirements

### Requirement: Setup joins the phone's sync place

After the browser's password, setup SHALL ask where the phone syncs,
Vaultwarden or a WebDAV folder, and join that one place. Setup SHALL say
that the phone shows it under Settings › Sync.

#### Scenario: Choosing Vaultwarden

- **WHEN** the person picks Vaultwarden
- **THEN** setup goes on to "Sign in to Vaultwarden"

#### Scenario: Choosing WebDAV

- **WHEN** the person picks WebDAV folder
- **THEN** setup goes on to "Connect your sync folder"

### Requirement: Sync is free

Joining and syncing SHALL need no Premium in the extension.

#### Scenario: No Premium anywhere

- **WHEN** the person sets up sync in the browser
- **THEN** no paywall or Premium check is shown

### Requirement: Only https servers that the computer trusts

The extension SHALL accept only `https` server addresses and SHALL rely on
the browser's own certificate checks. When the computer doesn't trust a
server's certificate, setup SHALL say so and that the browser can't use a
certificate the phone has pinned.

#### Scenario: An http address

- **WHEN** the person types `http://vault.example` as the server
- **THEN** setup refuses it and says only https is accepted

#### Scenario: A self-signed server

- **WHEN** the server's certificate isn't trusted by the computer
- **THEN** setup stops with the certificate message, and nothing is stored

### Requirement: The Vaultwarden server is checked first

Before asking for the master password, the extension SHALL check that the
address is a Vaultwarden at a version the app supports, and read the
account's key derivation from the server.

#### Scenario: Not a Vaultwarden

- **WHEN** the address answers but isn't a Vaultwarden
- **THEN** setup says so and doesn't ask for the master password

#### Scenario: An old Vaultwarden

- **WHEN** the server is older than the oldest version the app supports
- **THEN** setup names that version and stops

### Requirement: The master password is never kept

The extension SHALL derive the account's key from the master password in the
browser, PBKDF2 or Argon2id as the server says, and SHALL keep only the
session and the account key, sealed in the browser's vault, never the
master password.

#### Scenario: After signing in

- **WHEN** sign-in succeeds
- **THEN** the browser's storage holds the session and keys only inside the sealed vault, and no copy of the master password

#### Scenario: Argon2id

- **WHEN** the account uses Argon2id
- **THEN** setup shows that it is opening the key, and the popup stays usable meanwhile

### Requirement: Every second step the app offers

When Vaultwarden asks for a second step, setup SHALL offer the account's
methods among an authenticator code, an email code (sending the email), a
YubiKey OTP and a security key, and SHALL offer the personal API key when
none of them can be used, Duo among them.

#### Scenario: An authenticator code

- **WHEN** the account has an authenticator and the person types its code
- **THEN** sign-in succeeds and setup goes on to the Kemlock home

#### Scenario: An email code

- **WHEN** the person picks Email
- **THEN** Vaultwarden sends the code, setup names the obscured address, and offers to send it again

#### Scenario: Duo only

- **WHEN** the account's only second step is Duo
- **THEN** setup says it can't be done in the browser and offers to sign in with the personal API key

### Requirement: A security key answers on the server's own address

For a security key, the extension SHALL have the browser ask the key on a
page of the server's own address, the origin Vaultwarden checks, and SHALL
send the key's answer as the second step. When the server can't serve that
page, setup SHALL offer the other methods and the API key.

#### Scenario: Touching the key

- **WHEN** the person picks Security key and touches a registered key in the tab the browser opens on the server's address
- **THEN** the tab closes and sign-in succeeds

#### Scenario: A server reached at another name

- **WHEN** the server's own address differs from the one typed
- **THEN** setup names the address to use before any key is asked

### Requirement: The browser can be remembered

Setup SHALL offer "Remember this browser", on by default, which keeps
Vaultwarden's remember token so the next sign-in skips the second step.

#### Scenario: Signing in again

- **WHEN** the browser was remembered and the session must be renewed by signing in again
- **THEN** no second step is asked

### Requirement: The browser shows up as its own device

The extension SHALL sign in to Vaultwarden as a browser extension named
"Kemlock · " followed by the browser's name, with a device id made once, so
it appears once in the account's device list.

#### Scenario: The device list

- **WHEN** the person opens their Vaultwarden account's devices after setup in Chrome
- **THEN** one device named "Kemlock · Chrome" is listed

### Requirement: Joining the vault's Kemlock home

Setup SHALL list the account's Kemlock homes with each one's storage and
item count, join the one picked and SHALL NOT make a new home. A sealed home
SHALL need its sealing passphrase, checked against the home before anything
syncs.

#### Scenario: A sealed home

- **WHEN** the person picks the home "Kemlock, sealed, 22 items" and types its passphrase
- **THEN** setup goes on to the first sync

#### Scenario: A wrong passphrase

- **WHEN** the passphrase doesn't open the home's seal
- **THEN** setup says so and nothing is stored

#### Scenario: No home yet

- **WHEN** the account holds no Kemlock home
- **THEN** setup says to turn on Vaultwarden sync in Kemlock on the phone first

#### Scenario: A plain home

- **WHEN** the person picks a plain home
- **THEN** setup says that anyone who gets into the account has both factors, and asks for no passphrase

### Requirement: Joining a WebDAV folder

For WebDAV, setup SHALL ask for the folder's address, username, password
and sync passphrase, and SHALL join only when the passphrase opens the
folder's sync file.

#### Scenario: The phone's folder

- **WHEN** the person types the folder and passphrase the phone uses
- **THEN** setup goes on to the first sync

#### Scenario: A wrong passphrase

- **WHEN** the passphrase doesn't open the sync file
- **THEN** setup says so and nothing is stored

### Requirement: Access to the server is asked for at setup

Setup SHALL ask the browser for access to the sync server's address as
soon as the address is typed, before any request to it, saying first which
address. This is apart from the optional access to all sites that buttons
on pages need. When the person refuses, setup SHALL not go on and SHALL say
that sync needs it.

#### Scenario: Refusing access

- **WHEN** the browser's permission prompt for `vault.riverstudio.co` is refused
- **THEN** setup stays on the access step, explains why the access is needed, and sends nothing to the server

#### Scenario: Access before the server check

- **WHEN** the person types `https://vault.riverstudio.co` and continues
- **THEN** the browser asks for access to that address before setup checks that it is a Vaultwarden

### Requirement: The first sync is shown before it runs

Before the first sync, setup SHALL say what it will bring to the browser and
what it will send, counting codes, logins, backup-code lists and the items
kept but not shown.

#### Scenario: Joining Vaultwarden from an empty browser

- **WHEN** the home holds 9 codes, 2 backup-code lists and 4 keys, notes and passkeys
- **THEN** setup says those come to the browser, that logins aren't synced with Vaultwarden yet, and that nothing is sent

### Requirement: Syncing as the app syncs

The extension SHALL merge as the app does: by item id, the newest change
winning, deletions kept as tombstones, HOTP counters never going back, each
Vaultwarden write checked against the item's revision, and the run started
over after a conflict.

#### Scenario: A code added on the phone

- **WHEN** a code is added on the phone and both sync
- **THEN** the browser lists it

#### Scenario: Two changes to one item

- **WHEN** the phone and the browser each change one code's name between syncs
- **THEN** both end with the later change

### Requirement: Sync runs while the vault is open

While the browser's vault is unlocked, the extension SHALL sync when it
opens, every five minutes, shortly after a change made in the browser, and
on Sync now. While it is locked it SHALL not sync.

#### Scenario: A change on the phone

- **WHEN** the vault is unlocked and a code is added on the phone
- **THEN** it is in the browser within five minutes of the phone's sync

### Requirement: Every item is kept, whatever the browser shows

The extension SHALL keep, sealed, every item it receives, keys, notes,
passkeys and kinds and fields it doesn't know included, and SHALL write
them back unchanged. It SHALL show only codes, backup codes and logins.

#### Scenario: A note from the phone

- **WHEN** a secure note made on the phone syncs through the browser and back
- **THEN** the note on the phone is unchanged and nothing on the phone or server was deleted

### Requirement: Attached files are left alone

The extension SHALL not download the files attached to notes and SHALL never
delete one on the server.

#### Scenario: A note with a file

- **WHEN** a note with an attached file is synced through the browser
- **THEN** the file stays on the server and still opens on the phone

### Requirement: Logins travel through WebDAV only

Logins SHALL sync through WebDAV in the format of `add-passwords`. While the
browser syncs with Vaultwarden, logins SHALL stay in the browser, and the
popup's Logins list, the settings and setup SHALL say they aren't synced
with Vaultwarden yet.

#### Scenario: A login saved with Vaultwarden sync

- **WHEN** the browser syncs with Vaultwarden and saves a new login
- **THEN** no cipher is written for it, and the Logins list says logins stay in this browser

#### Scenario: A login saved with WebDAV sync

- **WHEN** the browser syncs with WebDAV and saves a new login
- **THEN** the login reaches the phone at the next sync of both

### Requirement: No password is lost in a sync

When the browser changes a login's password, the old one SHALL go first
among its previous passwords, at most five kept. When a merge drops a
copy whose password differs from the winner's and isn't among its previous
passwords, that password SHALL be added there.

#### Scenario: Two passwords at once

- **WHEN** the phone sets a login's password to "one" and the browser sets it to "two" a minute later, and both sync
- **THEN** both have "two" as the password and "one" among the previous passwords

### Requirement: A run that would remove much asks first

A sync that would remove more than a quarter of the items, and more than
three, here or on the server, SHALL write nothing, stop with a problem that
shows what would go, and offer to review it.

#### Scenario: The guard

- **WHEN** a sync would remove 6 of 22 items
- **THEN** nothing is written and the popup says "This sync would remove 6 of 22 items" with Review

### Requirement: Sync problems stop sync and say why

Sync SHALL stop, change nothing in the browser and show the app's message
when the session ended, the home's storage changed on another device, the
home is gone, the removal guard stopped a run, or the account's encryption
isn't supported. Everything in the browser SHALL keep working meanwhile.

#### Scenario: The session ended

- **WHEN** Vaultwarden refuses to renew the session
- **THEN** the popup says "Sign in to Vaultwarden again", the toolbar icon shows a warning dot, and codes and logins still fill

#### Scenario: Storage changed on another device

- **WHEN** the phone switched the home from sealed to plain
- **THEN** the browser stops before reading any item and offers to follow

#### Scenario: Offline

- **WHEN** the computer is offline
- **THEN** the popup says when it last synced, and changes wait for the next sync

### Requirement: Changing storage and signing out

Settings SHALL show the server, account, storage, home, last sync and
device, and SHALL offer Sync now, Change storage, with the app's
acknowledgement and warnings, and Sign out, which forgets the session and
settings in the browser and never removes the home or its items.

#### Scenario: Signing out

- **WHEN** the person signs out of Vaultwarden in the browser's settings
- **THEN** sync stops, the browser keeps its items, and the home and its items on the server are untouched
