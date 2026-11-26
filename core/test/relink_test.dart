// Links stay two-way when an item is deleted or when a duplicate merge removes one: the entries that named it are saved in the same
// write (kemlock-core's `droppedLinksTo` and `relinkForMerge`), Undo puts a merge's links back, and a replace-import takes away the
// links to the codes it removes.
import 'dart:async';
import 'dart:convert';

import 'package:kemlock_core/features/duplicates/dedup_store.dart' show DedupStore;
import 'package:kemlock_core/features/duplicates/duplicate_merge.dart';
import 'package:kemlock_core/models/item_link.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/item_extras.dart' show listsWithEntry;
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

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

Future<String> addCode(CoreService core, String issuer, {String secret = 'JBSWY3DPEHPK3PXP'}) async =>
    (await object(core, 'addCode', ['otpauth://totp/$issuer:sam?secret=$secret&issuer=$issuer']))['id']! as String;

/// A storage area that runs [onAnswers] once, when the duplicate cleaner's answers (the merge record) are written: what another page does
/// between a merge's record and its write.
class WatchedArea extends MemoryArea {
  void Function()? onAnswers;

  @override
  Future<void> write(String key, String value) {
    final run = key.contains('dedup_answers') ? onAnswers : null;
    if (run != null) {
      onAnswers = null;
      run();
    }
    return super.write(key, value);
  }
}

