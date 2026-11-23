// The 2FA directory, from a copy of 2fa.directory the extension ships (MIT licence inside the data file): the domain each
// service is known under, for a code's websites and for the sites that offer codes. Parsed from the JSON the background hands
// the core; the app's own `two_factor_directory.dart` reads the same file through Flutter's assets.
import 'package:kemlock_core/features/accounts/service_names.dart';

/// One service in the directory.
class DirectoryEntry {
  const DirectoryEntry({required this.name, required this.domain});

  final String name;
  final String domain;

  @override
  String toString() => 'DirectoryEntry($name, $domain)';
}

/// The directory, indexed by the keys of each service's names.
class TwoFactorDirectory {
  TwoFactorDirectory._(this.entries, this._byKey);

  /// Indexes the directory's JSON: rows of `[name, domain, docs or 0, recovery or 0, other names?]`. A key goes to the
  /// first service that has it.
  factory TwoFactorDirectory.fromJson(Map<String, Object?> json) {
    final entries = <DirectoryEntry>[];
    final byKey = <String, DirectoryEntry>{};
    final rows = json['entries'];
    for (final row in rows is List<Object?> ? rows : const <Object?>[]) {
      if (row is! List<Object?> || row.length < 2 || row[0] is! String || row[1] is! String) continue;
      final entry = DirectoryEntry(name: row[0]! as String, domain: row[1]! as String);
      entries.add(entry);
      final more = row.length > 4 && row[4] is List<Object?> ? (row[4]! as List<Object?>).whereType<String>() : const <String>[];
      for (final alias in [entry.name, entry.domain, ...more]) {
        for (final key in keysFor(alias)) {
          byKey.putIfAbsent(key, () => entry);
        }
      }
    }
    return TwoFactorDirectory._(List.unmodifiable(entries), byKey);
  }

  /// Every service, in the data's order.
  final List<DirectoryEntry> entries;

  final Map<String, DirectoryEntry> _byKey;

  /// The directory's entry for a service name, or null when it has none.
  DirectoryEntry? findService(String name) {
    for (final key in keysFor(name)) {
      final entry = _byKey[key];
      if (entry != null) return entry;
    }
    return null;
  }
}
