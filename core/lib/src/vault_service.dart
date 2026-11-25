// The browser's vault: the app's `VaultStore` over `storage.local`, opened with a password, and the changes the extension
// makes to what it holds (browser-vault and browser-popup specs). Every format is Kemlock-core's; this only asks it to read and
// write, and keeps the open vault's lists in memory.
import 'dart:convert';
import 'dart:typed_data';

import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/core/public_suffix_list.dart';
import 'package:kemlock_core/core/storage/key_value_store.dart';
import 'package:kemlock_core/core/websites.dart';
import 'package:kemlock_core/crypto/aes_gcm.dart';
import 'package:kemlock_core/crypto/bytes.dart' show b64;
import 'package:kemlock_core/features/accounts/otp.dart';
import 'package:kemlock_core/features/accounts/otpauth.dart';
import 'package:kemlock_core/features/accounts/service_names.dart';
import 'package:kemlock_core/features/sync/sync_merge.dart';
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/contact.dart';
import 'package:kemlock_core/models/generated_password.dart';
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/json.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_entry.dart';
import 'package:kemlock_core/models/vault_key.dart';
import 'package:kemlock_core/vault/sealed_value.dart' show isAuthenticatedWrapNonce;
import 'package:kemlock_core/vault/vault_registry.dart';
import 'package:kemlock_core/vault/vault_store.dart';

import 'directory.dart';
import 'failure.dart';
import 'health.dart';
import 'item_views.dart';
import 'matching.dart';
import 'passkey_unlock.dart';
import 'platform.dart';
import 'pwned.dart';
import 'qr.dart';
import 'session_seal.dart';
import 'views.dart';

part 'vault_items.dart';

/// The count of wrong passwords, in the app's own key and format: `{"count": n, "last": ms}`, in the clear like the vault's
/// config (openspec: harden-unlock-and-clipboard).
const keyUnlockFailures = 'backmycodes_unlock_failures';

/// The extension's own settings, sealed in the vault like the app's.
const keyExtensionSettings = 'backmycodes_extension_settings';

/// "Always suggest here": the items the person picked on each host, `{host: [itemId]}`, sealed in the vault, never synced, and
/// deleted with it. Only the open vault can read or change them.
const keyExtensionPicks = 'backmycodes_extension_picks';

/// The order the person gave their logins in this browser, sealed in the vault and never synced: the app keeps no order for logins
/// (it sorts them by name), and a key of its own on a login would be a format change, so the order stays in the extension.
const keyExtensionLoginOrder = 'backmycodes_extension_login_order';

/// The extension's settings, as `Settings` in src/shared/api.ts, with their defaults (browser-vault and browser-popup specs).
Map<String, Object?> defaultSettings() => {
  'autoLockMinutes': 5,
  'lockOnSleep': true,
  'codeAfterPassword': true,
  'buttonsOnPages': false,
  'breachedPasswords': false,
  'offerToSave': true,
  'passkeys': true,
  'clipboardSeconds': 30,
};

/// The settings [raw] holds on top of the defaults, with each value held to the type and values the extension takes.
Map<String, Object?> readSettings(Object? raw, [Map<String, Object?>? base]) {
  final settings = {...?base, ...defaultSettings().map((key, value) => MapEntry(key, base?[key] ?? value))};
  if (raw is! Map<String, Object?>) return settings;
  final minutes = raw['autoLockMinutes'];
  if (minutes is int && const [1, 5, 15, 60].contains(minutes)) settings['autoLockMinutes'] = minutes;
  final seconds = raw['clipboardSeconds'];
  if (seconds is int && seconds >= 1 && seconds <= 3600) settings['clipboardSeconds'] = seconds;
  for (final name in const ['lockOnSleep', 'codeAfterPassword', 'buttonsOnPages', 'breachedPasswords', 'offerToSave', 'passkeys']) {
    final value = raw[name];
    if (value is bool) settings[name] = value;
  }
  return settings;
}

/// The picks [raw] holds: hosts with the ids picked on them; anything else in it is dropped.
Map<String, List<String>> readPicks(Object? raw) {
  final picks = <String, List<String>>{};
  if (raw is! Map<String, Object?>) return picks;
  for (final MapEntry(:key, :value) in raw.entries) {
    if (value is! List<Object?>) continue;
    final ids = value.whereType<String>().toSet().toList();
    if (key.isNotEmpty && ids.isNotEmpty) picks[key] = ids;
  }
  return picks;
}

/// A save that failed and could not be written back whole: storage may hold part of the change, and the lists in memory are as they were.
class PartialSave implements Exception {
  const PartialSave(this.cause);

  /// What made the save fail.
  final Object cause;

  @override
  String toString() => 'PartialSave(${cause.runtimeType})';
}

/// The order [raw] holds: login ids, each once; anything else in it is dropped.
List<String> readOrder(Object? raw) => raw is List<Object?> ? raw.whereType<String>().toSet().toList() : <String>[];

/// A code's secret as it is compared: upper case, with no spaces, dashes or '=' padding, as the app's otpauth parsing reads it.
String comparableSecret(String secret) => normalizeSecret(secret).replaceAll('=', '');

/// The vault.
class VaultService {
  VaultService._(this.platform, this.data, this.store, this.registry, this.vault);

  /// Opens the browser's storage and what the core reads from it.
  static Future<VaultService> start(CorePlatform platform, CoreData data) async {
    final store = await KeyValueStore.open(platform.storage);
    final registry = VaultRegistry(store);
    // An erase of the vault that the browser stopped in the middle of is finished before anything reads it
    registry.finishCutShortErase();
    return VaultService._(platform, data, store, registry, VaultStore(store, registry, clock: platform.clock));
  }

  final CorePlatform platform;
  final CoreData data;
  final KeyValueStore store;
  final VaultRegistry registry;
  final VaultStore vault;

  /// The passkeys, Windows Hello and security keys that open the vault beside its password (docs/plans/add-passkey-unlock.md).
  late final PasskeyUnlock passkeyUnlock = PasskeyUnlock(store, registry, platform.clock);
  // Spaces (docs/plans/add-spaces.md), set by the core service: refuses a change to an entry of a space this account may not edit,
  // and describes the space an item is in for its view.
  void Function(String? space, String entryId)? editGuard;
  Map<String, Object?>? Function(String? space, String entryId, {bool login})? spaceNote;

  /// Whether the password of the login in [space] is hidden from this account: it takes no part in health, and is never sent to a
  /// breach check, as the app does.
  bool Function(String? space, String entryId)? passwordHides;

  bool _hidden(Login login) => passwordHides?.call(login.spaceId, login.id) ?? false;

