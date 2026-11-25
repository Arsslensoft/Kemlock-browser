// Unlocking the browser's vault with a passkey, Windows Hello, Touch ID or a security key (docs/plans/add-passkey-unlock.md).
//
// A WebAuthn credential with the PRF extension gives 32 bytes only its authenticator can compute. They go through HKDF to a key
// that wraps the vault's ML-KEM-1024 private key, the way the vault's own password wrap is made. That wrap is a key slot: the
// password's wrap stays as it is, so the password always opens the vault. The record is ciphertext and public values (credential
// ids, names, a salt), kept in `storage.local` beside the vault's config and never in a sync file.
import 'dart:convert';
import 'dart:typed_data';

import 'package:kemlock_core/core/storage/key_value_store.dart';
import 'package:kemlock_core/crypto/aes_gcm.dart';
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/hkdf.dart';
import 'package:kemlock_core/models/json.dart';
import 'package:kemlock_core/vault/key_unlock.dart' show sameBytes;
import 'package:kemlock_core/vault/sealed_value.dart';
import 'package:kemlock_core/vault/vault_registry.dart';

import 'failure.dart';

/// The slots of the active vault: `{"v": 1, "salt", "rp"?, "slots": [...]}`. Ciphertext and public values.
const keyPasskeyUnlock = 'backmycodes_extension_passkey_unlock';

/// The failed passkey tries since the vault last opened by its password or a passkey: `{"count": n, "last": ms}`, in the clear
/// like the count of wrong passwords, and written before the answer is checked.
const keyPasskeyFailures = 'backmycodes_extension_passkey_failures';

/// When the vault last opened by its password, `{"at": ms}`, written by every password unlock whether credentials are set up or not,
/// and by the check of the password that adding a credential asks for. Removing every credential leaves it, so removing and adding one
/// again never starts the days over.
const keyPasswordUnlockedAt = 'backmycodes_extension_password_unlocked_at';

/// Failed passkey tries in a row after which the password is required.
const passkeyMaxFailures = 5;

/// Days without the password after which it is required again.
const passkeyMaxDays = 14;

/// What a slot's wrap key is bound to, with the vault's id.
const _label = 'Kemlock browser passkey unlock v1: wrap';

/// The length of a PRF output, and of the salt.
const prfLength = 32;

const _version = 1;
const _maxSlots = 10;

/// The key that wraps the vault's private key for the credential whose PRF output is [prf], in the vault [vault].
Uint8List passkeyWrapKey(Uint8List prf, Uint8List salt, String vault) => hkdfSha256(prf, salt: salt, info: utf8.encode('$_label $vault'));

/// One credential's slot.
class PasskeySlot {
  PasskeySlot({
    required this.id,
    required this.credential,
    required this.name,
    required this.addedAt,
    required this.nonce,
    required this.ct,
    this.lastUsedAt,
    this.attachment,
    this.transports = const [],
  });

  /// Eight random bytes in hex: the slot's own name for itself.
  final String id;

  /// The credential's id, which the authenticator is asked for at every unlock.
  final Uint8List credential;
  final String name;
  final int addedAt;
  final int? lastUsedAt;

  /// `platform` or `cross-platform`, as the browser said, or null.
  final String? attachment;
  final List<String> transports;
  final Uint8List nonce;
  final Uint8List ct;

