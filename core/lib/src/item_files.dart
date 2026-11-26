// Files of items in the browser (docs/plans/add-item-format.md): File items and the files attached to secure notes. They work only with
// Kemlock Server sync: a file is chosen in the files tab and staged here in pieces, sealed as `KMA1` under its own key, held in memory
// while the sync's run uploads it, and fetched back on demand, a piece at a time, when the person opens it. No file's bytes are kept
// on disk, and no file's key leaves the core.
//
// - An item the server holds already gets its new file first: the sealed bytes go up under the item, and only then does the vault
//   name the file (and the run writes the item and deletes the file it replaces, last). A file that does not go up changes nothing,
//   so a replaced file is never lost with it.
// - An item the server does not hold yet (a new File item) is saved first, without a server file, and written with its file by
//   `KmHost.pushEntry` (a space's, by the run); a file the item does not name afterwards is taken out of it again and the call
//   fails: an item never names a file nobody holds.
// - What the vault is told to remember while that happens (`keyExtensionPendingFiles`) lets a run that has merged, when the worker
//   was stopped meanwhile, take out the entry of a file that never went up.
// - A removed attachment or a deleted File item is deleted on the server by the core's own run.
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/crypto/account/encoding.dart' show CorruptedException, MalformedException, b64urlEncode, wipe;
import 'package:kemlock_core/crypto/bytes.dart' show randomBytes;
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_cache.dart' show KmCache;
import 'package:kemlock_core/features/sync/kemlock/km_failover.dart';
import 'package:kemlock_core/features/sync/kemlock/km_files.dart';
import 'package:kemlock_core/features/sync/kemlock/km_kinds.dart' show KmEntry, KmKind;
import 'package:kemlock_core/features/sync/kemlock/km_session.dart' show keyKemlockCache;
import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/json.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_entry.dart';
import 'package:kemlock_core/models/vault_file.dart';
import 'package:kemlock_core/vault/attachment_seal.dart';
import 'package:kemlock_core/vault/item_links.dart' show linkIdOf;

import 'failure.dart';
import 'item_extras.dart';
import 'item_views.dart';
import 'spaces_service.dart' show spaceCacheKey;
import 'sync_service.dart';
import 'vault_service.dart';

/// The methods the TypeScript `CoreApi` has for item files, by name (src/shared/api.ts, src/background/core/bridge.ts).
const itemFilesMethods = {
  'files',
  'revealFile',
  'saveFile',
  'deleteFile',
  'stageItemFile',
  'releaseStaged',
  'addAttachments',
  'removeAttachment',
  'openItemFile',
  'readOpened',
  'closeOpened',
};

/// How many bytes of a file cross to or from a page in one call (before base64).
const itemFileChunkBytes = 1024 * 1024;

/// The most files that may be staged, and files that may be open, at once.
const _most = 4;

/// The files waiting to go up, as the sync's run asks for them: the sealed bytes of each, in memory only, by attachment id. The run
/// calls [readSealed] only for a file it must upload. A browser keeps no file: the hosts that use this store are told not to fetch
/// the files they lack (`fetchMissing: false`; they are opened on demand), and [writeSealed] keeps nothing.
///
/// What is held is the sealed `KMA1` ciphertext, which is not secret, and a run may still be sending it when its entry is dropped, so
/// nothing is zeroed here: the reference is let go (the staged and opened plain bytes are zeroed, where they are held).
class PendingFiles implements KmFileStore {
  final _sealed = <String, Uint8List>{};

  /// Whether the bytes of the file [id] are held (an upload is under way).
  bool holds(String id) => _sealed.containsKey(id);

  void put(String id, Uint8List sealed) => _sealed[id] = sealed;

  /// Forgets the file [id].
  void drop(String id) => _sealed.remove(id);

  /// Forgets every file.
  void clear() => _sealed.clear();

  @override
  Future<bool> exists(String id) async => false;

  @override
  Future<Uint8List?> readSealed(String id) async => _sealed[id];

  @override
  Future<void> writeSealed(String id, Uint8List sealed) async {}
}

/// A file being staged: the pieces the page gave, each kept apart so each can be zeroed.
class _Staging {
  final _pieces = <Uint8List>[];
  var length = 0;

  void add(Uint8List piece) {
    _pieces.add(piece);
    length += piece.length;
  }

  Uint8List assemble() {
    final file = Uint8List(length);
    var at = 0;
    for (final piece in _pieces) {
      file.setRange(at, at + piece.length, piece);
      at += piece.length;
    }
    return file;
  }

  void dispose() {
    for (final piece in _pieces) {
      wipe(piece);
    }
    _pieces.clear();
    length = 0;
  }
}

/// A file opened for reading, whole, until it is closed.
class _Opened {
  _Opened(this.bytes);

  final Uint8List bytes;

  void dispose() => wipe(bytes);
}

