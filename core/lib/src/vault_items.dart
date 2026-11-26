// Notes, cards and identities in the browser's vault: listing them, revealing one, saving and deleting. A part of the vault
// service, so it keeps the open vault's lists and counts a change as the logins do, and written in the app's own format by
// `VaultStore`. A save changes only the fields the browser edits: whatever else the item holds (a note's files, a card's source,
// an identity's address keys of a later version) is kept as it was, and the item is stamped changed so a sync carries it.
part of 'vault_service.dart';

/// The fewest and the most digits a card number may have (the app's card sheet holds a number to these).
const cardNumberMinDigits = 8;
const cardNumberMaxDigits = 19;

/// The longest text of any single-line field of these items, and of a note's text beyond `noteTextLimit`.
const _fieldLimit = 2048;

extension VaultItems on VaultService {
  // ─── Shared ───────────────────────────────────────────────────────────

  Lists _withItems({List<SecureNote>? notes, List<PaymentCard>? cards, List<Identity>? identities}) => Lists(
    accounts: _lists.accounts,
    backupServices: _lists.backupServices,
    keys: _lists.keys,
    notes: notes ?? _lists.notes,
    passkeys: _lists.passkeys,
    keyAccounts: _lists.keyAccounts,
    contacts: _lists.contacts,
    logins: _lists.logins,
    cards: cards ?? _lists.cards,
    identities: identities ?? _lists.identities,
    files: _lists.files,
  );

  /// [view] with the space its item is in, when spaces describe one (set by the core service, as for logins).
  Map<String, Object?> _noted(Map<String, Object?> view, String? spaceId, String id) {
    final note = spaceNote?.call(spaceId, id);
    return note == null ? view : {...view, 'space': note};
  }

  /// The text of [value] trimmed, or null when it is blank; refuses what is longer than a field takes.
  String? _line(Object? value, String what) {
    final text = asString(value).trim();
    if (text.length > _fieldLimit) throw CoreFailure(CoreFailure.invalid, '$what is too long');
    return text.isEmpty ? null : text;
  }

  /// A month, 1 to 12, or null when [value] is absent; refuses anything else.
  int? _month(Object? value, String what) {
    if (value == null) return null;
    final month = asInt(value);
    if (month == null || month < 1 || month > 12) throw CoreFailure(CoreFailure.invalid, '$what is not a month');
    return month;
  }

  /// A year as the app reads one (29 is 2029), or null when [value] is absent; refuses anything else.
  int? _year(Object? value, String what) {
    if (value == null) return null;
    final year = cardYear(asInt(value));
    if (year == null) throw CoreFailure(CoreFailure.invalid, '$what is not a year');
    return year;
  }