  static PasskeySlot? parse(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final id = json['id'];
    final credential = _bytes(json['credential']);
    final nonce = _bytes(json['nonce']);
    final ct = _bytes(json['ct']);
    if (id is! String || id.isEmpty || credential == null || credential.isEmpty || nonce == null || nonce.isEmpty || ct == null) {
      return null;
    }
    final transports = json['transports'];
    return PasskeySlot(
      id: id,
      credential: credential,
      name: asString(json['name']),
      addedAt: asInt(json['addedAt']) ?? 0,
      lastUsedAt: asInt(json['lastUsedAt']),
      attachment: json['attachment'] is String ? json['attachment']! as String : null,
      transports: transports is List<Object?> ? transports.whereType<String>().toList() : const [],
      nonce: nonce,
      ct: ct,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'credential': b64(credential),
    'name': name,
    'addedAt': addedAt,
    'lastUsedAt': ?lastUsedAt,
    'attachment': ?attachment,
    if (transports.isNotEmpty) 'transports': transports,
    'nonce': b64(nonce),
    'ct': b64(ct),
  };

  PasskeySlot copyWith({String? name, int? lastUsedAt}) => PasskeySlot(
    id: id,
    credential: credential,
    name: name ?? this.name,
    addedAt: addedAt,
    lastUsedAt: lastUsedAt ?? this.lastUsedAt,
    attachment: attachment,
    transports: transports,
    nonce: nonce,
    ct: ct,
  );

  /// The view the pages get: nothing secret, with the credential's id as base64url.
  Map<String, Object?> view() => {
    'id': id,
    'credentialId': b64url(credential),
    'name': name,
    'addedAt': addedAt,
    'lastUsedAt': ?lastUsedAt,
    'attachment': ?attachment,
    'transports': transports,
  };
}

Uint8List? _bytes(Object? value) {
  if (value is! String) return null;
  try {
    return unb64(value);
  } on FormatException {
    return null;
  }
}

/// The record of the active vault's slots.
class PasskeyUnlockRecord {
  PasskeyUnlockRecord({required this.salt, required this.slots, this.rp});

  /// The PRF input of every credential, and the salt of every wrap key.
  final Uint8List salt;

  /// The relying party's id the credentials were made for, or null for the browser's default (Chrome and Edge).
  final String? rp;

  final List<PasskeySlot> slots;

  static PasskeyUnlockRecord? parse(String? raw) {
    if (raw == null) return null;
    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, Object?> || json['v'] != _version) return null;
      final salt = _bytes(json['salt']);
      final list = json['slots'];
      if (salt == null || salt.length != prfLength || list is! List<Object?>) return null;
      final slots = <PasskeySlot>[];
      for (final item in list) {
        final slot = PasskeySlot.parse(item);
        if (slot == null) return null;
        slots.add(slot);
      }
      return PasskeyUnlockRecord(
        salt: salt,
        rp: json['rp'] is String && (json['rp']! as String).isNotEmpty ? json['rp']! as String : null,
        slots: slots,
      );
    } on FormatException {
      return null;
    }
  }

  Map<String, Object?> toJson() => {
    'v': _version,
    'salt': b64(salt),
    'rp': ?rp,
    'slots': [for (final slot in slots) slot.toJson()],
  };

  PasskeyUnlockRecord copyWith({List<PasskeySlot>? slots, String? rp}) =>
      PasskeyUnlockRecord(salt: salt, rp: rp ?? this.rp, slots: slots ?? this.slots);

  PasskeySlot? slotFor(List<int> credential) {
    for (final slot in slots) {
      if (sameBytes(slot.credential, credential)) return slot;
    }
    return null;
  }
}

/// What a slot's unlock gave: the private key, and whether the wrap says the vault's values are authenticated.
typedef OpenedSlot = ({Uint8List secretKey, bool authenticated});

/// The private key wrapped for the credential [credential], whose PRF output is [prf].
Future<({Uint8List nonce, Uint8List ct})> wrapForPasskey({
  required Uint8List secretKey,
  required Uint8List prf,
  required Uint8List salt,
  required String vault,
  required Uint8List credential,
  required bool authenticated,
}) async {
  final key = passkeyWrapKey(prf, salt, vault);
  try {
    return await aesGcmEncrypt(key, secretKey, nonce: authenticated ? authenticatedWrapNonce() : null, aad: credential);
  } finally {
    key.fillRange(0, key.length, 0);
  }
}

/// The private key [slot] holds, opened with [prf]; throws [AesGcmAuthError] for any other output.
Future<OpenedSlot> unwrapPasskeySlot({
  required PasskeySlot slot,
  required Uint8List prf,
  required Uint8List salt,
  required String vault,
}) async {
  final key = passkeyWrapKey(prf, salt, vault);
  try {
    final secretKey = await aesGcmDecrypt(key, slot.nonce, slot.ct, aad: slot.credential);
    return (secretKey: secretKey, authenticated: isAuthenticatedWrapNonce(b64(slot.nonce)));
  } finally {
    key.fillRange(0, key.length, 0);
  }
}

