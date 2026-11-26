// Import and export in the browser (the transfer page's side of the core): a file or QR images opened, previewed and merged into the
// vault exactly as the app's import does (Kemlock-core's import_merge.dart), and the vault's items written as a file the page
// downloads or as QR codes it draws. The formats, the readers and the merge are Kemlock-core's; this holds what a page can't: the
// opened file between its steps (a token names it), the vault's lists to merge into, and the password check an export asks for.
//
// What reaches the page is what it shows (names, counts, reasons); a file's items stay here until they are merged. An export's
// text goes to the page, which is the extension's own, and nowhere else.
import 'dart:convert';
import 'dart:typed_data';

import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/core/time.dart';
import 'package:kemlock_core/crypto/account/encoding.dart' show wipe;
import 'package:kemlock_core/crypto/aes_gcm.dart' show AesGcmAuthError;
import 'package:kemlock_core/crypto/keys/keys.dart' as crypto;
import 'package:kemlock_core/features/contacts/contact_key_info.dart';
import 'package:kemlock_core/features/duplicates/duplicate_sites.dart' show siteResolver;
import 'package:kemlock_core/features/export/credential_export_plan.dart';
import 'package:kemlock_core/features/export/csv_export.dart';
import 'package:kemlock_core/features/export/export_scope.dart';
import 'package:kemlock_core/features/import/formats/cxf_writer.dart';
import 'package:kemlock_core/features/import/formats/google_migration.dart';
import 'package:kemlock_core/features/import/import_destinations.dart';
import 'package:kemlock_core/features/import/import_file.dart';
import 'package:kemlock_core/features/import/import_merge.dart';
import 'package:kemlock_core/features/import/importers.dart' show ImportSource;
import 'package:kemlock_core/features/keys/key_bridge.dart' show combinedPgpKey, keyIdentity;
import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists, stampChanged;
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/contact.dart';
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/json.dart' show unset;
import 'package:kemlock_core/models/key_account.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_entry.dart' show VaultEntry;
import 'package:kemlock_core/models/vault_key.dart';
import 'package:kemlock_core/vault/qr_transfer.dart';
import 'package:kemlock_core/vault/vault_export.dart';

import 'account/kit_pieces.dart';
import 'failure.dart';
import 'qr.dart';
import 'vault_service.dart';

/// The most a file to import may be, as base64 text: 40 MiB of file, which is under the 64 MiB a message may be in Chrome.
const maxImportFile = 54 * 1024 * 1024;

/// The most names a preview lists of each kind.
const _sampleSize = 5;

/// The most skipped items a preview lists by name.
const _skipListSize = 50;

/// An export password's least length, as the app asks.
const minExportPassword = 8;

/// What an opened file is held as between its steps.
class _Opened {
  _Opened({required this.format, required this.encrypted, this.text, this.detected, this.qrTexts, this.exporter, this.archiveFiles = 0});

  /// The format's name for the page: `kemlock`, `google`, `aegis`, `twoFas`, `bitwarden`, `uris`, `cxf`, `csv`, or a QR transfer.
  final String format;
  final bool encrypted;

  /// The file's text, until it has opened (a wrong password leaves it for another try).
  String? text;
  final DetectedImport? detected;

  /// The text of each QR code, for images.
  final List<String>? qrTexts;
  final String? exporter;

  /// The attached files an archive holds.
  final int archiveFiles;

  /// What it holds, once it has opened.
  ImportPreview? preview;

  /// Another app's export, whose backup services a replace leaves alone: not Kemlock's own file, and of the QR codes only links and Google's
  /// (Kemlock's transfer carries its backup services, as the app's QR import treats it).
  bool get foreign => qrTexts != null ? format == 'qr' : (detected?.foreign ?? false);
  bool get cxf => detected?.source == ImportSource.cxf;
}

/// What an import would add to the vault, by kind, after the person's choices.
class _Merged {
  const _Merged({
    required this.accounts,
    required this.services,
    required this.newAccounts,
    required this.newServices,
    required this.passkeys,
    required this.keys,
    required this.notes,
    required this.keyAccounts,
    required this.contacts,
    required this.logins,
    required this.cards,
    required this.identities,
    required this.held,
  });

  /// The vault's accounts and services after the import (merge keeps its own and adds; replace takes the import's).
  final List<OtpAccount> accounts;
  final List<BackupService> services;
  final int newAccounts;
  final int newServices;

