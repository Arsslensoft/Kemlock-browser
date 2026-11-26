// The vault tools over a fake browser (docs/plans/add-vault-tools.md): tags, pins and order, backup codes, the duplicate cleaner and the
// breach checks, each held to what the app writes, since a phone reads what the browser saves.
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_file.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/duplicate_tools.dart' show suffixListHash;
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:kemlock_extension_core/src/tools_service.dart' show normaliseTags;
import 'package:kemlock_extension_core/src/vault_service.dart' show readOrder;
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const now = 1700000000000;

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

String link(String issuer, String secret, {String account = 'sam@example.com'}) {
  final name = Uri.encodeComponent(issuer);
  return 'otpauth://totp/$name:$account?secret=$secret&issuer=$name';
}

Future<String> addLogin(
  CoreService core,
  String name, {
  String username = 'sam',
  String secret = 'Hunter2-hunter2',
  List<String> websites = const ['orbit-cloud.com'],
}) async =>
    (await object(core, 'saveLogin', [
          null,
          {'name': name, 'username': username, 'password': secret, 'websites': websites},
        ]))['id']!
        as String;

Future<String> addCode(CoreService core, String issuer, {String secret = 'JBSWY3DPEHPK3PXP'}) async =>
    (await object(core, 'addCode', [link(issuer, secret)]))['id']! as String;

