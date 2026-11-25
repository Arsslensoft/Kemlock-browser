// Sends in the browser (docs/plans/add-sends.md): the owner's list, making, editing and deleting over Kemlock Server's Send routes, and
// opening a Send from its link as a recipient, all through Kemlock-core's own `SendsService` and `SendsRecipient`, which the app's
// Sends use too. Nothing here is a format: the core seals, wraps and proves, and this turns what it gives into JSON for the pages.
//
// - Sends live on Kemlock Server only. Any other place (a WebDAV folder, Vaultwarden) or none answers `available: false`, naming it,
//   and the pages say so where Sends would be. Opening a link needs no place at all.
// - A link, the key in it and the password never leave the core except as the link the background copies through the clipboard
//   (`sendsLink`). A file's bytes cross in chunks, since a message is JSON: the page stages a file to make a Send in pieces, and reads
//   a received file in pieces.
// - Every call answers a result, `{ok: true, value}` or `{ok: false, problem, ...}`, so the pages get the server's own words (a policy's
//   reason, the biggest file, the wait after too many tries) with no secret in them. What isn't a Send's failure (a locked vault) throws.
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:kemlock_core/crypto/account/encoding.dart' show CorruptedException, MalformedException, b64urlEncode, wipe;
import 'package:kemlock_core/crypto/bytes.dart' show randomBytes;
import 'package:kemlock_core/features/sends/send_link.dart';
import 'package:kemlock_core/features/sends/sends_recipient.dart';
import 'package:kemlock_core/features/sends/sends_rules.dart';
import 'package:kemlock_core/features/sends/sends_service.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_failover.dart';
import 'package:kemlock_core/features/sync/kemlock/km_sends_api.dart';

import 'failure.dart';
import 'sync_service.dart';
import 'vault_service.dart';

/// The methods the TypeScript `CoreApi` has for Sends, by name (src/shared/api.ts, src/background/core/bridge.ts).
const sendsMethods = {
  'sendsList',
  'sendsGet',
  'sendsLink',
  'sendsStageFile',
  'sendsMake',
  'sendsUpdate',
  'sendsDelete',
  'sendsOpen',
  'sendsDownload',
  'sendsReadFile',
  'sendsReceivedText',
  'sendsClose',
};

/// How many bytes of a file cross to or from a page in one call (before base64).
const sendsChunkBytes = 1024 * 1024;

/// A Send's status as the pages name it.
String _statusName(SendStatus status) => status.name;

Map<String, Object?> _ok([Object? value]) => {'ok': true, 'value': value};

Map<String, Object?> _failed(String problem, [Map<String, Object?> more = const {}]) => {'ok': false, 'problem': problem, ...more};

/// The room the server's own words get in an answer: they are shown as text, and a longer one is cut.
String? _words(String? text) {
  if (text == null) return null;
  final trimmed = text.replaceAll(RegExp(r'[\x00-\x1f\x7f]'), ' ').trim();
  if (trimmed.isEmpty) return null;
  return trimmed.length > 300 ? trimmed.substring(0, 300) : trimmed;
}

/// Sends for the open vault.
class SendsApi {
  SendsApi(this._vault, this._sync, {this.fileLimit = sendFileLimit});

  final VaultService _vault;
  final SyncService _sync;

  /// The largest file a Send is made from.
  final int fileLimit;

  // Files being staged for new Sends, and Sends being received, each under a handle only the tab that started it was given: two
  // Sends tabs never meet each other's file or Send. Insertion order is age, and the oldest goes when there are too many.
  final _stagings = <String, _Staging>{};
  final _opens = <String, _Open>{};

  /// The most files that may be staged, and Sends that may be open, at once.
  static const _most = 4;

  /// The vault locks, or is removed: every Send being received, every file held and every file staged go, zeroed.
  void unload() {
    for (final handle in _opens.keys.toList()) {
      _closeOpen(handle);
    }
    for (final handle in _stagings.keys.toList()) {
      _dropStaging(handle);
    }
  }