/// The slots of the active vault, and the rules for when the password is needed instead.
class PasskeyUnlock {
  PasskeyUnlock(this._store, this._registry, this._now);

  final KeyValueStore _store;
  final VaultRegistry _registry;
  final DateTime Function() _now;

  int get _nowMs => _now().millisecondsSinceEpoch;

  String get _key => _registry.vaultKey(keyPasskeyUnlock);
  String get _failuresKey => _registry.vaultKey(keyPasskeyFailures);
  String get _passwordKey => _registry.vaultKey(keyPasswordUnlockedAt);

  /// When the vault last opened by its password, in epoch ms; null when nothing says (the password is then required).
  int? _passwordAt() {
    final raw = _store.getItem(_passwordKey);
    if (raw == null) return null;
    try {
      final json = jsonDecode(raw);
      return json is Map<String, Object?> ? asInt(json['at']) : null;
    } on FormatException {
      return null;
    }
  }

  /// The record, or null while nothing is set up or it can't be read.
  PasskeyUnlockRecord? read() => PasskeyUnlockRecord.parse(_store.getItem(_key));

  /// Whether a credential is set up.
  bool get isOn => read()?.slots.isNotEmpty ?? false;

  int _failures() {
    final raw = _store.getItem(_failuresKey);
    if (raw == null) return 0;
    try {
      final json = jsonDecode(raw);
      final count = json is Map<String, Object?> ? asInt(json['count']) : null;
      return count == null || count < 0 ? 0 : count;
    } on FormatException {
      return 0;
    }
  }

  void _setFailures(int count) {
    if (count == 0) {
      _store.removeItem(_failuresKey);
    } else {
      _store.setItem(_failuresKey, jsonEncode({'count': count, 'last': _nowMs}));
    }
  }

  /// Why the password is needed instead of a passkey: `tries` after too many failed tries, `days` after too long without it;
  /// null when a passkey may be asked.
  String? passwordRequired([PasskeyUnlockRecord? record]) {
    final held = record ?? read();
    if (held == null || held.slots.isEmpty) return null;
    if (_failures() >= passkeyMaxFailures) return 'tries';
    final at = _passwordAt();
    if (at == null || _nowMs - at >= const Duration(days: passkeyMaxDays).inMilliseconds) return 'days';
    return null;
  }

  /// What a page needs to know: the credentials, the PRF input, the relying party, and whether the password is needed.
  Map<String, Object?> info() {
    final record = read();
    if (record == null || record.slots.isEmpty) return {'credentials': <Object?>[]};
    return {
      'credentials': [for (final slot in record.slots) slot.view()],
      'salt': b64url(record.salt),
      'rpId': ?record.rp,
      'passwordRequired': ?passwordRequired(record),
    };
  }

  /// What a page needs to make a credential: the PRF input (made now, the first time), and the credentials there are, which the
  /// authenticator is told not to make again.
  Future<Map<String, Object?>> prepare() async {
    var record = read();
    if (record == null) {
      record = PasskeyUnlockRecord(salt: randomBytes(prfLength), slots: const []);
      _store.setItem(_key, jsonEncode(record.toJson()));
      await _store.flush();
    }
    return {
      'salt': b64url(record.salt),
      'rpId': ?record.rp,
      'exclude': [for (final slot in record.slots) b64url(slot.credential)],
    };
  }