/// What the call wants to put in an item: a file staged under [handle], and what it is called.
typedef _Chosen = ({String handle, String name, String? type});

/// Item files for the open vault.
class ItemFiles {
  ItemFiles(this._vault, this._sync);

  final VaultService _vault;
  final SyncService _sync;

  final _staged = <String, _Staging>{};
  final _opened = <String, _Opened>{};

  /// The files waiting for a run (the sync's file store).
  PendingFiles get pending => _sync.pendingFiles;

  var _tail = Future<void>.value();

  /// Runs [work] after every upload queued before it: the pending record and the item are changed by one upload at a time.
  Future<T> _serially<T>(Future<T> Function() work) {
    final run = _tail.then((_) => work());
    _tail = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }

  /// The vault locks, or is removed: every file staged, open or waiting goes, zeroed.
  void unload() {
    for (final handle in _staged.keys.toList()) {
      _dropStaged(handle);
    }
    for (final handle in _opened.keys.toList()) {
      _closeOpened(handle);
    }
    pending.clear();
  }

  String _newHandle() => b64urlEncode(randomBytes(16));

  void _dropStaged(String handle) => _staged.remove(handle)?.dispose();

  void _closeOpened(String handle) => _opened.remove(handle)?.dispose();

  // ─── Calls ────────────────────────────────────────────────────────────

  /// Answers [method] with [args], the JSON values `CoreApi`'s method takes in order.
  Future<Object?> call(String method, List<Object?> args) async {
    // Letting go of a file needs no session: a lock has let go of every file already, and a page may close one after it
    switch (method) {
      case 'releaseStaged':
        _dropStaged(_string(args, 0));
        return null;
      case 'closeOpened':
        _closeOpened(_string(args, 0));
        return null;
    }
    _vault.requireSession();
    switch (method) {
      case 'files':
        return files();
      case 'revealFile':
        return revealFile(_string(args, 0));
      case 'saveFile':
        return saveFile(args.isNotEmpty ? _optionalString(args, 0) : null, _object(args, 1));
      case 'deleteFile':
        await deleteFile(_string(args, 0));
        return null;
      case 'stageItemFile':
        return stage(_string(args, 0), _optionalString(args, 1));
      case 'addAttachments':
        return addAttachments(_string(args, 0), args.length > 1 ? args[1] : null);
      case 'removeAttachment':
        return removeAttachment(_string(args, 0), _string(args, 1));
      case 'openItemFile':
        return openItemFile(parseRef(args.isNotEmpty ? args[0] : null), _optionalString(args, 1));
      case 'readOpened':
        return readOpened(_string(args, 0), _int(args, 1));
    }
    throw CoreFailure(CoreFailure.invalid, 'no such method: $method');
  }

  String _string(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  String? _optionalString(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value == null) return null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  int _int(List<Object?> args, int at) {
    final value = at < args.length ? asInt(args[at]) : null;
    if (value == null) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not a whole number');
    return value;
  }

  Map<String, Object?> _object(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! Map<String, Object?>) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not an object');
    return value;
  }

  /// Files need Kemlock Server: another place or none is `unavailable`.
  void _requireKemlock() {
    if (_sync.kemlockPlace == null) throw const CoreFailure(CoreFailure.unavailable, 'files need Kemlock Server sync');
  }

  /// An item of a WebDAV space has no server to hold its files: `unavailable`. The vault's own items and a Kemlock Server space's go.
  void _requireFilesIn(String? space) {
    if (!_sync.spaces.carriesFiles(space)) throw const CoreFailure(CoreFailure.unavailable, 'files need Kemlock Server sync');
  }

  // ─── Staging ──────────────────────────────────────────────────────────

  /// Adds a piece of a file: to the file under [handle], or, with none, to a new one. Answers the handle and how many bytes are staged.
  /// A handle the core doesn't know (the worker stopped meanwhile) is `lost`; a file over 50 MiB is `tooLarge` and dropped.
  Map<String, Object?> stage(String chunk, String? handle) {
    final Uint8List bytes;
    try {
      bytes = base64Decode(chunk);
    } on FormatException {
      throw const CoreFailure(CoreFailure.invalid, 'the piece is not base64');
    }
    if (bytes.length > itemFileChunkBytes) throw const CoreFailure(CoreFailure.invalid, 'a piece is over 1 MiB');
    final String id;
    final _Staging staging;
    if (handle == null) {
      while (_staged.length >= _most) {
        _dropStaged(_staged.keys.first);
      }
      id = _newHandle();
      staging = _staged[id] = _Staging();
    } else {
      id = handle;
      staging = _staged[handle] ?? (throw const CoreFailure(CoreFailure.lost, 'no such staged file'));
    }
    if (staging.length + bytes.length > attachmentSizeLimit) {
      wipe(bytes);
      _dropStaged(id);
      throw const CoreFailure(CoreFailure.tooLarge, 'a file is at most 50 MiB');
    }
    staging.add(bytes);
    return {'handle': id, 'length': staging.length};
  }

