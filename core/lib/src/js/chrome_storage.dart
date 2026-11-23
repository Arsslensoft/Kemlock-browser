// `storage.local` for the core (design decision 6): string values under the app's `backmycodes_*` keys, nothing else read.
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import '../storage_area.dart';
import 'globals.dart';

/// One of the extension's storage areas.
class ChromeStorageArea implements StorageArea {
  ChromeStorageArea(this._area);

  /// `storage.local`.
  factory ChromeStorageArea.local() =>
      ChromeStorageArea(extensionApi().getProperty<JSObject>('storage'.toJS).getProperty<JSObject>('local'.toJS));

  final JSObject _area;

  @override
  Future<Map<String, String>> readAll() async {
    final all = await _area.callMethod<JSPromise<JSAny?>>('get'.toJS, null).toDart;
    final values = all.dartify();
    return {
      if (values is Map<Object?, Object?>)
        for (final MapEntry(:key, :value) in values.entries)
          if (key is String && value is String) key: value,
    };
  }

  @override
  Future<void> write(String key, String value) async {
    await _area.callMethod<JSPromise<JSAny?>>('set'.toJS, {key: value}.jsify()).toDart;
  }

  @override
  Future<void> delete(String key) async {
    await _area.callMethod<JSPromise<JSAny?>>('remove'.toJS, key.toJS).toDart;
  }
}
