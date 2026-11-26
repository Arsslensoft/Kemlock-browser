// Files of items (docs/plans/add-item-format.md): File items and notes' attachments listed without a key, staging in pieces, what needs
// Kemlock Server, and the entry of a file that never went up taken out again. The upload itself goes through the sync's run, which the
// end-to-end tests have a server for.
import 'dart:convert';
import 'dart:typed_data';

import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_file.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/item_files.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:kemlock_extension_core/src/vault_service.dart' show keyExtensionPendingFiles;
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
final sha = 'ab' * 32;

// A link names an item by its UUID
const f1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const f2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const f3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

String piece(int length) => base64Encode(Uint8List(length)..fillRange(0, length, 7));

NoteAttachment attachment(String id, {bool onServer = false}) => NoteAttachment(
  id: id,
  name: '$id.pdf',
  size: 1200,
  type: 'application/pdf',
  key: 'a2V5',
  addedAt: 5,
  sha256: sha,
  extra: onServer ? {'kemlockFile': 'server-$id'} : const {},
);

void main() {
  late MemoryArea area;
  late CoreService core;

  setUp(() async {
    area = MemoryArea();
    core = await startCore(area);
    await core.call('createVault', [password]);
  });

  group('the files waiting to go up', () {
    test('are held in memory, handed to a run by id, and zeroed when dropped', () async {
      final store = PendingFiles();
      final bytes = Uint8List.fromList([1, 2, 3]);
      store.put('a', bytes);
      expect(store.holds('a'), isTrue);
      expect(await store.readSealed('a'), bytes);
      expect(await store.readSealed('b'), isNull);
      // A browser keeps no file: a run is told every file is held, so it never fetches one
      expect(await store.exists('b'), isTrue);
      await store.writeSealed('b', Uint8List(2));
      expect(store.holds('b'), isFalse);
      store.drop('a');
      expect(store.holds('a'), isFalse);
      expect(bytes, [0, 0, 0]);
      store.put('c', Uint8List.fromList([9]));
      store.clear();
      expect(store.holds('c'), isFalse);
    });
  });

  group('staging', () {
    test('adds pieces to one file under a handle, and a piece for a handle nobody holds is lost', () async {
      final first = await object(core, 'stageItemFile', [piece(10), null]);
      expect(first['length'], 10);
      final second = await object(core, 'stageItemFile', [piece(5), first['handle']]);
      expect(second, {'handle': first['handle'], 'length': 15});
      await core.call('releaseStaged', [first['handle']]);
      await expectLater(core.call('stageItemFile', [piece(1), first['handle']]), failure(CoreFailure.lost));
    });

    test('refuses a piece that is not base64, or over a megabyte, and a file over 50 MiB', () async {
      await expectLater(core.call('stageItemFile', ['***', null]), failure(CoreFailure.invalid));
      await expectLater(core.call('stageItemFile', [piece(1024 * 1024 + 1), null]), failure(CoreFailure.invalid));
      final first = await object(core, 'stageItemFile', [piece(1024 * 1024), null]);
      for (var i = 1; i < 50; i++) {
        await core.call('stageItemFile', [piece(1024 * 1024), first['handle']]);
      }
      await expectLater(core.call('stageItemFile', [piece(1), first['handle']]), failure(CoreFailure.tooLarge));
      await expectLater(core.call('stageItemFile', [piece(1), first['handle']]), failure(CoreFailure.lost), reason: 'it was dropped');
    });

    test('keeps at most four files, and the oldest goes', () async {
      final handles = [
        for (var i = 0; i < 5; i++) (await object(core, 'stageItemFile', [piece(1), null]))['handle'],
      ];
      await expectLater(core.call('stageItemFile', [piece(1), handles.first]), failure(CoreFailure.lost));
      await core.call('stageItemFile', [piece(1), handles.last]);
    });

    test('is forgotten when the vault locks', () async {
      final first = await object(core, 'stageItemFile', [piece(1), null]);
      await core.call('lock');
      await core.call('unlock', [password]);
      await expectLater(core.call('stageItemFile', [piece(1), first['handle']]), failure(CoreFailure.lost));
    });
  });

  group('without Kemlock Server', () {
    test('files are listed and nothing goes up or comes down', () async {
      await core.vault.applySynced(
        Lists(
          notes: [
            SecureNote(id: 'n1', title: 'Passport', text: '', attachments: [attachment('a1')], addedAt: 1),
          ],
        ),
      );
      final staged = await object(core, 'stageItemFile', [piece(10), null]);
      await expectLater(
        core.call('addAttachments', [
          'n1',
          [
            {'handle': staged['handle'], 'name': 'x.txt'},
          ],
        ]),
        failure(CoreFailure.unavailable),
      );
      await expectLater(
        core.call('saveFile', [
          null,
          {
            'name': 'x',
            'staged': {'handle': staged['handle'], 'name': 'x.txt'},
          },
        ]),
        failure(CoreFailure.unavailable),
      );
      await expectLater(
        core.call('openItemFile', [
          {'kind': 'note', 'id': 'n1'},
          'a1',
        ]),
        failure(CoreFailure.unavailable),
      );
      expect(core.vault.lists.notes.single.files, hasLength(1));
      expect(core.vault.lists.files, isEmpty);
    });

    test('a File item needs a file when it is new', () async {
      await expectLater(
        core.call('saveFile', [
          null,
          {'name': 'x'},
        ]),
        failure(CoreFailure.invalid),
      );
    });
  });

  group('File items', () {
    setUp(() async {
      await core.vault.applySynced(
        Lists(
          files: [
            VaultFile(
              id: f1,
              name: 'Passport scan',
              notes: 'front and back',
              file: attachment('a1', onServer: true),
              addedAt: 5,
              pinned: true,
            ),
            VaultFile(id: f2, name: 'Draft', file: attachment('a2'), addedAt: 0),
          ],
        ),
      );
    });

    test('are listed by name with the size and whether the server holds the file, and never the key', () async {
      final views = await list(core, 'files');
      expect(views.map((v) => v['name']), ['Passport scan', 'Draft']);
      expect(views[0], containsPair('fileName', 'a1.pdf'));
      expect(views[0], containsPair('size', 1200));
      expect(views[0], containsPair('type', 'application/pdf'));
      expect(views[0], containsPair('onServer', true));
      expect(views[0], containsPair('pinned', true));
      expect(views[0], containsPair('links', 0));
      expect(views[1], containsPair('onServer', false));
      expect(jsonEncode(views), isNot(contains('a2V5')));
      expect(views[0].containsKey('notes'), isFalse);
    });

    test('are revealed with their notes', () async {
      final full = await object(core, 'revealFile', [f1]);
      expect(full['notes'], 'front and back');
      expect(jsonEncode(full), isNot(contains('a2V5')));
      expect((await object(core, 'revealFile', [f2]))['notes'], '');
      await expectLater(core.call('revealFile', ['nope']), failure(CoreFailure.notFound));
    });

    test('change their name, notes, pin and tags without a file, and keep the file as it was', () async {
      final before = core.vault.lists.files.first.file.toJson();
      final view = await object(core, 'saveFile', [
        f1,
        {
          'name': 'Passport',
          'notes': '',
          'pinned': false,
          'tags': ['id'],
        },
      ]);
      expect(view['name'], 'Passport');
      expect(view['pinned'], isFalse);
      expect(view['tags'], ['id']);
      final held = core.vault.lists.files.first;
      expect(held.notes, isNull);
      expect(held.file.toJson(), before);
      await expectLater(
        core.call('saveFile', [
          f1,
          {'name': '  '},
        ]),
        failure(CoreFailure.invalid),
      );
    });

    test('are deleted', () async {
      await core.call('deleteFile', [f2]);
      expect((await list(core, 'files')).map((v) => v['id']), [f1]);
      await expectLater(core.call('deleteFile', [f2]), failure(CoreFailure.notFound));
    });

    test('are linked to other items, and show it', () async {
      final note = await object(core, 'saveNote', [
        null,
        {'title': 'Trip', 'text': ''},
      ]);
      final view = await object(core, 'saveFile', [
        f1,
        {
          'name': 'Passport scan',
          'links': [
            {'kind': 'note', 'id': note['id']},
          ],
        },
      ]);
      expect(view['links'], 1);
      expect(core.vault.lists.notes.single.links, hasLength(1));
      expect(
        (await list(core, 'linkedItems', [
          {'kind': 'file', 'id': f1},
        ])).single['name'],
        'Trip',
      );
    });
  });

  group('attachments', () {
    setUp(() async {
      await core.vault.applySynced(
        Lists(
          notes: [
            SecureNote(id: 'n1', title: 'Papers', text: 't', attachments: [attachment('a1', onServer: true), attachment('a2')], addedAt: 1),
          ],
        ),
      );
    });

    test('are shown with their id, size, type and hash, whether the server holds them, and not their key', () async {
      final full = await object(core, 'revealNote', ['n1']);
      expect(full['attachments'], [
        {'id': 'a1', 'name': 'a1.pdf', 'size': 1200, 'type': 'application/pdf', 'sha256': sha, 'onServer': true},
        {'id': 'a2', 'name': 'a2.pdf', 'size': 1200, 'type': 'application/pdf', 'sha256': sha, 'onServer': false},
      ]);
      expect(jsonEncode(full), isNot(contains('a2V5')));
    });

    test('one is removed, and the others stay as they were', () async {
      final before = core.vault.lists.notes.single.files.first.toJson();
      final full = await object(core, 'removeAttachment', ['n1', 'a2']);
      expect((full['attachments']! as List<Object?>), hasLength(1));
      expect(core.vault.lists.notes.single.files.single.toJson(), before);
      await expectLater(core.call('removeAttachment', ['n1', 'a2']), failure(CoreFailure.notFound));
      final empty = await object(core, 'removeAttachment', ['n1', 'a1']);
      expect(empty['attachments'], isEmpty);
      expect(core.vault.lists.notes.single.attachments, isNull);
    });
  });

  group('an opened file', () {
    test('is unknown unless the core holds it, and closing one it does not hold is harmless', () async {
      await expectLater(core.call('readOpened', ['nope', 0]), failure(CoreFailure.lost));
      await core.call('closeOpened', ['nope']);
    });
  });

  group('a file that never went up', () {
    Future<void> remember(List<Map<String, Object?>> records) =>
        core.vault.vault.saveEncryptedValue(keyExtensionPendingFiles, records, core.vault.session!);

    test('is taken out of its item when nothing holds its bytes, and one the server holds stays', () async {
      await core.vault.applySynced(
        Lists(
          notes: [
            SecureNote(id: 'n1', title: 'Papers', text: 't', attachments: [attachment('a1', onServer: true), attachment('a2')], addedAt: 1),
          ],
          files: [
            VaultFile(id: f1, name: 'New', file: attachment('a3'), addedAt: 1),
            VaultFile(id: f2, name: 'Replaced', file: attachment('a4'), addedAt: 1),
            VaultFile(id: f3, name: 'Up', file: attachment('a5', onServer: true), addedAt: 1),
          ],
        ),
      );
      await remember([
        {'item': 'n1', 'kind': 'note', 'file': 'a1', 'fresh': false},
        {'item': 'n1', 'kind': 'note', 'file': 'a2', 'fresh': false},
        {'item': f1, 'kind': 'file', 'file': 'a3', 'fresh': true},
        {'item': f2, 'kind': 'file', 'file': 'a4', 'fresh': false, 'prior': attachment('old', onServer: true).toJson()},
        {'item': f3, 'kind': 'file', 'file': 'a5', 'fresh': false},
      ]);
      await core.itemFiles.settle();
      expect(core.vault.lists.notes.single.files.map((f) => f.id), ['a1']);
      expect(core.vault.lists.files.map((f) => f.id), [f2, f3]);
      expect(core.vault.lists.files.first.file.id, 'old', reason: 'a replaced file is put back');
      expect(await core.vault.vault.loadEncryptedValue(keyExtensionPendingFiles, core.vault.session!), isNull);
    });

    test('is left alone while its bytes are held, because it is going up', () async {
      await core.vault.applySynced(
        Lists(
          files: [VaultFile(id: f1, name: 'New', file: attachment('a3'), addedAt: 1)],
        ),
      );
      await remember([
        {'item': f1, 'kind': 'file', 'file': 'a3', 'fresh': true},
      ]);
      core.itemFiles.pending.put('a3', Uint8List(3));
      await core.itemFiles.settle();
      expect(core.vault.lists.files, hasLength(1));
      expect(await core.vault.vault.loadEncryptedValue(keyExtensionPendingFiles, core.vault.session!), isNotNull);
    });

    test('is settled when the vault opens', () async {
      await core.vault.applySynced(
        Lists(
          files: [VaultFile(id: f1, name: 'New', file: attachment('a3'), addedAt: 1)],
        ),
      );
      await remember([
        {'item': f1, 'kind': 'file', 'file': 'a3', 'fresh': true},
      ]);
      await core.call('lock');
      await core.call('unlock', [password]);
      expect(core.vault.lists.files, isEmpty);
    });
  });
}