  _Chosen _chosen(Object? raw) {
    if (raw is! Map<String, Object?>) throw const CoreFailure(CoreFailure.invalid, 'a file is not an object');
    final handle = raw['handle'];
    final name = raw['name'];
    final type = raw['type'];
    if (handle is! String || name is! String || name.trim().isEmpty || name.length > 255) {
      throw const CoreFailure(CoreFailure.invalid, 'a file needs its handle and its name');
    }
    if (type != null && (type is! String || type.length > 255)) throw const CoreFailure(CoreFailure.invalid, 'a file type is not text');
    return (handle: handle, name: name.trim(), type: type is String && type.isNotEmpty ? type : null);
  }

  /// The staged file [file] names, sealed as `KMA1` under a new key, with the entry that names it. The staged pieces stay until the
  /// file is in its item.
  Future<SealedAttachment> _seal(_Chosen file) async {
    final staging = _staged[file.handle] ?? (throw const CoreFailure(CoreFailure.lost, 'no such staged file'));
    if (staging.length > attachmentSizeLimit) throw const CoreFailure(CoreFailure.tooLarge, 'a file is at most 50 MiB');
    final bytes = staging.assemble();
    try {
      return await sealAttachment(bytes, name: file.name, type: file.type, now: _vault.nowMs);
    } on ArgumentError {
      throw const CoreFailure(CoreFailure.tooLarge, 'a file is at most 50 MiB');
    } finally {
      wipe(bytes);
    }
  }

  // ─── Waiting files ────────────────────────────────────────────────────

  List<Map<String, Object?>> _records(Object? raw) => raw is List<Object?> ? raw.whereType<Map<String, Object?>>().toList() : [];

  Future<List<Map<String, Object?>>> _loadRecords() async =>
      _records(await _vault.vault.loadEncryptedValue(keyExtensionPendingFiles, _vault.requireSession()));

  Future<void> _saveRecords(List<Map<String, Object?>> records) async {
    final session = _vault.requireSession();
    if (records.isEmpty) {
      _vault.vault.removeEncryptedValue(keyExtensionPendingFiles);
    } else {
      await _vault.vault.saveEncryptedValue(keyExtensionPendingFiles, records, session);
    }
    await _vault.store.flush();
  }

  var _recordsTail = Future<void>.value();

  /// Runs [work] after the change of the records queued before it. Held only for a read and a write of the records, never across a
  /// sync, so a run that settles files while an upload waits for it can't wait for each other.
  Future<T> _onRecords<T>(Future<T> Function() work) {
    final run = _recordsTail.then((_) => work());
    _recordsTail = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }

  Future<void> _remember(List<Map<String, Object?>> added) => _onRecords(() async => _saveRecords([...await _loadRecords(), ...added]));

  Future<void> _forget(Iterable<String> fileIds) => _onRecords(() async {
    final gone = fileIds.toSet();
    final records = await _loadRecords();
    final left = [
      for (final record in records)
        if (!gone.contains(record['file'])) record,
    ];
    if (left.length != records.length) await _saveRecords(left);
  });

  /// Takes out of the vault the entry of every file that was to go up and never did, when the worker stopped meanwhile: one the
  /// vault names with no server file and whose bytes are no longer held. A new File item goes; a replaced file is put back; an
  /// attachment is removed. Run once a run has merged, never before it: a file the server already names comes into the vault with the
  /// merge, and is then not unnamed any more. It never waits for an upload: a file whose bytes are held is an upload under way, and is
  /// left alone.
  Future<void> settle() async {
    if (_vault.session == null) return;
    final records = await _loadRecords();
    if (records.isEmpty) return;
    final done = <String>{};
    final notes = <String, Set<String>>{};
    final lostItems = <String>{};
    final restored = <String, NoteAttachment>{};
    final lists = _vault.lists;
    for (final record in records) {
      final fileId = record['file'];
      final itemId = record['item'];
      if (fileId is! String || itemId is! String || pending.holds(fileId)) continue;
      done.add(fileId);
      if (record['kind'] == 'note') {
        final note = lists.notes.where((held) => held.id == itemId).firstOrNull;
        final file = note?.files.where((held) => held.id == fileId).firstOrNull;
        if (note != null && file != null && kmServerFileId(file) == null) (notes[itemId] ??= {}).add(fileId);
      } else {
        final item = lists.files.where((held) => held.id == itemId).firstOrNull;
        if (item == null || item.file.id != fileId || kmServerFileId(item.file) != null) continue;
        final prior = record['prior'];
        if (record['fresh'] == true || prior is! Map<String, Object?>) {
          lostItems.add(itemId);
        } else {
          restored[itemId] = NoteAttachment.fromJson(prior);
        }
      }
    }
    if (notes.isNotEmpty || lostItems.isNotEmpty || restored.isNotEmpty) {
      await _vault.saveChanged(
        (held) => Lists(
          accounts: held.accounts,
          backupServices: held.backupServices,
          keys: held.keys,
          notes: [for (final note in held.notes) notes.containsKey(note.id) ? _withoutFiles(note, notes[note.id]!) : note],
          passkeys: held.passkeys,
          keyAccounts: held.keyAccounts,
          contacts: held.contacts,
          logins: held.logins,
          cards: held.cards,
          identities: held.identities,
          files: [
            for (final item in held.files)
              if (!lostItems.contains(item.id)) restored.containsKey(item.id) ? item.copyWith(file: restored[item.id]) : item,
          ],
        ),
      );
    }
    await _forget(done);
  }