  /// The ids of the open vault's logins whose password is hidden from this account.
  Set<String> get hiddenPasswordIds => {
    for (final login in _lists.logins)
      if (_hidden(login)) login.id,
  };

  /// [logins] with every hidden password taken out, for what compares passwords and must never know a hidden one (health does the
  /// same): the duplicate cleaner matches on these.
  List<Login> withoutHiddenPasswords(List<Login> logins) => [
    for (final login in logins) _hidden(login) ? login.copyWith(password: unset) : login,
  ];

  VaultSession? _session;
  List<GeneratedPassword> _generated = [];
  Map<String, List<String>> _picks = {};
  List<String> _loginOrder = [];
  Lists _lists = const Lists();
  Map<String, Object?> _settings = defaultSettings();
  var _revision = 0;

  /// The open vault's keys, or null while it is locked.
  VaultSession? get session => _session;

  /// What the open vault holds (empty while it is locked).
  Lists get lists => _lists;

  /// Counts the changes made in the browser since the vault opened, so a sync that raced one is thrown away.
  int get revision => _revision;

  int get nowMs => platform.clock().millisecondsSinceEpoch;

  // Added by transfer (begin): what the transfer page asks of the vault (transfer_service.dart).

  /// How many wrong passwords [confirmPassword] has been given since the vault opened: each one makes the next try wait longer.
  var _confirmFailures = 0;

  /// The wait before the next try after [failures] wrong ones: one second, then two, four, and so on, to at most thirty.
  static Duration confirmDelay(int failures) => failures <= 0 ? Duration.zero : Duration(seconds: failures >= 6 ? 30 : 1 << (failures - 1));

  /// Whether [password] is the open vault's, for what asks the person to show it is them again (an export). Nothing opens and nothing
  /// is written but the count of wrong passwords, which a wrong one adds to as one at the lock screen does and a right one clears:
  /// only the active vault is tried, and it stays the active one. A wrong password makes the next try wait longer (a second, then two,
  /// four, up to thirty), so that the open page can't be used to guess the password quickly.
  Future<bool> confirmPassword(String password) async {
    requireSession();
    final wait = confirmDelay(_confirmFailures);
    if (wait > Duration.zero) await Future<void>.delayed(wait);
    final before = _failures();
    final key = registry.vaultKey(keyUnlockFailures);
    store.setItem(key, jsonEncode(UnlockCount(count: before.count + 1, last: nowMs).toJson()));
    await store.flush();
    if (!await vault.passwordOpens(password, registry.active)) {
      _confirmFailures++;
      return false;
    }
    _confirmFailures = 0;
    store.setItem(key, jsonEncode(const UnlockCount().toJson()));
    await store.flush();
    return true;
  }

  /// Checks that [next] changes or removes no entry of a space the verified chain doesn't let this account edit (docs/plans/add-spaces.md),
  /// as the single-entry saves do, before anything is written. What it adds is not checked: an added entry is the vault's own.
  void _guardChanges(Lists next) {
    final now = _lists;
    void guard<T extends VaultEntry<T>>(List<T> after, List<T> before) {
      final kept = <String, String>{for (final e in after) e.id: canonical(e.toJson()).toString()};
      for (final e in before) {
        if (kept[e.id] != canonical(e.toJson()).toString()) editGuard?.call(e.spaceId, e.id);
      }
    }

    guard(next.accounts, now.accounts);
    guard(next.backupServices, now.backupServices);
    guard(next.keys, now.keys);
    guard(next.notes, now.notes);
    guard(next.passkeys, now.passkeys);
    guard(next.keyAccounts, now.keyAccounts);
    guard(next.contacts, now.contacts);
    guard(next.logins, now.logins);
    guard(next.cards, now.cards);
    guard(next.identities, now.identities);
  }

  /// [next], a change made to [now] (the lists the write holds, so this runs inside a builder), with every entry [_guardChanges] would
  /// refuse put back as [now] has it, and how many that was: a change to an entry of a space this account may not edit is left out, not
  /// made, for the bulk changes (a tag renamed, a merge, an import) that should do what they can and say what they skipped. The guard
  /// itself is not loosened: a change to one entry still fails as it did, and so does [saveChanged] when it is given an entry of such a
  /// space. What [next] adds is kept, as the guard lets it be.
  ({Lists lists, int skipped}) keepingEditable(Lists now, Lists next) {
    var skipped = 0;
    List<T> restoring<T extends VaultEntry<T>>(List<T> after, List<T> before) {
      final kept = {for (final e in after) e.id: e};
      final refused = <String>{};
      for (final e in before) {
        final changed = kept[e.id] == null || canonical(kept[e.id]!.toJson()).toString() != canonical(e.toJson()).toString();
        if (!changed) continue;
        try {
          editGuard?.call(e.spaceId, e.id);
        } on CoreFailure {
          refused.add(e.id);
        }
      }
      if (refused.isEmpty) return after;
      skipped += refused.length;
      final held = {for (final e in before) e.id: e};
      return [
        for (final e in after)
          if (refused.contains(e.id)) held[e.id]! else e,
        // What the change took away, and the guard refuses, stays
        for (final id in refused)
          if (!kept.containsKey(id)) held[id]!,
      ];
    }

    return (
      lists: Lists(
        accounts: restoring(next.accounts, now.accounts),
        backupServices: restoring(next.backupServices, now.backupServices),
        keys: restoring(next.keys, now.keys),
        notes: restoring(next.notes, now.notes),
        passkeys: restoring(next.passkeys, now.passkeys),
        keyAccounts: restoring(next.keyAccounts, now.keyAccounts),
        contacts: restoring(next.contacts, now.contacts),
        logins: restoring(next.logins, now.logins),
        cards: restoring(next.cards, now.cards),
        identities: restoring(next.identities, now.identities),
      ),
      skipped: skipped,
    );
  }

  // ─── The write lock ───────────────────────────────────────────────────

  /// The end of the writes queued so far: the next write starts when it is done.
  Future<void> _tail = Future<void>.value();

  /// Runs [work] after every write queued before it has finished, and holds the ones after it until it has. Every write to the store
  /// goes through here (a save, a sync's answer, an import), so that two of them never interleave across their waits and lose one:
  /// each re-reads the lists once it has the lock. A failed write passes its failure to its own caller and never blocks the next.
  ///
  /// [work] must not call another locked method (it would wait for itself): a locked method calls only the unlocked bodies.
  Future<T> _locked<T>(Future<T> Function() work) {
    final run = _tail.then((_) => work());
    _tail = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }

