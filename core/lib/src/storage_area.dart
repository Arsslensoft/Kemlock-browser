// `storage.local` as the app's preferences (design decision 6): the values are strings exactly as the app's preferences
// hold them, under the same `backmycodes_*` keys, so the vault in the browser is the app's vault.
import 'package:kemlock_core/core/storage/preferences_interface.dart';

/// What the core needs of one of the browser's storage areas. The JavaScript side is js/chrome_storage.dart; tests give a map.
abstract interface class StorageArea {
  /// Every key of the area with its value, as `get(null)` gives them. Only strings are kept: anything else some other
  /// part of the extension stored under another key is not the vault's.
  Future<Map<String, String>> readAll();

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

/// [StorageArea] as the key-value store's backend.
class AreaPreferences implements PreferencesBackend {
  AreaPreferences(this._area);

  final StorageArea _area;

  @override
  Future<Map<String, String>> readAll() => _area.readAll();

  @override
  Future<void> set(String key, String value) => _area.write(key, value);

  @override
  Future<void> remove(String key) => _area.delete(key);
}

/// A [StorageArea] in memory, for tests.
class MemoryArea implements StorageArea {
  MemoryArea([Map<String, String> values = const {}]) : values = {...values};

  final Map<String, String> values;

  @override
  Future<Map<String, String>> readAll() async => {...values};

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}
