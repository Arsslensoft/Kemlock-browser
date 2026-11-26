// The part of the sync service that needs its private state, for the account's own flows (docs/plans/add-browser-account.md): making an
// account and signing in with it, opening the account with a Recovery Kit, and the move off Vaultwarden or WebDAV, which runs the app's
// own steps (`KmMoveRunner`) over this browser's vault. The rest of the account's calls only need a connection and live in this folder's
// other files.
part of '../sync_service.dart';

/// What the account's flows hold between calls. It is dropped when the vault locks.
class AccountState {
  /// The sign-in that waits for the person to say whether the vault moves: its target, with the session already sealed.
  KemlockTarget? movePending;

  /// A move that runs now, and the step it is on with how many of its items are done out of how many.
  var moveRunning = false;
  KmMoveStep? moveStep;
  var moveDone = 0;
  var moveTotal = 0;

  /// Why the last run stopped: a [KmMoveIssue]'s name, a [CoreFailure]'s code or a sync problem's name.
  String? moveProblem;

  /// Whether a move has begun and isn't finished, as the sync's status says (it is read from the record when the vault opens and
  /// each time a run is asked for, so the status, which can't wait for a read, has it).
  var moveUnfinished = false;

  void reset() {
    movePending = null;
    moveUnfinished = false;
  }
}

/// Where the session keeps the sign-in held for a move, among the keys it doesn't know: the email and the server's address, from which
/// the target is made again when the core was stopped meanwhile.
const kmMoveHeldKey = 'moveHeld';

/// The files of a vault, of which a browser keeps none: a move refuses a vault whose notes or File items name some, so nothing asks for
/// one.
class _NoFiles implements KmFileStore {
  const _NoFiles();

  @override
  Future<bool> exists(String id) async => false;

  @override
  Future<Uint8List?> readSealed(String id) async => null;

  @override
  Future<void> writeSealed(String id, Uint8List sealed) async {}
}

/// The old store of a move that isn't set up any more, for one resumed after its settings were dropped: its first step is past, so it is
/// never run.
class _GoneSource implements KmMoveSource {
  const _GoneSource(this.record);

  final KmMoveRecord record;

  @override
  String get name => record.source;

  @override
  String get server => record.server;

  @override
  String? get home => record.home;

  @override
  String? get mode => record.mode;

  @override
  Future<KmMoveSynced> sync(Lists local, ScopeState state, {required int now, RemovalChoice? choice}) =>
      throw const CoreFailure('oldStoreGone', 'the old store is no longer set up');
}

/// An old store whose run is a function, for the one the core's own run guards (a WebDAV folder's removal guard and its keep path).
class _RunSource implements KmMoveSource {
  const _RunSource({required this.name, required this.server, required this.run});

  @override
  final String name;

  @override
  final String server;

  final Future<KmMoveSynced> Function(Lists local, ScopeState state, int now) run;

  @override
  String? get home => null;

  @override
  String? get mode => null;

  @override
  Future<KmMoveSynced> sync(Lists local, ScopeState state, {required int now, RemovalChoice? choice}) => run(local, state, now);
}

extension SyncAccount on SyncService {
  // ─── Making an account ──────────────────────────────────────────────