  /// Takes the lists an import made: each kind saved only when it changed, and counted as a change made here, so that a sync that
  /// raced it is thrown away and the next one carries it. The count goes up before the first wait, so that a sync that began before
  /// this and ends during it sees the change. [build] makes the lists from the ones the write holds once it has the lock, as for
  /// [saveChanged]; nothing is written when it throws.
  Future<void> saveImported(Lists Function(Lists held) build) {
    _revision++;
    return _locked(() async {
      final session = requireSession();
      final made = build(_lists);
      _guardChanges(made);
      await _writeLists(made, session);
      if (identical(_session, session)) _changed(made);
    });
  }

  // Added by transfer (end)

  VaultSession requireSession() =>
      _session ?? (vault.isVaultSetup() ? throw const CoreFailure(CoreFailure.locked) : throw const CoreFailure(CoreFailure.noVault));

  // ─── Site matching, health ────────────────────────────────────────────

  PublicSuffixList? _suffixes;
  TwoFactorDirectory? _directory;
  SiteMatcher? _matcher;

  /// The matcher over the Public Suffix List and the 2FA directory the background gave, read once.
  SiteMatcher get matcher => _matcher ??= SiteMatcher(suffixes: _readSuffixes(), directory: _readDirectory());

  /// The 2FA directory the background gave, or null without it.
  TwoFactorDirectory? get directory => _readDirectory();

  PublicSuffixList? _readSuffixes() {
    final text = data.publicSuffixList;
    if (text == null || text.isEmpty) return null;
    return _suffixes ??= PublicSuffixList.parse(text);
  }

  TwoFactorDirectory? _readDirectory() {
    final text = data.twoFactorDirectory;
    if (text == null || text.isEmpty) return null;
    try {
      final json = jsonDecode(text);
      return _directory ??= json is Map<String, Object?> ? TwoFactorDirectory.fromJson(json) : null;
    } on FormatException {
      return null;
    }
  }

  // ─── The vault ────────────────────────────────────────────────────────

  UnlockCount _failures() => UnlockCount.parse(store.getItem(registry.vaultKey(keyUnlockFailures)));

  /// The state of the vault as the popup asks for it, without the sync's part.
  Map<String, Object?> state() {
    final failures = _failures();
    return {'exists': vault.isVaultSetup(), 'unlocked': _session != null, 'wrongPasswords': failures.count, 'lastWrongAt': ?failures.last};
  }

  /// Makes the vault, with [password], and opens it.
  Future<void> createVault(String password) async {
    if (vault.isVaultSetup()) throw const CoreFailure(CoreFailure.exists);
    if (password.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'the password is empty');
    final session = await vault.setupVault(password);
    await store.flush();
    await _open(session);
    await passkeyUnlock.passwordUsed();
  }

  /// Opens the vault with [password]; a wrong one is counted, writing the try down before checking it, and doesn't throw.
  Future<({bool ok, int wrongPasswords})> unlock(String password) async {
    if (!vault.isVaultSetup()) throw const CoreFailure(CoreFailure.noVault);
    final before = _failures();
    final key = registry.vaultKey(keyUnlockFailures);
    store.setItem(key, jsonEncode(UnlockCount(count: before.count + 1, last: nowMs).toJson()));
    await store.flush();
    final UnlockStep step;
    try {
      step = await vault.beginUnlock(password, registry.active);
    } on IncorrectPasswordError {
      return (ok: false, wrongPasswords: before.count + 1);
    }
    switch (step) {
      case UnlockNeedsKey(:final pending):
        pending.wipe();
        store.setItem(key, jsonEncode(before.toJson()));
        throw const CoreFailure(CoreFailure.keyNeeded);
      case UnlockOpened(:final session):
        store.setItem(key, jsonEncode(const UnlockCount().toJson()));
        await store.flush();
        await _open(session);
        await passkeyUnlock.passwordUsed();
        return (ok: true, wrongPasswords: before.count);
    }
  }

  /// Checks [password] against the open vault, as an unlock does: the try is written down before it is checked and counted when it is
  /// wrong (`wrongPassword`), and it clears the count when it is right, which also starts the days a passkey may go without the
  /// password over. For what must not be done from an open browser by whoever sits at it, such as adding a credential.
  Future<void> verifyPassword(String password) async {
    if (!vault.isVaultSetup()) throw const CoreFailure(CoreFailure.noVault);
    requireSession();
    final before = _failures();
    final key = registry.vaultKey(keyUnlockFailures);
    store.setItem(key, jsonEncode(UnlockCount(count: before.count + 1, last: nowMs).toJson()));
    await store.flush();
    final UnlockStep step;
    try {
      step = await vault.beginUnlock(password, registry.active);
    } on IncorrectPasswordError {
      throw const CoreFailure('wrongPassword', 'the password is wrong');
    }
    switch (step) {
      case UnlockNeedsKey(:final pending):
        pending.wipe();
        store.setItem(key, jsonEncode(before.toJson()));
        throw const CoreFailure(CoreFailure.keyNeeded);
      case UnlockOpened(:final session):
        // The vault is open already: this key only proved the password, and goes
        session.secretKey.fillRange(0, session.secretKey.length, 0);
        store.setItem(key, jsonEncode(const UnlockCount().toJson()));
        await passkeyUnlock.passwordUsed();
    }
  }

  /// Opens the vault with a passkey, Windows Hello or a security key: [credential] answered with the PRF output [prf]. The result
  /// says why it didn't open: `wrong` for an answer that opens nothing, `stale` for one that opens a key the vault no longer
  /// has. The password is needed instead (`passwordRequired`) after too many failed tries or too long without it. Opening
  /// clears the wrong-password count, as every open on the phone's lock screen does.
  Future<({bool ok, String? reason, int wrongPasswords})> unlockWithPasskey(Uint8List credential, Uint8List prf) async {
    if (!vault.isVaultSetup()) throw const CoreFailure(CoreFailure.noVault);
    // Open already: its keys stay as they are, not replaced by a second copy the first would then leave unwiped
    if (_session != null) return (ok: true, reason: null, wrongPasswords: 0);
    final before = _failures();
    final opened = await passkeyUnlock.open(credential, prf);
    if (opened == null) return (ok: false, reason: 'wrong', wrongPasswords: before.count);
    var nonce = '';
    String? publicKey;
    try {
      final config = store.getItem(registry.vaultKey(keyConfig));
      final json = config == null ? null : jsonDecode(config);
      if (json is Map<String, Object?>) {
        if (json['skNonce'] is String) nonce = json['skNonce']! as String;
        if (json['publicKey'] is String) publicKey = json['publicKey']! as String;
      }
    } on FormatException {
      // A config that can't be read gives nothing to lower: the open below says whether the key fits
    }
    // What the vault demands is never lowered by the way it was opened
    final VaultSession session;
    try {
      session = VaultSession.holding(opened.secretKey, authenticated: opened.authenticated || isAuthenticatedWrapNonce(nonce));
      // The config's public key is only compared, never taken (it is stored in the clear): a key that is not the vault's is stale
      if (publicKey != null && publicKey != b64(session.publicKey)) throw const AesGcmAuthError();
      await _open(session);
    } on AesGcmAuthError {
      opened.secretKey.fillRange(0, opened.secretKey.length, 0);
      return (ok: false, reason: 'stale', wrongPasswords: before.count);
    } on ArgumentError {
      // Bytes that are no ML-KEM private key at all: the same, a key the vault doesn't have
      opened.secretKey.fillRange(0, opened.secretKey.length, 0);
      return (ok: false, reason: 'stale', wrongPasswords: before.count);
    }
    await passkeyUnlock.opened(credential);
    store.setItem(registry.vaultKey(keyUnlockFailures), jsonEncode(const UnlockCount().toJson()));
    await store.flush();
    return (ok: true, reason: null, wrongPasswords: before.count);
  }

