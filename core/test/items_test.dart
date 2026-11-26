// Notes, cards and identities in the browser's vault (docs/plans/add-items.md): the lists hold no secret, a reveal is the whole
// item, a save changes only what the browser edits and stamps the item changed, and what was saved is what the app reads back.
import 'dart:convert';

import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
var _time = 1700000000000;

DateTime _clock() => DateTime.fromMillisecondsSinceEpoch(_time, isUtc: true);

Future<CoreService> open(MemoryArea area) =>
    CoreService.start(fakePlatform(area, clock: _clock), const CoreData(publicSuffixList: smallSuffixList));

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method) async =>
    ((await core.call(method))! as List<Object?>).cast<Map<String, Object?>>();

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

void main() {
  late MemoryArea area;
  late CoreService core;

  setUp(() async {
    _time = 1700000000000;
    area = MemoryArea();
    core = await open(area);
    await core.call('createVault', [password]);
  });

  group('notes', () {
    test('are saved, listed by title only, revealed with their text, and deleted', () async {
      final saved = await object(core, 'saveNote', [
        null,
        {
          'title': 'Wi-Fi',
          'text': 'the password is hunter2',
          'pinned': true,
          'tags': ['home'],
        },
      ]);
      expect(saved['title'], 'Wi-Fi');
      expect(saved['pinned'], isTrue);
      expect(saved['tags'], ['home']);
      expect(jsonEncode(await list(core, 'notes')), isNot(contains('hunter2')));
      final full = await object(core, 'revealNote', [saved['id']]);
      expect(full['text'], 'the password is hunter2');
      expect(full['attachments'], isEmpty);
      await core.call('deleteNote', [saved['id']]);
      expect(await list(core, 'notes'), isEmpty);
      await expectLater(core.call('revealNote', [saved['id']]), failure(CoreFailure.notFound));
    });

    test('keep their files, their key and the keys of a later version through a save, and are stamped changed', () async {
      const file = NoteAttachment(id: 'f1', name: 'scan.pdf', size: 1200, type: 'application/pdf', key: 'a2V5', addedAt: 5);
      await core.vault.applySynced(
        const Lists(
          notes: [
            SecureNote(
              id: 'n1',
              title: 'Passport',
              text: 'old',
              tags: ['id'],
              attachments: [file],
              addedAt: 10,
              updatedAt: 20,
              extra: {'future': 7},
            ),
          ],
        ),
      );
      _time += 60000;
      final saved = await object(core, 'saveNote', [
        'n1',
        {'title': 'Passport (renewed)', 'text': 'new'},
      ]);
      expect(saved['files'], 1);
      expect(saved['tags'], ['id']);
      final held = core.vault.lists.notes.single;
      expect(held.title, 'Passport (renewed)');
      expect(held.attachments, [file]);
      expect(held.extra, {'future': 7});
      expect(held.addedAt, 10);
      expect(held.updatedAt, _time, reason: 'sync takes the newer copy');
      // The file's name leaves the core, never its key
      final full = await object(core, 'revealNote', ['n1']);
      expect(full['attachments'], [
        {'id': 'f1', 'name': 'scan.pdf', 'size': 1200, 'type': 'application/pdf', 'onServer': false},
      ]);
      expect(jsonEncode(full), isNot(contains('a2V5')));
    });

    test('a pin is kept unless the save says so, and false takes it off', () async {
      final saved = await object(core, 'saveNote', [
        null,
        {'title': 'a', 'text': '', 'pinned': true},
      ]);
      await core.call('saveNote', [
        saved['id'],
        {'title': 'b', 'text': ''},
      ]);
      expect(core.vault.lists.notes.single.isPinned, isTrue);
      await core.call('saveNote', [
        saved['id'],
        {'title': 'b', 'text': '', 'pinned': false},
      ]);
      expect(core.vault.lists.notes.single.pinned, isNull);
    });

    test('need a title and a text of at most 10,000 characters', () async {
      await expectLater(
        core.call('saveNote', [
          null,
          {'title': '  ', 'text': 'x'},
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(
        core.call('saveNote', [
          null,
          {'title': 'big', 'text': 'x' * 10001},
        ]),
        failure(CoreFailure.invalid),
      );
      await core.call('saveNote', [
        null,
        {'title': 'big', 'text': 'x' * 10000},
      ]);
    });
  });

  group('cards', () {
    Future<Map<String, Object?>> save(String? id, Map<String, Object?> input) => object(core, 'saveCard', [id, input]);

    test('are saved as digits, listed with the last four and no secret, and revealed whole', () async {
      final saved = await save(null, {
        'name': 'Everyday Visa',
        'cardholder': 'Sam Rivera',
        'number': '4111 1111-1111 1111',
        'brand': 'Visa',
        'expMonth': 5,
        'expYear': 29,
        'code': '123',
        'pin': '9876',
        'note': 'work',
      });
      expect(saved['lastFour'], '1111');
      expect(saved['expYear'], 2029);
      expect(saved['hasNumber'], isTrue);
      expect(saved['hasCode'], isTrue);
      final listed = await list(core, 'cards');
      expect(listed.single.keys, isNot(anyOf(contains('number'), contains('code'), contains('pin'))));
      expect(jsonEncode(listed), isNot(contains('4111111111111111')));
      expect(listed.single['lastFour'], '1111');
      final full = await object(core, 'revealCard', [saved['id']]);
      expect(full['number'], '4111111111111111');
      expect(full['code'], '123');
      expect(full['pin'], '9876');
      expect(core.vault.lists.cards.single.number, '4111111111111111');
    });

    test('is expired once its month is over', () async {
      // 2023-11-14, the fixed clock
      final past = await save(null, {'name': 'old', 'number': '4111111111111111', 'expMonth': 10, 'expYear': 2023});
      final lastMonth = await save(null, {'name': 'now', 'number': '4111111111111111', 'expMonth': 11, 'expYear': 2023});
      expect(past['expired'], isTrue);
      expect(lastMonth['expired'], isFalse);
    });

    test('keep what the browser does not edit through a save, and are stamped changed', () async {
      await core.vault.applySynced(
        const Lists(
          cards: [
            PaymentCard(
              id: 'c1',
              name: 'Visa',
              number: '4111111111111111',
              code: '123',
              tags: ['work'],
              source: 'import',
              pinned: true,
              addedAt: 10,
              updatedAt: 20,
              extra: {'future': 'yes'},
            ),
          ],
        ),
      );
      _time += 60000;
      await save('c1', {'name': 'Visa Gold', 'number': '4111111111111111', 'code': '321'});
      final held = core.vault.lists.cards.single;
      expect(held.name, 'Visa Gold');
      expect(held.code, '321');
      expect(held.tags, ['work']);
      expect(held.source, 'import');
      expect(held.isPinned, isTrue);
      expect(held.extra, {'future': 'yes'});
      expect(held.addedAt, 10);
      expect(held.updatedAt, _time);
    });

    test('a field the save leaves out is cleared', () async {
      final saved = await save(null, {'name': 'Visa', 'number': '4111111111111111', 'code': '123', 'cardholder': 'Sam'});
      await save(saved['id']! as String, {'name': 'Visa', 'cardholder': 'Sam'});
      final held = core.vault.lists.cards.single;
      expect(held.number, isNull);
      expect(held.code, isNull);
    });

    test('are held to the app\'s rules: a name, a number or a cardholder, 8 to 19 digits, real dates', () async {
      for (final bad in <Map<String, Object?>>[
        {'name': '', 'number': '4111111111111111'},
        {'name': 'x'},
        {'name': 'x', 'number': '4111-abcd-1111-1111'},
        {'name': 'x', 'number': '4111111'},
        {'name': 'x', 'number': '4' * 20},
        {'name': 'x', 'number': '4111111111111111', 'expMonth': 13},
        {'name': 'x', 'number': '4111111111111111', 'expYear': 500},
      ]) {
        await expectLater(save(null, bad), failure(CoreFailure.invalid), reason: '$bad');
      }
      expect(core.vault.lists.cards, isEmpty);
      // A holder alone is enough; a short number the Luhn check refuses still saves, as in the app
      await save(null, {'name': 'holder only', 'cardholder': 'Sam'});
      await save(null, {'name': 'odd', 'number': '12345678'});
    });

    test('a card saved from the page says where it came from', () async {
      await save(null, {'name': 'Visa', 'number': '4111111111111111', 'fromAutofill': true});
      expect(core.vault.lists.cards.single.source, 'autofill');
    });

    test('are deleted one at a time', () async {
      final a = await save(null, {'name': 'a', 'number': '4111111111111111'});
      await save(null, {'name': 'b', 'number': '5555555555554444'});
      await core.call('deleteCard', [a['id']]);
      expect((await list(core, 'cards')).map((card) => card['name']), ['b']);
    });
  });

  group('identities', () {
    Future<Map<String, Object?>> save(String? id, Map<String, Object?> input) => object(core, 'saveIdentity', [id, input]);

    test('are saved, listed without a document number, and revealed whole', () async {
      final saved = await save(null, {
        'name': 'Me',
        'givenName': 'Sam',
        'familyName': 'Rivera',
        'email': 'sam@example.com',
        'birthDate': '1990-04-02',
        'address': {
          'lines': ['1 Orbit Way', ' ', 'Floor 2'],
          'city': 'Lyon',
          'postalCode': '69001',
          'country': 'FR',
        },
        'documents': [
          {'type': 'passport', 'number': 'X1234567', 'issuingCountry': 'FR', 'expiresOn': '2023-01-01'},
        ],
      });
      expect(saved['fullName'], 'Sam Rivera');
      expect((saved['address']! as Map)['lines'], ['1 Orbit Way', 'Floor 2']);
      final document = (saved['documents']! as List<Object?>).single! as Map<String, Object?>;
      expect(document['hasNumber'], isTrue);
      expect(document['expired'], isTrue);
      expect(jsonEncode(await list(core, 'identities')), isNot(contains('X1234567')));
      final full = await object(core, 'revealIdentity', [saved['id']]);
      expect(((full['documents']! as List<Object?>).single! as Map)['number'], 'X1234567');
    });

    test('keep their documents when a save names none, and their keys of a later version', () async {
      await core.vault.applySynced(
        const Lists(
          identities: [
            Identity(
              id: 'i1',
              name: 'Me',
              email: 'a@b.test',
              address: IdentityAddress(city: 'Lyon', extra: {'zone': 'B'}),
              documents: [
                IdentityDocument(id: 'd1', type: 'futureType', number: 'N1', extra: {'scan': 'x'}),
              ],
              tags: ['family'],
              addedAt: 10,
              updatedAt: 20,
              extra: {'future': 1},
            ),
          ],
        ),
      );
      _time += 60000;
      await save('i1', {
        'name': 'Me (work)',
        'email': 'sam@work.test',
        'address': {'city': 'Paris'},
      });
      final held = core.vault.lists.identities.single;
      expect(held.name, 'Me (work)');
      expect(held.email, 'sam@work.test');
      expect(held.address!.city, 'Paris');
      expect(held.address!.extra, {'zone': 'B'});
      expect(held.documents!.single.number, 'N1');
      expect(held.documents!.single.type, 'futureType');
      expect(held.documents!.single.extra, {'scan': 'x'});
      expect(held.tags, ['family']);
      expect(held.extra, {'future': 1});
      expect(held.updatedAt, _time);
    });

    test('change, add and remove documents by the list the save gives', () async {
      final saved = await save(null, {
        'name': 'Me',
        'email': 'a@b.test',
        'documents': [
          {'type': 'passport', 'number': 'P1'},
          {'type': 'idCard', 'number': 'I1'},
        ],
      });
      final ids = [for (final document in saved['documents']! as List<Object?>) (document! as Map)['id']! as String];
      await save(saved['id']! as String, {
        'name': 'Me',
        'email': 'a@b.test',
        'documents': [
          {'id': ids[0], 'type': 'passport', 'number': 'P2', 'expiresOn': '2030-02-28'},
          {'type': 'taxNumber', 'number': 'T1'},
        ],
      });
      final documents = core.vault.lists.identities.single.documents!;
      expect([for (final document in documents) document.number], ['P2', 'T1']);
      expect(documents.first.id, ids[0]);
      expect(documents.first.expiresOn, '2030-02-28');
      expect(documents.any((document) => document.id == ids[1]), isFalse);
    });

    test('are held to the app\'s rules: a name, one more detail, three lines, real dates, numbered documents', () async {
      for (final bad in <Map<String, Object?>>[
        {'name': '', 'email': 'a@b.test'},
        {'name': 'Me'},
        {'name': 'Me', 'email': 'a@b.test', 'birthDate': '1990-02-30'},
        {'name': 'Me', 'email': 'a@b.test', 'birthDate': '02/04/1990'},
        {
          'name': 'Me',
          'address': {
            'lines': ['1', '2', '3', '4'],
          },
        },
        {
          'name': 'Me',
          'email': 'a@b.test',
          'documents': [
            {'type': 'passport', 'number': ' '},
          ],
        },
      ]) {
        await expectLater(save(null, bad), failure(CoreFailure.invalid), reason: '$bad');
      }
      expect(core.vault.lists.identities, isEmpty);
    });

    test('are deleted one at a time', () async {
      final a = await save(null, {'name': 'a', 'email': 'a@b.test'});
      await save(null, {'name': 'b', 'email': 'b@b.test'});
      await core.call('deleteIdentity', [a['id']]);
      expect((await list(core, 'identities')).map((identity) => identity['name']), ['b']);
    });
  });

  group('items of a space', () {
    final calls = <String>[];

    setUp(() async {
      calls.clear();
      await core.vault.applySynced(
        const Lists(
          notes: [SecureNote(id: 'n1', title: 'Shared', spaceId: 's1', addedAt: 1)],
          cards: [PaymentCard(id: 'c1', name: 'Shared', number: '4111111111111111', spaceId: 's1', addedAt: 1)],
          identities: [Identity(id: 'i1', name: 'Shared', email: 'a@b.test', spaceId: 's1', addedAt: 1)],
        ),
      );
      // A space this account may read and not change
      core.vault.editGuard = (space, id) {
        calls.add('$space/$id');
        if (space == 's1') throw const CoreFailure(CoreFailure.invalid, 'read only');
      };
      core.vault.spaceNote = (space, id, {login = false}) => space == null ? null : {'id': space, 'canEdit': false};
    });

    test('are not changed or deleted when the guard refuses, and nothing is written', () async {
      await expectLater(
        core.call('saveNote', [
          'n1',
          {'title': 'x', 'text': ''},
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(core.call('deleteNote', ['n1']), failure(CoreFailure.invalid));
      await expectLater(
        core.call('saveCard', [
          'c1',
          {'name': 'x', 'number': '4111111111111111'},
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(core.call('deleteCard', ['c1']), failure(CoreFailure.invalid));
      await expectLater(
        core.call('saveIdentity', [
          'i1',
          {'name': 'x', 'email': 'a@b.test'},
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(core.call('deleteIdentity', ['i1']), failure(CoreFailure.invalid));
      expect(calls, ['s1/n1', 's1/n1', 's1/c1', 's1/c1', 's1/i1', 's1/i1']);
      expect(core.vault.lists.notes.single.title, 'Shared');
      expect(core.vault.lists.cards.single.name, 'Shared');
      expect(core.vault.lists.identities.single.name, 'Shared');
    });

    test('are described by the space they are in, in the lists and the reveals', () async {
      for (final method in ['notes', 'cards', 'identities']) {
        expect((await list(core, method)).single['space'], {'id': 's1', 'canEdit': false}, reason: method);
      }
      expect((await object(core, 'revealCard', ['c1']))['space'], isNotNull);
    });

    test('a new item is never guarded, and one of the vault\'s own is changed', () async {
      final saved = await object(core, 'saveNote', [
        null,
        {'title': 'mine', 'text': ''},
      ]);
      expect(saved.containsKey('space'), isFalse);
      expect(calls, isEmpty);
      await core.call('saveNote', [
        saved['id'],
        {'title': 'mine too', 'text': ''},
      ]);
      expect(calls, ['null/${saved['id']}']);
      expect(core.vault.lists.notes.last.title, 'mine too');
    });
  });

  group('the vault', () {
    test('holds them sealed, and opens them again as the app writes them', () async {
      final note = await object(core, 'saveNote', [
        null,
        {'title': 'Secret title', 'text': 'Secret text'},
      ]);
      await object(core, 'saveCard', [
        null,
        {'name': 'Visa', 'number': '4111111111111111', 'code': '123'},
      ]);
      await object(core, 'saveIdentity', [
        null,
        {'name': 'Me', 'email': 'sam@example.com'},
      ]);
      expect(area.values.values.join(), isNot(anyOf(contains('Secret title'), contains('4111111111111111'), contains('sam@example.com'))));
      final again = await open(MemoryArea(area.values));
      await again.call('unlock', [password]);
      expect((await list(again, 'notes')).single['id'], note['id']);
      expect((await list(again, 'cards')).single['lastFour'], '1111');
      expect((await list(again, 'identities')).single['email'], 'sam@example.com');
      expect((await object(again, 'revealCard', [(await list(again, 'cards')).single['id']]))['code'], '123');
    });

    test('are refused while it is shut, and a change counts for the sync that raced it', () async {
      final before = core.vault.revision;
      await core.call('saveNote', [
        null,
        {'title': 'a', 'text': ''},
      ]);
      expect(core.vault.revision, before + 1);
      await core.call('lock');
      for (final method in ['notes', 'cards', 'identities']) {
        await expectLater(core.call(method), failure(CoreFailure.locked), reason: method);
      }
      await expectLater(core.call('revealCard', ['x']), failure(CoreFailure.locked));
    });
  });
}
