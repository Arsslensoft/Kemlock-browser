// The browser's vault: the app's `VaultStore` over `storage.local`, opened with a password, and the changes the extension
// makes to what it holds (browser-vault and browser-popup specs). Every format is Kemlock-core's; this only asks it to read and
// write, and keeps the open vault's lists in memory.
import 'dart:convert';

import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/core/public_suffix_list.dart';
import 'package:kemlock_core/core/storage/key_value_store.dart';
import 'package:kemlock_core/core/websites.dart';
import 'package:kemlock_core/crypto/aes_gcm.dart';
import 'package:kemlock_core/features/accounts/otp.dart';
import 'package:kemlock_core/features/accounts/otpauth.dart';
import 'package:kemlock_core/features/accounts/service_names.dart';
import 'package:kemlock_core/features/sync/sync_merge.dart';
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/generated_password.dart';
import 'package:kemlock_core/models/json.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/vault_entry.dart';
import 'package:kemlock_core/vault/vault_registry.dart';
import 'package:kemlock_core/vault/vault_store.dart';

import 'directory.dart';
import 'failure.dart';
import 'health.dart';
import 'matching.dart';
import 'platform.dart';
import 'pwned.dart';
import 'qr.dart';
import 'session_seal.dart';
import 'views.dart';

/// The count of wrong passwords, in the app's own key and format: `{"count": n, "last": ms}`, in the clear like the vault's
/// config (openspec: harden-unlock-and-clipboard).
const keyUnlockFailures = 'backmycodes_unlock_failures';

/// The extension's own settings, sealed in the vault like the app's.
const keyExtensionSettings = 'backmycodes_extension_settings';