  /// `yyyy-mm-dd` of a real calendar day, or null when blank; refuses any other text.
  String? _date(Object? value, String what) {
    final text = _line(value, what);
    if (text == null) return null;
    final date = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text) ? DateTime.tryParse(text) : null;
    final back = date == null
        ? null
        : '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    if (back != text) throw CoreFailure(CoreFailure.invalid, '$what is not a date');
    return text;
  }

  /// The tags [raw] holds: kept as they are when the input has none (the browser shows tags, never changes them).
  Object? _tagChange(Object? raw) {
    final tags = asStrings(raw);
    return tags == null ? keep : (tags.isEmpty ? unset : tags);
  }

  /// Pinned: kept when the input says nothing, set on true, removed on false.
  Object? _pinChange(Object? raw) => raw is bool ? (raw ? true : unset) : keep;

  T _find<T extends VaultEntry<T>>(List<T> list, String id, String what) {
    for (final entry in list) {
      if (entry.id == id) return entry;
    }
    throw CoreFailure(CoreFailure.notFound, 'no such $what');
  }

  // ─── Notes ────────────────────────────────────────────────────────────

  Future<void> _saveNotes(List<SecureNote> Function(List<SecureNote> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.notes), _lists.notes, now: nowMs);
    await vault.saveNotes(stamped, session);
    if (identical(_session, session)) _changed(_withItems(notes: stamped));
    await store.flush();
  });

  Map<String, Object?> _noteView(SecureNote note, int order) =>
      _noted(noteView(note, order: order, fields: fieldViews(note.fields), links: linkCount(note.id)), note.spaceId, note.id);

  /// The notes, by title only.
  List<Map<String, Object?>> notes() {
    requireSession();
    return [for (final (i, note) in _lists.notes.indexed) _noteView(note, i)];
  }

  /// A note with its text and its files (their names, sizes and whether the server holds them).
  Map<String, Object?> revealNote(String id) {
    requireSession();
    final note = _find(_lists.notes, id, 'note');
    return _noted(
      noteFull(note, order: _lists.notes.indexOf(note), fields: fieldViews(note.fields), links: linkCount(note.id)),
      note.spaceId,
      note.id,
    );
  }

  /// Saves a note: a new one when [id] is null, else the note's title, text, pin and tags, and nothing else of it.
  Future<Map<String, Object?>> saveNote(String? id, Map<String, Object?> input) async {
    requireSession();
    final title = _line(input['title'], 'the title');
    final text = asString(input['text']);
    if (title == null) throw const CoreFailure(CoreFailure.invalid, 'a note needs a title');
    if (text.length > noteTextLimit) throw const CoreFailure(CoreFailure.invalid, 'the note is too long');
    final current = id == null ? null : _find(_lists.notes, id, 'note');
    // Looked at once now, so a bad row is refused before anything is written; the edit itself is made on the note the write holds
    applyFields(current?.fields ?? const [], input['fields']);
    final refs = input.containsKey('links') ? parseRefs(input['links']) : null;
    final SecureNote saved;
    if (current == null) {
      final tags = asStrings(input['tags']);
      saved = SecureNote(
        id: newUuid(),
        title: title,
        text: text,
        fields: applyFields(const [], input['fields']),
        tags: tags == null || tags.isEmpty ? null : tags,
        pinned: input['pinned'] == true ? true : null,
        addedAt: nowMs,
      );
      await _saveNotes((held) => [...held, saved]);
    } else {
      editGuard?.call(current.spaceId, current.id);
      // The members a run or an upload writes meanwhile (the files a note names, a link) are the held note's, never the copy read above
      SecureNote edit(SecureNote held) {
        final fields = applyFields(held.fields, input['fields']);
        return held.copyWith(
          title: title,
          text: text,
          tags: _tagChange(input['tags']),
          pinned: _pinChange(input['pinned']),
          fields: identical(fields, held.fields) ? null : fields,
        );
      }

      saved = edit(current);
      await _saveNotes((held) => [for (final note in held) note.id == id ? edit(note) : note]);
    }
    final failures = refs == null ? const <String>[] : await VaultLinks(this).setLinksOf('note', saved.id, refs);
    final stored = _find(_lists.notes, saved.id, 'note');
    return {..._noteView(stored, _lists.notes.indexOf(stored)), if (failures.isNotEmpty) 'linkFailures': failures};
  }

  Future<void> deleteNote(String id) async {
    requireSession();
    editGuard?.call(_find(_lists.notes, id, 'note').spaceId, id);
    // The links to the note go in the same write, worked out from the lists the write holds
    await saveChanged((held) {
      final removed = held.notes.where((note) => note.id == id).firstOrNull;
      return removed == null ? held : VaultLinks(this).withoutEntry(held, removed);
    });
  }

  // ─── Cards ────────────────────────────────────────────────────────────

  Future<void> _saveCards(List<PaymentCard> Function(List<PaymentCard> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.cards), _lists.cards, now: nowMs);
    await vault.saveCards(stamped, session);
    if (identical(_session, session)) _changed(_withItems(cards: stamped));
    await store.flush();
  });

  /// The cards, with the last four digits and no secret.
  List<Map<String, Object?>> cards() {
    requireSession();
    final now = platform.clock();
    return [for (final (i, card) in _lists.cards.indexed) _cardView(card, i, now)];
  }

  Map<String, Object?> _cardView(PaymentCard card, int order, DateTime now) =>
      _noted(cardView(card, order: order, now: now, fields: fieldViews(card.fields), links: linkCount(card.id)), card.spaceId, card.id);

  /// A card whole: number, security code and PIN too.
  Map<String, Object?> revealCard(String id) {
    requireSession();
    final card = _find(_lists.cards, id, 'card');
    return _noted(
      cardFull(card, order: _lists.cards.indexOf(card), now: platform.clock(), fields: fieldViews(card.fields), links: linkCount(card.id)),
      card.spaceId,
      card.id,
    );
  }

  /// Saves a card: a new one when [id] is null, else the fields the browser edits. The number is kept as its digits, and a
  /// card needs a name and a number or a cardholder, as in the app.
  Future<Map<String, Object?>> saveCard(String? id, Map<String, Object?> input) async {
    requireSession();
    final name = _line(input['name'], 'the name');
    final holder = _line(input['cardholder'], 'the cardholder');
    final numberText = asString(input['number']);
    if (!isCardNumberText(numberText)) throw const CoreFailure(CoreFailure.invalid, 'a card number holds only digits');
    final digits = cardDigits(numberText);
    if (digits.isNotEmpty && (digits.length < cardNumberMinDigits || digits.length > cardNumberMaxDigits)) {
      throw const CoreFailure(CoreFailure.invalid, 'a card number has 8 to 19 digits');
    }
    if (name == null || (digits.isEmpty && holder == null)) {
      throw const CoreFailure(CoreFailure.invalid, 'a card needs a name and a number or a cardholder');
    }
    final brand = _line(input['brand'], 'the brand');
    // A code and a PIN are kept as typed
    final code = asString(input['code']);
    final pin = asString(input['pin']);
    if (code.length > 16 || pin.length > 16) throw const CoreFailure(CoreFailure.invalid, 'a code or PIN is too long');
    final expMonth = _month(input['expMonth'], 'the expiry month');
    final expYear = _year(input['expYear'], 'the expiry year');
    final fromMonth = _month(input['validFromMonth'], 'the valid-from month');
    final fromYear = _year(input['validFromYear'], 'the valid-from year');
    final note = _line(input['note'], 'the note');
    final before = id == null ? null : _find(_lists.cards, id, 'card');
    // Looked at once now, so a bad row is refused before anything is written; an edit is made on the card the write holds
    final fields = applyFields(before?.fields ?? const [], input['fields']);
    final refs = input.containsKey('links') ? parseRefs(input['links']) : null;
    final PaymentCard saved;
    if (id == null) {
      final tags = asStrings(input['tags']);
      saved = PaymentCard(
        id: newUuid(),
        fields: fields,
        name: name,
        cardholder: holder,
        number: digits.isEmpty ? null : digits,
        brand: brand,
        expMonth: expMonth,
        expYear: expYear,
        code: code.isEmpty ? null : code,
        pin: pin.isEmpty ? null : pin,
        validFromMonth: fromMonth,
        validFromYear: fromYear,
        note: note,
        tags: tags == null || tags.isEmpty ? null : tags,
        pinned: input['pinned'] == true ? true : null,
        source: input['fromAutofill'] == true ? 'autofill' : null,
        addedAt: nowMs,
      );
      await _saveCards((held) => [...held, saved]);
    } else {
      final current = _find(_lists.cards, id, 'card');
      editGuard?.call(current.spaceId, id);
      // The members another write changes meanwhile (links, custom fields, files, a source) are the held card's, never the copy read above
      PaymentCard edit(PaymentCard held) {
        final heldFields = applyFields(held.fields, input['fields']);
        return held.copyWith(
          name: name,
          cardholder: holder ?? unset,
          number: digits.isEmpty ? unset : digits,
          brand: brand ?? unset,
          expMonth: expMonth ?? unset,
          expYear: expYear ?? unset,
          code: code.isEmpty ? unset : code,
          pin: pin.isEmpty ? unset : pin,
          validFromMonth: fromMonth ?? unset,
          validFromYear: fromYear ?? unset,
          note: note ?? unset,
          tags: _tagChange(input['tags']),
          pinned: _pinChange(input['pinned']),
          fields: identical(heldFields, held.fields) ? null : heldFields,
        );
      }

      saved = edit(current);
      await _saveCards((held) => [for (final card in held) card.id == id ? edit(card) : card]);
    }
    final failures = refs == null ? const <String>[] : await VaultLinks(this).setLinksOf('card', saved.id, refs);
    final index = _lists.cards.indexWhere((card) => card.id == saved.id);
    return {..._cardView(_lists.cards[index], index, platform.clock()), if (failures.isNotEmpty) 'linkFailures': failures};
  }

  Future<void> deleteCard(String id) async {
    requireSession();
    editGuard?.call(_find(_lists.cards, id, 'card').spaceId, id);
    // The links to the card go in the same write, worked out from the lists the write holds
    await saveChanged((held) {
      final removed = held.cards.where((card) => card.id == id).firstOrNull;
      return removed == null ? held : VaultLinks(this).withoutEntry(held, removed);
    });
  }

  // ─── Identities ───────────────────────────────────────────────────────

  Future<void> _saveIdentities(List<Identity> Function(List<Identity> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.identities), _lists.identities, now: nowMs);
    await vault.saveIdentities(stamped, session);
    if (identical(_session, session)) _changed(_withItems(identities: stamped));
    await store.flush();
  });

  /// The identities: details and address, and each document without its number.
  List<Map<String, Object?>> identities() {
    requireSession();
    final now = platform.clock();
    return [for (final (i, identity) in _lists.identities.indexed) _identityView(identity, i, now)];
  }

  Map<String, Object?> _identityView(Identity identity, int order, DateTime now) => _noted(
    identityView(identity, order: order, now: now, fields: fieldViews(identity.fields), links: linkCount(identity.id)),
    identity.spaceId,
    identity.id,
  );

  /// An identity whole: the number of each document too.
  Map<String, Object?> revealIdentity(String id) {
    requireSession();
    final identity = _find(_lists.identities, id, 'identity');
    return _noted(
      identityFull(
        identity,
        order: _lists.identities.indexOf(identity),
        now: platform.clock(),
        fields: fieldViews(identity.fields),
        links: linkCount(identity.id),
      ),
      identity.spaceId,
      identity.id,
    );
  }

  /// The address [input] holds, with the keys of a later version that [current] had kept; null when nothing is left.
  IdentityAddress? _addressOf(Object? input, IdentityAddress? current) {
    if (input == null) return current;
    if (input is! Map<String, Object?>) throw const CoreFailure(CoreFailure.invalid, 'the address is not an object');
    final lines = [
      for (final line in asStrings(input['lines']) ?? const <String>[])
        if (line.trim().isNotEmpty) line.trim(),
    ];
    if (lines.length > identityAddressLines) throw const CoreFailure(CoreFailure.invalid, 'an address has at most 3 lines');
    for (final line in lines) {
      if (line.length > _fieldLimit) throw const CoreFailure(CoreFailure.invalid, 'an address line is too long');
    }
    final address = IdentityAddress(
      lines: lines.isEmpty ? null : lines,
      city: _line(input['city'], 'the city'),
      region: _line(input['region'], 'the region'),
      postalCode: _line(input['postalCode'], 'the postal code'),
      country: _line(input['country'], 'the country'),
      extra: current?.extra ?? const {},
    );
    return address.isEmpty ? null : address;
  }

  /// The documents [input] holds: one that names an existing document keeps its unknown keys, a new one gets an id; an
  /// existing document the input leaves out is removed. Null input keeps the documents as they are.
  List<IdentityDocument>? _documentsOf(Object? input, List<IdentityDocument>? current) {
    if (input == null) return current;
    if (input is! List<Object?>) throw const CoreFailure(CoreFailure.invalid, 'the documents are not a list');
    if (input.length > 50) throw const CoreFailure(CoreFailure.invalid, 'too many documents');
    final held = {for (final document in current ?? const <IdentityDocument>[]) document.id: document};
    final documents = <IdentityDocument>[];
    for (final item in input) {
      if (item is! Map<String, Object?>) throw const CoreFailure(CoreFailure.invalid, 'a document is not an object');
      final number = asString(item['number']).trim();
      if (number.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'a document needs a number');
      if (number.length > _fieldLimit) throw const CoreFailure(CoreFailure.invalid, 'a document number is too long');
      final type = _line(item['type'], 'the document type') ?? IdentityDocumentType.other.wire;
      final country = _line(item['issuingCountry'], 'the issuing country');
      final authority = _line(item['issuingAuthority'], 'the issuing authority');
      final issued = _date(item['issuedOn'], 'the issue date');
      final expires = _date(item['expiresOn'], 'the expiry date');
      final existing = held[asString(item['id'])];
      documents.add(
        existing == null
            ? IdentityDocument(
                id: newUuid(),
                type: type,
                number: number,
                issuingCountry: country,
                issuingAuthority: authority,
                issuedOn: issued,
                expiresOn: expires,
              )
            : existing.copyWith(
                type: type,
                number: number,
                issuingCountry: country ?? unset,
                issuingAuthority: authority ?? unset,
                issuedOn: issued ?? unset,
                expiresOn: expires ?? unset,
              ),
      );
    }
    return documents;
  }

  /// Saves an identity: a new one when [id] is null, else the fields the browser edits. It needs a name and one more detail,
  /// as in the app.
  Future<Map<String, Object?>> saveIdentity(String? id, Map<String, Object?> input) async {
    requireSession();
    final name = _line(input['name'], 'the name');
    if (name == null) throw const CoreFailure(CoreFailure.invalid, 'an identity needs a name');
    final title = _line(input['title'], 'the title');
    final given = _line(input['givenName'], 'the given name');
    final middle = _line(input['middleName'], 'the middle name');
    final family = _line(input['familyName'], 'the family name');
    final company = _line(input['company'], 'the company');
    final email = _line(input['email'], 'the email');
    final phone = _line(input['phone'], 'the phone');
    final username = _line(input['username'], 'the username');
    final birth = _date(input['birthDate'], 'the birth date');
    final note = _line(input['note'], 'the note');
    final current = id == null ? null : _find(_lists.identities, id, 'identity');
    if (current != null) editGuard?.call(current.spaceId, current.id);
    final refs = input.containsKey('links') ? parseRefs(input['links']) : null;
    final Identity saved;
    if (current == null) {
      final address = _addressOf(input['address'], null);
      final documents = _documentsOf(input['documents'], null);
      final fields = applyFields(const [], input['fields']);
      final tags = asStrings(input['tags']);
      saved = Identity(
        id: newUuid(),
        name: name,
        title: title,
        givenName: given,
        middleName: middle,
        familyName: family,
        company: company,
        email: email,
        phone: phone,
        username: username,
        birthDate: birth,
        address: address,
        documents: documents == null || documents.isEmpty ? null : documents,
        fields: fields,
        note: note,
        tags: tags == null || tags.isEmpty ? null : tags,
        pinned: input['pinned'] == true ? true : null,
        addedAt: nowMs,
      );
      if (!saved.isComplete) throw const CoreFailure(CoreFailure.invalid, 'an identity needs a detail besides its name');
      await _saveIdentities((held) => [...held, saved]);
    } else {
      // The members a run, a link or an upload writes meanwhile (links, custom fields, the address keys of a later version) are the held
      // identity's, never the copy read above
      Identity edit(Identity held) {
        final address = _addressOf(input['address'], held.address);
        final documents = _documentsOf(input['documents'], held.documents);
        final fields = applyFields(held.fields, input['fields']);
        final next = held.copyWith(
          name: name,
          title: title ?? unset,
          givenName: given ?? unset,
          middleName: middle ?? unset,
          familyName: family ?? unset,
          company: company ?? unset,
          email: email ?? unset,
          phone: phone ?? unset,
          username: username ?? unset,
          birthDate: birth ?? unset,
          address: address ?? unset,
          documents: documents == null || documents.isEmpty ? unset : documents,
          note: note ?? unset,
          tags: _tagChange(input['tags']),
          pinned: _pinChange(input['pinned']),
          fields: identical(fields, held.fields) ? null : fields,
        );
        if (!next.isComplete) throw const CoreFailure(CoreFailure.invalid, 'an identity needs a detail besides its name');
        return next;
      }

      // Looked at once now, so a bad input is refused before anything is written
      saved = edit(current);
      await _saveIdentities((held) => [for (final identity in held) identity.id == id ? edit(identity) : identity]);
    }
    final failures = refs == null ? const <String>[] : await VaultLinks(this).setLinksOf('identity', saved.id, refs);
    final index = _lists.identities.indexWhere((identity) => identity.id == saved.id);
    return {..._identityView(_lists.identities[index], index, platform.clock()), if (failures.isNotEmpty) 'linkFailures': failures};
  }

  Future<void> deleteIdentity(String id) async {
    requireSession();
    editGuard?.call(_find(_lists.identities, id, 'identity').spaceId, id);
    // The links to the identity go in the same write, worked out from the lists the write holds
    await saveChanged((held) {
      final removed = held.identities.where((identity) => identity.id == id).firstOrNull;
      return removed == null ? held : VaultLinks(this).withoutEntry(held, removed);
    });
  }
}
