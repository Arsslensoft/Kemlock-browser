// The custom fields an admin offers, as the core reads them once for the session (custom_fields.dart): none without Kemlock Server, one
// read at a time, and a read that was under way when the vault locked is not kept for the next one.
import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/features/sync/kemlock/km_account.dart' show KmAccount;
import 'package:kemlock_core/features/sync/kemlock/km_api.dart' show KmConnection;
import 'package:kemlock_core/features/sync/kemlock/km_custom_fields.dart';
import 'package:kemlock_core/features/sync/kemlock/km_host.dart';
import 'package:kemlock_core/features/sync/kemlock/km_models.dart';
import 'package:kemlock_core/models/custom_field.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/custom_fields.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:kemlock_extension_core/src/sync_service.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

class _NoValues implements KmVaultValues {
  @override
  Future<Object?> load(String key) async => null;

  @override
  Future<void> save(String key, Object? value) async {}

  @override
  void remove(String key) {}
}

/// A sync whose server answers when the test says so.
class _Sync extends SyncService {
  _Sync(super.vault);

  var asked = 0;
  Completer<KmCustomFields> reply = Completer();

  @override
  ({KmHost host, KemlockTarget target})? get kemlockPlace => (
    host: KmHost(values: _NoValues(), clientFor: (_) => MockClient((_) async => http.Response('', 404)), proofsFor: (_) async => null),
    target: const KemlockTarget(
      accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'sam@example.co',
      servers: [KemlockServer(url: 'https://kem.example.co', role: KemlockServer.home)],
      deviceId: 'device',
    ),
  );

  @override
  Future<T> withAccount<T>(Future<T> Function(KmConnection connection, KmAccount account) action) {
    asked++;
    return reply.future.then((read) => read as T);
  }
}

const _field = KmFieldDefinition(id: '7d0f', name: 'Employee ID', kind: CustomFieldKind.text);

void main() {
  late CoreService core;
  late _Sync sync;

  setUp(() async {
    core = await startCore(MemoryArea());
    await core.call('createVault', [password]);
    sync = _Sync(core.vault);
  });

  test('none are offered without Kemlock Server, and people may add their own', () async {
    final defs = CustomFieldDefs(core.sync);
    expect(await defs.read(), {'fields': <Object?>[], 'allowOwn': true});
  });

  test('are read once for the session, and again when asked or after a run', () async {
    final defs = CustomFieldDefs(sync);
    sync.reply.complete(const KmCustomFields(fields: [_field], allowOwn: false));
    final first = await defs.read();
    expect(first['allowOwn'], isFalse);
    expect((first['fields']! as List<Object?>).single, containsPair('name', 'Employee ID'));
    await defs.read();
    expect(sync.asked, 1);
    defs.invalidate();
    await defs.read();
    expect(sync.asked, 2);
    await defs.read(refresh: true);
    expect(sync.asked, 3);
  });

  test('a read that began before the vault locked is not kept for the next vault', () async {
    final defs = CustomFieldDefs(sync);
    final reading = defs.read();
    defs.unload();
    sync.reply.complete(const KmCustomFields(fields: [_field]));
    await reading;
    // Asked again, it reads again: nothing of the read that was under way was kept
    await defs.read();
    expect(sync.asked, 2);
  });
}