  String _newHandle() => b64urlEncode(randomBytes(16));

  void _dropStaging(String handle) => _stagings.remove(handle)?.dispose();

  void _closeOpen(String handle) => _opens.remove(handle)?.dispose();

  _Staging _staging(String handle) => _stagings[handle] ?? (throw const _Refused('lost'));

  _Open _openOf(String handle) => _opens[handle] ?? (throw const _Refused('lost'));

  // ─── Calls ────────────────────────────────────────────────────────────

  /// Answers [method] with [args], the JSON values `CoreApi`'s method takes in order.
  Future<Object?> call(String method, List<Object?> args) async {
    _vault.requireSession();
    switch (method) {
      case 'sendsList':
        return _guard(_list);
      case 'sendsGet':
        return _guard(() => _get(_string(args, 0)));
      case 'sendsLink':
        return _guard(() => _link(_string(args, 0)));
      case 'sendsStageFile':
        return _guard(() async => _stage(_string(args, 0), args.length > 1 && args[1] is String ? args[1]! as String : null));
      case 'sendsMake':
        return _guard(() => _make(_object(args, 0)));
      case 'sendsUpdate':
        return _guard(() => _update(_string(args, 0), _object(args, 1)));
      case 'sendsDelete':
        return _guard(() => _delete(_string(args, 0)));
      case 'sendsOpen':
        return _guard(() => _open(_string(args, 0), args.length > 1 && args[1] is String ? args[1]! as String : null));
      case 'sendsDownload':
        return _guard(() => _download(_string(args, 0)));
      case 'sendsReadFile':
        return _readFile(_string(args, 0), _int(args, 1));
      case 'sendsReceivedText':
        return _receivedText(_string(args, 0));
      case 'sendsClose':
        _dropStaging(_string(args, 0));
        _closeOpen(_string(args, 0));
        return null;
    }
    throw CoreFailure(CoreFailure.invalid, 'no such method: $method');
  }

  String _string(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  int _int(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! int) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not a whole number');
    return value;
  }

