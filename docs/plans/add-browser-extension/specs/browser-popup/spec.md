# Spec Delta

## Purpose

The extension's toolbar popup: the site's login and code first, then every
code and login with search, adding a code from the page, a login's page,
password health, the generator, recently generated passwords and the
settings.

## ADDED Requirements

### Requirement: The site in front comes first

When the active tab's site matches items, the popup SHALL open on a card for
them: the login's name and username, its password as dots with Show and
Copy, the linked code with its countdown and Copy, and Fill code and Fill
login, which fill the tab. Several matches SHALL each get a card.

#### Scenario: A matching site

- **WHEN** the active tab is on orbit-cloud.com and the vault has its login with a linked code
- **THEN** the popup opens on the Orbit Cloud card with the live code, Fill code and Fill login

#### Scenario: No match

- **WHEN** the active tab's site matches nothing
- **THEN** the popup opens on the lists, without a card

### Requirement: Codes are listed live

The Codes list SHALL show every code with its name and account, the current
code and the shared countdown. In its last five seconds a code SHALL turn to
the warning colour and show the next one. An HOTP account SHALL have a
button for its next code.

#### Scenario: The last five seconds

- **WHEN** a 30-second code has 4 seconds left
- **THEN** it shows in the warning colour with "next" and the following code under it

#### Scenario: A counter code

- **WHEN** the person clicks the next-code button of an HOTP account
- **THEN** its counter goes up by one and the change syncs

### Requirement: The vault's order and tags are shown, and changed on their own pages

The lists SHALL follow the account order the vault keeps (pinned items first) and SHALL offer the vault's tags as a filter. The
extension changes the order and the tags only where the vault tools say so (`docs/plans/add-vault-tools.md`), in the app's own
storage format, so that a phone keeps what the browser saves.

#### Scenario: A custom order

- **WHEN** the phone keeps the accounts in a custom order and the browser syncs
- **THEN** the popup's Codes list shows them in that order

#### Scenario: Filtering by a tag

- **WHEN** the person picks the tag "Work" in the popup
- **THEN** only the codes and logins tagged Work are listed

### Requirement: Codes kept on a security key are named, not filled

An account whose secret is on a security key SHALL be listed by name with
"On your security key" in place of its code, and SHALL offer neither Copy
nor Fill.

#### Scenario: A code on a YubiKey

- **WHEN** the phone moved the Proton account's secret to a YubiKey and the browser syncs
- **THEN** the popup lists Proton with "On your security key" and no code

### Requirement: Logins are listed with their health

The Logins list SHALL show each login's name, username and website, and its
health tag (Reused, Weak, Breached or "Without its code"). Clicking a login
SHALL copy its password. Each login SHALL open its page.

#### Scenario: A reused password

- **WHEN** Orbit Cloud and Linear have the same password
- **THEN** both show Reused in the list

### Requirement: Search covers both lists

Search SHALL match names, usernames, account labels and websites,
regardless of case, and SHALL say when nothing matches.

#### Scenario: Searching

- **WHEN** the person types "orbit"
- **THEN** the lists show only items whose name, username or website contains "orbit"

### Requirement: Copying clears the clipboard

Copying a code, a username, a password or a backup code SHALL put it on the
clipboard and, after the chosen time (10, 30, 60 or 120 seconds, 30 by
default), clear the clipboard if it still holds that value.

#### Scenario: Clearing

- **WHEN** a code is copied and nothing else is copied for 30 seconds
- **THEN** the clipboard is empty

#### Scenario: Something else copied

- **WHEN** a code is copied and the person copies other text within 30 seconds
- **THEN** that other text stays on the clipboard

### Requirement: A login's page

A login's page SHALL show its websites, username and password (dots until
shown), its strength and when it changed, its linked code and backup codes,
its previous passwords, and the sites remembered for it in this browser,
with Fill login, Fill code and Edit.

#### Scenario: Previous passwords

- **WHEN** a login has two previous passwords
- **THEN** its page lists them newest first as "Until <date>", each hidden until Show

#### Scenario: A remembered site

- **WHEN** the login was picked on id.orbitauth.net with "Always suggest here"
- **THEN** its page lists id.orbitauth.net as remembered in this browser, with Forget

### Requirement: Logins can be edited and deleted in the browser

The person SHALL be able to edit a login's name, username, password,
websites, note and linked code, with Generate beside the password, and to
delete a login after confirming. Changes SHALL sync as the phone's do.

#### Scenario: Changing a password

- **WHEN** the person changes a login's password in the browser and saves
- **THEN** the old password is first among its previous passwords

### Requirement: A code can be added from a QR code on the page

"Add a code" in the popup SHALL read the QR codes visible in the tab in
front, and the right-click menu of an image SHALL offer "Add code to
Kemlock". An `otpauth://` code found SHALL be shown, with its name editable,
and added on confirmation, with the page's site as its website.

#### Scenario: Setting up two-step sign-in

- **WHEN** github.com/settings/security shows a setup QR code and the person clicks Add a code, then Add
- **THEN** the vault holds the GitHub account with github.com as its website, and the phone has it after the next sync

#### Scenario: A QR code that isn't a code

- **WHEN** the only QR code on the page holds a web address
- **THEN** the popup says no code was found and adds nothing

#### Scenario: A code already in the vault

- **WHEN** the QR code's secret is already an account's in the vault
- **THEN** the popup names that account and adds nothing

