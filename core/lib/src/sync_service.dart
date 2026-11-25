// Sync in the browser (browser-sync spec, design decision 12, and docs/plans/add-kemlock-server-sync.md): the engines of
// Kemlock-core run unchanged, over `fetch`, for the one place the browser's vault syncs with, the way the phone's scheduler runs
// them for its own entries. This holds the sign-in steps as data, the settings and state the app keeps (same keys, sealed in the
// vault), and a run: read the scope, merge, take what changed, write down what was held.
import 'dart:async';
import 'dart:convert';
import 'dart:math' show max;
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/crypto/account/bundle.dart' show KeyBundle;
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/crypto/account/keys.dart';
import 'package:kemlock_core/crypto/account/kx1.dart';
import 'package:kemlock_core/crypto/account/prf_wrap.dart' show prfEvalInput;
import 'package:kemlock_core/crypto/account/sealed_box.dart';
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/features/duplicates/duplicate_normalise.dart' show SiteResolver;
import 'package:kemlock_core/features/spaces/space_head_store.dart';
import 'package:kemlock_core/features/sync/kemlock/km_account.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_approvals.dart';
import 'package:kemlock_core/features/sync/kemlock/km_auth_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_dedup_api.dart' show KmHints;
import 'package:kemlock_core/features/sync/kemlock/km_device_key.dart';
import 'package:kemlock_core/features/sync/kemlock/km_dpop.dart';
import 'package:kemlock_core/features/sync/kemlock/km_failover.dart' show KmHomeAway;
import 'package:kemlock_core/features/sync/kemlock/km_files.dart' show KmFileStore;
import 'package:kemlock_core/features/sync/kemlock/km_host.dart';
import 'package:kemlock_core/features/sync/kemlock/km_models.dart';
import 'package:kemlock_core/features/sync/kemlock/km_move.dart';
import 'package:kemlock_core/features/sync/kemlock/km_move_end.dart';
import 'package:kemlock_core/features/sync/kemlock/km_move_old_store.dart';
import 'package:kemlock_core/features/sync/kemlock/km_move_plan.dart';
import 'package:kemlock_core/features/sync/kemlock/km_move_record.dart';
import 'package:kemlock_core/features/sync/kemlock/km_move_server.dart';
import 'package:kemlock_core/features/sync/kemlock/km_move_source.dart';
import 'package:kemlock_core/features/sync/kemlock/km_passkey.dart';
import 'package:kemlock_core/features/sync/kemlock/km_phrase.dart';
import 'package:kemlock_core/features/sync/kemlock/km_session.dart';
import 'package:kemlock_core/features/sync/kemlock/km_signin.dart';
import 'package:kemlock_core/features/sync/kemlock/km_sso.dart';
import 'package:kemlock_core/features/sync/kemlock/km_sync.dart';
import 'package:kemlock_core/features/sync/kemlock/km_trust.dart';
import 'package:kemlock_core/features/sync/removal_guard.dart';
import 'package:kemlock_core/features/sync/sync.dart';
import 'package:kemlock_core/features/sync/sync_crypto.dart';
import 'package:kemlock_core/features/sync/sync_merge.dart';
import 'package:kemlock_core/features/sync/sync_personal.dart';
import 'package:kemlock_core/features/sync/vaultwarden/vw_api.dart';
import 'package:kemlock_core/features/sync/vaultwarden/vw_backend.dart';
import 'package:kemlock_core/features/sync/vaultwarden/vw_models.dart';
import 'package:kemlock_core/features/sync/vaultwarden/vw_sync.dart';
import 'package:kemlock_core/features/sync/vaultwarden/vw_webauthn.dart';
import 'package:kemlock_core/features/sync/webdav.dart';
import 'package:kemlock_core/vault/vault_store.dart';

import 'account/kit.dart' show openKitRoot;
import 'account/kit_pieces.dart' show PieceError;
import 'account/register.dart';
import 'failure.dart';
import 'generate.dart' show parseWordList;
import 'matching.dart' show isSharedHost;
import 'spaces_service.dart';
import 'vault_service.dart';

part 'account/sync_account.dart';

/// Why [address] can't be signed in to before anything is sent, or null when it is an https address: the sync problem's name
/// (`insecure` for http, [other] for anything else that isn't a URL with a host). The engines check again; this keeps a
/// password from reaching a client at all.
String? addressProblem(Object? address, {String other = 'address'}) {
  if (address is! String) return other;
  final url = Uri.tryParse(address.trim());
  if (url == null || !url.hasScheme) return other;
  if (url.scheme == 'http') return 'insecure';
  return url.scheme == 'https' && url.host.isNotEmpty ? null : other;
}

Map<String, Object?> _refused(String problem) => {'step': 'error', 'problem': problem};

/// Where the vault's sync settings and state are kept, as the app keeps them: sealed in the vault.
const keySyncSettings = 'backmycodes_sync';
const keySyncState = 'backmycodes_sync_state';

/// The tag of the vault's device key. Keys are tagged by vault, as the phone does.
String deviceKeyTag(String vaultId) => 'dpop.$vaultId';

/// How one scope's last run went.
class ScopeStatus {
  const ScopeStatus({this.lastSyncAt, this.problem, this.count = 0, this.scope = 0, this.items = const []});

  /// Epoch ms of the last run that went through, or null.
  final int? lastSyncAt;

  /// Why the last try failed, or null when it went through.
  final SyncProblem? problem;

  /// With [SyncProblem.removals], how many entries would go.
  final int count;

  /// With [SyncProblem.removals], how many entries the scope holds (on its larger side): "6 of 22".
  final int scope;

  /// With [SyncProblem.removals], what would go, by name and kind, when the run can tell (a folder's can; the two servers'
  /// engines stop with the count only).
  final List<RemovalItem> items;
}

/// An entry a run stopped by the removal guard would remove, as the "Review" list shows it.
typedef RemovalItem = ({String name, String kind});

/// What each entry of [lists] is called and what kind it is, by id.
Map<String, RemovalItem> _removalNames(Lists lists) => {
  for (final account in lists.accounts) account.id: (name: account.issuer.isEmpty ? account.label : account.issuer, kind: 'code'),
  for (final account in lists.keyAccounts) account.id: (name: account.issuer.isEmpty ? account.name : account.issuer, kind: 'code'),
  for (final service in lists.backupServices) service.id: (name: service.serviceName, kind: 'backupCodes'),
  for (final login in lists.logins) login.id: (name: login.name, kind: 'login'),
  for (final note in lists.notes) note.id: (name: note.title, kind: 'note'),
  for (final card in lists.cards) card.id: (name: card.name, kind: 'card'),
  for (final identity in lists.identities) identity.id: (name: identity.name, kind: 'identity'),
  for (final key in lists.keys) key.id: (name: key.name, kind: 'key'),
  for (final passkey in lists.passkeys) passkey.id: (name: passkey.rpName ?? passkey.rpId, kind: 'passkey'),
  for (final contact in lists.contacts) contact.id: (name: contact.name, kind: 'contact'),
};

/// The most entries a "Review" list names.
const _removalListLimit = 200;

/// A folder's run the removal guard stopped: it knows what would go, which the two servers' engines don't say.
class _FolderRemovals extends KmSyncError {
  _FolderRemovals(int count, this.scope, this.items) : super(KmSyncIssue.removals, count: count);

