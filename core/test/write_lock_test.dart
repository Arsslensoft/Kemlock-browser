// The vault's single write lock: writes that start together run one after the other, each on the lists the one before it left, so that
// none is lost to another's wait. The tests start the writes without waiting for any of them, as two pages and a sync do.
import 'dart:async';

import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/item_link.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/item_extras.dart' show listsWithEntry;
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:kemlock_extension_core/src/vault_service.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<String> addLogin(CoreService core, String name) async =>
    (await object(core, 'saveLogin', [
          null,
          {
            'name': name,
            'username': 'sam',
            'password': 'Hunter2-hunter2',
            'websites': ['orbit-cloud.com'],
          },
        ]))['id']!
        as String;

void main() {
  late CoreService core;

  setUp(() async {
    core = await startCore(MemoryArea());
    await core.call('createVault', [password]);
  });

  Map<String, Object?> note(String title) => {'title': title, 'text': ''};

  test('two saves and a sync applied together are all kept', () async {
    await addLogin(core, 'Orbit');
    final read = core.vault.lists;
    final revision = core.vault.revision;
    // What a sync worked out from the lists it read: a note from another device
    const remote = SecureNote(id: 'remote', title: 'From the server', addedAt: 5);
    final synced = Lists(logins: read.logins, notes: const [remote]);

    final results = await Future.wait<Object?>([
      core.vault.applySynced(synced, ifRevision: revision),
      core.vault.saveNote(null, note('Local note')),
      core.vault.saveCard(null, {'name': 'Visa', 'number': '4111111111111111'}),
    ]);

    expect(results.first, isTrue);
    final lists = core.vault.lists;
    expect(lists.notes.map((held) => held.title), unorderedEquals(['From the server', 'Local note']));
    expect(lists.cards.map((held) => held.name), ['Visa']);
    expect(lists.logins, hasLength(1));
  });

  test('is the same once it has been stored: a new start reads all three', () async {
    final area = MemoryArea();
    final first = await startCore(area);
    await first.call('createVault', [password]);
    const remote = SecureNote(id: 'remote', title: 'From the server', addedAt: 5);
    await Future.wait<Object?>([
      first.vault.applySynced(const Lists(notes: [remote]), ifRevision: first.vault.revision),
      first.vault.saveNote(null, note('Local note')),
      first.vault.saveNote(null, note('Another note')),
    ]);
    final again = await startCore(MemoryArea(area.values));
    await again.call('unlock', [password]);
    expect(again.vault.lists.notes.map((held) => held.title), unorderedEquals(['From the server', 'Local note', 'Another note']));
  });

  test('a sync that a save got ahead of is not applied, and the save stays', () async {
    final revision = core.vault.revision;
    const remote = SecureNote(id: 'remote', title: 'From the server', addedAt: 5);

    final results = await Future.wait<Object?>([
      core.vault.saveNote(null, note('Local note')),
      core.vault.applySynced(const Lists(notes: [remote]), ifRevision: revision),
    ]);

    // What the sync read is out of date: the next run merges the save in
    expect(results.last, isFalse);
    expect(core.vault.lists.notes.map((held) => held.title), ['Local note']);
  });

  test('two saves of one kind started together keep both', () async {
    await Future.wait<Object?>([
      core.vault.saveNote(null, note('One')),
      core.vault.saveNote(null, note('Two')),
      core.vault.saveNote(null, note('Three')),
    ]);
    expect(core.vault.lists.notes.map((held) => held.title), unorderedEquals(['One', 'Two', 'Three']));
  });

  test('a change to many items worked out before a save landed does not undo it', () async {
    final id = await addLogin(core, 'Orbit');
    await Future.wait<Object?>([
      core.vault.saveNote(null, note('Local note')),
      core.vault.saveChanged(
        (held) => Lists(
          notes: held.notes,
          logins: [
            for (final login in held.logins) login.id == id ? login.copyWith(tags: const ['Work']) : login,
          ],
        ),
      ),
    ]);

    expect(core.vault.lists.notes.map((held) => held.title), ['Local note']);
    expect(core.vault.lists.logins.single.tags, ['Work']);
  });

  test('a failed write passes its failure on and does not block the next', () async {
    // The first write fails once it has the lock, after the second has been queued behind it
    var thrown = false;
    core.vault.beforeWrite = (kind) async {
      if (thrown) return;
      thrown = true;
      throw StateError('storage failed');
    };
    final failed = core.vault.saveChanged(
      (_) => const Lists(
        notes: [SecureNote(id: 'lost', title: 'Lost', addedAt: 1)],
      ),
    );
    final next = core.vault.saveNote(null, note('Kept'));
    await expectLater(failed, throwsA(isA<StateError>()));
    await next;
    expect(core.vault.lists.notes.map((held) => held.title), ['Kept']);
  });

  test('a tag rename queued behind a password save keeps the new password', () async {
    final id = await addLogin(core, 'Orbit');
    await core.call('setTags', [
      'login',
      id,
      ['Work'],
    ]);

    // The save has the lock first; the rename is worked out from the lists it leaves, not from the ones the rename read
    final saved = core.vault.saveLogin(id, {
      'name': 'Orbit',
      'username': 'sam',
      'password': 'New-password-9',
      'websites': ['orbit-cloud.com'],
      'tags': ['Work'],
    });
    final renamed = core.call('renameTag', ['Work', 'Job']);
    await Future.wait<Object?>([saved, renamed]);

    expect(core.vault.revealLogin(id)['password'], 'New-password-9');
    expect(core.vault.lists.logins.single.tags, ['Job']);
  });

  test('a merge whose kept item was deleted meanwhile is refused as stale, and writes nothing', () async {
    final kept = await addLogin(core, 'Orbit');
    final other = await addLogin(core, 'Orbit again');
    final groups = ((await object(core, 'duplicates'))['groups']! as List<Object?>).cast<Map<String, Object?>>();
    final key = groups.single['key']! as String;

    // A write holds the lock while it deletes the kept login, and the merge is made behind it
    final gate = Completer<void>();
    var first = true;
    core.vault.beforeWrite = (kind) async {
      if (!first) return;
      first = false;
      await gate.future;
    };
    final deleting = core.vault.saveChanged(
      (held) => Lists(
        logins: [
          for (final login in held.logins)
            if (login.id != kept) login,
        ],
      ),
    );
    final merging = core.call('duplicateMerge', [key, kept, <String, Object?>{}]);
    final refused = expectLater(merging, throwsA(isA<CoreFailure>().having((e) => e.code, 'code', CoreFailure.stale)));
    // The merge reads, checks and writes its record before it queues for the lock: it has got there after this wait
    await Future<void>.delayed(const Duration(seconds: 1));
    gate.complete();
    await deleting;
    await refused;

    expect(core.vault.lists.logins.map((login) => login.id), [other]);
    expect(((await object(core, 'duplicates'))['records']! as List<Object?>), isEmpty);
  });

  test('two presses on a counter code never write the same counter', () async {
    final added = await object(core, 'addCode', ['otpauth://hotp/Orbit:sam?secret=JBSWY3DPEHPK3PXP&issuer=Orbit&counter=4', null, null]);
    final id = added['id']! as String;
    await Future.wait<Object?>([core.vault.nextHotp(id), core.vault.nextHotp(id), core.vault.nextHotp(id)]);
    expect(core.vault.lists.accounts.single.counter, 7);
  });

  test('two presses on a service take two backup codes, not the same one', () async {
    final service = await object(core, 'addBackupService', ['Orbit', 'aaaa-1111\nbbbb-2222\ncccc-3333']);
    final id = service['serviceId']! as String;
    final taken = await Future.wait([core.vault.useBackupCode(id), core.vault.useBackupCode(id)]);
    expect(taken.toSet(), hasLength(2));
    expect(core.vault.lists.backupServices.single.codes.where((code) => code.used), hasLength(2));
    await expectLater(
      Future.wait([core.vault.useBackupCode(id), core.vault.useBackupCode(id)]),
      throwsA(isA<CoreFailure>().having((e) => e.code, 'code', CoreFailure.notFound)),
    );
  });

  group('an edit is made on the entry the write holds, not on a copy read before it waited', () {
    test('a note saved with a new title keeps the file a run just named', () async {
      final saved = await object(core, 'saveNote', [null, note('Papers')]);
      final id = saved['id']! as String;
      final file = NoteAttachment(id: 'a1', name: 'a.pdf', size: 1, key: 'a2V5', addedAt: 1);
      await Future.wait<Object?>([
        core.vault.saveChanged((held) => listsWithEntry(held, held.notes.single.copyWith(attachments: [file]))),
        core.call('saveNote', [id, note('Renamed')]),
      ]);
      expect(core.vault.lists.notes.single.title, 'Renamed');
      expect(core.vault.lists.notes.single.files.map((f) => f.id), ['a1']);
    });

    test('a login saved with a new name keeps the pin and the link another write gave it', () async {
      final id = await addLogin(core, 'Orbit');
      final other = (await object(core, 'saveNote', [null, note('Recovery')]))['id']! as String;
      await Future.wait<Object?>([
        core.vault.saveChanged((held) => listsWithEntry(held, held.logins.single.copyWith(pinned: true))),
        core.call('setLinks', [
          {'kind': 'login', 'id': id},
          [
            {'kind': 'note', 'id': other},
          ],
        ]),
        core.call('saveLogin', [
          id,
          {'name': 'Renamed', 'username': 'sam', 'password': 'Hunter2-hunter2', 'websites': ['orbit-cloud.com']},
        ]),
      ]);
      final login = core.vault.lists.logins.single;
      expect(login.name, 'Renamed');
      expect(login.pinned, isTrue);
      expect(login.links.names(core.vault.lists.notes.single.id), isTrue);
    });

    test('a login saved with keepPassword keeps the password another write set', () async {
      final id = await addLogin(core, 'Orbit');
      await Future.wait<Object?>([
        core.vault.saveChanged((held) => listsWithEntry(held, held.logins.single.withPassword('Second-pass-99', 5))),
        core.call('saveLogin', [
          id,
          {'name': 'Renamed', 'username': 'sam', 'keepPassword': true, 'websites': ['orbit-cloud.com']},
        ]),
      ]);
      expect(core.vault.lists.logins.single.name, 'Renamed');
      expect(core.vault.lists.logins.single.password, 'Second-pass-99');
    });

    test('a card saved with a new name keeps the pin another write gave it', () async {
      final saved = await object(core, 'saveCard', [null, {'name': 'Visa', 'number': '4111111111111111'}]);
      final id = saved['id']! as String;
      await Future.wait<Object?>([
        core.vault.saveChanged((held) => listsWithEntry(held, held.cards.single.copyWith(pinned: true))),
        core.call('saveCard', [id, {'name': 'Visa Gold', 'number': '4111111111111111'}]),
      ]);
      expect(core.vault.lists.cards.single.name, 'Visa Gold');
      expect(core.vault.lists.cards.single.pinned, isTrue);
    });

    test('an identity saved with a new name keeps the pin another write gave it', () async {
      final saved = await object(core, 'saveIdentity', [null, {'name': 'Me', 'email': 'me@orbit-cloud.com'}]);
      final id = saved['id']! as String;
      await Future.wait<Object?>([
        core.vault.saveChanged((held) => listsWithEntry(held, held.identities.single.copyWith(pinned: true))),
        core.call('saveIdentity', [id, {'name': 'Myself', 'email': 'me@orbit-cloud.com'}]),
      ]);
      expect(core.vault.lists.identities.single.name, 'Myself');
      expect(core.vault.lists.identities.single.pinned, isTrue);
    });

    test('a code saved with a new name keeps the counter a press moved', () async {
      final added = await object(core, 'addCode', ['otpauth://hotp/Orbit:sam?secret=JBSWY3DPEHPK3PXP&issuer=Orbit&counter=4', null, null]);
      final id = added['id']! as String;
      await Future.wait<Object?>([
        core.vault.nextHotp(id),
        core.call('saveCode', [
          id,
          {'name': 'Work'},
        ]),
      ]);
      expect(core.vault.lists.accounts.single.name, 'Work');
      expect(core.vault.lists.accounts.single.counter, 5);
    });

    test('backup codes saved with a new name keep the code a press used', () async {
      final service = await object(core, 'addBackupService', ['Orbit', 'aaaa-1111\nbbbb-2222\ncccc-3333']);
      final id = service['serviceId']! as String;
      await Future.wait<Object?>([
        core.vault.useBackupCode(id),
        core.call('saveBackupCodes', [
          id,
          {'name': 'Work'},
        ]),
      ]);
      expect(core.vault.lists.backupServices.single.name, 'Work');
      expect(core.vault.lists.backupServices.single.codes.where((code) => code.used), hasLength(1));
    });

    test('a contact saved with a new name keeps the phone another write gave it', () async {
      final saved = await object(core, 'saveContact', [
        {'name': 'Sam'},
      ]);
      final id = saved['id']! as String;
      await Future.wait<Object?>([
        core.vault.saveChanged((held) => listsWithEntry(held, held.contacts.single.copyWith(phone: '555'))),
        core.call('saveContact', [
          {'id': id, 'name': 'Samuel'},
        ]),
      ]);
      expect(core.vault.lists.contacts.single.name, 'Samuel');
      expect(core.vault.lists.contacts.single.phone, '555');
    });
  });
}