  /// What each other kind adds (the keys also those to combine with a copy the vault holds).
  final List<Passkey> passkeys;
  final List<VaultKey> keys;
  final List<SecureNote> notes;
  final List<KeyAccount> keyAccounts;
  final List<Contact> contacts;
  final List<Login> logins;
  final List<PaymentCard> cards;
  final List<Identity> identities;

  /// What the file held for the vault, by kind.
  final Map<String, int> held;

  Map<String, int> get adding => {
    'codes': newAccounts,
    'backupServices': newServices,
    'logins': logins.length,
    'notes': notes.length,
    'passkeys': passkeys.length,
    'keys': keys.length,
    'cards': cards.length,
    'identities': identities.length,
    'contacts': contacts.length,
    'keyAccounts': keyAccounts.length,
  };

  int get total => adding.values.fold(0, (sum, count) => sum + count);
}

Map<String, int> _held(ImportPreview preview) => {
  'codes': preview.accounts.length,
  'backupServices': preview.backupServices.length,
  'logins': preview.logins.length,
  'notes': preview.notes.length,
  'passkeys': preview.passkeys.length,
  'keys': preview.keys.length,
  'cards': preview.cards.length,
  'identities': preview.identities.length,
  'contacts': preview.contacts.length,
  'keyAccounts': preview.keyAccounts.length,
};

/// An import's problem as the word the page reads: `importBadPassword`, `importUnsupported`, …
CoreFailure _failure(ImportReadError error) {
  final name = error.problem.name;
  return CoreFailure('import${name[0].toUpperCase()}${name.substring(1)}');
}

/// The browser's import and export.
class TransferService {
  TransferService(this.vault);

  final VaultService vault;

  /// The files opened and not yet merged or cancelled; a lock drops them.
  final _opened = <String, _Opened>{};

  /// The methods the TypeScript `CoreApi` has for this, by name.
  static const methods = {
    'transferOpen',
    'transferOpenQr',
    'transferPreview',
    'transferPreviewKit',
    'transferPlan',
    'transferApply',
    'transferCancel',
    'transferExportInfo',
    'transferExport',
    'transferExportQr',
  };

  /// Forgets every file opened: the vault locked or went.
  void forget() => _opened.clear();

  String _string(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  String? _optionalString(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value == null) return null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  Map<String, Object?> _options(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value == null) return const {};
    if (value is! Map || value.keys.any((key) => key is! String)) {
      throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not an object');
    }
    return value.cast<String, Object?>();
  }

  /// Answers [method] with [args]; the result is JSON.
  Future<Object?> call(String method, List<Object?> args) async {
    switch (method) {
      case 'transferOpen':
        return openFile(_string(args, 0));
      case 'transferOpenQr':
        final images = args.isNotEmpty && args[0] is List<Object?> ? (args[0]! as List<Object?>).whereType<String>().toList() : <String>[];
        return openQr(images);
      case 'transferPreview':
        return preview(_string(args, 0), _optionalString(args, 1));
      case 'transferPreviewKit':
        final pieces = args.length > 1 ? args[1] : null;
        if (pieces is! List<Object?> || pieces.length > maxPieces || pieces.any((piece) => piece is! String)) {
          throw const CoreFailure(CoreFailure.invalid, 'argument 2 is not a list of pieces');
        }
        return previewWithKit(_string(args, 0), pieces.cast<String>());
      case 'transferPlan':
        return plan(_string(args, 0), _options(args, 1));
      case 'transferApply':
        return apply(_string(args, 0), _options(args, 1));
      case 'transferCancel':
        _opened.remove(_string(args, 0));
        return null;
      case 'transferExportInfo':
        return exportInfo();
      case 'transferExport':
        return export(_options(args, 0));
      case 'transferExportQr':
        return exportQr(_options(args, 0));
    }
    throw CoreFailure(CoreFailure.invalid, 'no such method: $method');
  }

  // ─── Import ───────────────────────────────────────────────────────────

  _Opened _get(String token) => _opened[token] ?? (throw const CoreFailure(CoreFailure.notFound, 'no such file is open'));

  String _keep(_Opened opened) {
    // One file at a time: opening another drops the last
    _opened.clear();
    final token = newUuid();
    _opened[token] = opened;
    return token;
  }

  Map<String, Object?> _opening(String token, _Opened opened) => {
    'token': token,
    'format': opened.format,
    'encrypted': opened.encrypted,
    'exporter': ?opened.exporter,
    'archiveFiles': opened.archiveFiles,
  };