  final int scope;
  final List<RemovalItem> items;
}

/// The vault's sealed values as `KmHost` reads and writes them: the session, the account and the cache.
class SealedValues implements KmVaultValues {
  SealedValues(this.vault, this.session);

  final VaultStore vault;
  final VaultSession session;

  @override
  Future<Object?> load(String key) => vault.loadEncryptedValue(key, session);

  @override
  Future<void> save(String key, Object? value) => vault.saveEncryptedValue(key, value, session);

  @override
  void remove(String key) => vault.removeEncryptedValue(key);
}

/// The hardware's side of "Trust this phone", which a browser has none of: nothing is trusted, so an account opens by an
/// approval from another device or by the master password.
class NoTrust implements KmKeyWrapper {
  const NoTrust();

  @override
  String get protection => DeviceKeyProtection.browser;

  @override
  Future<void> create(String tag) => Future.error(const KmTrustUnavailable());

  @override
  Future<bool> exists(String tag) async => false;

  @override
  Future<Uint8List> wrap(String tag, Uint8List key) => Future.error(const KmTrustUnavailable());

  @override
  Future<Uint8List> unwrap(String tag, Uint8List wrapped) => Future.error(const KmTrustUnavailable());

  @override
  Future<void> delete(String tag) async {}
}

// ─── A sign-in under way ────────────────────────────────────────────────────────────────────────

sealed class _Pending {
  /// Lets go of what it holds: its client, the keys derived from the password, the one-time key of an approval.
  void close();
}

class _PendingKemlock extends _Pending {
  _PendingKemlock({required this.signIn, required this.client, required this.server, required this.email, required this.tag});

  final KmSignIn signIn;
  final http.Client client;
  final Uri server;
  final String email;
  final String tag;

  /// The sign-in the second step is for, or the approval waits on.
  KmSignedIn? signed;
  KmSecondStep? second;
  _Approval? approval;

  @override
  void close() {
    approval?.close();
    signIn.close();
    client.close();
  }
}

/// A new device's request for approval: the one-time key, the five words and when it started.
class _Approval {
  _Approval({required this.privateKey, required this.ticket, required this.phrase, required this.startedAt});

  final Uint8List privateKey;
  final KmApprovalTicket ticket;
  final String phrase;
  final DateTime startedAt;

  void close() => wipe(privateKey);
}

class _PendingDav extends _Pending {
  _PendingDav({required this.dav, required this.existing, required this.kdf});

  final DavAccount dav;
  final DavFile? existing;
  final Kdf kdf;

  /// What the passphrase opened, once it has: the place to join, kept until the first sync is confirmed.
  SyncTarget? target;

  @override
  void close() {}
}

class _PendingVw extends _Pending {
  _PendingVw({required this.setup, required this.client, required this.password, required this.deviceId});

  final VwAccountSetup setup;
  final http.Client client;
  String? password;
  final String deviceId;

  VwSignInNeedsStep? second;
  VwConnection? connection;
  VwVaultInfo? found;
  VwHomeInfo? home;
  VaultwardenTarget? target;

  @override
  void close() {
    password = null;
    client.close();
  }
}

/// Sync for the open vault.
class SyncService implements SpacesHost {
  SyncService(this._vault);

  final VaultService _vault;

  SyncSettings _settings = const SyncSettings();
  var _loaded = false;
  Map<String, ScopeState> _states = {};
  final Map<String, ScopeStatus> _status = {};
  var _running = false;
  Future<void>? _current;
  var _again = false;
  RemovalChoice? _removalChoice;
  _Pending? _pending;

  /// The name of the Vaultwarden home joined in this session (the settings keep only its id).
  String? _homeName;
  final Map<String, KmDpop> _dpops = {};
  KmHost? _kemlock;
  VaultwardenBackend? _vaultwarden;

  /// The vault's shared spaces, which run as scopes after the vault's own (docs/plans/add-spaces.md).
  late final SpacesService spaces = SpacesService(_vault, this);
  SyncedSpaceAnchorStore? _anchorStore;

  /// What the account's own flows hold between calls (account/sync_account.dart).
  final _accountState = AccountState();

  CoreDataAccess get _data => CoreDataAccess(_vault);

  DateTime Function() get _clock => _vault.platform.clock;
  VaultStore get _store => _vault.vault;

  VwClientInfo get _vwInfo => VwClientInfo(
    deviceType: _vault.platform.browser.deviceType,
    deviceName: _vault.platform.browser.deviceName,
    clientVersion: _vault.platform.version,
    clientId: 'browser',
  );

  KmDeviceInfo _deviceInfo({String? bitwardenDeviceId}) => KmDeviceInfo(
    name: _vault.platform.browser.deviceName,
    kind: 'kemlock-browser',
    deviceType: _vault.platform.browser.deviceType,
    bitwardenDeviceId: bitwardenDeviceId,
  );

  // ─── Loading ────────────────────────────────────────────────────────

  /// Reads the open vault's sync settings and what each scope held after its last run.
  Future<void> load() async {
    final session = _vault.requireSession();
    final settings = await _store.loadEncryptedValue(keySyncSettings, session);
    final stored = await _store.loadEncryptedValue(keySyncState, session);
    _settings = settings == null ? const SyncSettings() : SyncSettings.fromJson(settings);
    _states = {
      if (stored is Map<String, Object?>)
        for (final MapEntry(:key, :value) in stored.entries)
          if (value is Map<String, Object?>) key: ScopeState.fromJson(value),
    };
    _status.clear();
    // Whether a move that stopped is waiting, which the status says (it can't read the record itself)
    try {
      _accountState.moveUnfinished = kmMoveUnfinished(await KmMoveStore(SealedValues(_store, session)).load());
    } catch (_) {
      _accountState.moveUnfinished = false;
    }
    _loaded = true;
  }

  /// Forgets everything when the vault locks: a sign-in under way is dropped, and so are the hosts.
  void unload() {
    _loaded = false;
    _settings = const SyncSettings();
    _states = {};
    _status.clear();
    _removalChoice = null;
    kemlockHints = null;
    _dropPending();
    _accountState.reset();
    _kemlock?.dispose();
    _kemlock = null;
    _vaultwarden = null;
    _dpops.clear();
    spaces.unload();
  }

  void _dropPending() {
    _pending?.close();
    _pending = null;
  }

  Future<void> _saveSettings(SyncSettings next) async {
    await _store.saveEncryptedValue(keySyncSettings, next.toJson(), _vault.requireSession());
    _settings = next;
    await _vault.store.flush();
  }

  Future<void> _saveStates() async {
    await _store.saveEncryptedValue(keySyncState, {
      for (final MapEntry(:key, :value) in _states.entries) key: value.toJson(),
    }, _vault.requireSession());
    await _vault.store.flush();
  }

  Future<void> _forgetScope(String scope) async {
    _states.remove(scope);
    _status.remove(scope);
    await _saveStates();
  }

  // ─── Status ─────────────────────────────────────────────────────────