  SecureNote _withoutFiles(SecureNote note, Set<String> ids) {
    final left = [
      for (final file in note.files)
        if (!ids.contains(file.id)) file,
    ];
    return note.copyWith(attachments: left.isEmpty ? unset : left);
  }

  /// The attachment ids among [ids] that the item [kind] [itemId] doesn't name with a server file (or doesn't hold at all).
  List<String> _unnamed(String kind, String itemId, List<String> ids) {
    final lists = _vault.lists;
    final List<NoteAttachment> held;
    if (kind == 'note') {
      held = lists.notes.where((note) => note.id == itemId).firstOrNull?.files ?? const [];
    } else {
      final item = lists.files.where((file) => file.id == itemId).firstOrNull;
      held = item == null ? const [] : [item.file];
    }
    return [
      for (final id in ids)
        if (held.where((file) => file.id == id && kmServerFileId(file) != null).isEmpty) id,
    ];
  }

  /// Runs the sync so that the files [ids] of the item [kind] [itemId], saved without a server file, go up; a second run when the
  /// first left one (the item was not on the server yet). Answers the ones still not named. What a space's item needs: its run is the
  /// one that writes it and sends its files.
  Future<List<String>> _upload(String kind, String itemId, List<String> ids) async {
    var missing = ids;
    for (var attempt = 0; attempt < 2 && missing.isNotEmpty; attempt++) {
      await _quietSync();
      missing = _unnamed(kind, itemId, ids);
    }
    return missing;
  }

  /// Runs the sync, whatever it ends with but a lock: what it says is read from the items it was to change.
  Future<void> _quietSync() async {
    try {
      await _sync.syncNow();
    } on CoreFailure catch (error) {
      if (error.code == CoreFailure.locked || error.code == CoreFailure.noVault) rethrow;
    } catch (_) {
      // Said by the files that are not named
    }
  }

  /// Whether the server holds the item of [entry] (the cache of its last run says so), so its files can go up before the item names
  /// them. An item of a space is looked up in the space's cache.
  Future<bool> _onServer(VaultEntry<Object?> entry) async {
    final session = _vault.requireSession();
    final space = entry.spaceId;
    final key = space == null || space.isEmpty ? keyKemlockCache : spaceCacheKey(space);
    final cache = KmCache.fromJson(await _vault.vault.loadEncryptedValue(key, session));
    final id = _itemIdOf(entry);
    return (cache.items[id] ?? cache.items[id.toLowerCase()])?.applied ?? false;
  }

  /// The id the server knows [entry] by, for its file routes.
  String _itemIdOf(VaultEntry<Object?> entry) => linkIdOf(entry, account: _vault.accountOwner?.call());

  CoreFailure _failedWith(Object error) => switch (error) {
    final CoreFailure failure => failure,
    KmHomeAway() => const CoreFailure(CoreFailure.failed, 'the server is away'),
    final KmError failure => CoreFailure(CoreFailure.failed, failure.problem.name),
    http.ClientException() => const CoreFailure(CoreFailure.failed, 'no network'),
    _ => CoreFailure(CoreFailure.failed, '$error'),
  };

  /// Uploads the files [entry] names that have no server file and [pending] holds, under the item [itemId], which the server holds.
  /// Answers the entry with the ones that went up named, or null when none did. Nothing in the vault changes.
  Future<KmEntry?> _uploadNow(KmEntry entry, String itemId) async {
    try {
      return await _sync.withAccount(
        (connection, account) => KmFiles(
          store: pending,
          connection: connection,
          server: connection.server,
          fetchMissing: false,
        ).uploadEntryFiles(entry, itemId: itemId, now: _vault.nowMs),
      );
    } on Object catch (error) {
      throw _failedWith(error);
    }
  }

  /// Takes back, best effort, the server files [fileIds] of the item [itemId] that went up and no vault item names.
  Future<void> _discardUploaded(String itemId, Iterable<String> fileIds) async {
    final ids = fileIds.toSet();
    if (ids.isEmpty) return;
    try {
      await _sync.withAccount(
        (connection, account) =>
            KmFiles(store: pending, connection: connection, server: connection.server, fetchMissing: false).discard({itemId: ids}),
      );
    } catch (_) {
      // A file left behind is only bytes the server holds for nothing
    }
  }

