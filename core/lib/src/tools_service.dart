// The vault's tools in the browser (docs/plans/add-vault-tools.md): tags, pins and the order of codes and logins here; the backup codes
// (backup_tools.dart), the duplicate cleaner (duplicate_tools.dart) and the breach checks (breach_tools.dart) beside it. Every change
// goes through `VaultService.saveChanged`, which stamps what changed so sync carries it, in the app's own storage format.
import 'package:kemlock_core/features/accounts/service_names.dart' show fold;
import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/json.dart';
import 'package:kemlock_core/models/key_account.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_key.dart';

import 'backup_tools.dart';
import 'breach_tools.dart';
import 'duplicate_tools.dart';
import 'failure.dart';
import 'sync_service.dart';
import 'vault_service.dart';

/// The longest a tag can be (the app's `maxTagLength`).
const maxTagLength = 24;

/// Whether two tags are the same, ignoring case and accents, as the app's `sameTag` tells.
bool sameTag(String a, String b) => fold(a) == fold(b);

/// [raw] as a list of tags: each trimmed and cut to [maxTagLength], the empty ones left out, and a tag that is another's but for
/// case and accents left out after the first (the app's `TagInput`).
List<String> normaliseTags(Iterable<String> raw) {
  final tags = <String>[];
  for (final text in raw) {
    var tag = text.trim();
    if (tag.length > maxTagLength) tag = tag.substring(0, maxTagLength).trimRight();
    if (tag.isNotEmpty && !tags.any((held) => sameTag(held, tag))) tags.add(tag);
  }
  return tags;
}

/// [lists] with the given lists replaced.
Lists listsWith(
  Lists lists, {
  List<OtpAccount>? accounts,
  List<BackupService>? backupServices,
  List<VaultKey>? keys,
  List<SecureNote>? notes,
  List<Passkey>? passkeys,
  List<KeyAccount>? keyAccounts,
  List<Login>? logins,
  List<PaymentCard>? cards,
  List<Identity>? identities,
}) => Lists(
  accounts: accounts ?? lists.accounts,
  backupServices: backupServices ?? lists.backupServices,
  keys: keys ?? lists.keys,
  notes: notes ?? lists.notes,
  passkeys: passkeys ?? lists.passkeys,
  keyAccounts: keyAccounts ?? lists.keyAccounts,
  contacts: lists.contacts,
  logins: logins ?? lists.logins,
  cards: cards ?? lists.cards,
  identities: identities ?? lists.identities,
);

/// The kinds of item that hold tags, as `ItemKind` in src/shared/tools-api.ts names them.
const taggedKinds = {'code', 'login', 'passkey', 'note', 'card', 'identity', 'key', 'keyAccount'};

/// The tools' one entry: a method name and its JSON arguments in, a JSON value out, as `CoreService.call` has it.
class ToolsService {
  ToolsService(this.vault, SyncService sync)
    : backup = BackupTools(vault),
      duplicates = DuplicateTools(vault, sync),
      breaches = BreachTools(vault);

  final VaultService vault;
  final BackupTools backup;
  final DuplicateTools duplicates;
  final BreachTools breaches;

  /// The methods this answers, by name (each is a method of `ToolsCoreApi` in src/shared/tools-api.ts).
  static const methods = {
    'tags',
    'setTags',
    'renameTag',
    'deleteTag',
    'setPinned',
    'reorderCodes',
    'reorderLogins',
    'backupDetail',
    'parseBackupCodes',
    'addBackupService',
    'editBackupService',
    'addBackupCodes',
    'setBackupCodeUsed',
    'removeBackupCode',
    'deleteBackupService',
    'backupCoverage',
    'setNoBackupCodes',
    'duplicates',
    'duplicateReview',
    'duplicateMerge',
    'duplicateDismiss',
    'duplicateRestore',
    'duplicateUndo',
    'duplicateMatching',
    'setDuplicateMatching',
    'breaches',
    'dismissBreach',
    'checkBreaches',
    'toolsSettings',
    'saveToolsSettings',
  };

  // ─── Reading the arguments ────────────────────────────────────────────

  static String _string(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  static String? _optionalString(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value == null) return null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not text');
    return value;
  }