  /// Where the vault syncs and how the last run went, or null when it syncs nowhere.
  Map<String, Object?>? status() {
    if (!_loaded) return null;
    final (:place, :scope, :server, :account, :device) = switch (_settings) {
      SyncSettings(:final kemlock?) => (
        place: 'kemlock',
        scope: kemlockScope,
        server: kemlock.home.url,
        account: kemlock.email,
        device: _vault.platform.browser.deviceName,
      ),
      SyncSettings(:final vaultwarden?) => (
        place: 'vaultwarden',
        scope: vaultwardenScope,
        server: vaultwarden.server,
        account: vaultwarden.email,
        device: _vault.platform.browser.deviceName,
      ),
      SyncSettings(:final personal?) => (
        place: 'webdav',
        scope: personalScope,
        server: personal.dav.url,
        account: personal.dav.username,
        device: null,
      ),
      _ => (place: '', scope: '', server: '', account: null, device: null),
    };
    if (place.isEmpty) return null;
    final status = _status[scope];
    final lastSync = status?.lastSyncAt ?? _states[scope]?.lastSyncAt;
    final problem = status?.problem;
    // A move that stopped keeps the vault's own entries from syncing, and the status says so
    final stopped = place == 'kemlock' && _accountState.moveUnfinished;
    return {
      'place': place,
      'server': server,
      'account': ?account,
      'deviceName': ?device,
      'lastSync': ?lastSync,
      'running': _running,
      'problem': ?(stopped ? 'moveUnfinished' : problem?.name),
      'pendingRemovals': ?(problem == SyncProblem.removals ? status?.count : null),
      'scopeSize': ?(problem == SyncProblem.removals && (status?.scope ?? 0) > 0 ? status?.scope : null),
      'pendingRemovalItems': ?(problem == SyncProblem.removals && (status?.items.isNotEmpty ?? false)
          ? [
              for (final item in status!.items) {'name': item.name, 'kind': item.kind},
            ]
          : null),
      if (place == 'vaultwarden') ...{
        'loginsNotSynced': true,
        'storage': _settings.vaultwarden!.mode == VaultwardenMode.sealed ? 'sealed' : 'plain',
        'home': _homeName ?? _settings.vaultwarden!.home,
      },
    };
  }

  Map<String, Object?> _statusOrDone() => status() ?? (throw const CoreFailure(CoreFailure.invalid, 'sync is off'));

  // ─── Sign-in steps ─────────────────────────────────────────────────

  Map<String, Object?> _done() => {'step': 'done', 'status': _statusOrDone()};

  /// An engine's failure as the step the sign-in ends with.
  Map<String, Object?> _errorStep(Object error) {
    final failure = kmSignInFailure(error);
    final String problem;
    String? message;
    switch (failure) {
      case KmSignInError(:final issue, :final detail):
        problem = issue == KmSignInIssue.wrongPassword ? 'auth' : issue.name;
        message = detail;
      case VwPassphraseError():
        // A sealed home's passphrase that doesn't open it, as a sync file's key that doesn't
        problem = SyncProblem.key.name;
        message = 'passphrase';
      case VwError(problem: VwProblem.code):
        problem = SyncProblem.auth.name;
        message = 'code';
      case CoreFailure():
        throw failure;
      default:
        problem = problemOf(failure).name;
        message = null;
    }
    return {'step': 'error', 'problem': problem, 'message': ?message};
  }

  /// Runs a step, and says how it failed as the step it ends with. A sign-in's first step that fails ends it; an answer that
  /// fails ([keep]: a wrong code, a wrong passphrase) leaves the sign-in waiting for another.
  Future<Map<String, Object?>> _guard(Future<Map<String, Object?>> Function() step, {bool keep = false}) async {
    try {
      return await step();
    } on CoreFailure {
      rethrow;
    } catch (error) {
      if (!keep) _dropPending();
      return _errorStep(error);
    }
  }

  /// A step that was answered when none is under way.
  CoreFailure get _noStep => const CoreFailure(CoreFailure.invalid, 'no sign-in is waiting for an answer');

  Future<Map<String, Object?>> answer(Map<String, Object?> answer) async {
    _vault.requireSession();
    final pending = _pending;
    final step = answer['step'];
    if (pending == null) throw _noStep;
    return _guard(() async {
      switch (pending) {
        case _PendingKemlock():
          return _answerKemlock(pending, answer);
        case _PendingDav():
          return switch (step) {
            'passphrase' => _answerDav(pending, answer['passphrase'] as String? ?? ''),
            'firstSync' => _firstSyncDav(pending, go: answer['go'] == true),
            _ => throw _noStep,
          };
        case _PendingVw():
          return _answerVaultwarden(pending, answer);
      }
    }, keep: true);
  }

  // ─── Kemlock Server ─────────────────────────────────────────────────

  Future<_PendingKemlock> _startKemlock(String address, String email, {String? bitwardenDeviceId}) async {
    _dropPending();
    final server = kmServerUrl(address);
    final tag = deviceKeyTag(_vault.registry.active);
    final key = await _vault.platform.deviceKeys.create(tag);
    final proofs = _dpops[tag] = KmDpop(key, clock: _clock);
    final client = _vault.platform.clientFor(null);
    final values = SealedValues(_store, _vault.requireSession());
    final signIn = KmSignIn(
      api: KmApi(client, proofs: proofs, clock: _clock),
      server: server,
      device: _deviceInfo(bitwardenDeviceId: bitwardenDeviceId),
      opaque: OpaqueKmOpaque(),
      deviceKey: {'protection': DeviceKeyProtection.browser, 'tag': tag},
      opaqueSeen: await kmOpaqueSeen(values),
      rememberOpaque: () => kmRememberOpaque(values),
      clock: _clock,
    );
    final pending = _PendingKemlock(signIn: signIn, client: client, server: server, email: email.trim(), tag: tag);
    _pending = pending;
    try {
      await signIn.ways(pending.email);
    } catch (_) {
      _dropPending();
      rethrow;
    }
    return pending;
  }

  Future<Map<String, Object?>> signInKemlock(Map<String, Object?> input) async {
    _vault.requireSession();
    final refused = addressProblem(input['server']);
    if (refused != null) return _refused(refused);
    return _guard(() async {
      final pending = await _startKemlock(input['server']! as String, input['email']! as String);
      return _afterKemlock(pending, await pending.signIn.password(pending.email, input['password']! as String));
    });
  }

  /// "Continue with SSO": the browser's own sign-in flow on the provider the server names, and then the account's keys.
  Future<Map<String, Object?>> signInKemlockSso(Map<String, Object?> input) async {
    _vault.requireSession();
    final refused = addressProblem(input['server']);
    if (refused != null) return _refused(refused);
    return _guard(() async {
      final redirect = _vault.platform.ssoRedirect;
      if (redirect == null) throw const CoreFailure(CoreFailure.unavailable, 'the browser gave no sign-in address');
      final pending = await _startKemlock(input['server']! as String, (input['email'] as String?) ?? '');
      try {
        return await _afterKemlock(pending, await kmSsoSignIn(pending.signIn, _vault.platform.browserAuth, returnTo: redirect));
      } on KmError catch (error) {
        // The server's list of extensions that may end an SSO trip (KEMLOCK_BROWSER_EXTENSION_IDS) doesn't name this one
        if (error.status == 400 && (error.message ?? '').contains('redirect')) {
          _dropPending();
          return {'step': 'error', 'problem': 'ssoRedirect'};
        }
        rethrow;
      }
    });
  }