  Map<String, Object?> _object(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! Map<String, Object?>) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not an object');
    return value;
  }

  /// Runs [run] to a result: its value, or the Send problem it failed with.
  Future<Map<String, Object?>> _guard(Future<Object?> Function() run) async {
    try {
      return _ok(await run());
    } on _NoSync catch (e) {
      return _failed('noSync', {'place': e.place});
    } on _Refused catch (e) {
      return _failed(e.problem);
    } on SendsInvalidInput catch (e) {
      return _failed('invalid', {'reason': e.reason.name});
    } on SendsUploadFailed {
      return _failed('upload');
    } on SendsDoesntOpen {
      return _failed('doesntOpen');
    } on SendsFileTooBig catch (e) {
      return _failed('tooBig', {'size': e.size});
    } on SendsError catch (e) {
      return switch (e.problem) {
        SendsProblem.passwordRequired => _failed('passwordRequired'),
        SendsProblem.wrongPassword => _failed('wrongPassword'),
        SendsProblem.policy => _failed('policy', {'detail': ?_words(e.detail)}),
        SendsProblem.fileTooLarge => _failed('tooLarge', {'maxSize': ?e.maxSize}),
        SendsProblem.storage => _failed('storage'),
        SendsProblem.notFound => _failed('notFound'),
        SendsProblem.rateLimited => _failed('rateLimited', {'seconds': sendsWaitSeconds(e.retryAfter)}),
        _ => _failed('server'),
      };
    } on KmHomeAway catch (e) {
      return _failed('away', {'since': e.since.millisecondsSinceEpoch});
    } on KmError catch (e) {
      return switch (e.problem) {
        KmProblem.sessionEnded => _failed('sessionEnded'),
        KmProblem.network => _failed('network'),
        KmProblem.insecure => _failed('insecure'),
        KmProblem.rateLimited => _failed('rateLimited', {'seconds': sendsWaitSeconds(e.retryAfter)}),
        KmProblem.tooLarge => _failed('tooLarge', {'maxSize': ?e.maxSize}),
        _ => _failed('server'),
      };
    } on http.ClientException {
      return _failed('network');
    } on CorruptedException {
      return _failed('server');
    } on MalformedException {
      return _failed('server');
    } on FormatException {
      return _failed('server');
    }
  }

  /// The service for the Kemlock Server the vault syncs with; throws [_NoSync] when it syncs with another place or none.
  SendsService _service() {
    final place = _sync.kemlockPlace;
    if (place == null) throw _NoSync(_sync.syncPlace);
    return SendsService(host: place.host, target: place.target, clock: _vault.platform.clock);
  }

  // ─── The owner's Sends ────────────────────────────────────────────────

  Map<String, Object?> _viewOf(OwnedSend owned) {
    final send = owned.send;
    return {
      'id': send.id,
      'kind': send.kind,
      'readable': owned.readable,
      'name': ?owned.meta?.name,
      'status': _statusName(owned.status),
      'accessCount': send.accessCount,
      'maxAccess': ?send.maxAccess,
      'deletionAt': send.deletionAt.millisecondsSinceEpoch,
      'expiresAt': ?send.expiresAt?.millisecondsSinceEpoch,
      'disabled': send.disabled,
      'hasPassword': send.hasPassword,
      'hideEmail': send.hideEmail,
    };
  }

  Map<String, Object?> _foreignView(ForeignSend foreign) {
    final send = foreign.send;
    return {
      'id': send.id,
      'kind': send.kind,
      'status': _statusName(foreign.status),
      'accessCount': send.accessCount,
      'maxAccess': ?send.maxAccess,
      'deletionAt': send.deletionAt.millisecondsSinceEpoch,
      'expiresAt': ?send.expiresAt?.millisecondsSinceEpoch,
      'disabled': send.disabled,
    };
  }

  Future<Object?> _list() async {
    final place = _sync.kemlockPlace;
    if (place == null) return {'available': false, 'place': _sync.syncPlace};
    final listing = await _service().listing();
    return {
      'available': true,
      'sends': [for (final owned in listing.owned) _viewOf(owned)],
      'foreign': [for (final foreign in listing.foreign) _foreignView(foreign)],
    };
  }

  /// The Send [id] as the owner's list has it. Not there is `notFound`.
  Future<OwnedSend> _find(SendsService service, String id) async {
    for (final owned in await service.list()) {
      if (owned.send.id == id) return owned;
    }
    throw const SendsError(SendsProblem.notFound);
  }

  Future<Object?> _get(String id) async {
    final service = _service();
    final owned = await _find(service, id);
    final view = _viewOf(owned);
    if (!owned.readable) return view;
    final text = owned.isFile ? null : (await service.view(owned)).text;
    return {...view, 'notes': owned.meta!.notes, 'text': ?text};
  }

  /// The Send's link, rebuilt from its sealed key. It goes to the clipboard in the background and nowhere else.
  Future<Object?> _link(String id) async {
    final service = _service();
    final owned = await _find(service, id);
    if (!owned.readable) throw const SendsError(SendsProblem.notFound);
    return service.linkOf(owned);
  }

  // ─── Making ───────────────────────────────────────────────────────────

  /// Adds a piece of a file for a new Send: to the file under [handle], or, with none, to a new one. Answers the handle and how many bytes are
  /// staged. A handle the core doesn't know (the worker stopped meanwhile) is `lost`.
  Object? _stage(String chunk, String? handle) {
    final bytes = base64Decode(chunk);
    final String id;
    final _Staging staging;
    if (handle == null) {
      while (_stagings.length >= _most) {
        _dropStaging(_stagings.keys.first);
      }
      id = _newHandle();
      staging = _stagings[id] = _Staging();
    } else {
      id = handle;
      staging = _staging(handle);
    }
    if (staging.length + bytes.length > fileLimit) {
      wipe(bytes);
      _dropStaging(id);
      throw const SendsInvalidInput(SendsInvalid.fileTooBig);
    }
    staging.add(bytes);
    return {'handle': id, 'length': staging.length};
  }

  DateTime? _time(Object? ms) => ms is int ? DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true) : null;

  Future<Object?> _make(Map<String, Object?> input) async {
    final name = input['name'];
    final notes = input['notes'];
    final days = input['deleteInDays'];
    if (name is! String || notes is! String || days is! int) {
      throw const CoreFailure(CoreFailure.invalid, 'a Send needs its name, notes and days');
    }
    final password = input['password'];
    final maxAccess = input['maxAccess'];
    final hideEmail = input['hideEmail'] == true;
    final expiresAt = _time(input['expiresAt']);
    final NewSend send;
    Uint8List? file;
    final handle = input['handle'];
    if (input['kind'] == 'file') {
      final mime = input['mime'];
      final size = input['size'];
      if (handle is! String || size is! int) throw const CoreFailure(CoreFailure.invalid, 'a file Send needs its staged file and its size');
      final staging = _staging(handle);
      // Pieces missing or added since the page counted them: the file is not the one it chose
      if (staging.length != size || size == 0) {
        _dropStaging(handle);
        throw const _Refused('lost');
      }
      file = staging.assemble();
      _dropStaging(handle);
      send = NewSend.file(
        name: name,
        bytes: file,
        mime: mime is String && mime.isNotEmpty ? mime : 'application/octet-stream',
        notes: notes,
        deleteInDays: days,
        expiresAt: expiresAt,
        maxAccess: maxAccess is int ? maxAccess : null,
        password: password is String ? password : null,
        hideEmail: hideEmail,
      );
    } else {
      final text = input['text'];
      if (text is! String) throw const CoreFailure(CoreFailure.invalid, 'a text Send needs its text');
      if (handle is String) _dropStaging(handle);
      send = NewSend.text(
        name: name,
        text: text,
        notes: notes,
        deleteInDays: days,
        expiresAt: expiresAt,
        maxAccess: maxAccess is int ? maxAccess : null,
        password: password is String ? password : null,
        hideEmail: hideEmail,
      );
    }
    try {
      final made = await _service().make(send);
      return {'id': made.send.id, 'link': made.link};
    } finally {
      if (file != null) wipe(file);
    }
  }

  // ─── Editing and deleting ─────────────────────────────────────────────

  /// Changes the fields of [patch] and keeps the others as the Send has them: the server takes every option again on an edit. A key
  /// that is there with `null` is "none" (`expiresAt`, `maxAccess`); one that isn't there is "as it is".
  Future<Object?> _update(String id, Map<String, Object?> patch) async {
    final service = _service();
    final owned = await _find(service, id);
    final meta = owned.meta;
    if (meta == null) throw const SendsError(SendsProblem.notFound);
    final send = owned.send;
    final text = patch['text'];
    final newPassword = patch['newPassword'];
    final deletionAt = patch['deletionAt'];
    final edit = SendEdit(
      name: patch['name'] is String ? patch['name']! as String : meta.name,
      notes: patch['notes'] is String ? patch['notes']! as String : meta.notes,
      text: text is String && !owned.isFile ? text : null,
      deletionAt: deletionAt is int ? _time(deletionAt)! : send.deletionAt,
      expiresAt: patch.containsKey('expiresAt') ? _time(patch['expiresAt']) : send.expiresAt,
      maxAccess: patch.containsKey('maxAccess') ? (patch['maxAccess'] is int ? patch['maxAccess']! as int : null) : send.maxAccess,
      hideEmail: patch['hideEmail'] is bool ? patch['hideEmail']! as bool : send.hideEmail,
      disabled: patch['disabled'] is bool ? patch['disabled']! as bool : send.disabled,
      newPassword: newPassword is String ? newPassword : null,
      removePassword: patch['removePassword'] == true,
    );
    await service.update(owned, edit);
    return null;
  }

  Future<Object?> _delete(String id) async {
    await _service().deleteById(id);
    return null;
  }

  // ─── Receiving ────────────────────────────────────────────────────────

  /// Opens the Send [text] holds a link to, with the [password] when it has one. Needs no account: the public routes take none.
  Future<Object?> _open(String text, String? password) async {
    final parsed = SendLink.parse(text.trim());
    if (parsed == null) throw const _Refused('badLink');
    if (parsed is! SendLink) throw const _Refused('bitwarden');
    final recipient = SendsRecipient(clientFor: _vault.platform.clientFor);
    final ReceivedSend received;
    try {
      received = await recipient.open(parsed, password: password);
    } catch (_) {
      parsed.wipeKey();
      rethrow;
    }
    while (_opens.length >= _most) {
      _closeOpen(_opens.keys.first);
    }
    final handle = _newHandle();
    _opens[handle] = _Open(recipient, received);
    final payload = received.payload;
    return {
      'handle': handle,
      'kind': payload.kind,
      'name': payload.name,
      'text': ?payload.text,
      'mime': ?payload.mime,
      'size': ?payload.size,
      'tooBig': received.tooBig,
      'expiresAt': ?received.expiresAt?.millisecondsSinceEpoch,
      'deletionAt': received.deletionAt.millisecondsSinceEpoch,
      'senderEmail': ?received.senderEmail,
      'host': received.link.host,
    };
  }

  /// The received file Send's bytes: fetched and opened once, which spends an open, and held until the Send is closed.
  Future<Object?> _download(String handle) async {
    final open = _openOf(handle);
    final held = open.file;
    if (held != null) return {'size': held.length};
    final bytes = await open.recipient.download(open.received);
    // The Send may have been closed (or the vault locked) while the file came: nothing holds these bytes then
    if (!identical(_opens[handle], open)) {
      wipe(bytes);
      throw const _Refused('lost');
    }
    open.file = bytes;
    return {'size': bytes.length};
  }

  /// A piece of the received file, base64, from [index] times [sendsChunkBytes]; empty past its end.
  String _readFile(String handle, int index) {
    final file = _opens[handle]?.file;
    if (file == null) throw const CoreFailure(CoreFailure.notFound, 'no file was downloaded');
    final start = index * sendsChunkBytes;
    if (index < 0 || start >= file.length) return '';
    final end = start + sendsChunkBytes < file.length ? start + sendsChunkBytes : file.length;
    return base64Encode(Uint8List.sublistView(file, start, end));
  }

  String _receivedText(String handle) {
    final text = _opens[handle]?.received.payload.text;
    if (text == null) throw const CoreFailure(CoreFailure.notFound, 'no text Send is open');
    return text;
  }
}

/// A file being staged for a new Send: the pieces the page gave, each kept apart so each can be zeroed.
class _Staging {
  final _pieces = <Uint8List>[];
  var length = 0;

  void add(Uint8List piece) {
    _pieces.add(piece);
    length += piece.length;
  }

  /// The file whole, a copy for the Send to be made from. The pieces stay until [dispose].
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

/// A Send a recipient opened, and its file once it was downloaded.
class _Open {
  _Open(this.recipient, this.received);

  final SendsRecipient recipient;
  final ReceivedSend received;
  Uint8List? file;

  void dispose() {
    received.dispose();
    final held = file;
    if (held != null) wipe(held);
    file = null;
  }
}

/// The vault syncs with no Kemlock Server: [place] is where it syncs instead (`webdav`, `vaultwarden`), or null for nowhere.
class _NoSync implements Exception {
  const _NoSync(this.place);

  final String? place;
}

/// A refusal before any request, as a [SendsApi] problem.
class _Refused implements Exception {
  const _Refused(this.problem);

  final String problem;
}