  Future<void> _open(VaultSession session) async {
    try {
      _lists = Lists(
        accounts: await vault.loadAccounts(session),
        backupServices: await vault.loadBackupServices(session),
        keys: await vault.loadKeys(session),
        notes: await vault.loadNotes(session),
        passkeys: await vault.loadPasskeys(session),
        keyAccounts: await vault.loadKeyAccounts(session),
        contacts: await vault.loadContacts(session),
        logins: await vault.loadLogins(session),
        cards: await vault.loadCards(session),
        identities: await vault.loadIdentities(session),
      );
      _settings = readSettings(await vault.loadEncryptedValue(keyExtensionSettings, session));
      _picks = readPicks(await vault.loadEncryptedValue(keyExtensionPicks, session));
      _loginOrder = readOrder(await vault.loadEncryptedValue(keyExtensionLoginOrder, session));
      // Generated passwords are kept a month, and until a login holds them; a value that won't open doesn't keep the vault shut
      final stored = await vault
          .loadGenerated(session)
          .then<List<GeneratedPassword>>((list) => list, onError: (Object _) => const <GeneratedPassword>[]);
      final since = nowMs - const Duration(days: generatedPasswordDays).inMilliseconds;
      final held = {for (final login in _lists.logins) ?login.password};
      _generated = [
        for (final item in stored)
          if (item.at >= since && !held.contains(item.password)) item,
      ];
    } catch (_) {
      _forget();
      rethrow;
    }
    _session = session;
    _revision = 0;
    _healthKey = '';
  }

  void _forget() {
    _confirmFailures = 0;
    _session = null;
    _generated = [];
    _picks = {};
    _loginOrder = [];
    _lists = const Lists();
    _settings = defaultSettings();
    _health = LoginHealth.empty;
    _healthKey = '';
    _leaked.clear();
  }

  /// Locks the vault: its keys and contents are forgotten.
  Future<void> lock() async {
    // What the person already did is written first: the writes queued before the lock finish (each is short), and any queued
    // after it find the vault shut
    await _tail;
    final session = _session;
    _forget();
    if (session != null) session.secretKey.fillRange(0, session.secretKey.length, 0);
    await store.flush();
  }

  /// Deletes the vault and everything under it.
  Future<void> removeVault() async {
    await lock();
    vault.wipeVault();
    await store.flush();
  }

  /// The open vault's keys, sealed for `storage.session` (design decision 5).
  Future<String> exportSession() async {
    final session = requireSession();
    return sealSession(
      platform.sessionKey,
      SealedSession(vault: registry.active, secretKey: session.secretKey, authenticated: session.authenticated),
    );
  }

  /// Opens the vault again from what [exportSession] gave; false when it doesn't open (another browser session's).
  Future<bool> restoreSession(String blob) async {
    final sealed = await unsealSession(platform.sessionKey, blob);
    if (sealed == null || !vault.isVaultSetup()) return false;
    try {
      registry.active = sealed.vault;
      await _open(VaultSession.holding(sealed.secretKey, authenticated: sealed.authenticated));
      return true;
    } on AesGcmAuthError {
      return false;
    } catch (_) {
      return false;
    }
  }

  // ─── Saving ───────────────────────────────────────────────────────────

  /// Keeps [next] for the lists, after [save] wrote it, and counts the change.
  void _changed(Lists next) {
    _lists = next;
    _revision++;
    _healthKey = '';
  }

  Lists _with({
    List<OtpAccount>? accounts,
    List<BackupService>? backupServices,
    List<VaultKey>? keys,
    List<Contact>? contacts,
    List<Login>? logins,
  }) => Lists(
    accounts: accounts ?? _lists.accounts,
    backupServices: backupServices ?? _lists.backupServices,
    keys: keys ?? _lists.keys,
    notes: _lists.notes,
    passkeys: _lists.passkeys,
    keyAccounts: _lists.keyAccounts,
    contacts: contacts ?? _lists.contacts,
    logins: logins ?? _lists.logins,
    cards: _lists.cards,
    identities: _lists.identities,
  );

  /// Saves the keys. The lists are read again after the write, so a sync or a save that landed meanwhile stays; a vault that
  /// locked meanwhile is not put back in memory.
  ///
  /// The write has the vault's lock (see [_locked]), so a save that landed meanwhile is built on, never written over.
  Future<void> saveKeys(List<VaultKey> next) => updateKeys((_) => next);