/// The extension's settings, as `Settings` in src/shared/api.ts, with their defaults (browser-vault and browser-popup specs).
Map<String, Object?> defaultSettings() => {
  'autoLockMinutes': 5,
  'lockOnSleep': true,
  'codeAfterPassword': true,
  'buttonsOnPages': false,
  'breachedPasswords': false,
  'offerToSave': true,
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
  for (final name in const ['lockOnSleep', 'codeAfterPassword', 'buttonsOnPages', 'breachedPasswords', 'offerToSave']) {
    final value = raw[name];
    if (value is bool) settings[name] = value;
  }
  return settings;
}

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

  VaultSession? _session;
  List<GeneratedPassword> _generated = [];
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
        return (ok: true, wrongPasswords: before.count);
    }
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
    _session = null;
    _generated = [];
    _lists = const Lists();
    _settings = defaultSettings();
    _health = LoginHealth.empty;
    _healthKey = '';
    _leaked.clear();
  }

  /// Locks the vault: its keys and contents are forgotten.
  Future<void> lock() async {
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

  Lists _with({List<OtpAccount>? accounts, List<BackupService>? backupServices, List<Login>? logins}) => Lists(
    accounts: accounts ?? _lists.accounts,
    backupServices: backupServices ?? _lists.backupServices,
    keys: _lists.keys,
    notes: _lists.notes,
    passkeys: _lists.passkeys,
    keyAccounts: _lists.keyAccounts,
    contacts: _lists.contacts,
    logins: logins ?? _lists.logins,
    cards: _lists.cards,
    identities: _lists.identities,
  );

  Future<void> _saveAccounts(List<OtpAccount> next) async {
    final session = requireSession();
    final stamped = stampChanged(next, _lists.accounts, now: nowMs);
    await vault.saveAccounts(stamped, session);
    _changed(_with(accounts: stamped));
    await store.flush();
  }

  Future<void> _saveServices(List<BackupService> next) async {
    final session = requireSession();
    final stamped = stampChanged(next, _lists.backupServices, now: nowMs);
    await vault.saveBackupServices(stamped, session);
    _changed(_with(backupServices: stamped));
    await store.flush();
  }

  Future<void> _saveLogins(List<Login> next) async {
    final session = requireSession();
    final stamped = stampChanged(next, _lists.logins, now: nowMs);
    await vault.saveLogins(stamped, session);
    _changed(_with(logins: stamped));
    await store.flush();
  }

  /// Takes what a sync merged: every kind, each saved only when it changed, and not counted as a change made here.
  Future<void> applySynced(Lists next) async {
    final session = requireSession();
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
    _lists = next;
    _healthKey = '';
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
    return codeView(account, order: order, loginId: loginId, backupCodesLeft: backup?.codes.where((code) => !code.used).length);
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
    if (account.kind != OtpType.hotp) throw const CoreFailure(CoreFailure.invalid, 'not a counter code');
    final next = account.copyWith(counter: (account.counter ?? 0) + 1);
    await _saveAccounts([for (final a in _lists.accounts) a.id == id ? next : a]);
    return liveCode(next, nowMs);
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
      if (held.issuer == parsed.issuer && held.secret == parsed.secret) {
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
      if (held.issuer == parsed.issuer && held.secret == parsed.secret) {
        // The same account is saved already: it isn't added twice, but a login asked to link to it is
        if (linkTo != null) await linkCode(held.id, linkTo);
        throw const CoreFailure(CoreFailure.duplicate, 'this code is saved already');
      }
    }
    final host = website == null ? null : normaliseWebsite(website);
    final account = parsed.copyWith(id: newUuid(), addedAt: nowMs, websites: host == null ? keep : [host]);
    await _saveAccounts([..._lists.accounts, account]);
    if (linkTo != null) await linkCode(account.id, linkTo);
    return _codeView(_account(account.id), _lists.accounts.length - 1);
  }

  /// Links the code to a login, or unlinks it; a login holds one code, and a code is linked from one login.
  Future<void> linkCode(String codeId, String? loginId) async {
    requireSession();
    _account(codeId);
    if (loginId != null) _login(loginId);
    final next = [
      for (final login in _lists.logins)
        if (login.id == loginId)
          login.copyWith(accountId: codeId)
        else if (login.accountId == codeId)
          login.copyWith(accountId: unset)
        else
          login,
    ];
    await _saveLogins(next);
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
    return [for (final service in _lists.backupServices) backupView(service)];
  }

  Future<String> useBackupCode(String serviceId) async {
    requireSession();
    final service = _lists.backupServices.where((s) => s.id == serviceId).firstOrNull;
    if (service == null) throw const CoreFailure(CoreFailure.notFound, 'no such service');
    final index = service.codes.indexWhere((code) => !code.used);
    if (index < 0) throw const CoreFailure(CoreFailure.notFound, 'no backup code left');
    final code = service.codes[index];
    final used = service.copyWith(
      codes: [for (final (i, c) in service.codes.indexed) i == index ? c.copyWith(used: true, usedAt: nowMs) : c],
    );
    await _saveServices([for (final s in _lists.backupServices) s.id == serviceId ? used : s]);
    return code.code;
  }

  // ─── Logins ───────────────────────────────────────────────────────────

  LoginHealth _health = LoginHealth.empty;
  var _healthKey = '';

  /// What Pwned Passwords said this session, by the SHA-1 of each password, so each is asked once. Never stored.
  final Map<String, int> _leaked = {};

  /// The warnings of the open vault's logins, worked out again after a change. Breached passwords are those Pwned Passwords
  /// has already answered for, while the switch is on; [ask] asks it for the rest, one request for each distinct password,
  /// sending five characters of its hash and never the password.
  Future<LoginHealth> health({bool ask = false}) async {
    final session = requireSession();
    final on = _settings['breachedPasswords'] == true;
    if (on && ask) await _askLeaks();
    final breached = <String>{
      if (on)
        for (final login in _lists.logins)
          if (login.password case final password? when password.isNotEmpty && (_leaked[PwnedPasswords.hashOf(password)] ?? 0) > 0) login.id,
    };
    final key = '$_revision:$on:${breached.length}:${identityHashCode(session)}';
    if (key == _healthKey) return _health;
    final directory = _readDirectory();
    final offering = directory == null ? const <String>{} : codeDomains([for (final entry in directory.entries) entry.domain], matcher);
    _health = loginHealth(_lists.logins, matcher, offering: offering, breached: breached);
    _healthKey = key;
    return _health;
  }

  Future<void> _askLeaks() async {
    final client = platform.clientFor(null);
    try {
      final pwned = PwnedPasswords(client);
      for (final login in _lists.logins) {
        final password = login.password;
        if (password == null || password.isEmpty) continue;
        final hash = PwnedPasswords.hashOf(password);
        if (_leaked.containsKey(hash)) continue;
        try {
          _leaked[hash] = await pwned.timesLeaked(password);
        } on LeakCheckError {
          // A password the service couldn't tell of is asked again next time
        }
      }
    } finally {
      client.close();
    }
  }

  Future<List<Map<String, Object?>>> logins() async {
    requireSession();
    final health = await this.health();
    return [for (final (i, login) in _lists.logins.indexed) loginView(login, order: i, health: health)];
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
    final password = asString(input['password']);
    final websites = <String>[
      for (final site in (input['websites'] as List<Object?>? ?? const []).whereType<String>()) ?normaliseWebsite(site),
    ];
    final note = asOptionalString(input['note']);
    final tags = asStrings(input['tags']);
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
      );
      await _saveLogins([..._lists.logins, saved]);
    } else {
      final current = _login(id);
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
      await _saveLogins([for (final login in _lists.logins) login.id == id ? next : login]);
    }
    final index = _lists.logins.indexWhere((login) => login.id == saved.id);
    return loginView(_lists.logins[index], order: index, health: await health());
  }

  Future<void> deleteLogin(String id) async {
    requireSession();
    _login(id);
    await _saveLogins([
      for (final login in _lists.logins)
        if (login.id != id) login,
    ]);
  }

  Future<void> ignoreHealth(String id, bool ignored) async {
    requireSession();
    final current = _login(id);
    await _saveLogins([for (final login in _lists.logins) login.id == id ? current.copyWith(codeWarning: ignored ? false : unset) : login]);
  }

  // ─── Recently generated passwords ─────────────────────────────────────

  /// The passwords the generator made that no saved login holds, newest last, as `GeneratedPassword` in src/shared/api.ts.
  List<Map<String, Object?>> recentPasswords() {
    requireSession();
    return [
      for (final item in _generated) {'value': item.password, 'at': item.at, 'site': ?item.site},
    ];
  }

  /// Keeps a generated password (kept for [generatedPasswordDays] days, never synced or exported).
  Future<void> addRecentPassword(Map<String, Object?> password) async {
    final session = requireSession();
    final value = asString(password['value']);
    if (value.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'no password');
    final site = asOptionalString(password['site']);
    final next = [
      ..._generated.where((item) => item.password != value),
      GeneratedPassword(password: value, site: site, at: asInt(password['at']) ?? nowMs),
    ];
    await vault.saveGenerated(next, session);
    _generated = next;
    await store.flush();
  }

  // ─── Settings ─────────────────────────────────────────────────────────

  Map<String, Object?> settings() => {..._settings};

  Future<Map<String, Object?>> saveSettings(Map<String, Object?> change) async {
    final session = requireSession();
    _settings = readSettings(change, _settings);
    await vault.saveEncryptedValue(keyExtensionSettings, _settings, session);
    await store.flush();
    return {..._settings};
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
