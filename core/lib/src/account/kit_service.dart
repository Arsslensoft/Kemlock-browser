// The account's Recovery Kit on the server (crates/kemlock-api-kem/src/routes/recovery_kit.rs): the non-secret record of a kit made
// here, which is kept only after the person typed one piece back, and replaced or removed behind the fresh proof the server asks for.
import 'package:kemlock_core/crypto/account/encoding.dart';

import '../failure.dart';
import 'account_context.dart';
import 'kit.dart';

const _route = '/account/recovery-kit';

/// The account's kit as the server keeps it, or null when it has none. The wrap stays on the server and in the sign-in that opens it.
Future<Map<String, Object?>?> kitRecord(AccountContext c) async {
  final record = await c.call('GET', _route, absentIsNull: true);
  if (record == null) return null;
  return {
    'kitId': record['kitId'],
    'threshold': record['threshold'],
    'shares': record['shares'],
    'keyVersion': record['keyVersion'],
    'createdAt': record['createdAt'],
    'current': record['current'] == true,
  };
}

/// Mails the one-time code that proves the owner, which replacing or removing a kit and showing the recovery code take.
Future<Object?> proofRequest(AccountContext c) async {
  await c.call('POST', '/account/two-factor/proof');
  return const <String, Object?>{};
}

/// A piece as it is compared: upper case, no spaces.
String normalizePiece(String text) => text.replaceAll(RegExp(r'\s+'), '').toUpperCase();

/// Makes a kit for the account's root key. The pieces come back once to be shown; the server holds nothing until [keepKit].
Future<MadeKit> makeKitFor(AccountContext c) =>
    makeRecoveryKit(rootKey: c.account.rootKey, accountId: uuidBytes(c.account.accountId), keyVersion: c.account.keyVersion);

/// Keeps [kit] on the server once [typed] is one of its pieces: the first kit, or, with a [proof], in place of the old one, whose
/// pieces then stop working.
Future<Object?> keepKit(AccountContext c, MadeKit kit, {required String typed, String? proof}) async {
  final wanted = normalizePiece(typed);
  if (wanted.isEmpty || !kit.pieces.any((piece) => normalizePiece(piece) == wanted)) throw const CoreFailure('pieceMismatch');
  final body = {'kitId': kit.kitId, 'keyVersion': kit.keyVersion, 'wrappedKey': b64urlEncode(kit.wrappedKey)};
  final existing = await kitRecord(c);
  if (existing == null) {
    await c.call('POST', _route, body: body);
  } else {
    if (proof == null || proof.trim().isEmpty) throw const CoreFailure('proofNeeded');
    await c.call('PUT', _route, body: {...body, 'proof': proof.trim()});
  }
  return kitRecord(c);
}

/// Removes the kit, behind the fresh proof.
Future<Object?> removeKit(AccountContext c, String proof) async {
  if (proof.trim().isEmpty) throw const CoreFailure('proofNeeded');
  await c.call('DELETE', _route, body: {'proof': proof.trim()});
  return const <String, Object?>{};
}