  static bool _bool(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! bool) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not true or false');
    return value;
  }

  static int _int(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! num || value != value.toInt()) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not a whole number');
    return value.toInt();
  }

  static List<String> _strings(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! List<Object?> || value.any((item) => item is! String)) {
      throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not a list of text');
    }
    return value.cast<String>();
  }

  static Map<String, Object?> _object(List<Object?> args, int at) {
    final value = at < args.length ? args[at] : null;
    if (value is! Map<String, Object?>) throw CoreFailure(CoreFailure.invalid, 'argument ${at + 1} is not an object');
    return value;
  }

  /// Answers [method] with [args], the JSON values `ToolsCoreApi`'s method takes in order; the result is JSON.
  Future<Object?> call(String method, List<Object?> args) async {
    vault.requireSession();
    switch (method) {
      case 'tags':
        return tags();
      case 'setTags':
        return setTags(_string(args, 0), _string(args, 1), _strings(args, 2));
      case 'renameTag':
        return renameTag(_string(args, 0), _string(args, 1));
      case 'deleteTag':
        return deleteTag(_string(args, 0));
      case 'setPinned':
        await setPinned(_string(args, 0), _string(args, 1), _bool(args, 2));
        return null;
      case 'reorderCodes':
        await reorderCodes(_strings(args, 0));
        return null;
      case 'reorderLogins':
        await vault.saveLoginOrder(_strings(args, 0));
        return null;

      case 'backupDetail':
        return backup.detail(_string(args, 0));
      case 'parseBackupCodes':
        return backup.parse(_string(args, 0));
      case 'addBackupService':
        return backup.add(_string(args, 0), _string(args, 1));
      case 'editBackupService':
        return backup.edit(
          _string(args, 0),
          name: _optionalString(args, 1),
          note: _optionalString(args, 2),
          clearNote: args.length > 3 && args[3] == true,
        );
      case 'addBackupCodes':
        return backup.addCodes(_string(args, 0), _string(args, 1));
      case 'setBackupCodeUsed':
        return backup.setUsed(_string(args, 0), _int(args, 1), _bool(args, 2), _string(args, 3));
      case 'removeBackupCode':
        return backup.removeCode(_string(args, 0), _int(args, 1), _string(args, 2));
      case 'deleteBackupService':
        await backup.delete(_string(args, 0));
        return null;
      case 'backupCoverage':
        return backup.coverage();
      case 'setNoBackupCodes':
        await backup.setNone(_string(args, 0), _bool(args, 1));
        return null;

      case 'duplicates':
        return duplicates.view();
      case 'duplicateReview':
        return duplicates.review(_string(args, 0));
      case 'duplicateMerge':
        return duplicates.merge(_string(args, 0), _string(args, 1), _object(args, 2));
      case 'duplicateDismiss':
        return duplicates.dismiss(_string(args, 0));
      case 'duplicateRestore':
        await duplicates.restore(_string(args, 0));
        return null;
      case 'duplicateUndo':
        return duplicates.undo(_string(args, 0), overwrite: args.length > 1 && args[1] == true);
      case 'duplicateMatching':
        return duplicates.matching();
      case 'setDuplicateMatching':
        return duplicates.setMatching(_bool(args, 0));

      case 'breaches':
        return breaches.view();
      case 'dismissBreach':
        await breaches.dismiss(_string(args, 0), accountIds: _strings(args, 1), serviceIds: _strings(args, 2));
        return null;
      case 'checkBreaches':
        return breaches.check();
      case 'toolsSettings':
        return breaches.settings();
      case 'saveToolsSettings':
        return breaches.saveSettings(_object(args, 0));
    }
    throw CoreFailure(CoreFailure.invalid, 'no such method: $method');
  }

  // ─── Tags ─────────────────────────────────────────────────────────────

  /// The tags the vault's items hold, each with how many items hold it (the first spelling of a tag is its name), sorted A to Z
  /// ignoring case and accents.
  List<Map<String, Object?>> tags() {
    final lists = vault.lists;
    final names = <String>[];
    final counts = <int>[];
    void count(List<String>? tags) {
      for (final tag in tags ?? const <String>[]) {
        final at = names.indexWhere((held) => sameTag(held, tag));
        if (at < 0) {
          names.add(tag);
          counts.add(1);
        } else {
          counts[at]++;
        }
      }
    }

    for (final item in lists.accounts) {
      count(item.tags);
    }
    for (final item in lists.logins) {
      count(item.tags);
    }
    for (final item in lists.notes) {
      count(item.tags);
    }
    for (final item in lists.passkeys) {
      count(item.tags);
    }
    for (final item in lists.cards) {
      count(item.tags);
    }
    for (final item in lists.identities) {
      count(item.tags);
    }
    for (final item in lists.keys) {
      count(item.tags);
    }
    for (final item in lists.keyAccounts) {
      count(item.tags);
    }
    final order = [for (var i = 0; i < names.length; i++) i]..sort((a, b) => fold(names[a]).compareTo(fold(names[b])));
    return [
      for (final i in order) {'name': names[i], 'count': counts[i]},
    ];
  }

  /// The tags of the item of [kind] with [id]; throws when there is none.
  List<String> _tagsOf(Lists lists, String kind, String id) {
    List<String>? found;
    var exists = false;
    void look<T>(List<T> items, String Function(T) idOf, List<String>? Function(T) tagsOf) {
      for (final item in items) {
        if (idOf(item) == id) {
          exists = true;
          found = tagsOf(item);
        }
      }
    }

    switch (kind) {
      case 'code':
        look(lists.accounts, (a) => a.id, (a) => a.tags);
      case 'login':
        look(lists.logins, (a) => a.id, (a) => a.tags);
      case 'note':
        look(lists.notes, (a) => a.id, (a) => a.tags);
      case 'passkey':
        look(lists.passkeys, (a) => a.id, (a) => a.tags);
      case 'card':
        look(lists.cards, (a) => a.id, (a) => a.tags);
      case 'identity':
        look(lists.identities, (a) => a.id, (a) => a.tags);
      case 'key':
        look(lists.keys, (a) => a.id, (a) => a.tags);
      case 'keyAccount':
        look(lists.keyAccounts, (a) => a.id, (a) => a.tags);
      default:
        throw const CoreFailure(CoreFailure.invalid, 'not a kind of item that has tags');
    }
    if (!exists) throw const CoreFailure(CoreFailure.notFound, 'no such item');
    return found ?? const [];
  }

  /// [lists] with the tags of every item put through [change], which gives the new tags of one item or null to leave it.
  Lists _retagAll(Lists lists, List<String>? Function(List<String> tags) change) {
    List<T> each<T>(List<T> items, List<String>? Function(T) tagsOf, T Function(T, Object) apply) {
      final out = <T>[];
      for (final item in items) {
        final held = tagsOf(item);
        final next = held == null || held.isEmpty ? null : change(held);
        out.add(next == null ? item : apply(item, next.isEmpty ? unset : next));
      }
      return out;
    }

    return listsWith(
      lists,
      accounts: each(lists.accounts, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
      logins: each(lists.logins, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
      notes: each(lists.notes, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
      passkeys: each(lists.passkeys, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
      cards: each(lists.cards, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
      identities: each(lists.identities, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
      keys: each(lists.keys, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
      keyAccounts: each(lists.keyAccounts, (a) => a.tags, (a, tags) => a.copyWith(tags: tags)),
    );
  }

  /// Sets the tags of one item to [tags] (normalised: the app's rules) and answers the tags it holds now.
  Future<List<String>> setTags(String kind, String id, List<String> tags) async {
    _tagsOf(vault.lists, kind, id);
    final next = normaliseTags(tags);
    if (next.length > 50) throw const CoreFailure(CoreFailure.invalid, 'too many tags');
    final value = next.isEmpty ? unset : next;
    List<T> go<T>(List<T> items, String Function(T) idOf, T Function(T) change) => [
      for (final item in items) idOf(item) == id ? change(item) : item,
    ];
    // Worked out from the lists the write holds once it has the lock: what was saved meanwhile (a password, say) is built on
    await vault.saveChanged((lists) {
      _tagsOf(lists, kind, id);
      return switch (kind) {
        'code' => listsWith(lists, accounts: go(lists.accounts, (a) => a.id, (a) => a.copyWith(tags: value))),
        'login' => listsWith(lists, logins: go(lists.logins, (a) => a.id, (a) => a.copyWith(tags: value))),
        'note' => listsWith(lists, notes: go(lists.notes, (a) => a.id, (a) => a.copyWith(tags: value))),
        'passkey' => listsWith(lists, passkeys: go(lists.passkeys, (a) => a.id, (a) => a.copyWith(tags: value))),
        'card' => listsWith(lists, cards: go(lists.cards, (a) => a.id, (a) => a.copyWith(tags: value))),
        'identity' => listsWith(lists, identities: go(lists.identities, (a) => a.id, (a) => a.copyWith(tags: value))),
        'key' => listsWith(lists, keys: go(lists.keys, (a) => a.id, (a) => a.copyWith(tags: value))),
        _ => listsWith(lists, keyAccounts: go(lists.keyAccounts, (a) => a.id, (a) => a.copyWith(tags: value))),
      };
    });
    return _tagsOf(vault.lists, kind, id);
  }

  /// Puts the tags of every item through [change] (see [_retagAll]) in one write, leaving out the items of a space this account may not
  /// edit (the guard is not loosened: a change to one item still fails). The change is worked out from the lists the write holds once it
  /// has the lock. Answers `{changed, skipped}`, the items changed and the items left as they were.
  Future<Map<String, int>> _retag(List<String>? Function(List<String> tags) change) async {
    var wanted = 0;
    var skipped = 0;
    await vault.saveChanged((held) {
      wanted = 0;
      skipped = 0;
      final next = _retagAll(held, (tags) {
        final retagged = change(tags);
        if (retagged != null) wanted++;
        return retagged;
      });
      if (wanted == 0) return held;
      final editable = vault.keepingEditable(held, next);
      skipped = editable.skipped;
      return editable.lists;
    });
    return {'changed': wanted - skipped, 'skipped': skipped};
  }

  /// Gives the tag [from] the name [to] on every item that holds it; an item that holds [to] already keeps one. How many items changed,
  /// and how many were skipped because they are in a space this account may not edit.
  Future<Map<String, int>> renameTag(String from, String to) async {
    final name = normaliseTags([to]);
    if (name.isEmpty) throw const CoreFailure(CoreFailure.invalid, 'a tag needs a name');
    return _retag((held) {
      if (!held.any((tag) => sameTag(tag, from))) return null;
      return normaliseTags([for (final tag in held) sameTag(tag, from) ? name.first : tag]);
    });
  }

  /// Takes the tag [name] off every item that holds it. How many items changed, and how many were skipped (see [renameTag]).
  Future<Map<String, int>> deleteTag(String name) async {
    return _retag((held) {
      if (!held.any((tag) => sameTag(tag, name))) return null;
      return [
        for (final tag in held)
          if (!sameTag(tag, name)) tag,
      ];
    });
  }

  // ─── Pins and order ───────────────────────────────────────────────────

  /// Pins a code or a login to the top of its list, or unpins it (the app's `pinned`).
  Future<void> setPinned(String kind, String id, bool pinned) async {
    final value = pinned ? true : unset;
    switch (kind) {
      case 'code':
        await vault.saveChanged((lists) {
          if (!lists.accounts.any((a) => a.id == id)) throw const CoreFailure(CoreFailure.notFound, 'no such code');
          return listsWith(lists, accounts: [for (final a in lists.accounts) a.id == id ? a.copyWith(pinned: value) : a]);
        });
      case 'login':
        await vault.saveChanged((lists) {
          if (!lists.logins.any((a) => a.id == id)) throw const CoreFailure(CoreFailure.notFound, 'no such login');
          return listsWith(lists, logins: [for (final a in lists.logins) a.id == id ? a.copyWith(pinned: value) : a]);
        });
      default:
        throw const CoreFailure(CoreFailure.invalid, 'only codes and logins are pinned');
    }
  }

  /// Saves a custom order of the codes as the app does (`reorderAccounts`): the ids given take positions 0, 1, 2, ... and the codes
  /// not named keep theirs.
  Future<void> reorderCodes(List<String> ids) async {
    final position = <String, int>{};
    for (final id in ids) {
      position.putIfAbsent(id, () => position.length);
    }
    await vault.saveChanged(
      (lists) =>
          listsWith(lists, accounts: [for (final a in lists.accounts) position.containsKey(a.id) ? a.copyWith(order: position[a.id]) : a]),
    );
  }
}
