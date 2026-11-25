// Copied from the Kemlock app (mobile/lib/features/recovery/recovery_shares.dart): the Recovery Kit's piece text, which the web vault's
// pieces match byte for byte (docs/crypto.md, "The Recovery Kit").
/// Recovery Kit pieces as text, for a QR code or for typing in by hand, as
/// `recoveryShares.ts` writes them:
///
///     BMCKIT1-<kit id>-<needed><made><piece>-<key share>-<check>
///
/// The kit id (8 base32 chars) ties pieces of one kit together, the three digits
/// say how many pieces rebuild the key, how many were made and which this is,
/// the key share is 52 base32 chars, and the check (the start of a SHA-256 of the
/// rest) catches a mistyped piece before it's used.
library;

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import 'kit_shamir.dart';

const _prefix = 'BMCKIT1';
const _alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const _keyBytes = 32;

/// The most pieces a kit has. Single digits keep the format fixed; nine
/// pieces is plenty to hand out.
const maxPieces = 9;

/// One piece of a Recovery Kit, read from its text.
class KitPiece {
  const KitPiece({required this.kitId, required this.threshold, required this.shares, required this.index, required this.y});

  /// Ties the pieces of one kit together.
  final String kitId;

  /// Pieces needed to rebuild the key.
  final int threshold;

  /// Pieces made.
  final int shares;

  /// This piece's number, 1-based.
  final int index;

  /// This piece's share of the kit key.
  final Uint8List y;
}

/// What is wrong with a piece, or with the pieces collected so far.
enum PieceProblem {
  /// Not a Recovery Kit piece at all.
  format,

  /// A piece with a typo: its check doesn't match.
  checksum,

  /// A piece of another kit than the ones collected.
  otherKit,

  /// A piece already collected.
  duplicate,

  /// Fewer pieces than the kit needs.
  notEnough,
}

/// Thrown with the [problem] a piece has.
class PieceError implements Exception {
  const PieceError(this.problem);

  final PieceProblem problem;

  @override
  String toString() => 'Recovery Kit piece: ${problem.name}';
}

String _base32(List<int> bytes) {
  var bits = 0;
  var value = 0;
  final out = StringBuffer();
  for (final byte in bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out.write(_alphabet[(value >> (bits - 5)) & 31]);
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out.write(_alphabet[(value << (5 - bits)) & 31]);
  return out.toString();
}

/// Bits past the last whole byte are dropped, whatever they are.
Uint8List _unbase32(String text) {
  var bits = 0;
  var value = 0;
  final out = <int>[];
  for (final char in text.split('')) {
    final v = _alphabet.indexOf(char);
    if (v == -1) throw const PieceError(PieceProblem.format);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.add((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8List.fromList(out);
}

String _checkOf(String body) => _base32(sha256.convert(utf8.encode(body)).bytes).substring(0, 4);

final _secure = Random.secure();

Uint8List _randomBytes(Random random, int length) => Uint8List.fromList([for (var i = 0; i < length; i++) random.nextInt(256)]);

/// A new random kit key split into [shares] pieces, any [threshold] of which
/// rebuild it.
///
/// [random], `Random.secure()` unless given, is drawn from byte by byte: the
/// key, then the kit id, then the split's coefficients. Throws a [RangeError]
/// for more than [maxPieces] pieces, or a threshold [split] refuses.
({String kitId, Uint8List key, List<String> pieces}) makeKit(int threshold, int shares, {Random? random}) {
  if (shares > maxPieces) throw RangeError('At most $maxPieces pieces');
  final source = random ?? _secure;
  final key = _randomBytes(source, _keyBytes);
  final kitId = _base32(_randomBytes(source, 5));
  final pieces = [
    for (final share in split(key, threshold, shares, random: source))
      pieceText(KitPiece(kitId: kitId, threshold: threshold, shares: shares, index: share.x, y: share.y)),
  ];
  return (kitId: kitId, key: key, pieces: pieces);
}

/// The piece's text, with its check.
String pieceText(KitPiece piece) {
  final body = '$_prefix-${piece.kitId}-${piece.threshold}${piece.shares}${piece.index}-${_base32(piece.y)}';
  return '$body-${_checkOf(body)}';
}

final _groupsOfFour = RegExp('.{1,4}');

/// The piece with its long share broken into groups of four, for print and
/// reading aloud.
String displayPiece(String text) {
  final parts = text.split('-');
  // Like the JavaScript, text with fewer parts gets empty ones up to the share
  while (parts.length < 4) {
    parts.add('');
  }
  parts[3] = _groupsOfFour.allMatches(parts[3]).map((m) => m[0]!).join(' ');
  return parts.join('-');
}

final _whitespace = RegExp(r'\s+');
final _kitId = RegExp(r'^[A-Z2-7]{8}$');
final _digits = RegExp(r'^\d{3}$');
final _share = RegExp(r'^[A-Z2-7]{52}$');

/// Reads a piece however it was typed: any case, with or without spaces.
///
/// Throws a [PieceError]: [PieceProblem.format] for text that isn't a piece,
/// [PieceProblem.checksum] for a piece whose check doesn't match.
KitPiece parsePiece(String input) {
  final text = input.toUpperCase().replaceAll(_whitespace, '');
  final parts = text.split('-');
  if (parts.length != 5 || parts[0] != _prefix) throw const PieceError(PieceProblem.format);
  final [_, kitId, digits, share, check] = parts;
  if (!_kitId.hasMatch(kitId) || !_digits.hasMatch(digits) || !_share.hasMatch(share)) {
    throw const PieceError(PieceProblem.format);
  }
  if (_checkOf(parts.sublist(0, 4).join('-')) != check) throw const PieceError(PieceProblem.checksum);
  final [threshold, shares, index] = [for (final digit in digits.split('')) int.parse(digit)];
  if (threshold < 1 || threshold > shares || index < 1 || index > shares) {
    throw const PieceError(PieceProblem.format);
  }
  return KitPiece(kitId: kitId, threshold: threshold, shares: shares, index: index, y: _unbase32(share).sublist(0, _keyBytes));
}

/// Adds a piece to the ones collected so far, refusing another kit's or a
/// repeat with a [PieceError].
List<KitPiece> addPiece(List<KitPiece> collected, KitPiece piece) {
  if (collected.isNotEmpty && collected[0].kitId != piece.kitId) {
    throw const PieceError(PieceProblem.otherKit);
  }
  if (collected.any((p) => p.index == piece.index)) throw const PieceError(PieceProblem.duplicate);
  return [...collected, piece];
}

/// The kit key, once enough pieces of one kit are in; a [PieceError] with
/// [PieceProblem.notEnough] before.
Uint8List rebuildKey(List<KitPiece> pieces) {
  if (pieces.isEmpty || pieces.length < pieces[0].threshold) {
    throw const PieceError(PieceProblem.notEnough);
  }
  return combine([for (final p in pieces) Share(x: p.index, y: p.y)]);
}
