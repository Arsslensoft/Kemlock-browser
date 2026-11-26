// Links stay two-way when an item is deleted or when a duplicate merge removes one: the entries that named it are saved in the same
// write (kemlock-core's `droppedLinksTo` and `relinkForMerge`), and Undo puts a merge's links back.
import 'package:kemlock_core/models/item_link.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Map<String, Object?> ref(String kind, String id) => {'kind': kind, 'id': id};

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

Future<String> addNote(CoreService core, String title, {List<Map<String, Object?>> links = const []}) async =>
    (await object(core, 'saveNote', [
          null,
          {'title': title, 'text': 't', 'links': links},
        ]))['id']!
        as String;

Future<String> addCode(CoreService core, String issuer) async =>
    (await object(core, 'addCode', ['otpauth://totp/$issuer:sam?secret=JBSWY3DPEHPK3PXP&issuer=$issuer']))['id']! as String;

void main() {
  late CoreService core;

  setUp(() async {
    core = await startCore(MemoryArea());
    await core.call('createVault', [password]);
  });

  group('deleting an item', () {
    test('a login linked to a note leaves the note with no link to it', () async {
      final login = await addLogin(core, 'Orbit');
      final note = await addNote(core, 'Recovery', links: [ref('login', login)]);
      expect(core.vault.lists.notes.single.links.names(login), isTrue);
      expect(core.vault.lists.logins.single.links.names(note), isTrue);

      await core.call('deleteLogin', [login]);

      expect(core.vault.lists.logins, isEmpty);
      expect(core.vault.lists.notes.single.links, isEmpty);
      expect((await object(core, 'revealNote', [note]))['links'], 0);
    });

    test('a note linked to a login and a code drops both links', () async {
      final login = await addLogin(core, 'Orbit');
      final code = await addCode(core, 'Orbit');
      final note = await addNote(core, 'Recovery', links: [ref('login', login), ref('otp', code)]);
      expect(core.vault.lists.logins.single.links.names(note), isTrue);
      expect(core.vault.lists.accounts.single.links.names(note), isTrue);

      await core.call('deleteNote', [note]);

      expect(core.vault.lists.notes, isEmpty);
      expect(core.vault.lists.logins.single.links, isEmpty);
      expect(core.vault.lists.accounts.single.links, isEmpty);
    });

    test('is one write: when it fails, the other ends keep their links', () async {
      final login = await addLogin(core, 'Orbit');
      final note = await addNote(core, 'Recovery', links: [ref('login', login)]);
      core.vault.beforeWrite = (kind) async {
        if (kind == 'notes') throw StateError('the disk is full');
      };
      await expectLater(core.call('deleteLogin', [login]), throwsA(isA<StateError>()));
      core.vault.beforeWrite = null;

      expect(core.vault.lists.logins, hasLength(1));
      expect(core.vault.lists.notes.single.links.names(login), isTrue);
      expect(core.vault.lists.logins.single.links.names(note), isTrue);
    });
  });

  group('a duplicate merge', () {
    Future<String> groupKey() async {
      final view = await object(core, 'duplicates');
      return ((view['groups']! as List<Object?>).single! as Map<String, Object?>)['key']! as String;
    }

    test('leaves the entries that named the removed login linked to the kept one, at both ends', () async {
      final kept = await addLogin(core, 'Orbit');
      final removed = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final note = await addNote(core, 'Recovery', links: [ref('login', removed)]);

      final done = await object(core, 'duplicateMerge', [await groupKey(), kept, <String, Object?>{}]);

      expect(done['removed'], 1);
      final lists = core.vault.lists;
      expect(lists.logins.single.id, kept);
      expect(lists.notes.single.links.names(kept), isTrue, reason: 'the note names the login that stays');
      expect(lists.notes.single.links.names(removed), isFalse);
      expect(lists.logins.single.links.names(note), isTrue, reason: 'and the login that stays names the note');
    });

    test('is put back by Undo: the note names the removed login again, and the kept one is as it was', () async {
      final kept = await addLogin(core, 'Orbit');
      final removed = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final note = await addNote(core, 'Recovery', links: [ref('login', removed)]);
      final done = await object(core, 'duplicateMerge', [await groupKey(), kept, <String, Object?>{}]);

      expect(await core.call('duplicateUndo', [done['recordId']]), 'undone');

      final lists = core.vault.lists;
      expect({for (final login in lists.logins) login.id}, {kept, removed});
      expect(lists.notes.single.links.names(removed), isTrue);
      expect(lists.notes.single.links.names(kept), isFalse);
      expect(lists.logins.firstWhere((login) => login.id == removed).links.names(note), isTrue);
      expect(lists.logins.firstWhere((login) => login.id == kept).links, isEmpty);
    });

    test('is put back by Undo only where the note still holds what the merge wrote', () async {
      final kept = await addLogin(core, 'Orbit');
      final removed = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final note = await addNote(core, 'Recovery', links: [ref('login', removed)]);
      final done = await object(core, 'duplicateMerge', [await groupKey(), kept, <String, Object?>{}]);
      // The note is linked to a code after the merge: what it holds is not what the merge wrote, so Undo leaves it as it is
      final code = await addCode(core, 'Orbit');
      await core.call('setLinks', [
        ref('note', note),
        [ref('login', kept), ref('otp', code)],
      ]);

      expect(await core.call('duplicateUndo', [done['recordId'], true]), 'undone');

      final held = core.vault.lists.notes.single;
      expect(held.links.names(code), isTrue);
    });
  });
}
