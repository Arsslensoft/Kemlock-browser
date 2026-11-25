// The vault's keys and contacts as the TypeScript side sees them (`KeyView`, `ContactView` in src/shared/keys-api.ts): plain
// JSON with no secret. What a key or a contact holds is read from its public half, which carries the self-signatures of the
// secret one and none of its secrets, and what is worked out from the clock (in order, expiring soon, expired, revoked) is
// worked out each time and never stored, as in the app (`key_standing.dart`, `contact_standing.dart`).
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/keys/keys.dart' as crypto;
import 'package:kemlock_core/features/keys/key_bridge.dart';
import 'package:kemlock_core/models/contact.dart';
import 'package:kemlock_core/models/vault_key.dart';

import 'keys_args.dart';

/// A key is expiring soon when it expires in this long or less.
const expiringSoonWithin = Duration(days: 30);

/// `ok`, `expiringSoon`, `expired` or `revoked` for [key] at [now]; a revoked key is revoked whatever its date.
String standingName(crypto.PgpKey key, DateTime now) {
  if (key.revoked) return 'revoked';
  final expires = key.expires;
  if (expires == null) return 'ok';
  if (!now.isBefore(expires)) return 'expired';
  return expires.difference(now) <= expiringSoonWithin ? 'expiringSoon' : 'ok';
}

bool _over(String standing) => standing == 'expired' || standing == 'revoked';

/// What a vault key holds that its list row shows: read once per key, since it takes a parse.
class KeyFacts {
  const KeyFacts({required this.fingerprint, required this.line, required this.hasSshForm, this.info});

  /// `SHA256:…` for an SSH key and every non-PGP key, the grouped hexadecimal fingerprint for a PGP key; empty when unreadable.
  final String fingerprint;

  /// The line under the name: `ada@example.org · Ed25519` for PGP, the algorithm for the others.
  final String line;

  /// Whether OpenSSH has a key type for the key.
  final bool hasSshForm;

  /// A PGP key's user IDs and subkeys; null for another kind, and for a key that can't be read.
  final crypto.PgpKeyInfo? info;
}

/// Reads [key]'s facts. A key that can't be read has an empty fingerprint and no info, and is listed all the same.
KeyFacts factsOf(VaultKey key) {
  var line = algorithmLabel(key.algorithm, key.bits);
  var fingerprint = '';
  var sshForm = false;
  crypto.PgpKeyInfo? info;
  try {
    if (key.kind == KeyKind.pgp) {
      info = crypto.readPgpKeyInfo(unb64(key.publicKey ?? key.privateKey));
      fingerprint = groupedFingerprintOf(info.primary.fingerprintHex);
      line = pgpListLine(info);
    } else {
      final parsed = parsedKeyOf(key);
      sshForm = parsed.hasSshForm;
      fingerprint = crypto.keyFingerprint(parsed)?.text ?? '';
    }
  } on crypto.KeyFormatException {
    // Listed without its fingerprint
  } on FormatException {
    // Not even base64
  } on ArgumentError {
    // An algorithm the key code reads no public half of
  }
  return KeyFacts(fingerprint: fingerprint, line: line, hasSshForm: sshForm, info: info);
}

String _subkeyLabel(crypto.PgpKey key) {
  final named = pgpKeyAlgorithmName(key.algorithm);
  return named == key.algorithm ? pgpAlgorithmLabel(key) : named;
}

/// A PGP key's user IDs, subkeys and what it can do, as `PgpFacts` in src/shared/keys-api.ts.
Map<String, Object?> pgpFactsView(crypto.PgpKeyInfo info, DateTime now) {
  final users = info.userIdsMainFirst;
  return {
    'userIds': users,
    'address': ?users.map(userIdAddress).nonNulls.firstOrNull,
    'version': info.version,
    'canSign': info.primary.usable,
    'postQuantum': ?pgpPostQuantumEncryption(info, now: now),
    'subkeys': [
      for (final subkey in info.subkeys)
        {
          'fingerprint': groupedFingerprintOf(subkey.fingerprintHex),
          'algorithm': _subkeyLabel(subkey),
          'uses': [
            if (subkey.canCertify) 'certify',
            if (subkey.canSign) 'sign',
            if (subkey.canEncrypt) 'encrypt',
            if (subkey.canAuthenticate) 'authenticate',
          ],
          'expires': ?subkey.expires?.millisecondsSinceEpoch,
          'revoked': subkey.revoked,
        },
    ],
  };
}

