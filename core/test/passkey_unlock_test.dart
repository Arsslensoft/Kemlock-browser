// Unlocking with a passkey, Windows Hello or a security key: the key slot that wraps the vault's private key, the rules for when
// the password is needed instead, and that the password and a changed password keep working (docs/plans/add-passkey-unlock.md).
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/crypto/aes_gcm.dart';
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/ml_kem.dart';
import 'package:kemlock_core/vault/sealed_value.dart' show isAuthenticatedWrapNonce;
import 'package:kemlock_extension_core/src/browser.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/passkey_unlock.dart';
import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

/// 32 bytes an authenticator would give: a different set for each [seed].
Uint8List prfOf(int seed) => Uint8List.fromList(List.generate(32, (i) => (i * 7 + seed) % 256));

Uint8List credentialOf(int seed) => Uint8List.fromList(List.generate(20, (i) => (i * 11 + seed) % 256));

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

/// A core over [area] whose clock is the returned box's.
Future<(CoreService, List<DateTime>)> coreAt(MemoryArea area, DateTime start) async {
  final box = [start];
  final core = await CoreService.start(fakePlatform(area, clock: () => box.first), const CoreData());
  return (core, box);
}

/// Adds a credential made from [seed], as the unlock page would after its ceremony.
Future<Map<String, Object?>> enrol(CoreService core, int seed, {String name = 'Windows Hello', String? rpId}) async {
  await core.call('passkeyUnlockPrepare');
  return object(core, 'addPasskeyUnlock', [
    {
      'name': name,
      'password': password,
      'credentialId': b64url(credentialOf(seed)),
      'prfOutput': b64url(prfOf(seed)),
      'rpId': ?rpId,
      'attachment': 'platform',
    },
  ]);
}

Future<Map<String, Object?>> unlockBy(CoreService core, int seed, {int? prfSeed}) => object(core, 'unlockWithPasskey', [
  {'credentialId': b64url(credentialOf(seed)), 'prfOutput': b64url(prfOf(prfSeed ?? seed))},
]);

