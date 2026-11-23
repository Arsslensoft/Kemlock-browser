import 'dart:typed_data';

import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_extension_core/src/session_seal.dart';
import 'package:test/test.dart';

void main() {
  final key = Uint8List.fromList(List.generate(32, (i) => i));
  final session = SealedSession(vault: 'main', secretKey: randomBytes(3168), authenticated: true);

  test('a sealed session opens with the key that sealed it', () async {
    final blob = await sealSession(key, session);
    final opened = await unsealSession(key, blob);
    expect(opened, isNotNull);
    expect(opened!.vault, 'main');
    expect(opened.secretKey, session.secretKey);
    expect(opened.authenticated, isTrue);
  });

  test('each seal has its own nonce', () async {
    expect(await sealSession(key, session), isNot(await sealSession(key, session)));
  });

  test('another browser session\'s key does not open it', () async {
    final blob = await sealSession(key, session);
    expect(await unsealSession(Uint8List.fromList(List.filled(32, 7)), blob), isNull);
  });

  test('a changed blob does not open', () async {
    final bytes = unb64(await sealSession(key, session));
    bytes[bytes.length - 1] ^= 1;
    expect(await unsealSession(key, b64(bytes)), isNull);
    bytes[20] ^= 1;
    expect(await unsealSession(key, b64(bytes)), isNull);
  });

  test('what is not a blob does not open', () async {
    expect(await unsealSession(key, ''), isNull);
    expect(await unsealSession(key, 'AAAA'), isNull);
    expect(await unsealSession(key, 'not base64 !!'), isNull);
  });

  test('a session that was not authenticated stays so', () async {
    final blob = await sealSession(key, SealedSession(vault: 'abc123', secretKey: randomBytes(32), authenticated: false));
    final opened = await unsealSession(key, blob);
    expect(opened!.authenticated, isFalse);
    expect(opened.vault, 'abc123');
  });
}