  /// Makes the account, then signs in with its password as any sign-in does, so the steps go on as they do for an account that exists.
  Future<Map<String, Object?>> registerKemlock(Map<String, Object?> input) async {
    _vault.requireSession();
    final refused = addressProblem(input['server']);
    if (refused != null) return _refused(refused);
    final email = ((input['email'] as String?) ?? '').trim();
    final password = (input['password'] as String?) ?? '';
    if (email.isEmpty || password.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'an account needs an email and a password');
    final token = ((input['inviteToken'] as String?) ?? '').trim();
    return _guard(() async {
      _dropPending();
      final server = kmServerUrl(input['server']! as String);
      final client = _vault.platform.clientFor(null);
      try {
        final api = KmApi(client, clock: _clock);
        // A server that isn't a Kemlock Server stops here, before anything is derived from the password
        await api.config(server);
        if (token.isEmpty && !await signupsOpen(api, server)) return {'step': 'error', 'problem': 'signupsClosed'};
        try {
          await registerAccount(
            api: api,
            server: server,
            email: email,
            name: ((input['name'] as String?) ?? '').trim(),
            password: password,
            inviteToken: token.isEmpty ? null : token,
          );
        } on KmError catch (error) {
          final problem = switch (error.status) {
            403 => 'signupsClosed',
            409 => 'accountExists',
            400 || 422 => 'registerRefused',
            _ => null,
          };
          if (problem == null) rethrow;
          return {'step': 'error', 'problem': problem};
        }
      } finally {
        client.close();
      }
      return signInKemlock({'server': input['server'], 'email': email, 'password': password});
    });
  }

  // ─── The Recovery Kit as a way in ───────────────────────────────────

  /// Opens an account that signed in without opening (SSO, or a passkey with no PRF) with two pieces of its Recovery Kit.
  Future<Map<String, Object?>> _openWithKitOf(_PendingKemlock pending, List<String> pieces) async {
    final signed = pending.signed;
    if (signed == null) throw _noStep;
    final session = signed.session;
    final record = await pending.signIn.api.call(
      'GET',
      pending.server,
      '/account/recovery-kit',
      token: session.tokens.access,
      absentIsNull: true,
    );
    if (record == null) return {'step': 'error', 'problem': 'kitNone'};
    if (record['current'] != true) return {'step': 'error', 'problem': 'kitStale'};
    final kitId = record['kitId'];
    final wrapped = record['wrappedKey'];
    final keyVersion = record['keyVersion'];
    if (kitId is! String || wrapped is! String || keyVersion is! int) {
      throw const KmError(KmProblem.server, message: 'a recovery kit record');
    }
    final Uint8List root;
    try {
      root = await openKitRoot(
        pieces: pieces,
        kitId: kitId,
        accountId: uuidBytes(session.userId),
        keyVersion: keyVersion,
        wrapped: b64urlDecode(wrapped),
      );
    } on PieceError catch (error) {
      return {'step': 'error', 'problem': 'kit${error.problem.name[0].toUpperCase()}${error.problem.name.substring(1)}'};
    } on CorruptedException {
      // The pieces are of another kit, or the account's keys changed since: the wrap doesn't open
      return {'step': 'error', 'problem': 'kitWrong'};
    }
    try {
      final account = await pending.signIn.openWithRoot(session, root);
      return await _finishKemlock(pending, session, account);
    } finally {
      wipe(root);
    }
  }

  // ─── Moving off Vaultwarden or WebDAV ───────────────────────────────

  /// What the move would do, for the screen that asks: the old store it comes from, what moves by kind, how many attached files the
  /// notes name, and whether an earlier move stopped part way. Null when there is nothing to move, or the vault moved already.
  Future<Map<String, Object?>?> _moveSummaryOf(KemlockTarget target) async {
    final session = _vault.requireSession();
    final source = kmMoveSourceOf(_settings, target);
    if (source == null) return null;
    final record = await KmMoveStore(SealedValues(_store, session)).load();
    if (record != null && record.isDone) return null;
    final plan = planKmMove(scopeLists(_vault.lists, null), Owner.user(target.accountId));
    return {'source': source.name, 'counts': plan.byKind, 'files': plan.files.length, 'resumed': record != null};
  }

