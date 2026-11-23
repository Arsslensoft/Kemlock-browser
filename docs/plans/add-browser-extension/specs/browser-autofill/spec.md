# Spec Delta

## Purpose

Fills logins, codes and new passwords into web pages from the browser's
vault, only when the person clicks and only on the site an item belongs to,
and saves the logins people create or change, by the rules the app's
AutoFill follows.

## ADDED Requirements

### Requirement: Code fields are found by the app's rules

A field SHALL be a code field when it says `autocomplete="one-time-code"`,
when its words hold one that can only mean a code (OTP, TOTP, 2FA, MFA,
one-time, two-factor, verification code, code de vérification), or when a
softer word (code, verification, token, passcode) names a short or numeric
field.

#### Scenario: A field named twoFactorCode

- **WHEN** a text field with no maxlength is named `twoFactorCode`
- **THEN** it gets Kemlock's button as a code field

#### Scenario: A short field named code

- **WHEN** a numeric field with maxlength 6 is named `code`
- **THEN** it is a code field

#### Scenario: A long field named code

- **WHEN** a text field with no maxlength is named `promo_code`
- **THEN** it is not a code field

### Requirement: A field's words are read word by word

A field's words SHALL come from its name, id, placeholder, labels and
accessible name, split at camelCase, dashes and underscores, so "otp"
inside another word doesn't count.

#### Scenario: A word inside a word

- **WHEN** a short numeric field is named `laptop_tag`
- **THEN** it is not a code field

#### Scenario: An accessible name

- **WHEN** a numeric field's only text is `aria-label="Verification code"`
- **THEN** it is a code field

### Requirement: A row of one-character boxes is one code

Four to ten visible one-character text, number or telephone boxes in a row,
none a password or another kind of code, SHALL be one code field, filled
one character per box in order, even when nothing names them.

#### Scenario: Six boxes

- **WHEN** the person fills a code into a row of six one-character boxes
- **THEN** each box holds its digit, in order

### Requirement: Other kinds of code are left alone

A field whose words say recovery, backup or secours SHALL get no button and
SHALL never be filled with a one-time code.

#### Scenario: A recovery code field

- **WHEN** a page shows a field named `recovery_code`
- **THEN** it has no Kemlock button

### Requirement: Hidden fields are never filled

The extension SHALL fill only fields that are visible, on screen, not
transparent and not covered, and SHALL never put a value in a hidden one.

#### Scenario: A hidden password field

- **WHEN** a page holds a password field with `opacity: 0` beside the visible one
- **THEN** filling the login fills only the visible fields

### Requirement: Sign-in and new-password fields

A username or email field with a password field SHALL take Fill login, on one
page or across two. A field with `autocomplete="new-password"`, or a second
password field after the first, SHALL take a suggested password.

#### Scenario: A two-page sign-in

- **WHEN** a site asks for the email on one page and the password on the next
- **THEN** each page's field offers the login and fills its own value

### Requirement: Buttons on pages need the person's permission

The extension SHALL install without access to web pages. Setup, and later
Settings › Site access, SHALL ask the browser for access to all sites,
saying it is for Kemlock's button in fields. Refused, the popup and the
right-click menu SHALL still fill the tab in front when the person uses
them.

#### Scenario: Access refused

- **WHEN** the person refuses access to all sites
- **THEN** pages show no Kemlock button, and Fill login in the popup still fills the tab in front

#### Scenario: Access granted later

- **WHEN** the person grants access to all sites from Settings › Site access
- **THEN** recognised fields show Kemlock's button from the next page load

### Requirement: The button opens a menu the page can't read

A recognised field SHALL show Kemlock's button while "Button in sign-in and
code fields" is on. Clicking it, or pressing the down arrow in the field,
SHALL open a menu drawn by the extension in its own frame, so the page can
read neither what it lists nor what is typed in it.

#### Scenario: Reading the menu from the page

- **WHEN** the page's script tries to read the open menu's text
- **THEN** it can't reach it

### Requirement: Nothing fills without a click

The extension SHALL fill only when the person picks an item in the menu or
the popup, clicks Fill or presses Enter on it, and SHALL never fill on page
load or by itself.

#### Scenario: Opening a sign-in page

- **WHEN** a page with the site's login fields loads
- **THEN** the fields stay empty until the person picks the login

### Requirement: A click counts only on a menu in plain view

The menu SHALL take a click or key only after it has been fully visible and
uncovered for half a second, and only while no style hides or fades it or
the page. Otherwise it SHALL ignore the input and say why.

#### Scenario: A faded menu

- **WHEN** the page sets the menu's frame or the page to opacity 0 and the person clicks where the item was
- **THEN** nothing fills

#### Scenario: A quick click

- **WHEN** the person clicks an item a tenth of a second after the menu opened
- **THEN** nothing fills until the menu has been visible for half a second

### Requirement: An item fills only on its own site

An item SHALL be offered on a host whose registrable domain, by the Public
Suffix List, is a website's of the item, compared label by label. A host
under a private suffix, or a tenant host such as okta.com or slack.com,
SHALL match only exactly.