void main() {
  late MemoryArea area;
  late CoreService core;
  late List<DateTime> clock;

  setUp(() async {
    area = MemoryArea();
    (core, clock) = await coreAt(area, DateTime.utc(2026, 11, 24, 10));
    await core.call('createVault', [password]);
    await core.call('saveLogin', [
      null,
      {
        'name': 'Orbit',
        'username': 'sam',
        'password': 'p4ss',
        'websites': ['orbit-cloud.com'],
      },
    ]);
  });

  group('the key slot', () {
    test('wraps the private key under the PRF output, and only that output, that vault and that credential open it', () async {
      final secret = Uint8List.fromList(List.generate(64, (i) => i));
      final salt = prfOf(1);
      final wrapped = await wrapForPasskey(
        secretKey: secret,
        prf: prfOf(2),
        salt: salt,
        vault: 'main',
        credential: credentialOf(3),
        authenticated: true,
      );
      PasskeySlot slot(Uint8List credential) =>
          PasskeySlot(id: 'a', credential: credential, name: 'k', addedAt: 0, nonce: wrapped.nonce, ct: wrapped.ct);
      Future<OpenedSlot> open({Uint8List? prf, Uint8List? credential, String vault = 'main'}) =>
          unwrapPasskeySlot(slot: slot(credential ?? credentialOf(3)), prf: prf ?? prfOf(2), salt: salt, vault: vault);

      final opened = await open();
      expect(opened.secretKey, secret);
      expect(opened.authenticated, isTrue);
      await expectLater(open(prf: prfOf(9)), throwsA(isA<AesGcmAuthError>()));
      await expectLater(open(vault: 'other'), throwsA(isA<AesGcmAuthError>()));
      await expectLater(open(credential: credentialOf(4)), throwsA(isA<AesGcmAuthError>()));
    });

    test('says the values are authenticated only when the vault\'s wrap does', () async {
      final plain = await wrapForPasskey(
        secretKey: Uint8List(32),
        prf: prfOf(1),
        salt: prfOf(2),
        vault: 'main',
        credential: credentialOf(1),
        authenticated: false,
      );
      expect(isAuthenticatedWrapNonce(b64(plain.nonce)), isFalse);
      final sealed = await wrapForPasskey(
        secretKey: Uint8List(32),
        prf: prfOf(1),
        salt: prfOf(2),
        vault: 'main',
        credential: credentialOf(1),
        authenticated: true,
      );
      expect(isAuthenticatedWrapNonce(b64(sealed.nonce)), isTrue);
    });
  });

  group('turning it on', () {
    test('asks for a salt first, and lists nothing until a credential is added', () async {
      expect(await object(core, 'passkeyUnlockInfo'), {'credentials': <Object?>[]});
      final prepared = await object(core, 'passkeyUnlockPrepare');
      expect(unb64url(prepared['salt']! as String), hasLength(32));
      expect(prepared['exclude'], isEmpty);
      // Asked again, the same salt: one challenge serves every credential
      expect(await object(core, 'passkeyUnlockPrepare'), prepared);
      expect(await object(core, 'passkeyUnlockInfo'), {'credentials': <Object?>[]});
    });

    test('keeps ciphertext and public values only, under a key of its own', () async {
      final info = await enrol(core, 1, rpId: 'unlock.kemlock.test');
      final credential = (info['credentials']! as List<Object?>).single! as Map<String, Object?>;
      expect(credential['name'], 'Windows Hello');
      expect(credential['credentialId'], b64url(credentialOf(1)));
      expect(credential['attachment'], 'platform');
      expect(credential['addedAt'], clock.first.millisecondsSinceEpoch);
      expect(info['rpId'], 'unlock.kemlock.test');
      expect(info.containsKey('passwordRequired'), isFalse);

      final stored = area.values['backmycodes_extension_passkey_unlock']!;
      final record = jsonDecode(stored) as Map<String, Object?>;
      expect(record['v'], 1);
      expect(record['rp'], 'unlock.kemlock.test');
      final secret = core.vault.session!.secretKey;
      // Nothing of the private key or of the PRF output is in what is stored
      expect(stored, isNot(contains(b64(secret))));
      expect(stored, isNot(contains(b64(prfOf(1)))));
      expect(stored, isNot(contains(b64url(prfOf(1)))));
      // A new vault's values are authenticated, and the slot's wrap says so
      final slot = (record['slots']! as List<Object?>).single! as Map<String, Object?>;
      expect(isAuthenticatedWrapNonce(slot['nonce']), isTrue);
    });

    test('needs the vault open, a prepared salt, a 32-byte output and a credential not there yet', () async {
      await expectLater(
        core.call('addPasskeyUnlock', [
          {'name': 'A', 'password': password, 'credentialId': b64url(credentialOf(1)), 'prfOutput': b64url(prfOf(1))},
        ]),
        failure(CoreFailure.invalid),
      );
      await core.call('passkeyUnlockPrepare');
      await expectLater(
        core.call('addPasskeyUnlock', [
          {'name': 'A', 'password': password, 'credentialId': b64url(credentialOf(1)), 'prfOutput': b64url(Uint8List(16))},
        ]),
        failure(CoreFailure.invalid),
      );
      await enrol(core, 1);
      await expectLater(enrol(core, 1), failure(CoreFailure.duplicate));
      await core.call('lock');
      await expectLater(core.call('passkeyUnlockPrepare'), failure(CoreFailure.locked));
      await expectLater(
        core.call('addPasskeyUnlock', [
          {'name': 'A', 'password': password, 'credentialId': b64url(credentialOf(2)), 'prfOutput': b64url(prfOf(2))},
        ]),
        failure(CoreFailure.locked),
      );
      await expectLater(core.call('removePasskeyUnlock', ['x']), failure(CoreFailure.locked));
    });

    test('allows several credentials, each named, and tells the authenticator not to make one again', () async {
      await enrol(core, 1, name: 'Windows Hello');
      final info = await enrol(core, 2, name: 'YubiKey 5');
      expect([for (final c in info['credentials']! as List<Object?>) (c! as Map<String, Object?>)['name']], ['Windows Hello', 'YubiKey 5']);
      final prepared = await object(core, 'passkeyUnlockPrepare');
      expect(prepared['exclude'], [b64url(credentialOf(1)), b64url(credentialOf(2))]);
    });

    test('keeps one relying party for every credential', () async {
      await enrol(core, 1, rpId: 'a.example');
      await expectLater(enrol(core, 2, rpId: 'b.example'), failure(CoreFailure.invalid));
      await expectLater(enrol(core, 2), failure(CoreFailure.invalid));
    });
  });

  group('unlocking', () {
    setUp(() async {
      await enrol(core, 1);
      await core.call('lock');
    });

    test('opens the vault with the right answer, with what it held, and clears the wrong passwords', () async {
      expect(await object(core, 'unlock', ['wrong']), {'ok': false, 'wrongPasswords': 1});
      expect(await unlockBy(core, 1), {'ok': true, 'wrongPasswords': 1});
      final state = await object(core, 'state');
      expect(state['unlocked'], isTrue);
      expect(state['wrongPasswords'], 0);
      expect(((await core.call('logins'))! as List<Object?>).cast<Map<String, Object?>>().single['name'], 'Orbit');
      expect(await core.call('revealLogin', [(((await core.call('logins'))! as List<Object?>).single! as Map<String, Object?>)['id']]), {
        'username': 'sam',
        'password': 'p4ss',
      });
    });

    test('rejects an answer from another authenticator, an unknown credential and a bad length, and stays locked', () async {
      expect(await unlockBy(core, 1, prfSeed: 2), {'ok': false, 'wrongPasswords': 0, 'reason': 'wrong'});
      expect(await unlockBy(core, 5), {'ok': false, 'wrongPasswords': 0, 'reason': 'wrong'});
      expect((await object(core, 'state'))['unlocked'], isFalse);
      await expectLater(
        object(core, 'unlockWithPasskey', [
          {'credentialId': b64url(credentialOf(1)), 'prfOutput': b64url(Uint8List(8))},
        ]),
        completion(containsPair('ok', false)),
      );
      expect((await object(core, 'state'))['unlocked'], isFalse);
    });

    test('leaves the password working, and the wrong-password count as it was', () async {
      expect(await unlockBy(core, 1, prfSeed: 2), containsPair('ok', false));
      expect((await object(core, 'state'))['wrongPasswords'], 0);
      expect(await object(core, 'unlock', [password]), {'ok': true, 'wrongPasswords': 0});
    });

    test('is not offered to an answer that opens nothing when no passkey is set up', () async {
      final bare = await startCore(MemoryArea());
      await bare.call('createVault', [password]);
      await bare.call('lock');
      await expectLater(unlockBy(bare, 1), failure(CoreFailure.notFound));
    });

    test('says when the credential\'s key is not the vault\'s any more, and the password still opens it', () async {
      // A slot that wraps another private key: what a replaced key pair leaves behind
      await core.call('unlock', [password]);
      final stale = MlKem1024.keygen().secretKey;
      await core.vault.passkeyUnlock.add(secretKey: stale, authenticated: true, credential: credentialOf(7), prf: prfOf(7), name: 'Old');
      await core.call('lock');
      expect(await unlockBy(core, 7), {'ok': false, 'wrongPasswords': 0, 'reason': 'stale'});
      expect((await object(core, 'state'))['unlocked'], isFalse);
      expect(await object(core, 'unlock', [password]), containsPair('ok', true));
    });

    test('says the same of bytes that are no private key at all, and does not throw', () async {
      await core.call('unlock', [password]);
      await core.vault.passkeyUnlock.add(
        secretKey: Uint8List.fromList(List.generate(40, (i) => i)),
        authenticated: true,
        credential: credentialOf(8),
        prf: prfOf(8),
        name: 'Garbage',
      );
      await core.call('lock');
      expect(await unlockBy(core, 8), {'ok': false, 'wrongPasswords': 0, 'reason': 'stale'});
      expect((await object(core, 'state'))['unlocked'], isFalse);
    });

    test('leaves an open vault as it is: no second copy of its keys, no failed try counted', () async {
      await core.call('unlock', [password]);
      final held = core.vault.session!;
      expect(await unlockBy(core, 1, prfSeed: 2), {'ok': true, 'wrongPasswords': 0});
      expect(core.vault.session, same(held));
      expect(held.secretKey.any((byte) => byte != 0), isTrue);
      expect(area.values.containsKey('backmycodes_extension_passkey_failures'), isFalse);
    });
  });

  group('when the password is required', () {
    setUp(() async {
      await enrol(core, 1);
      await core.call('lock');
    });

    test('after five failed passkey tries in a row, whatever the sixth answer is', () async {
      for (var i = 0; i < 4; i++) {
        expect(await unlockBy(core, 1, prfSeed: 2), containsPair('reason', 'wrong'));
      }
      expect((await object(core, 'passkeyUnlockInfo')).containsKey('passwordRequired'), isFalse);
      expect(await unlockBy(core, 1, prfSeed: 2), containsPair('reason', 'wrong'));
      expect((await object(core, 'passkeyUnlockInfo'))['passwordRequired'], 'tries');
      await expectLater(
        unlockBy(core, 1),
        throwsA(isA<CoreFailure>().having((e) => '${e.code}:${e.message}', 'failure', 'passwordRequired:tries')),
      );
      expect((await object(core, 'state'))['unlocked'], isFalse);
      // One password unlock lifts it
      expect(await object(core, 'unlock', [password]), containsPair('ok', true));
      await core.call('lock');
      expect(await unlockBy(core, 1), containsPair('ok', true));
    });

    test('writes a failed try down before the answer is checked', () async {
      expect(await unlockBy(core, 1, prfSeed: 2), containsPair('ok', false));
      expect(jsonDecode(area.values['backmycodes_extension_passkey_failures']!), containsPair('count', 1));
      expect(await unlockBy(core, 1), containsPair('ok', true));
      expect(area.values.containsKey('backmycodes_extension_passkey_failures'), isFalse);
    });

    test('after fourteen days without the password, and then a password unlock starts the days again', () async {
      clock[0] = clock.first.add(const Duration(days: 13, hours: 23));
      expect(await unlockBy(core, 1), containsPair('ok', true));
      await core.call('lock');
      // Opening by passkey doesn't start them again
      clock[0] = clock.first.add(const Duration(days: 1));
      expect((await object(core, 'passkeyUnlockInfo'))['passwordRequired'], 'days');
      await expectLater(unlockBy(core, 1), failure('passwordRequired'));
      expect(await object(core, 'unlock', [password]), containsPair('ok', true));
      await core.call('lock');
      expect((await object(core, 'passkeyUnlockInfo')).containsKey('passwordRequired'), isFalse);
      expect(await unlockBy(core, 1), containsPair('ok', true));
    });
  });

  group('managing credentials', () {
    setUp(() async {
      await enrol(core, 1, name: 'Windows Hello');
      await enrol(core, 2, name: 'YubiKey');
    });

    String idOf(Map<String, Object?> info, String name) =>
        ((info['credentials']! as List<Object?>).cast<Map<String, Object?>>().firstWhere((c) => c['name'] == name))['id']! as String;

    test('renames one and removes one, and the other still opens the vault', () async {
      var info = await object(core, 'passkeyUnlockInfo');
      info = await object(core, 'renamePasskeyUnlock', [idOf(info, 'YubiKey'), 'Work key']);
      expect([for (final c in info['credentials']! as List<Object?>) (c! as Map<String, Object?>)['name']], ['Windows Hello', 'Work key']);
      info = await object(core, 'removePasskeyUnlock', [idOf(info, 'Windows Hello')]);
      expect((info['credentials']! as List<Object?>), hasLength(1));
      await core.call('lock');
      expect(await unlockBy(core, 1), containsPair('reason', 'wrong'));
      expect(await unlockBy(core, 2), containsPair('ok', true));
    });

    test('takes the record and the failed tries with the last credential', () async {
      var info = await object(core, 'passkeyUnlockInfo');
      info = await object(core, 'removePasskeyUnlock', [idOf(info, 'YubiKey')]);
      info = await object(core, 'removePasskeyUnlock', [idOf(info, 'Windows Hello')]);
      expect(info, {'credentials': <Object?>[]});
      expect(area.values.containsKey('backmycodes_extension_passkey_unlock'), isFalse);
      expect(area.values.containsKey('backmycodes_extension_passkey_failures'), isFalse);
      await core.call('lock');
      await expectLater(unlockBy(core, 1), failure(CoreFailure.notFound));
      expect(await object(core, 'unlock', [password]), containsPair('ok', true));
    });

    test('refuses an empty name and an unknown credential', () async {
      await expectLater(core.call('renamePasskeyUnlock', ['nothing', 'Name']), failure(CoreFailure.notFound));
      final info = await object(core, 'passkeyUnlockInfo');
      await expectLater(core.call('renamePasskeyUnlock', [idOf(info, 'YubiKey'), '   ']), failure(CoreFailure.invalid));
      await expectLater(core.call('removePasskeyUnlock', ['nothing']), failure(CoreFailure.notFound));
    });
  });

  group('the vault around it', () {
    test('a new vault password keeps every slot working, and the old password opens nothing', () async {
      await enrol(core, 1);
      await enrol(core, 2);
      final session = core.vault.session!;
      // The same key pair under a new password: the app's own change of password, which the browser's vault is built on
      await core.vault.vault.changePassword(session, 'a new password for the vault');
      await core.call('lock');
      expect(await unlockBy(core, 1), containsPair('ok', true));
      await core.call('lock');
      expect(await unlockBy(core, 2), containsPair('ok', true));
      await core.call('lock');
      expect(await object(core, 'unlock', [password]), containsPair('ok', false));
      expect(await object(core, 'unlock', ['a new password for the vault']), containsPair('ok', true));
    });

    test('opens again from its sealed session after a passkey unlock, as after a password one', () async {
      await enrol(core, 1);
      await core.call('lock');
      expect(await unlockBy(core, 1), containsPair('ok', true));
      final blob = (await core.call('exportSession'))! as String;
      final again = await startCore(MemoryArea(area.values));
      expect(await again.call('restoreSession', [blob]), isTrue);
      expect(((await again.call('logins'))! as List<Object?>), hasLength(1));
    });

    test('removing the vault removes the slots and their failures', () async {
      await enrol(core, 1);
      await core.call('lock');
      await unlockBy(core, 1, prfSeed: 2);
      expect(area.values.keys, containsAll(['backmycodes_extension_passkey_unlock', 'backmycodes_extension_passkey_failures']));
      await core.call('unlock', [password]);
      await core.call('removeVault');
      expect(area.values.keys.where((key) => key.contains('passkey_unlock') || key.contains('passkey_failures')), isEmpty);
      expect(await object(core, 'passkeyUnlockInfo'), {'credentials': <Object?>[]});
    });
  });

  group('adding a credential asks for the password', () {
    Future<Map<String, Object?>> addWith(Object? typed) async {
      await core.call('passkeyUnlockPrepare');
      return object(core, 'addPasskeyUnlock', [
        {'name': 'Mine', 'password': ?typed, 'credentialId': b64url(credentialOf(3)), 'prfOutput': b64url(prfOf(3))},
      ]);
    }

    test('and refuses an open browser that gives none, or gives a wrong one, which counts as a wrong password', () async {
      await expectLater(addWith(null), failure(CoreFailure.invalid));
      await expectLater(addWith(''), failure(CoreFailure.invalid));
      await expectLater(addWith('not the password'), failure('wrongPassword'));
      expect((await object(core, 'state'))['wrongPasswords'], 1);
      await expectLater(addWith('not the password either'), failure('wrongPassword'));
      expect((await object(core, 'state'))['wrongPasswords'], 2);
      expect(await object(core, 'passkeyUnlockInfo'), {'credentials': <Object?>[]});
      expect((await object(core, 'state'))['unlocked'], isTrue);
    });

    test('and takes the right one, which clears the wrong passwords and keeps the vault open', () async {
      await expectLater(addWith('not the password'), failure('wrongPassword'));
      final info = await addWith(password);
      expect((info['credentials']! as List<Object?>), hasLength(1));
      expect((await object(core, 'state'))['wrongPasswords'], 0);
      final held = core.vault.session!;
      expect(held.secretKey.any((byte) => byte != 0), isTrue);
    });
  });

  group('the days without the password', () {
    String? stamp() => area.values['backmycodes_extension_password_unlocked_at'];

    test('are written by a password unlock whether credentials are set up or not', () async {
      final made = stamp();
      expect(jsonDecode(made!), {'at': clock.first.millisecondsSinceEpoch});
      clock[0] = clock.first.add(const Duration(days: 3));
      await core.call('lock');
      await core.call('unlock', [password]);
      expect(jsonDecode(stamp()!), {'at': clock.first.millisecondsSinceEpoch});
    });

    test('are not started over by making, adding or removing a credential', () async {
      final first = clock.first.millisecondsSinceEpoch;
      clock[0] = clock.first.add(const Duration(days: 10));
      await core.call('passkeyUnlockPrepare');
      expect(jsonDecode(stamp()!), {'at': first});
      // Adding asks for the password, which is the one thing that starts them over
      final info = await enrol(core, 1);
      expect(jsonDecode(stamp()!), {'at': clock.first.millisecondsSinceEpoch});
      clock[0] = clock.first.add(const Duration(days: 10));
      final slot = ((info['credentials']! as List<Object?>).single! as Map<String, Object?>)['id']! as String;
      await core.call('removePasskeyUnlock', [slot]);
      await core.call('passkeyUnlockPrepare');
      expect(area.values.containsKey('backmycodes_extension_passkey_unlock'), isTrue);
      expect(jsonDecode(stamp()!), {'at': clock.first.subtract(const Duration(days: 10)).millisecondsSinceEpoch});
    });

    test('are over when nothing says when the password was last typed', () async {
      await enrol(core, 1);
      area.values.remove('backmycodes_extension_password_unlocked_at');
      // A start over what is stored: the first core holds its storage in memory
      final again = await startCore(MemoryArea(area.values));
      expect((await object(again, 'passkeyUnlockInfo'))['passwordRequired'], 'days');
    });

    test('go with the vault when it is removed', () async {
      await core.call('removeVault');
      expect(area.values.containsKey('backmycodes_extension_password_unlocked_at'), isFalse);
    });
  });

  group('in Firefox', () {
    test('no credential is made or asked, whichever page asks', () async {
      final firefox = await CoreService.start(
        CorePlatform(
          storage: AreaPreferences(MemoryArea()),
          clientFor: (_) => MockClient((request) async => http.Response('not found', 404)),
          deviceKeys: FakeDeviceKeys(),
          browserAuth: FakeBrowserAuth(),
          browser: Browser.firefox,
          sessionKey: testSessionKey,
        ),
        const CoreData(),
      );
      await firefox.call('createVault', [password]);
      await expectLater(firefox.call('passkeyUnlockPrepare'), failure(CoreFailure.unavailable));
      await expectLater(
        firefox.call('addPasskeyUnlock', [
          {'name': 'A', 'password': password, 'credentialId': b64url(credentialOf(1)), 'prfOutput': b64url(prfOf(1))},
        ]),
        failure(CoreFailure.unavailable),
      );
      await expectLater(unlockBy(firefox, 1), failure(CoreFailure.unavailable));
      expect(await object(firefox, 'passkeyUnlockInfo'), {'credentials': <Object?>[]});
    });
  });
}