  /// A file's [data] (base64) opened as far as telling what it is, without its password.
  Map<String, Object?> openFile(String data) {
    vault.requireSession();
    if (data.length > maxImportFile) throw const CoreFailure('importTooLarge');
    final Uint8List bytes;
    try {
      bytes = base64.decode(data);
    } on FormatException {
      throw const CoreFailure(CoreFailure.invalid, 'the file is not base64');
    }
    try {
      final opened = openImportFile(bytes);
      final detected = detectImport(opened.text, archive: opened.archive != null);
      if (detected == null) throw const ImportReadError(ImportProblem.unsupported);
      final held = _Opened(
        format: detected.foreign ? detected.source!.name : 'kemlock',
        encrypted: detected.encrypted,
        text: opened.text,
        detected: detected,
        exporter: detected.exporter,
        archiveFiles: opened.archive?.files.length ?? 0,
      );
      return _opening(_keep(held), held);
    } on ImportReadError catch (error) {
      throw _failure(error);
    }
  }

  /// QR [images] (data URLs), each read for its code: what they hold opened as far as telling what it is.
  Future<Map<String, Object?>> openQr(List<String> images) async {
    vault.requireSession();
    final texts = <String>[];
    var unread = 0;
    for (final image in images) {
      final text = await vault.readQr(image);
      if (text == null) {
        unread++;
      } else if (!texts.contains(text)) {
        texts.add(text);
      }
    }
    final kind = detectQr(texts);
    if (kind == QrKind.none) throw const CoreFailure('importUnsupported');
    final held = _Opened(format: kind == QrKind.links ? 'qr' : 'kemlockQr', encrypted: kind == QrKind.transfer, qrTexts: texts);
    return {..._opening(_keep(held), held), 'codesRead': texts.length, 'imagesUnread': unread};
  }

  /// The file opened with [password], and what it holds, by kind, with what it left out.
  Future<Map<String, Object?>> preview(String token, String? password) async {
    vault.requireSession();
    final opened = _get(token);
    final ImportPreview read;
    try {
      final texts = opened.qrTexts;
      read = texts != null
          ? await readQrImport(texts, password: password, now: vault.nowMs)
          : await readImport(opened.text!, opened.detected!, password: password, now: vault.nowMs);
    } on ImportReadError catch (error) {
      throw _failure(error);
    }
    return _previewOf(opened, read);
  }

  /// An encrypted Kemlock export opened with pieces of the Recovery Kit its vault made, instead of the export's password: [pieces] are
  /// what the person typed (two of the account's three), read, put together and checked against the kit the file names, and the key
  /// they rebuild opens the file's wrap and is wiped as soon as it has. A file that holds no kit wrap says `importNoKit`, pieces of
  /// another kit `importKitOtherKit`, a piece with a typo `importKitChecksum`, and pieces that open nothing `importKitWrong`.
  Future<Map<String, Object?>> previewWithKit(String token, List<String> pieces) async {
    vault.requireSession();
    final opened = _get(token);
    final text = opened.text;
    final detected = opened.detected;
    // Only Kemlock's own encrypted file has a kit wrap: another app's export and the QR codes have none
    if (text == null || opened.qrTexts != null || detected == null || detected.foreign || !opened.encrypted) {
      throw const CoreFailure('importNoKit');
    }
    final kit = exportRecoveryKit(text);
    if (kit == null) throw const CoreFailure('importNoKit');
    final Uint8List key;
    try {
      var collected = <KitPiece>[];
      for (final piece in pieces) {
        collected = addPiece(collected, parsePiece(piece));
      }
      // A piece of another kit than the file's
      if (collected.any((piece) => piece.kitId != kit.kitId)) throw const PieceError(PieceProblem.otherKit);
      key = rebuildKey(collected);
    } on PieceError catch (error) {
      final name = error.problem.name;
      throw CoreFailure('importKit${name[0].toUpperCase()}${name.substring(1)}');
    }
    final ImportPreview read;
    try {
      read = ImportPreview.of(await importVaultWithRecoveryKey(text, key));
    } on AesGcmAuthError {
      // The pieces are of the right kit and open nothing: a kit the file was not made with, or a file changed since
      throw const CoreFailure('importKitWrong');
    } on ExportFileError {
      throw const CoreFailure('importNoKit');
    } on FormatException {
      throw const CoreFailure('importCorrupt');
    } finally {
      // The kit's key is wiped as soon as the file has opened with it, or failed to
      wipe(key);
    }
    return _previewOf(opened, read);
  }

