// The vault's items as the TypeScript side sees them (`CodeView`, `LoginView`, … in src/shared/api.ts): plain JSON, with no
// secret. A code's secret never leaves the core, and a password leaves only through `revealLogin`.
import 'package:kemlock_core/features/accounts/otp.dart';
import 'package:kemlock_core/features/backup/backup_codes.dart' show isLow;
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/key_account.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';

import 'health.dart';
import 'item_extras.dart';

/// [account] as a `CodeView`. [order] is its place in the vault's list, for an account with none of its own; [loginId] is the
/// login linked to it. [lent] holds the websites of the linked items that have some (the code shows those instead of its own, which
/// stay in `ownWebsites`) and who they are from; [fields] and [links] are as in `noteView`.
Map<String, Object?> codeView(
  OtpAccount account, {
  required int order,
  String? loginId,
  int? backupCodesLeft,
  Map<String, Object?>? space,
  ({List<String> hosts, List<Map<String, Object?>> from})? lent,
  List<Map<String, Object?>> fields = const [],
  int links = 0,
}) => {
  'id': account.id,
  'name': ?_named(account.name),
  'issuer': account.issuer,
  'account': account.label,
  'type': account.kind.name,
  'digits': codeLength(account),
  'period': account.kind == OtpType.hotp ? 0 : account.period,
  'tags': account.tags ?? const <String>[],
  'order': account.order ?? order,
  'pinned': ?(account.pinned == true ? true : null),
  'onSecurityKey': false,
  'websites': lent?.hosts ?? [for (final rule in account.rules) ?rule.host],
  'ownWebsites': [for (final rule in account.rules) ?rule.host],
  'websitesFrom': ?lent?.from,
  'note': ?_named(account.note),
  'loginId': ?loginId,
  'backupCodesLeft': ?backupCodesLeft,
  'space': ?space,
  'fields': fields,
  'links': links,
};

String? _named(String? name) => name == null || name.trim().isEmpty ? null : name;

/// What the vault remembers of an account on a security key: named, never computed or filled.
Map<String, Object?> keyAccountView(KeyAccount account, {required int order}) => {
  'id': account.id,
  'issuer': account.issuer.isEmpty ? account.name : account.issuer,
  'account': account.label,
  'type': account.type.name,
  'digits': 6,
  'period': account.type == KeyAccountType.hotp ? 0 : account.period,
  'tags': account.tags ?? const <String>[],
  'order': order,
  'onSecurityKey': true,
  'websites': const <String>[],
  'ownWebsites': const <String>[],
  'fields': const <Object?>[],
  'links': 0,
};

/// A live code: only the digits leave the core. TOTP and Steam end with their window; HOTP has no end.
Map<String, Object?> liveCode(OtpAccount account, int nowMs) {
  final seconds = nowMs ~/ 1000;
  final code = codeAt(account, seconds);
  if (account.kind == OtpType.hotp || account.period <= 0) return {'id': account.id, 'code': code};
  final windowEnd = (seconds ~/ account.period + 1) * account.period;
  return {'id': account.id, 'code': code, 'expiresAt': windowEnd * 1000};
}

/// [login] as a `LoginView`, with no password. When [hidden] (its password is hidden from this account in a shared space) the view has
/// no `strength` either: how strong a password is would tell what it is. [fields] and [links] are as in `noteView`.
Map<String, Object?> loginView(
  Login login, {
  required int order,
  required LoginHealth health,
  Map<String, Object?>? space,
  bool hidden = false,
  List<Map<String, Object?>> fields = const [],
  int links = 0,
}) {
  final warnings = health.of(login.id);
  final password = login.password ?? '';
  return {
    'id': login.id,
    'name': login.name,
    'username': login.username ?? '',
    'websites': [for (final rule in login.rules) ?rule.host],
    'websiteRules': ruleViews(login.rules),
    'fields': fields,
    'links': links,
    'tags': login.tags ?? const <String>[],
    'order': order,
    'pinned': ?(login.isPinned ? true : null),
    'note': ?login.note,
    'hasPassword': password.isNotEmpty,
    'strength': ?(hidden ? null : (password.isEmpty ? 0 : strengthLevel(password))),
    'passwordChangedAt': ?login.passwordChangedAt,
    'previousPasswords': login.previousPasswords?.length ?? 0,
    'codeId': ?login.accountId,
    'space': ?space,
    'health': {
      'reused': warnings.contains(LoginWarning.reused),
      'weak': warnings.contains(LoginWarning.weak),
      'withoutItsCode': warnings.contains(LoginWarning.noCode),
      'breached': ?(warnings.contains(LoginWarning.breached) ? true : null),
      'ignored': login.codeWarning == false,
    },
  };
}

/// A service's backup codes as a `BackupCodeView`: one row per service.
Map<String, Object?> backupView(
  BackupService service, {
  Map<String, Object?>? space,
  List<Map<String, Object?>> fields = const [],
  int links = 0,
}) => {
  'serviceId': service.id,
  'name': ?_named(service.name),
  'issuer': service.serviceName,
  'websites': [for (final rule in service.rules) ?rule.host],
  'note': ?_named(service.note),
  'fields': fields,
  'links': links,
  'total': service.codes.length,
  'left': service.codes.where((code) => !code.used).length,
  'space': ?space,
  'low': isLow(service),
};