  /// Writes the item [kind] [itemId], saved without a server file for the files [ids], to the server with those files, now: by the
  /// host's `pushEntry` for the vault's own item, by the run for an item of a space. Takes the files that went up into the vault, and
  /// answers the ones still not named.
  Future<List<String>> _push(String kind, String itemId, List<String> ids) async {
    final entry = findEntry(_vault.lists, kind, itemId);
    final place = _sync.kemlockPlace;
    if (entry == null || place == null) return ids;
    final space = entry.spaceId;
    if (space != null && space.isNotEmpty) return _upload(kind, itemId, ids);
    final KmEntry sent = (kind: kind == 'note' ? KmKind.note : KmKind.file, json: _jsonOf(entry));
    final Map<String, NoteAttachment> named;
    try {
      final result = await place.host.pushEntry(place.target, sent, now: _vault.nowMs);
      named = {
        for (final file in kmAttachmentsOf(result.entry))
          if (ids.contains(file.id) && kmServerFileId(file) != null) file.id: file,
      };
    } on CoreFailure catch (error) {
      if (error.code == CoreFailure.locked || error.code == CoreFailure.noVault) rethrow;
      return _unnamed(kind, itemId, ids);
    } catch (_) {
      return _unnamed(kind, itemId, ids);
    }
    if (named.isNotEmpty) {
      await _vault.saveChanged((held) {
        final current = findEntry(held, kind, itemId);
        return switch (current) {
          final SecureNote note => listsWithEntry(
            held,
            note.copyWith(attachments: [for (final file in note.files) named[file.id] ?? file]),
          ),
          final VaultFile item when named.containsKey(item.file.id) => listsWithEntry(held, item.copyWith(file: named[item.file.id])),
          _ => held,
        };
      });
    }
    return _unnamed(kind, itemId, ids);
  }

  Map<String, Object?> _jsonOf(VaultEntry<Object?> entry) => switch (entry) {
    final SecureNote note => note.toJson(),
    final VaultFile item => item.toJson(),
    _ => throw const CoreFailure(CoreFailure.invalid, 'this item holds no file'),
  };

  // ─── Notes' attachments ───────────────────────────────────────────────