  /// A passkey or security key with its PRF, asked in a page of the extension (design decision 13).
  Future<Map<String, Object?>> signInKemlockPasskey(Map<String, Object?> input) async {
    _vault.requireSession();
    final refused = addressProblem(input['server']);
    if (refused != null) return _refused(refused);
    return _guard(() async {
      final asserter = _vault.platform.passkeys;
      if (asserter == null) throw const CoreFailure(CoreFailure.unavailable, 'the browser gave no passkey page');
      final pending = await _startKemlock(input['server']! as String, (input['email'] as String?) ?? '');
      return _afterKemlock(pending, await kmPasskeySignIn(pending.signIn, asserter, pending.email, prfEvalInput));
    });
  }

  Future<Map<String, Object?>> _afterKemlock(_PendingKemlock pending, KmSignInStep step) async {
    switch (step) {
      case KmSecondStep():
        pending.second = step;
        return _secondStepOfKemlock(step, enrolling: pending.signIn.enrolling);
      case KmSignedIn():
        pending.signed = step;
        var account = step.account;
        // An account with no keys yet is one only the web vault or the phone makes: a browser holds no hardware key to
        // keep the copy that opens it (the sign-in says so)
        if (account == null && step.newAccount) {
          account = await pending.signIn.enrolKeys(
            step.session,
            KmTrust(wrapper: const NoTrust()),
            kmTrustTag(_vault.registry.active, step.session.userId),
            newAccount: true,
          );
        }
        if (account != null) return _finishKemlock(pending, step.session, account);
        return _openKemlock(pending);
    }
  }

  /// The second step as data. A Compatible account's enrolment ([enrolling]) is answered by an authenticator code only, the one
  /// `twoFactorCode` its last message takes, so no other method is offered for it.
  Map<String, Object?> _secondStepOfKemlock(KmSecondStep step, {bool enrolling = false}) => {
    'step': 'second',
    // The account's recovery code is taken whatever methods it has, so it is always there, but for an enrolment
    'methods': enrolling
        ? [if (step.methods.contains('totp')) 'authenticator']
        : [for (final method in step.methods) ?_secondMethods[method], 'recoveryCode'],
    'unsupported': [
      for (final method in step.methods)
        if (!(enrolling ? method == 'totp' : _secondMethods.containsKey(method))) method,
      ...step.unsupported,
    ],
  };

  static const _secondMethods = {'totp': 'authenticator', 'email': 'email', 'webauthn': 'securityKey', 'recovery': 'recoveryCode'};

  /// An account that signed in and doesn't open yet: an approval from another device, the five words of which both show, or
  /// the master password.
  Future<Map<String, Object?>> _openKemlock(_PendingKemlock pending) async {
    final words = _data.approvalWords;
    if (words == null) return {'step': 'masterPassword'};
    final approval = pending.approval ??= await _askApproval(pending, words);
    return {'step': 'approval', 'phrase': approval.phrase.split(' '), 'requestId': approval.ticket.id};
  }

  Future<_Approval> _askApproval(_PendingKemlock pending, List<String> words) async {
    final pair = await Kx1.generate();
    final phrase = approvalPhrase(pair.publicKey, words);
    final ticket = await pending.signIn.auth.approvalRequest(pending.server, pending.email, pair.publicKey, pending.signIn.device);
    if (!phrasesAgree(phrase, ticket.phrase)) {
      wipe(pair.privateKey);
      throw const KmApprovalError(KmApprovalIssue.phraseMismatch);
    }
    return _Approval(privateKey: pair.privateKey, ticket: ticket, phrase: phrase, startedAt: _clock());
  }

  /// The security key as a second step: the server's options for the account's keys, the key asked in the page of the extension that
  /// the passkey sign-in uses (the server's own connector page, which sets the relying party), and its credential sent as the answer.
  Future<Map<String, Object?>> _answerSecurityKey(_PendingKemlock pending) async {
    final asserter = _vault.platform.passkeys;
    if (asserter == null) throw const CoreFailure(CoreFailure.unavailable, 'the browser gave no passkey page');
    final options = await pending.signIn.securityKeyOptions();
    final assertion = await asserter.assertion(options, prfEvalInput, pending.server);
    final prf = assertion.prfOutput;
    if (prf != null) wipe(prf);
    return _afterKemlock(pending, await pending.signIn.securityKeyStep(kmPasskeyCredential(assertion)));
  }

  Future<Map<String, Object?>> _answerKemlock(_PendingKemlock pending, Map<String, Object?> answer) async {
    switch (answer['step']) {
      case 'second':
        final method = _secondMethods.entries.where((entry) => entry.value == answer['method']).firstOrNull?.key;
        if (method == null) throw const CoreFailure(CoreFailure.invalid, 'a second step the server does not offer here');
        final code = (answer['code'] as String? ?? '').trim();
        // A Compatible account's enrolment takes an authenticator code and nothing else
        if (pending.signIn.enrolling && method != 'totp') {
          throw const CoreFailure(CoreFailure.invalid, 'this sign-in is answered by an authenticator code only');
        }
        if (method == 'webauthn') return _answerSecurityKey(pending);
        if (method == 'email' && code.isEmpty) {
          // Asking for the code: the server mails it, and the step is the same
          await pending.signIn.sendEmailCode();
          return _secondStepOfKemlock(pending.second!);
        }
        return _afterKemlock(pending, await pending.signIn.secondStep(method, code));
      case 'recoveryKit':
        return _openWithKit(this, pending, [for (final piece in answer['pieces'] as List<Object?>? ?? const []) piece as String]);
      case 'masterPassword':
        // The master password opens the account: a sign-in again, which opens it by the password
        pending.approval?.close();
        pending.approval = null;
        return _afterKemlock(pending, await pending.signIn.password(pending.email, answer['password'] as String? ?? ''));
      case 'approval':
        final approval = pending.approval;
        if (approval == null) return _openKemlock(pending);
        return _pollApproval(pending, approval);
    }
    throw _noStep;
  }

  /// One look at the request: the five words again while nobody has answered, the account once approved.
  Future<Map<String, Object?>> _pollApproval(_PendingKemlock pending, _Approval approval) async {
    if (_clock().difference(approval.startedAt) > approvalLifetime) {
      approval.close();
      pending.approval = null;
      return {'step': 'error', 'problem': 'approvalExpired'};
    }
    final KmApprovalPoll poll;
    try {
      poll = await pending.signIn.auth.approvalPoll(pending.server, approval.ticket.id);
    } on KmError catch (e) {
      // A hiccup in the connection doesn't end a wait that has minutes left
      if (e.problem != KmProblem.network) rethrow;
      return {'step': 'approval', 'phrase': approval.phrase.split(' '), 'requestId': approval.ticket.id};
    }
    switch (poll.status) {
      case 'approved':
        final sealed = poll.sealedKey;
        if (sealed == null) throw const KmSignInError(KmSignInIssue.unreadable, detail: 'approved with no key');
        final signed = await _openApproved(pending, approval, sealed, poll.accountId ?? pending.signed?.session.userId);
        pending.approval = null;
        approval.close();
        return _finishKemlock(pending, signed.session, signed.account!);
      case 'denied':
        approval.close();
        pending.approval = null;
        return {'step': 'error', 'problem': 'approvalDenied'};
      case 'expired' || 'used':
        approval.close();
        pending.approval = null;
        return {'step': 'error', 'problem': 'approvalExpired'};
    }
    return {'step': 'approval', 'phrase': approval.phrase.split(' '), 'requestId': approval.ticket.id};
  }

