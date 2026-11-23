// An open vault's keys, sealed for `storage.session` (design decision 5): so a restarted background opens the vault again
// without asking for the password. The key that seals is random for the browser session and kept by the background in
// `storage.session` too, so a blob from another session, or one that was changed, doesn't open.
import 'dart:convert';
import 'dart:typed_data';

import 'package:kemlock_core/crypto/aes_gcm.dart';
import 'package:kemlock_core/crypto/bytes.dart';

/// What a sealed session holds.
class SealedSession {
  const SealedSession({required this.vault, required this.secretKey, required this.authenticated});

  /// The vault's id.
  final String vault;

  /// The vault's ML-KEM-1024 private key, from which its public key follows.
  final Uint8List secretKey;

  /// Whether the vault's values are authenticated (`VaultSession.authenticated`).
  final bool authenticated;
}

const _version = 1;

/// [session] sealed under the 32-byte [key]: the base64 of a 12-byte nonce, the ciphertext and its tag.
Future<String> sealSession(Uint8List key, SealedSession session) async {
  final plain = utf8.encode(
    jsonEncode({'v': _version, 'vault': session.vault, 'sk': b64(session.secretKey), 'authenticated': session.authenticated}),
  );
  final sealed = await aesGcmEncrypt(key, plain);
  return b64(concatBytes([sealed.nonce, sealed.ct]));
}

/// What [blob] holds, or null when it doesn't open under [key]: another browser session's, a changed one, or not one at all.
Future<SealedSession?> unsealSession(Uint8List key, String blob) async {
  try {
    final bytes = unb64(blob);
    if (bytes.length < 12 + 16) return null;
    final plain = await aesGcmDecrypt(key, bytes.sublist(0, 12), bytes.sublist(12));
    final json = jsonDecode(utf8.decode(plain));
    if (json is! Map<String, Object?> || json['v'] != _version) return null;
    final vault = json['vault'];
    final secretKey = json['sk'];
    if (vault is! String || vault.isEmpty || secretKey is! String) return null;
    return SealedSession(vault: vault, secretKey: unb64(secretKey), authenticated: json['authenticated'] == true);
  } on AesGcmAuthError {
    return null;
  } on FormatException {
    return null;
  }
}
