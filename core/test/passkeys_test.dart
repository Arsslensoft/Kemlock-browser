// The passkeys of the vault, and the core as a passkey provider: made, listed, found for a sign-in, signed and deleted, over a fake
// browser. The bytes themselves are held by Kemlock-core's own tests against the phone's fixture; these are the vault and the checks.
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/p256.dart';
import 'package:kemlock_core/features/passkeys/passkey_bytes.dart';
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/passkey_service.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const challenge = 'a2VtbG9jay1maXh0dXJlLWNoYWxsZW5nZQ';

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

Map<String, Object?> options({String? rpId = 'orbit.test', String userId = 'dXNlci0x', String name = 'sam@orbit.test', Object? exclude}) =>
    {
      'rp': {'id': ?rpId, 'name': 'Orbit'},
      'user': {'id': userId, 'name': name, 'displayName': 'Sam'},
      'challenge': challenge,
      'pubKeyCredParams': [
        {'type': 'public-key', 'alg': -7},
      ],
      'excludeCredentials': ?exclude,
    };

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Future<Map<String, Object?>> make(CoreService core, {String origin = 'https://app.orbit.test', Map<String, Object?>? body}) async =>
    (await core.call('createPasskey', [body ?? options(), origin]))! as Map<String, Object?>;

void main() {
  late MemoryArea area;
  late CoreService core;

  setUp(() async {
    area = MemoryArea();
    core = await startCore(area);
    await core.call('createVault', [password]);
  });

  test('the vault has no passkey at first, and every method needs it open', () async {
    expect(await list(core, 'passkeys'), isEmpty);
    await core.call('lock');
    await expectLater(core.call('passkeys'), failure(CoreFailure.locked));
    await expectLater(core.call('createPasskey', [options(), 'https://orbit.test']), failure(CoreFailure.locked));
    await expectLater(core.call('signPasskey', ['x', challenge, 'https://orbit.test']), failure(CoreFailure.locked));
    await expectLater(core.call('findPasskeys', ['orbit.test', <String>[]]), failure(CoreFailure.locked));
  });

  group('the relying party check', () {
    Future<Object?> check(String origin, [String? rpId]) => core.call('checkPasskeyRp', [origin, rpId]);

    test('answers the relying party a request from an origin may use', () async {
      expect(await check('https://app.orbit.test'), 'app.orbit.test');
      expect(await check('https://app.orbit.test', 'orbit.test'), 'orbit.test');
      expect(await check('http://localhost:8080'), 'localhost');
    });

    test('needs no open vault, only the Public Suffix List', () async {
      await core.call('lock');
      expect(await check('https://orbit.test', 'orbit.test'), 'orbit.test');
    });

    test('refuses another site, a public suffix, an address and an insecure origin', () async {
      await expectLater(check('https://orbit.test', 'evil.test'), failure(PasskeyFailures.security));
      await expectLater(check('https://orbit.test', 'test'), failure(PasskeyFailures.security));
      await expectLater(check('https://orbit.test.evil.io', 'orbit.test'), failure(PasskeyFailures.security));
      await expectLater(check('https://10.0.0.1'), failure(PasskeyFailures.security));
      await expectLater(check('http://orbit.test'), failure(PasskeyFailures.security));
    });
  });

  group('making a passkey', () {
    test('keeps it in the vault, with the key never shown, and answers the page’s registration', () async {
      final made = await make(core);
      final views = await list(core, 'passkeys');
      expect(views, hasLength(1));
      final view = views.single;
      expect(view['id'], made['passkeyId']);
      expect(view['rpId'], 'orbit.test');
      expect(view['rpName'], 'Orbit');
      expect(view['userName'], 'sam@orbit.test');
      expect(view['userDisplayName'], 'Sam');
      expect(view['name'], 'Orbit');
      expect(view['createdAt'], 1700000000000);
      expect(view['changedAt'], 1700000000000);
      expect(view.containsKey('privateKey'), isFalse);
      expect(jsonEncode(view), isNot(contains('MIG')));

      final response = made['response']! as Map<String, Object?>;
      expect(view['credentialId'], response['id']);
      final inner = response['response']! as Map<String, Object?>;
      final authData = unb64url(inner['authenticatorData']! as String);
      expect(authData.sublist(0, 32), rpIdHash('orbit.test'));
      expect(authData[32], 0x5D);
      expect(authData.sublist(37, 53), kemlockAaguidBytes);
      expect(
        utf8.decode(unb64url(inner['clientDataJSON']! as String)),
        '{"type":"webauthn.create","challenge":"$challenge","origin":"https://app.orbit.test","crossOrigin":false}',
      );
    });

    test('stays after the vault is locked and opened again, and in storage as the phone’s record', () async {
      final made = await make(core);
      await core.call('lock');
      await core.call('unlock', [password]);
      final view = (await list(core, 'passkeys')).single;
      expect(view['id'], made['passkeyId']);
      // Another run of the core over the same storage reads it too
      final again = await startCore(area);
      await again.call('unlock', [password]);
      expect((await list(again, 'passkeys')).single['id'], made['passkeyId']);
      // The vault's own list holds a record the app's model reads
      final held = again.vault.lists.passkeys.single;
      expect(held.rpId, 'orbit.test');
      expect(held.algorithm, coseEs256);
      expect(unb64url(held.credentialId), hasLength(16));
      expect(held.updatedAt, 1700000000000);
    });

    test('is for the origin’s relying party only: a request naming another site is refused and nothing is kept', () async {
      await expectLater(make(core, body: options(rpId: 'evil.test')), failure(PasskeyFailures.security));
      await expectLater(make(core, origin: 'http://orbit.test'), failure(PasskeyFailures.security));
      await expectLater(make(core, origin: 'https://orbit.test.evil.io'), failure(PasskeyFailures.security));
      expect(await list(core, 'passkeys'), isEmpty);
    });

    test('uses the origin’s host when the request names no relying party', () async {
      await make(core, body: options(rpId: null), origin: 'https://login.orbit.test');
      expect((await list(core, 'passkeys')).single['rpId'], 'login.orbit.test');
    });

    test('is refused for a site that takes no ES256, and one that excludes a credential the vault holds', () async {
      await expectLater(
        core.call('createPasskey', [
          {
            ...options(),
            'pubKeyCredParams': [
              {'type': 'public-key', 'alg': -257},
            ],
          },
          'https://orbit.test',
        ]),
        failure(PasskeyFailures.notSupported),
      );
      final made = await make(core);
      final id = (made['response']! as Map<String, Object?>)['id'];
      await expectLater(
        make(
          core,
          body: options(
            exclude: [
              {'type': 'public-key', 'id': id},
            ],
          ),
        ),
        failure(PasskeyFailures.invalidState),
      );
      expect(await list(core, 'passkeys'), hasLength(1));
      await expectLater(make(core, body: {...options(), 'challenge': ''}), failure(PasskeyFailures.encoding));
    });

    test('keeps a second passkey for the same account beside the first, as the phone does', () async {
      await make(core);
      await make(core);
      expect(await list(core, 'passkeys'), hasLength(2));
    });
  });

  group('signing in', () {
    test('finds the passkeys of exactly the relying party, narrowed by the credentials the site takes', () async {
      final first = await make(core);
      await make(
        core,
        body: options(rpId: 'other.test'),
        origin: 'https://other.test',
      );
      final second = await make(
        core,
        body: options(userId: 'dXNlci0y', name: 'alex@orbit.test'),
      );
      expect(await list(core, 'findPasskeys', ['orbit.test', <String>[]]), hasLength(2));
      expect(await list(core, 'findPasskeys', ['app.orbit.test', <String>[]]), isEmpty);
      expect(await list(core, 'findPasskeys', ['other.test', <String>[]]), hasLength(1));
      final secondId = ((second['response']! as Map<String, Object?>)['id'])! as String;
      final found = await list(core, 'findPasskeys', [
        'orbit.test',
        [secondId, 'AAAA'],
      ]);
      expect([for (final p in found) p['id']], [second['passkeyId']]);
      expect(found.single['userName'], 'alex@orbit.test');
      expect(first['passkeyId'], isNot(second['passkeyId']));
    });

    test('signs the challenge for the passkey, and the signature verifies with the key the page was given', () async {
      final made = await make(core);
      final registration = (made['response']! as Map<String, Object?>)['response']! as Map<String, Object?>;
      final spki = unb64url(registration['publicKey']! as String);
      final point = Uint8List.fromList(spki.sublist(spki.length - 65));
      final response = (await core.call('signPasskey', [made['passkeyId'], challenge, 'https://app.orbit.test']))! as Map<String, Object?>;
      expect(response['id'], (made['response']! as Map<String, Object?>)['id']);
      final inner = response['response']! as Map<String, Object?>;
      final clientData = unb64url(inner['clientDataJSON']! as String);
      expect(
        utf8.decode(clientData),
        '{"type":"webauthn.get","challenge":"$challenge","origin":"https://app.orbit.test","crossOrigin":false}',
      );
      final authData = unb64url(inner['authenticatorData']! as String);
      expect(authData.sublist(0, 32), rpIdHash('orbit.test'));
      expect(authData[32], 0x1D);
      expect(authData.sublist(33), [0, 0, 0, 0]);
      final signed = Uint8List.fromList([...authData, ...sha256.convert(clientData).bytes]);
      expect(es256Verify(point, signed, unb64url(inner['signature']! as String)), isTrue);
      expect(unb64url(inner['userHandle']! as String), utf8.encode('user-1'));
    });

    test('keeps the counter at 0 however many times it signs', () async {
      final made = await make(core);
      for (var i = 0; i < 3; i++) {
        final response = (await core.call('signPasskey', [made['passkeyId'], challenge, 'https://orbit.test']))! as Map<String, Object?>;
        final authData = unb64url((response['response']! as Map<String, Object?>)['authenticatorData']! as String);
        expect(authData.sublist(33), [0, 0, 0, 0]);
      }
    });

    test('is refused from an origin that is not the passkey’s site, and for a passkey the vault does not hold', () async {
      final made = await make(core);
      await expectLater(core.call('signPasskey', [made['passkeyId'], challenge, 'https://evil.test']), failure(PasskeyFailures.security));
      await expectLater(core.call('signPasskey', [made['passkeyId'], challenge, 'http://orbit.test']), failure(PasskeyFailures.security));
      // A parent domain is not the passkey's relying party
      await expectLater(core.call('signPasskey', [made['passkeyId'], challenge, 'https://test']), failure(PasskeyFailures.security));
      await expectLater(core.call('signPasskey', ['nope', challenge, 'https://orbit.test']), failure(CoreFailure.notFound));
      await expectLater(core.call('signPasskey', [made['passkeyId'], '', 'https://orbit.test']), failure(PasskeyFailures.encoding));
      await expectLater(core.call('signPasskey', [made['passkeyId'], '!!', 'https://orbit.test']), failure(PasskeyFailures.encoding));
    });

    test('names the top origin for a frame of another origin', () async {
      final made = await make(core);
      final response =
          (await core.call('signPasskey', [made['passkeyId'], challenge, 'https://orbit.test', 'https://embedder.test']))!
              as Map<String, Object?>;
      final clientData = utf8.decode(unb64url((response['response']! as Map<String, Object?>)['clientDataJSON']! as String));
      expect(clientData, contains('"crossOrigin":true,"topOrigin":"https://embedder.test"'));
    });
  });

  group('deleting', () {
    test('removes only that passkey, and it stays gone', () async {
      final a = await make(core);
      final b = await make(core, body: options(userId: 'dXNlci0y'));
      await core.call('deletePasskey', [a['passkeyId']]);
      expect([for (final p in await list(core, 'passkeys')) p['id']], [b['passkeyId']]);
      await core.call('lock');
      await core.call('unlock', [password]);
      expect([for (final p in await list(core, 'passkeys')) p['id']], [b['passkeyId']]);
      await expectLater(core.call('deletePasskey', [a['passkeyId']]), failure(CoreFailure.notFound));
    });

    test('is a change sync carries: the vault counts it as one made in the browser', () async {
      final made = await make(core);
      final before = core.vault.revision;
      await core.call('deletePasskey', [made['passkeyId']]);
      expect(core.vault.revision, before + 1);
    });
  });

  group('the site in front', () {
    test('names the passkeys of its host and the domains above it, in the match', () async {
      final made = await make(core);
      final other = await make(
        core,
        body: options(rpId: 'other.test'),
        origin: 'https://other.test',
      );
      final at = (await core.call('match', ['https://app.orbit.test/signin']))! as Map<String, Object?>;
      expect(at['passkeys'], [made['passkeyId']]);
      expect(at['site'], 'orbit.test');
      final elsewhere = (await core.call('match', ['https://other.test/']))! as Map<String, Object?>;
      expect(elsewhere['passkeys'], [other['passkeyId']]);
      // A site whose name only ends alike, and a parent of the relying party, get none
      final lookalike = (await core.call('match', ['https://notorbit.test/']))! as Map<String, Object?>;
      expect(lookalike.containsKey('passkeys'), isFalse);
      final parent = (await core.call('match', ['https://test/']))! as Map<String, Object?>;
      expect(parent.containsKey('passkeys'), isFalse);
    });
  });

  group('the setting', () {
    test('is on by default, can be turned off and keeps what was saved', () async {
      expect((await core.call('settings'))! as Map<String, Object?>, containsPair('passkeys', true));
      await core.call('saveSettings', [
        {'passkeys': false},
      ]);
      expect((await core.call('settings'))! as Map<String, Object?>, containsPair('passkeys', false));
      await core.call('saveSettings', [
        {'passkeys': 'no'},
      ]);
      expect((await core.call('settings'))! as Map<String, Object?>, containsPair('passkeys', false));
    });
  });

  test('a passkey the phone made, in the vault, is listed and signs here', () async {
    // The phone's record: PKCS#8 key in base64, ids in base64url, algorithm -7 (test/fixtures/passkeys in the phone's repository)
    final key = P256KeyPair.fromScalar(Uint8List.fromList(List.generate(32, (i) => i + 1)));
    final phones = Passkey(
      id: 'from-the-phone',
      credentialId: 'AAECAwQFBgcICQoLDA0ODw',
      rpId: 'orbit.test',
      rpName: 'Orbit',
      userHandle: 'dXNlci0x',
      userName: 'sam@orbit.test',
      privateKey: b64(key.toPkcs8()),
      addedAt: 1,
    );
    await core.vault.savePasskeys([phones]);
    expect((await list(core, 'passkeys')).single['id'], 'from-the-phone');
    final response = (await core.call('signPasskey', ['from-the-phone', challenge, 'https://orbit.test']))! as Map<String, Object?>;
    final inner = response['response']! as Map<String, Object?>;
    final clientData = unb64url(inner['clientDataJSON']! as String);
    final signed = Uint8List.fromList([...unb64url(inner['authenticatorData']! as String), ...sha256.convert(clientData).bytes]);
    expect(es256Verify(key.point, signed, unb64url(inner['signature']! as String)), isTrue);
    expect(response['id'], 'AAECAwQFBgcICQoLDA0ODw');
  });
}