  /// The approved answer opens with the one-time key, the device key signs in for the approved request, and the account opens
  /// from the root key (the steps of `KmApprovalFlow`, which waits instead of answering once).
  Future<KmSignedIn> _openApproved(_PendingKemlock pending, _Approval approval, Uint8List sealed, String? account) async {
    if (account == null || !isUuidText(account)) {
      throw const KmSignInError(KmSignInIssue.unreadable, detail: 'the approval is bound to an account this browser doesn’t know');
    }
    final Uint8List root;
    try {
      root = await openBox(sealed, approval.privateKey, context: SealContext.deviceApproval, aad: approvalAad(account, approval.ticket.id));
    } on MalformedException catch (e) {
      throw KmSignInError(KmSignInIssue.unreadable, detail: e.message);
    } on CorruptedException {
      throw const KmSignInError(KmSignInIssue.unreadable, detail: 'the approval doesn’t open with this browser’s key');
    }
    try {
      if (root.length != rootKeyLength) throw const KmSignInError(KmSignInIssue.unreadable, detail: 'the approved key is the wrong size');
      final challenge = await pending.signIn.auth.deviceChallenge(pending.server, approval.ticket.id);
      final grant = await pending.signIn.auth.deviceVerify(pending.server, challenge);
      final step = await pending.signIn.continueWith(KmSignInAnswer(grant: grant));
      final signed = step as KmSignedIn;
      final opened = await pending.signIn.openWithRoot(signed.session, root);
      return KmSignedIn(session: signed.session, account: opened);
    } finally {
      wipe(root);
    }
  }

  Future<Map<String, Object?>> _finishKemlock(_PendingKemlock pending, KmSession session, KmAccount account) async {
    final values = SealedValues(_store, _vault.requireSession());
    await kmKeepSignIn(values, KmSignedIn(session: session, account: account));
    final target = KemlockTarget(
      accountId: session.userId,
      email: pending.email,
      servers: [KemlockServer(url: pending.server.toString())],
      deviceId: session.deviceId,
    );
    pending.close();
    _pending = null;
    // A vault that syncs with Vaultwarden on this server, or with WebDAV, moves into Kemlock Server before the old store is let go
    final move = await _holdForMove(this, target);
    if (move != null) return move;
    await _forgetScope(kemlockScope);
    await _replacePlaces(_settings.copyWith(personal: null, vaultwarden: null, kemlock: target));
    return _done();
  }

  /// Saves [next] as the one place the browser syncs with: the other places it had are left, and the sessions with them.
  Future<void> _replacePlaces(SyncSettings next) async {
    _kemlock?.dispose();
    _kemlock = null;
    _vaultwarden = null;
    await _saveSettings(next);
  }

  // ─── WebDAV ─────────────────────────────────────────────────────────

  Future<Map<String, Object?>> signInWebdav(Map<String, Object?> input) async {
    _vault.requireSession();
    final refused = addressProblem(input['folder'], other: 'folder');
    if (refused != null) return _refused(refused);
    return _guard(() async {
      _dropPending();
      final dav = DavAccount(
        url: input['folder']! as String,
        username: input['username']! as String,
        password: input['password']! as String,
      );
      final client = _vault.platform.clientFor(null);
      try {
        final existing = await WebDav(client).readFile(dav, syncFile);
        // Joining an existing sync: its salt gives the same key, and the file proves the passphrase. A space's file has no
        // passphrase salt, and isn't this folder's vault sync
        final kdf = existing != null ? readKdf(existing.text) : newKdf();
        if (kdf == null) throw const SyncFileError(SyncFileProblem.format);
        _pending = _PendingDav(dav: dav, existing: existing, kdf: kdf);
      } finally {
        client.close();
      }
      return {'step': 'passphrase'};
    });
  }

  Future<Map<String, Object?>> _answerDav(_PendingDav pending, String passphrase) async {
    if (passphrase.length < 8) return {'step': 'error', 'problem': 'shortPassphrase'};
    final key = await deriveSyncKey(passphrase, pending.kdf);
    final existing = pending.existing;
    // The file proves the passphrase: a wrong one throws here, and nothing is stored
    final doc = existing == null ? const SyncDoc() : await decryptSyncFile(existing.text, key);
    pending.target = SyncTarget(dav: pending.dav, file: syncFile, key: b64(key), kdf: pending.kdf);
    // What the first sync does, before it runs (spec): the entries it brings, and the ones it takes off
    final here = _vault.lists.ids.toSet();
    final gone = {for (final tombstone in doc.deleted) tombstone.id};
    return {'step': 'firstSync', 'adds': doc.ids.where((id) => !here.contains(id)).length, 'removes': here.where(gone.contains).length};
  }

  Future<Map<String, Object?>> _firstSyncDav(_PendingDav pending, {required bool go}) async {
    final target = pending.target;
    if (target == null) throw _noStep;
    if (!go) {
      _dropPending();
      return {'step': 'error', 'problem': 'cancelled'};
    }
    pending.close();
    _pending = null;
    await _forgetScope(personalScope);
    await _replacePlaces(_settings.copyWith(personal: target, vaultwarden: null, kemlock: null));
    return _done();
  }

  // ─── Vaultwarden ────────────────────────────────────────────────────

  Future<Map<String, Object?>> signInVaultwarden(Map<String, Object?> input) async {
    _vault.requireSession();
    final refused = addressProblem(input['server']);
    if (refused != null) return _refused(refused);
    return _guard(() async {
      _dropPending();
      final client = _vault.platform.clientFor(null);
      final setup = VwAccountSetup(
        VwApi(client, clock: _clock, info: _vwInfo),
        clock: _clock,
      )..canReachKey = true;
      final pending = _PendingVw(setup: setup, client: client, password: input['password']! as String, deviceId: newUuid());
      _pending = pending;
      await setup.connect(input['server']! as String, input['email']! as String);
      return _afterVaultwarden(pending, await setup.signIn(pending.password!, deviceId: pending.deviceId));
    });
  }

  static const _vwSecondMethods = {
    VwTwoFactor.authenticator: 'authenticator',
    VwTwoFactor.email: 'email',
    VwTwoFactor.yubikey: 'yubikey',
    VwTwoFactor.webauthn: 'securityKey',
    VwTwoFactor.duo: 'duo',
  };

  Future<Map<String, Object?>> _afterVaultwarden(_PendingVw pending, VwSignInStep step) async {
    switch (step) {
      case VwSignInNeedsStep():
        pending.second = step;
        return _secondStepOfVaultwarden(pending, step);
      case VwSignInDone(:final credentials):
        final backend = _vwBackend();
        await backend.saveCredentials(credentials);
        final connection = pending.connection = pending.setup.connection(credentials, onCredentials: backend.saveCredentials);
        final found = pending.found = await pending.setup.readVault(connection);
        if (found.homes.isEmpty) return {'step': 'error', 'problem': 'homeMissing'};
        return {
          'step': 'homes',
          'homes': [
            for (final info in found.homes)
              {
                'id': info.home.id,
                'name': info.home.name,
                'storage': info.home.mode == VaultwardenMode.sealed ? 'sealed' : 'plain',
                'items': info.entries,
              },
          ],
        };
    }
  }