void main() {
  late MemoryArea area;
  late CoreService core;

  setUp(() async {
    area = MemoryArea();
    core = await startCore(area);
    await core.call('createVault', [password]);
  });

  test('the tools need the vault open', () async {
    await core.call('lock');
    for (final method in ['tags', 'duplicates', 'backupCoverage', 'breaches', 'toolsSettings']) {
      await expectLater(core.call(method), failure(CoreFailure.locked), reason: method);
    }
  });

  group('tags', () {
    test('are set, cleaned the way the app cleans them, and stamped so sync carries them', () async {
      final id = await addCode(core, 'Orbit');
      final saved = await core.call('setTags', [
        'code',
        id,
        [' Work ', 'work', 'Café', 'cafe', '', 'x' * 30],
      ]);
      expect(saved, ['Work', 'Café', 'x' * 24]);
      expect((await list(core, 'codes')).single['tags'], ['Work', 'Café', 'x' * 24]);
      final account = core.vault.lists.accounts.single;
      expect(account.tags, ['Work', 'Café', 'x' * 24]);
      expect(account.updatedAt, now);
      // The app's storage: the same value after a new start
      final again = await startCore(MemoryArea(area.values));
      await again.call('unlock', [password]);
      expect((await list(again, 'codes')).single['tags'], ['Work', 'Café', 'x' * 24]);
    });

    test('are set on logins too, and an empty list takes the key off', () async {
      final id = await addLogin(core, 'Orbit');
      await core.call('setTags', [
        'login',
        id,
        ['Home'],
      ]);
      expect((await list(core, 'logins')).single['tags'], ['Home']);
      await core.call('setTags', ['login', id, <String>[]]);
      expect((await list(core, 'logins')).single['tags'], isEmpty);
      expect(core.vault.lists.logins.single.tags, isNull);
    });

    test('refuse an item that is not there and a kind that holds none', () async {
      await expectLater(
        core.call('setTags', [
          'code',
          'nope',
          ['a'],
        ]),
        failure(CoreFailure.notFound),
      );
      await expectLater(
        core.call('setTags', [
          'contact',
          'nope',
          ['a'],
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(
        core.call('setTags', [
          'passkey',
          'nope',
          ['a'],
        ]),
        failure(CoreFailure.notFound),
      );
    });

    test('are set on a passkey, listed in its view, counted, renamed and deleted with the others', () async {
      const passkey = Passkey(
        id: 'p1',
        credentialId: 'AAECAwQFBgcICQoLDA0ODw',
        rpId: 'orbit.test',
        rpName: 'Orbit',
        userHandle: 'dXNlci0x',
        userName: 'sam@orbit.test',
        privateKey: 'a2V5',
        addedAt: 1,
      );
      await core.vault.savePasskeys([passkey]);
      final login = await addLogin(core, 'Orbit');
      expect(
        await core.call('setTags', [
          'passkey',
          'p1',
          ['Work', 'work'],
        ]),
        ['Work'],
      );
      await core.call('setTags', [
        'login',
        login,
        ['Work'],
      ]);
      expect((await list(core, 'passkeys')).single['tags'], ['Work']);
      expect(core.vault.lists.passkeys.single.tags, ['Work']);
      expect(core.vault.lists.passkeys.single.updatedAt, now);
      expect(await list(core, 'tags'), [
        {'name': 'Work', 'count': 2},
      ]);
      expect(await core.call('renameTag', ['Work', 'Job']), {'changed': 2, 'skipped': 0});
      expect(core.vault.lists.passkeys.single.tags, ['Job']);
      expect(await core.call('deleteTag', ['job']), {'changed': 2, 'skipped': 0});
      expect(core.vault.lists.passkeys.single.tags, isNull);
      expect((await list(core, 'passkeys')).single['tags'], isEmpty);
    });

    test('are counted over every kind, renamed everywhere and deleted everywhere', () async {
      final code = await addCode(core, 'Orbit');
      final login = await addLogin(core, 'Orbit');
      final other = await addLogin(core, 'Docs', username: 'kim', secret: 'Another-secret-1');
      await core.call('setTags', [
        'code',
        code,
        ['Work'],
      ]);
      await core.call('setTags', [
        'login',
        login,
        ['work', 'Home'],
      ]);
      await core.call('setTags', [
        'login',
        other,
        ['Home'],
      ]);
      expect(await list(core, 'tags'), [
        {'name': 'Home', 'count': 2},
        {'name': 'Work', 'count': 2},
      ]);

      // "Work" and "Home" become one tag on the login that holds both
      expect(await core.call('renameTag', ['Work', 'Home']), {'changed': 2, 'skipped': 0});
      expect(await list(core, 'tags'), [
        {'name': 'Home', 'count': 3},
      ]);
      expect(core.vault.lists.logins.firstWhere((l) => l.id == login).tags, ['Home']);

      expect(await core.call('deleteTag', ['home']), {'changed': 3, 'skipped': 0});
      expect(await list(core, 'tags'), isEmpty);
      expect(await core.call('deleteTag', ['home']), {'changed': 0, 'skipped': 0});
    });

    test('the cleaning of a tag list is the app\'s', () {
      expect(normaliseTags(['  a ', 'A', 'é', 'e', 'b' * 25]), ['a', 'é', 'b' * 24]);
    });
  });

  group('pins and order', () {
    test('a pin is the app\'s pinned, on a code or a login', () async {
      final code = await addCode(core, 'Orbit');
      final login = await addLogin(core, 'Orbit');
      await core.call('setPinned', ['code', code, true]);
      await core.call('setPinned', ['login', login, true]);
      expect((await list(core, 'codes')).single['pinned'], isTrue);
      expect((await list(core, 'logins')).single['pinned'], isTrue);
      expect(core.vault.lists.accounts.single.pinned, isTrue);
      await core.call('setPinned', ['code', code, false]);
      expect((await list(core, 'codes')).single.containsKey('pinned'), isFalse);
      expect(core.vault.lists.accounts.single.pinned, isNull);
      await expectLater(core.call('setPinned', ['note', code, true]), failure(CoreFailure.invalid));
    });

    test('codes are ordered as the app orders them: the ids given take 0, 1, 2 and the others keep theirs', () async {
      final a = await addCode(core, 'Alpha', secret: 'JBSWY3DPEHPK3PXA');
      final b = await addCode(core, 'Beta', secret: 'JBSWY3DPEHPK3PXB');
      final c = await addCode(core, 'Gamma', secret: 'JBSWY3DPEHPK3PXC');
      await core.call('reorderCodes', [
        [c, a, a],
      ]);
      final orders = {for (final view in await list(core, 'codes')) view['id']! as String: view['order']};
      expect(orders[c], 0);
      expect(orders[a], 1);
      // Not named: the position it had in the list
      expect(orders[b], 1);
      final stored = core.vault.lists.accounts;
      expect(stored.firstWhere((x) => x.id == c).order, 0);
      expect(stored.firstWhere((x) => x.id == a).order, 1);
      expect(stored.firstWhere((x) => x.id == b).order, isNull);
      expect(stored.firstWhere((x) => x.id == c).updatedAt, now);
    });

    test('logins are ordered in this browser only: sealed, kept across a lock, never in the login itself', () async {
      final a = await addLogin(core, 'Alpha', username: 'a', secret: 'Secret-aaaa-1');
      final b = await addLogin(core, 'Beta', username: 'b', secret: 'Secret-bbbb-2');
      await core.call('reorderLogins', [
        [b, 'gone', a],
      ]);
      Map<String, Object?> orders(List<Map<String, Object?>> views) => {for (final v in views) v['id']! as String: v['order']};
      expect(orders(await list(core, 'logins')), {b: 0, a: 1});
      // Nothing about the order is in the login, so a phone reads it as it always did
      expect(core.vault.lists.logins.every((login) => !login.toJson().containsKey('order')), isTrue);
      await core.call('lock');
      await core.call('unlock', [password]);
      expect(orders(await list(core, 'logins')), {b: 0, a: 1});
      final again = await startCore(MemoryArea(area.values));
      await again.call('unlock', [password]);
      expect(orders(await list(again, 'logins')), {b: 0, a: 1});
      // The order is sealed: no id sits in the clear
      expect(area.values.entries.where((e) => e.value.contains(a)), isEmpty);
    });

    test('the order a value holds is read as a list of ids once each', () {
      expect(readOrder(['a', 1, 'b', 'a']), ['a', 'b']);
      expect(readOrder('nope'), isEmpty);
    });
  });

  group('backup codes', () {
    test('are split as the app splits a paste, and a service is added with them unused', () async {
      expect(await core.call('parseBackupCodes', ['1234 5678\n2345 6789, abcdef  ghijkl\n1234 5678']), [
        '1234 5678',
        '2345 6789',
        'abcdef',
        'ghijkl',
      ]);
      final view = await object(core, 'addBackupService', ['Google', '1234 5678\n2345 6789\n3456 7890']);
      expect(view, containsPair('issuer', 'Google'));
      expect(view, containsPair('total', 3));
      expect(view, containsPair('left', 3));
      expect(view, containsPair('low', false));
      expect((await list(core, 'backupCodes')).single['serviceId'], view['serviceId']);
      await expectLater(core.call('addBackupService', ['', 'abc']), failure(CoreFailure.invalid));
      await expectLater(core.call('addBackupService', ['Name', '  ']), failure(CoreFailure.invalid));
    });

    test('are marked used and unused, with when, and say when two or fewer are left', () async {
      final id = (await object(core, 'addBackupService', ['Google', 'aaaa1111\nbbbb2222\ncccc3333\ndddd4444']))['serviceId']! as String;
      var view = await object(core, 'setBackupCodeUsed', [id, 1, true, 'bbbb2222']);
      expect(view, containsPair('left', 3));
      expect(view, containsPair('low', false));
      view = await object(core, 'setBackupCodeUsed', [id, 0, true, 'aaaa1111']);
      expect(view, containsPair('left', 2));
      expect(view, containsPair('low', true));
      var detail = await object(core, 'backupDetail', [id]);
      expect((detail['codes']! as List<Object?>)[1], {'code': 'bbbb2222', 'used': true, 'usedAt': now});
      expect(detail['low'], isTrue);
      view = await object(core, 'setBackupCodeUsed', [id, 1, false, 'bbbb2222']);
      expect(view, containsPair('left', 3));
      detail = await object(core, 'backupDetail', [id]);
      expect((detail['codes']! as List<Object?>)[1], {'code': 'bbbb2222', 'used': false});
      await expectLater(core.call('setBackupCodeUsed', [id, 9, true, 'x']), failure(CoreFailure.notFound));
    });

    test('are refused by place unless the code there is the one the page showed: a list that changed since is not guessed at', () async {
      final id = (await object(core, 'addBackupService', ['Google', 'aaaa1111\nbbbb2222\ncccc3333']))['serviceId']! as String;
      // The page showed [aaaa1111, bbbb2222, cccc3333]; a sync took the first away, so index 1 is cccc3333 now
      await core.call('removeBackupCode', [id, 0, 'aaaa1111']);
      await expectLater(core.call('setBackupCodeUsed', [id, 1, true, 'bbbb2222']), failure(CoreFailure.stale));
      await expectLater(core.call('removeBackupCode', [id, 1, 'bbbb2222']), failure(CoreFailure.stale));
      final detail = await object(core, 'backupDetail', [id]);
      expect((detail['codes']! as List<Object?>).map((c) => (c! as Map<String, Object?>)['used']), [false, false]);
      expect(detail['codes'], hasLength(2));
      // The code that is there is the code that is marked
      await core.call('setBackupCodeUsed', [id, 1, true, 'cccc3333']);
      expect(((await object(core, 'backupDetail', [id]))['codes']! as List<Object?>).last, containsPair('used', true));
    });

    test('get more codes without the ones held, lose one, and are deleted', () async {
      final id = (await object(core, 'addBackupService', ['Google', 'aaaa1111\nbbbb2222']))['serviceId']! as String;
      expect(await core.call('addBackupCodes', [id, 'bbbb2222\ncccc3333']), {'added': 1, 'duplicates': 1});
      expect((await object(core, 'backupDetail', [id]))['codes'], hasLength(3));
      expect(await object(core, 'removeBackupCode', [id, 0, 'aaaa1111']), containsPair('total', 2));
      expect(core.vault.lists.backupServices.single.updatedAt, now);
      await core.call('deleteBackupService', [id]);
      expect(await list(core, 'backupCodes'), isEmpty);
      await expectLater(core.call('backupDetail', [id]), failure(CoreFailure.notFound));
    });

    test('have a name and a note that can be changed, and say whose they are', () async {
      final code = await addCode(core, 'Google');
      final login = await addLogin(core, 'Google', websites: ['google.com']);
      await core.call('linkCode', [code, login]);
      final id = (await object(core, 'addBackupService', ['google', 'aaaa1111']))['serviceId']! as String;
      await core.call('editBackupService', [id, 'Google account', 'on paper', false]);
      var detail = await object(core, 'backupDetail', [id]);
      expect(detail['name'], 'Google account');
      expect(detail['note'], 'on paper');
      await core.call('editBackupService', [id, null, null, true]);
      detail = await object(core, 'backupDetail', [id]);
      expect(detail.containsKey('note'), isFalse);
      // "google" is the service of the code of issuer Google, and the login is linked to that code
      await core.call('editBackupService', [id, 'Google', null, false]);
      detail = await object(core, 'backupDetail', [id]);
      expect((detail['accounts']! as List<Object?>).single, {'id': code, 'name': 'Google'});
      expect((detail['logins']! as List<Object?>).single, {'id': login, 'name': 'Google'});
      expect((await list(core, 'codes')).single['backupCodesLeft'], 1);
    });

    test('are looked for among the codes: which have none saved, and which give none', () async {
      final zed = await addCode(core, 'Zed', secret: 'JBSWY3DPEHPK3PXA');
      await addCode(core, 'Acme', secret: 'JBSWY3DPEHPK3PXB');
      await addCode(core, 'Orbit', secret: 'JBSWY3DPEHPK3PXC');
      await core.call('addBackupService', ['Orbit', 'aaaa1111']);
      var coverage = await object(core, 'backupCoverage');
      expect(coverage['total'], 3);
      expect(coverage['covered'], 1);
      expect([for (final m in coverage['missing']! as List<Object?>) (m! as Map<String, Object?>)['name']], ['Acme', 'Zed']);
      await core.call('setNoBackupCodes', [zed, true]);
      coverage = await object(core, 'backupCoverage');
      expect(coverage['total'], 2);
      expect(core.vault.lists.accounts.firstWhere((a) => a.id == zed).noBackupCodes, isTrue);
      await core.call('setNoBackupCodes', [zed, false]);
      expect((await object(core, 'backupCoverage'))['total'], 3);
      expect(core.vault.lists.accounts.firstWhere((a) => a.id == zed).noBackupCodes, isNull);
    });
  });

  group('the duplicate cleaner', () {
    Future<List<Map<String, Object?>>> groups() async =>
        ((await object(core, 'duplicates'))['groups']! as List<Object?>).cast<Map<String, Object?>>();

    Set<Object?> idsOf(Map<String, Object?> group) => {
      for (final item in group['items']! as List<Object?>) (item! as Map<String, Object?>)['id'],
    };

    test('finds the same sign-in, and the same code under two names, and nothing else', () async {
      final a = await addLogin(core, 'Orbit');
      final b = await addLogin(core, 'Orbit again');
      await addLogin(core, 'Other', username: 'kim', websites: ['example.net'], secret: 'Other-secret-9');
      final one = await addCode(core, 'Orbit');
      final two = await addCode(core, 'orbit-cloud.com');
      await addCode(core, 'Different', secret: 'JBSWY3DPEHPK3PXB');

      final byReason = {for (final g in await groups()) g['reason']! as String: g};
      expect(byReason.keys, unorderedEquals(['sameSignIn', 'sameCode']));
      expect(idsOf(byReason['sameSignIn']!), {a, b});
      expect(idsOf(byReason['sameCode']!), {one, two});
      expect(byReason['sameSignIn']!['kind'], 'login');
      expect(byReason['sameCode']!['kind'], 'account');
      // The cache is the app's, sealed: nothing in the clear
      expect(area.values.keys.where((k) => k.contains('dedup')), isNotEmpty);
      expect(area.values.values.where((v) => v.contains('Hunter2-hunter2')), isEmpty);
    });

    test('says "same account" for two logins with one username and two passwords, never "same sign-in"', () async {
      await addLogin(core, 'Orbit');
      await addLogin(core, 'Orbit old', secret: 'Older-secret-77');
      expect((await groups()).single['reason'], 'sameAccount');
    });

    test('plans a merge with the newest value preselected, and merges, keeping what the others held', () async {
      final a = await addLogin(core, 'Orbit');
      final b = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final group = (await groups()).single;
      expect(group['reason'], 'sameAccount');
      final key = group['key']! as String;
      final plan = await object(core, 'duplicateReview', [key]);
      expect(plan['keptId'], anyOf(a, b));
      final fields = {for (final f in plan['fields']! as List<Object?>) (f! as Map<String, Object?>)['id']: f};
      expect(fields.keys, containsAll(['name', 'password']));
      // A password is shown as dots, never as it is
      final passwords = ((fields['password']! as Map<String, Object?>)['options']! as List<Object?>).cast<Map<String, Object?>>();
      expect(passwords.map((o) => o['text']).toSet(), {'••••••••'});

      final done = await object(core, 'duplicateMerge', [
        key,
        a,
        {'password': b, 'name': a},
      ]);
      expect(done['removed'], 1);
      final left = await list(core, 'logins');
      expect(left, hasLength(1));
      expect(left.single['id'], a);
      expect(left.single['name'], 'Orbit');
      // The password that wasn't kept is among the previous passwords, and the kept one is the other login's
      expect(left.single['previousPasswords'], 1);
      expect((await object(core, 'revealLogin', [a]))['password'], 'Newer-secret-88');
      expect(core.vault.lists.logins.single.updatedAt, now);
      // The merge's record is kept sealed, with Undo
      final view = await object(core, 'duplicates');
      expect((view['records']! as List<Object?>).single, containsPair('count', 1));
      expect(await groups(), isEmpty);
    });

    test('undoes a merge: both items come back as they were, and the record goes', () async {
      final a = await addLogin(core, 'Orbit');
      final b = await addLogin(core, 'Orbit again');
      final key = (await groups()).single['key']! as String;
      final done = await object(core, 'duplicateMerge', [key, a, <String, Object?>{}]);
      expect(await list(core, 'logins'), hasLength(1));
      expect(await core.call('duplicateUndo', [done['recordId']]), 'undone');
      expect({for (final l in await list(core, 'logins')) l['id']}, {a, b});
      expect((await object(core, 'duplicates'))['records'], isEmpty);
      expect(await core.call('duplicateUndo', [done['recordId']]), 'unavailable');
    });

    test('does not undo a merge that removed a file the server holds, which its next run deletes', () async {
      final hash = 'cd' * 32;
      NoteAttachment attachment(String id, {bool onServer = false}) =>
          NoteAttachment(id: id, name: '$id.pdf', size: 3, key: 'a2V5', addedAt: 1, sha256: hash, extra: onServer ? {'kemlockFile': 'server-$id'} : const {});
      await core.vault.applySynced(
        Lists(
          files: [
            VaultFile(id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'Scan', file: attachment('a1'), addedAt: 1),
            VaultFile(id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', name: 'Scan again', file: attachment('a2', onServer: true), addedAt: 1),
          ],
        ),
      );
      final group = (await groups()).single;
      expect(group['reason'], 'sameFile');
      final done = await object(core, 'duplicateMerge', [group['key'], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', <String, Object?>{}]);
      expect(core.vault.lists.files, hasLength(1));
      expect(await core.call('duplicateUndo', [done['recordId']]), 'unavailable');
      expect(core.vault.lists.files, hasLength(1));
    });

    test('relinks the logins of a code that goes to the one that stays', () async {
      final one = await addCode(core, 'Orbit');
      final two = await addCode(core, 'orbit-cloud.com');
      final login = await addLogin(core, 'Orbit', websites: ['example.net']);
      await core.call('linkCode', [two, login]);
      final key = (await groups()).single['key']! as String;
      await core.call('duplicateMerge', [key, one, <String, Object?>{}]);
      expect((await list(core, 'codes')).map((c) => c['id']), [one]);
      expect((await list(core, 'logins')).single['codeId'], one);
    });

    test('remembers "Not duplicates" until another copy joins, and takes it back', () async {
      await addLogin(core, 'Orbit');
      await addLogin(core, 'Orbit again');
      final key = (await groups()).single['key']! as String;
      expect(await core.call('duplicateDismiss', [key]), isTrue);
      expect(await groups(), isEmpty);
      await core.call('duplicateRestore', [key]);
      expect(await groups(), hasLength(1));
      await core.call('duplicateDismiss', [key]);
      await addLogin(core, 'A third copy');
      final back = await groups();
      expect(back, hasLength(1));
      expect(back.single['key'], isNot(key));
    });

    test('refuses a group that is not there, and an item that is not in the group', () async {
      // A key is made from the items, so one no check finds now is a group that went: the person checks again
      await expectLater(core.call('duplicateReview', ['nope']), failure(CoreFailure.stale));
      await addLogin(core, 'Orbit');
      await addLogin(core, 'Orbit again');
      final key = (await groups()).single['key']! as String;
      await expectLater(core.call('duplicateMerge', [key, 'stranger', <String, Object?>{}]), failure(CoreFailure.invalid));
    });

    test('merges what the vault holds now, not what the last check held: an edit made since is not overwritten', () async {
      final a = await addLogin(core, 'Orbit');
      final b = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final key = (await groups()).single['key']! as String;
      // A sync (or another page) changed the second login's password after the person looked
      await core.call('saveLogin', [
        b,
        {
          'name': 'Orbit again',
          'username': 'sam',
          'password': 'Edited-after-the-check-1',
          'websites': ['orbit-cloud.com'],
        },
      ]);
      await core.call('duplicateMerge', [
        key,
        a,
        {'password': b},
      ]);
      expect((await object(core, 'revealLogin', [a]))['password'], 'Edited-after-the-check-1');
      // Undo brings back the copy as it was just before the merge, edit included
      final record = ((await object(core, 'duplicates'))['records']! as List<Object?>).single! as Map<String, Object?>;
      expect(await core.call('duplicateUndo', [record['id']]), 'undone');
      expect((await object(core, 'revealLogin', [b]))['password'], 'Edited-after-the-check-1');
    });

    test('is stale, and changes nothing, when the group is not there as it was', () async {
      await addLogin(core, 'Orbit');
      final b = await addLogin(core, 'Orbit again');
      final key = (await groups()).single['key']! as String;
      // The second login was made different since, so the pair is no longer a group
      await core.call('saveLogin', [
        b,
        {
          'name': 'Orbit again',
          'username': 'someone-else',
          'password': 'Hunter2-hunter2',
          'websites': ['orbit-cloud.com'],
        },
      ]);
      await expectLater(core.call('duplicateMerge', [key, b, <String, Object?>{}]), failure(CoreFailure.stale));
      await expectLater(core.call('duplicateReview', [key]), failure(CoreFailure.stale));
      expect(await list(core, 'logins'), hasLength(2));
      expect((await object(core, 'duplicates'))['records'], isEmpty);
    });

    test('writes back what a failed save had written, in memory and in storage, and drops the record', () async {
      final one = await addCode(core, 'Orbit');
      final two = await addCode(core, 'orbit-cloud.com');
      final login = await addLogin(core, 'Orbit', websites: ['example.net']);
      await core.call('linkCode', [two, login]);
      final key = (await groups()).single['key']! as String;
      final before = {for (final a in core.vault.lists.accounts) a.id: a.toJson()};
      // The codes are saved first and the login's new link second, which fails
      core.vault.beforeWrite = (kind) async {
        if (kind == 'logins') throw StateError('the disk is full');
      };
      await expectLater(core.call('duplicateMerge', [key, one, <String, Object?>{}]), throwsA(isA<StateError>()));
      core.vault.beforeWrite = null;

      expect({for (final a in core.vault.lists.accounts) a.id: a.toJson()}, before);
      expect(core.vault.lists.logins.single.accountId, two);
      expect((await object(core, 'duplicates'))['records'], isEmpty);
      // Storage agrees with memory: a browser that starts over from it finds the same
      await core.vault.store.flush();
      final again = await startCore(MemoryArea(area.values));
      await again.call('unlock', [password]);
      expect((await list(again, 'codes')).map((c) => c['id']).toSet(), {one, two});
      expect((await list(again, 'logins')).single['codeId'], two);
      // And it can be merged once the disk is back
      expect((await object(core, 'duplicateMerge', [(await groups()).single['key'], one, <String, Object?>{}]))['removed'], 1);
    });

    test('server matching is for a vault that syncs with Kemlock Server', () async {
      expect(await object(core, 'duplicateMatching'), {'available': false, 'on': false});
      await expectLater(core.call('setDuplicateMatching', [true]), failure(CoreFailure.invalid));
    });

    test('the Public Suffix List\'s hash says when the tags are made again', () {
      expect(suffixListHash(null), 'none');
      expect(suffixListHash(''), 'none');
      expect(suffixListHash('com'), isNot(suffixListHash('net')));
      expect(suffixListHash('com'), hasLength(64));
    });
  });

  group('Undo merge after edits', () {
    var at = now;
    late CoreService clocked;

    Future<String> two(CoreService c, String issuer) async =>
        (await object(c, 'addCode', [link(issuer, 'JBSWY3DPEHPK3PXP')]))['id']! as String;

    setUp(() async {
      at = now;
      final platform = fakePlatform(MemoryArea(), clock: () => DateTime.fromMillisecondsSinceEpoch(at, isUtc: true));
      clocked = await CoreService.start(platform, const CoreData(publicSuffixList: smallSuffixList));
      await clocked.call('createVault', [password]);
    });

    Future<String> keyOf() async =>
        (((await object(clocked, 'duplicates'))['groups']! as List<Object?>).single! as Map<String, Object?>)['key']! as String;

    test('asks first when the item that stayed was changed after the merge, and changes nothing until told to', () async {
      final one = await two(clocked, 'Orbit');
      await two(clocked, 'orbit-cloud.com');
      final done = await object(clocked, 'duplicateMerge', [await keyOf(), one, <String, Object?>{}]);
      at += 5000;
      await clocked.call('setTags', [
        'code',
        one,
        ['Mine'],
      ]);
      expect(await clocked.call('duplicateUndo', [done['recordId']]), 'edited');
      expect(await list(clocked, 'codes'), hasLength(1));
      expect(await clocked.call('duplicateUndo', [done['recordId'], true]), 'undone');
      expect(await list(clocked, 'codes'), hasLength(2));
    });

    test('gives a relinked login back only its link: what was edited on it since stays', () async {
      final one = await two(clocked, 'Orbit');
      final removed = await two(clocked, 'orbit-cloud.com');
      final login = await addLogin(clocked, 'Orbit', websites: ['example.net']);
      await clocked.call('linkCode', [removed, login]);
      final done = await object(clocked, 'duplicateMerge', [await keyOf(), one, <String, Object?>{}]);
      expect((await list(clocked, 'logins')).single['codeId'], one);
      at += 5000;
      await clocked.call('saveLogin', [
        login,
        {
          'name': 'Orbit',
          'username': 'sam',
          'password': 'Changed-after-the-merge-2',
          'websites': ['example.net'],
        },
      ]);
      expect(await clocked.call('duplicateUndo', [done['recordId']]), 'undone');
      final back = (await list(clocked, 'logins')).single;
      expect(back['codeId'], removed);
      expect((await object(clocked, 'revealLogin', [login]))['password'], 'Changed-after-the-merge-2');
    });

    test('keeps the tags of the copy that went', () async {
      final one = await two(clocked, 'Orbit');
      final removed = await two(clocked, 'orbit-cloud.com');
      await clocked.call('setTags', [
        'code',
        one,
        ['Work'],
      ]);
      await clocked.call('setTags', [
        'code',
        removed,
        ['Home'],
      ]);
      await clocked.call('duplicateMerge', [await keyOf(), one, <String, Object?>{}]);
      expect(clocked.vault.lists.accounts.single.tags, ['Work', 'Home']);
    });
  });

  group('the breach checks', () {
    const breaches = {
      'source': 'https://haveibeenpwned.com',
      'updated': '2026-11-15',
      'license': 'Breach data from Have I Been Pwned, licensed under Creative Commons Attribution 4.0.',
      'entries': [
        ['OrbitCloud', 'Orbit Cloud', 'orbit-cloud.com', '2026-02-01', '2026-02-10', 1200000, 1],
      ],
    };
    final asked = <Uri>[];

    Future<CoreService> startWith(MemoryArea area, {http.Client Function(String?)? clientFor}) => CoreService.start(
      fakePlatform(area, clientFor: clientFor),
      CoreData(publicSuffixList: smallSuffixList, breachList: jsonEncode(breaches)),
    );

    setUp(() async {
      asked.clear();
      area = MemoryArea();
      core = await startWith(
        area,
        clientFor: (_) => MockClient((request) async {
          asked.add(request.url);
          // SHA-1("password") is 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
          if (request.url.host == 'api.pwnedpasswords.com' && request.url.path == '/range/5BAA6') {
            return http.Response('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3', 200);
          }
          if (request.url.host == 'api.pwnedpasswords.com') return http.Response('0000000000000000000000000000000000A:0', 200);
          return http.Response('no', 503);
        }),
      );
      await core.call('createVault', [password]);
    });

    test('alert for a service whose breach was listed after the code was added, and "Dealt with" ends it', () async {
      final code = await addCode(core, 'Orbit Cloud');
      await core.call('addBackupService', ['Orbit Cloud', 'aaaa1111']);
      await addCode(core, 'Unrelated', secret: 'JBSWY3DPEHPK3PXB');
      var view = await object(core, 'breaches');
      final alert = (view['alerts']! as List<Object?>).single! as Map<String, Object?>;
      expect(alert['name'], 'OrbitCloud');
      expect(alert['passwords'], isTrue);
      expect((alert['entries']! as List<Object?>).map((e) => (e! as Map<String, Object?>)['kind']), ['code', 'backup']);
      expect(view['serviceCount'], 1);
      expect(view['listUpdated'], '2026-11-15');
      expect(view['refreshOn'], isFalse);
      // Nothing was asked of the network: the daily refresh is off
      expect(asked, isEmpty);

      await core.call('dismissBreach', [
        'OrbitCloud',
        [code],
        <String>[],
      ]);
      expect(core.vault.lists.accounts.firstWhere((a) => a.id == code).breachesDismissed, ['OrbitCloud']);
      expect(core.vault.lists.accounts.firstWhere((a) => a.id == code).updatedAt, now);
      view = await object(core, 'breaches');
      // The backup codes still have it
      expect(((view['alerts']! as List<Object?>).single! as Map<String, Object?>)['entries'], hasLength(1));
      await expectLater(
        core.call('dismissBreach', [
          'OrbitCloud',
          ['nope'],
          <String>[],
        ]),
        failure(CoreFailure.notFound),
      );
    });

    test('without the list the extension ships, there is nothing to alert about', () async {
      final bare = await startCore(MemoryArea());
      await bare.call('createVault', [password]);
      await addCode(bare, 'Orbit Cloud');
      expect((await object(bare, 'breaches'))['alerts'], isEmpty);
    });

    test('the refresh of the list is off until turned on, and then asks Have I Been Pwned', () async {
      expect(await object(core, 'toolsSettings'), {'breachRefresh': false});
      expect(
        await object(core, 'saveToolsSettings', [
          <String, Object?>{'breachRefresh': true},
        ]),
        {'breachRefresh': true},
      );
      expect(
        await object(core, 'saveToolsSettings', [
          <String, Object?>{'other': 1},
        ]),
        {'breachRefresh': true},
      );
      final check = await object(core, 'checkBreaches');
      expect(asked.map((u) => u.host), contains('haveibeenpwned.com'));
      // The service said no: the list wasn't checked, and nothing broke
      expect((check['list']! as Map<String, Object?>)['on'], isTrue);
      expect((check['list']! as Map<String, Object?>)['checked'], isFalse);
      expect((check['passwords']! as Map<String, Object?>)['on'], isFalse);
      // The switch is sealed with the vault
      final again = await startWith(MemoryArea(area.values));
      await again.call('unlock', [password]);
      expect(await object(again, 'toolsSettings'), {'breachRefresh': true});
    });

    test('"Check now" asks Pwned Passwords again for every password, five characters of a hash at a time', () async {
      final login = await addLogin(core, 'Orbit', secret: 'password');
      await addLogin(core, 'Docs', username: 'kim', secret: 'Fresh-and-unseen-4!');
      await core.call('saveSettings', [
        <String, Object?>{'breachedPasswords': true},
      ]);
      var check = await object(core, 'checkBreaches');
      expect(check['passwords'], {'on': true, 'breached': 1, 'failed': 0});
      final first = asked.where((u) => u.host == 'api.pwnedpasswords.com').length;
      expect(first, 2);
      // Five characters of a hash, nothing else
      expect(asked.every((u) => RegExp(r'^/range/[0-9A-F]{5}$').hasMatch(u.path)), isTrue);
      final logins = await list(core, 'logins');
      expect(((logins.firstWhere((l) => l['id'] == login)['health']! as Map<String, Object?>)['breached']), isTrue);

      // Asked again, not remembered
      check = await object(core, 'checkBreaches');
      expect(asked.where((u) => u.host == 'api.pwnedpasswords.com').length, first * 2);
    });

    test('"Check now" with the password check off asks nothing about passwords', () async {
      await addLogin(core, 'Orbit', secret: 'password');
      final check = await object(core, 'checkBreaches');
      expect(check['passwords'], {'on': false, 'breached': 0, 'failed': 0});
      expect(asked, isEmpty);
    });

    test('a password the service can\'t answer for is counted, not guessed', () async {
      final down = await startWith(MemoryArea(), clientFor: (_) => MockClient((_) async => http.Response('no', 503)));
      await down.call('createVault', [password]);
      await addLogin(down, 'Orbit', secret: 'password');
      await down.call('saveSettings', [
        <String, Object?>{'breachedPasswords': true},
      ]);
      final check = await object(down, 'checkBreaches');
      expect(check['passwords'], {'on': true, 'breached': 0, 'failed': 1});
    });
  });
}
