// An encrypted Kemlock export opened with pieces of its vault's Recovery Kit instead of its password (docs/plans/add-transfer.md): the kit
// is made here the way the account's is (kit_pieces.dart), the file is written by Kemlock-core's own exportVault with that kit, and the
// core puts the pieces together, opens the file's second wrap with the key they rebuild, and says what is wrong when they don't.
import 'dart:convert';

import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/vault/vault_export.dart' show exportVault;
import 'package:kemlock_core/vault/vault_store.dart' show RecoveryKey;
import 'package:kemlock_extension_core/src/account/kit_pieces.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const exportPassword = 'the file’s own password';

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

String file(String text) => base64.encode(utf8.encode(text));

const orbit = Login(id: 'l1', name: 'Orbit', username: 'sam', password: 'p4ss', addedAt: 1);

void main() {
  late CoreService core;

  setUp(() async {
    core = await startCore(MemoryArea());
    await core.call('createVault', [password]);
  });

  /// An encrypted export with a kit's wrap, and the kit's pieces; or without one.
  Future<({String text, List<String> pieces})> exported({bool withKit = true}) async {
    final kit = makeKit(2, 3);
    final text = await exportVault(
      const [],
      const [],
      exportPassword,
      logins: const [orbit],
      recoveryKey: withKit
          ? RecoveryKey(kitId: kit.kitId, key: kit.key, threshold: 2, shares: 3, createdAt: '2026-11-01T00:00:00.000Z')
          : null,
    );
    return (text: text, pieces: kit.pieces);
  }

  Future<String> open(String text) async => (await object(core, 'transferOpen', [file(text)]))['token']! as String;

  test('opens with any two pieces, and merges what the file holds', () async {
    final made = await exported();
    for (final pair in [
      [made.pieces[0], made.pieces[1]],
      [made.pieces[2], made.pieces[0]],
      [made.pieces[1], made.pieces[2]],
    ]) {
      final token = await open(made.text);
      final preview = await object(core, 'transferPreviewKit', [token, pair]);
      expect(preview['held'], containsPair('logins', 1));
      expect((preview['samples']! as List<Object?>).cast<Map<String, Object?>>().single['name'], 'Orbit');
    }
    final token = await open(made.text);
    await core.call('transferPreviewKit', [
      token,
      [made.pieces[0], made.pieces[2]],
    ]);
    final applied = await object(core, 'transferApply', [token, <String, Object?>{}]);
    expect(applied['added'], containsPair('logins', 1));
    expect(core.vault.lists.logins.single.password, 'p4ss');
  });

  test('reads the pieces however they were typed: any case, with spaces', () async {
    final made = await exported();
    final token = await open(made.text);
    final typed = [displayPiece(made.pieces[0]).toLowerCase(), ' ${made.pieces[1]} '];
    expect((await object(core, 'transferPreviewKit', [token, typed]))['held'], containsPair('logins', 1));
  });

  test('says what is wrong with the pieces, and leaves the file open for another try', () async {
    final made = await exported();
    final token = await open(made.text);
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [made.pieces[0]],
      ]),
      failure('importKitNotEnough'),
    );
    await expectLater(core.call('transferPreviewKit', [token, <String>[]]), failure('importKitNotEnough'));
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [made.pieces[0], made.pieces[0]],
      ]),
      failure('importKitDuplicate'),
    );
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [made.pieces[0], 'not a piece'],
      ]),
      failure('importKitFormat'),
    );
    // A typo: the last letter of the check changed
    final typo = made.pieces[1].substring(0, made.pieces[1].length - 1) + (made.pieces[1].endsWith('A') ? 'B' : 'A');
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [made.pieces[0], typo],
      ]),
      failure('importKitChecksum'),
    );
    final other = makeKit(2, 3);
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [made.pieces[0], other.pieces[1]],
      ]),
      failure('importKitOtherKit'),
    );
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [other.pieces[0], other.pieces[1]],
      ]),
      failure('importKitOtherKit'),
    );
    // None of it changed the file: the right pieces open it now
    expect(
      (await object(core, 'transferPreviewKit', [
        token,
        [made.pieces[0], made.pieces[1]],
      ]))['held'],
      containsPair('logins', 1),
    );
  });

  test('says pieces of the file’s kit that open nothing open nothing, when the file was changed', () async {
    final made = await exported();
    final json = jsonDecode(made.text) as Map<String, Object?>;
    final recovery = json['recovery']! as Map<String, Object?>;
    final ct = recovery['ct']! as String;
    recovery['ct'] = (ct.startsWith('A') ? 'B' : 'A') + ct.substring(1);
    final token = await open(jsonEncode(json));
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [made.pieces[0], made.pieces[1]],
      ]),
      failure('importKitWrong'),
    );
  });

  test('says a file made without a kit, or not encrypted, has none, and the password still opens the first', () async {
    final plain = await exported(withKit: false);
    final token = await open(plain.text);
    await expectLater(core.call('transferPreviewKit', [token, makeKit(2, 3).pieces.take(2).toList()]), failure('importNoKit'));
    expect((await object(core, 'transferPreview', [token, exportPassword]))['held'], containsPair('logins', 1));

    final exportedPlain = await object(core, 'transferExport', [
      {'format': 'plain', 'password': password},
    ]);
    final plainToken = await open(exportedPlain['text']! as String);
    await expectLater(core.call('transferPreviewKit', [plainToken, makeKit(2, 3).pieces.take(2).toList()]), failure('importNoKit'));
  });

  test('refuses an argument that is not a list of pieces, and needs the vault open', () async {
    final made = await exported();
    final token = await open(made.text);
    await expectLater(core.call('transferPreviewKit', [token, 'a piece']), failure(CoreFailure.invalid));
    await expectLater(core.call('transferPreviewKit', [token, List.filled(10, made.pieces[0])]), failure(CoreFailure.invalid));
    await core.call('lock');
    await expectLater(
      core.call('transferPreviewKit', [
        token,
        [made.pieces[0], made.pieces[1]],
      ]),
      failure(CoreFailure.locked),
    );
  });
}