  /// What a sign-in does when the vault syncs with Vaultwarden on this server, or with WebDAV: it holds its session, sealed, and asks the
  /// person before anything moves (the step `move`: what moves and what stays). Null when there is nothing to move, or the vault moved
  /// already: the sign-in then replaces the old place, as any sign-in does. The hold is written beside the session, so a core that is
  /// stopped meanwhile still knows it.
  Future<Map<String, Object?>?> _holdForMoveOf(KemlockTarget target) async {
    final summary = await _moveSummaryOf(target);
    if (summary == null) return null;
    _accountState.movePending = target;
    final values = SealedValues(_store, _vault.requireSession());
    final stored = await values.load(keyKemlockSession);
    if (stored is Map<String, Object?>) {
      await values.save(keyKemlockSession, {
        ...stored,
        kmMoveHeldKey: {'email': target.email, 'server': target.home.url},
      });
    }
    return {'step': 'move', ...summary};
  }

  /// The sign-in held for a move: in memory, or made again from what the session kept when the core was stopped meanwhile. Null when
  /// none is held, or the vault already syncs with Kemlock Server.
  Future<KemlockTarget?> _heldTargetOf() async {
    final held = _accountState.movePending;
    if (held != null) return held;
    if (_settings.kemlock != null) return null;
    final stored = await SealedValues(_store, _vault.requireSession()).load(keyKemlockSession);
    if (stored is! Map<String, Object?>) return null;
    final marker = stored[kmMoveHeldKey];
    if (marker is! Map<String, Object?>) return null;
    final userId = stored['userId'];
    final deviceId = stored['deviceId'];
    final email = marker['email'];
    final server = marker['server'];
    if (userId is! String || deviceId is! String || email is! String || server is! String) return null;
    return _accountState.movePending = KemlockTarget(
      accountId: userId,
      email: email,
      servers: [KemlockServer(url: server)],
      deviceId: deviceId,
    );
  }

  /// Forgets the hold written beside the session: the move began, or ended.
  Future<void> _clearHeldMark() async {
    final values = SealedValues(_store, _vault.requireSession());
    final stored = await values.load(keyKemlockSession);
    if (stored is Map<String, Object?> && stored.containsKey(kmMoveHeldKey)) {
      await values.save(keyKemlockSession, {...stored}..remove(kmMoveHeldKey));
    }
  }

  /// Whether a move has begun and isn't finished, or runs now: the vault's own entries wait for it.
  Future<bool> _moveUnfinishedOf(VaultSession session) async {
    final unfinished = _accountState.moveRunning || kmMoveUnfinished(await KmMoveStore(SealedValues(_store, session)).load());
    _accountState.moveUnfinished = unfinished;
    return unfinished;
  }

  /// Where the move stands, for the page that shows it. A sign-in that is held also says what would move, so setup can show it again.
  Future<Map<String, Object?>> moveStatus() async {
    final session = _vault.requireSession();
    final state = _accountState;
    final record = await KmMoveStore(SealedValues(_store, session)).load();
    final held = await _heldTargetOf();
    final target = held ?? _settings.kemlock;
    final source = target == null ? null : kmMoveSourceOf(_settings, target);
    final finished = record != null && record.isDone;
    state.moveUnfinished = state.moveRunning || (record != null && !record.isDone);
    final summary = held == null ? null : await _moveSummaryOf(held);
    return {
      // A move that stopped is still offered when its old store is gone: it is gone from the settings, and the person abandons it
      'offered': !finished && (source != null || record != null),
      'source': ?(record?.source ?? source?.name),
      'held': held != null,
      'running': state.moveRunning,
      'step': ?(state.moveRunning ? state.moveStep : record?.step)?.name,
      'done': state.moveDone,
      'total': state.moveTotal,
      'finished': finished,
      'result': ?record?.result,
      'problem': ?state.moveProblem,
      if (summary != null) ...{'counts': summary['counts'], 'files': summary['files'], 'resumed': summary['resumed']},
    };
  }

