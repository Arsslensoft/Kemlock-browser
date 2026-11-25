// What a screen needs to show and compare a fingerprint
// (docs/plans/add-server-spaces.md, design 1). The fingerprint itself is the
// account crypto's (`crypto/account/bundle.dart`): `SHA-512("kemlock/v1/fingerprint"
// || bundle)`, shown as 12 groups of 5 digits and as a QR code of the 64
// bytes. This file only lays the groups out for reading aloud, writes and reads
// the QR's text, and compares what a scan gave with the bundle the server
// served, in constant time.
//
// Pure Dart, no Flutter, so the move into `packages/kemlock_core` takes it as it is.

library;

import 'dart:typed_data';

import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/account/encoding.dart';

/// How many groups sit in a row of the confirm sheet: 12 groups of 5 digits are read out in three rows of
/// four, which takes less care than one line of 60 digits.
const fingerprintGroupsPerRow = 4;

/// The 12 groups of 5 digits of [fingerprint] (64 bytes) in rows of [fingerprintGroupsPerRow].
List<List<String>> fingerprintRows(List<int> fingerprint) {
  final groups = fingerprintDigitsOf(fingerprint).split(' ');
  return [
    for (var start = 0; start < groups.length; start += fingerprintGroupsPerRow) groups.sublist(start, start + fingerprintGroupsPerRow),
  ];
}

/// The text a fingerprint's QR code holds: the 64 bytes as base64url without padding, 86 characters.
// server: to confirm
// crypto.md fixes the 64 bytes a QR code carries, not the text form around them, so the web vault and
// Amethystora Vault must write the same one for a scan from either to compare.
String fingerprintQrText(List<int> fingerprint) => b64urlEncode(requireLength(fingerprint, 64, 'a fingerprint'));

/// The 64 bytes in a QR code's [text], or null when it isn't [fingerprintQrText]'s form.
Uint8List? readFingerprintQr(String text) {
  try {
    final bytes = b64urlDecode(text.trim());
    return bytes.length == 64 ? bytes : null;
  } on MalformedException {
    return null;
  }
}

/// What comparing a scanned code with a bundle found.
enum FingerprintCheck {
  /// The scan is the bundle's own fingerprint: the person need not read out the digits.
  match,

  /// The scan is a fingerprint, and another one: someone else's key is in the way, or the wrong person was scanned.
  mismatch,

  /// The code isn't a fingerprint.
  unreadable,
}

/// Compares the QR code's [text] with [bundle]'s fingerprint, the one computed from the bundle the server gave for
/// the member, never one the server sent beside it.
FingerprintCheck checkScannedFingerprint(String text, KeyBundle bundle) {
  final scanned = readFingerprintQr(text);
  if (scanned == null) {
    return FingerprintCheck.unreadable;
  }
  return fingerprintsMatch(scanned, bundle.fingerprint) ? FingerprintCheck.match : FingerprintCheck.mismatch;
}
