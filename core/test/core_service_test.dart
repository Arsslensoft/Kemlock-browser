// The core as the TypeScript side calls it, over a fake browser: the vault in storage, its items, matching, and the session
// a restarted background opens again.
import 'dart:convert';
import 'dart:io';

import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const link = 'otpauth://totp/Orbit:sam@orbit.test?secret=JBSWY3DPEHPK3PXP&issuer=Orbit';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

void main() {
  test('the methods are the ones of the TypeScript CoreApi', () {
    final source = File('../src/background/core/bridge.ts').readAsStringSync();
    final block = RegExp(r'export const methods = \[([^\]]*)\]').firstMatch(source)!.group(1)!;
    final names = RegExp(r"'(\w+)'").allMatches(block).map((m) => m.group(1)!).toSet();
    expect(CoreService.methods, names);
  });

  group('the vault', () {
    late MemoryArea area;
    late CoreService core;

    setUp(() async {
      area = MemoryArea();
      core = await startCore(area);
    });

    test('is made, opened, locked and opened again with its password', () async {
      expect(await object(core, 'state'), {'exists': false, 'unlocked': false, 'wrongPasswords': 0});
      await core.call('createVault', [password]);
      expect(await object(core, 'state'), containsPair('unlocked', true));
      expect(area.values.keys, contains('backmycodes_vault_config'));
      await core.call('lock');
      expect(await object(core, 'state'), {'exists': true, 'unlocked': false, 'wrongPasswords': 0});
      expect(await object(core, 'unlock', [password]), {'ok': true, 'wrongPasswords': 0});
      expect(await object(core, 'state'), containsPair('unlocked', true));
    });

    test('keeps what the app\'s storage keys hold, so a new start finds it', () async {
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
      final again = await startCore(MemoryArea(area.values));
      await again.call('unlock', [password]);
      expect((await list(again, 'logins')).single['name'], 'Orbit');
    });

    test('a vault cannot be made twice, nor used while shut', () async {
      await core.call('createVault', [password]);
      await expectLater(core.call('createVault', [password]), failure(CoreFailure.exists));
      await core.call('lock');
      await expectLater(core.call('logins'), failure(CoreFailure.locked));
      await expectLater(startCore(MemoryArea()).then((c) => c.call('codes')), failure(CoreFailure.noVault));
    });

    test('counts wrong passwords, writing each down, and clears them when it opens', () async {
      await core.call('createVault', [password]);
      await core.call('lock');
      expect(await object(core, 'unlock', ['wrong']), {'ok': false, 'wrongPasswords': 1});
      expect(await object(core, 'unlock', ['wrong again']), {'ok': false, 'wrongPasswords': 2});
      final state = await object(core, 'state');
      expect(state['wrongPasswords'], 2);
      expect(state['lastWrongAt'], 1700000000000);
      expect(jsonDecode(area.values['backmycodes_unlock_failures']!), containsPair('count', 2));
      expect(await object(core, 'unlock', [password]), {'ok': true, 'wrongPasswords': 2});
      expect((await object(core, 'state'))['wrongPasswords'], 0);
    });

    test('opens again from its sealed session, and only from this browser session\'s', () async {
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
      final blob = await core.call('exportSession') as String;
      expect(blob, isNot(contains('Orbit')));
      // The background restarts: a new core over the same storage
      final restarted = await startCore(MemoryArea(area.values));
      expect(await object(restarted, 'state'), containsPair('unlocked', false));
      expect(await restarted.call('restoreSession', [blob]), isTrue);
      expect((await list(restarted, 'logins')).single['name'], 'Orbit');
      expect(await startCore(MemoryArea(area.values)).then((c) => c.call('restoreSession', ['AAAA'])), isFalse);
    });

    test('removing the vault leaves none', () async {
      await core.call('createVault', [password]);
      await core.call('removeVault');
      expect((await object(core, 'state'))['exists'], isFalse);
      expect(area.values.keys.where((key) => key.startsWith('backmycodes_vault')), isEmpty);
    });
  });

  group('logins', () {
    late CoreService core;

    setUp(() async {
      core = await startCore(MemoryArea());
      await core.call('createVault', [password]);
    });

    Future<Map<String, Object?>> save(String? id, Map<String, Object?> input) async => object(core, 'saveLogin', [id, input]);

    test('are saved, listed with no password, revealed one at a time, and deleted', () async {
      final saved = await save(null, {
        'name': 'Orbit',
        'username': 'sam',
        'password': 'Correct-Horse-9!',
        'websites': ['https://accounts.orbit-cloud.com/login'],
        'note': 'work',
        'tags': ['team'],
      });
      expect(saved['websites'], ['accounts.orbit-cloud.com']);
      expect(saved['hasPassword'], isTrue);
      expect(saved['strength'], 4);
      expect(jsonEncode(await core.call('logins')), isNot(contains('Correct-Horse')));
      expect(await object(core, 'revealLogin', [saved['id']]), {'username': 'sam', 'password': 'Correct-Horse-9!'});
      await core.call('deleteLogin', [saved['id']]);
      expect(await list(core, 'logins'), isEmpty);
    });

    test('a changed password keeps the one it replaces', () async {
      final saved = await save(null, {'name': 'Orbit', 'username': 'sam', 'password': 'first', 'websites': <String>[]});
      final changed = await save(saved['id']! as String, {
        'name': 'Orbit',
        'username': 'sam',
        'password': 'second',
        'websites': <String>[],
      });
      expect(changed['previousPasswords'], 1);
      expect(changed['passwordChangedAt'], 1700000000000);
      expect((await object(core, 'revealLogin', [saved['id']]))['password'], 'second');
      // The same password changes nothing
      final same = await save(saved['id']! as String, {'name': 'Orbit', 'username': 'sam', 'password': 'second', 'websites': <String>[]});
      expect(same['previousPasswords'], 1);
    });

    test('need a name and a username or a password', () async {
      await expectLater(save(null, {'name': '', 'username': 'sam', 'password': '', 'websites': <String>[]}), failure(CoreFailure.invalid));
      await expectLater(save(null, {'name': 'x', 'username': '', 'password': '', 'websites': <String>[]}), failure(CoreFailure.invalid));
      await expectLater(
        save('missing', {'name': 'x', 'username': 'a', 'password': '', 'websites': <String>[]}),
        failure(CoreFailure.notFound),
      );
    });

    test('are matched to the page, with the guard when nothing matches', () async {
      await save(null, {
        'name': 'Orbit',
        'username': 'sam',
        'password': 'p',
        'websites': ['orbit-cloud.com'],
      });
      final match = await object(core, 'match', ['https://app.orbit-cloud.com/sign-in']);
      expect(match['site'], 'orbit-cloud.com');
      expect((match['logins']! as List<Object?>), hasLength(1));
      final look = await object(core, 'match', ['https://orbit-c1oud.com/']);
      expect(look['logins'], isEmpty);
      expect(look['lookAlikeOf'], 'orbit-cloud.com');
      expect((await object(core, 'match', ['chrome://extensions'])), {'site': '', 'logins': [], 'codes': []});
    });

    test('health names reused and weak passwords, and "don\'t warn" is kept', () async {
      final a = await save(null, {
        'name': 'A',
        'username': 'a',
        'password': 'samepass',
        'websites': ['a.example.com'],
      });
      final b = await save(null, {
        'name': 'B',
        'username': 'b',
        'password': 'samepass',
        'websites': ['b.example.com'],
      });
      final report = await object(core, 'health');
      expect(report['reused'], unorderedEquals([a['id'], b['id']]));
      expect(report['weak'], unorderedEquals([a['id'], b['id']]));
      await core.call('ignoreHealth', [a['id'], true]);
      final listed = await list(core, 'logins');
      expect((listed.first['health']! as Map<String, Object?>)['ignored'], isTrue);
    });
  });

  group('codes', () {
    late CoreService core;

    setUp(() async {
      core = await startCore(MemoryArea());
      await core.call('createVault', [password]);
    });

    test('are added from a link, shown with no secret, and counted down', () async {
      final added = await object(core, 'addCode', [link, 'https://orbit-cloud.com/', null]);
      expect(added['issuer'], 'Orbit');
      expect(added['websites'], ['orbit-cloud.com']);
      expect(jsonEncode(await core.call('codes')), isNot(contains('JBSWY3DPEHPK3PXP')));
      final live = (await list(core, 'liveCodes', [
        [added['id']],
        1700000000000,
      ])).single;
      expect(live['code'], matches(RegExp(r'^\d{6}$')));
      expect(live['expiresAt'], greaterThan(1700000000000));
    });

    test('a link that is none, and one saved already, are refused', () async {
      await expectLater(core.call('addCode', ['hello', null, null]), failure(CoreFailure.notAnOtpauth));
      await core.call('addCode', [link, null, null]);
      await expectLater(core.call('addCode', [link, null, null]), failure(CoreFailure.duplicate));
    });

    test('a counter code counts when it is asked for its next', () async {
      final added = await object(core, 'addCode', ['otpauth://hotp/Orbit:sam?secret=JBSWY3DPEHPK3PXP&issuer=Orbit&counter=4', null, null]);
      final first = await object(core, 'nextHotp', [added['id']]);
      final second = await object(core, 'nextHotp', [added['id']]);
      expect(first['code'], isNot(second['code']));
      expect(first.containsKey('expiresAt'), isFalse);
    });

    test('are linked to a login and unlinked again', () async {
      final added = await object(core, 'addCode', [link, null, null]);
      final login = await object(core, 'saveLogin', [
        null,
        {
          'name': 'Orbit',
          'username': 'sam',
          'password': 'p',
          'websites': ['orbit-cloud.com'],
        },
      ]);
      await core.call('linkCode', [added['id'], login['id']]);
      expect((await list(core, 'codes')).single['loginId'], login['id']);
      expect((await list(core, 'logins')).single['codeId'], added['id']);
      await core.call('linkCode', [added['id'], null]);
      expect((await list(core, 'codes')).single.containsKey('loginId'), isFalse);
    });
  });

  group('the rest', () {
    late CoreService core;

    setUp(() async {
      core = await startCore(MemoryArea(), wordList: '11111\tabacus\n11112\tabdomen\n11113\tabdominal\n');
      await core.call('createVault', [password]);
    });

    test('settings have their defaults, and keep what is saved, held to what the extension takes', () async {
      expect((await object(core, 'settings'))['autoLockMinutes'], 5);
      final saved = await object(core, 'saveSettings', [
        {'autoLockMinutes': 15, 'clipboardSeconds': 10, 'lockOnSleep': false},
      ]);
      expect(saved['autoLockMinutes'], 15);
      expect(saved['lockOnSleep'], isFalse);
      expect(
        (await object(core, 'saveSettings', [
          {'autoLockMinutes': 7},
        ]))['autoLockMinutes'],
        15,
      );
      await core.call('lock');
      await core.call('unlock', [password]);
      expect((await object(core, 'settings'))['clipboardSeconds'], 10);
    });

    test('generates, with the word list it was given', () async {
      expect(
        await core.call('generate', [
          {'mode': 'random', 'length': 18},
        ]),
        hasLength(18),
      );
      expect(
        (await core.call('generate', [
          {'mode': 'passphrase', 'words': 3, 'separator': '-'},
        ]) as String).split('-'),
        hasLength(3),
      );
    });

    test('keeps the passwords it generated, for a month', () async {
      await core.call('addRecentPassword', [
        {'value': 'abc-def', 'at': 1700000000000, 'site': 'orbit-cloud.com'},
      ]);
      expect(await list(core, 'recentPasswords'), [
        {'value': 'abc-def', 'at': 1700000000000, 'site': 'orbit-cloud.com'},
      ]);
    });

    test('has no sync until the person joins one', () async {
      expect(await core.call('syncStatus'), isNull);
      expect((await object(core, 'state')).containsKey('sync'), isFalse);
      await expectLater(core.call('syncNow'), failure(CoreFailure.invalid));
      expect(await core.call('rememberedSites', ['x']), isEmpty);
    });

    test('a method it does not have is refused', () async {
      await expectLater(core.call('nope'), failure(CoreFailure.invalid));
    });
  });
}
