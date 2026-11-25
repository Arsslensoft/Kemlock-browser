// Keys and contacts as the TypeScript side calls them, over a fake browser: generating and importing, the halves a key hands
// out, what the app's formats keep, and other people's public keys as contacts.
import 'dart:convert';

import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/models/vault_key.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

Future<CoreService> newVault([MemoryArea? area]) async {
  final core = await startCore(area ?? MemoryArea());
  await core.call('createVault', [password]);
  return core;
}

Future<Map<String, Object?>> generatePgp(CoreService core, {String name = 'Ada Lovelace', String email = 'ada@example.org'}) =>
    object(core, 'generateKey', [
      {'kind': 'pgp', 'type': 'ed25519', 'name': name, 'email': email, 'expiresInYears': 2},
    ]);

void main() {
  group('keys', () {
    late MemoryArea area;
    late CoreService core;

    setUp(() async {
      area = MemoryArea();
      core = await newVault(area);
    });

    test('an SSH key is generated, listed with its fingerprint and handed out in the forms OpenSSH reads', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'laptop'},
      ]);
      expect(made, containsPair('kind', 'ssh'));
      expect(made['algorithm'], 'Ed25519');
      expect(made['origin'], 'generated');
      expect(made['fingerprint'], startsWith('SHA256:'));
      expect(made['hasSshForm'], isTrue);
      final public = await object(core, 'keyPublic', [made['id']]);
      expect(public['ssh'], startsWith('ssh-ed25519 '));
      expect(public['ssh'], endsWith(' laptop'));
      expect(public['sshFile'], 'laptop.pub');
      final exported = await object(core, 'exportKey', [
        {'id': made['id'], 'purpose': 'show'},
      ]);
      expect(exported['text'], contains('BEGIN OPENSSH PRIVATE KEY'));
      expect(exported['fileName'], 'laptop');
      // The list names no secret
      expect(jsonEncode(await core.call('keys')), isNot(contains('PRIVATE KEY')));
      expect((await list(core, 'keys')).single['id'], made['id']);
    });

    test('a key is kept in the app\'s storage and found again after a restart, with its change time', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'signing', 'algorithm': 'ecdsa-p256', 'name': 'releases'},
      ]);
      expect(made['kind'], 'signing');
      expect(made['algorithm'], 'ECDSA P-256');
      final again = await startCore(MemoryArea(area.values));
      await again.call('unlock', [password]);
      expect((await list(again, 'keys')).single['name'], 'releases');
      expect(again.vault.lists.keys.single.updatedAt, 1700000000000);
      expect(again.vault.lists.keys.single.addedAt, 1700000000000);
    });

    test('only the algorithms a kind offers are made', () async {
      await expectLater(
        core.call('generateKey', [
          {'kind': 'exchange', 'algorithm': 'ed25519', 'name': 'x'},
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(
        core.call('generateKey', [
          {'kind': 'ssh', 'algorithm': 'ed25519', 'name': ' '},
        ]),
        failure(CoreFailure.invalid),
      );
      final exchange = await object(core, 'generateKey', [
        {'kind': 'exchange', 'algorithm': 'x25519', 'name': 'handshake'},
      ]);
      expect(exchange['kind'], 'exchange');
      expect((await object(core, 'keyPublic', [exchange['id']]))['pem'], startsWith('-----BEGIN PUBLIC KEY-----'));
    });

    test('a private key leaves protected by a passphrase, which opens it again, and never an empty one', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'laptop'},
      ]);
      final protected = await object(core, 'exportKey', [
        {'id': made['id'], 'passphrase': 'hunter2 hunter2', 'purpose': 'file'},
      ]);
      await expectLater(
        core.call('exportKey', [
          {'id': made['id'], 'passphrase': '', 'purpose': 'file'},
        ]),
        failure(CoreFailure.invalid),
      );
      // A passphrase is for a file, and a purpose is always asked
      await expectLater(
        core.call('exportKey', [
          {'id': made['id'], 'passphrase': 'x y z', 'purpose': 'show'},
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(
        core.call('exportKey', [
          {'id': made['id']},
        ]),
        failure(CoreFailure.invalid),
      );

      final other = await newVault();
      await expectLater(
        other.call('previewKey', [
          {'text': protected['text']},
        ]),
        failure('keyPassphraseNeeded'),
      );
      await expectLater(
        other.call('previewKey', [
          {'text': protected['text'], 'passphrase': 'wrong wrong'},
        ]),
        failure('keyWrongPassphrase'),
      );
      final preview = await object(other, 'previewKey', [
        {'text': protected['text'], 'passphrase': 'hunter2 hunter2'},
      ]);
      expect(preview['kind'], 'ssh');
      expect(preview['fingerprint'], made['fingerprint']);
      expect(preview['held'], isNull);
      expect(jsonEncode(await other.call('keys')), '[]');
      final imported = await object(other, 'importKey', [
        {'text': protected['text'], 'passphrase': 'hunter2 hunter2', 'name': 'copy'},
      ]);
      expect(imported['origin'], 'imported');
      expect(imported['fingerprint'], made['fingerprint']);
      // The same key is not added twice
      await expectLater(
        other.call('importKey', [
          {'text': protected['text'], 'passphrase': 'hunter2 hunter2', 'name': 'again'},
        ]),
        failure(CoreFailure.duplicate),
      );
    });

    test('a file is read from base64 as a pasted text is, and a public key alone is refused', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'signing', 'algorithm': 'ed25519', 'name': 'sig'},
      ]);
      final pem =
          (await object(core, 'exportKey', [
                {'id': made['id'], 'purpose': 'show'},
              ]))['text']!
              as String;
      final other = await newVault();
      final imported = await object(other, 'importKey', [
        {'base64': b64(utf8.encode(pem)), 'name': 'from a file'},
      ]);
      expect(imported['kind'], 'signing');
      final public = (await object(core, 'keyPublic', [made['id']]))['pem'];
      await expectLater(
        other.call('previewKey', [
          {'text': public},
        ]),
        failure('keyPublicKeyOnly'),
      );
      await expectLater(
        other.call('previewKey', [
          {'text': 'not a key'},
        ]),
        failure('keyUnrecognized'),
      );
    });

    test('a key that has an SSH form can be kept as an SSH key, and one that has none cannot', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'signing', 'algorithm': 'ed25519', 'name': 'sig'},
      ]);
      final text = (await object(core, 'exportKey', [
        {'id': made['id'], 'purpose': 'show'},
      ]))['text'];
      final other = await newVault();
      final preview = await object(other, 'previewKey', [
        {'text': text},
      ]);
      expect(preview['canBeSsh'], isTrue);
      final kept = await object(other, 'importKey', [
        {'text': text, 'name': 'as ssh', 'asSsh': true},
      ]);
      expect(kept['kind'], 'ssh');
      final pq = await object(core, 'generateKey', [
        {'kind': 'signing', 'algorithm': 'ml-dsa-65', 'name': 'pq'},
      ]);
      final pqText = (await object(core, 'exportKey', [
        {'id': pq['id'], 'purpose': 'show'},
      ]))['text'];
      await expectLater(
        other.call('importKey', [
          {'text': pqText, 'name': 'pq', 'asSsh': true},
        ]),
        failure(CoreFailure.invalid),
      );
    });

    test('a save keeps what another save made meanwhile, and a vault that locked meanwhile stays shut', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'laptop'},
      ]);
      // Two saves in flight: the lists the second one leaves are those that hold the first one's work too
      await Future.wait([
        core.call('deleteKey', [made['id']]),
        core.call('saveLogin', [
          null,
          {'name': 'Orbit', 'username': 'sam', 'password': 'p4ss', 'websites': <String>[]},
        ]),
      ]);
      expect(core.vault.lists.keys, isEmpty);
      expect(core.vault.lists.logins, hasLength(1));

      final other = await object(core, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'second'},
      ]);
      final deleting = core.call('deleteKey', [other['id']]);
      await core.call('lock');
      await deleting;
      // The decrypted lists did not come back into memory after the lock
      expect(core.vault.lists.keys, isEmpty);
      expect(core.vault.lists.logins, isEmpty);
      await expectLater(core.call('keys'), failure(CoreFailure.locked));
    });

    test('a name, note and tags are changed, and the key is deleted', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'laptop'},
      ]);
      final saved = await object(core, 'saveKey', [
        {
          'id': made['id'],
          'name': 'work laptop',
          'note': 'for the office',
          'tags': ['work'],
        },
      ]);
      expect(saved['name'], 'work laptop');
      expect(saved['note'], 'for the office');
      expect(saved['tags'], ['work']);
      // An empty name keeps the name, an empty note takes the note away
      final cleared = await object(core, 'saveKey', [
        {'id': made['id'], 'name': '', 'note': '', 'tags': <String>[]},
      ]);
      expect(cleared['name'], 'work laptop');
      expect(cleared.containsKey('note'), isFalse);
      expect(cleared['tags'], <String>[]);
      await core.call('deleteKey', [made['id']]);
      expect(await list(core, 'keys'), isEmpty);
      await expectLater(core.call('deleteKey', [made['id']]), failure(CoreFailure.notFound));
    });

    test('a key of a space is not saved to a file, and a locked vault shows no key', () async {
      final made = await object(core, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'laptop'},
      ]);
      // As a sync would have merged it: the key belongs to a space
      await core.vault.saveKeys([core.vault.lists.keys.single.copyWith(spaceId: 'space-1')]);
      await expectLater(
        core.call('exportKey', [
          {'id': made['id'], 'purpose': 'file'},
        ]),
        failure('keyInSpace'),
      );
      // Showing it is not a file
      // Showing and copying are not files, as the app has them
      for (final purpose in ['show', 'copy']) {
        expect(
          (await object(core, 'exportKey', [
            {'id': made['id'], 'purpose': purpose},
          ]))['text'],
          contains('PRIVATE KEY'),
        );
      }
      // A key of a space is never written out whatever else the page asks for
      await expectLater(
        core.call('exportKey', [
          {'id': made['id'], 'purpose': 'file', 'passphrase': 'blue heron lantern'},
        ]),
        failure('keyInSpace'),
      );
      await core.call('lock');
      await expectLater(core.call('keys'), failure(CoreFailure.locked));
    });
  });

  group('PGP keys', () {
    late CoreService core;

    setUp(() async {
      core = await newVault();
    });

    test('are generated for a name and an email, and list their user ID, expiry and subkeys', () async {
      final made = await generatePgp(core);
      expect(made['kind'], KeyKind.pgp);
      expect(made['name'], 'Ada Lovelace <ada@example.org>');
      expect(made['fingerprint'], matches(RegExp(r'^([0-9A-F]{4} )+[0-9A-F]{4}$')));
      expect(made['line'], 'ada@example.org · Ed25519');
      expect(made['standing'], 'ok');
      expect(made['expires'], isA<int>());
      final pgp = made['pgp']! as Map<String, Object?>;
      expect(pgp['userIds'], ['Ada Lovelace <ada@example.org>']);
      expect(pgp['address'], 'ada@example.org');
      expect((pgp['subkeys']! as List<Object?>).single, containsPair('uses', ['encrypt']));
      final public = await object(core, 'keyPublic', [made['id']]);
      expect(public['pem'], startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----'));
      expect(public['pemFile'], 'Ada-Lovelace-ada-example.org.pub.asc');
      final exported = await object(core, 'exportKey', [
        {'id': made['id'], 'purpose': 'show'},
      ]);
      expect(exported['text'], startsWith('-----BEGIN PGP PRIVATE KEY BLOCK-----'));
      expect(exported['fileName'], endsWith('.asc'));
    });

    test('one the vault holds is not added twice, and a key needs a name and an email', () async {
      final made = await generatePgp(core);
      final text = (await object(core, 'exportKey', [
        {'id': made['id'], 'purpose': 'show'},
      ]))['text'];
      final preview = await object(core, 'previewKey', [
        {'text': text},
      ]);
      expect(preview['held'], containsPair('id', made['id']));
      await expectLater(
        core.call('importKey', [
          {'text': text, 'name': 'again'},
        ]),
        failure(CoreFailure.duplicate),
      );
      await expectLater(
        core.call('generateKey', [
          {'kind': 'pgp', 'name': 'Ada', 'email': ' '},
        ]),
        failure(CoreFailure.invalid),
      );
    });
  });

  group('contacts', () {
    late CoreService mine;
    late CoreService theirs;
    late String armored;
    late String fingerprint;

    setUp(() async {
      mine = await newVault();
      theirs = await newVault();
      final key = await generatePgp(theirs);
      armored = (await object(theirs, 'keyPublic', [key['id']]))['pem']! as String;
      fingerprint = (key['fingerprint']! as String).replaceAll(' ', '');
    });

    test('are previewed with their fingerprint, added, and marked as compared', () async {
      final preview = (await list(mine, 'previewContacts', [
        {'text': armored},
      ])).single;
      expect(preview['status'], 'new');
      expect(preview['fingerprintHex'], fingerprint);
      expect(preview['name'], 'Ada Lovelace');
      expect(await list(mine, 'contacts'), isEmpty);

      final added = (await list(mine, 'addContacts', [
        {'text': armored, 'source': 'paste'},
      ])).single;
      expect(added['name'], 'Ada Lovelace');
      expect(added['fingerprint'], contains(' '));
      expect(added['checked'], isFalse);
      expect(added['canEncrypt'], isTrue);
      expect(added['standing'], 'ok');
      expect(added['uncheckedAddresses'], ['ada@example.org']);
      expect(mine.vault.lists.contacts.single.source, 'paste');
      expect(mine.vault.lists.contacts.single.updatedAt, 1700000000000);

      final checked = await object(mine, 'saveContact', [
        {'id': added['id'], 'checked': true, 'name': 'Ada', 'note': 'met at the conference'},
      ]);
      expect(checked['checked'], isTrue);
      expect(checked['name'], 'Ada');
      expect(checked['note'], 'met at the conference');
      expect(checked['uncheckedAddresses'], <String>[]);
      expect(
        (await object(mine, 'saveContact', [
          {'id': added['id'], 'checked': false},
        ]))['checked'],
        isFalse,
      );

      // A key already held is not added again
      final again = (await list(mine, 'previewContacts', [
        {'text': armored},
      ])).single;
      expect(again['status'], 'held');
      expect(
        await list(mine, 'addContacts', [
          {'text': armored},
        ]),
        isEmpty,
      );
      expect(await list(mine, 'contacts'), hasLength(1));
    });

    test('are added already compared when the person says so, and from a file', () async {
      final added = (await list(mine, 'addContacts', [
        {
          'base64': b64(utf8.encode(armored)),
          'source': 'file',
          'checked': [fingerprint],
        },
      ])).single;
      expect(added['checked'], isTrue);
      expect(added['source'], 'file');
      final public = await object(mine, 'contactPublic', [added['id']]);
      expect(public['pem'], startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----'));
      expect(public['fileName'], 'Ada-Lovelace.pub.asc');
    });

    test('are read as public keys only, and each is checked', () async {
      await expectLater(
        mine.call('previewContacts', [
          {'text': 'hello'},
        ]),
        failure('contactUnrecognized'),
      );
      final privateKey = (await object(theirs, 'exportKey', [
        {'id': theirs.vault.lists.keys.single.id, 'purpose': 'show'},
      ]))['text'];
      await expectLater(
        mine.call('previewContacts', [
          {'text': privateKey},
        ]),
        failure('contactPrivateKeyGiven'),
      );
    });

    test('the vault\'s own key is not a contact, and a contact is deleted', () async {
      final own = await generatePgp(mine, name: 'Me', email: 'me@example.org');
      final ownPublic = (await object(mine, 'keyPublic', [own['id']]))['pem'];
      expect(
        (await list(mine, 'previewContacts', [
          {'text': ownPublic},
        ])).single['status'],
        'own',
      );
      expect(
        await list(mine, 'addContacts', [
          {'text': ownPublic},
        ]),
        isEmpty,
      );
      final added = (await list(mine, 'addContacts', [
        {'text': armored},
      ])).single;
      await mine.call('deleteContact', [added['id']]);
      expect(await list(mine, 'contacts'), isEmpty);
      await expectLater(mine.call('deleteContact', [added['id']]), failure(CoreFailure.notFound));
    });

    test('a new key for an address a contact has can replace that contact\'s', () async {
      final first = (await list(mine, 'addContacts', [
        {
          'text': armored,
          'checked': [fingerprint],
        },
      ])).single;
      final other = await newVault();
      final key = await generatePgp(other);
      final second = (await object(other, 'keyPublic', [key['id']]))['pem']! as String;
      final preview = (await list(mine, 'previewContacts', [
        {'text': second},
      ])).single;
      expect(preview['status'], 'new');
      expect(preview['sameAddressId'], first['id']);
      expect(preview['sameAddress'], 'ada@example.org');
      final replaced = (await list(mine, 'addContacts', [
        {'text': second, 'replacing': first['id']},
      ])).single;
      expect(replaced['id'], first['id']);
      expect(replaced['fingerprint'], key['fingerprint']);
      // A new key is not the one that was compared
      expect(replaced['checked'], isFalse);
      expect(await list(mine, 'contacts'), hasLength(1));
    });
  });
}
