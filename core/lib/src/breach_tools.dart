// The breach checks beyond the password check that was already here (docs/plans/add-vault-tools.md, and the app's breach-alerts and
// password-leak-check): "Check now", which asks Pwned Passwords again for every login's password, and the alerts for the services of
// the vault's codes and backup-code lists, from the list of breaches the extension ships and, when the person turns it on, the list
// Have I Been Pwned keeps now. Nothing from the vault goes out: the password check sends five characters of a hash, and the list is
// asked for the same way from everyone.
import 'dart:convert';

import 'package:kemlock_core/features/breaches/breach_list.dart';
import 'package:kemlock_core/features/breaches/breach_refresh.dart';
import 'package:kemlock_core/features/breaches/breach_scan.dart';
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/otp_account.dart';

import 'failure.dart';
import 'health.dart';
import 'tools_service.dart' show listsWith;
import 'vault_service.dart';

/// The tools' own settings, sealed in the vault: `{"breachRefresh": true}`. Off until the person turns it on, as the app's switch is.
const keyExtensionTools = 'backmycodes_extension_tools';

class BreachTools {
  BreachTools(this.vault);

  final VaultService vault;

  BreachList? _bundled;

  /// The list the extension ships, or an empty one when it wasn't given or can't be read.
  BreachList get _shipped {
    final held = _bundled;
    if (held != null) return held;
    final text = vault.data.breachList;
    if (text == null || text.isEmpty) return BreachList.empty;
    try {
      final json = jsonDecode(text);
      return _bundled = json is Map<String, Object?> ? BreachList.fromJson(json) : BreachList.empty;
    } catch (_) {
      return BreachList.empty;
    }
  }

  Future<bool> _refreshOn() async {
    final stored = await vault.vault.loadEncryptedValue(keyExtensionTools, vault.requireSession());
    return stored is Map<String, Object?> && stored['breachRefresh'] == true;
  }

  /// The tools' settings: whether the daily refresh of the breach list is on.
  Future<Map<String, Object?>> settings() async => {'breachRefresh': await _refreshOn()};

  Future<Map<String, Object?>> saveSettings(Map<String, Object?> change) async {
    final session = vault.requireSession();
    final on = change['breachRefresh'];
    if (on is bool) {
      await vault.vault.saveEncryptedValue(keyExtensionTools, {'breachRefresh': on}, session);
      await vault.store.flush();
    }
    return settings();
  }

  /// Runs [action] over a refresh of the list through a client of the browser, which is closed after.
  Future<T> _withRefresh<T>(Future<T> Function(BreachRefresh refresh) action) async {
    final client = vault.platform.clientFor(null);
    try {
      return await action(BreachRefresh(client: client, store: vault.store, now: vault.platform.clock));
    } finally {
      client.close();
    }
  }

  /// The alerts of the vault's services: each breach listed after an entry of that service was added and not marked dealt with, with
  /// the entries it concerns. Asks Have I Been Pwned for a newer list first, at most once a day, when the person turned that on.
  Future<Map<String, Object?>> view() async {
    final on = await _refreshOn();
    return _withRefresh((refresh) async {
      if (on) await refresh.run(refresh.inUse(_shipped));
      final list = refresh.inUse(_shipped);
      final lists = vault.lists;
      final findings = scanBreaches(lists.accounts, lists.backupServices, list);
      return {
        'alerts': [
          for (final alert in findings.alerts)
            {
              'name': alert.breach.name,
              'title': alert.breach.title,
              'domain': alert.breach.domain,
              'breachDate': alert.breach.breachDate,
              'addedDate': alert.breach.addedDate,
              'pwnCount': alert.breach.pwnCount,
              'passwords': alert.breach.passwords,
              'entries': [
                for (final account in alert.accounts) {'kind': 'code', 'id': account.id, 'name': _accountName(account)},
                for (final service in alert.services) {'kind': 'backup', 'id': service.id, 'name': service.serviceName},
              ],
            },
        ],
        'serviceCount': findings.serviceCount,
        'listUpdated': list.updated,
        'source': list.source,
        'license': list.license,
        'refreshOn': on,
        'checkedAt': ?refresh.lastCheckAt,
      };
    });
  }

  static String _accountName(OtpAccount account) => account.label.isEmpty ? account.issuer : '${account.issuer} · ${account.label}';

  /// Marks the breach [name] dealt with for the codes and backup-code lists named, as the app does (`breachesDismissed` on each entry,
  /// which sync carries).
  Future<void> dismiss(String name, {required List<String> accountIds, required List<String> serviceIds}) async {
    final lists = vault.lists;
    final accounts = accountIds.toSet();
    final services = serviceIds.toSet();
    if (!lists.accounts.any((a) => accounts.contains(a.id)) && !lists.backupServices.any((s) => services.contains(s.id))) {
      throw const CoreFailure(CoreFailure.notFound, 'no such entry');
    }
    await vault.saveChanged(
      (lists) => listsWith(
        lists,
        accounts: [
          for (final a in lists.accounts)
            if (accounts.contains(a.id) && !(a.breachesDismissed?.contains(name) ?? false))
              a.copyWith(breachesDismissed: [...?a.breachesDismissed, name])
            else
              a,
        ],
        backupServices: [
          for (final BackupService s in lists.backupServices)
            if (services.contains(s.id) && !(s.breachesDismissed?.contains(name) ?? false))
              s.copyWith(breachesDismissed: [...?s.breachesDismissed, name])
            else
              s,
        ],
      ),
    );
  }

  /// "Check now": asks Pwned Passwords again for every login's password (while the breached-passwords switch is on), and Have I Been
  /// Pwned for a newer list of breaches (while the refresh is on), whatever the last check was. How each went.
  Future<Map<String, Object?>> check() async {
    vault.requireSession();
    final refreshOn = await _refreshOn();
    var listChecked = false;
    var listUpdated = false;
    if (refreshOn) {
      await _withRefresh((refresh) async {
        final before = refresh.lastCheckAt;
        listUpdated = await refresh.run(refresh.inUse(_shipped), force: true);
        final after = refresh.lastCheckAt;
        listChecked = after != null && (before == null || after > before || listUpdated);
      });
    }
    final passwordsOn = vault.setting('breachedPasswords') == true;
    var breached = 0;
    var failed = 0;
    if (passwordsOn) {
      final health = await vault.health(ask: true, again: true);
      breached = health.idsWith(LoginWarning.breached).length;
      failed = vault.leakFailures;
    }
    return {
      'at': vault.nowMs,
      'passwords': {'on': passwordsOn, 'breached': breached, 'failed': failed},
      'list': {'on': refreshOn, 'checked': listChecked, 'updated': listUpdated},
    };
  }
}
