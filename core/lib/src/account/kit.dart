// The account's Recovery Kit (docs/crypto.md, "The Recovery Kit"): a random 32-byte kit key is split into three pieces, any two of which
// rebuild it, and the root key is wrapped under it. The server keeps only the kit id, the key version and the wrap, which is also the
// verifier: only the right pieces open it. The pieces are the app's byte for byte (kit_pieces.dart), so the web vault and the phone read
// the ones made here.
//
//   wrap key = HKDF(ikm = kit key (32), salt = absent, info = "kemlock/v1/kit-wrap" || lp(kit id), L = 32)
//   aad      = "kemlock/v1/root-wrap/kit" || account id (16) || u32be(key version) || lp(kit id)
//   wrapped  = AES-256-GCM(wrap key, nonce, root key, aad)       nonce (12) || ciphertext (64) || tag (16)
import 'dart:math';
import 'dart:typed_data';

import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/crypto/account/keys.dart';
import 'package:kemlock_core/crypto/aes_gcm.dart';
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/hkdf.dart';

import 'kit_pieces.dart';

/// Pieces needed to open the account, and pieces made.
const kitThreshold = 2;
const kitShares = 3;

/// The length of a wrapped root key: nonce, 64-byte root and tag.
const kitWrappedLength = 12 + rootKeyLength + 16;

/// A kit made here and not kept yet: the pieces to show once, and the record the server keeps.
class MadeKit {
  const MadeKit({required this.kitId, required this.pieces, required this.keyVersion, required this.wrappedKey});

  final String kitId;

  /// The text of each piece, shown once and never stored.
  final List<String> pieces;
  final int keyVersion;
  final Uint8List wrappedKey;
}

Uint8List _wrapKey(Uint8List kitKey, String kitId) {
  requireLength(kitKey, 32, 'the kit key');
  return hkdfSha256(kitKey, salt: const [], info: concatBytes([label('kemlock/v1/kit-wrap'), lp(label(kitId))]), length: 32);
}

Uint8List _aad(List<int> accountId, int keyVersion, String kitId) {
  requireLength(accountId, 16, 'an account id');
  return concatBytes([label('kemlock/v1/root-wrap/kit'), accountId, u32be(keyVersion), lp(label(kitId))]);
}

/// Wraps [rootKey] under [kitKey] for the kit [kitId], bound to the account and its key version. [nonce] is random unless given, for
/// known-answer tests only.
Future<Uint8List> wrapRootWithKit({
  required Uint8List kitKey,
  required String kitId,
  required List<int> accountId,
  required int keyVersion,
  required List<int> rootKey,
  Uint8List? nonce,
}) async {
  requireLength(rootKey, rootKeyLength, 'the root key');
  final wrapKey = _wrapKey(kitKey, kitId);
  try {
    final sealed = await aesGcmEncrypt(wrapKey, rootKey, nonce: nonce, aad: _aad(accountId, keyVersion, kitId));
    return concatBytes([sealed.nonce, sealed.ct]);
  } finally {
    wipe(wrapKey);
  }
}

/// The root key [wrapped] holds, or a [CorruptedException] when the kit key, the kit id, the account or the key version isn't the one it
/// was made for. The caller wipes the root it gets.
Future<Uint8List> unwrapRootWithKit({
  required Uint8List kitKey,
  required String kitId,
  required List<int> accountId,
  required int keyVersion,
  required List<int> wrapped,
}) async {
  requireLength(wrapped, kitWrappedLength, 'a wrapped root key');
  final wrapKey = _wrapKey(kitKey, kitId);
  try {
    return await aesGcmDecrypt(wrapKey, wrapped.sublist(0, 12), wrapped.sublist(12), aad: _aad(accountId, keyVersion, kitId));
  } on AesGcmAuthError {
    throw const CorruptedException();
  } finally {
    wipe(wrapKey);
  }
}

/// A new kit for [rootKey]: three pieces, any two of which rebuild the kit key, and the root key's wrap. [random] is the source of every
/// random byte unless it is null, which is for tests.
Future<MadeKit> makeRecoveryKit({required List<int> rootKey, required List<int> accountId, required int keyVersion, Random? random}) async {
  final made = makeKit(kitThreshold, kitShares, random: random);
  try {
    final wrapped = await wrapRootWithKit(
      kitKey: made.key,
      kitId: made.kitId,
      accountId: accountId,
      keyVersion: keyVersion,
      rootKey: rootKey,
    );
    return MadeKit(kitId: made.kitId, pieces: made.pieces, keyVersion: keyVersion, wrappedKey: wrapped);
  } finally {
    wipe(made.key);
  }
}

/// What reading one piece found: its kit id, or the [PieceProblem] it has.
typedef PieceRead = ({String? kitId, int? index, PieceProblem? problem});

/// Reads one piece as it was typed.
PieceRead readPiece(String text) {
  try {
    final piece = parsePiece(text);
    return (kitId: piece.kitId, index: piece.index, problem: null);
  } on PieceError catch (e) {
    return (kitId: null, index: null, problem: e.problem);
  }
}

/// The problem the pieces have together (two of different kits, one twice), or null when they can be put together.
PieceProblem? checkPieces(List<String> texts) {
  try {
    var collected = <KitPiece>[];
    for (final text in texts) {
      collected = addPiece(collected, parsePiece(text));
    }
    return null;
  } on PieceError catch (e) {
    return e.problem;
  }
}

/// Opens the root key from [pieces] and the account's kit record. A [PieceError] says what is wrong with the pieces, and a
/// [CorruptedException] that they are of another kit or of an older key. The caller wipes the root it gets.
Future<Uint8List> openKitRoot({
  required List<String> pieces,
  required String kitId,
  required List<int> accountId,
  required int keyVersion,
  required List<int> wrapped,
}) async {
  var collected = <KitPiece>[];
  for (final text in pieces) {
    collected = addPiece(collected, parsePiece(text));
  }
  // A piece of another kit than the account's
  if (collected.any((piece) => piece.kitId != kitId)) throw const PieceError(PieceProblem.otherKit);
  final kitKey = rebuildKey(collected);
  try {
    return await unwrapRootWithKit(kitKey: kitKey, kitId: kitId, accountId: accountId, keyVersion: keyVersion, wrapped: wrapped);
  } finally {
    wipe(kitKey);
  }
}
