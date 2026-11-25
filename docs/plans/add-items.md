# Notes, cards and identities in the browser

The extension shows and edits the vault's notes, cards and identities, and fills cards and
identities on pages. Today every one of these kinds syncs through the extension untouched and
is invisible there. This plan makes them first-class, as logins and codes are, and finishes
`add-browser-extension` task 7.6 (website rules in the core).

It changes `add-browser-extension` (`docs/plans/add-browser-extension/`). Where the two
disagree, this one wins. The app's side is `add-cards-identities-and-websites` in the app's
repository, whose screens (`mobile/lib/features/notes`, `cards`, `identities`) the popup mirrors.

## Why

The owner asked on 24 November 2026 for browser parity: a person who keeps a card or an address
in Kemlock expects to read it, copy it and fill a checkout form from the browser, not only to
see a login. The extension already carries these items through a sync so they are never read as
deleted; this plan lets the person use them.

## What changes

- **The core** lists, reveals, saves and deletes notes, cards and identities over the vault's
  `Lists.notes`, `Lists.cards` and `Lists.identities`, in the app's own storage format
  (`VaultStore.saveNotes`, `saveCards`, `saveIdentities`). Methods: `notes`, `revealNote`,
  `saveNote`, `deleteNote`, `cards`, `revealCard`, `saveCard`, `deleteCard`, `identities`,
  `revealIdentity`, `saveIdentity`, `deleteIdentity`.
  - A list view carries no secret: a note's title only; a card's name, brand, last four digits,
    expiry and cardholder; an identity's name, contact details and address, never a document
    number. A reveal returns the whole item.
  - A save changes only the fields the browser edits and keeps everything else (`copyWith`
    keeps `extra`, a note's files and PIV key, a card's valid-from date, an identity's
    documents). It stamps the item changed (`stampChanged`, as `saveLogin` does), so sync
    carries it.
- **The popup** shows Notes, Cards and Identities on Home beside Codes and Logins, with the
  same search, and a page for each kind with copy buttons through the clipboard that clears
  itself, hidden fields (card number, security code, PIN, document numbers) shown on a click,
  and add, edit and delete pages. Pinned items come first, as in the app.
- **Filling on pages.** The content script recognises card fields (`autocomplete` `cc-name`,
  `cc-number`, `cc-exp`, `cc-exp-month`, `cc-exp-year`, `cc-csc`, `cc-type`, and names, ids,
  placeholders and labels in English and French) and identity and address fields (name parts,
  email, telephone, organisation, address lines, city, region, postal code, country, birthday).
  Kemlock's button and the menu offer the person's cards or identities, and a click fills them,
  selects included (expiry month and year, country, region).
  - Filling only on a click in the menu, or from the popup or the right-click menu, and under
    the frame gate below.
  - Right-click entries "Fill card" and "Fill identity".
  - After a checkout form with a card the vault doesn't hold is sent, the save prompt offers
    "Save this card to Kemlock?", on the pattern of saving logins.
- **Website rules.** `add-browser-extension` task 7.6: the core matches whole addresses by each
  website's rule (Default, Base domain, Host, Starts with, Exact, Regular expression, Never)
  through Kemlock-core's `fillsOn`. It was already wired into logins and codes; this plan holds
  it to the app's `rules.json` cases and ticks the task.

## Decisions

