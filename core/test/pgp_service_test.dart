// The PGP tools and SSH signatures as the TypeScript side calls them: what one vault encrypts or signs, another opens or checks
// through contacts, and the words each failure is told in.
import 'dart:convert';

import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

Future<CoreService> newVault() async {
  final core = await startCore(MemoryArea());
  await core.call('createVault', [password]);
  return core;
}

Future<Map<String, Object?>> pgpKey(CoreService core, String name, String email) => object(core, 'generateKey', [
  {'kind': 'pgp', 'type': 'ed25519', 'name': name, 'email': email},
]);

Future<void> addContact(CoreService core, CoreService owner, Map<String, Object?> key, {bool checked = false}) async {
  final armored = (await object(owner, 'keyPublic', [key['id']]))['pem'];
  await core.call('addContacts', [
    {
      'text': armored,
      'checked': checked ? [(key['fingerprint']! as String).replaceAll(' ', '')] : <String>[],
    },
  ]);
}

void main() {
  late CoreService ada;
  late CoreService sam;
  late Map<String, Object?> adaKey;
  late Map<String, Object?> samKey;

  setUp(() async {
    ada = await newVault();
    sam = await newVault();
    adaKey = await pgpKey(ada, 'Ada Lovelace', 'ada@example.org');
    samKey = await pgpKey(sam, 'Sam Orbit', 'sam@example.org');
    // Each knows the other's public key, and Ada compared Sam's fingerprint
    await addContact(ada, sam, samKey, checked: true);
    await addContact(sam, ada, adaKey);
  });

  Future<String> contactId(CoreService core) async =>
      (((await core.call('contacts'))! as List<Object?>).single! as Map<String, Object?>)['id']! as String;

  group('encrypting', () {
    test('a text to a contact is opened by the contact\'s key and by no other', () async {
      final sent = await object(sam, 'pgpEncrypt', [
        {
          'text': 'meet at noon',
          'contactIds': [await contactId(sam)],
        },
      ]);
      expect(sent['text'], startsWith('-----BEGIN PGP MESSAGE-----'));
      final opened = await object(ada, 'pgpDecrypt', [
        {'text': sent['text']},
      ]);
      expect(opened['text'], 'meet at noon');
      expect(opened['encrypted'], isTrue);
      expect(opened['isText'], isTrue);
      expect(opened['openedWith'], containsPair('name', adaKey['name']));
      expect(opened['signatures'], isEmpty);
      // Sam did not encrypt it to himself
      await expectLater(
        sam.call('pgpDecrypt', [
          {'text': sent['text']},
        ]),
        failure('pgpNoKeyOpensIt'),
      );
    });

    test('also to the sender\'s own key, and signed, with the signature checked on the other side', () async {
      final sent = await object(sam, 'pgpEncrypt', [
        {
          'text': 'signed and sealed',
          'contactIds': [await contactId(sam)],
          'keyIds': [samKey['id']],
          'signWith': samKey['id'],
        },
      ]);
      for (final (core, signer) in [(ada, 'Sam Orbit'), (sam, 'Sam Orbit <sam@example.org>')]) {
        final opened = await object(core, 'pgpDecrypt', [
          {'text': sent['text']},
        ]);
        expect(opened['text'], 'signed and sealed');
        final signature = (opened['signatures']! as List<Object?>).single! as Map<String, Object?>;
        expect(signature['verdict'], 'good');
        expect((signature['signer']! as Map<String, Object?>)['name'], signer);
      }
    });

    test('with a passphrase, which opens it and nothing else does', () async {
      final sent = await object(sam, 'pgpEncrypt', [
        {'text': 'for whoever knows', 'passphrase': 'blue heron lantern'},
      ]);
      expect(
        (await object(ada, 'pgpDecrypt', [
          {'text': sent['text'], 'passphrase': 'blue heron lantern'},
        ]))['text'],
        'for whoever knows',
      );
      await expectLater(
        ada.call('pgpDecrypt', [
          {'text': sent['text']},
        ]),
        failure('pgpPassphraseNeeded'),
      );
      await expectLater(
        ada.call('pgpDecrypt', [
          {'text': sent['text'], 'passphrase': 'red heron lantern'},
        ]),
        failure('pgpWrongPassphrase'),
      );
    });

    test('a file goes in and out as base64, with its name', () async {
      final data = List<int>.generate(3000, (i) => i % 251);
      final sent = await object(sam, 'pgpEncrypt', [
        {
          'base64': b64(data),
          'fileName': 'report.bin',
          'contactIds': [await contactId(sam)],
        },
      ]);
      expect(sent, contains('base64'));
      final opened = await object(ada, 'pgpDecrypt', [
        {'base64': sent['base64']},
      ]);
      expect(opened['isText'], isFalse);
      expect(opened['fileName'], 'report.bin');
      expect(unb64(opened['base64']! as String), data);
    });

    test('needs somebody or a passphrase, and a key that can be used', () async {
      await expectLater(
        sam.call('pgpEncrypt', [
          {'text': 'x'},
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(
        sam.call('pgpEncrypt', [
          {
            'text': 'x',
            'contactIds': ['missing'],
          },
        ]),
        failure(CoreFailure.notFound),
      );
      await expectLater(
        sam.call('pgpEncrypt', [
          {'text': 'x', 'passphrase': 'p', 'signWith': 'missing'},
        ]),
        failure(CoreFailure.notFound),
      );
    });
  });

  group('signing', () {
    test('a text is clear-signed, and the other side sees who signed it, and whether the fingerprint was compared', () async {
      final signed = await object(sam, 'pgpSign', [
        {'text': 'I agree.', 'keyId': samKey['id']},
      ]);
      expect(signed['text'], startsWith('-----BEGIN PGP SIGNED MESSAGE-----'));
      final checked = await object(ada, 'pgpVerify', [
        {'text': signed['text']},
      ]);
      expect(checked['isText'], isTrue);
      expect(checked['text'], 'I agree.');
      final signature = (checked['signatures']! as List<Object?>).single! as Map<String, Object?>;
      expect(signature['verdict'], 'good');
      expect(signature['signer'], containsPair('kind', 'contact'));
      expect(signature['signer'], containsPair('checked', true));
      // Ada never compared Sam's key with Sam, but Sam's own key is the vault's
      final own =
          (((await object(sam, 'pgpVerify', [
                        {'text': signed['text']},
                      ]))['signatures']!
                      as List<Object?>)
                  .single!
              as Map<String, Object?>)['signer'];
      expect(own, containsPair('kind', 'key'));
    });

    test('an altered text, and one from a stranger, are not good', () async {
      final signed = await object(sam, 'pgpSign', [
        {'text': 'I agree.', 'keyId': samKey['id']},
      ]);
      final altered = (signed['text']! as String).replaceFirst('I agree.', 'I object.');
      final bad = await object(ada, 'pgpVerify', [
        {'text': altered},
      ]);
      expect(((bad['signatures']! as List<Object?>).single! as Map<String, Object?>)['verdict'], 'bad');
      final stranger = await newVault();
      final unknown = await object(stranger, 'pgpVerify', [
        {'text': signed['text']},
      ]);
      expect(((unknown['signatures']! as List<Object?>).single! as Map<String, Object?>)['verdict'], 'unknownSigner');
    });

    test('a file has a detached signature, armored or binary, checked against the file', () async {
      final data = utf8.encode('the release');
      final armored = await object(sam, 'pgpSign', [
        {'base64': b64(data), 'keyId': samKey['id'], 'form': 'detachedArmored'},
      ]);
      expect(armored['text'], startsWith('-----BEGIN PGP SIGNATURE-----'));
      final good = await object(ada, 'pgpVerify', [
        {'base64': b64(data), 'signature': armored['text']},
      ]);
      expect(((good['signatures']! as List<Object?>).single! as Map<String, Object?>)['verdict'], 'good');
      expect(good.containsKey('text'), isFalse);
      final binary = await object(sam, 'pgpSign', [
        {'base64': b64(data), 'keyId': samKey['id'], 'form': 'detached'},
      ]);
      final binaryGood = await object(ada, 'pgpVerify', [
        {'base64': b64(data), 'signatureBase64': binary['base64']},
      ]);
      expect(((binaryGood['signatures']! as List<Object?>).single! as Map<String, Object?>)['verdict'], 'good');
      final bad = await object(ada, 'pgpVerify', [
        {'base64': b64(utf8.encode('another release')), 'signature': armored['text']},
      ]);
      expect(((bad['signatures']! as List<Object?>).single! as Map<String, Object?>)['verdict'], 'bad');
    });

    test('says what an input is when it is not what the tool takes', () async {
      final sent = await object(sam, 'pgpEncrypt', [
        {
          'text': 'x',
          'contactIds': [await contactId(sam)],
        },
      ]);
      await expectLater(
        ada.call('pgpVerify', [
          {'text': sent['text']},
        ]),
        failure('pgpIsEncrypted'),
      );
      await expectLater(
        ada.call('pgpDecrypt', [
          {'text': 'just words'},
        ]),
        failure('pgpNotAMessage'),
      );
      await expectLater(
        sam.call('pgpSign', [
          {
            'base64': b64([1, 2, 3]),
            'keyId': samKey['id'],
          },
        ]),
        failure(CoreFailure.invalid),
      );
      await expectLater(
        ada.call('pgpVerify', [
          {'text': 'just words'},
        ]),
        failure('pgpNotAMessage'),
      );
    });

    test('a locked vault does none of it', () async {
      await sam.call('lock');
      await expectLater(
        sam.call('pgpSign', [
          {'text': 'x', 'keyId': samKey['id']},
        ]),
        failure(CoreFailure.locked),
      );
    });
  });

  group('SSH signatures', () {
    late Map<String, Object?> ssh;

    setUp(() async {
      ssh = await object(ada, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'laptop'},
      ]);
    });

    test('a text is signed for a namespace and checked for it', () async {
      final signed = await object(ada, 'sshSign', [
        {'keyId': ssh['id'], 'namespace': 'file', 'text': 'release notes'},
      ]);
      expect(signed['text'], contains('BEGIN SSH SIGNATURE'));
      final good = await object(ada, 'sshVerify', [
        {'signature': signed['text'], 'namespace': 'file', 'text': 'release notes'},
      ]);
      expect(good['verdict'], 'good');
      expect(good['fingerprint'], ssh['fingerprint']);
      expect(good['own'], containsPair('name', 'laptop'));
      expect(good['matches'], isNull);
      // On another vault the signer is unknown, and a pasted public key says whether it is the one
      final other = await newVault();
      final line = (await object(ada, 'keyPublic', [ssh['id']]))['ssh'];
      final unknown = await object(other, 'sshVerify', [
        {'signature': signed['text'], 'namespace': 'file', 'text': 'release notes', 'signer': line},
      ]);
      expect(unknown['verdict'], 'good');
      expect(unknown['own'], isNull);
      expect(unknown['matches'], isTrue);
      final stranger = (await object(other, 'generateKey', [
        {'kind': 'ssh', 'algorithm': 'ed25519', 'name': 'x'},
      ]));
      final other2 = (await object(other, 'keyPublic', [stranger['id']]))['ssh'];
      final mismatch = await object(other, 'sshVerify', [
        {'signature': signed['text'], 'namespace': 'file', 'text': 'release notes', 'signer': other2},
      ]);
      expect(mismatch['matches'], isFalse);
    });

    test('another namespace, an altered text and a bad block are told apart', () async {
      final signed = await object(ada, 'sshSign', [
        {'keyId': ssh['id'], 'namespace': 'file', 'text': 'release notes'},
      ]);
      expect(
        (await object(ada, 'sshVerify', [
          {'signature': signed['text'], 'namespace': 'git', 'text': 'release notes'},
        ]))['verdict'],
        'wrongNamespace',
      );
      expect(
        (await object(ada, 'sshVerify', [
          {'signature': signed['text'], 'namespace': 'file', 'text': 'release notes!'},
        ]))['verdict'],
        'bad',
      );
      await expectLater(
        ada.call('sshVerify', [
          {'signature': 'nothing', 'namespace': 'file', 'text': 'x'},
        ]),
        failure('sshNotSsh'),
      );
      await expectLater(
        ada.call('sshVerify', [
          {'signature': signed['text'], 'namespace': 'file', 'text': 'x', 'signer': 'not a key'},
        ]),
        failure('sshBadSigner'),
      );
      await expectLater(
        ada.call('sshSign', [
          {'keyId': ssh['id'], 'namespace': 'has space', 'text': 'x'},
        ]),
        failure(CoreFailure.invalid),
      );
      // Only an SSH key signs this way
      await expectLater(
        ada.call('sshSign', [
          {'keyId': adaKey['id'], 'namespace': 'file', 'text': 'x'},
        ]),
        failure(CoreFailure.invalid),
      );
    });

    test('a git commit is checked for the SSH signature inside it', () async {
      const body =
          'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n'
          'author Ada <ada@example.org> 1700000000 +0000\n'
          'committer Ada <ada@example.org> 1700000000 +0000\n';
      const message = '\nInitial commit\n';
      final signed = await object(ada, 'sshSign', [
        {'keyId': ssh['id'], 'namespace': 'git', 'text': '$body$message'},
      ]);
      final lines = (signed['text']! as String).trimRight().split('\n');
      final commit = '${body}gpgsig ${lines.join('\n ')}\n$message';
      final good = await object(ada, 'sshVerify', [
        {'git': true, 'text': commit},
      ]);
      expect(good['verdict'], 'good');
      expect(good['namespace'], 'git');
      expect(good['own'], containsPair('name', 'laptop'));
      final altered = commit.replaceFirst('Initial commit', 'Another commit');
      expect(
        (await object(ada, 'sshVerify', [
          {'git': true, 'text': altered},
        ]))['verdict'],
        'bad',
      );
      await expectLater(
        ada.call('sshVerify', [
          {'git': true, 'text': '$body$message'},
        ]),
        failure('sshGitUnsigned'),
      );
      await expectLater(
        ada.call('sshVerify', [
          {'git': true, 'text': 'hello'},
        ]),
        failure('sshNotGit'),
      );
    });
  });
}