/// An edit guard that refuses a change to the entry [id], as one of a space the person can only read.
void Function(String?, String) readOnly(String id) => (space, entry) {
  if (entry == id) throw const CoreFailure('space_readOnly', 'a space where this account may not edit');
};

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

    test('a card and an identity linked to a note drop the link on deleting', () async {
      final note = await addNote(core, 'Recovery');
      final card =
          (await object(core, 'saveCard', [
                null,
                {
                  'name': 'Visa',
                  'number': '4111111111111111',
                  'links': [ref('note', note)],
                },
              ]))['id']!
              as String;
      final identity =
          (await object(core, 'saveIdentity', [
                null,
                {
                  'name': 'Me',
                  'email': 'me@orbit-cloud.com',
                  'links': [ref('note', note)],
                },
              ]))['id']!
              as String;
      expect(core.vault.lists.notes.single.links.names(card), isTrue);
      expect(core.vault.lists.notes.single.links.names(identity), isTrue);

      await core.call('deleteCard', [card]);
      expect(core.vault.lists.notes.single.links.names(card), isFalse);
      expect(core.vault.lists.notes.single.links.names(identity), isTrue);
      await core.call('deleteIdentity', [identity]);

      expect(core.vault.lists.notes.single.links, isEmpty);
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

    test('is done, and the link left one-way, when the other end is an entry this account may not edit', () async {
      final login = await addLogin(core, 'Orbit');
      final note = await addNote(core, 'Recovery', links: [ref('login', login)]);
      core.vault.editGuard = readOnly(note);

      await core.call('deleteLogin', [login]);

      expect(core.vault.lists.logins, isEmpty);
      expect(core.vault.lists.notes.single.links.names(login), isTrue, reason: 'the read-only end is left as it was');
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
      expect(held.links.names(kept), isTrue, reason: 'a blind put-back would have given the note back to the login that went');
      expect(held.links.names(removed), isFalse);
    });

    test('is put back by Undo from a record made before the undo steps were kept', () async {
      final kept = await addLogin(core, 'Orbit');
      final removed = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final note = await addNote(core, 'Recovery', links: [ref('login', removed)]);
      final done = await object(core, 'duplicateMerge', [await groupKey(), kept, <String, Object?>{}]);
      final store = DedupStore(core.vault.vault);
      final session = core.vault.session!;
      final answers = await store.loadAnswers(session);
      final made = answers.mergeRecords.single;
      expect(made.relinkUndo, isNotEmpty);
      final older = MergeRecord(id: made.id, at: made.at, kind: made.kind, kept: made.kept, removed: made.removed, relinked: made.relinked);
      await store.saveAnswers(answers.withoutMerge(made.id).withMerge(older), session);

      expect(await core.call('duplicateUndo', [done['recordId']]), 'undone');

      final lists = core.vault.lists;
      expect({for (final login in lists.logins) login.id}, {kept, removed});
      expect(lists.logins.firstWhere((login) => login.id == removed).links.names(note), isTrue);
      expect((await object(core, 'duplicates'))['records'], isEmpty);
    });

    test('keeps the logins linked to the code that stays when two codes merge', () async {
      final one = await addCode(core, 'Orbit');
      final two = await addCode(core, 'orbit-cloud.com');
      final login = await addLogin(core, 'Mail');
      await core.call('linkCode', [two, login]);
      expect(core.vault.lists.logins.single.accountId, two);

      await core.call('duplicateMerge', [await groupKey(), one, <String, Object?>{}]);

      expect(core.vault.lists.accounts.single.id, one);
      expect(core.vault.lists.logins.single.accountId, one);
      expect((await core.call('linkedItems', [ref('login', login)]))! as List<Object?>, [containsPair('ref', ref('otp', one))]);
    });

    test('is done, and a read-only end is left as it was, when an entry that named the removed login may not be edited', () async {
      final kept = await addLogin(core, 'Orbit');
      final removed = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final note = await addNote(core, 'Recovery', links: [ref('login', removed)]);
      final key = await groupKey();
      core.vault.editGuard = readOnly(note);

      final done = await object(core, 'duplicateMerge', [key, kept, <String, Object?>{}]);

      expect(done['removed'], 1);
      expect(core.vault.lists.logins.single.id, kept);
      expect(core.vault.lists.notes.single.links.names(removed), isTrue, reason: 'the note could not be written');
      expect(core.vault.lists.notes.single.links.names(kept), isFalse);
    });

    test('is stale, and changes nothing, when a link changed between the record and the write', () async {
      final area = WatchedArea();
      core = await startCore(area);
      await core.call('createVault', [password]);
      final kept = await addLogin(core, 'Orbit');
      final removed = await addLogin(core, 'Orbit again', secret: 'Newer-secret-88');
      final other = await addNote(core, 'Other');
      final key = await groupKey();
      // Another page links the other note to the login that goes, one-way, so no item of the group changes
      area.onAnswers = () => unawaited(
        core.vault.saveChanged((held) {
          final note = held.notes.single;
          return listsWithEntry(held, note.withLinks([ItemLink(removed)], ownIds: [note.id]));
        }),
      );

      await expectLater(core.call('duplicateMerge', [key, kept, <String, Object?>{}]), failure(CoreFailure.stale));

      expect({for (final login in core.vault.lists.logins) login.id}, {kept, removed});
      expect(core.vault.lists.notes.single.id, other);
      expect(core.vault.lists.notes.single.links.names(removed), isTrue);
      expect((await object(core, 'duplicates'))['records'], isEmpty);
    });
  });

  group('a replace-import', () {
    test('takes the links to the codes it removes off the entries that named them', () async {
      final from = await startCore(MemoryArea());
      await from.call('createVault', [password]);
      await addCode(from, 'Orbit');
      final text = (await object(from, 'transferExport', [
        {'format': 'links', 'password': password},
      ]))['text']!;
      final other = await addCode(core, 'Other', secret: 'GEZDGNBVGY3TQOJQ');
      final login = await addLogin(core, 'Mail');
      await core.call('linkCode', [other, login]);
      final note = await addNote(core, 'Recovery', links: [ref('otp', other)]);
      expect(core.vault.lists.logins.single.accountId, other);
      expect(core.vault.lists.notes.single.links.names(other), isTrue);

      final opened = await object(core, 'transferOpen', [base64.encode(utf8.encode(text as String))]);
      final token = opened['token']! as String;
      await object(core, 'transferPreview', [token]);
      await object(core, 'transferApply', [
        token,
        {'mode': 'replace'},
      ]);

      expect(core.vault.lists.accounts.map((code) => code.issuer), ['Orbit']);
      expect(core.vault.lists.logins.single.accountId, isNull, reason: 'the login no longer names a code that is gone');
      expect(core.vault.lists.notes.single.id, note);
      expect(core.vault.lists.notes.single.links, isEmpty);
    });
  });
}
