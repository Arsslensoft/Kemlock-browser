// The vault's keys and contacts for the browser (docs/plans/add-keys.md): listing them, their public and private halves,
// generating and importing keys, other people's public keys as contacts, and the changes to each, in the app's own formats
// (`VaultKey` and `Contact` of Kemlock-core, saved with its store). The key code is Kemlock-core's; this asks it to read,
// make and write, and keeps what the app keeps: a key is never added twice, a PGP key's halves only grow, a private half
// leaves only through `exportKey`, and contacts live in the vault's own scope.
import 'dart:typed_data';

import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/keys/keys.dart' as crypto;
import 'package:kemlock_core/features/keys/key_bridge.dart';
import 'package:kemlock_core/models/contact.dart';
import 'package:kemlock_core/models/json.dart';
import 'package:kemlock_core/models/vault_key.dart';

import 'failure.dart';
import 'item_extras.dart';
import 'keys_args.dart';
import 'keys_views.dart';
import 'pgp_service.dart';
import 'vault_service.dart';

/// Every method of this service and of the PGP tools it owns, by name (the TypeScript `CoreApi`'s, see src/shared/keys-api.ts).
const keysMethods = {
  'keys',
  'keyPublic',
  'exportKey',
  'saveKey',
  'deleteKey',
  'generateKey',
  'previewKey',
  'importKey',
  'contacts',
  'previewContacts',
  'addContacts',
  'saveContact',
  'contactPublic',
  'deleteContact',
  'pgpEncrypt',
  'pgpDecrypt',
  'pgpSign',
  'pgpVerify',
  'sshSign',
  'sshVerify',
};

/// How a public key meets the vault when it is offered as a contact.
class _ContactPlan {
  const _ContactPlan(this.key, this.status, {this.contact, this.own, this.merged, this.sameAddress});

  final crypto.PgpPublicKey key;

  /// `new`, `own` (the vault holds the key pair), `held` (a contact has this key) or `update` (it has it, and this adds to it).
  final String status;
  final Contact? contact;
  final VaultKey? own;
  final Uint8List? merged;

  /// A contact that shares an address with the key, which a new key may replace.
  final (Contact, String)? sameAddress;
}

class KeysService {
  KeysService(this.vault) : tools = PgpService(vault);

  final VaultService vault;
  final PgpService tools;

  /// What each key's row shows, by id and public half: the halves of a key never change but for a PGP key's growing.
  final Map<String, (String, KeyFacts)> _facts = {};

  /// The session the facts were read in: a new one (another unlock) starts them over.
  Object? _factsSession;

  /// Forgets what the rows show: the vault locked or went.
  void forget() {
    _facts.clear();
    _factsSession = null;
  }

  bool handles(String method) => keysMethods.contains(method);

  DateTime get _now => DateTime.fromMillisecondsSinceEpoch(vault.nowMs, isUtc: true);

  Future<Object?> call(String method, List<Object?> args) async {
    switch (method) {
      case 'keys':
        return keys();
      case 'keyPublic':
        return keyPublic(argString(args, 0));
      case 'exportKey':
        return exportKey(argObject(args, 0));
      case 'saveKey':
        return saveKey(argObject(args, 0));
      case 'deleteKey':
        await deleteKey(argString(args, 0));
        return null;
      case 'generateKey':
        return generateKey(argObject(args, 0));
      case 'previewKey':
        return previewKey(argObject(args, 0));
      case 'importKey':
        return importKey(argObject(args, 0));
      case 'contacts':
        return contacts();
      case 'previewContacts':
        return previewContacts(argObject(args, 0));
      case 'addContacts':
        return addContacts(argObject(args, 0));
      case 'saveContact':
        return saveContact(argObject(args, 0));
      case 'contactPublic':
        return contactPublic(argString(args, 0));
      case 'deleteContact':
        await deleteContact(argString(args, 0));
        return null;
      default:
        return tools.call(method, args);
    }
  }