  /// Starts the move, or goes on with one that stopped, and answers at once: the run goes on in the core and the page asks again.
  /// [input] may carry the answer to the removal guard's question, `choice` `keep` or `remove`, when the old store's run asked one.
  /// The move counts as running from the first line, so a second start, or a sync that begins meanwhile, finds it so.
  Future<Map<String, Object?>> moveStart([Map<String, Object?> input = const {}]) async {
    final session = _vault.requireSession();
    final state = _accountState;
    if (state.moveRunning) return moveStatus();
    state.moveRunning = true;
    try {
      // An ordinary run of the vault's sync that began before the move is waited for: it writes the old store, which the move reads
      final current = _current;
      if (current != null) {
        try {
          await current;
        } catch (_) {
          // What it failed with is its own
        }
      }
      final target = await _heldTargetOf() ?? _settings.kemlock;
      if (target == null) throw const CoreFailure(CoreFailure.invalid, 'no sign-in is waiting for a move');
      final store = KmMoveStore(SealedValues(_store, session));
      var record = await store.load();
      if (record != null && record.isDone) throw const CoreFailure('moveDone', 'the vault moved already');
      if (record == null) {
        final source = kmMoveSourceOf(_settings, target);
        if (source == null) throw const CoreFailure(CoreFailure.invalid, 'there is nothing to move');
        final plan = planKmMove(scopeLists(_vault.lists, null), Owner.user(target.accountId));
        // A browser keeps no attached file, and the move can't finish while a note or a File item names one it doesn't hold
        if (plan.files.isNotEmpty || _vault.lists.files.isNotEmpty) {
          throw const CoreFailure('filesNeedPhone', 'the vault has attached files');
        }
        record = KmMoveRecord(
          source: source.name,
          server: source.server,
          home: source.home,
          mode: source.mode,
          startedAt: _clock().millisecondsSinceEpoch,
        );
        // The record first, the target second, so no sync of the vault's own entries runs in between
        await store.save(record);
      }
      if (_settings.kemlock == null) await _saveSettings(_settings.copyWith(kemlock: target));
      await _clearHeldMark();
      _removalChoice = switch (input['choice']) {
        'keep' => RemovalChoice.keep,
        'remove' => RemovalChoice.remove,
        _ => _removalChoice,
      };
      state
        ..movePending = null
        ..moveProblem = null
        ..moveUnfinished = true
        ..moveStep = record.step
        ..moveDone = 0
        ..moveTotal = 0;
      unawaited(_runMove(target));
    } catch (_) {
      state.moveRunning = false;
      rethrow;
    }
    return moveStatus();
  }

  /// The person doesn't move after all. A sign-in that is held is ended on the server and forgotten here. A move that stopped is
  /// dropped while the old store is as it was (before its last step): its record and the Kemlock target go, the session with them, and
  /// the vault goes on syncing with its old store as it did. What was copied stays on the server, where a later move finds it.
  Future<Map<String, Object?>> moveCancel() async {
    final session = _vault.requireSession();
    final state = _accountState;
    if (state.moveRunning) return moveStatus();
    final store = KmMoveStore(SealedValues(_store, session));
    final held = await _heldTargetOf();
    final record = await store.load();
    var target = held;
    if (target == null) {
      if (record == null || record.isDone) return moveStatus();
      if (record.step == KmMoveStep.oldStore) throw const CoreFailure('moveTooLate', 'the old store is being dealt with');
      target = _settings.kemlock;
    }
    state
      ..movePending = null
      ..moveProblem = null
      ..moveUnfinished = false;
    if (target != null) {
      try {
        await _kmHost().signOut(target);
      } catch (_) {
        // Forgotten here all the same
      }
    }
    final values = SealedValues(_store, session);
    for (final key in [keyKemlockSession, keyKemlockAccount, keyKemlockCache]) {
      values.remove(key);
    }
    store.remove();
    final tag = deviceKeyTag(_vault.registry.active);
    _dpops.remove(tag);
    await _vault.platform.deviceKeys.delete(tag);
    await _forgetScope(kemlockScope);
    if (_settings.kemlock != null) {
      await _replacePlaces(_settings.copyWith(kemlock: null));
    } else {
      _kemlock?.dispose();
      _kemlock = null;
      await _vault.store.flush();
    }
    return moveStatus();
  }

