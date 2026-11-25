// A change to many items does what it can when some of them are in a space this account may not edit: the tag tools, the duplicate
// merge and an import in replace mode leave those items as they are and say how many, while a change to a single item still fails
// (docs/plans/add-spaces.md). The tests make the space read-only with the vault's edit guard, as the spaces' chain does.
import 'dart:convert';

import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const readOnly = 'team';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

Future<String> addLogin(CoreService core, String name, {String secret = 'Hunter2-hunter2'}) async =>
    (await object(core, 'saveLogin', [
          null,
          {
            'name': name,
            'username': 'sam',
            'password': secret,
            'websites': ['orbit-cloud.com'],
          },
        ]))['id']!
        as String;

/// Moves the logins [ids] into the read-only space, then makes the space read-only.
Future<void> shut(CoreService core, Set<String> ids) async {
  await core.vault.saveChanged(
    (lists) => Lists(
      accounts: lists.accounts,
      logins: [for (final login in lists.logins) ids.contains(login.id) ? login.inSpace(readOnly) : login],
    ),
  );
  core.vault.editGuard = (space, id) {
    if (space == readOnly) throw const CoreFailure('space_readOnly', 'a space where this account may not edit');
  };
}

void main() {
  late CoreService core;

  setUp(() async {
    core = await startCore(MemoryArea());
    await core.call('createVault', [password]);
  });

  group('the tag tools', () {
    Future<(String, String)> twoTagged() async {
      final mine = await addLogin(core, 'Orbit');
      final theirs = await addLogin(core, 'Docs', secret: 'Another-secret-1');
      for (final id in [mine, theirs]) {
        await core.call('setTags', [
          'login',
          id,
          ['Work'],
        ]);
      }
      return (mine, theirs);
    }

    test('rename the tag where they can and say how many items they skipped', () async {
      final (mine, theirs) = await twoTagged();
      await shut(core, {theirs});
      expect(await core.call('renameTag', ['Work', 'Job']), {'changed': 1, 'skipped': 1});
      final tags = {for (final login in core.vault.lists.logins) login.id: login.tags};
      expect(tags[mine], ['Job']);
      expect(tags[theirs], ['Work']);
    });

    test('delete the tag where they can and say how many items they skipped', () async {
      final (mine, theirs) = await twoTagged();
      await shut(core, {theirs});
      expect(await core.call('deleteTag', ['work']), {'changed': 1, 'skipped': 1});
      final tags = {for (final login in core.vault.lists.logins) login.id: login.tags};
      expect(tags[mine], isNull);
      expect(tags[theirs], ['Work']);
    });

    test('write nothing when every item is in the space', () async {
      final (mine, theirs) = await twoTagged();
      await shut(core, {mine, theirs});
      expect(await core.call('renameTag', ['Work', 'Job']), {'changed': 0, 'skipped': 2});
      expect(core.vault.lists.logins.map((login) => login.tags), [
        ['Work'],
        ['Work'],
      ]);
    });

    test('still fail for a single item of the space, as the guard always did', () async {
      final (_, theirs) = await twoTagged();
      await shut(core, {theirs});
      await expectLater(
        core.call('setTags', [
          'login',
          theirs,
          ['Home'],
        ]),
        failure('space_readOnly'),
      );
      await expectLater(
        core.call('saveLogin', [
          theirs,
          {'name': 'Docs', 'username': 'sam', 'password': 'x', 'websites': <String>[]},
        ]),
        failure('space_readOnly'),
      );
    });
  });

  group('the duplicate merge', () {
    Future<String> keyOfGroup() async {
      final groups = ((await object(core, 'duplicates'))['groups']! as List<Object?>).cast<Map<String, Object?>>();
      return groups.single['key']! as String;
    }

    test('leaves out the items of the space, and says how many', () async {
      final a = await addLogin(core, 'Orbit');
      final b = await addLogin(core, 'Orbit again');
      final c = await addLogin(core, 'Orbit third');
      await shut(core, {c});
      final key = await keyOfGroup();
      final plan = await object(core, 'duplicateReview', [key]);
      expect(plan['skipped'], 1);
      expect((plan['items']! as List<Object?>).map((item) => (item! as Map<String, Object?>)['id']), isNot(contains(c)));
      // The review answers the key of the whole group, which is the one the merge finds the group by
      expect(plan['key'], key);
      final done = await object(core, 'duplicateMerge', [plan['key'], a, <String, Object?>{}]);
      expect(done['removed'], 1);
      expect(done['skipped'], 1);
      expect({for (final login in core.vault.lists.logins) login.id}, {a, c});
      expect(core.vault.lists.logins.map((login) => login.id), isNot(contains(b)));
    });

    test('is refused when fewer than two of the items can be changed', () async {
      final a = await addLogin(core, 'Orbit');
      final b = await addLogin(core, 'Orbit again');
      await shut(core, {b});
      final key = await keyOfGroup();
      await expectLater(core.call('duplicateMerge', [key, a, <String, Object?>{}]), failure('space_readOnly'));
      expect(core.vault.lists.logins, hasLength(2));
    });
  });

  group('an import in replace mode', () {
    test('keeps the codes of the space and says how many it skipped', () async {
      final from = await startCore(MemoryArea());
      await from.call('createVault', [password]);
      await from.call('addCode', ['otpauth://totp/Orbit:sam@orbit.test?secret=JBSWY3DPEHPK3PXP&issuer=Orbit']);
      final exported = await object(from, 'transferExport', [
        {'format': 'plain', 'password': password},
      ]);

      final added = await object(core, 'addCode', ['otpauth://totp/Held:kim@held.test?secret=JBSWY3DPEHPK3PXB&issuer=Held', null, null]);
      await core.vault.saveChanged((lists) => Lists(accounts: [for (final account in lists.accounts) account.inSpace(readOnly)]));
      core.vault.editGuard = (space, id) {
        if (space == readOnly) throw const CoreFailure('space_readOnly', 'a space where this account may not edit');
      };

      final opened = await object(core, 'transferOpen', [base64.encode(utf8.encode(exported['text']! as String))]);
      final token = opened['token']! as String;
      await object(core, 'transferPreview', [token]);
      final applied = await object(core, 'transferApply', [
        token,
        {'mode': 'replace'},
      ]);

      expect(applied['skipped'], 1);
      expect({for (final account in core.vault.lists.accounts) account.issuer}, {'Held', 'Orbit'});
      expect(core.vault.lists.accounts.firstWhere((account) => account.id == added['id']).spaceId, readOnly);
    });
  });
}