#### Scenario: Another subdomain

- **WHEN** a login was saved on accounts.orbit-cloud.com and the person signs in on app.orbit-cloud.com
- **THEN** the login is offered

#### Scenario: A host that only looks like it

- **WHEN** the page is orbit-cloud.com.evil.io or evilorbit-cloud.com
- **THEN** the login is not offered

#### Scenario: A shared suffix

- **WHEN** a login's website is sam.github.io and the page is alex.github.io
- **THEN** the login is not offered

### Requirement: A field is judged by its own frame

A field SHALL be matched by the address of the frame it is in, as the
browser reports it, never by the tab's address or by anything the page
says.

#### Scenario: A frame from another site

- **WHEN** a sign-in field sits in a frame from evil.test inside an orbit-cloud.com page
- **THEN** the field is matched as evil.test and the Orbit Cloud login isn't offered

### Requirement: Several matches are each offered

When several items match, the menu SHALL list each by name and username or
account label.

#### Scenario: Two logins for one site

- **WHEN** the vault has two Orbit Cloud logins
- **THEN** the menu lists both, by username

### Requirement: An unknown site offers a picker

When nothing matches, the menu SHALL say "Kemlock doesn't know this site for
these logins", list every login or code with search, and fill the one
picked after showing the address it fills. "Always suggest here" SHALL
remember the pick for that site in this browser only, not synced.

#### Scenario: A sign-in host the login doesn't name

- **WHEN** the person picks Orbit Cloud on id.orbitauth.net with "Always suggest here" on
- **THEN** the login fills, and from then on it is offered by name on id.orbitauth.net in this browser

### Requirement: A look-alike site gets a guard

When nothing matches and the host's registrable domain is the same as a
known item's once look-alike characters are folded together, or one
character off it in a name of six letters or more, the menu SHALL say so,
show both addresses with the difference marked, and make "Don't fill" the
main action.

#### Scenario: A digit for a letter

- **WHEN** the page is orbit-c1oud.com and the vault has a login for orbit-cloud.com
- **THEN** the menu shows "This isn't orbit-cloud.com" with the 1 marked, and filling needs picking the login and confirming the address

#### Scenario: A different site with a similar name

- **WHEN** the page is gitlab.com and the vault has a login for github.com only
- **THEN** the menu shows the picker, not the guard

### Requirement: The code follows the password

While "Offer the code after the password" is on, after a login with a
linked code fills, the next code field on that login's site SHALL open its
menu with the linked code by itself. Filling it SHALL still need a click.

#### Scenario: Two-step sign-in

- **WHEN** the Orbit Cloud login fills and the next page asks for a code
- **THEN** the menu opens on the code field offering the Orbit Cloud code, and the field stays empty until it is picked

### Requirement: Any field fills from the right-click menu

The right-click menu of an editable field SHALL offer Kemlock's Fill login,
Fill code and New password, and SHALL fill the field it was opened on even
when Kemlock doesn't recognise it, by the same site rules.

#### Scenario: An unrecognised field

- **WHEN** the person right-clicks a field Kemlock gave no button and picks Kemlock › Fill code
- **THEN** the site's code fills that field, or the picker opens when the site matches nothing

### Requirement: New passwords are suggested

On a new-password field, the menu SHALL offer a strong password and a
passphrase from the generator, and filling SHALL put the same password in
the field and its confirmation. A site's password rules, from the field and
the app's bundled list, SHALL be followed.

#### Scenario: A sign-up form

- **WHEN** the person picks "Use a strong password" on a sign-up form
- **THEN** the password and confirmation fields hold the same generated password, and it is under Recently generated

#### Scenario: A field with maxlength 16

- **WHEN** the new-password field has maxlength 16
- **THEN** the suggested password has 16 characters

### Requirement: New logins are offered to be saved

While "Offer to save new logins" is on, after a form with a username and a
password the vault doesn't hold for that site is sent, the extension SHALL
show "Save to Kemlock?" with the site, username and vault. Save SHALL add
the login with the form's host as its website.

#### Scenario: Creating an account

- **WHEN** the person creates an account on harbornotes.app and clicks Save
- **THEN** the vault holds a login for harbornotes.app with that username and password

#### Scenario: A password already held

- **WHEN** the person signs in with the password the vault already holds
- **THEN** no save prompt is shown

### Requirement: A changed password is offered as an update

When the password sent differs from the vault's login for that site and
username, the extension SHALL show "Update in Kemlock?". Update SHALL
replace the password and keep the old one among the previous passwords.

#### Scenario: Changing a password on the site

- **WHEN** the person changes their GitHub password on the site and clicks Update
- **THEN** the login has the new password, and the old one is first under Previous passwords

### Requirement: A fill reaches only its field

A filled value SHALL go only to the frame of the field it was asked for. A
code's secret SHALL never leave the extension's background, and the page
SHALL get only the code or password typed into its field.

#### Scenario: Filling a code

- **WHEN** a code fills into a page
- **THEN** the page's scripts can read the six digits in the field and nothing else of the account