  /// Runs the move, again when an edit made meanwhile kept its first step from being taken in (the step is the old store's run, which
  /// has to be read again with the edit in it).
  Future<void> _runMove(KemlockTarget target) async {
    final state = _accountState;
    try {
      for (var attempt = 0; ; attempt++) {
        try {
          await _doMove(target);
          state
            ..moveStep = KmMoveStep.done
            ..moveUnfinished = false;
          return;
        } on CoreFailure catch (error) {
          if (error.code == 'editedMeanwhile' && attempt < 2) continue;
          state.moveProblem = error.code;
          return;
        }
      }
    } catch (error) {
      state.moveProblem = switch (error) {
        KmMoveError(:final issue) => issue.name,
        _ => problemOf(error).name,
      };
    } finally {
      state.moveRunning = false;
    }
  }

  /// A WebDAV folder's run for the move: the run of a folder the vault syncs with, with the removal guard and the keep path that the
  /// core's own run has, which the engine's run alone leaves to its caller.
  Future<KmMoveSynced> _runWebDavForMove(WebDav dav, SyncTarget target, Lists local, ScopeState state, int now) async {
    if (_removalChoice == RemovalChoice.keep) {
      final kept = await _keepFolder(dav, target, local, state, now);
      return KmMoveSynced(doc: kept.doc, known: kept.known, state: kept.state);
    }
    final lost = await _guardFolder(dav, target, local, state, now);
    final result = await runWebDavScope(webDav: dav, target: target, local: local, state: state, now: now);
    return KmMoveSynced(doc: result.doc, known: result.known, state: {...result.state, lostKey: lost});
  }

