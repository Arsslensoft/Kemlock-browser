// The custom fields an admin offers (docs/custom-fields.md): the definitions Kemlock Server holds, read once for the session and
// again after each sync, and given to the pages as `CustomFieldDefs`. A vault that syncs with no Kemlock Server has none, and
// people may add fields of their own. Names and types are not secret, and nothing here is a format: Kemlock-core reads the answer.
import 'package:kemlock_core/features/sync/kemlock/km_custom_fields.dart';
import 'package:kemlock_core/models/custom_field.dart';

import 'sync_service.dart';

/// The definitions of the open vault's server, as the pages ask for them.
class CustomFieldDefs {
  CustomFieldDefs(this._sync);

  final SyncService _sync;
  KmCustomFields? _held;
  Future<KmCustomFields>? _reading;

  /// Forgets what was read: the next ask reads again (a run may have found the admin changed them).
  void invalidate() {
    _held = null;
  }

  /// Forgets everything, when the vault locks.
  void unload() {
    _held = null;
    _reading = null;
  }

  /// The definitions, as `CustomFieldDefs` in src/shared/api.ts: none, with people allowed their own, when the vault doesn't sync with
  /// Kemlock Server, or when the server can't be asked and none were read before. [refresh] reads them again.
  Future<Map<String, Object?>> read({bool refresh = false}) async {
    if (_sync.kemlockPlace == null) return _view(KmCustomFields.none);
    if (refresh) _held = null;
    final held = _held;
    if (held != null) return _view(held);
    final running = _reading ??= _fetch();
    try {
      return _view(await running);
    } finally {
      _reading = null;
    }
  }

  Future<KmCustomFields> _fetch() async {
    try {
      final read = await _sync.withAccount((connection, account) => fetchKmCustomFields(connection));
      return _held = read;
    } catch (_) {
      // Not asked: the person edits with the fields they have, and the next ask tries again
      return _held ?? KmCustomFields.none;
    }
  }

  Map<String, Object?> _view(KmCustomFields defs) => {
    'fields': [
      for (final field in defs.fields)
        {
          'id': field.id,
          'name': field.name,
          'type': field.kind == CustomFieldKind.boolean ? 'checkbox' : field.kind,
          'kinds': field.kinds ?? 'all',
        },
    ],
    'allowOwn': defs.allowOwn,
  };
}