  /// What [read], the file [opened] held, shows of it: the preview the page gets, and the items kept here for the merge.
  Map<String, Object?> _previewOf(_Opened opened, ImportPreview read) {
    final personal = _personal(read);
    opened.preview = personal.preview;
    // The text is no longer needed, and a plain file's secrets are not kept longer than they are read
    opened.text = null;
    final unitOf = read.unitOf;
    return {
      'format': opened.format,
      'exporter': ?opened.exporter,
      'held': _held(read),
      'skipped': read.skipped,
      'skips': [
        for (final skip in read.skips.take(_skipListSize)) {'title': skip.title, 'reason': skip.reason.name, 'detail': ?skip.detail},
      ],
      'notices': [
        for (final notice in read.notices.take(_skipListSize)) {'title': notice.title, 'reason': notice.reason.name},
      ],
      if (read.cuts != null && read.cuts!.any)
        'cuts': {
          'items': read.cuts!.itemsLeftOut,
          'credentials': read.cuts!.credentialsLeftOut,
          'urls': read.cuts!.urlsLeftOut,
          'collections': read.cuts!.collectionsTooDeep,
          'values': read.cuts!.valuesTooLong,
        },
      'units': [
        for (final unit in read.units)
          {'id': unit.id, 'name': unit.name, 'shared': unit.shared, 'count': unitOf.values.where((id) => id == unit.id).length},
      ],
      'samples': _samples(read),
      'attachedFiles': read.notes.fold<int>(0, (sum, note) => sum + note.files.length),
      'spaceItems': personal.spaceItems,
    };
  }

  /// [read] with every item as the person's own (the browser has no destination to give an item of a shared space, which would be
  /// stranded under a space it is not in) and every note without the files it names (the browser keeps no attachments), and how many items
  /// came from a space.
  ({ImportPreview preview, int spaceItems}) _personal(ImportPreview read) {
    var spaceItems = 0;
    T own<T>(T item, String? spaceId, T Function() copy) {
      if (spaceId == null) return item;
      if (spaceId.isNotEmpty) spaceItems++;
      return copy();
    }

    final preview = ImportPreview(
      accounts: [for (final item in read.accounts) own(item, item.spaceId, () => item.copyWith(spaceId: unset))],
      backupServices: [for (final item in read.backupServices) own(item, item.spaceId, () => item.copyWith(spaceId: unset))],
      skipped: read.skipped,
      passkeys: read.passkeys,
      keys: [for (final item in read.keys) own(item, item.spaceId, () => item.copyWith(spaceId: unset))],
      notes: [
        for (final item in read.notes)
          // A note with files is changed even when it is the person's own (an empty id counts for no space)
          own(item, item.spaceId ?? (item.files.isEmpty ? null : ''), () => item.copyWith(spaceId: unset, attachments: unset)),
      ],
      keyAccounts: read.keyAccounts,
      contacts: read.contacts,
      logins: [for (final item in read.logins) own(item, item.spaceId, () => item.copyWith(spaceId: unset))],
      cards: [for (final item in read.cards) own(item, item.spaceId, () => item.copyWith(spaceId: unset))],
      identities: [for (final item in read.identities) own(item, item.spaceId, () => item.copyWith(spaceId: unset))],
      skips: read.skips,
      notices: read.notices,
      units: read.units,
      unitOf: read.unitOf,
      cuts: read.cuts,
    );
    return (preview: preview, spaceItems: spaceItems);
  }

  List<Map<String, Object?>> _samples(ImportPreview read) => [
    for (final account in read.accounts.take(_sampleSize))
      {
        'kind': 'code',
        'name': account.issuer.isEmpty ? account.label : account.issuer,
        'detail': account.issuer.isEmpty ? '' : account.label,
      },
    for (final login in read.logins.take(_sampleSize)) {'kind': 'login', 'name': login.name, 'detail': login.username ?? ''},
    for (final service in read.backupServices.take(_sampleSize)) {'kind': 'backupServices', 'name': service.serviceName, 'detail': ''},
    for (final note in read.notes.take(_sampleSize)) {'kind': 'note', 'name': note.title, 'detail': ''},
    for (final passkey in read.passkeys.take(_sampleSize)) {'kind': 'passkey', 'name': passkey.displayName, 'detail': ''},
    for (final key in read.keys.take(_sampleSize)) {'kind': 'key', 'name': key.name, 'detail': ''},
    for (final card in read.cards.take(_sampleSize)) {'kind': 'card', 'name': card.name, 'detail': ''},
    for (final identity in read.identities.take(_sampleSize)) {'kind': 'identity', 'name': identity.name, 'detail': ''},
  ];

