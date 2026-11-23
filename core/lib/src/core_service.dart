// The core as the TypeScript side calls it: one method name and a list of JSON arguments in, a JSON value out (js/bridge.dart
// carries them over the wire). Each method is a `CoreApi` method of src/shared/api.ts, with its arguments in order.
import 'failure.dart';
import 'generate.dart';
import 'health.dart';
import 'matching.dart';
import 'platform.dart';
import 'sync_service.dart';
import 'vault_service.dart';

/// Opens the vault's storage and answers calls.
class CoreService {
  CoreService._(this.vault) : sync = SyncService(vault);

  static Future<CoreService> start(CorePlatform platform, CoreData data) async => CoreService._(await VaultService.start(platform, data));

  final VaultService vault;
  final SyncService sync;

  /// The methods the TypeScript `CoreApi` has, by name.
  static const methods = {
    'state',
    'createVault',
    'unlock',
    'lock',
    'removeVault',
    'exportSession',
    'restoreSession',
    'codes',
    'liveCodes',
    'nextHotp',
    'logins',
    'revealLogin',
    'saveLogin',
    'deleteLogin',
    'ignoreHealth',
    'backupCodes',
    'useBackupCode',
    'addCode',
    'previewCode',
    'readQr',
    'linkCode',
    'match',
    'generate',
    'health',
    'syncStatus',
    'signInKemlock',
    'signInKemlockSso',
    'signInKemlockPasskey',
    'signInWebdav',
    'signInVaultwarden',
    'answerStep',
    'syncNow',
    'confirmRemovals',
    'keepRemovals',
    'signOut',
    'settings',
    'saveSettings',
    'recentPasswords',
    'addRecentPassword',
    'rememberedSites',
    'forgetSite',
    'checkServer',
    'securityKeyChallenge',
  };

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

  Map<String, Object?> _object(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! Map<String, Object?>) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not an object');
    return value;
  }

  /// Opens the sync settings of the vault that just opened. A sync that can't be read leaves the vault open, with sync not loaded.
  Future<void> _opened() async {
    try {
      await sync.load();
    } catch (_) {
      sync.unload();
    }
  }

  /// Answers [method] with [args], the JSON values `CoreApi`'s method takes in order; the result is JSON.
  Future<Object?> call(String method, [List<Object?> args = const []]) async {
    switch (method) {
      case 'state':
        final state = vault.state();
        final status = vault.session == null ? null : sync.status();
        return {...state, 'sync': ?status};
      case 'createVault':
        await vault.createVault(_string(args, 0));
        await _opened();
        return null;
      case 'unlock':
        final result = await vault.unlock(_string(args, 0));
        if (result.ok) await _opened();
        return {'ok': result.ok, 'wrongPasswords': result.wrongPasswords};
      case 'lock':
        sync.unload();
        await vault.lock();
        return null;
      case 'removeVault':
        sync.unload();
        await vault.removeVault();
        return null;
      case 'exportSession':
        return vault.exportSession();
      case 'restoreSession':
        final restored = await vault.restoreSession(_string(args, 0));
        if (restored) await _opened();
        return restored;
      case 'codes':
        return vault.codes();
      case 'liveCodes':
        final ids = args.isNotEmpty && args[0] is List<Object?> ? (args[0]! as List<Object?>).whereType<String>().toList() : <String>[];
        final now = args.length > 1 && args[1] is num ? (args[1]! as num).toInt() : vault.nowMs;
        return vault.liveCodes(ids, now);
      case 'nextHotp':
        return vault.nextHotp(_string(args, 0));
      case 'logins':
        return vault.logins();
      case 'revealLogin':
        return vault.revealLogin(_string(args, 0));
      case 'saveLogin':
        return vault.saveLogin(_optionalString(args, 0), _object(args, 1));
      case 'deleteLogin':
        await vault.deleteLogin(_string(args, 0));
        return null;
      case 'ignoreHealth':
        await vault.ignoreHealth(_string(args, 0), args.length > 1 && args[1] == true);
        return null;
      case 'backupCodes':
        return vault.backupCodes();
      case 'useBackupCode':
        return vault.useBackupCode(_string(args, 0));
      case 'addCode':
        return vault.addCode(_string(args, 0), _optionalString(args, 1), _optionalString(args, 2));
      case 'previewCode':
        return vault.previewCode(_string(args, 0));
      case 'readQr':
        return vault.readQr(_string(args, 0));
      case 'linkCode':
        await vault.linkCode(_string(args, 0), _optionalString(args, 1));
        return null;
      case 'match':
        vault.requireSession();
        final page = Page.parse(_string(args, 0));
        if (page == null) return const SiteMatches(site: '').toJson();
        return vault.matcher.match(page, logins: vault.lists.logins, accounts: vault.lists.accounts).toJson();
      case 'generate':
        return generate(_object(args, 0), words: CoreDataAccess(vault).wordList);
      case 'health':
        final health = await vault.health(ask: true);
        return {
          'reused': health.idsWith(LoginWarning.reused),
          'weak': health.idsWith(LoginWarning.weak),
          'withoutItsCode': health.idsWith(LoginWarning.noCode),
          'breached': health.idsWith(LoginWarning.breached),
        };
      case 'syncStatus':
        return vault.session == null ? null : sync.status();
      case 'signInKemlock':
        return sync.signInKemlock(_object(args, 0));
      case 'signInKemlockSso':
        return sync.signInKemlockSso(_object(args, 0));
      case 'signInKemlockPasskey':
        return sync.signInKemlockPasskey(_object(args, 0));
      case 'signInWebdav':
        return sync.signInWebdav(_object(args, 0));
      case 'signInVaultwarden':
        return sync.signInVaultwarden(_object(args, 0));
      case 'answerStep':
        return sync.answer(_object(args, 0));
      case 'syncNow':
        return sync.syncNow();
      case 'confirmRemovals':
        return sync.confirmRemovals();
      case 'keepRemovals':
        return sync.keepRemovals();
      case 'signOut':
        await sync.signOut();
        return null;
      case 'settings':
        vault.requireSession();
        return vault.settings();
      case 'saveSettings':
        return vault.saveSettings(_object(args, 0));
      case 'recentPasswords':
        return vault.recentPasswords();
      case 'addRecentPassword':
        await vault.addRecentPassword(_object(args, 0));
        return null;
      case 'rememberedSites':
        // Kemlock-core's Login has no field for the sites a login is filled on beyond its own, so the core keeps none
        vault.requireSession();
        return const <String>[];
      case 'forgetSite':
        vault.requireSession();
        return null;
      case 'checkServer':
        return sync.checkServer(_string(args, 0), _string(args, 1));
      case 'securityKeyChallenge':
        vault.requireSession();
        return sync.securityKeyChallenge();
    }
    throw CoreFailure(CoreFailure.invalid, 'no such method: $method');
  }
}
