// The backup-code tools (docs/plans/add-vault-tools.md), as the app has them (`features/backup`): add a service's codes by pasting
// them, edit its name and note, add codes, mark one used or unused, remove one, delete the service, the low warning, and which
// accounts have no backup codes saved. A service's codes are the sealed `backupServices` list of the vault, in the app's format.
import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/features/accounts/service_names.dart' show sameService;
import 'package:kemlock_core/features/backup/backup_codes.dart';
import 'package:kemlock_core/features/backup/coverage.dart' as cover;
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/json.dart';

import 'failure.dart';
import 'tools_service.dart' show listsWith;
import 'vault_service.dart';

/// The most codes one service holds, and the longest a code is: past those the text isn't backup codes.
const maxBackupCodes = 500;
const maxBackupCodeLength = 200;

class BackupTools {
  BackupTools(this.vault);

  final VaultService vault;

  BackupService _service(String id) {
    for (final service in vault.lists.backupServices) {
      if (service.id == id) return service;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such service');
  }

  /// Changes the service [id] as [change] says, worked out from the service the write holds once it has the lock (so what a save or a
  /// sync changed meanwhile is built on), and answers it as the list shows it. [change] may throw: nothing is written then.
  Future<Map<String, Object?>> _replace(String id, BackupService Function(BackupService held) change) async {
    await vault.saveChanged(
      (lists) => listsWith(
        lists,
        backupServices: [
          for (final service in lists.backupServices)
            if (service.id == id) change(service) else service,
        ],
      ),
    );
    return vault.backupViewOf(_service(id));
  }

  /// The codes [text] holds, as the app splits them: one to a line, or split by commas, tabs and spaces, with a code of two short
  /// groups ("1234 5678") whole, each once.
  List<String> parse(String text) {
    final codes = parseCodes(text);
    if (codes.length > maxBackupCodes || codes.any((code) => code.length > maxBackupCodeLength)) {
      throw const CoreFailure(CoreFailure.invalid, 'that is not a list of backup codes');
    }
    return codes;
  }

  /// A service's codes, with who they belong to: the codes whose service they are named for, and the logins linked to those.
  Map<String, Object?> detail(String serviceId) {
    final service = _service(serviceId);
    final lists = vault.lists;
    final accounts = [
      for (final account in lists.accounts)
        if (sameService(VaultService.serviceOf(account), service.serviceName)) account,
    ];
    final ids = {for (final account in accounts) account.id};
    return {
      'serviceId': service.id,
      'name': service.serviceName,
      'note': ?service.note,
      'low': isLow(service),
      'codes': [
        for (final code in service.codes) {'code': code.code, 'used': code.used, 'usedAt': ?code.usedAt},
      ],
      'accounts': [
        for (final account in accounts) {'id': account.id, 'name': account.issuer.isEmpty ? account.label : account.issuer},
      ],
      'logins': [
        for (final login in lists.logins)
          if (login.accountId != null && ids.contains(login.accountId)) {'id': login.id, 'name': login.name},
      ],
    };
  }

  /// Adds a service with the codes in [text], all unused.
  Future<Map<String, Object?>> add(String name, String text) async {
    final trimmed = name.trim();
    final codes = parse(text);
    if (trimmed.isEmpty || trimmed.length > 200 || codes.isEmpty) {
      throw const CoreFailure(CoreFailure.invalid, 'a service needs a name and at least one code');
    }
    final service = BackupService(
      id: newUuid(),
      serviceName: trimmed,
      codes: [for (final code in codes) BackupCode(code: code)],
      addedAt: vault.nowMs,
    );
    await vault.saveChanged((lists) => listsWith(lists, backupServices: [...lists.backupServices, service]));
    return vault.backupViewOf(_service(service.id));
  }

  /// Changes a service's name or note; [clearNote] removes the note.
  Future<Map<String, Object?>> edit(String serviceId, {String? name, String? note, bool clearNote = false}) {
    _service(serviceId);
    final renamed = name?.trim();
    if (renamed != null && (renamed.isEmpty || renamed.length > 200)) {
      throw const CoreFailure(CoreFailure.invalid, 'a service needs a name');
    }
    final text = note?.trim();
    return _replace(
      serviceId,
      (held) => held.copyWith(
        serviceName: renamed ?? held.serviceName,
        note: clearNote || (text != null && text.isEmpty) ? unset : (text ?? keep),
      ),
    );
  }

  /// Adds the codes of [text] the service doesn't hold, as unused ones. How many were added and how many it held already.
  Future<Map<String, Object?>> addCodes(String serviceId, String text) async {
    _service(serviceId);
    final parsed = parse(text);
    var added = 0;
    // What the service holds is read once the write has the lock, so codes added meanwhile are counted as held
    await _replace(serviceId, (service) {
      final held = {for (final code in service.codes) code.code};
      final fresh = [
        for (final code in parsed)
          if (!held.contains(code)) code,
      ];
      if (service.codes.length + fresh.length > maxBackupCodes) throw const CoreFailure(CoreFailure.invalid, 'too many codes');
      added = fresh.length;
      if (fresh.isEmpty) return service;
      return service.copyWith(
        codes: [
          ...service.codes,
          for (final code in fresh) BackupCode(code: code),
        ],
      );
    });
    return {'added': added, 'duplicates': parsed.length - added};
  }

  /// The code at [index] of the service, when it is the one the page showed there: the page's list may be older than the vault's (a sync
  /// added, removed or moved codes), and an index into another list would mark or remove another code. Otherwise [CoreFailure.stale].
  void _expect(BackupService service, int index, String expected) {
    if (index < 0 || index >= service.codes.length) throw const CoreFailure(CoreFailure.notFound, 'no such code');
    if (service.codes[index].code != expected) throw const CoreFailure(CoreFailure.stale, 'the list of codes changed: reload it');
  }

  /// Marks the code at [index], which must be [expected], used or unused, remembering when (the app's `setBackupCodeUsed`).
  Future<Map<String, Object?>> setUsed(String serviceId, int index, bool used, String expected) {
    _expect(_service(serviceId), index, expected);
    final now = DateTime.fromMillisecondsSinceEpoch(vault.nowMs, isUtc: true);
    return _replace(serviceId, (service) {
      // The code is looked for again in the service the write holds: it may have changed since the page showed it
      _expect(service, index, expected);
      return service.copyWith(
        codes: [for (final (i, code) in service.codes.indexed) i == index ? markCode(code, used: used, now: now) : code],
      );
    });
  }

  /// Takes the code at [index], which must be [expected], out of the service.
  Future<Map<String, Object?>> removeCode(String serviceId, int index, String expected) {
    _expect(_service(serviceId), index, expected);
    return _replace(serviceId, (service) {
      _expect(service, index, expected);
      return service.copyWith(
        codes: [
          for (final (i, code) in service.codes.indexed)
            if (i != index) code,
        ],
      );
    });
  }

  Future<void> delete(String serviceId) async {
    _service(serviceId);
    // The links to the service go in the same write, worked out from the lists the write holds
    await vault.saveChanged((lists) {
      final removed = lists.backupServices.where((service) => service.id == serviceId).firstOrNull;
      return removed == null ? lists : vault.withoutEntry(lists, removed);
    });
  }

  /// Which codes have their backup codes saved: how many accounts the check looks at, how many are covered, and the others A to Z.
  Map<String, Object?> coverage() {
    final lists = vault.lists;
    final result = cover.coverage(lists.accounts, lists.backupServices);
    return {
      'total': result.total,
      'covered': result.covered,
      'missing': [
        for (final account in result.missing) {'id': account.id, 'name': cover.serviceOf(account), 'account': account.label},
      ],
    };
  }

  /// "This service gives no backup codes": the account is left out of the coverage, or put back.
  Future<void> setNone(String codeId, bool none) async {
    if (!vault.lists.accounts.any((held) => held.id == codeId)) throw const CoreFailure(CoreFailure.notFound, 'no such code');
    await vault.saveChanged(
      (lists) => listsWith(
        lists,
        accounts: [for (final held in lists.accounts) held.id == codeId ? held.copyWith(noBackupCodes: none ? true : unset) : held],
      ),
    );
  }
}