  /// What the file would add to the vault under [options] (`mode`: `merge` or `replace`; `excluded`: the places left out;
  /// `keepChecks`), the app's import merge applied to the open vault's lists, and nothing saved.
  Future<_Merged> _merge(_Opened opened, Map<String, Object?> options) async {
    final preview = opened.preview ?? (throw const CoreFailure(CoreFailure.notFound, 'the file is not read yet'));
    final mode = options['mode'] == 'replace' ? ImportMode.replace : ImportMode.merge;
    final excluded = {
      for (final id in (options['excluded'] is List<Object?> ? options['excluded']! as List<Object?> : const <Object?>[]))
        if (id is String) id,
    };
    // A place the person leaves out goes to a space that is never made: the browser has the vault only for a destination
    const vaultPlace = ImportDestination.vault();
    final destinations = ImportDestinations(
      byUnit: {for (final unit in preview.units) unit.id: excluded.contains(unit.id) ? const ImportDestination.newSpace('') : vaultPlace},
    );
    final placed = placeImport(preview, destinations).where((part) => part.destination == vaultPlace).map((part) => part.preview);
    final part = placed.firstOrNull ?? const ImportPreview(accounts: [], backupServices: []);
    final lists = vault.lists;
    final sites = siteResolver(suffixes: vault.matcher.suffixes);
    final merged = mergeImport(
      part,
      accounts: lists.accounts,
      services: lists.backupServices,
      mode: mode,
      // Other apps' backups hold no backup codes, so replacing must not wipe ours
      keepServices: opened.foreign,
    );
    final counts = countImport(part, accounts: lists.accounts, services: lists.backupServices, mode: mode);
    final keepChecks = options['keepChecks'] == true;
    // A file is outside input: each key it brings is read and checked again before it is kept, and comes in not checked
    // unless the person kept the checks the file records
    final contacts = [
      for (final contact in await soundContacts(newContacts(part, lists.contacts), crypto.readPublicKeys))
        keepChecks ? contact : contact.unchecked(),
    ];
    return _Merged(
      accounts: merged.accounts,
      services: merged.backupServices,
      newAccounts: counts.newAccounts,
      newServices: counts.newServices,
      passkeys: newPasskeys(part, lists.passkeys),
      keys: [...newKeys(part, lists.keys), ...keysToCombine(part, lists.keys)],
      notes: newNotes(part, lists.notes),
      keyAccounts: newKeyAccounts(part, lists.keyAccounts),
      contacts: contacts,
      logins: newLogins(part, lists.logins, accounts: lists.accounts, mode: mode, sites: sites),
      // A card from another app matches on its number and expiry too, as the duplicate cleaner shows them
      cards: opened.cxf ? planCards(part, lists.cards).adds : newCards(part, lists.cards),
      identities: newIdentities(part, lists.identities),
      held: _held(part),
    );
  }

  /// What the file would add under [options], and what the vault holds already, by kind: the preview's numbers.
  Future<Map<String, Object?>> plan(String token, Map<String, Object?> options) async {
    vault.requireSession();
    final opened = _get(token);
    final merged = await _merge(opened, options);
    final adding = merged.adding;
    final replace = options['mode'] == 'replace';
    // A file of codes can replace the vault's, and only the codes that go in count: a place left out holds none
    final hasCodes = (merged.held['codes'] ?? 0) + (merged.held['backupServices'] ?? 0) > 0;
    return {
      'adding': adding,
      'held': merged.held,
      'duplicates': {
        for (final MapEntry(:key, :value) in merged.held.entries)
          key: replace && key == 'codes' ? 0 : (value - (adding[key] ?? 0)).clamp(0, value),
      },
      'canImport': replace ? hasCodes : merged.total > 0,
      'contacts': [
        for (final contact in merged.contacts)
          () {
            final info = contactKeyInfo(contact);
            final fingerprint = info?.primary.fingerprintHex;
            return {
              'name': contact.name,
              'fingerprint': ?fingerprint,
              'checkedInFile': contact.checkedFingerprint != null && contact.checkedFingerprint!.toUpperCase() == fingerprint,
            };
          }(),
      ],
    };
  }

