// What the keys, contacts and PGP calls take and answer with, apart from the work itself: the arguments as the TypeScript side
// sends them (JSON), the words a failure is told in, and the small readers of user IDs both services share.
import 'dart:convert';
import 'dart:typed_data';

import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/keys/keys.dart' as crypto;
import 'package:kemlock_core/crypto/keys/pgp.dart' as pgp;
import 'package:kemlock_core/features/keys/key_bridge.dart' show userIdAddress;

import 'failure.dart';

/// The most a file given to a call may be: it is held whole, and travels as JSON.
const maxFileBytes = 16 * 1024 * 1024;

Map<String, Object?> argObject(List<Object?> args, int at) {
  final value = at < args.length ? args[at] : null;
  if (value is! Map<String, Object?>) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not an object');
  return value;
}

String argString(List<Object?> args, int at) {
  final value = at < args.length ? args[at] : null;
  if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
  return value;
}

/// The text field [name] of [object], or null when it is missing or null.
String? fieldString(Map<String, Object?> object, String name) {
  final value = object[name];
  if (value == null) return null;
  if (value is! String) throw CoreFailure(CoreFailure.invalid, '$name is not text');
  return value;
}

/// The text field [name], which the call needs.
String needString(Map<String, Object?> object, String name) {
  final value = fieldString(object, name);
  if (value == null) throw CoreFailure(CoreFailure.invalid, '$name is missing');
  return value;
}

bool fieldBool(Map<String, Object?> object, String name) => object[name] == true;

List<String> fieldStrings(Map<String, Object?> object, String name) {
  final value = object[name];
  if (value == null) return const [];
  if (value is! List<Object?>) throw CoreFailure(CoreFailure.invalid, '$name is not a list');
  return [
    for (final item in value)
      if (item is String) item else throw CoreFailure(CoreFailure.invalid, '$name holds a value that is not text'),
  ];
}

/// What a key, a message or a signature is given as: pasted text, or a file's bytes in base64 (`text` and `base64` fields).
/// Text goes to the key readers as a `String` and a file as bytes, as the app's import does.
Object readInput(Map<String, Object?> object, {String text = 'text', String base64 = 'base64'}) {
  final typed = fieldString(object, text);
  if (typed != null) return typed;
  final encoded = fieldString(object, base64);
  if (encoded == null) throw CoreFailure(CoreFailure.invalid, 'no $text or $base64');
  return decodeFile(encoded);
}

/// Whether [object] holds an input at all.
bool hasInput(Map<String, Object?> object, {String text = 'text', String base64 = 'base64'}) =>
    object[text] is String || object[base64] is String;

/// The bytes of a base64 file, held to [maxFileBytes].
Uint8List decodeFile(String encoded) {
  // Four characters make three bytes: refuse before decoding what is too large
  if (encoded.length > maxFileBytes * 4 ~/ 3 + 8) throw const CoreFailure('tooLarge', 'the file is over 16 MiB');
  try {
    return unb64(encoded);
  } on FormatException {
    throw const CoreFailure(CoreFailure.invalid, 'the file is not base64');
  }
}

/// The bytes of [input] as [readInput] gave it.
Uint8List inputBytes(Object input) => input is String ? Uint8List.fromList(utf8.encode(input)) : Uint8List.fromList(input as List<int>);

String _word(String name) => '${name[0].toUpperCase()}${name.substring(1)}';

/// The failure of a key reader: `key<Problem>`, as `keyPassphraseNeeded` or `keyPublicKeyOnly`.
CoreFailure keyFailure(crypto.KeyFormatException error) => CoreFailure('key${_word(error.problem.name)}', error.detail ?? '');

/// The failure of reading someone else's public key: `contact<Problem>`, and `contactFailsChecks` for a key whose own signatures
/// don't verify.
CoreFailure contactFailure(crypto.KeyFormatException error) {
  if (error.problem == crypto.KeyProblem.damaged && error.detail == crypto.pgpFailsOwnChecks) {
    return const CoreFailure('contactFailsChecks');
  }
  return CoreFailure('contact${_word(error.problem.name)}', error.detail ?? '');
}

/// The failure of an OpenPGP message call: `pgp<Problem>`, with the more precise word for what the problem's detail or reason
/// says (an encrypted message given to Verify, an expired key, ...).
CoreFailure pgpFailure(pgp.PgpException error) {
  final detail = error.detail;
  switch (error.problem) {
    case pgp.PgpProblem.notAMessage:
      return switch (detail) {
        'encrypted' => const CoreFailure('pgpIsEncrypted'),
        'detached' || 'not a signature' => const CoreFailure('pgpIsSignature'),
        'not signed' => const CoreFailure('pgpNotSigned'),
        _ => const CoreFailure('pgpNotAMessage'),
      };
    case pgp.PgpProblem.keyUnusable:
      return switch (error.reason) {
        pgp.PgpKeyTrouble.expired => const CoreFailure('pgpKeyExpired'),
        pgp.PgpKeyTrouble.revoked => const CoreFailure('pgpKeyRevoked'),
        pgp.PgpKeyTrouble.invalid => const CoreFailure('pgpKeyInvalid'),
        pgp.PgpKeyTrouble.weak => const CoreFailure('pgpKeyWeak'),
        pgp.PgpKeyTrouble.noSuchKey => const CoreFailure('pgpKeyNoSuchKey'),
        null => const CoreFailure('pgpKeyUnusable'),
      };
    default:
      return CoreFailure('pgp${_word(error.problem.name)}', detail ?? '');
  }
}

/// A user ID's name as the contact list writes it: before the address, without its comments; the address when it has no name.
String userIdName(String userId) {
  final cut = userId.indexOf('<');
  final name = _withoutComments(cut < 0 ? userId : userId.substring(0, cut)).trim();
  if (name.isNotEmpty && userIdAddress(name) == null) return name;
  return userIdAddress(userId) ?? userId.trim();
}

String _withoutComments(String text) {
  final out = StringBuffer();
  var at = 0;
  while (true) {
    final open = text.indexOf('(', at);
    final close = open < 0 ? -1 : text.indexOf(')', open + 1);
    if (close < 0) {
      out.write(text.substring(at));
      return out.toString();
    }
    out.write(text.substring(at, open));
    at = close + 1;
  }
}

/// The addresses of a key's user IDs, in lower case.
Set<String> keyAddresses(crypto.PgpKeyInfo? info) => {
  ...?info?.userIds.map(userIdAddress).nonNulls.map((address) => address.toLowerCase()),
};

/// The name of a user ID without its address, for a person listed by it: the first user ID's name, else nothing.
String? nameOfKey(crypto.PgpKeyInfo info) {
  for (final userId in info.userIds) {
    final name = userIdName(userId);
    if (name.isNotEmpty) return name;
  }
  return null;
}