### Requirement: A code can be added from a pasted link

"Add a code" SHALL also take a pasted `otpauth://` link, read as the app
reads one, and add it the same way.

#### Scenario: Pasting a link

- **WHEN** the person pastes `otpauth://totp/Orbit:sam?secret=JBSWY3DPEHPK3PXP&issuer=Orbit` and clicks Add
- **THEN** the vault holds the Orbit account and its code is listed

### Requirement: A new code is linked to its login

When a code is added on a site the vault has a login for, the extension
SHALL offer to link the code to that login.

#### Scenario: Linking on add

- **WHEN** the person adds a code on orbit-cloud.com and the vault has the Orbit Cloud login without a code
- **THEN** the add step offers "Link to the Orbit Cloud login", and once linked the login shows the code

### Requirement: Backup codes can be used

For a service with backup codes, the popup SHALL show how many are left, and
let the person copy one and mark it used, which syncs.

#### Scenario: Using a backup code

- **WHEN** the person copies a backup code and marks it used
- **THEN** the count goes down by one, and the phone shows it used after sync

### Requirement: Password health is worked out in the browser

The popup SHALL tag logins Reused, Weak and "Without its code" from the
browser's own vault, by the app's rules, and SHALL store and sync nothing
about health. A login's "Don't warn for this login" SHALL stop its
"Without its code" tag, and that choice syncs.

#### Scenario: Counting

- **WHEN** two logins are reused and one has no code
- **THEN** the Logins list shows "Password health · 2 reused · 1 without its code"

#### Scenario: Stopping a warning

- **WHEN** the person picks "Don't warn for this login" on a login without its code
- **THEN** it is no longer counted, here and on the phone after sync

### Requirement: Breached passwords only behind their switch

While "Check for breached passwords", off by default, is on, the extension
SHALL check each login's password against the Pwned Passwords range service,
sending only the first five characters of its SHA-1 and padding, and tag a
password found there Breached. Off, nothing SHALL be sent.

#### Scenario: Switch off

- **WHEN** the switch is off
- **THEN** no request leaves the browser for Pwned Passwords

#### Scenario: A breached password

- **WHEN** the switch is on and a login's password appears in Pwned Passwords
- **THEN** the login is tagged Breached and its page says to change it on the site

### Requirement: The generator makes the app's passwords

The generator SHALL offer the app's choices and defaults: Random, 8 to 64
characters, 20 by default, with capitals, digits, symbols `! # % & - _ ?`
and avoiding look-alikes, or Passphrase, 3 to 10 words, 5 by default.
Given the same choices, rules and random bytes it SHALL make the app's
password.

#### Scenario: Shared test cases

- **WHEN** the extension's generator is fed each case of the app's generator test cases
- **THEN** it makes exactly the password each case expects

#### Scenario: Remembered choices

- **WHEN** the person sets the length to 32 and opens the generator later
- **THEN** it opens at 32, and the choice isn't synced

### Requirement: Recently generated passwords are kept

A password the extension generated and filled SHALL be kept, sealed in the
vault, under Recently generated with its site and date, Copy and "Save as
login". As the app keeps them, it SHALL be kept for 30 days, or until a
saved login holds it, and SHALL NOT be synced.

#### Scenario: Leaving without saving

- **WHEN** a generated password was filled on a sign-up form and the person left without saving
- **THEN** Recently generated lists it for that site, and "Save as login" adds it as a login

#### Scenario: After 30 days

- **WHEN** a generated password was filled 31 days ago and no login holds it
- **THEN** Recently generated no longer lists it

#### Scenario: Not synced

- **WHEN** the browser syncs after generating a password
- **THEN** nothing about the generated password is written to the sync file or to Vaultwarden

### Requirement: Nothing in the extension asks for Premium

The extension SHALL show no paywall and check no purchase. What the app
sells as Premium and the extension has, sync, the vault's order and tags,
SHALL be free in the browser, and no tool SHALL be shown locked.

#### Scenario: Backup-code tools

- **WHEN** the person opens a service's backup codes in the popup
- **THEN** they can copy, mark codes used or unused, add, remove and delete them, and see which codes have none saved, all free (`docs/plans/add-vault-tools.md`)

### Requirement: The settings

Settings SHALL hold auto-lock, clipboard clearing, locking on sleep, the
breach check, the button in fields, offering to save logins, offering the
code after the password, suggesting strong passwords with the generator's
defaults, site access, sync, and removing Kemlock from the browser.

#### Scenario: Turning off the button in fields

- **WHEN** the person turns off "Button in sign-in and code fields"
- **THEN** pages show no Kemlock button, and fields still fill from the popup and the right-click menu

### Requirement: The toolbar icon says the state

The toolbar icon SHALL be grey while locked, azure while unlocked, carry
the count of the active site's matching logins and codes, an orange "!" on
a look-alike site, and an orange dot while sync is stopped.

#### Scenario: A look-alike site

- **WHEN** the active tab is on orbit-c1oud.com and the vault has a login for orbit-cloud.com
- **THEN** the icon shows the orange "!"

### Requirement: The popup follows the system's theme and language

The popup and every extension page SHALL follow the system's light or dark
theme and SHALL be in English or French, as the browser's language is, with
the app's wording wherever the app says the same thing.

#### Scenario: A French browser

- **WHEN** the browser's language is French
- **THEN** the popup, menus and setup are in French, and sync problems read as in the app