  /// Merges the file into the vault under [options], and saves it: counted as a change made here, so sync carries it.
  Future<Map<String, Object?>> apply(String token, Map<String, Object?> options) async {
    vault.requireSession();
    final opened = _get(token);
    final merged = await _merge(opened, options);
    final replace = options['mode'] == 'replace';
    final hasCodes = (merged.held['codes'] ?? 0) + (merged.held['backupServices'] ?? 0) > 0;
    if (replace ? !hasCodes : merged.total == 0) throw const CoreFailure('importNothing');
    final now = vault.nowMs;
    // What the vault held when the file was read: an item added since (by a save or a sync that went first) is not the file's to take away
    final before = vault.lists;
    final keyPlan = await _planKeys(before.keys, merged.keys);

    List<T> stamped<T extends VaultEntry<T>>(List<T> next, List<T> was) => stampChanged(next, was, now: now);

    /// The file's own list, with what the vault gained since it was read kept.
    List<T> keepingNew<T extends VaultEntry<T>>(List<T> theirs, List<T> was, List<T> held) {
      final seen = {for (final item in was) item.id, for (final item in theirs) item.id};
      return [
        ...theirs,
        for (final item in held)
          if (!seen.contains(item.id)) item,
      ];
    }

    var skipped = 0;
    // Built on the lists the write holds once it has the lock, so that what a change made meanwhile is kept, and what replacing would
    // change or take away in a space this account may not edit is left as it is and counted, rather than the whole import refused (the
    // guard itself stays as it was)
    await vault.saveImported((held) {
      final heldKeys = {for (final key in held.keys) keyIdentity(key)};
      final keys = [
        for (final key in held.keys) keyPlan.combined[keyIdentity(key)] ?? key,
        for (final key in keyPlan.added)
          if (!heldKeys.contains(keyIdentity(key))) key,
      ];
      final passkeyIds = {for (final passkey in held.passkeys) passkey.credentialId};
      final noteIds = {for (final note in held.notes) note.id};
      final contactIds = {for (final contact in held.contacts) contact.id};
      final loginIds = {for (final login in held.logins) login.id};
      final cardIds = {for (final card in held.cards) card.id};
      final identityIds = {for (final identity in held.identities) identity.id};
      final next = Lists(
        accounts: stamped(keepingNew(merged.accounts, before.accounts, held.accounts), held.accounts),
        backupServices: stamped(keepingNew(merged.services, before.backupServices, held.backupServices), held.backupServices),
        keys: stamped(keys, held.keys),
        notes: stamped([
          ...held.notes,
          for (final note in merged.notes)
            if (noteIds.add(note.id)) note,
        ], held.notes),
        passkeys: stamped([
          ...held.passkeys,
          for (final passkey in merged.passkeys)
            if (passkeyIds.add(passkey.credentialId))
              passkey.copyWith(addedAt: passkey.addedAt == 0 ? now : passkey.addedAt, updatedAt: unset),
        ], held.passkeys),
        keyAccounts: stamped([...held.keyAccounts, ...merged.keyAccounts], held.keyAccounts),
        contacts: stamped([
          ...held.contacts,
          for (final contact in merged.contacts) contactIds.add(contact.id) ? contact : contact.copyWith(id: newUuid()),
        ], held.contacts),
        logins: stamped([
          ...held.logins,
          for (final login in merged.logins)
            if (loginIds.add(login.id)) login,
        ], held.logins),
        cards: stamped([
          ...held.cards,
          for (final card in merged.cards)
            if (cardIds.add(card.id)) card,
        ], held.cards),
        identities: stamped([
          ...held.identities,
          for (final identity in merged.identities)
            if (identityIds.add(identity.id)) identity,
        ], held.identities),
        // File items aren't imported, but the ones the vault holds stay
        files: held.files,
      );
      final editable = vault.keepingEditable(held, next);
      skipped = editable.skipped;
      return editable.lists;
    });
    _opened.remove(token);
    return {'added': merged.adding, 'replaced': replace && hasCodes, 'skipped': skipped};
  }

