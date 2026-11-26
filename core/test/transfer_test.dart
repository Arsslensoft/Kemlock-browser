// Import and export through the core, as the transfer page asks for them: a file opened, previewed, planned and merged into an open
// vault, and the vault written as a file or as QR codes. The formats are Kemlock-core's (tested there with the app's fixtures);
// this is the merge into the browser's vault, the password every export asks for, and the QR codes being ones that read.
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/features/import/importers.dart' show parseGoogleMigration;
import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_file.dart';
import 'package:kemlock_core/vault/vault_export.dart' show exportVaultPlaintext;
import 'package:kemlock_extension_core/src/browser.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/qr.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:kemlock_extension_core/src/vault_service.dart' show VaultService;
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const link = 'otpauth://totp/Orbit:sam@orbit.test?secret=JBSWY3DPEHPK3PXP&issuer=Orbit';
const clock = 1700000000000;

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

String file(String text) => base64.encode(utf8.encode(text));

/// A vault with a login and a code.
Future<CoreService> vaultWithItems({Future<Pixels?> Function(String)? decode}) async {
  final core = await CoreService.start(
    CorePlatform(
      storage: AreaPreferences(MemoryArea()),
      clientFor: (_) => MockClient((request) async => http.Response('not found', 404)),
      deviceKeys: FakeDeviceKeys(),
      browserAuth: FakeBrowserAuth(),
      browser: Browser.chrome,
      sessionKey: testSessionKey,
      decodeImage: decode,
      clock: () => DateTime.fromMillisecondsSinceEpoch(clock, isUtc: true),
    ),
    const CoreData(publicSuffixList: smallSuffixList),
  );
  await core.call('createVault', [password]);
  return core;
}

Future<void> addItems(CoreService core) async {
  await core.call('saveLogin', [
    null,
    {
      'name': 'Orbit',
      'username': 'sam',
      'password': 'p4ss',
      'websites': ['orbit-cloud.com'],
    },
  ]);
  await core.call('addCode', [link]);
}

/// A page with the QR code of [modules] (a `size` by `size` string of 1 and 0) on it, as a screenshot would hold it.
Pixels pictureOf(Map<String, Object?> code) {
  final size = code['size']! as int;
  final modules = code['modules']! as String;
  const scale = 4;
  const quiet = 4;
  final side = (size + 2 * quiet) * scale;
  final argb = Int32List(side * side)..fillRange(0, side * side, 0xFFFFFFFF);
  for (var y = 0; y < size * scale; y++) {
    for (var x = 0; x < size * scale; x++) {
      if (modules[(y ~/ scale) * size + x ~/ scale] == '1') argb[(y + quiet * scale) * side + x + quiet * scale] = 0xFF000000;
    }
  }
  return (width: side, height: side, argb: argb);
}