  /// [saveKeys] with the new list worked out by [build] from the keys the vault holds when the write has the lock.
  Future<void> updateKeys(List<VaultKey> Function(List<VaultKey> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.keys), _lists.keys, now: nowMs);
    await vault.saveKeys(stamped, session);
    if (identical(_session, session)) _changed(_with(keys: stamped));
    await store.flush();
  });

  /// Saves the contacts, as [saveKeys] saves the keys.
  Future<void> saveContacts(List<Contact> next) => updateContacts((_) => next);

  /// [saveContacts] with the new list worked out by [build], as [updateKeys] does.
  Future<void> updateContacts(List<Contact> Function(List<Contact> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.contacts), _lists.contacts, now: nowMs);
    await vault.saveContacts(stamped, session);
    if (identical(_session, session)) _changed(_with(contacts: stamped));
    await store.flush();
  });

  Future<void> _saveAccounts(List<OtpAccount> Function(List<OtpAccount> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.accounts), _lists.accounts, now: nowMs);
    await vault.saveAccounts(stamped, session);
    if (identical(_session, session)) _changed(_with(accounts: stamped));
    await store.flush();
  });

  Future<void> _saveServices(List<BackupService> Function(List<BackupService> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.backupServices), _lists.backupServices, now: nowMs);
    await vault.saveBackupServices(stamped, session);
    if (identical(_session, session)) _changed(_with(backupServices: stamped));
    await store.flush();
  });

  /// Saves what [next] changes in the open lists, every kind through its own sealed value, for a change made here that touches more than
  /// one list (a tag, a merge): each entry that differs is stamped as just changed ([at] says when, [nowMs] by default), so sync carries
  /// it, and the change is counted, so a sync that raced it is thrown away. The lists in memory change only once every save is made.
  ///
  /// Memory and storage agree afterwards, whatever happens: when a save fails, each list already written (and the one that failed) is
  /// written back as it was, in the opposite order, and the failure goes on. Only when that write-back fails too, a [PartialSave] says
  /// storage may hold part of the change.
  ///
  /// [build] makes the new lists from [Lists] the vault holds once the write has the lock (see [_locked]), so a write that landed
  /// meanwhile is built on, never undone by a change worked out from lists read earlier. It runs inside the lock and must not wait; what
  /// it throws (a change that is stale by then) is the write's failure and nothing is written.
  Future<void> saveChanged(Lists Function(Lists held) build, {int? at}) => _locked(() => _saveChangedNow(build, at));

  Future<void> _saveChangedNow(Lists Function(Lists held) build, int? at) async {
    final session = requireSession();
    final now = _lists;
    final next = build(now);
    final stampAt = at ?? nowMs;
    bool differs(List<VaultEntry<Object?>> a, List<VaultEntry<Object?>> b) =>
        canonical([for (final e in a) e.toJson()]) != canonical([for (final e in b) e.toJson()]);
    final stamped = Lists(
      accounts: stampChanged(next.accounts, now.accounts, now: stampAt),
      backupServices: stampChanged(next.backupServices, now.backupServices, now: stampAt),
      keys: stampChanged(next.keys, now.keys, now: stampAt),
      notes: stampChanged(next.notes, now.notes, now: stampAt),
      passkeys: stampChanged(next.passkeys, now.passkeys, now: stampAt),
      keyAccounts: stampChanged(next.keyAccounts, now.keyAccounts, now: stampAt),
      contacts: stampChanged(next.contacts, now.contacts, now: stampAt),
      logins: stampChanged(next.logins, now.logins, now: stampAt),
      cards: stampChanged(next.cards, now.cards, now: stampAt),
      identities: stampChanged(next.identities, now.identities, now: stampAt),
    );
    _guardChanges(next);
    final undo = <Future<void> Function()>[];
    Future<void> put<T extends VaultEntry<T>>(
      String kind,
      List<T> after,
      List<T> before,
      Future<void> Function(List<T>, VaultSession) save,
    ) async {
      if (!differs(after, before)) return;
      // Written back even if this very write is the one that fails: it may have reached the store before it threw
      undo.add(() => save(before, session));
      await beforeWrite?.call(kind);
      await save(after, session);
    }

    try {
      await put('accounts', stamped.accounts, now.accounts, vault.saveAccounts);
      await put('backupServices', stamped.backupServices, now.backupServices, vault.saveBackupServices);
      await put('keys', stamped.keys, now.keys, vault.saveKeys);
      await put('notes', stamped.notes, now.notes, vault.saveNotes);
      await put('passkeys', stamped.passkeys, now.passkeys, vault.savePasskeys);
      await put('keyAccounts', stamped.keyAccounts, now.keyAccounts, vault.saveKeyAccounts);
      await put('contacts', stamped.contacts, now.contacts, vault.saveContacts);
      await put('logins', stamped.logins, now.logins, vault.saveLogins);
      await put('cards', stamped.cards, now.cards, vault.saveCards);
      await put('identities', stamped.identities, now.identities, vault.saveIdentities);
    } catch (error) {
      var restored = true;
      for (final step in undo.reversed) {
        try {
          await step();
        } catch (_) {
          restored = false;
        }
      }
      try {
        await store.flush();
      } catch (_) {
        restored = false;
      }
      if (!restored) throw PartialSave(error);
      rethrow;
    }
    // A vault that locked meanwhile is not put back in memory
    // A change that changed nothing is not counted as one: a sync that raced it need not be thrown away
    if (undo.isNotEmpty && identical(_session, session)) _changed(stamped);
    await store.flush();
  }

  /// Called before each list [saveChanged] writes, with the list's name. Tests make it throw to see what a failed save leaves behind.
  Future<void> Function(String kind)? beforeWrite;

  /// Keeps the order of the logins the person chose in this browser: the ids given first, in their order, then the others as they were.
  Future<void> saveLoginOrder(List<String> ids) => _locked(() async {
    final session = requireSession();
    final held = {for (final login in _lists.logins) login.id};
    final next = <String>{
      for (final id in ids)
        if (held.contains(id)) id,
    }.toList();
    await vault.saveEncryptedValue(keyExtensionLoginOrder, next, session);
    _loginOrder = next;
    _revision++;
    await store.flush();
  });

  /// A login's place in the list: where the person put it, else after those they placed, as the vault lists it.
  int _loginPlace(String id, int index) {
    final at = _loginOrder.indexOf(id);
    return at >= 0 ? at : _loginOrder.length + index;
  }

  Future<void> _saveLogins(List<Login> Function(List<Login> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.logins), _lists.logins, now: nowMs);
    await vault.saveLogins(stamped, session);
    if (identical(_session, session)) _changed(_with(logins: stamped));
    await store.flush();
  });

  /// Keeps [next] as the vault's passkeys, each changed one stamped so a sync carries it (docs/plans/add-passkeys.md).
  Future<void> savePasskeys(List<Passkey> next) => updatePasskeys((_) => next);

  /// [savePasskeys] with the new list worked out by [build] from the passkeys the vault holds when the write has the lock.
  Future<void> updatePasskeys(List<Passkey> Function(List<Passkey> held) build) => _locked(() async {
    final session = requireSession();
    final stamped = stampChanged(build(_lists.passkeys), _lists.passkeys, now: nowMs);
    await vault.savePasskeys(stamped, session);
    if (!identical(_session, session)) return;
    _changed(
      Lists(
        accounts: _lists.accounts,
        backupServices: _lists.backupServices,
        keys: _lists.keys,
        notes: _lists.notes,
        passkeys: stamped,
        keyAccounts: _lists.keyAccounts,
        contacts: _lists.contacts,
        logins: _lists.logins,
        cards: _lists.cards,
        identities: _lists.identities,
      ),
    );
    await store.flush();
  });

  /// Takes what a sync merged: every kind, each saved only when it changed, and not counted as a change made here. When [ifRevision]
  /// is given and a change made here has been counted since (a save that had the lock first), nothing is taken and the answer is
  /// false: what the sync read is out of date, and the next run merges the change in.
  Future<bool> applySynced(Lists next, {int? ifRevision}) => _locked(() async {
    if (ifRevision != null && ifRevision != _revision) return false;
    await _writeLists(next, requireSession());
    return true;
  });

  /// Takes the lists [build] makes from the ones the vault holds when the write has the lock, as [applySynced] takes a sync's (leaving
  /// a space takes its entries away this way).
  Future<void> applyReshaped(Lists Function(Lists held) build) => _locked(() async {
    final session = requireSession();
    await _writeLists(build(_lists), session);
    // Counted as a change made here, inside the lock, so a sync that read the lists before it is thrown away
    if (identical(_session, session)) _revision++;
  });

  /// The body of [applySynced], for what already has the lock.
  Future<void> _writeLists(Lists next, VaultSession session) async {
    bool changed(List<VaultEntry<Object?>> a, List<VaultEntry<Object?>> b) =>
        canonical([for (final e in a) e.toJson()]) != canonical([for (final e in b) e.toJson()]);
    final now = _lists;
    if (changed(next.accounts, now.accounts)) await vault.saveAccounts(next.accounts, session);
    if (changed(next.backupServices, now.backupServices)) await vault.saveBackupServices(next.backupServices, session);
    if (changed(next.keys, now.keys)) await vault.saveKeys(next.keys, session);
    if (changed(next.notes, now.notes)) await vault.saveNotes(next.notes, session);
    if (changed(next.passkeys, now.passkeys)) await vault.savePasskeys(next.passkeys, session);
    if (changed(next.keyAccounts, now.keyAccounts)) await vault.saveKeyAccounts(next.keyAccounts, session);
    if (changed(next.contacts, now.contacts)) await vault.saveContacts(next.contacts, session);
    if (changed(next.logins, now.logins)) await vault.saveLogins(next.logins, session);
    if (changed(next.cards, now.cards)) await vault.saveCards(next.cards, session);
    if (changed(next.identities, now.identities)) await vault.saveIdentities(next.identities, session);
    // A vault that locked meanwhile is not put back in memory
    if (identical(_session, session)) {
      _lists = next;
      _healthKey = '';
    }
    await store.flush();
  }

  // ─── Codes ────────────────────────────────────────────────────────────

  OtpAccount _account(String id) {
    for (final account in _lists.accounts) {
      if (account.id == id) return account;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such code');
  }

  Login _login(String id) {
    for (final login in _lists.logins) {
      if (login.id == id) return login;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such login');
  }

  /// The backup codes saved for [account]'s service, or null.
  BackupService? backupFor(OtpAccount account) {
    final name = serviceOf(account);
    if (name.trim().isEmpty) return null;
    for (final service in _lists.backupServices) {
      if (sameService(name, service.serviceName)) return service;
    }
    return null;
  }

  /// The service an account belongs to: its issuer, else the label's part before ":".
  static String serviceOf(OtpAccount account) {
    if (account.issuer.trim().isNotEmpty) return account.issuer;
    final colon = account.label.indexOf(':');
    return colon > 0 ? account.label.substring(0, colon) : account.label;
  }

  Map<String, Object?> _codeView(OtpAccount account, int order) {
    String? loginId;
    for (final login in _lists.logins) {
      if (login.accountId == account.id) {
        loginId = login.id;
        break;
      }
    }
    final backup = backupFor(account);
    return codeView(
      account,
      order: order,
      loginId: loginId,
      backupCodesLeft: backup?.codes.where((code) => !code.used).length,
      space: spaceNote?.call(account.spaceId, account.id),
    );
  }

  List<Map<String, Object?>> codes() {
    requireSession();
    return [
      for (final (i, account) in _lists.accounts.indexed) _codeView(account, i),
      for (final (i, account) in _lists.keyAccounts.indexed) keyAccountView(account, order: _lists.accounts.length + i),
    ];
  }

  List<Map<String, Object?>> liveCodes(List<String> ids, int now) {
    requireSession();
    final wanted = ids.toSet();
    return [
      for (final account in _lists.accounts)
        if (wanted.contains(account.id)) liveCode(account, now),
    ];
  }

  Future<Map<String, Object?>> nextHotp(String id) async {
    final account = _account(id);
    editGuard?.call(account.spaceId, id);
    if (account.kind != OtpType.hotp) throw const CoreFailure(CoreFailure.invalid, 'not a counter code');
    // The counter goes up from what the code holds once the write has the lock, so two presses never write the same number
    OtpAccount? bumped;
    await _saveAccounts((held) => [for (final a in held) a.id == id ? (bumped = a.copyWith(counter: (a.counter ?? 0) + 1)) : a]);
    final done = bumped;
    if (done == null) throw const CoreFailure(CoreFailure.notFound, 'no such code');
    return liveCode(done, nowMs);
  }

  /// What a code link would add, saving nothing: the name it would have, and the saved account that has its secret already (or null).
  Map<String, Object?> previewCode(String link) {
    requireSession();
    final parsed = parseOtpUri(link);
    if (parsed == null || !isValidSecret(normalizeSecret(parsed.secret))) {
      throw const CoreFailure(CoreFailure.notAnOtpauth, 'not a code link');
    }
    Map<String, Object?>? existing;
    for (final (i, held) in _lists.accounts.indexed) {
      if (held.issuer == parsed.issuer && comparableSecret(held.secret) == comparableSecret(parsed.secret)) {
        existing = _codeView(held, i);
        break;
      }
    }
    return {'issuer': serviceOf(parsed), 'account': parsed.label, 'existing': existing};
  }

  Future<Map<String, Object?>> addCode(String link, String? website, String? linkTo) async {
    requireSession();
    final parsed = parseOtpUri(link);
    if (parsed == null || !isValidSecret(normalizeSecret(parsed.secret))) {
      throw const CoreFailure(CoreFailure.notAnOtpauth, 'not a code link');
    }
    for (final held in _lists.accounts) {
      if (held.issuer == parsed.issuer && comparableSecret(held.secret) == comparableSecret(parsed.secret)) {
        // The same account is saved already: it isn't added twice, but a login asked to link to it is
        if (linkTo != null) await linkCode(held.id, linkTo);
        throw const CoreFailure(CoreFailure.duplicate, 'this code is saved already');
      }
    }
    final host = website == null ? null : normaliseWebsite(website);
    final account = parsed.copyWith(id: newUuid(), addedAt: nowMs, websites: host == null ? keep : [host]);
    await _saveAccounts((held) => [...held, account]);
    if (linkTo != null) await linkCode(account.id, linkTo);
    return _codeView(_account(account.id), _lists.accounts.length - 1);
  }

  /// Links the code to a login, or unlinks it; a login holds one code, and a code is linked from one login.
  Future<void> linkCode(String codeId, String? loginId) async {
    requireSession();
    editGuard?.call(_account(codeId).spaceId, codeId);
    if (loginId != null) editGuard?.call(_login(loginId).spaceId, loginId);
    // Every login the change touches, the ones it unlinks too, is one the person must be allowed to edit
    for (final login in _lists.logins) {
      if (login.id != loginId && login.accountId == codeId) editGuard?.call(login.spaceId, login.id);
    }
    await _saveLogins(
      (held) => [
        for (final login in held)
          if (login.id == loginId)
            login.copyWith(accountId: codeId)
          else if (login.accountId == codeId)
            login.copyWith(accountId: unset)
          else
            login,
      ],
    );
  }

  /// The text of the QR code in an image (a data URL, e.g. a screenshot of the tab), or null when there is none.
  Future<String?> readQr(String imageDataUrl) async {
    final reader = platform.decodeImage;
    if (reader == null) throw const CoreFailure(CoreFailure.unavailable, 'this browser cannot decode images in the background');
    final pixels = await reader(imageDataUrl);
    return pixels == null ? null : readQrCode(pixels);
  }

  // ─── Backup codes ─────────────────────────────────────────────────────

  List<Map<String, Object?>> backupCodes() {
    requireSession();
    return [for (final service in _lists.backupServices) backupView(service, space: spaceNote?.call(service.spaceId, service.id))];
  }

  Future<String> useBackupCode(String serviceId) async {
    requireSession();
    final service = _lists.backupServices.where((s) => s.id == serviceId).firstOrNull;
    if (service == null) throw const CoreFailure(CoreFailure.notFound, 'no such service');
    editGuard?.call(service.spaceId, service.id);
    // The code taken is the first unused one the service holds once the write has the lock, so two presses never take the same code
    String? taken;
    await _saveServices((held) {
      final current = held.where((s) => s.id == serviceId).firstOrNull;
      if (current == null) throw const CoreFailure(CoreFailure.notFound, 'no such service');
      final index = current.codes.indexWhere((code) => !code.used);
      if (index < 0) throw const CoreFailure(CoreFailure.notFound, 'no backup code left');
      taken = current.codes[index].code;
      final used = current.copyWith(
        codes: [for (final (i, c) in current.codes.indexed) i == index ? c.copyWith(used: true, usedAt: nowMs) : c],
      );
      return [for (final s in held) s.id == serviceId ? used : s];
    });
    final code = taken;
    if (code == null) throw const CoreFailure(CoreFailure.notFound, 'no backup code left');
    return code;
  }

  // ─── Logins ───────────────────────────────────────────────────────────

  LoginHealth _health = LoginHealth.empty;
  var _healthKey = '';

  /// What Pwned Passwords said this session, by the SHA-1 of each password, so each is asked once. Never stored.
  final Map<String, int> _leaked = {};

  /// The warnings of the open vault's logins, worked out again after a change. Breached passwords are those Pwned Passwords
  /// has already answered for, while the switch is on; [ask] asks it for the rest, one request for each distinct password,
  /// sending five characters of its hash and never the password.
  Future<LoginHealth> health({bool ask = false, bool again = false}) async {
    final session = requireSession();
    final on = _settings['breachedPasswords'] == true;
    // "Check now": what Pwned Passwords said this session is asked again
    if (again) _leaked.clear();
    if (on && ask) await _askLeaks();
    final breached = <String>{
      if (on)
        for (final login in _lists.logins)
          if (!_hidden(login))
            if (login.password case final password? when password.isNotEmpty && (_leaked[PwnedPasswords.hashOf(password)] ?? 0) > 0)
              login.id,
    };
    final key = '$_revision:$on:${breached.length}:${identityHashCode(session)}';
    if (key == _healthKey) return _health;
    final directory = _readDirectory();
    final offering = directory == null ? const <String>{} : codeDomains([for (final entry in directory.entries) entry.domain], matcher);
    // A hidden password takes no part in "reused" or "weak": that a login shares one with a login the person can read, or how strong
    // it is, would tell what it is
    final readable = [for (final login in _lists.logins) _hidden(login) ? login.copyWith(password: unset) : login];
    _health = loginHealth(readable, matcher, offering: offering, breached: breached);
    _healthKey = key;
    return _health;
  }

  /// How many passwords the last check couldn't get an answer for.
  int leakFailures = 0;

  Future<void> _askLeaks() async {
    leakFailures = 0;
    final client = platform.clientFor(null);
    try {
      final pwned = PwnedPasswords(client);
      for (final login in _lists.logins) {
        // A hidden password is never sent, not even as the five characters of its hash
        if (_hidden(login)) continue;
        final password = login.password;
        if (password == null || password.isEmpty) continue;
        final hash = PwnedPasswords.hashOf(password);
        if (_leaked.containsKey(hash)) continue;
        try {
          _leaked[hash] = await pwned.timesLeaked(password);
        } on LeakCheckError {
          // A password the service couldn't tell of is asked again next time
          leakFailures++;
        }
      }
    } finally {
      client.close();
    }
  }

  Future<List<Map<String, Object?>>> logins() async {
    requireSession();
    final health = await this.health();
    return [
      for (final (i, login) in _lists.logins.indexed)
        loginView(
          login,
          order: _loginPlace(login.id, i),
          health: health,
          space: spaceNote?.call(login.spaceId, login.id, login: true),
          hidden: _hidden(login),
        ),
    ];
  }

  Map<String, Object?> revealLogin(String id) {
    requireSession();
    final login = _login(id);
    return {'username': login.username ?? '', 'password': login.password ?? ''};
  }

  Future<Map<String, Object?>> saveLogin(String? id, Map<String, Object?> input) async {
    requireSession();
    final name = asString(input['name']).trim();
    final username = asString(input['username']);
    // A password a grant hides is kept as it is (docs/plans/add-spaces.md): the form never held it
    final password = id != null && input['keepPassword'] == true ? (_login(id).password ?? '') : asString(input['password']);
    final websites = <String>[
      for (final site in (input['websites'] as List<Object?>? ?? const []).whereType<String>()) ?normaliseWebsite(site),
    ];
    final note = asOptionalString(input['note']);
    final tags = asStrings(input['tags']);
    final fromAutofill = input['fromAutofill'] == true;
    if (name.isEmpty || (username.isEmpty && password.isEmpty)) {
      throw const CoreFailure(CoreFailure.invalid, 'a login needs a name and a username or a password');
    }
    final Login saved;
    if (id == null) {
      final now = nowMs;
      saved = Login(
        id: newUuid(),
        name: name,
        username: username.isEmpty ? null : username,
        password: password.isEmpty ? null : password,
        websites: websites.isEmpty ? null : websites,
        note: note == null || note.isEmpty ? null : note,
        tags: tags == null || tags.isEmpty ? null : tags,
        passwordChangedAt: password.isEmpty ? null : now,
        addedAt: now,
        source: fromAutofill ? Login.fromAutofill : null,
      );
      await _saveLogins((held) => [...held, saved]);
    } else {
      final current = _login(id);
      editGuard?.call(current.spaceId, id);
      var next = current.copyWith(
        name: name,
        username: username.isEmpty ? unset : username,
        websites: websites.isEmpty ? unset : websites,
        note: note == null || note.isEmpty ? unset : note,
        tags: tags == null ? keep : (tags.isEmpty ? unset : tags),
      );
      // A changed password keeps the one it replaces among the previous passwords
      next = next.withPassword(password.isEmpty ? null : password, nowMs);
      saved = next;
      await _saveLogins((held) => [for (final login in held) login.id == id ? next : login]);
    }
    // A login that holds a generated password now holds it for good: it is no longer "recently generated"
    if (password.isNotEmpty && _generated.any((item) => item.password == password)) {
      await _locked(() async {
        final session = requireSession();
        final next = [
          for (final item in _generated)
            if (item.password != password) item,
        ];
        await vault.saveGenerated(next, session);
        _generated = next;
        await store.flush();
      });
    }
    final index = _lists.logins.indexWhere((login) => login.id == saved.id);
    final stored = _lists.logins[index];
    return loginView(
      stored,
      order: _loginPlace(saved.id, index),
      health: await health(),
      space: spaceNote?.call(stored.spaceId, stored.id, login: true),
      hidden: _hidden(stored),
    );
  }

  Future<void> deleteLogin(String id) async {
    requireSession();
    editGuard?.call(_login(id).spaceId, id);
    await _saveLogins(
      (held) => [
        for (final login in held)
          if (login.id != id) login,
      ],
    );
  }

  Future<void> ignoreHealth(String id, bool ignored) async {
    requireSession();
    final current = _login(id);
    editGuard?.call(current.spaceId, id);
    await _saveLogins((held) => [for (final login in held) login.id == id ? login.copyWith(codeWarning: ignored ? false : unset) : login]);
  }

  // ─── Recently generated passwords ─────────────────────────────────────

  /// The passwords the generator made that no saved login holds, newest first, as `GeneratedPassword` in src/shared/api.ts.
  /// (They are kept oldest first, each new one added at the end.)
  List<Map<String, Object?>> recentPasswords() {
    requireSession();
    return [
      for (final item in _generated.reversed) {'value': item.password, 'at': item.at, 'site': ?item.site},
    ];
  }

  /// Keeps a generated password (kept for [generatedPasswordDays] days, never synced or exported).
  Future<void> addRecentPassword(Map<String, Object?> password) async {
    requireSession();
    final value = asString(password['value']);
    if (value.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'no password');
    final site = asOptionalString(password['site']);
    final at = asInt(password['at']) ?? nowMs;
    await _locked(() async {
      final session = requireSession();
      final next = [..._generated.where((item) => item.password != value), GeneratedPassword(password: value, site: site, at: at)];
      await vault.saveGenerated(next, session);
      _generated = next;
      await store.flush();
    });
  }

  // ─── "Always suggest here" ────────────────────────────────────────────

  /// Saves the picks [build] makes from the ones held when the write has the lock.
  Future<void> _savePicks(Map<String, List<String>> Function(Map<String, List<String>> held) build) => _locked(() async {
    final session = requireSession();
    final next = build(_picks);
    await vault.saveEncryptedValue(keyExtensionPicks, next, session);
    _picks = next;
    await store.flush();
  });

  String _pickHost(String host) {
    final name = host.trim().toLowerCase();
    if (name.isEmpty || name.length > 253) throw const CoreFailure(CoreFailure.invalid, 'no host');
    return name;
  }

  /// Remembers that [itemId] (a login or a code) was picked on [host]. Sealed with the vault; a locked core has none.
  Future<void> rememberPick(String host, String itemId) async {
    requireSession();
    final name = _pickHost(host);
    if (itemId.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'no item');
    final ids = _picks[name] ?? const <String>[];
    if (ids.contains(itemId)) return;
    await _savePicks(
      (held) => {
        ...held,
        name: [...?held[name]?.where((id) => id != itemId), itemId],
      },
    );
  }

  /// The items picked on [host].
  List<String> picks(String host) {
    requireSession();
    return [...?_picks[_pickHost(host)]];
  }

  /// The hosts [itemId] was picked on, sorted.
  List<String> pickedHosts(String itemId) {
    requireSession();
    return [
      for (final MapEntry(:key, :value) in _picks.entries)
        if (value.contains(itemId)) key,
    ]..sort();
  }

  Future<void> forgetPick(String host, String itemId) async {
    requireSession();
    final name = _pickHost(host);
    final ids = _picks[name];
    if (ids == null || !ids.contains(itemId)) return;
    await _savePicks((held) {
      final left = [
        for (final id in held[name] ?? const <String>[])
          if (id != itemId) id,
      ];
      return {
        for (final MapEntry(:key, :value) in held.entries)
          if (key != name) key: value else if (left.isNotEmpty) key: left,
      };
    });
  }

  // ─── Settings ─────────────────────────────────────────────────────────

  Map<String, Object?> settings() => {..._settings};

  Future<Map<String, Object?>> saveSettings(Map<String, Object?> change) async {
    requireSession();
    return _locked(() async {
      final session = requireSession();
      _settings = readSettings(change, _settings);
      await vault.saveEncryptedValue(keyExtensionSettings, _settings, session);
      await store.flush();
      return {..._settings};
    });
  }

  /// The setting [name] as the vault holds it, read at the time of the call.
  Object? setting(String name) => _settings[name];
}

/// The wrong passwords typed since the vault last opened, and when the last one was (`UnlockFailures` in the app).
class UnlockCount {
  const UnlockCount({this.count = 0, this.last});

  /// What [raw] holds; none for anything that isn't a count.
  factory UnlockCount.parse(String? raw) {
    if (raw == null) return const UnlockCount();
    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, Object?>) return const UnlockCount();
      final count = asInt(json['count']) ?? 0;
      return UnlockCount(count: count < 0 ? 0 : count, last: asInt(json['last']));
    } on FormatException {
      return const UnlockCount();
    }
  }

  final int count;

  /// Epoch ms of the last wrong password.
  final int? last;

  Map<String, Object?> toJson() => {'count': count, 'last': ?last};
}
