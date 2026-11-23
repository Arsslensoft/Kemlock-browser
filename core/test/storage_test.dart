import 'package:kemlock_core/core/storage/key_value_store.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

void main() {
  test('the store reads the app\'s keys and leaves the extension\'s others alone', () async {
    final area = MemoryArea({'backmycodes_vault_config': '{"a":1}', 'kemlock.sessionKey': 'x', 'backmycodes_sync': 'y'});
    final store = await KeyValueStore.open(AreaPreferences(area));
    expect(store.getItem('backmycodes_vault_config'), '{"a":1}');
    expect(store.getItem('kemlock.sessionKey'), isNull);
    expect(store.storedKeys(), unorderedEquals(['backmycodes_vault_config', 'backmycodes_sync']));
  });

  test('a write reaches the area as the string the app writes, and a removal takes it out', () async {
    final area = MemoryArea();
    final store = await KeyValueStore.open(AreaPreferences(area));
    store.setItem('backmycodes_unlock_failures', '{"count":2}');
    await store.flush();
    expect(area.values, {'backmycodes_unlock_failures': '{"count":2}'});
    store.removeItem('backmycodes_unlock_failures');
    await store.flush();
    expect(area.values, isEmpty);
  });
}