  // ─── Keys ─────────────────────────────────────────────────────────────

  VaultKey _key(String id) {
    for (final key in vault.lists.keys) {
      if (key.id == id) return key;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such key');
  }

  KeyFacts _factsFor(VaultKey key) {
    if (!identical(_factsSession, vault.session)) {
      _facts.clear();
      _factsSession = vault.session;
    }
    final stamp = '${key.kind}|${key.publicKey}';
    final held = _facts[key.id];
    if (held != null && held.$1 == stamp) return held.$2;
    final facts = factsOf(key);
    _facts[key.id] = (stamp, facts);
    return facts;
  }

  List<Map<String, Object?>> keys() {
    vault.requireSession();
    final now = _now;
    return [for (final key in vault.lists.keys) keyView(key, _factsFor(key), now)];
  }

  Future<void> _saveKeys(List<VaultKey> Function(List<VaultKey> held) build) => vault.updateKeys(build);

  /// The key in the vault that is [key], by [keyIdentity]: a PGP key by its primary fingerprint, whatever else differs; any
  /// other by its key pair.
  VaultKey? _held(VaultKey key) {
    final identity = keyIdentity(key);
    for (final other in vault.lists.keys) {
      if (keyIdentity(other) == identity) return other;
    }
    return null;
  }

  /// A key's public halves in the forms they are handed out in, and the file names they are saved under.
  Map<String, Object?> keyPublic(String id) {
    vault.requireSession();
    final key = _key(id);
    final parsed = parsedKeyOf(key);
    final base = exportedKeyFileName(key).replaceAll(RegExp(r'\.(pem|asc)$'), '');
    String? ssh;
    String? pem;
    try {
      ssh = key.kind == KeyKind.ssh ? crypto.sshPublicKeyLine(parsed, comment: key.name) : null;
      pem = crypto.publicKeyPem(parsed);
    } on crypto.KeyFormatException {
      // No public half to hand out
    } on ArgumentError {
      // An algorithm with no public half this code reads
    }
    return {
      'ssh': ?ssh,
      'sshFile': ?(ssh == null ? null : '$base.pub'),
      'pem': ?pem,
      'pemFile': ?(pem == null ? null : '$base${key.kind == KeyKind.pgp ? '.pub.asc' : '.pub.pem'}'),
      'pgp': key.kind == KeyKind.pgp,
    };
  }

  /// The private half in its kind's form, for the person to show, copy or save: an SSH key as an OpenSSH file, a PGP key as an
  /// armored secret key, any other as PKCS#8 PEM. `purpose` says what it is for, and is asked for always: `show` and `copy`
  /// give the key as it is; `file` may protect it with a `passphrase` (a PGP key with a passphrase of its own goes out as it
  /// came). As the app does when it can't read the space's rule, a key of a space is never written to a file: that is refused
  /// here, whatever else the page asks for, and a passphrase, which only a file takes, is refused for any other purpose.
  Future<Map<String, Object?>> exportKey(Map<String, Object?> args) async {
    vault.requireSession();
    final key = _key(needString(args, 'id'));
    final purpose = needString(args, 'purpose');
    if (purpose != 'show' && purpose != 'copy' && purpose != 'file') throw const CoreFailure(CoreFailure.invalid, 'purpose');
    final passphrase = fieldString(args, 'passphrase');
    if (passphrase != null && (passphrase.isEmpty || purpose != 'file')) {
      throw const CoreFailure(CoreFailure.invalid, 'a passphrase is empty, or for something that is not a file');
    }
    if (key.isOnCard) throw const CoreFailure('keyOnCard', 'the private half is on a security key');
    if (purpose == 'file' && key.spaceId != null) {
      throw const CoreFailure('keyInSpace', 'a key of a space is not saved to a file here');
    }
    final parsed = parsedKeyOf(key);
    try {
      final text = await crypto.exportPrivateKey(parsed, passphrase: passphrase, comment: key.name);
      return {
        'text': text,
        'fileName': exportedKeyFileName(key),
        'ownPassphrase': parsed.pgp?.protected ?? false,
        'partlyProtected': parsed.pgp?.partlyProtected ?? false,
      };
    } on crypto.KeyFormatException catch (error) {
      throw keyFailure(error);
    } on ArgumentError {
      throw const CoreFailure(CoreFailure.invalid, 'this key has no such form');
    }
  }

  /// Changes a key's name, note and tags: the only things about it that change.
  Future<Map<String, Object?>> saveKey(Map<String, Object?> args) async {
    vault.requireSession();
    final key = _key(needString(args, 'id'));
    final name = fieldString(args, 'name')?.trim();
    final note = fieldString(args, 'note')?.trim();
    final tags = args.containsKey('tags') ? asStrings(args['tags']) : null;
    final next = key.copyWith(
      name: name == null || name.isEmpty ? key.name : name,
      note: !args.containsKey('note') ? keep : (note == null || note.isEmpty ? unset : note),
      tags: tags == null ? keep : (tags.isEmpty ? unset : tags),
    );
    await _saveKeys((held) => [for (final other in held) other.id == key.id ? next : other]);
    return keyView(_key(key.id), _factsFor(_key(key.id)), _now);
  }

  Future<void> deleteKey(String id) async {
    vault.requireSession();
    _key(id);
    // The links to the key go in the same write, worked out from the lists the write holds
    await vault.saveChanged((held) {
      final removed = held.keys.where((key) => key.id == id).firstOrNull;
      return removed == null ? held : vault.withoutEntry(held, removed);
    });
    _facts.remove(id);
  }

  /// Makes a key pair and keeps it: an SSH, signing or exchange key of one of the algorithms its kind offers, or a PGP key for a
  /// name and an email. Nothing is added when it fails. The work runs here, in the background, so a large RSA key keeps it busy.
  Future<Map<String, Object?>> generateKey(Map<String, Object?> args) async {
    vault.requireSession();
    final kindName = needString(args, 'kind');
    final name = needString(args, 'name').trim();
    if (name.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'a key needs a name');
    final crypto.KeyRequest request;
    var keyName = name;
    if (kindName == 'pgp') {
      final email = needString(args, 'email').trim();
      if (email.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'a PGP key needs an email address');
      final typeName = fieldString(args, 'type') ?? 'pqStandard';
      final type = crypto.PgpKeyType.values.where((type) => type.name == typeName).firstOrNull;
      if (type == null) throw CoreFailure(CoreFailure.invalid, 'no such PGP key type: $typeName');
      final years = args['expiresInYears'];
      if (years != null && (years is! int || years < 1 || years > 100)) throw const CoreFailure(CoreFailure.invalid, 'expiresInYears');
      request = crypto.PgpKeyRequest(name: name, email: email, type: type, expiresInYears: years as int?);
      keyName = '$name <$email>';
    } else {
      final kind = crypto.KeyKind.values
          .where((kind) => kind.name == kindName && kind != crypto.KeyKind.pgp && kind != crypto.KeyKind.other)
          .firstOrNull;
      final offered = kind == null ? null : crypto.generatedAlgorithms[kind];
      if (kind == null || offered == null) throw CoreFailure(CoreFailure.invalid, 'no such kind of key: $kindName');
      final id = fieldString(args, 'algorithm');
      final bits = args['bits'];
      final algorithm = offered.where((candidate) => candidate.id == id && candidate.bits == (bits is int ? bits : null)).firstOrNull;
      if (algorithm == null) throw CoreFailure(CoreFailure.invalid, 'a $kindName key is not made with $id');
      request = crypto.NewKeyRequest(kind, algorithm);
    }
    final crypto.ParsedKey parsed;
    try {
      parsed = await crypto.makeKey(request);
    } on ArgumentError catch (error) {
      throw CoreFailure(CoreFailure.invalid, '${error.name}');
    } on crypto.KeyFormatException catch (error) {
      throw keyFailure(error);
    }
    final key = vaultKeyOf(
      parsed,
      id: newUuid(),
      name: keyName,
      origin: KeyOrigin.generated,
    ).copyWith(addedAt: vault.nowMs, updatedAt: unset);
    await _saveKeys((held) => [...held, key]);
    return keyView(key, _factsFor(key), _now);
  }

  /// Reads the key in [args] (`text` or `base64`, and the `passphrase` of a protected one) without keeping it.
  Future<({crypto.ParsedKey parsed, VaultKey? held, VaultKey? combined})> _read(Map<String, Object?> args) async {
    vault.requireSession();
    final input = readInput(args);
    final given = fieldString(args, 'passphrase');
    final crypto.ParsedKey parsed;
    try {
      parsed = await crypto.readPrivateKey(input, passphrase: given == null || given.isEmpty ? null : given);
    } on crypto.KeyFormatException catch (error) {
      throw keyFailure(error);
    }
    final incoming = vaultKeyOf(parsed, id: '', name: '', origin: KeyOrigin.imported);
    final held = _held(incoming);
    final combined = held == null ? null : await combinedPgpKey(held, incoming);
    return (parsed: parsed, held: held, combined: combined);
  }

  /// What importing the key in [args] would add, saving nothing: its kind, fingerprint and name, and the key of the vault that
  /// it is, with whether this copy adds to it.
  Future<Map<String, Object?>> previewKey(Map<String, Object?> args) async {
    final read = await _read(args);
    final parsed = read.parsed;
    final comment = parsed.comment?.trim();
    final held = read.held;
    String fingerprint;
    try {
      fingerprint = crypto.keyFingerprint(parsed)?.text ?? '';
    } on crypto.KeyFormatException {
      fingerprint = '';
    } on ArgumentError {
      fingerprint = '';
    }
    return {
      'kind': parsed.kind.name,
      'algorithm': algorithmLabel(parsed.algorithm, parsed.bits),
      'fingerprint': fingerprint,
      'defaultName': comment != null && comment.isNotEmpty ? comment : (parsed.pgp?.mainUserId ?? ''),
      'canBeSsh': parsed.hasSshForm && parsed.kind != crypto.KeyKind.ssh,
      'userIds': parsed.pgp?.userIdsMainFirst ?? const <String>[],
      'protected': parsed.pgp?.protected ?? false,
      'held': held == null ? null : {'id': held.id, 'name': held.name, 'update': read.combined != null},
    };
  }

  /// Imports the key in [args] under `name`, as an SSH key when `asSsh` says so and it has that form. A PGP key the vault holds
  /// is not added twice: with `update` it grows the held copy by what this one adds.
  Future<Map<String, Object?>> importKey(Map<String, Object?> args) async {
    final read = await _read(args);
    final held = read.held;
    if (held != null) {
      final combined = read.combined;
      if (!fieldBool(args, 'update') || combined == null || combined.publicKey == null) {
        throw CoreFailure(CoreFailure.duplicate, held.name);
      }
      final grown = grownPgpKey(held, unb64(combined.privateKey), unb64(combined.publicKey!));
      if (grown == null) throw const CoreFailure(CoreFailure.failed, 'the key could not be updated');
      await _saveKeys((current) => [for (final key in current) key.id == held.id ? grown : key]);
      return keyView(_key(held.id), _factsFor(_key(held.id)), _now);
    }
    final name = (fieldString(args, 'name') ?? '').trim();
    if (name.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'a key needs a name');
    final asSsh = fieldBool(args, 'asSsh');
    if (asSsh && !read.parsed.hasSshForm) throw const CoreFailure(CoreFailure.invalid, 'this key has no SSH form');
    final kept = asSsh ? read.parsed.withKind(crypto.KeyKind.ssh) : read.parsed;
    final key = vaultKeyOf(kept, id: newUuid(), name: name, origin: KeyOrigin.imported).copyWith(addedAt: vault.nowMs, updatedAt: unset);
    await _saveKeys((held) => [...held, key]);
    return keyView(key, _factsFor(key), _now);
  }

  // ─── Contacts ─────────────────────────────────────────────────────────

  Contact _contact(String id) {
    for (final contact in vault.lists.contacts) {
      if (contact.id == id) return contact;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such contact');
  }

  List<Map<String, Object?>> contacts() {
    vault.requireSession();
    final now = _now;
    return [for (final contact in vault.lists.contacts) _view(contact, now)];
  }

  /// [contact] as a `ContactView`, with its custom fields (no hidden value) and the count of its links.
  Map<String, Object?> _view(Contact contact, DateTime now) =>
      contactView(contact, now, fields: fieldViews(contact.fields), links: vault.linkCount(contact.id));

  Future<void> _saveContacts(List<Contact> Function(List<Contact> held) build) => vault.updateContacts(build);

  Future<List<crypto.PgpPublicKey>> _readPublic(Object input) async {
    try {
      return await crypto.readPublicKeys(input);
    } on crypto.KeyFormatException catch (error) {
      throw contactFailure(error);
    }
  }

  /// How each key of [keys] meets the vault: its own key pair, a contact already, or someone new.
  Future<List<_ContactPlan>> _plans(List<crypto.PgpPublicKey> keys) async {
    final lists = vault.lists;
    final plans = <_ContactPlan>[];
    for (final key in keys) {
      final fingerprint = key.info.primary.fingerprintHex;
      VaultKey? own;
      for (final candidate in lists.keys) {
        if (candidate.kind == KeyKind.pgp && _factsFor(candidate).info?.primary.fingerprintHex == fingerprint) {
          own = candidate;
          break;
        }
      }
      if (own != null) {
        plans.add(_ContactPlan(key, 'own', own: own));
        continue;
      }
      Contact? held;
      for (final contact in lists.contacts) {
        if (contactInfoOf(contact)?.primary.fingerprintHex == fingerprint) {
          held = contact;
          break;
        }
      }
      if (held != null) {
        Uint8List? merged;
        try {
          final joined = await crypto.mergePublicKeys(unb64(held.publicKey), key.bytes);
          if (b64(joined) != held.publicKey) merged = joined;
        } on crypto.KeyFormatException {
          merged = null;
        } on ArgumentError {
          merged = null;
        }
        plans.add(_ContactPlan(key, merged == null ? 'held' : 'update', contact: held, merged: merged));
        continue;
      }
      final addresses = keyAddresses(key.info);
      (Contact, String)? same;
      for (final contact in lists.contacts) {
        final shared = keyAddresses(contactInfoOf(contact)).intersection(addresses);
        if (shared.isNotEmpty) {
          same = (contact, shared.first);
          break;
        }
      }
      plans.add(_ContactPlan(key, 'new', sameAddress: same));
    }
    return plans;
  }

  /// What adding the public keys in [args] would do, saving nothing: each key's fingerprint, user IDs and standing, and whether it
  /// is new, already a contact (and whether this copy adds to it), or the vault's own.
  Future<List<Map<String, Object?>>> previewContacts(Map<String, Object?> args) async {
    vault.requireSession();
    final keys = await _readPublic(readInput(args));
    final now = _now;
    return [
      for (final plan in await _plans(keys))
        {
          'fingerprintHex': plan.key.info.primary.fingerprintHex,
          'fingerprint': groupedFingerprintOf(plan.key.info.primary.fingerprintHex),
          'name': nameOfKey(plan.key.info) ?? plan.key.info.primary.fingerprintHex.substring(0, 8),
          'line': pgpListLine(plan.key.info),
          'userIds': plan.key.info.userIdsMainFirst,
          'standing': standingName(plan.key.info.primary, now),
          'status': plan.status,
          'existing': ?(plan.contact?.id ?? plan.own?.id),
          'existingName': ?(plan.contact?.name ?? plan.own?.name),
          'sameAddressId': ?plan.sameAddress?.$1.id,
          'sameAddressName': ?plan.sameAddress?.$1.name,
          'sameAddress': ?plan.sameAddress?.$2,
        },
    ];
  }

  /// Keeps the public keys in [args] (`text` or `base64`) as contacts, each new one as `source` says it arrived (`paste` or
  /// `file`), those listed in `checked` (fingerprints) marked as compared. A key a contact has already grows that contact; the
  /// vault's own key pair is left alone; `replacing` puts a single new key in place of the contact it names.
  Future<List<Map<String, Object?>>> addContacts(Map<String, Object?> args) async {
    vault.requireSession();
    final source = fieldString(args, 'source') ?? ContactSource.paste;
    if (source != ContactSource.paste && source != ContactSource.file) throw const CoreFailure(CoreFailure.invalid, 'source');
    final checked = {for (final fingerprint in fieldStrings(args, 'checked')) fingerprint.replaceAll(RegExp(r'\s'), '').toUpperCase()};
    final replacing = fieldString(args, 'replacing');
    final keys = await _readPublic(readInput(args));
    final plans = await _plans(keys);
    final now = vault.nowMs;
    var contacts = [...vault.lists.contacts];
    final changed = <String>[];
    // The ids this call made: only those are put back if the contact is not there when the write has the lock
    final added = <String>{};

    Contact mark(Contact contact, crypto.PgpKeyInfo info) {
      final fingerprint = info.primary.fingerprintHex;
      return checked.contains(fingerprint) ? contact.checked(fingerprint, now, addresses: keyAddresses(info)) : contact;
    }

    for (final plan in plans) {
      final info = plan.key.info;
      switch (plan.status) {
        case 'own':
          continue;
        case 'held' || 'update':
          final held = plan.contact!;
          var next = held;
          final merged = plan.merged;
          if (merged != null) next = withCheckedAddresses(held).copyWith(publicKey: b64(merged));
          next = mark(next, info);
          if (next != held) {
            contacts = [for (final contact in contacts) contact.id == held.id ? next : contact];
            changed.add(held.id);
          }
        default:
          final replaced = replacing == null || plans.length != 1 ? null : _contact(replacing);
          if (replaced != null) {
            final next = replaced.copyWith(publicKey: b64(plan.key.bytes), source: source, sourceEmail: unset);
            final marked = mark(next.unchecked(), info);
            contacts = [for (final contact in contacts) contact.id == replaced.id ? marked : contact];
            changed.add(replaced.id);
          } else {
            final fresh = mark(
              Contact(
                id: newUuid(),
                name: nameOfKey(info) ?? info.primary.fingerprintHex.substring(0, 8),
                publicKey: b64(plan.key.bytes),
                source: source,
                addedAt: now,
              ),
              info,
            );
            contacts.add(fresh);
            changed.add(fresh.id);
            added.add(fresh.id);
          }
      }
    }
    if (changed.isNotEmpty) {
      // Only what this call changed is put over the contacts held when the write has the lock
      final mine = {
        for (final contact in contacts)
          if (changed.contains(contact.id)) contact.id: contact,
      };
      await _saveContacts(
        (held) => [
          for (final contact in held) mine[contact.id] ?? contact,
          // A contact changed by this call and deleted meanwhile stays deleted; one it made is added
          for (final contact in mine.values)
            if (added.contains(contact.id) && !held.any((other) => other.id == contact.id)) contact,
        ],
      );
    }
    final nowTime = _now;
    return [
      for (final contact in vault.lists.contacts)
        if (changed.contains(contact.id)) _view(contact, nowTime),
    ];
  }

  /// A contact made by an older version carries no addresses with its check: they are written down when it next changes, as
  /// the app does, so the check keeps covering what it covered.
  Contact withCheckedAddresses(Contact contact) {
    final fingerprint = contact.checkedFingerprint;
    if (fingerprint == null || contact.checkedAddresses != null) return contact;
    final info = contactInfoOf(contact);
    if (info == null || fingerprint.toUpperCase() != info.primary.fingerprintHex) return contact;
    return contact.copyWith(checkedAddresses: keyAddresses(info).toList()..sort());
  }

  /// Changes a contact: its name, company, email, phone, address, note and custom fields, its links, and the mark that its fingerprint
  /// was compared (or takes the mark back): `checked` true is the person saying they compared the fingerprint of the key the contact
  /// holds now with its owner. Without an `id` it makes a new contact with no key (`source: manual`), which needs a name. A member
  /// the call leaves out is kept; the key never changes here.
  Future<Map<String, Object?>> saveContact(Map<String, Object?> args) async {
    vault.requireSession();
    final id = fieldString(args, 'id');
    final contact = id == null ? null : _contact(id);
    final fresh = Contact(id: newUuid(), name: '', source: ContactSource.manual, addedAt: vault.nowMs);
    Object? detail(String key) {
      if (!args.containsKey(key)) return keep;
      final text = fieldString(args, key)?.trim();
      if (text != null && text.length > contactDetailLimit) throw CoreFailure(CoreFailure.invalid, '$key is too long');
      return text == null || text.isEmpty ? unset : text;
    }

    // The edit is made on the contact the write holds, so what changed it meanwhile (a run, a comparison) is not put back
    Contact edit(Contact base) {
      var next = base;
      final name = fieldString(args, 'name')?.trim();
      if (name != null && name.isNotEmpty) next = next.copyWith(name: name);
      if (contact == null && next.name.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'a contact needs a name');
      next = next.copyWith(company: detail('company'), email: detail('email'), phone: detail('phone'), address: detail('address'));
      if (args.containsKey('note')) {
        final note = fieldString(args, 'note')?.trim();
        next = next.copyWith(note: note == null || note.isEmpty ? unset : note);
      }
      final fields = applyFields(next.fields, args['fields']);
      if (!identical(fields, next.fields)) next = next.copyWith(fields: fields);
      final checked = args['checked'];
      if (checked is bool && contact != null) {
        final info = contactInfoOf(next);
        if (checked) {
          if (info == null) throw const CoreFailure(CoreFailure.invalid, 'the key cannot be read');
          next = withCheckedAddresses(next).checked(info.primary.fingerprintHex, vault.nowMs, addresses: keyAddresses(info));
        } else {
          next = next.unchecked();
        }
      }
      return next;
    }

    final saved = edit(contact ?? fresh);
    final refs = args.containsKey('links') ? parseRefs(args['links']) : null;
    await _saveContacts(
      (held) => contact == null ? [...held, saved] : [for (final other in held) other.id == saved.id ? edit(other) : other],
    );
    final failures = refs == null ? const <String>[] : await vault.setLinksOf('contact', saved.id, refs);
    return {..._view(_contact(saved.id), _now), if (failures.isNotEmpty) 'linkFailures': failures};
  }

  /// A contact's key, armored, to copy or save.
  Map<String, Object?> contactPublic(String id) {
    vault.requireSession();
    final contact = _contact(id);
    final info = contactInfoOf(contact);
    if (info == null) throw const CoreFailure(CoreFailure.invalid, 'the key cannot be read');
    final key = crypto.ParsedKey(
      kind: crypto.KeyKind.pgp,
      algorithm: 'pgp',
      private: Uint8List(0),
      public: unb64(contact.publicKey),
      pgp: info,
    );
    final base = contact.name.replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-').replaceAll(RegExp(r'^-+|-+$'), '');
    return {'pem': crypto.publicKeyPem(key), 'fileName': '${base.isEmpty ? 'contact' : base}.pub.asc'};
  }

  Future<void> deleteContact(String id) async {
    vault.requireSession();
    _contact(id);
    // The links to the contact go in the same write, worked out from the lists the write holds
    await vault.saveChanged((held) {
      final removed = held.contacts.where((contact) => contact.id == id).firstOrNull;
      return removed == null ? held : vault.withoutEntry(held, removed);
    });
  }
}