  /// Adds the credential [credential] with its PRF output [prf], wrapping [secretKey]. [name] is the person's; [rp] is the
  /// relying party's id the credential was made for (null for the browser's default).
  Future<Map<String, Object?>> add({
    required Uint8List secretKey,
    required bool authenticated,
    required Uint8List credential,
    required Uint8List prf,
    required String name,
    String? rp,
    String? attachment,
    List<String> transports = const [],
  }) async {
    final vault = _registry.active;
    final record = read();
    if (record == null) throw const CoreFailure(CoreFailure.invalid, 'no passkey was prepared');
    if (prf.length != prfLength) throw const CoreFailure(CoreFailure.invalid, 'the PRF output is not 32 bytes');
    if (credential.isEmpty || credential.length > 1024) throw const CoreFailure(CoreFailure.invalid, 'the credential id is not one');
    if (record.slotFor(credential) != null) throw const CoreFailure(CoreFailure.duplicate, 'this credential is already one');
    if (record.slots.length >= _maxSlots) throw const CoreFailure(CoreFailure.invalid, 'too many credentials');
    final kept = record.rp;
    if (record.slots.isNotEmpty && kept != rp) throw const CoreFailure(CoreFailure.invalid, 'another relying party');
    final wrapped = await wrapForPasskey(
      secretKey: secretKey,
      prf: prf,
      salt: record.salt,
      vault: vault,
      credential: credential,
      authenticated: authenticated,
    );
    final trimmed = name.trim();
    final slot = PasskeySlot(
      id: b16(randomBytes(8)),
      credential: credential,
      name: trimmed.isEmpty ? 'Passkey' : trimmed,
      addedAt: _nowMs,
      attachment: attachment,
      transports: transports,
      nonce: wrapped.nonce,
      ct: wrapped.ct,
    );
    final next = record.copyWith(slots: [...record.slots, slot], rp: rp);
    _store.setItem(_key, jsonEncode(next.toJson()));
    await _store.flush();
    return info();
  }

  Future<Map<String, Object?>> rename(String id, String name) async {
    final record = read();
    final trimmed = name.trim();
    if (record == null || trimmed.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'no name');
    if (!record.slots.any((slot) => slot.id == id)) throw const CoreFailure(CoreFailure.notFound, 'no such credential');
    final next = record.copyWith(slots: [for (final slot in record.slots) slot.id == id ? slot.copyWith(name: trimmed) : slot]);
    _store.setItem(_key, jsonEncode(next.toJson()));
    await _store.flush();
    return info();
  }

  /// Removes a credential. The last one takes the whole record with it, and the count of failed tries.
  Future<Map<String, Object?>> remove(String id) async {
    final record = read();
    if (record == null || !record.slots.any((slot) => slot.id == id)) throw const CoreFailure(CoreFailure.notFound, 'no such credential');
    final slots = [
      for (final slot in record.slots)
        if (slot.id != id) slot,
    ];
    if (slots.isEmpty) {
      _store.removeItem(_key);
      _store.removeItem(_failuresKey);
    } else {
      _store.setItem(_key, jsonEncode(record.copyWith(slots: slots).toJson()));
    }
    await _store.flush();
    return info();
  }

  /// Opens the slot of [credential] with [prf]: its private key, or null when the answer opens nothing, which counts as a failed
  /// try (written down before the answer is checked, as the wrong passwords are). Throws `passwordRequired` while the password is
  /// needed, and `notFound` when no credential is set up.
  Future<OpenedSlot?> open(Uint8List credential, Uint8List prf) async {
    final record = read();
    if (record == null || record.slots.isEmpty) throw const CoreFailure(CoreFailure.notFound, 'no passkey is set up');
    final why = passwordRequired(record);
    if (why != null) throw CoreFailure('passwordRequired', why);
    final before = _failures();
    _setFailures(before + 1);
    await _store.flush();
    final slot = record.slotFor(credential);
    if (slot == null || prf.length != prfLength) return null;
    try {
      return await unwrapPasskeySlot(slot: slot, prf: prf, salt: record.salt, vault: _registry.active);
    } on AesGcmAuthError {
      return null;
    }
  }

  /// A passkey opened the vault, by [credential]: the failed tries are forgotten, and the slot says when it was used.
  Future<void> opened(List<int> credential) async {
    _setFailures(0);
    final record = read();
    final slot = record?.slotFor(credential);
    if (record != null && slot != null) {
      final next = record.copyWith(slots: [for (final s in record.slots) s.id == slot.id ? s.copyWith(lastUsedAt: _nowMs) : s]);
      _store.setItem(_key, jsonEncode(next.toJson()));
    }
    await _store.flush();
  }

  /// The password opened the vault, or was checked for a change: the passkey may be asked again, and the days start over. Written
  /// whether a credential is set up or not, so what removing and adding one does can't start them over.
  Future<void> passwordUsed() async {
    _setFailures(0);
    _store.setItem(_passwordKey, jsonEncode({'at': _nowMs}));
    await _store.flush();
  }
}

/// Bytes as lower-case hex.
String b16(List<int> bytes) => [for (final byte in bytes) byte.toRadixString(16).padLeft(2, '0')].join();