  /// What [incoming] does to the keys [held]: a PGP key the vault holds is combined with the imported copy (the app's `_importKeys`),
  /// by its identity; a key it doesn't hold is added. Only this part waits, so it is worked out first, and the lists the write holds
  /// once it has the lock take it (see [apply]).
  Future<({Map<String, VaultKey> combined, List<VaultKey> added})> _planKeys(List<VaultKey> held, List<VaultKey> incoming) async {
    final next = [...held];
    final at = {for (final (index, key) in held.indexed) keyIdentity(key): index};
    for (final key in incoming) {
      final identity = keyIdentity(key);
      final index = at[identity];
      if (index == null) {
        at[identity] = next.length;
        next.add(key);
      } else if (await combinedPgpKey(next[index], key) case final combined?) {
        next[index] = combined;
      }
    }
    return (
      combined: {
        for (var i = 0; i < held.length; i++)
          if (!identical(next[i], held[i])) keyIdentity(held[i]): next[i],
      },
      added: next.sublist(held.length),
    );
  }

  // ─── Export ───────────────────────────────────────────────────────────

  /// What an export of the open vault could hold, by kind, and what no format carries: nothing secret.
  Map<String, Object?> exportInfo() {
    vault.requireSession();
    final plan = CredentialExportPlan.of(vault.lists);
    final scope = exportScope(vault.lists);
    final lists = scope.lists;
    final kinds = {for (final kind in ExportKind.values) kind};
    return {
      'counts': {
        'codes': lists.accounts.length,
        'backupServices': lists.backupServices.length,
        'logins': lists.logins.length,
        'notes': lists.notes.length,
        'passkeys': lists.passkeys.length,
        'keys': lists.keys.length,
        'cards': lists.cards.length,
        'identities': lists.identities.length,
        'contacts': lists.contacts.length,
        'keyAccounts': lists.keyAccounts.length,
      },
      'spaceItems': scope.spaceItems,
      'attachedFiles': lists.notes.fold<int>(0, (sum, note) => sum + note.files.length),
      'cxf': {
        'sendable': {for (final kind in ExportKind.values) kind.name: plan.sendable(kind)},
        'leftOut': {for (final MapEntry(:key, :value) in plan.leftOut(kinds).entries) key.name: value},
      },
    };
  }

  /// The time as a file name carries it: `2026-11-24T09-00-00`, in UTC.
  String _stamp() {
    final now = DateTime.fromMillisecondsSinceEpoch(vault.nowMs, isUtc: true);
    return isoString(now).replaceAll(RegExp('[:.]'), '-').substring(0, 19);
  }

  Future<void> _confirm(Map<String, Object?> options) async {
    final password = options['password'];
    if (password is! String || password.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'no password');
    if (!await vault.confirmPassword(password)) throw const CoreFailure('badPassword');
  }

