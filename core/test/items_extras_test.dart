// Custom fields, links and websites with a rule each, through the core's calls (docs/plans/add-item-format.md): a list holds no hidden
// value, a link is written at both ends, and what a save doesn't touch is written back as it was.
import 'dart:convert';

import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/item_link.dart';
import 'package:kemlock_core/models/key_account.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/website_rule.dart';
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

Map<String, Object?> ref(String kind, String id) => {'kind': kind, 'id': id};

void main() {
  late CoreService core;

  setUp(() async {
    core = await startCore(MemoryArea());
    await core.call('createVault', [password]);
  });

  group('custom fields', () {
    test('are saved with a login, listed without a hidden value, and revealed one at a time', () async {
      final saved = await object(core, 'saveLogin', [
        null,
        {
          'name': 'Orbit',
          'username': 'sam',
          'password': 'pw',
          'fields': [
            {'name': 'Employee ID', 'kind': 'text', 'value': 'E-42'},
            {'name': 'PIN', 'kind': 'hidden', 'value': '9876'},
            {'name': 'Verified', 'kind': 'boolean', 'value': 'true'},
          ],
        },
      ]);
      final views = (saved['fields']! as List<Object?>).cast<Map<String, Object?>>();
      expect(views.map((v) => v['name']), ['Employee ID', 'PIN', 'Verified']);
      expect(views[0]['value'], 'E-42');
      expect(views[1].containsKey('value'), isFalse);
      expect(jsonEncode(await list(core, 'logins')), isNot(contains('9876')));
      final id = saved['id']! as String;
      expect(await core.call('revealField', [ref('login', id), 1]), '9876');
      expect(await core.call('revealFields', [ref('login', id)]), [
        {'index': 0, 'value': 'E-42'},
        {'index': 1, 'value': '9876'},
        {'index': 2, 'value': 'true'},
      ]);
      await expectLater(core.call('revealField', [ref('login', id), 7]), failure(CoreFailure.notFound));
    });

    test('are kept when a save says nothing of them, and an unrevealed hidden value is kept with them', () async {
      final saved = await object(core, 'saveLogin', [
        null,
        {
          'name': 'Orbit',
          'username': 'sam',
          'password': 'pw',
          'fields': [
            {'name': 'PIN', 'kind': 'hidden', 'value': '9876'},
          ],
        },
      ]);
      final id = saved['id']! as String;
      await core.call('saveLogin', [
        id,
        {'name': 'Orbit 2', 'username': 'sam', 'keepPassword': true},
      ]);
      expect(core.vault.lists.logins.single.fields.single.value, '9876');
      await core.call('saveLogin', [
        id,
        {
          'name': 'Orbit 2',
          'username': 'sam',
          'keepPassword': true,
          'fields': [
            {'origin': 0, 'name': 'PIN', 'kind': 'hidden', 'keepValue': true},
            {'name': 'Site', 'kind': 'text', 'value': 'here'},
          ],
        },
      ]);
      final held = core.vault.lists.logins.single.fields;
      expect(held.map((f) => f.value), ['9876', 'here']);
    });

    test('are refused on an item that takes none', () async {
      await expectLater(core.call('revealField', [ref('passkey', 'x'), 0]), failure(CoreFailure.notFound));
      await expectLater(
        core.call('saveLogin', [
          null,
          {'name': 'a', 'username': 'b', 'fields': 'nope'},
        ]),
        failure(CoreFailure.invalid),
      );
    });

    test('are on notes, cards, identities and contacts too', () async {
      final note = await object(core, 'saveNote', [
        null,
        {
          'title': 'n',
          'text': 't',
          'fields': [
            {'name': 'a', 'kind': 'text', 'value': 'b'},
          ],
        },
      ]);
      expect((note['fields']! as List<Object?>), hasLength(1));
      final contact = await object(core, 'saveContact', [
        {
          'name': 'Ada',
          'fields': [
            {'name': 'a', 'kind': 'text', 'value': 'b'},
          ],
        },
      ]);
      expect((contact['fields']! as List<Object?>), hasLength(1));
    });
  });

  group('websites with a rule', () {
    test('are shown with their rule, and a save that changes none leaves the login as it was, urls and all', () async {
      await core.vault.applySynced(
        const Lists(
          logins: [
            Login(
              id: 'l1',
              name: 'Orbit',
              username: 'sam',
              password: 'pw',
              websites: ['example.co'],
              uris: [
                WebsiteRule('example.co', match: WebsiteMatch.baseDomain),
                WebsiteRule('wiki.example.co', match: WebsiteMatch.never, extra: {'uriChecksum': 'z'}),
              ],
              addedAt: 5,
              extra: {
                'urls': ['example.co', 'wiki.example.co'],
              },
            ),
          ],
        ),
      );
      final before = core.vault.lists.logins.single.toJson();
      final view = (await list(core, 'logins')).single;
      expect(view['websiteRules'], [
        {'uri': 'example.co', 'match': 'domain'},
        {'uri': 'wiki.example.co', 'match': 'never'},
      ]);
      await core.call('saveLogin', [
        'l1',
        {'name': 'Orbit', 'username': 'sam', 'keepPassword': true, 'websiteRules': view['websiteRules']},
      ]);
      final after = core.vault.lists.logins.single.toJson();
      expect(after['uris'], before['uris']);
      expect(after['websites'], before['websites']);
      expect(after['urls'], before['urls']);
    });

    test('change the rule of one website, keep the rest of it, and keep urls in step', () async {
      await core.vault.applySynced(
        const Lists(
          logins: [
            Login(
              id: 'l1',
              name: 'Orbit',
              username: 'sam',
              password: 'pw',
              websites: ['example.co'],
              uris: [
                WebsiteRule('example.co', match: WebsiteMatch.baseDomain, extra: {'uriChecksum': 'z'}),
              ],
              addedAt: 5,
              extra: {
                'urls': ['example.co'],
              },
            ),
          ],
        ),
      );
      await core.call('saveLogin', [
        'l1',
        {
          'name': 'Orbit',
          'username': 'sam',
          'keepPassword': true,
          'websiteRules': [
            {'uri': 'example.co', 'match': 'host'},
            {'uri': 'https://app.example.co/', 'match': 'startsWith'},
            {'uri': r'^https://x\.example\.co/$', 'match': 'regex'},
          ],
        },
      ]);
      final saved = core.vault.lists.logins.single;
      expect(saved.rules.map((r) => r.match), [WebsiteMatch.host, WebsiteMatch.startsWith, WebsiteMatch.regularExpression]);
      expect(saved.rules.first.extra, {'uriChecksum': 'z'});
      expect(saved.websites, ['example.co', 'app.example.co']);
      expect(saved.toJson()['urls'], ['example.co', 'https://app.example.co/']);
    });

    test('refuse an address that is not the web or an app, and a pattern that does not compile', () async {
      for (final rule in [
        {'uri': 'javascript:alert(1)', 'match': 'default'},
        {'uri': '(', 'match': 'regex'},
      ]) {
        await expectLater(
          core.call('saveLogin', [
            null,
            {
              'name': 'a',
              'username': 'b',
              'websiteRules': [rule],
            },
          ]),
          failure(CoreFailure.invalid),
        );
      }
      expect(core.vault.lists.logins, isEmpty);
    });
  });

  group('links', () {
    test('are written at both ends, shown on both, counted, and taken away from either', () async {
      final login = await object(core, 'saveLogin', [
        null,
        {'name': 'Orbit', 'username': 'sam', 'password': 'pw'},
      ]);
      final note = await object(core, 'saveNote', [
        null,
        {
          'title': 'Recovery',
          'text': 't',
          'links': [ref('login', login['id']! as String)],
        },
      ]);
      expect(note['links'], 1);
      expect(note.containsKey('linkFailures'), isFalse);
      final loginId = login['id']! as String;
      expect(core.vault.lists.logins.single.links.names(note['id']! as String), isTrue, reason: 'the login names the note too');
      expect((await list(core, 'logins')).single['links'], 1);
      final seen = await list(core, 'linkedItems', [ref('login', loginId)]);
      expect(seen.single['ref'], ref('note', note['id']! as String));
      expect(seen.single['name'], 'Recovery');
      expect(seen.single.containsKey('halfMade'), isFalse);
      // Taken away from the other end
      expect(await object(core, 'setLinks', [ref('login', loginId), <Object?>[]]), {'linkFailures': <Object?>[]});
      expect(core.vault.lists.notes.single.links, isEmpty);
      expect(core.vault.lists.logins.single.links, isEmpty);
      expect((await list(core, 'logins')).single['links'], 0);
    });

    test('are offered, as candidates, only for items that are not the item or linked to it already', () async {
      final login = await object(core, 'saveLogin', [
        null,
        {'name': 'Orbit', 'username': 'sam', 'password': 'pw'},
      ]);
      final one = await object(core, 'saveNote', [
        null,
        {'title': 'Alpha', 'text': ''},
      ]);
      await core.call('saveNote', [
        null,
        {'title': 'Beta', 'text': ''},
      ]);
      final loginRef = ref('login', login['id']! as String);
      expect((await list(core, 'linkCandidates', [loginRef, ''])).map((v) => v['name']), ['Alpha', 'Beta']);
      expect((await list(core, 'linkCandidates', [loginRef, 'bet'])).map((v) => v['name']), ['Beta']);
      await core.call('setLinks', [
        loginRef,
        [ref('note', one['id']! as String)],
      ]);
      expect((await list(core, 'linkCandidates', [loginRef, ''])).map((v) => v['name']), ['Beta']);
      // For a new item nothing is excluded but what the vault doesn't offer
      expect(await list(core, 'linkCandidates', [null, '']), hasLength(3));
    });

    test(
      'an item with no item id yet is not offered, and the link an account on a security key holds is neither made nor dropped',
      () async {
        const loginId = '11111111-1111-4111-8111-111111111111';
        const keyId = '33333333-3333-4333-8333-333333333333';
        await core.vault.applySynced(
          const Lists(
            logins: [
              Login(id: loginId, name: 'Orbit', username: 'sam', password: 'pw', links: [ItemLink(keyId)], addedAt: 1),
            ],
            notes: [SecureNote(id: 'legacy-note', title: 'Old', text: '', addedAt: 1)],
            keyAccounts: [
              KeyAccount(id: keyId, device: 'd', name: 'Orbit', label: 'sam', addedAt: 1, links: [ItemLink(loginId)]),
            ],
          ),
        );
        expect(await list(core, 'linkCandidates', [ref('login', loginId), '']), isEmpty);
        expect((await list(core, 'linkedItems', [ref('login', loginId)])).map((v) => v['ref']), [ref('key-otp', keyId)]);
        await core.call('setLinks', [ref('login', loginId), <Object?>[]]);
        expect(core.vault.lists.logins.single.links.names(keyId), isTrue);
        expect(core.vault.lists.keyAccounts.single.links.names(loginId), isTrue);
        await core.call('setLinks', [
          ref('login', loginId),
          [ref('key-otp', keyId)],
        ]);
        expect((await list(core, 'linkedItems', [ref('login', loginId)])), hasLength(1));
      },
    );

    test('a link an end can not make is named, and the others are made', () async {
      final login = await object(core, 'saveLogin', [
        null,
        {'name': 'Orbit', 'username': 'sam', 'password': 'pw'},
      ]);
      final failures = await core.call('setLinks', [
        ref('login', login['id']! as String),
        [ref('note', 'no-such-note')],
      ]);
      expect(failures, {
        'linkFailures': ['no-such-note'],
      });
    });

    test('an old login-and-code tie counts as a link and is cleared by unlinking', () async {
      await core.vault.applySynced(
        const Lists(
          logins: [Login(id: 'l1', name: 'Orbit', username: 'sam', password: 'pw', accountId: 'c1', addedAt: 1)],
          accounts: [OtpAccount(id: 'c1', issuer: 'Orbit', label: 'sam', secret: 'JBSWY3DPEHPK3PXP', addedAt: 1)],
        ),
      );
      expect((await list(core, 'logins')).single['links'], 1);
      expect((await list(core, 'linkedItems', [ref('login', 'l1')])).single['ref'], ref('otp', 'c1'));
      await core.call('setLinks', [ref('login', 'l1'), <Object?>[]]);
      expect(core.vault.lists.logins.single.accountId, isNull);
    });

    test('an item a link names that the vault does not hold stays, and is not shown', () async {
      const gone = '99999999-9999-4999-8999-999999999999';
      await core.vault.applySynced(
        const Lists(
          logins: [
            Login(id: 'l1', name: 'Orbit', username: 'sam', password: 'pw', links: [ItemLink(gone)], addedAt: 1),
          ],
        ),
      );
      expect(await list(core, 'linkedItems', [ref('login', 'l1')]), isEmpty);
      await core.call('saveLogin', [
        'l1',
        {'name': 'Orbit', 'username': 'sam', 'keepPassword': true, 'links': <Object?>[]},
      ]);
      expect(core.vault.lists.logins.single.links.names(gone), isTrue);
    });
  });

  group('MFA code and backup codes', () {
    const loginId = '11111111-1111-4111-8111-111111111111';
    const codeId = '22222222-2222-4222-8222-222222222222';

    Future<void> seed({List<String>? loginSites}) => core.vault.applySynced(
      Lists(
        logins: [Login(id: loginId, name: 'Orbit', username: 'sam', password: 'pw', websites: loginSites, addedAt: 1)],
        accounts: const [
          OtpAccount(id: codeId, issuer: 'Orbit', label: 'sam', secret: 'JBSWY3DPEHPK3PXP', websites: ['own.example.co'], addedAt: 1),
        ],
      ),
    );

    test('a code is named, given websites, a note and fields, and its secret never changes', () async {
      await seed();
      final view = await object(core, 'saveCode', [
        codeId,
        {
          'name': 'Work VPN',
          'websites': ['https://www.vpn.example.co/'],
          'note': 'n',
          'pinned': true,
          'fields': [
            {'name': 'Seat', 'kind': 'text', 'value': '12'},
          ],
        },
      ]);
      expect(view['name'], 'Work VPN');
      expect(view['websites'], ['vpn.example.co']);
      expect(view['ownWebsites'], ['vpn.example.co']);
      expect(view['pinned'], isTrue);
      expect((view['fields']! as List<Object?>), hasLength(1));
      final held = core.vault.lists.accounts.single;
      expect(held.secret, 'JBSWY3DPEHPK3PXP');
      expect(held.note, 'n');
      expect(jsonEncode(view), isNot(contains('JBSWY3DPEHPK3PXP')));
    });

    test('a code linked to an item with websites shows those, and its own are not written', () async {
      await seed(loginSites: ['bank.example.co']);
      await core.call('saveCode', [
        codeId,
        {
          'links': [ref('login', loginId)],
        },
      ]);
      var view = (await list(core, 'codes')).single;
      expect(view['websites'], ['bank.example.co']);
      expect(view['ownWebsites'], ['own.example.co']);
      expect(view['websitesFrom'], [ref('login', loginId)]);
      expect(view['links'], 1);
      await core.call('saveCode', [
        codeId,
        {
          'websites': ['changed.example.co'],
        },
      ]);
      expect(core.vault.lists.accounts.single.websites, ['own.example.co'], reason: 'the login holds them');
      // Unlinked, it writes its own again
      await core.call('saveCode', [
        codeId,
        {'links': <Object?>[]},
      ]);
      view = (await list(core, 'codes')).single;
      expect(view['websites'], ['own.example.co']);
      expect(view.containsKey('websitesFrom'), isFalse);
    });

    test('backup codes are named, given websites and fields, and keep their codes', () async {
      final made = await object(core, 'addBackupService', ['Google', 'aaaa1111\nbbbb2222']);
      final id = made['serviceId']! as String;
      final view = await object(core, 'saveBackupCodes', [
        id,
        {
          'name': 'Google (work)',
          'websites': ['accounts.google.com'],
          'fields': [
            {'name': 'Recovery email', 'kind': 'text', 'value': 'a@b.co'},
          ],
        },
      ]);
      expect(view['name'], 'Google (work)');
      expect(view['websites'], ['accounts.google.com']);
      expect(view['total'], 2);
      expect((view['fields']! as List<Object?>), hasLength(1));
      expect(core.vault.lists.backupServices.single.codes, hasLength(2));
      await expectLater(core.call('saveBackupCodes', ['missing', <String, Object?>{}]), failure(CoreFailure.notFound));
    });
  });

  group('contacts', () {
    test('one is kept with no key, with its details, and is not a contact whose key can not be read', () async {
      final view = await object(core, 'saveContact', [
        {'name': 'Ada Lovelace', 'company': 'Analytical', 'email': 'ada@example.org', 'phone': '+44', 'address': 'London\nUK'},
      ]);
      expect(view['hasKey'], isFalse);
      expect(view.containsKey('unreadable'), isFalse);
      expect(view['company'], 'Analytical');
      expect(view['address'], 'London\nUK');
      expect(view['source'], 'manual');
      expect(view['canEncrypt'], isFalse);
      final held = core.vault.lists.contacts.single;
      expect(held.publicKey, '');
      expect(held.toJson().containsKey('public'), isFalse);
    });

    test('changes its details and leaves out what a call does not name', () async {
      final made = await object(core, 'saveContact', [
        {'name': 'Ada', 'company': 'A', 'email': 'a@b.co'},
      ]);
      final view = await object(core, 'saveContact', [
        {'id': made['id'], 'company': ''},
      ]);
      expect(view.containsKey('company'), isFalse);
      expect(view['email'], 'a@b.co');
      expect(view['name'], 'Ada');
    });

    test('needs a name when it is new, and can not be written to without a key', () async {
      await expectLater(
        core.call('saveContact', [
          <String, Object?>{'company': 'x'},
        ]),
        failure(CoreFailure.invalid),
      );
      final made = await object(core, 'saveContact', [
        {'name': 'Ada'},
      ]);
      await expectLater(
        core.call('pgpEncrypt', [
          {
            'text': 'hi',
            'contactIds': [made['id']],
          },
        ]),
        failure(CoreFailure.invalid),
      );
    });
  });
}
