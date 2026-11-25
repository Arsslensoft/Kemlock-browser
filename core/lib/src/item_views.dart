// The vault's notes, cards and identities as the TypeScript side sees them (`NoteView`, `CardView`, `IdentityView` and their
// full forms in src/shared/api.ts): plain JSON. A list view holds no secret: a note's title but not its text, a card's last
// four digits but not its number, security code or PIN, an identity's details but not its document numbers. The reveal forms
// are what `revealNote`, `revealCard` and `revealIdentity` answer, and only they carry the secrets.
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';

/// [note] as a `NoteView`: its title, never its text. [order] is its place in the vault's list.
Map<String, Object?> noteView(SecureNote note, {required int order}) => {
  'id': note.id,
  'title': note.title,
  'tags': note.tags ?? const <String>[],
  'order': order,
  'pinned': note.isPinned,
  'files': note.files.length,
  'changedAt': note.changedAt,
  if (note.piv != null) 'keyNote': true,
};

/// [note] as a `NoteFull`: the text, and the files it holds by name (their keys never leave the core).
Map<String, Object?> noteFull(SecureNote note, {required int order}) => {
  ...noteView(note, order: order),
  'text': note.text,
  'attachments': [
    for (final file in note.files) {'name': file.name, 'size': file.size, 'type': ?file.type},
  ],
};

/// [card] as a `CardView`: no number, security code or PIN, only the last four digits and whether each is there.
Map<String, Object?> cardView(PaymentCard card, {required int order, required DateTime now}) => {
  'id': card.id,
  'name': card.name,
  'cardholder': ?_text(card.cardholder),
  'brand': ?_text(card.brand),
  'lastFour': ?card.lastFour,
  'expMonth': ?card.expMonth,
  'expYear': ?card.expYear,
  'validFromMonth': ?card.validFromMonth,
  'validFromYear': ?card.validFromYear,
  'expired': card.isExpired(now),
  'hasNumber': card.number?.isNotEmpty ?? false,
  'hasCode': card.code?.isNotEmpty ?? false,
  'hasPin': card.pin?.isNotEmpty ?? false,
  'note': ?_text(card.note),
  'tags': card.tags ?? const <String>[],
  'order': order,
  'pinned': card.isPinned,
  'changedAt': card.changedAt,
};

/// [card] as a `CardFull`: its view and the number, security code and PIN.
Map<String, Object?> cardFull(PaymentCard card, {required int order, required DateTime now}) => {
  ...cardView(card, order: order, now: now),
  'number': card.number ?? '',
  'code': card.code ?? '',
  'pin': card.pin ?? '',
};

Map<String, Object?> _address(IdentityAddress address) => {
  'lines': address.lines ?? const <String>[],
  'city': ?_text(address.city),
  'region': ?_text(address.region),
  'postalCode': ?_text(address.postalCode),
  'country': ?_text(address.country),
};

Map<String, Object?> _document(IdentityDocument document, DateTime now, {required bool withNumber}) => {
  'id': document.id,
  'type': document.type,
  'issuingCountry': ?_text(document.issuingCountry),
  'issuingAuthority': ?_text(document.issuingAuthority),
  'issuedOn': ?_text(document.issuedOn),
  'expiresOn': ?_text(document.expiresOn),
  'expired': document.isExpired(now),
  'hasNumber': document.number.isNotEmpty,
  if (withNumber) 'number': document.number,
};

Map<String, Object?> _identity(Identity identity, {required int order, required DateTime now, required bool withNumbers}) => {
  'id': identity.id,
  'name': identity.name,
  'title': ?_text(identity.title),
  'givenName': ?_text(identity.givenName),
  'middleName': ?_text(identity.middleName),
  'familyName': ?_text(identity.familyName),
  'fullName': ?identity.fullName,
  'company': ?_text(identity.company),
  'email': ?_text(identity.email),
  'phone': ?_text(identity.phone),
  'username': ?_text(identity.username),
  'birthDate': ?_text(identity.birthDate),
  if (identity.address case final address? when !address.isEmpty) 'address': _address(address),
  'documents': [for (final document in identity.documents ?? const <IdentityDocument>[]) _document(document, now, withNumber: withNumbers)],
  'note': ?_text(identity.note),
  'tags': identity.tags ?? const <String>[],
  'order': order,
  'pinned': identity.isPinned,
  'changedAt': identity.changedAt,
};

/// [identity] as an `IdentityView`: its details and address, its documents without their numbers.
Map<String, Object?> identityView(Identity identity, {required int order, required DateTime now}) =>
    _identity(identity, order: order, now: now, withNumbers: false);

/// [identity] as an `IdentityFull`: its view with the number of each document.
Map<String, Object?> identityFull(Identity identity, {required int order, required DateTime now}) =>
    _identity(identity, order: order, now: now, withNumbers: true);

/// [value] unless it is empty or blank, so the views never carry an empty string for a field that isn't set.
String? _text(String? value) => value == null || value.trim().isEmpty ? null : value;