  /// Runs the move to [target] with this vault's stores: the old store's own run, the copy, the files, the check and the old store, over
  /// the Kemlock host's session (`runKmMove` of the app).
  Future<void> _doMove(KemlockTarget target) async {
    final session = _vault.requireSession();
    final values = SealedValues(_store, session);
    final store = KmMoveStore(values);
    final record = await store.load();
    if (record == null) throw const CoreFailure('oldStoreGone', 'the move has no record');
    final settings = _settings;
    final state = _accountState;
    final scope = record.source == vaultwardenSource ? vaultwardenScope : personalScope;
    final hadVaultwarden = settings.vaultwarden != null;
    http.Client? dav;
    final KmMoveSource source;
    final KmMoveOldStore oldStore;
    final vaultwarden = settings.vaultwarden;
    final personal = settings.personal;
    if (record.source == vaultwardenSource && vaultwarden != null) {
      final backend = _vwBackend();
      source = VaultwardenMoveSource(
        target: vaultwarden,
        run: (local, state, {required now, choice}) => backend.sync(vaultwarden, local, state, now: now, choice: choice),
      );
      oldStore = VaultwardenOldStore(
        mode: vaultwarden.mode,
        close: (confirmed) => backend.closeHome(vaultwarden, confirmed: confirmed),
      );
    } else if (record.source == webdavSource && personal != null) {
      final webDav = WebDav(dav = _vault.platform.clientFor(null));
      source = _RunSource(
        name: webdavSource,
        server: personal.dav.url,
        run: (local, state, now) => _runWebDavForMove(webDav, personal, local, state, now),
      );
      oldStore = const WebDavOldStore();
    } else {
      // The old store was let go since the move began (a sign-out, a settings that were dropped): there is nothing to run it against.
      // The person abandons the move, which puts the vault back as it was, or signs in to the old store again.
      source = _GoneSource(record);
      oldStore = record.source == webdavSource
          ? const WebDavOldStore()
          : VaultwardenOldStore(
              mode: VaultwardenMode.plain,
              close: (_) async => throw const CoreFailure('oldStoreGone', 'the old store is no longer set up'),
            );
    }
    // The revision the run read the vault at: an edit made meanwhile would be lost by taking the run's answer in
    var readAt = _vault.revision;
    try {
      await _kmHost().withAccount(target, (connection, account) async {
        final accountSession = account.openSession();
        try {
          final runner = KmMoveRunner(
            store: store,
            source: source,
            server: KmMoveServer(connection: connection, server: connection.server, crypto: account.itemCrypto(accountSession)),
            files: const _NoFiles(),
            oldStore: oldStore,
            lists: () {
              readAt = _vault.revision;
              return scopeLists(_vault.lists, null);
            },
            oldState: () async => _states[scope] ?? const ScopeState(known: []),
            applySynced: (synced) async {
              if (_vault.revision != readAt) {
                throw const CoreFailure('editedMeanwhile', 'the vault was edited while the old store was read');
              }
              final next = applyScope(_vault.lists, null, synced.doc);
              // The vault's write lock decides it again once the answer has its turn: a save ahead of it counts as an edit
              if (!sameLists(next, _vault.lists) && !await _vault.applySynced(next, ifRevision: readAt)) {
                throw const CoreFailure('editedMeanwhile', 'the vault was edited while the old store was read');
              }
              _states[scope] = ScopeState(known: synced.known, lastSyncAt: _clock().millisecondsSinceEpoch, extra: synced.state);
              await _saveStates();
              // The old store's run may have brought notes with attached files, which a browser can't move: said now, before anything is
              // written to the server, and not as a file that is missing for ever
              if (_vault.lists.files.isNotEmpty ||
                  planKmMove(scopeLists(_vault.lists, null), Owner.user(target.accountId)).files.isNotEmpty) {
                throw const CoreFailure('filesNeedPhone', 'the vault has attached files');
              }
            },
            onOldStore: (result) async {
              final end = kmEndOfMove(
                settings: _settings,
                states: Map.of(_states),
                result: result,
                confirmed: (await store.load())?.sent.keys ?? const [],
                now: _clock().millisecondsSinceEpoch,
              );
              _states = end.states;
              await _saveStates();
              await _saveSettings(end.settings);
            },
            onProgress: (step, done, total) {
              state
                ..moveStep = step
                ..moveDone = done
                ..moveTotal = total;
            },
            clock: _clock,
          );
          final outcome = await runner.run(choice: _removalChoice);
          // The first Kemlock sync starts from what the check read back, instead of reading everything again
          final cache = outcome.cache;
          if (cache != null) await values.save(keyKemlockCache, cache.toJson());
        } finally {
          accountSession.dispose();
        }
      });
    } finally {
      dav?.close();
    }
    _removalChoice = null;
    // The browser syncs one place: the old store, and a plain home's Bitwarden copy the phones go on syncing, are left as they are
    if (hadVaultwarden) {
      _vwBackend().forgetCredentials();
      _store.removeEncryptedValue(keyVaultwardenCache);
    }
    _states.remove(vaultwardenScope);
    _states.remove(personalScope);
    await _saveStates();
    await _replacePlaces(_settings.copyWith(personal: null, vaultwarden: null));
  }
}

// The class calls these three by name from its own methods, which an extension's private members can't be reached by without a receiver

/// [SyncAccount._openWithKitOf] for the sync service's own answer to a sign-in.
Future<Map<String, Object?>> _openWithKit(SyncService service, _PendingKemlock pending, List<String> pieces) =>
    service._openWithKitOf(pending, pieces);

/// [SyncAccount._holdForMoveOf] for the sync service's own end of a sign-in.
Future<Map<String, Object?>?> _holdForMove(SyncService service, KemlockTarget target) => service._holdForMoveOf(target);

/// [SyncAccount._moveUnfinishedOf] for the sync service's own runs.
Future<bool> _moveUnfinished(SyncService service, VaultSession session) => service._moveUnfinishedOf(session);