  Map<String, Object?> _secondStepOfVaultwarden(_PendingVw pending, VwSignInNeedsStep step) {
    final methods = <String>[
      for (final provider in step.supported) ?_vwSecondMethods[provider],
      // The personal API key signs in without a second step, so it is always there when a step is owed
      'apiKey',
    ];
    return {
      'step': 'second',
      'methods': methods,
      'unsupported': [
        for (final provider in step.providers)
          if (!step.supported.contains(provider) && provider != VwTwoFactor.remember) _vwSecondMethods[provider] ?? 'provider$provider',
      ],
      'emailHint': ?step.emailHint,
    };
  }

  /// Where the browser asks a security key for the pending second step (design decision 13): the server's own address, the
  /// web vault's WebAuthn connector page, and the challenge it takes. Null without a security-key step.
  Map<String, Object?>? securityKeyChallenge() {
    final pending = _pending;
    if (pending is! _PendingVw) return null;
    final step = pending.second;
    final challenge = step?.keyChallenge;
    if (step == null || challenge == null || step.keyOffer != VwKeyOffer.offered) return null;
    return {
      'domain': vwKeyOrigin(pending.setup.server),
      'path': '/webauthn-fallback-connector.html',
      'data': jsonEncode({
        'challenge': challenge.challenge,
        'timeout': challenge.timeout.inMilliseconds,
        'rpId': challenge.rpId,
        'allowCredentials': [
          for (final id in challenge.allowCredentials) {'type': 'public-key', 'id': b64url(id)},
        ],
        'userVerification': 'discouraged',
      }),
    };
  }

  /// Reads the server's own answer about itself, before any password is asked for (browser-sync spec: "The server is checked
  /// first"): a Kemlock Server's `/kem/v1/config`, a Vaultwarden's `/api/config`. The problem is the sync problem the setup says.
  Future<Map<String, Object?>> checkServer(String place, String server) async {
    final refused = addressProblem(server);
    if (refused != null) return {'ok': false, 'problem': refused};
    final client = _vault.platform.clientFor(null);
    try {
      switch (place) {
        case 'kemlock':
          await KmApi(client, clock: _clock).config(kmServerUrl(server));
        case 'vaultwarden':
          await VwApi(client, clock: _clock, info: _vwInfo).config(vwServerUrl(server));
        default:
          throw const CoreFailure(CoreFailure.invalid, 'no such place');
      }
      return {'ok': true};
    } on CoreFailure {
      rethrow;
    } catch (error) {
      return {'ok': false, 'problem': problemOf(error).name};
    } finally {
      client.close();
    }
  }

  VaultwardenBackend _vwBackend() => _vaultwarden ??= VaultwardenBackend(
    vault: _store,
    session: _vault.requireSession(),
    clientFor: _vault.platform.clientFor,
    info: _vwInfo,
    websiteFor: (issuer) {
      final domain = _vault.directory?.findService(issuer)?.domain;
      return domain == null || domain.isEmpty ? null : 'https://$domain';
    },
    clock: _clock,
  );

  Future<Map<String, Object?>> _answerVaultwarden(_PendingVw pending, Map<String, Object?> answer) async {
    final setup = pending.setup;
    switch (answer['step']) {
      case 'second':
        final method = answer['method'];
        final code = (answer['code'] as String? ?? '').trim();
        final remember = answer['remember'] == true;
        final password = pending.password!;
        switch (method) {
          case 'email' when code.isEmpty:
            // Asking for the code: the server sends it, and the step is the same
            await setup.sendEmailCode();
            return _secondStepOfVaultwarden(pending, pending.second!);
          case 'apiKey':
            final parts = code.split(':');
            if (parts.length != 2) throw const CoreFailure(CoreFailure.invalid, 'the API key is client_id:client_secret');
            return _afterVaultwarden(pending, await setup.signInWithApiKey(parts[0], parts[1], password, deviceId: pending.deviceId));
          default:
            final provider = _vwSecondMethods.entries.where((entry) => entry.value == method).firstOrNull?.key;
            if (provider == null || provider == VwTwoFactor.duo || provider == VwTwoFactor.webauthn) {
              throw const CoreFailure(CoreFailure.invalid, 'a second step this browser cannot answer');
            }
            return _afterVaultwarden(
              pending,
              await setup.signIn(
                password,
                deviceId: pending.deviceId,
                step: VwSecondStep(provider: provider, code: code, remember: remember),
              ),
            );
        }
      case 'securityKey':
        return _afterVaultwarden(
          pending,
          await setup.signIn(
            pending.password!,
            deviceId: pending.deviceId,
            step: VwSecondStep(
              provider: VwTwoFactor.webauthn,
              code: answer['assertion'] as String? ?? '',
              remember: answer['remember'] == true,
            ),
          ),
        );
      case 'homes':
        final id = answer['homeId'];
        final info = pending.found?.homes.where((home) => home.home.id == id).firstOrNull;
        if (info == null) throw const CoreFailure(CoreFailure.notFound, 'no such home');
        pending.home = info;
        if (info.home.mode == VaultwardenMode.sealed) return {'step': 'passphrase'};
        return _firstSyncOf(pending, await setup.joinHome(info));
      case 'passphrase':
        final info = pending.home;
        if (info == null) throw _noStep;
        return _firstSyncOf(pending, await setup.joinHome(info, passphrase: answer['passphrase'] as String? ?? '', derive: deriveVaultKey));
      case 'firstSync':
        final target = pending.target;
        if (target == null) throw _noStep;
        if (answer['go'] != true) {
          // Not joined: the session it signed in with goes too
          _vwBackend().forgetCredentials();
          _dropPending();
          return {'step': 'error', 'problem': 'cancelled'};
        }
        _homeName = pending.home?.home.name;
        pending.close();
        _pending = null;
        await _forgetScope(vaultwardenScope);
        await _replacePlaces(_settings.copyWith(personal: null, kemlock: null, vaultwarden: target));
        return _done();
    }
    throw _noStep;
  }

  /// What the first sync does, before it runs (spec): the entries it brings and the ones it takes off.
  Future<Map<String, Object?>> _firstSyncOf(_PendingVw pending, VaultwardenTarget target) async {
    pending.target = target;
    final preview = await pending.setup.previewFirstSync(pending.connection!, _vault.lists, target: target);
    return {'step': 'firstSync', 'adds': preview.fromVault.values.fold<int>(0, (sum, n) => sum + n), 'removes': preview.removedHere};
  }

  // ─── Runs ───────────────────────────────────────────────────────────

  /// The proofs a session's device key signs, found again by its reference.
  Future<KmProofs?> _proofsFor(KmSession session) async {
    final tag = session.deviceKey?['tag'];
    if (tag is! String) return null;
    final cached = _dpops[tag];
    if (cached != null) return cached;
    final key = await _vault.platform.deviceKeys.open(tag);
    return key == null ? null : _dpops[tag] = KmDpop(key, clock: _clock);
  }

  KmHost _kmHost() => _kemlock ??= KmHost(
    values: SealedValues(_store, _vault.requireSession()),
    clientFor: _vault.platform.clientFor,
    proofsFor: _proofsFor,
    // The anchors of the account's spaces travel with the vault's own scope, as the phone's do
    anchors: kmAnchorsOf(anchors, _vault.requireSession()),
    clock: _clock,
    // Server matching (the duplicate cleaner): how a login's site is read for its `cred` tags, what the server suggested, and the
    // switch following the server's
    dedupSites: () async => SiteResolver(registrable: _vault.matcher.registrable, isShared: isSharedHost),
    onHints: (hints) => kemlockHints = hints,
    onMatching: _followMatching,
  );