1. **A card or identity fills where the person is looking, and where they confirm.** Cards and
   identities belong to no website (Kemlock-core's models have no `websites`), so the site
   check of a login cannot protect them. The gate is the frame's, not the item's:
   - A frame fills automatically only when it is the tab's top frame on an `https` address.
   - A frame inside the page (a payment provider's iframe, the usual place for a card number),
     and any `http` page, fills only after the person confirms in the menu, on a screen that
     shows the frame's own address and says when it is not the page's.
   - The background enforces this whatever the menu says: `fill` of a card or identity into
     another frame, or an `http` one, is refused unless it carries the menu's `picked`.
   - The popup's Fill button covers the top frame over `https` only; for anything else it says
     to use the button in the field.
2. **Secrets leave the core one at a time.** The popup's page holds no card number, security
   code, PIN or document number until the person presses Show or Copy; the edit page loads the
   whole item, as a login's edit page loads its password. The page of a site never receives an
   item: the content script gets one value per field, for fields it named.
3. **The browser doesn't edit what it can't show.** Tags and the app's order stay as they are
   (as for logins). A note's attached files are listed read-only: their contents are kept
   apart from the vault and fetched by the phone. A card's "valid from" date and an identity's
   documents are edited, since the app edits them.
4. **Cards and identities are offered by what the form asks, not by a website.** The menu lists
   all cards (or identities), pinned first, with search. The popup's site card does not offer
   them: a form's fields do.
5. **One save prompt.** A tab holds a pending login, a pending card and a pending identity, each for five
   minutes and none while the vault is locked; the prompt shows the newest, and an answer names the offer
   it answers. A card is offered when no card of the vault has the same digits, an identity (a name, and
   an email or a street) when none has the same email, or the same name and postal code.
6. **A field the person can't see gets nothing.** A card or identity field must be 8 by 8 pixels or more,
   inside the page, unclipped and at least half opaque, and is filled only in the viewport or near the
   field clicked. A confirmed fill into a frame is made only when the top frame says the frame is in plain
   view.

## Not in this plan

- Attaching, opening or removing a note's files, which are fetched and decrypted on the phone.
- Editing tags or pinning from the browser's lists beyond a "Pin to the top" switch on the
  edit pages (the app's own switch).
- Offering a card or an identity from the popup's "On this site" card (decision 4).
- Filling a card's PIN or an identity's document numbers: no web form asks for them.
- Editing cards and identities of a shared space beyond what the core's guard allows: the guard and the
  space's description come from the spaces plan.
- Filling a form Kemlock does not recognise from the right-click menu. "Fill card" and "Fill identity" fill the card or
  identity fields the frame's scan found (and open the menu on the first of them when there are several items or the frame
  needs the person's word); on a form with no recognised field there is nothing to say which field is which part.
- The popup's Fill button for a frame inside the page or an http page (decision 1): it says to use the button in the field,
  where the menu shows the address and asks.
- Driving Chromium's own context menu in Playwright, which it cannot: the right-click entries are covered by Vitest
  (`src/background/items-fill.test.ts`), the rest of the filling by `tests/e2e/items.spec.ts`.
- An identity's email in a frame that holds a password field: it stays the sign-in's username (a page with a password and an
  address form is a sign-up first).
- Website rules for cards and identities: the models carry none, so there is nothing to match
  (decision 1). Logins and codes use theirs.

## Tasks

- [x] 1. The core
  - [x] 1.1 `item_views.dart` and `vault_items.dart` (list, reveal, save, delete for the three
        kinds), the dispatch in `core_service.dart`, the names in `bridge.ts`.
  - [x] 1.2 Dart tests in `core/test/items_test.dart`: the views hold no secret, a save keeps
        unknown keys and unedited fields, bumps `updatedAt`, a deleted item is gone, a note
        keeps its files, an identity its documents.
- [x] 2. The background
  - [x] 2.1 Types in `api.ts` (`CoreApi`, `PageApi`), messages and their validation in
        `messages.ts`, handlers, the fake core, and `copy` for card and identity fields.
  - [x] 2.2 Vitest: parsing, handlers, the fake core, copying.
- [x] 3. The popup
  - [x] 3.1 Home lists and search, routes.
  - [x] 3.2 A page, an edit page and delete for each kind, strings in `locales/parts/items.*`.
  - [x] 3.3 Vitest component tests, the locales test.
- [x] 4. Filling
  - [x] 4.1 Field rules for cards and identities (`src/content/forms.ts`),
        the DOM reader with selects, scanning and reports.
  - [x] 4.2 The fill path: the background's frame gate, `fill` for a card or identity, value
        formats (expiry shapes, selects), the content script's setter for selects.
  - [x] 4.3 The menu's card and identity lists and its confirm screen, the right-click entries.
  - [x] 4.4 Saving a card after a checkout.
  - [x] 4.5 Vitest for each, and the Playwright spec `tests/e2e/items.spec.ts`.
- [x] 5. Website rules
  - [x] 5.1 Copy `rules.json` into `test/fixtures/websites/`, list it in `tool/copies.test.mjs`,
        read it in `core/test/website_rules_test.dart`.
  - [x] 5.2 Tick `add-browser-extension` task 7.6.
