// Copied from the Kemlock app (mobile/lib/features/recovery/shamir.dart): the Recovery Kit's split, which the web vault's pieces match byte
// for byte (docs/crypto.md, "The Recovery Kit").
/// Shamir's secret sharing over GF(2^8), the AES field (x^8 + x^4 + x^3 + x + 1),
/// as `shamir.ts` does it. Each byte of the secret is the constant term of its own
/// random polynomial of degree threshold − 1, and a share is that polynomial
/// evaluated at x. Any `threshold` shares rebuild the secret by interpolating at 0;
/// fewer reveal nothing.
library;

import 'dart:math';
import 'dart:typed_data';

/// exp[i] is 3^i, written out twice so a sum of two logs needs no reduction;
/// log is its inverse.
final ({Uint8List exp, Uint8List log}) _tables = () {
  final exp = Uint8List(510);
  final log = Uint8List(256);
  var x = 1;
  for (var i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    // Multiply by the generator 3: x·2 ⊕ x, reducing x·2 by the field polynomial
    var doubled = x << 1;
    if (doubled & 0x100 != 0) doubled ^= 0x11b;
    x = doubled ^ x;
  }
  for (var i = 255; i < 510; i++) {
    exp[i] = exp[i - 255];
  }
  return (exp: exp, log: log);
}();

int _mul(int a, int b) => a == 0 || b == 0 ? 0 : _tables.exp[_tables.log[a] + _tables.log[b]];

int _div(int a, int b) {
  if (b == 0) throw RangeError('Division by zero in GF(256)');
  return a == 0 ? 0 : _tables.exp[_tables.log[a] + 255 - _tables.log[b]];
}

/// One share of a split secret.
class Share {
  const Share({required this.x, required this.y});

  /// Where the polynomials were evaluated, 1–255.
  final int x;

  /// The polynomials' values there, one byte per byte of the secret.
  final Uint8List y;
}

final _secure = Random.secure();

Uint8List _randomBytes(Random random, int length) => Uint8List.fromList([for (var i = 0; i < length; i++) random.nextInt(256)]);

/// Splits [secret] into [count] shares, any [threshold] of which rebuild it.
///
/// The polynomials' coefficients come from [random], `Random.secure()` unless
/// given, drawn byte by byte: all of the x coefficients, then all of the x²
/// ones, and so on. Throws a [RangeError] unless 1 ≤ threshold ≤ count ≤ 255.
List<Share> split(Uint8List secret, int threshold, int count, {Random? random}) {
  if (threshold < 1 || threshold > count || count > 255) {
    throw RangeError('Need 1 ≤ threshold ≤ count ≤ 255');
  }
  // coefficients[j][i]: the x^(j+1) coefficient of byte i's polynomial
  final coefficients = [for (var j = 0; j < threshold - 1; j++) _randomBytes(random ?? _secure, secret.length)];
  final shares = <Share>[];
  for (var x = 1; x <= count; x++) {
    final y = Uint8List(secret.length);
    for (var i = 0; i < secret.length; i++) {
      // Horner's rule, highest power first
      var value = 0;
      for (var j = coefficients.length - 1; j >= 0; j--) {
        value = _mul(value ^ coefficients[j][i], x);
      }
      y[i] = value ^ secret[i];
    }
    shares.add(Share(x: x, y: y));
  }
  return shares;
}

/// Rebuilds the secret from at least `threshold` distinct shares of one split.
///
/// Fewer shares give a wrong answer, not an error. Throws a [RangeError] for no
/// shares, two shares with the same x, or shares of different lengths.
Uint8List combine(List<Share> shares) {
  if (shares.isEmpty) throw RangeError('No shares');
  final length = shares[0].y.length;
  final xs = [for (final share in shares) share.x];
  if (xs.toSet().length != xs.length) throw RangeError('Duplicate shares');
  if (shares.any((s) => s.x < 1 || s.x > 255 || s.y.length != length)) {
    throw RangeError('Shares from different splits');
  }
  // Lagrange basis at 0: Π x_j / (x_j ⊕ x_i) over j ≠ i (subtraction is ⊕ in GF(2^8))
  final basis = List.filled(shares.length, 1);
  for (var i = 0; i < shares.length; i++) {
    for (var j = 0; j < shares.length; j++) {
      if (j != i) basis[i] = _mul(basis[i], _div(shares[j].x, shares[j].x ^ shares[i].x));
    }
  }
  final secret = Uint8List(length);
  for (var b = 0; b < length; b++) {
    var value = 0;
    for (var i = 0; i < shares.length; i++) {
      value ^= _mul(shares[i].y[b], basis[i]);
    }
    secret[b] = value;
  }
  return secret;
}