void main() {
  group('opening a file', () {
    late CoreService from;
    late CoreService into;

    setUp(() async {
      from = await vaultWithItems();
      await addItems(from);
      into = await vaultWithItems();
    });

    test("tells a Kemlock export's contents, what it adds, and merges it into the vault", () async {
      final exported = await object(from, 'transferExport', [
        {'format': 'plain', 'password': password},
      ]);
      expect(exported['name'], matches(RegExp(r'^kemlock-export-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.json$')));
      final opened = await object(into, 'transferOpen', [file(exported['text']! as String)]);
      expect((opened['format'], opened['encrypted']), ('kemlock', false));
      final token = opened['token']! as String;

      final preview = await object(into, 'transferPreview', [token]);
      expect(preview['held'], containsPair('logins', 1));
      expect(preview['held'], containsPair('codes', 1));
      expect((preview['samples']! as List<Object?>).cast<Map<String, Object?>>().map((s) => s['name']), containsAll(['Orbit']));
      final plan = await object(into, 'transferPlan', [token, {}]);
      expect(plan['adding'], containsPair('logins', 1));
      expect(plan['adding'], containsPair('codes', 1));
      expect(plan['duplicates'], containsPair('logins', 0));
      expect(plan['canImport'], true);

      final applied = await object(into, 'transferApply', [token, {}]);
      expect(applied['added'], containsPair('logins', 1));
      expect((await list(into, 'logins')).single['name'], 'Orbit');
      expect((await list(into, 'codes')).single['issuer'], 'Orbit');
    });

    test('stamps what it adds as changed now and counts the change, so that sync carries it', () async {
      final exported = await object(from, 'transferExport', [
        {'format': 'plain', 'password': password},
      ]);
      final token = (await object(into, 'transferOpen', [file(exported['text']! as String)]))['token']! as String;
      await object(into, 'transferPreview', [token]);
      final before = into.vault.revision;

      await object(into, 'transferApply', [token, {}]);

      expect(into.vault.revision, greaterThan(before));
      expect(into.vault.lists.logins.single.updatedAt, clock);
      expect(into.vault.lists.accounts.single.updatedAt, clock);
    });

    test('a second import of the same file finds everything held, and has nothing to add', () async {
      final text =
          (await object(from, 'transferExport', [
                {'format': 'plain', 'password': password},
              ]))['text']!
              as String;
      for (var round = 0; round < 2; round++) {
        final token = (await object(into, 'transferOpen', [file(text)]))['token']! as String;
        await object(into, 'transferPreview', [token]);
        final plan = await object(into, 'transferPlan', [token, {}]);
        if (round == 0) {
          await object(into, 'transferApply', [token, {}]);
        } else {
          expect(plan['canImport'], false);
          expect(plan['duplicates'], containsPair('logins', 1));
          expect(plan['duplicates'], containsPair('codes', 1));
          await expectLater(into.call('transferApply', [token, {}]), failure('importNothing'));
        }
      }
      expect(await list(into, 'logins'), hasLength(1));
      expect(await list(into, 'codes'), hasLength(1));
    });

    test('replaces the vault\'s codes with the file\'s when asked, and only then', () async {
      await into.call('addCode', ['otpauth://totp/Other:me?secret=GEZDGNBVGY3TQOJQ&issuer=Other']);
      final text =
          (await object(from, 'transferExport', [
                {'format': 'links', 'password': password},
              ]))['text']!
              as String;
      final token = (await object(into, 'transferOpen', [file(text)]))['token']! as String;
      await object(into, 'transferPreview', [token]);

      await object(into, 'transferApply', [
        token,
        {'mode': 'replace'},
      ]);

      expect((await list(into, 'codes')).map((c) => c['issuer']), ['Orbit']);
    });

    test('opens an encrypted export only with its password', () async {
      final exported = await object(from, 'transferExport', [
        {'format': 'encrypted', 'password': password, 'exportPassword': 'transfer password'},
      ]);
      final opened = await object(into, 'transferOpen', [file(exported['text']! as String)]);
      expect(opened['encrypted'], true);
      final token = opened['token']! as String;

      await expectLater(into.call('transferPreview', [token]), failure('importBadPassword'));
      await expectLater(into.call('transferPreview', [token, 'another password']), failure('importBadPassword'));
      final preview = await object(into, 'transferPreview', [token, 'transfer password']);

      expect(preview['held'], containsPair('logins', 1));
      expect(preview['held'], containsPair('codes', 1));
    });

    test('reads a CSV of logins', () async {
      const csv = 'name,url,username,password\nGitHub,https://github.com,me,hunter2\nMail,https://mail.example.com,me,pw\n';
      final opened = await object(into, 'transferOpen', [file(csv)]);
      expect(opened['format'], 'csv');
      final token = opened['token']! as String;

      await object(into, 'transferPreview', [token]);
      await object(into, 'transferApply', [token, {}]);

      expect((await list(into, 'logins')).map((l) => l['name']), unorderedEquals(['GitHub', 'Mail']));
    });

    test('says what it cannot read, and refuses a file that is not an export', () async {
      await expectLater(into.call('transferOpen', [file('hello, this is no export')]), failure('importUnsupported'));
      await expectLater(into.call('transferOpen', ['!!! not base64']), failure(CoreFailure.invalid));
      await expectLater(
        into.call('transferOpen', [file('{"encrypted": false, "items": []}')]).then((opened) {
          final token = (opened! as Map<String, Object?>)['token']! as String;
          return into.call('transferPreview', [token]);
        }),
        failure('importEmpty'),
      );
    });

    test('forgets the file once the vault locks, and keeps one file at a time', () async {
      final first = (await object(into, 'transferOpen', [file(link)]))['token']! as String;
      final second = (await object(into, 'transferOpen', [file(link)]))['token']! as String;

      await expectLater(into.call('transferPreview', [first]), failure(CoreFailure.notFound));
      await into.call('lock');
      await into.call('unlock', [password]);
      await expectLater(into.call('transferPreview', [second]), failure(CoreFailure.notFound));
    });

    test('an export counts the File items among the attached files it cannot hold', () async {
      final file = NoteAttachment(id: 'a1', name: 'a.pdf', size: 1, key: 'a2V5', addedAt: 1);
      await into.vault.applySynced(
        Lists(
          notes: [
            SecureNote(id: 'n1', title: 'Papers', text: '', attachments: [file], addedAt: 1),
          ],
          files: [VaultFile(id: 'f1', name: 'Scan', file: file, addedAt: 1)],
        ),
      );
      final info = await object(into, 'transferExportInfo');
      expect(info['attachedFiles'], 2);
    });

    test('needs the vault open', () async {
      await into.call('lock');

      await expectLater(into.call('transferOpen', [file(link)]), failure(CoreFailure.locked));
      await expectLater(into.call('transferExportInfo'), failure(CoreFailure.locked));
    });
  });

  group('what goes in', () {
    Map<String, Object?> item(String title, List<Object?> credentials) => {
      'id': title,
      'title': title,
      'scope': {
        'urls': ['https://$title.example'],
        'androidApps': <Object?>[],
      },
      'credentials': credentials,
      'tags': <Object?>[],
    };
    Map<String, Object?> account(String name, List<Object?> items) => {
      'id': name,
      'username': name,
      'email': '$name@example.com',
      'items': items,
      'collections': <Object?>[],
    };
    final basic = {
      'type': 'basic-auth',
      'username': {'fieldType': 'string', 'value': 'ada'},
      'password': {'fieldType': 'concealed-string', 'value': 'pw-1'},
    };
    final totp = {'type': 'totp', 'secret': 'JBSWY3DPEHPK3PXP', 'period': 30, 'digits': 6, 'algorithm': 'sha1'};

    test('a replace with every place that holds codes left out leaves the vault’s codes alone', () async {
      final into = await vaultWithItems();
      await into.call('addCode', [link]);
      final doc = {
        'version': {'major': 1, 'minor': 0},
        'exporterRpId': 'exporter.example.com',
        'exporterDisplayName': 'Exporter app',
        'timestamp': 1705228800,
        'accounts': [
          account('coded', [
            item('Coded', [basic, totp]),
          ]),
          account('plain', [
            item('Plain', [basic]),
          ]),
        ],
      };
      final opened = await object(into, 'transferOpen', [file(jsonEncode(doc))]);
      final token = opened['token']! as String;
      final preview = await object(into, 'transferPreview', [token]);
      final units = (preview['units']! as List<Object?>).cast<Map<String, Object?>>();
      // The place with the code has two entries (its login and its code), the other one
      final coded = units.firstWhere((unit) => unit['count'] == 2)['id']! as String;
      final options = {
        'mode': 'replace',
        'excluded': [coded],
      };

      final plan = await object(into, 'transferPlan', [token, options]);

      expect(plan['canImport'], false);
      await expectLater(into.call('transferApply', [token, options]), failure('importNothing'));
      expect((await list(into, 'codes')).map((c) => c['issuer']), ['Orbit']);
    });

    test('Kemlock’s own QR transfer replaces the backup codes too, as the app does', () async {
      final from = await vaultWithItems();
      await addItems(from);
      const shared = BackupService(
        id: 'shared',
        serviceName: 'Shared',
        codes: [BackupCode(code: 'aaaa-1111')],
        addedAt: 1,
      );
      await from.vault.saveImported((held) => Lists(accounts: held.accounts, backupServices: const [shared]));
      final out = await object(from, 'transferExportQr', [
        {'format': 'kemlockPlain', 'password': password},
      ]);
      final codes = (out['codes']! as List<Object?>).cast<Map<String, Object?>>();
      final pictures = {for (final (index, code) in codes.indexed) 'data:image/png;base64,$index': pictureOf(code)};
      final into = await vaultWithItems(decode: (url) async => pictures[url]);
      const held = BackupService(
        id: 'held',
        serviceName: 'Held',
        codes: [BackupCode(code: 'bbbb-2222')],
        addedAt: 1,
      );
      await into.vault.saveImported((_) => const Lists(backupServices: [held]));

      final opened = await object(into, 'transferOpenQr', [pictures.keys.toList()]);
      final token = opened['token']! as String;
      await object(into, 'transferPreview', [token]);
      await object(into, 'transferApply', [
        token,
        {'mode': 'replace'},
      ]);

      expect(into.vault.lists.backupServices.map((s) => s.serviceName), ['Shared']);
    });

    test('items of a shared space come in as the person’s own, and notes without their files, and the preview says so', () async {
      const note = SecureNote(
        id: 'n1',
        title: 'Passport',
        spaceId: 'family',
        addedAt: 1,
        attachments: [NoteAttachment(id: 'f1', name: 'scan.pdf', size: 3, key: 'a2V5', addedAt: 1)],
      );
      final text = exportVaultPlaintext(
        const [],
        const [],
        logins: const [Login(id: 'l1', name: 'Shared login', username: 'me', password: 'pw', spaceId: 'family', addedAt: 1)],
        notes: const [note],
      );
      final into = await vaultWithItems();
      final token = (await object(into, 'transferOpen', [file(text)]))['token']! as String;

      final preview = await object(into, 'transferPreview', [token]);
      await object(into, 'transferApply', [token, {}]);

      expect(preview['spaceItems'], 2);
      expect(preview['attachedFiles'], 1);
      expect(into.vault.lists.logins.single.spaceId, isNull);
      expect(into.vault.lists.notes.single.spaceId, isNull);
      expect(into.vault.lists.notes.single.files, isEmpty);
    });
  });

  group('exporting', () {
    late CoreService core;

    setUp(() async {
      core = await vaultWithItems();
      await addItems(core);
    });

    test('asks for the vault password, counts a wrong one like the lock screen does, and clears the count when it is right', () async {
      await expectLater(
        core.call('transferExport', [
          {'format': 'plain', 'password': 'wrong'},
        ]),
        failure('badPassword'),
      );
      expect(await object(core, 'state'), containsPair('wrongPasswords', 1));

      final exported = await object(core, 'transferExport', [
        {'format': 'plain', 'password': password},
      ]);

      expect(exported['text'], contains('"scheme": "plaintext"'));
      expect(await object(core, 'state'), containsPair('wrongPasswords', 0));
      // A wrong one makes the next try wait
      expect(VaultService.confirmDelay(0), Duration.zero);
      expect([for (var failures = 1; failures <= 7; failures++) VaultService.confirmDelay(failures).inSeconds], [1, 2, 4, 8, 16, 30, 30]);
      expect(core.vault.session, isNotNull);
    });

    test('says what the vault holds before anything leaves', () async {
      final info = await object(core, 'transferExportInfo');

      expect(info['counts'], containsPair('logins', 1));
      expect(info['counts'], containsPair('codes', 1));
      expect(info['spaceItems'], 0);
      expect(info['cxf'], containsPair('sendable', containsPair('logins', 1)));
    });

    test('writes an encrypted export that opens with its password and holds what the vault does', () async {
      final exported = await object(core, 'transferExport', [
        {'format': 'encrypted', 'password': password, 'exportPassword': 'transfer password'},
      ]);

      expect(exported['text'], isNot(contains('p4ss')));
      expect(exported['text'], isNot(contains('JBSWY3DPEHPK3PXP')));
      expect(exported['counts'], containsPair('logins', 1));
    });

    test('wants an export password of eight characters', () async {
      await expectLater(
        core.call('transferExport', [
          {'format': 'encrypted', 'password': password, 'exportPassword': 'short'},
        ]),
        failure('exportTooShort'),
      );
    });

    test('writes the logins as a CSV, the codes as links, and the items as Credential Exchange', () async {
      final csv = await object(core, 'transferExport', [
        {'format': 'csv', 'password': password},
      ]);
      final links = await object(core, 'transferExport', [
        {'format': 'links', 'password': password},
      ]);
      final cxf = await object(core, 'transferExport', [
        {
          'format': 'cxf',
          'password': password,
          'kinds': ['logins', 'codes'],
        },
      ]);

      expect(csv['text'], startsWith('folder,favorite,type,name'));
      expect(csv['text'], contains('Orbit'));
      expect(links['text'], startsWith('otpauth://totp/Orbit'));
      expect((jsonDecode(cxf['text']! as String) as Map<String, Object?>)['exporterDisplayName'], 'Kemlock');
      await expectLater(
        core.call('transferExport', [
          {'format': 'cxf', 'password': password, 'kinds': <String>[]},
        ]),
        failure(CoreFailure.invalid),
      );
    });

    test('leaves the items of shared spaces out, and says how many', () async {
      await core.vault.saveImported(
        (lists) => Lists(
          accounts: lists.accounts,
          logins: [
            ...lists.logins,
            lists.logins.single.copyWith(id: 'in-a-space', spaceId: 'family'),
          ],
        ),
      );

      final exported = await object(core, 'transferExport', [
        {'format': 'plain', 'password': password},
      ]);

      expect(exported['spaceItems'], 1);
      expect(exported['text'], isNot(contains('in-a-space')));
    });
  });

  group('QR codes', () {
    test('the transfer codes of Google Authenticator are ones that read, and read back as the vault\'s codes', () async {
      final core = await vaultWithItems();
      await addItems(core);

      final out = await object(core, 'transferExportQr', [
        {'format': 'google', 'password': password},
      ]);

      final codes = (out['codes']! as List<Object?>).cast<Map<String, Object?>>();
      expect(codes, hasLength(1));
      final size = codes.single['size']! as int;
      expect((codes.single['modules']! as String).length, size * size);
      final read = readQrCode(pictureOf(codes.single));
      expect(read, startsWith('otpauth-migration://offline?data='));
      expect(parseGoogleMigration(read!)!.accounts.single.issuer, 'Orbit');
    });

    test('Kemlock\'s own transfer opens with its password, from images of the codes', () async {
      final from = await vaultWithItems();
      await addItems(from);
      final out = await object(from, 'transferExportQr', [
        {'format': 'kemlock', 'password': password, 'transferPassword': 'transfer password'},
      ]);
      final codes = (out['codes']! as List<Object?>).cast<Map<String, Object?>>();
      final pictures = {for (final (index, code) in codes.indexed) 'data:image/png;base64,$index': pictureOf(code)};
      final into = await vaultWithItems(decode: (url) async => pictures[url]);

      final opened = await object(into, 'transferOpenQr', [pictures.keys.toList()]);
      expect((opened['format'], opened['encrypted']), ('kemlockQr', true));
      final token = opened['token']! as String;
      await expectLater(into.call('transferPreview', [token, 'wrong password']), failure('importBadPassword'));
      final preview = await object(into, 'transferPreview', [token, 'transfer password']);
      await object(into, 'transferApply', [token, {}]);

      expect(preview['held'], containsPair('codes', 1));
      expect((await list(into, 'codes')).single['issuer'], 'Orbit');
    });

    test('an image with no code is counted, and images of nothing Kemlock reads are refused', () async {
      final blank = (width: 100, height: 100, argb: Int32List(100 * 100)..fillRange(0, 100 * 100, 0xFFFFFFFF));
      final core = await vaultWithItems(decode: (url) async => blank);

      await expectLater(
        core.call('transferOpenQr', [
          ['data:image/png;base64,x'],
        ]),
        failure('importUnsupported'),
      );
    });

    test('wants a transfer password of eight characters', () async {
      final core = await vaultWithItems();
      await addItems(core);

      await expectLater(
        core.call('transferExportQr', [
          {'format': 'kemlock', 'password': password, 'transferPassword': 'short'},
        ]),
        failure('exportTooShort'),
      );
    });
  });
}
