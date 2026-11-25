# Keys, contacts and the PGP tools in the browser

The extension lists and manages the vault's keys (SSH, signing, exchange, PGP and other),
the contacts (other people's OpenPGP public keys) and the app's PGP tools: encrypt, decrypt, sign
and verify, with SSH signatures and git signature checks beside them. Until now the kinds
synced through the extension untouched and stayed invisible.

This plan extends `add-browser-extension` (`docs/plans/add-browser-extension/`). The screens
follow the app's: `features/keys`, `features/pgp` and `features/contacts` in `../kemlock/mobile/lib`.

## Why

The owner wants browser parity: whatever the phone shows of the vault, the browser shows too. A
person who keeps an SSH key or a PGP key in Kemlock needs its public half on a computer more than
on a phone (a `.pub` for GitHub, an armored key for a mail client, a message to decrypt that came
by email), and the browser is where those are pasted.

## What changes

- **Keys.** A list (kind, name, fingerprint, comment, tags) and a key's page:
  - the public half to copy (OpenSSH line, armored PGP, or PEM, as the kind has it) and to
    download;
  - the private half to reveal and copy, behind a warning that the key then lives outside the
    vault. Copying goes through the background's clipboard, which clears itself;
  - a file download of the private half, protected with a passphrase typed twice unless the
    person says none (a PGP key with its own passphrase leaves as it came);
  - rename, note and tags, and delete (asked first);
  - for an SSH key, signing a text or a file (`ssh-keygen -Y sign`'s block), and for a PGP key,
    its user IDs, subkeys and expiry as the app lists them.
- **Add a key.** Generate (SSH, signing, exchange with the app's algorithms; PGP with its four
  types, a name, an email and an expiry), or import by pasting or choosing a file in every
  format the app reads, asking the passphrase of a protected key. A PGP key the vault holds is
  not added twice, and one that adds subkeys or user IDs updates the held copy, as the app does.
  A public key given by mistake is offered as a contact.
- **Contacts.** The list with name, fingerprint and standing (in order, expiring, expired,
  revoked) and whether the fingerprint was compared. Add by pasting or choosing a file of
  OpenPGP public keys (one or a keyring, each checked), see the fingerprint first, mark it
  compared, rename, copy the key, delete. Contacts live only in the vault's own scope.
- **PGP tools.** Encrypt a text or a file to contacts and own keys, or with a passphrase,
  optionally signed; decrypt a pasted message or file with the vault's keys; sign a text
  (clear-signed) or a file (detached); verify against contacts and own keys. Results are copied
  or downloaded. SSH signatures are made and checked the same way, and a pasted git commit or tag
  is checked for its SSH signature.
- **A tab for files.** The popup closes when a file dialog opens, so a "Keys and PGP" tab
  (`src/keys/`) hosts the same screens for file work and long jobs (RSA generation, big messages).
  The popup's pages say so and open it.
- **The storage format is the app's.** Keys and contacts are `VaultKey` and `Contact` of
  Kemlock-core, saved with the app's store, with `updatedAt` stamped so sync carries every edit.
  The core's own lists are `core/lib/src/keys_service.dart` and `pgp_service.dart`; the screens
  are `src/popup/keys/`.

## Not in this plan

- **An SSH agent.** A browser extension cannot listen on a socket or a named pipe, nor be asked
  by `ssh` for a signature, so nothing here replaces `ssh-agent`. The key's private half can be
  copied or saved to a file for the agent of the computer.
- Changing a PGP key (add a subkey or user ID, move the expiry, revoke): the app's "Change this
  key" sheets. The key's page lists what the key holds; the phone changes it, and sync carries the
  result.
- Security keys' OpenPGP cards: a key on a card is listed, its public half copied, and nothing is
  signed or decrypted with it (a browser has no way to reach a card here).
- Key reminders and expiry notifications, the key server and Web Key Directory lookups of
  contacts (the extension asks for no host permission for them), contact QR codes, and the
  mail provider.
- Sharing a key in a space (spaces are a stream of their own). A key in a space is listed and
  usable.
- SSH public keys as contacts. The app's contact is an OpenPGP public key (`Contact.public` is a
  transferable key), so an SSH `.pub` line is not one; to check an SSH signature the signer's line is
  pasted into Verify, which says whether it is the key that signed.
- Files over 16 MiB in the PGP tools: they are held in memory, sent to the core as JSON, and the
  background has no streaming path to the disk the phone uses.
- Asking the vault's password again before a private key is shown, as the app does with
  biometrics: logins show their password without it, and so do keys, behind the warning.

## Tasks

- [x] Plan.
- [x] Core: the keys service (list, public and private halves, generate, import, edit, delete)
      and its views, with `core/test/keys_service_test.dart`.
- [x] Core: contacts (read, preview, add, merge, check, rename, delete).
- [x] Core: the PGP tools and SSH signatures, with `core/test/pgp_service_test.dart`.
- [x] Contract: `CoreApi` and `PageApi` additions (`src/shared/keys-api.ts`, merged into the shared
      interfaces), the message parsers, the bridge's method names, the sender for the new tab page,
      `FakeCore`.
- [x] Background: the handlers (`src/background/keys.ts`), private-key copy through the clipboard.
- [x] Popup: keys list and key page, add a key, contacts, the PGP tools; the entry on Home.
- [x] The tab page for files and long jobs (`src/keys/`), and its build entry.
- [x] Strings in `locales/parts/keys.{en,fr}.json`.
- [x] Tests: vitest for the parsers, the background handlers, the fake and the screens; Playwright
      for the main flow (`tests/e2e/keys.spec.ts`).
