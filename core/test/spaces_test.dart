// Shared spaces in the core (docs/plans/add-spaces.md): what needs no server of Kemlock's: the WebDAV spaces the vault joined, the
// rule that a space that has not been checked this session hides its logins and takes no change, and what the item views say of the
// space they are in. The chain, its keys and the manifest are Kemlock-core's, held by its own tests.
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/features/sync/sync.dart';
import 'package:kemlock_core/features/sync/sync_crypto.dart';
import 'package:kemlock_core/features/sync/sync_merge.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';
const inviteCode = 'K7PQ-2M9X-DARF';
const folder = 'https://dav.example.com/kemlock/';
const serverSpace = '3f1c2a9e-5b7d-4c1e-8a2b-9d4e6f708192';

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

Future<Map<String, Object?>> object(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

Future<List<Map<String, Object?>>> list(CoreService core, String method, [List<Object?> args = const []]) async =>
    ((await core.call(method, args))! as List<Object?>).cast<Map<String, Object?>>();

/// A WebDAV folder in memory: the space's file, as the server holds it.
class Folder {
  Folder(this.name);

  final String name;
  String? body;
  var writes = 0;

  /// Asked once, on the next read of the file: what the person does while a run is under way.
  Future<void> Function()? onGet;

  http.Client client() => MockClient((request) async {
    if (!request.url.path.endsWith(name)) return http.Response('not found', 404);
    if (request.method == 'GET') {
      final edit = onGet;
      onGet = null;
      await edit?.call();
    }
    if (request.method == 'GET') {
      return body == null ? http.Response('not found', 404) : http.Response(body!, 200, headers: {'ETag': '"v$writes"'});
    }
    if (request.method == 'PUT') {
      body = request.body;
      writes++;
      return http.Response('', 201);
    }
    return http.Response('no', 405);
  });
}

void main() {
  final key = Uint8List.fromList(List.generate(32, (i) => 255 - i));
  late Folder dav;
  late CoreService core;
  late String invite;

  setUpAll(() async {
    invite = await sealInvite(SpaceInvite(id: 'team', name: 'Team', file: spaceFile('team'), key: key), inviteCode);
  });

  setUp(() async {
    dav = Folder(spaceFile('team'));
    dav.body = await encryptSyncFile(const SyncDoc(), key);
    final platform = fakePlatform(MemoryArea(), clientFor: (_) => dav.client());
    core = await CoreService.start(platform, CoreData(publicSuffixList: smallSuffixList));
    await core.call('createVault', [password]);
  });

  Future<String> addLogin(String name) async {
    final saved = await object(core, 'saveLogin', [
      null,
      {
        'name': name,
        'username': 'sam',
        'password': 'p4ss-$name',
        'websites': ['$name.example.com'],
      },
    ]);
    return saved['id']! as String;
  }

  Future<void> join() => core.call('joinDavSpace', [
    {'invite': invite, 'code': inviteCode, 'folder': folder, 'username': 'sam', 'password': 'dav'},
  ]);

  test('the spaces’ methods are listed for the bridge', () {
    expect(
      CoreService.methods,
      containsAll(['spaces', 'space', 'spaceContact', 'spaceTrust', 'spaceAnswer', 'moveItem', 'hiddenLoginIds', 'joinDavSpace']),
    );
  });

  group('a vault that syncs nowhere', () {
    test('has no spaces on a server, and says so', () async {
      final view = await object(core, 'spaces');
      expect(view['available'], false);
      expect(view['server'], isEmpty);
      expect(view['webdav'], isEmpty);
    });

    test('takes no request about a server space', () async {
      await expectLater(core.call('space', [serverSpace]), failure(CoreFailure.invalid));
      await expectLater(core.call('spaceMake', ['Team']), failure(CoreFailure.invalid));
    });
  });

  group('a WebDAV space', () {
    test('is joined with its invite and its code, from an https folder only', () async {
      await expectLater(
        core.call('joinDavSpace', [
          {'invite': invite, 'code': inviteCode, 'folder': 'http://dav.example.com/kemlock/', 'username': '', 'password': ''},
        ]),
        failure('space_dav_insecure'),
      );
      await expectLater(
        core.call('joinDavSpace', [
          {'invite': 'not an invite', 'code': inviteCode, 'folder': folder, 'username': '', 'password': ''},
        ]),
        failure('space_dav_invite_format'),
      );
      await expectLater(
        core.call('joinDavSpace', [
          {'invite': invite, 'code': 'AAAA-AAAA-AAAA', 'folder': folder, 'username': '', 'password': ''},
        ]),
        failure('space_dav_invite_code'),
      );
      expect((await object(core, 'spaces'))['webdav'], isEmpty);
    });

    test('is listed once joined, and not joined twice', () async {
      await join();
      final row = ((await object(core, 'spaces'))['webdav']! as List<Object?>).single! as Map<String, Object?>;
      expect(row, containsPair('id', 'team'));
      expect(row, containsPair('name', 'Team'));
      expect(row, containsPair('status', 'webdav'));
      await expectLater(join(), failure('space_dav_joined'));
    });

    test('refuses a file the invite’s key doesn’t open', () async {
      dav.body = await encryptSyncFile(const SyncDoc(), Uint8List(32));
      await expectLater(join(), failure('space_dav_key'));
    });

    test('takes an item in and out, and its view says where it is', () async {
      await join();
      final id = await addLogin('orbit');
      await core.call('moveItem', ['login', id, 'team', null]);
      final inSpace = (await list(core, 'logins')).single;
      expect(inSpace['space'], {'id': 'team', 'name': 'Team', 'canEdit': true, 'passwordHidden': false});
      expect(await core.call('hiddenLoginIds'), isEmpty);
      await core.call('moveItem', ['login', id, null, null]);
      expect((await list(core, 'logins')).single.containsKey('space'), isFalse);
    });

    test('is synced as a scope of its own, and keeps what was put in it', () async {
      await join();
      final id = await addLogin('orbit');
      await core.call('moveItem', ['login', id, 'team', null]);
      final view = await object(core, 'syncSpaces');
      final row = ((view['webdav']! as List<Object?>).single! as Map<String, Object?>);
      expect(row['lastSync'], 1700000000000);
      expect(row.containsKey('problem'), isFalse);
      expect(dav.writes, greaterThan(0));
      expect(jsonDecode(dav.body!), containsPair('kind', 'sync'));
      // The vault's own entries never go to the space's file
      expect(dav.body, isNot(contains('orbit')));
    });

    test('learns nothing of a run that an edit made meanwhile has outdated', () async {
      await join();
      final id = await addLogin('orbit');
      await core.call('moveItem', ['login', id, 'team', null]);
      dav.onGet = () async {
        await addLogin('docs');
      };
      // The run is told to be made again, and has kept nothing: no `known` that names what was never applied
      expect(await core.sync.spaces.runAll(), isTrue);
      expect(core.sync.scopeStates.containsKey('team'), isFalse);
      expect(await core.sync.spaces.runAll(), isFalse);
      expect(core.sync.scopeStates['team']!.known, [id]);
    });

    test('is left with its items, which leave the browser', () async {
      await join();
      final id = await addLogin('orbit');
      await addLogin('keep');
      await core.call('moveItem', ['login', id, 'team', null]);
      await core.call('leaveDavSpace', ['team']);
      expect((await list(core, 'logins')).map((login) => login['name']), ['keep']);
      expect((await object(core, 'spaces'))['webdav'], isEmpty);
    });
  });

  group('a space that was not checked this session', () {
    Future<String> inUnchecked() async {
      final id = await addLogin('orbit');
      // As a sync from another device would leave it: in a space this session's chain hasn't been read for
      await core.vault.saveChanged(
        (lists) => Lists(logins: [for (final login in lists.logins) login.id == id ? login.inSpace(serverSpace) : login]),
      );
      return id;
    }

    test('hides its logins’ passwords, and still fills them', () async {
      final id = await inUnchecked();
      expect(await core.call('hiddenLoginIds'), [id]);
      final view = (await list(core, 'logins')).single;
      expect(view['space'], containsPair('passwordHidden', true));
      expect(view['space'], containsPair('canEdit', false));
      // Filling reads the password inside the background, as the phone's autofill does
      expect(await object(core, 'revealLogin', [id]), containsPair('password', 'p4ss-orbit'));
    });

    test('takes no change to its items', () async {
      final id = await inUnchecked();
      await expectLater(
        core.call('saveLogin', [
          id,
          {'name': 'orbit', 'username': 'sam', 'password': 'other', 'websites': <String>[]},
        ]),
        failure('space_notChecked'),
      );
      await expectLater(core.call('deleteLogin', [id]), failure('space_notChecked'));
      // A login whose password the space hides stays in it: moving it out would show the password
      await expectLater(core.call('moveItem', ['login', id, null, null]), failure('space_hidden'));
      expect((await list(core, 'logins')).single['name'], 'orbit');
    });

    test('takes a password that is hidden out of the health report', () async {
      final id = await addLogin('orbit');
      final other = await addLogin('docs');
      for (final login in [id, other]) {
        await core.call('saveLogin', [
          login,
          {'name': login == id ? 'orbit' : 'docs', 'username': 'sam', 'password': 'shared-p4ss-Word-9', 'websites': <String>[]},
        ]);
      }
      expect((await object(core, 'health'))['reused'], unorderedEquals([id, other]));
      await core.vault.saveChanged(
        (lists) => Lists(logins: [for (final login in lists.logins) login.id == id ? login.inSpace(serverSpace) : login]),
      );
      // The one it hides no longer says that another login shares its password
      expect((await object(core, 'health'))['reused'], isEmpty);
    });

    test('takes no unlinking of a code from a login it holds', () async {
      final code = await object(core, 'addCode', ['otpauth://totp/Orbit:sam@orbit.test?secret=JBSWY3DPEHPK3PXP&issuer=Orbit', null, null]);
      final held = await addLogin('orbit');
      final other = await addLogin('docs');
      await core.call('linkCode', [code['id'], held]);
      await core.vault.saveChanged(
        (lists) => Lists(
          accounts: lists.accounts,
          logins: [for (final login in lists.logins) login.id == held ? login.inSpace(serverSpace) : login],
        ),
      );
      await expectLater(core.call('linkCode', [code['id'], other]), failure('space_notChecked'));
    });

    test('takes nothing in until its chain has been read', () async {
      final id = await addLogin('docs');
      await expectLater(core.call('moveItem', ['login', id, serverSpace, null]), failure('space_notChecked'));
    });
  });

  test('keeps a hidden password as it is when the form never held it', () async {
    final id = await addLogin('orbit');
    await core.call('saveLogin', [
      id,
      {'name': 'Orbit Cloud', 'username': 'sam', 'password': '', 'keepPassword': true, 'websites': <String>[]},
    ]);
    expect(await object(core, 'revealLogin', [id]), containsPair('password', 'p4ss-orbit'));
    expect((await list(core, 'logins')).single['name'], 'Orbit Cloud');
  });
}