  /// An export file of [options]`.format`: `encrypted` (Kemlock's, with `exportPassword`), `plain` (Kemlock's), `csv`, `links` (the
  /// codes as otpauth:// links) or `cxf` (Credential Exchange, of the `kinds` named). Takes the vault's own `password` first, as the
  /// app asks the owner to show it is them. Answers the file's name, type and text, and what it holds and left out.
  Future<Map<String, Object?>> export(Map<String, Object?> options) async {
    vault.requireSession();
    await _confirm(options);
    final format = options['format'];
    final now = DateTime.fromMillisecondsSinceEpoch(vault.nowMs, isUtc: true);
    final scope = exportScope(vault.lists);
    final lists = scope.lists;
    final attached = lists.notes.fold<int>(0, (sum, note) => sum + note.files.length);
    final counts = <String, int>{
      'codes': lists.accounts.length,
      'backupServices': lists.backupServices.length,
      'logins': lists.logins.length,
      'notes': lists.notes.length,
      'passkeys': lists.passkeys.length,
      'keys': lists.keys.length,
      'cards': lists.cards.length,
      'identities': lists.identities.length,
      'contacts': lists.contacts.length,
      'keyAccounts': lists.keyAccounts.length,
    };
    Map<String, Object?> file(
      String name,
      String mime,
      String text, {
      Map<String, int>? held,
      List<Map<String, Object?>> leftOut = const [],
    }) => {
      'name': name,
      'mime': mime,
      'text': text,
      'counts': held ?? counts,
      'leftOut': leftOut,
      'spaceItems': scope.spaceItems,
      'attachedFiles': attached,
    };

    switch (format) {
      case 'encrypted':
        final password = options['exportPassword'];
        if (password is! String || password.length < minExportPassword) throw const CoreFailure('exportTooShort');
        final json = await exportVault(
          lists.accounts,
          lists.backupServices,
          password,
          keys: lists.keys,
          notes: lists.notes,
          passkeys: lists.passkeys,
          keyAccounts: lists.keyAccounts,
          contacts: lists.contacts,
          logins: lists.logins,
          cards: lists.cards,
          identities: lists.identities,
          files: lists.files,
          now: now,
        );
        // The check the app offers after a backup: the file opens with its password, and holds what was exported
        final opened = await importVault(json, password);
        if (opened.accounts.length != lists.accounts.length ||
            opened.logins.length != lists.logins.length ||
            opened.notes.length != lists.notes.length) {
          throw const CoreFailure('exportCheckFailed');
        }
        return file('kemlock-export-${_stamp()}.json', 'application/json', json);
      case 'plain':
        return file(
          'kemlock-export-${_stamp()}.json',
          'application/json',
          exportVaultPlaintext(
            lists.accounts,
            lists.backupServices,
            keys: lists.keys,
            notes: lists.notes,
            passkeys: lists.passkeys,
            keyAccounts: lists.keyAccounts,
            contacts: lists.contacts,
            logins: lists.logins,
            cards: lists.cards,
            identities: lists.identities,
            files: lists.files,
            now: now,
          ),
        );
      case 'csv':
        return file(
          'kemlock-logins-${_stamp()}.csv',
          'text/csv',
          exportLoginsCsv(lists.logins, lists.accounts, notes: lists.notes),
          held: {'logins': lists.logins.length, 'notes': lists.notes.length},
        );
      case 'links':
        final links = exportCodeLinks(lists.accounts);
        return file(
          'kemlock-codes-${_stamp()}.txt',
          'text/plain',
          links.text,
          held: {'codes': links.exported},
          leftOut: [
            if (links.skipped > 0) {'title': '', 'reason': 'secret', 'count': links.skipped},
          ],
        );
      case 'cxf':
        final wanted = options['kinds'] is List<Object?> ? (options['kinds']! as List<Object?>).whereType<String>().toSet() : <String>{};
        final kinds = {
          for (final kind in ExportKind.values)
            if (wanted.contains(kind.name)) kind,
        };
        if (kinds.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'no kind picked');
        final plan = CredentialExportPlan.of(vault.lists);
        final written = writeCxf(plan.pick(kinds), now: vault.nowMs, accountId: vault.registry.active);
        return file(
          'kemlock-credentials-${_stamp()}.json',
          'application/json',
          written.json,
          held: {for (final kind in kinds) kind.name: plan.sendable(kind)},
          leftOut: [
            for (final item in written.leftOut) {'title': item.title, 'reason': item.reason.name},
          ],
        );
    }
    throw const CoreFailure(CoreFailure.invalid, 'no such format');
  }

  /// The vault's codes as QR codes, `format`: `google` (Google Authenticator's transfer codes, which any authenticator reads),
  /// `kemlock` (Kemlock's transfer, encrypted with `transferPassword`) or `kemlockPlain`. Each is answered as its modules, `size`
  /// by `size` as `1` and `0`, for the page to draw.
  Future<Map<String, Object?>> exportQr(Map<String, Object?> options) async {
    vault.requireSession();
    await _confirm(options);
    final lists = exportScope(vault.lists, codesOnly: true).lists;
    final List<String> contents;
    var exported = lists.accounts.length;
    var leftOut = <Map<String, Object?>>[];
    switch (options['format']) {
      case 'google':
        final made = buildGoogleMigration(lists.accounts, batchId: (vault.nowMs ~/ 1000) & 0x7fffffff);
        contents = made.uris;
        exported = made.exported;
        leftOut = [
          for (final item in made.leftOut) {'title': item.title, 'reason': item.reason.name},
        ];
      case 'kemlock':
        final password = options['transferPassword'];
        if (password is! String || password.length < minExportPassword) throw const CoreFailure('exportTooShort');
        contents = await exportVaultQr(lists.accounts, lists.backupServices, password);
      case 'kemlockPlain':
        contents = exportVaultQrPlaintext(lists.accounts, lists.backupServices);
      default:
        throw const CoreFailure(CoreFailure.invalid, 'no such format');
    }
    return {
      'codes': [
        for (final content in contents)
          () {
            final code = qrModules(content);
            return {'size': code.size, 'modules': code.modules};
          }(),
      ],
      'exported': exported,
      'backupServices': options['format'] == 'google' ? 0 : lists.backupServices.length,
      'leftOut': leftOut,
    };
  }
}