/// [key] as a `KeyView`.
Map<String, Object?> keyView(VaultKey key, KeyFacts facts, DateTime now) {
  final info = facts.info;
  return {
    'id': key.id,
    'name': key.name,
    'kind': key.kind,
    'algorithm': algorithmLabel(key.algorithm, key.bits),
    'origin': key.origin,
    'fingerprint': facts.fingerprint,
    'line': facts.line,
    'note': ?key.note,
    'tags': key.tags ?? const <String>[],
    'pinned': key.isPinned,
    'addedAt': key.addedAt,
    'protected': key.protected ?? false,
    'onCard': key.isOnCard,
    'hasPublic': key.publicKey != null,
    'hasSshForm': facts.hasSshForm,
    'inSpace': key.spaceId != null,
    if (info != null) ...{
      'standing': standingName(info.primary, now),
      'expires': ?info.primary.expires?.millisecondsSinceEpoch,
      'pgp': pgpFactsView(info, now),
    },
  };
}

/// What the app knows of a contact at one moment: whether its fingerprint was compared, whether its key may still be used, and
/// whether a message can be encrypted to it.
class ContactStanding {
  const ContactStanding({
    required this.checked,
    this.checkedAt,
    this.unchecked = const {},
    required this.standing,
    required this.canEncrypt,
    this.info,
  });

  /// Whether the fingerprint of the key the contact holds is the one that was compared with its owner.
  final bool checked;
  final int? checkedAt;

  /// The addresses of the key's user IDs that the check does not cover: all of them when nothing was compared.
  final Set<String> unchecked;

  /// `ok`, `expiringSoon`, `expired` or `revoked`.
  final String standing;

  /// Whether the key holds an encryption key that is neither expired nor revoked, under a primary key that is neither.
  final bool canEncrypt;

  /// What the key holds; null when it can't be read.
  final crypto.PgpKeyInfo? info;
}

/// What the key of [contact] holds, or null when it can't be read.
crypto.PgpKeyInfo? contactInfoOf(Contact contact) {
  try {
    return crypto.readPgpKeyInfo(unb64(contact.publicKey));
  } on crypto.KeyFormatException {
    return null;
  } on FormatException {
    return null;
  }
}

/// The standing of [contact] at [now]; [info] is what its key holds when the caller has read it already.
ContactStanding contactStandingOf(Contact contact, DateTime now, {crypto.PgpKeyInfo? info}) {
  final key = info ?? contactInfoOf(contact);
  if (key == null) return const ContactStanding(checked: false, standing: 'ok', canEncrypt: false);
  final standing = standingName(key.primary, now);
  final fingerprint = contact.checkedFingerprint;
  final checked = fingerprint != null && fingerprint.toUpperCase() == key.primary.fingerprintHex;
  final addresses = keyAddresses(key);
  // A check that kept no addresses covers the key as it is
  final covered = contact.checkedAddresses;
  final confirmed = !checked
      ? const <String>{}
      : covered == null
      ? addresses
      : addresses.intersection({for (final address in covered) address.toLowerCase()});
  bool usable(crypto.PgpKey k) => k.canEncrypt && !k.revoked && (k.expires == null || now.isBefore(k.expires!));
  return ContactStanding(
    checked: checked,
    checkedAt: checked ? contact.checkedAt : null,
    unchecked: addresses.difference(confirmed),
    standing: standing,
    canEncrypt: !_over(standing) && (usable(key.primary) || key.subkeys.any(usable)),
    info: key,
  );
}

/// [contact] as a `ContactView`.
Map<String, Object?> contactView(Contact contact, DateTime now) {
  final standing = contactStandingOf(contact, now);
  final info = standing.info;
  final fingerprint = info == null ? '' : info.primary.fingerprintHex;
  final named = contact.name.trim();
  return {
    'id': contact.id,
    'name': named.isNotEmpty ? named : (info == null ? '' : nameOfKey(info) ?? fingerprint.substring(0, 8)),
    'fingerprint': info == null ? '' : groupedFingerprintOf(fingerprint),
    'line': info == null ? '' : pgpListLine(info),
    'userIds': info?.userIdsMainFirst ?? const <String>[],
    'source': contact.source,
    'sourceEmail': ?contact.sourceEmail,
    'checked': standing.checked,
    'checkedAt': ?standing.checkedAt,
    'uncheckedAddresses': standing.unchecked.toList()..sort(),
    'standing': standing.standing,
    'expires': ?info?.primary.expires?.millisecondsSinceEpoch,
    'canEncrypt': standing.canEncrypt,
    'note': ?contact.note,
    'addedAt': contact.addedAt,
    if (info == null) 'unreadable': true,
  };
}