  // ─── Spaces (docs/plans/add-spaces.md) ──────────────────────────────

  @override
  KemlockTarget? get kemlockTarget => _settings.kemlock;

  @override
  SyncSettings get syncSettings => _settings;

  @override
  Future<void> saveSyncSettings(SyncSettings next) => _saveSettings(next);

  @override
  Map<String, ScopeState> get scopeStates => _states;

  @override
  Future<void> saveScopeStates() => _saveStates();

  @override
  Future<T> withAccount<T>(Future<T> Function(KmConnection connection, KmAccount account) action) {
    final target = _settings.kemlock;
    if (target == null) throw const CoreFailure(CoreFailure.invalid, 'the vault does not sync with Kemlock Server');
    return _kmHost().withAccount(target, action);
  }

  @override
  String? homeAway() {
    final target = _settings.kemlock;
    if (target == null) return null;
    try {
      _kmHost().requireHome(target);
      return null;
    } on KmHomeAway {
      // The name of the home, which is what the person waits for, not of the replica in use
      return _kmHost().homeUrl(target).host;
    }
  }

  @override
  Uri homeUrl() => _kmHost().homeUrl(_settings.kemlock ?? (throw const CoreFailure(CoreFailure.invalid, 'no Kemlock Server account')));

  @override
  Future<KeyBundle?> ownBundle() => _kmHost().ownBundle();

  @override
  SpaceAnchorStorage get anchors =>
      _anchorStore ??= SyncedSpaceAnchorStore(_store, syncs: () => _settings.personal != null || _settings.kemlock != null);

  @override
  http.Client clientFor() => _vault.platform.clientFor(null);

  /// Runs the spaces' scopes alone (a vault that syncs nowhere else, or the person's "Refresh").
  Future<void> syncSpacesNow() async {
    _vault.requireSession();
    if (_running) {
      _again = true;
      await _current;
      return;
    }
    final run = _current = _runLoop();
    await run;
  }

  /// Added by sends. What Sends need of the sync (sends.dart): Kemlock Server's host and target, or null when the vault doesn't
  /// sync with one (or sync isn't loaded).
  ({KmHost host, KemlockTarget target})? get kemlockPlace {
    final target = _settings.kemlock;
    return !_loaded || target == null ? null : (host: _kmHost(), target: target);
  }

  /// Added by sends. The place the vault's own entries sync with, by the name `status` gives it, or null when sync is off.
  String? get syncPlace {
    if (!_loaded) return null;
    if (_settings.kemlock != null) return 'kemlock';
    if (_settings.vaultwarden != null) return 'vaultwarden';
    return _settings.personal != null ? 'webdav' : null;
  }

  /// The server's groups of the vault's logins as the last run on the home read them, or null before one, with matching off, and
  /// once the vault locks. The cleaner opens the items and compares them before it shows any (tools).
  KmHints? kemlockHints;

  /// The host that runs Kemlock Server's calls for the open vault, for what happens outside a sync run (tools).
  KmHost kemlockHost() => _kmHost();

  /// Keeps [next] as the Kemlock Server settings (tools: the matching switch).
  Future<void> saveKemlockTarget(KemlockTarget next) => _saveSettings(_settings.copyWith(kemlock: next));

  /// Matching turned off on another device is off here too: the phone's switch follows the server's.
  void _followMatching(bool enabled) {
    final target = _settings.kemlock;
    if (!enabled && target != null && target.matching) {
      unawaited(_saveSettings(_settings.copyWith(kemlock: target.copyWith(matching: false))));
    }
  }

  /// Runs the vault's sync once: the place the settings name, then whatever changed meanwhile.
  Future<Map<String, Object?>> syncNow() async {
    _vault.requireSession();
    if (!_settings.syncsOwnEntries && _settings.spaces.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'sync is off');
    if (_running) {
      _again = true;
      await _current;
      return _statusOrDone();
    }
    final run = _current = _runLoop();
    await run;
    return _statusOrDone();
  }

  Future<void> _runLoop() async {
    _running = true;
    try {
      do {
        _again = false;
        await _runOnce();
        // The spaces go after the vault's own scope; one the person changed under is run again with the rest
        if (!_again && await spaces.runAll()) _again = true;
      } while (_again);
    } finally {
      _running = false;
      _current = null;
    }
  }

  /// Which scope the settings sync the vault's own entries in, and the run for it.
  Future<void> _runOnce() async {
    final settings = _settings;
    final session = _vault.requireSession();
    // While a move is unfinished the vault's own entries don't sync: the move runs the old store's last run itself
    if (settings.kemlock != null && await _moveUnfinished(this, session)) return;
    final String key;
    final Future<({SyncDoc doc, List<String> known, Map<String, Object?> state, int skipped})> Function(Lists, ScopeState, int) run;
    http.Client? client;
    if (settings.kemlock case final target?) {
      key = kemlockScope;
      run = (local, state, now) => _kmHost().sync(target, local, state, now: now, choice: _removalChoice);
    } else if (settings.vaultwarden case final target?) {
      key = vaultwardenScope;
      run = (local, state, now) async {
        final result = await _vwBackend().sync(target, local, state, now: now, choice: _removalChoice);
        return (doc: result.doc, known: result.known, state: result.state, skipped: result.skipped);
      };
    } else if (settings.personal case final target?) {
      key = personalScope;
      final dav = WebDav(client = _vault.platform.clientFor(null));
      run = (local, state, now) async {
        // The core's run of a folder has no removal guard of its own: look before it writes, and stop when it would remove much
        if (_removalChoice == RemovalChoice.keep) return _keepFolder(dav, target, local, state, now);
        final lost = await _guardFolder(dav, target, local, state, now);
        final result = await runWebDavScope(webDav: dav, target: target, local: local, state: state, now: now);
        return (doc: result.doc, known: result.known, state: {...result.state, lostKey: lost}, skipped: 0);
      };
    } else {
      return;
    }
    try {
      final revision = _vault.revision;
      var lists = _vault.lists;
      final state = _states[key] ?? const ScopeState(known: []);
      final ({SyncDoc doc, List<String> known, Map<String, Object?> state, int skipped}) result;
      try {
        result = await run(scopeLists(lists, null), state, _clock().millisecondsSinceEpoch);
      } catch (error) {
        final problem = problemOf(error);
        final count = _countOf(error);
        _status[key] = ScopeStatus(
          lastSyncAt: state.lastSyncAt,
          problem: problem,
          count: count,
          // A folder's stop knows the scope and what would go; the servers' engines say the count only
          scope: error is _FolderRemovals ? error.scope : (problem == SyncProblem.removals ? max(count, lists.ids.length) : 0),
          items: error is _FolderRemovals ? error.items : const [],
        );
        return;
      }
      if (!identical(session, _vault.session)) return;
      if (_vault.revision != revision) {
        // The person changed something meanwhile: what the run read is out of date, and a new run merges that in
        _again = true;
        return;
      }
      final keptOut = heldElsewhere(lists, null, result.doc);
      lists = applyScope(lists, null, result.doc);
      final at = _clock().millisecondsSinceEpoch;
      final known = keptOut.isEmpty ? result.known : [...result.known.where((id) => !keptOut.contains(id))];
      // The vault's write lock checks the revision again once this has its turn: a save ahead of it makes the run out of date too
      if (!sameLists(lists, _vault.lists) && !await _vault.applySynced(lists, ifRevision: revision)) {
        _again = true;
        return;
      }
      _states[key] = ScopeState(known: known, lastSyncAt: at, extra: result.state);
      await _saveStates();
      _status[key] = ScopeStatus(lastSyncAt: at);
      _removalChoice = null;
    } finally {
      client?.close();
    }
  }

