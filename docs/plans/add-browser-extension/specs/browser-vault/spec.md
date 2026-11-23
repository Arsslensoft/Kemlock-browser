# Spec Delta

## Purpose

Keeps a Kemlock vault inside the browser, sealed as the app seals one and
open only while the person uses it, so the extension can fill codes and
logins without the phone.

## ADDED Requirements

### Requirement: The browser gets a vault of its own

On first run the extension SHALL open its setup tab and ask for a password
for this browser, typed twice, with the strength meter of the app's setup
screen. It SHALL make a new vault under that password: its own key pair, not
a copy of the phone's, with the phone's items arriving through sync.

#### Scenario: First run

- **WHEN** the extension is installed and its icon is clicked
- **THEN** the setup tab opens at "A password for this browser"

#### Scenario: The two passwords differ

- **WHEN** the person types two different passwords
- **THEN** setup doesn't continue and says they don't match

### Requirement: The vault is sealed as the app seals one

The extension SHALL keep the vault in the browser's extension storage under
the app's storage keys and formats: the private key wrapped under scrypt of
the password, and every value sealed to its ML-KEM-1024 key with
AES-256-GCM. Nothing about items (names, usernames, websites, counts) SHALL
be stored readable.

#### Scenario: Reading the stored vault

- **WHEN** the extension's storage is read from the browser profile on disk
- **THEN** it holds no item name, username, website, code secret or password in the clear

#### Scenario: The app's code opens it

- **WHEN** the storage of a browser vault is loaded by the app's vault store with its password
- **THEN** the vault opens and lists the same items

### Requirement: An unlocked vault is held in memory only

While unlocked, the vault's keys SHALL live only in the extension's memory
and the browser's memory-only session storage, never on disk and never in a
web page or content script. Closing the browser SHALL lock it.

#### Scenario: The browser restarts

- **WHEN** the vault is unlocked and the browser is closed and opened again
- **THEN** the vault is locked

#### Scenario: The background is suspended

- **WHEN** the browser stops the extension's background between events while the vault is unlocked and not idle
- **THEN** the next event finds the vault still unlocked, without asking for the password

### Requirement: The vault locks after idle time

The extension SHALL lock the vault after the person's chosen idle time, 1,
5, 15 or 60 minutes, 5 by default. Using the popup, the in-page menu or a
fill SHALL count as activity.

#### Scenario: Five idle minutes

- **WHEN** the vault is unlocked and nothing of Kemlock is used for 5 minutes
- **THEN** the vault is locked and the toolbar icon turns grey

### Requirement: The vault locks when the computer sleeps or locks

While "Lock when the computer sleeps", on by default, is on, the extension
SHALL lock the vault when the computer sleeps or its screen locks.

#### Scenario: The screen locks

- **WHEN** the screen of the computer locks while the vault is unlocked
- **THEN** the vault is locked

### Requirement: The vault can be locked at once

The popup SHALL offer Lock now, which locks the vault and closes every open
Kemlock menu on pages.

#### Scenario: Lock now

- **WHEN** the person clicks Lock now in the popup
- **THEN** the vault is locked and the popup shows the lock screen

### Requirement: Unlocking from the popup or the in-page menu

The vault SHALL unlock with its password, typed in the popup or in the
in-page menu, which is drawn by the extension so the page can't read what is
typed.

#### Scenario: Unlocking on a page

- **WHEN** the vault is locked and the person clicks Kemlock's button in a sign-in field
- **THEN** the menu asks for the browser's password and, once it opens, offers the site's login

### Requirement: Wrong passwords are counted

The extension SHALL count wrong passwords, writing each try down before
checking it, and SHALL show how many there were since the vault last opened
and when the last was. Opening the vault SHALL set the count back to zero.
It SHALL never erase the vault because of wrong passwords.

#### Scenario: Three wrong passwords

- **WHEN** three wrong passwords are typed and the popup is closed and opened again
- **THEN** the lock screen says 3 wrong tries since the vault last opened and gives the time of the last

#### Scenario: The right password

- **WHEN** the right password is typed after wrong ones
- **THEN** the vault opens, says once how many wrong tries there were, and the count is zero

### Requirement: Nothing is shown while locked

While locked, the extension SHALL show no item's name, username or website:
not in the popup, the in-page menu, the toolbar badge or the right-click
menu.

#### Scenario: A known site while locked

- **WHEN** the vault is locked and the person opens a site the vault has a login for
- **THEN** the toolbar icon is grey without a count, and the field's button offers only to unlock

### Requirement: Removing Kemlock from the browser

Settings and the lock screen SHALL offer "Remove Kemlock from this
browser", which, once confirmed, deletes the browser's vault and everything the extension stored,
and forgets its Vaultwarden or WebDAV sign-in, leaving the phone and the
sync place untouched.

#### Scenario: Removing

- **WHEN** the person confirms "Remove Kemlock from this browser"
- **THEN** the extension's storage is empty, the setup tab opens, and nothing is deleted on the sync server

### Requirement: A forgotten password is recovered through sync

The browser's password SHALL open only this browser's vault, and nothing
SHALL recover it. The lock screen SHALL say that setting the browser up
again and joining sync brings every item back.

#### Scenario: Forgotten password

- **WHEN** the person removes Kemlock from the browser and sets it up again with a new password and the same sync
- **THEN** after the first sync the browser holds the same items as before