  SecureNote _note(String id) {
    for (final note in _vault.lists.notes) {
      if (note.id == id) return note;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such note');
  }

  /// Attaches the staged files [raw] (`{handle, name, type?}` each) to the note [noteId]: sealed, uploaded, and named in the note. A
  /// note the server holds gets the files first and names them after; one it does not hold yet is saved with them, written by
  /// `pushEntry`, and has them taken out again when they don't go up. At most 100 files in all. When some went up and some did not,
  /// the answer is the note with `failed`, the handles of the staged files that did not go up (they stay staged until released); when
  /// none did, the call fails (`failed`).
  Future<Map<String, Object?>> addAttachments(String noteId, Object? raw) => _serially(() async {
    _vault.requireSession();
    _requireKemlock();
    if (raw is! List<Object?> || raw.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'no files to attach');
    if (raw.length > attachmentsPerNote) throw const CoreFailure(CoreFailure.tooMany, 'a note holds at most 100 files');
    final chosen = [for (final item in raw) _chosen(item)];
    final note = _note(noteId);
    _vault.editGuard?.call(note.spaceId, noteId);
    _requireFilesIn(note.spaceId);
    if (note.files.length + chosen.length > attachmentsPerNote) {
      throw const CoreFailure(CoreFailure.tooMany, 'a note holds at most 100 files');
    }
    final sealed = <SealedAttachment>[];
    try {
      for (final file in chosen) {
        sealed.add(await _seal(file));
      }
    } catch (_) {
      for (final done in sealed) {
        wipe(done.sealed);
      }
      rethrow;
    }
    final ids = [for (final file in sealed) file.entry.id];
    // The bytes are held before the vault is told of them: an entry listed with its bytes gone is one that never went up
    for (final file in sealed) {
      pending.put(file.entry.id, file.sealed);
    }
    final List<String> missing;
    try {
      missing = await _onServer(note) ? await _attachFirst(note, sealed) : await _attachSaved(noteId, sealed);
    } finally {
      for (final id in ids) {
        pending.drop(id);
      }
      await _forget(ids);
    }
    if (missing.length == ids.length) throw const CoreFailure(CoreFailure.failed, 'a file did not go up');
    final failedHandles = <String>[];
    for (final (i, file) in chosen.indexed) {
      if (missing.contains(ids[i])) {
        failedHandles.add(file.handle);
      } else {
        _dropStaged(file.handle);
      }
    }
    return {..._vault.revealNote(noteId), if (failedHandles.isNotEmpty) 'failed': failedHandles};
  });

  /// The note the server holds: its files go up under it, and only the ones that did are named in it. Answers the ones that did not.
  Future<List<String>> _attachFirst(SecureNote note, List<SealedAttachment> sealed) async {
    final ids = [for (final file in sealed) file.entry.id];
    final itemId = _itemIdOf(note);
    final entry = (kind: KmKind.note, json: note.copyWith(attachments: [...note.files, for (final file in sealed) file.entry]).toJson());
    final named = await _uploadNow(entry, itemId);
    if (named == null) return ids;
    final byId = {for (final file in SecureNote.fromJson(named.json).files) file.id: file};
    final up = [
      for (final id in ids)
        if (byId[id] case final file? when kmServerFileId(file) != null) file,
    ];
    if (up.isEmpty) return ids;
    try {
      await _vault.saveChanged((held) {
        final current = held.notes.where((other) => other.id == note.id).firstOrNull;
        if (current == null) throw const CoreFailure(CoreFailure.notFound, 'no such note');
        final have = {for (final file in current.files) file.id};
        return listsWithEntry(
          held,
          current.copyWith(
            attachments: [
              ...current.files,
              for (final file in up)
                if (!have.contains(file.id)) file,
            ],
          ),
        );
      });
    } catch (_) {
      await _discardUploaded(itemId, [for (final file in up) ?kmServerFileId(file)]);
      rethrow;
    }
    // The run writes the note, which names them now; the files went up already, so a run that does not go through loses nothing
    await _quietSync();
    final upIds = {for (final file in up) file.id};
    return [
      for (final id in ids)
        if (!upIds.contains(id)) id,
    ];
  }

  /// A note the server does not hold yet: saved with the new files, which are written with it. Answers the files not named after.
  Future<List<String>> _attachSaved(String noteId, List<SealedAttachment> sealed) async {
    final ids = [for (final file in sealed) file.entry.id];
    await _remember([
      for (final id in ids) {'item': noteId, 'kind': 'note', 'file': id, 'fresh': false},
    ]);
    await _vault.saveChanged((held) {
      final current = held.notes.where((note) => note.id == noteId).firstOrNull;
      if (current == null) throw const CoreFailure(CoreFailure.notFound, 'no such note');
      return listsWithEntry(held, current.copyWith(attachments: [...current.files, for (final file in sealed) file.entry]));
    });
    final missing = await _push('note', noteId, ids);
    if (missing.isNotEmpty) {
      await _vault.saveChanged((held) {
        final current = held.notes.where((note) => note.id == noteId).firstOrNull;
        return current == null ? held : listsWithEntry(held, _withoutFiles(current, missing.toSet()));
      });
    }
    return missing;
  }

  /// Removes the attachment [attachmentId] from the note [noteId]; the server's file is deleted by the core's own run. It needs
  /// Kemlock Server: where files are read-only the note keeps them, since the server's file could not be deleted.
  Future<Map<String, Object?>> removeAttachment(String noteId, String attachmentId) async {
    _vault.requireSession();
    _requireKemlock();
    final note = _note(noteId);
    _vault.editGuard?.call(note.spaceId, noteId);
    if (!note.files.any((file) => file.id == attachmentId)) throw const CoreFailure(CoreFailure.notFound, 'no such file');
    await _vault.saveChanged((held) {
      final current = held.notes.where((note) => note.id == noteId).firstOrNull;
      return current == null ? held : listsWithEntry(held, _withoutFiles(current, {attachmentId}));
    });
    pending.drop(attachmentId);
    return _vault.revealNote(noteId);
  }

  // ─── File items ───────────────────────────────────────────────────────

  VaultFile _file(String id) {
    for (final file in _vault.lists.files) {
      if (file.id == id) return file;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such file');
  }

  Map<String, Object?>? _spaceOf(VaultFile file) => _vault.spaceNote?.call(file.spaceId, file.id);

  Map<String, Object?> _view(VaultFile file) =>
      fileView(file, order: _vault.lists.files.indexOf(file), links: _vault.linkCount(file.id), space: _spaceOf(file));

  /// The File items, by name only: no file's key, and no text.
  List<Map<String, Object?>> files() {
    _vault.requireSession();
    return [for (final file in _vault.lists.files) _view(file)];
  }

  Map<String, Object?> revealFile(String id) {
    _vault.requireSession();
    final file = _file(id);
    return fileFull(file, order: _vault.lists.files.indexOf(file), links: _vault.linkCount(id), space: _spaceOf(file));
  }

  /// Saves a File item: a new one when [id] is null (it needs a staged file, which needs Kemlock Server), else its name, notes, pin,
  /// tags and links, and its file when a staged one is given (`unavailable` without Kemlock Server). A member the input leaves out, or
  /// leaves as it is, is kept as it is. A file that doesn't go up leaves no trace: a new item is removed again, and a replaced file
  /// stays where it was, on the server and in the item.
  Future<Map<String, Object?>> saveFile(String? id, Map<String, Object?> input) => _serially(() async {
    _vault.requireSession();
    final name = asString(input['name']).trim();
    if (name.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'a file needs a name');
    if (name.length > 2048) throw const CoreFailure(CoreFailure.invalid, 'the name is too long');
    final notesText = asString(input['notes']).trim();
    if (notesText.length > noteTextLimit) throw const CoreFailure(CoreFailure.invalid, 'the notes are too long');
    final tags = asStrings(input['tags']);
    final staged = input['staged'] == null ? null : _chosen(input['staged']);
    if (staged != null) _requireKemlock();
    if (id == null && staged == null) throw const CoreFailure(CoreFailure.invalid, 'a File item needs a file');
    final refs = input.containsKey('links') ? parseRefs(input['links']) : null;
    final current = id == null ? null : _file(id);
    if (current != null) _vault.editGuard?.call(current.spaceId, current.id);
    if (staged != null) _requireFilesIn(current?.spaceId);
    // The edit is made on the item the write holds, never on a copy read before it waited: what a run wrote meanwhile stays
    VaultFile edit(VaultFile held, {NoteAttachment? file}) => held.copyWith(
      name: name == held.name.trim() ? null : name,
      notes: !input.containsKey('notes') || notesText == (held.notes ?? '').trim() ? keep : (notesText.isEmpty ? unset : notesText),
      tags: tags == null ? keep : (tags.isEmpty ? unset : tags),
      pinned: input['pinned'] is bool ? (input['pinned'] == true ? true : unset) : keep,
      file: file,
    );
    final SealedAttachment? sealed = staged == null ? null : await _seal(staged);
    final String savedId;
    if (current == null) {
      final fresh = VaultFile(
        id: newUuid(),
        name: name,
        notes: notesText.isEmpty ? null : notesText,
        file: sealed!.entry,
        tags: tags == null || tags.isEmpty ? null : tags,
        pinned: input['pinned'] == true ? true : null,
        addedAt: _vault.nowMs,
      );
      savedId = fresh.id;
      await _saveFileSaved(fresh, sealed, fresh: true);
    } else if (sealed == null) {
      savedId = current.id;
      await _vault.saveChanged((held) => listsWithFiles(held, [for (final item in held.files) item.id == current.id ? edit(item) : item]));
    } else {
      savedId = current.id;
      if (await _onServer(current)) {
        await _replaceFirst(current, sealed, edit);
      } else {
        await _saveFileSaved(edit(current, file: sealed.entry), sealed, fresh: false, prior: current);
      }
    }
    if (staged != null) _dropStaged(staged.handle);
    final failures = refs == null ? const <String>[] : await _vault.setLinksOf('file', savedId, refs);
    return {..._view(_file(savedId)), if (failures.isNotEmpty) 'linkFailures': failures};
  });

  /// The File item the server holds, with a new file: the file goes up first, and the item names it only then, so a file that does not
  /// go up (too large for the server, the network, a lock) changes nothing, and the file it replaces is deleted by the run, last.
  Future<void> _replaceFirst(
    VaultFile current,
    SealedAttachment sealed,
    VaultFile Function(VaultFile held, {NoteAttachment? file}) edit,
  ) async {
    final fileId = sealed.entry.id;
    pending.put(fileId, sealed.sealed);
    try {
      final itemId = _itemIdOf(current);
      final named = await _uploadNow((kind: KmKind.file, json: edit(current, file: sealed.entry).toJson()), itemId);
      final up = named == null ? null : VaultFile.fromJson(named.json).file;
      final serverId = up == null ? null : kmServerFileId(up);
      if (up == null || serverId == null) throw const CoreFailure(CoreFailure.failed, 'the file did not go up');
      try {
        await _vault.saveChanged((held) {
          if (!held.files.any((item) => item.id == current.id)) throw const CoreFailure(CoreFailure.notFound, 'no such file');
          return listsWithFiles(held, [for (final item in held.files) item.id == current.id ? edit(item, file: up) : item]);
        });
      } catch (_) {
        await _discardUploaded(itemId, [serverId]);
        rethrow;
      }
      // The run writes the item naming the new file and deletes the old one last; the new one is on the server already
      await _quietSync();
    } finally {
      pending.drop(fileId);
    }
  }

  /// A File item the server does not hold yet (a new one, or one no run has written): saved with its file unnamed, then written with
  /// the file by `pushEntry`. A file that does not go up takes a new item out again, and puts a replaced file back.
  Future<void> _saveFileSaved(VaultFile saved, SealedAttachment sealed, {required bool fresh, VaultFile? prior}) async {
    final fileId = sealed.entry.id;
    pending.put(fileId, sealed.sealed);
    try {
      await _remember([
        {'item': saved.id, 'kind': 'file', 'file': fileId, 'fresh': fresh, if (prior != null) 'prior': prior.file.toJson()},
      ]);
      await _vault.saveChanged(
        (held) => listsWithFiles(held, [
          for (final item in held.files)
            if (item.id != saved.id) item else saved,
          if (fresh) saved,
        ]),
      );
      final missing = await _push('file', saved.id, [fileId]);
      if (missing.isNotEmpty) {
        // Nothing the item names that nobody holds: the new item goes, the old file comes back
        await _vault.saveChanged(
          (held) => listsWithFiles(held, [
            for (final item in held.files)
              if (item.id != saved.id) item else ?prior,
          ]),
        );
        throw const CoreFailure(CoreFailure.failed, 'the file did not go up');
      }
    } finally {
      pending.drop(fileId);
      await _forget([fileId]);
    }
  }

  /// Deletes a File item; the server's file is deleted by the core's own run.
  Future<void> deleteFile(String id) async {
    _vault.requireSession();
    final file = _file(id);
    _vault.editGuard?.call(file.spaceId, id);
    // The links to the File item go in the same write, worked out from the lists the write holds
    await _vault.saveChanged((held) {
      final removed = held.files.where((item) => item.id == id).firstOrNull;
      return removed == null ? held : _vault.withoutEntry(held, removed);
    });
    pending.drop(file.file.id);
  }

  // ─── Opening ──────────────────────────────────────────────────────────

  /// Fetches a file to read it: the attachment [attachmentId] of the note [ref], or the file of the File item [ref]. The bytes come
  /// from the server on demand, are opened with the file's own key and checked, and are held until [closeOpened] or a lock. At most
  /// four are held; the oldest goes.
  Future<Map<String, Object?>> openItemFile(ItemRef ref, String? attachmentId) async {
    _vault.requireSession();
    _requireKemlock();
    final entry = findEntry(_vault.lists, ref.kind, ref.id) ?? (throw const CoreFailure(CoreFailure.notFound, 'no such item'));
    final NoteAttachment file;
    switch (entry) {
      case final SecureNote note:
        final found = note.files.where((held) => held.id == attachmentId).firstOrNull;
        if (found == null) throw const CoreFailure(CoreFailure.notFound, 'no such file');
        file = found;
      case final VaultFile item:
        file = item.file;
      default:
        throw const CoreFailure(CoreFailure.invalid, 'this item holds no file');
    }
    if (kmServerFileId(file) == null) throw const CoreFailure(CoreFailure.failed, 'the file is not on the server');
    final itemId = linkIdOf(entry, account: _vault.accountOwner?.call());
    final Uint8List bytes;
    try {
      bytes = await _sync.withAccount(
        (connection, account) => kmFetchFile(connection: connection, server: connection.server, itemId: itemId, entry: file),
      );
    } on KmFileError catch (error) {
      throw switch (error.problem) {
        KmFileProblem.tooLarge => const CoreFailure(CoreFailure.tooLarge, 'the file is larger than its item says'),
        KmFileProblem.notOnServer => const CoreFailure(CoreFailure.failed, 'the file is not on the server'),
        KmFileProblem.damaged => const CoreFailure(CoreFailure.failed, 'the file is damaged'),
        KmFileProblem.hashMismatch => const CoreFailure(CoreFailure.failed, 'the file is not the one that was saved'),
      };
    } on CoreFailure {
      rethrow;
    } on KmHomeAway {
      throw const CoreFailure(CoreFailure.failed, 'the server is away');
    } on KmError catch (error) {
      throw CoreFailure(CoreFailure.failed, error.problem.name);
    } on http.ClientException {
      throw const CoreFailure(CoreFailure.failed, 'no network');
    } on CorruptedException {
      throw const CoreFailure(CoreFailure.failed, 'the file is damaged');
    } on MalformedException {
      throw const CoreFailure(CoreFailure.failed, 'the file is damaged');
    }
    // The vault may have locked while the file came: nothing holds these bytes then
    if (_vault.session == null) {
      wipe(bytes);
      throw const CoreFailure(CoreFailure.locked);
    }
    while (_opened.length >= _most) {
      _closeOpened(_opened.keys.first);
    }
    final handle = _newHandle();
    _opened[handle] = _Opened(bytes);
    return {'handle': handle, 'size': bytes.length, 'name': file.name, 'type': ?file.type};
  }

  /// A piece of the opened file, base64, from [index] times a megabyte; empty past its end.
  String readOpened(String handle, int index) {
    final held = _opened[handle] ?? (throw const CoreFailure(CoreFailure.lost, 'no such open file'));
    final start = index * itemFileChunkBytes;
    if (index < 0 || start >= held.bytes.length) return '';
    final end = start + itemFileChunkBytes < held.bytes.length ? start + itemFileChunkBytes : held.bytes.length;
    return base64Encode(Uint8List.sublistView(held.bytes, start, end));
  }
}