  /// The removal guard for a folder's run, which the core's run leaves to its caller (spec): the entries the merge would take off
  /// this browser or off the file, counted as the servers' runs count them. Throws when the run must stop and ask; otherwise
  /// answers the runs of the last day to keep in the scope's state.
  Future<List<List<int>>> _guardFolder(WebDav dav, SyncTarget target, Lists local, ScopeState state, int now) async {
    final file = await dav.readFile(target.dav, target.file);
    final remote = file == null ? null : await decryptSyncFile(file.text, unb64(target.key));
    final merged = mergeScope(await combineKeyCopies(local, remote), state.known, remote, now: now).doc.ids.toSet();
    final here = local.ids.toSet();
    final there = (remote?.ids ?? const <String>[]).toSet();
    final removals = {...here, ...there}.difference(merged).length;
    final removedHere = here.difference(merged).length;
    final guard = checkRemovals(
      removals: removals,
      removedHere: removedHere,
      scope: here.length > there.length ? here.length : there.length,
      recent: lostLately(state.extra, now),
      now: now,
      choice: _removalChoice,
    );
    if (guard.stop) {
      final names = {..._removalNames(remote ?? const SyncDoc()), ..._removalNames(local)};
      final items = [
        for (final id in {...here, ...there}.difference(merged)) ?names[id],
      ]..sort((a, b) => a.kind == b.kind ? a.name.toLowerCase().compareTo(b.name.toLowerCase()) : a.kind.compareTo(b.kind));
      throw _FolderRemovals(removals, here.length > there.length ? here.length : there.length, items.take(_removalListLimit).toList());
    }
    return guard.lostJson;
  }

  /// A folder's run that keeps everything ("Keep" after the removal guard): what the file's deletions and this browser's
  /// own missing entries would take off either side stays, and comes back from the other, as the servers' engines do with
  /// `RemovalChoice.keep`. The merge is `syncScope`'s, with the file's tombstones left out and no entry counted as known.
  Future<({SyncDoc doc, List<String> known, Map<String, Object?> state, int skipped})> _keepFolder(
    WebDav dav,
    SyncTarget target,
    Lists local,
    ScopeState state,
    int now,
  ) async {
    final key = unb64(target.key);
    final seen = seenSeq(state.extra);
    for (var attempt = 1; ; attempt++) {
      final file = await dav.readFile(target.dav, target.file);
      final read = file == null ? null : await decryptSyncFile(file.text, key);
      final count = read?.seq;
      if (count != null && seen != null && count < seen) {
        if (attempt < 3) continue;
        throw const SyncFileError(SyncFileProblem.older);
      }
      final remote = read == null ? null : _withoutDeletions(read, read.seq);
      final merged = mergeScope(await combineKeyCopies(local, remote), const [], remote, now: now);
      final next = max(count ?? 0, seen ?? 0) + 1;
      final written = remote != null && sameDoc(merged.doc, remote) && read != null && read.deleted.isEmpty;
      if (!written) {
        try {
          await dav.writeFile(
            target.dav,
            target.file,
            await encryptSyncFile(_withoutDeletions(merged.doc, next), key, kdf: target.kdf),
            etag: file?.etag,
            mustNotExist: file == null,
          );
        } on DavError catch (error) {
          if (error.problem == DavProblem.conflict && attempt < 3) continue;
          rethrow;
        }
      }
      return (
        doc: merged.doc,
        known: merged.known,
        state: {
          ...withSeenSeq(state.extra, written ? (count ?? seen) : next),
          lostKey: lostLately(state.extra, now).map((run) => [run.at, run.count]).toList(),
        },
        skipped: 0,
      );
    }
  }

  /// [doc] with no deletions, counting [seq].
  SyncDoc _withoutDeletions(SyncDoc doc, int? seq) => SyncDoc(
    accounts: doc.accounts,
    backupServices: doc.backupServices,
    keys: doc.keys,
    notes: doc.notes,
    passkeys: doc.passkeys,
    keyAccounts: doc.keyAccounts,
    contacts: doc.contacts,
    logins: doc.logins,
    cards: doc.cards,
    identities: doc.identities,
    seq: seq,
    extra: doc.extra,
  );

  int _countOf(Object error) => switch (error) {
    VwSyncError(:final count) => count,
    KmSyncError(:final count) => count,
    _ => 0,
  };

  /// The removal guard's question answered "remove": the run goes on with the removals.
  Future<Map<String, Object?>> confirmRemovals() {
    _removalChoice = RemovalChoice.remove;
    return syncNow();
  }

  /// The removal guard's question answered "keep": the run goes on once with no deletion either way.
  Future<Map<String, Object?>> keepRemovals() {
    _removalChoice = RemovalChoice.keep;
    return syncNow();
  }

  // ─── Signing out ────────────────────────────────────────────────────

  Future<void> signOut() async {
    final session = _vault.requireSession();
    final settings = _settings;
    _dropPending();
    _accountState.reset();
    if (settings.kemlock case final target?) {
      try {
        // Ends this device's session on the server; one that can't be reached throws, and the session is forgotten here anyway
        await _kmHost().signOut(target);
      } catch (_) {
        // Forgotten here all the same
      }
      final values = SealedValues(_store, session);
      for (final key in [keyKemlockSession, keyKemlockAccount, keyKemlockCache, keyKemlockMove]) {
        values.remove(key);
      }
      final tag = deviceKeyTag(_vault.registry.active);
      _dpops.remove(tag);
      await _vault.platform.deviceKeys.delete(tag);
      await _forgetScope(kemlockScope);
    }
    if (settings.vaultwarden != null) {
      _vwBackend().forgetCredentials();
      _store.removeEncryptedValue(keyVaultwardenCache);
      await _forgetScope(vaultwardenScope);
    }
    if (settings.personal != null) await _forgetScope(personalScope);
    await _replacePlaces(settings.copyWith(personal: null, vaultwarden: null, kemlock: null));
  }

  /// Takes the words of the word list, for the five words of an approval.
  static List<String> words(String text) => parseWordList(text);
}

/// What the sync reads from the data the background gave the core.
class CoreDataAccess {
  CoreDataAccess(this._vault);

  final VaultService _vault;

  List<String>? _words;

  /// The EFF word list, or null without it.
  List<String>? get wordList {
    final text = _vault.data.wordList;
    if (text == null || text.isEmpty) return null;
    final words = _words ??= parseWordList(text);
    return words.isEmpty ? null : words;
  }

  /// The list as the five words of an approval take it: EFF's whole list, and no other.
  List<String>? get approvalWords {
    final words = wordList;
    return words != null && words.length == effWordCount ? words : null;
  }
}
