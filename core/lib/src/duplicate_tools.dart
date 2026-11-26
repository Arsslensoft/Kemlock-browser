// The duplicate cleaner in the browser (docs/plans/add-vault-tools.md, and the app's add-duplicate-cleaner): the groups of items the
// vault holds more than once by Kemlock-core's rules, what a merge would keep, the merge and its Undo, and "Not duplicates". The
// vault's two sealed values are the app's (`backmycodes_dedup`, the tags cache; `backmycodes_dedup_answers`, the dismissals and the
// merge records), so a phone and the browser read each other's. With a Kemlock Server account, server matching is the app's too:
// the switch, the groups the server suggests (checked against the items before they are shown) and "Not duplicates" shared.
import 'dart:convert';

import 'package:crypto/crypto.dart' as hash;
import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/features/duplicates/dedup_cache.dart' show DedupAnswers;
import 'package:kemlock_core/features/duplicates/dedup_store.dart';
import 'package:kemlock_core/features/duplicates/dedup_tagger.dart';
import 'package:kemlock_core/features/duplicates/duplicate_matcher.dart';
import 'package:kemlock_core/features/duplicates/duplicate_merge.dart';
import 'package:kemlock_core/features/duplicates/duplicate_normalise.dart' show SiteResolver;
import 'package:kemlock_core/features/duplicates/duplicate_rules.dart' show DuplicateReason;
import 'package:kemlock_core/features/duplicates/duplicate_server.dart';
import 'package:kemlock_core/features/duplicates/duplicate_view.dart';
import 'package:kemlock_core/features/sync/kemlock/km_dedup_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_files.dart' show kmServerFileId;
import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/contact.dart';
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_entry.dart';
import 'package:kemlock_core/models/vault_file.dart';
import 'package:kemlock_core/models/vault_key.dart';
import 'package:kemlock_core/vault/item_links.dart' show undoRelink;

import 'failure.dart';
import 'item_extras.dart' show listsWithEntry;
import 'matching.dart' show isSharedHost;
import 'sync_service.dart';
import 'tools_service.dart' show listsWith;
import 'vault_service.dart';

/// The hash of the Public Suffix List's [text], which the tag cache records: a list that changes how some sites read makes the tags
/// again. `none` without the list, where every host stands for itself (the app's `suffixListHash`).
String suffixListHash(String? text) => text == null || text.isEmpty ? 'none' : hash.sha256.convert(utf8.encode(text)).toString();

class DuplicateTools {
  DuplicateTools(this.vault, this.sync);

  final VaultService vault;
  final SyncService sync;

  SiteResolver get _sites => SiteResolver(registrable: vault.matcher.registrable, isShared: isSharedHost);

  List<DedupItem> _items(Lists lists) => dedupItems(
    accounts: lists.accounts,
    services: lists.backupServices,
    notes: lists.notes,
    passkeys: lists.passkeys,
    keys: lists.keys,
    logins: lists.logins,
    cards: lists.cards,
    identities: lists.identities,
    contacts: lists.contacts,
    files: lists.files,
  );

  /// The items the matching works on: the vault's, with every hidden password taken out first (as health does), so that the match, its
  /// tags and its reason never depend on, or tell, a password the person can't read. A login that has one is matched by its site and
  /// username only, and never as "same sign-in".
  List<DedupItem> _matchItems(Lists lists) => _items(listsWith(lists, logins: vault.withoutHiddenPasswords(lists.logins)));

  /// [group] with the items it holds as the vault does, hidden passwords and all, for the review and the merge, which work on what is
  /// held. (The match was made on the items without those passwords; nothing of them is in the answer but the dots of a field.)
  DuplicateGroup _held(DuplicateGroup group, Map<String, DedupItem> held) =>
      DuplicateGroup(reason: group.reason, items: [for (final entry in group.items) held[entry.id] ?? entry]);

  /// Finds the groups again: the tags are made for what moved, the groups they suggest are compared against the items, the server's
  /// hints are taken in when server matching is on, and the groups the person said are not duplicates are left out. Records past
  /// their 30 days go. A hidden password is neither compared nor shown: see [_matchItems].
  Future<({List<DuplicateGroup> groups, DedupAnswers answers})> _check() async {
    final session = vault.requireSession();
    final lists = vault.lists;
    final items = _matchItems(lists);
    final held = {for (final entry in _items(lists)) entry.id: entry};
    final sites = _sites;
    final store = DedupStore(vault.vault);
    final tags = await store.refresh(
      session,
      items: items,
      spaces: const [],
      listHash: suffixListHash(vault.data.publicSuffixList),
      sites: sites,
    );
    var found = findDuplicates(items: items, tags: tags, sites: sites, keyIdentityOf: dedupKeyIdentity);
    final target = sync.kemlockTarget;
    final hints = sync.kemlockHints;
    if (target != null && target.matching && hints != null) {
      found = withServerHints(
        found: found,
        items: items,
        hints: hints,
        accountId: target.accountId,
        sites: sites,
        keyIdentityOf: dedupKeyIdentity,
      );
    }
    var answers = await store.loadAnswers(session);
    final pruned = answers.pruned(vault.nowMs);
    if (pruned.merges.length != answers.merges.length) {
      await store.saveAnswers(pruned, session);
      answers = pruned;
    }
    return (groups: [for (final group in withoutDismissed(found, answers.dismissed)) _held(group, held)], answers: answers);
  }

  /// A line under an item's name in the list of a group.
  String _detail(Object item) => switch (item) {
    Login(:final username, :final rules) => [
      if (username != null && username.isNotEmpty) username,
      ...rules.map((rule) => rule.host).whereType<String>().take(1),
    ].join(' · '),
    OtpAccount(:final label, :final issuer) => issuer.isEmpty ? '' : label,
    BackupService(:final codes) => '${codes.length}',
    Passkey(:final userName) => userName,
    _ => '',
  };

  Map<String, Object?> _itemView(DedupItem entry) => {
    'id': entry.id,
    'name': duplicateName(entry.item),
    'detail': _detail(entry.item),
    'changedAt': entry.changedAt,
  };

  /// The groups, the merges Undo can put back, and whether server matching is available and on.
  Future<Map<String, Object?>> view() async {
    final result = await _check();
    return {
      'checkedAt': vault.nowMs,
      'groups': [
        for (final group in result.groups)
          {
            'key': group.key,
            'reason': group.reason.name,
            'kind': mergeKindOf(group.items.first.item),
            'items': [for (final entry in group.items) _itemView(entry)],
          },
      ],
      'records': [
        for (final record in result.answers.mergeRecords)
          {'id': record.id, 'at': record.at, 'label': record.label, 'count': record.removed.length},
      ],
      'matching': matching(),
    };
  }

  /// The group with [key] as a check finds it now, never as an earlier one found it: what a merge works on is what the vault holds, and a
  /// sync or another page may have changed an item since the person looked. A group that is not there any more is [CoreFailure.stale].
  Future<DuplicateGroup> _fresh(String key) async {
    final result = await _check();
    for (final group in result.groups) {
      if (group.key == key) return group;
    }
    throw const CoreFailure(CoreFailure.stale, 'that group is not there any more: check again');
  }

  /// Whether an item of [group] is not what [lists] hold now: it was changed, or removed, since the check that made the group.
  bool _stale(DuplicateGroup group, Lists lists) {
    final held = {for (final entry in _items(lists)) entry.id: entry.changedAt};
    return group.items.any((entry) => held[entry.id] != entry.changedAt);
  }

  /// What a merge of the group would do, to choose from: the item that stays and, for each field that differs, the text each copy
  /// has (a password only as dots) and the one taken, the newest first.
  Future<Map<String, Object?>> review(String key) async {
    final group = await _fresh(key);
    final mergeable = _mergeable(group);
    final choices = MergeChoices(mergeable.group.items, hiddenPasswords: vault.hiddenPasswordIds);
    // The key is the whole group's, as the list gave it: the merge finds the group by it, and the group without the items this account
    // may not edit has another
    return _plan(mergeable.group, choices, key: group.key, skipped: mergeable.skipped);
  }

  /// Whether this account may change [entry]: its space lets it edit it and, for a code, the same goes for every login linked to it, which
  /// a merge that removes the code links to the one that stays.
  bool _canChange(DedupItem entry) {
    try {
      vault.editGuard?.call(entry.spaceId, entry.id);
      if (entry.item is OtpAccount) {
        for (final login in vault.lists.logins) {
          if (login.accountId == entry.id) vault.editGuard?.call(login.spaceId, login.id);
        }
      }
      return true;
    } on CoreFailure {
      return false;
    }
  }

  /// [group] without the items of a space this account may not edit, which a merge can neither change nor remove, and how many that
  /// left out. A group with fewer than two items left can't be merged: [CoreFailure] `space_readOnly`.
  ({DuplicateGroup group, int skipped}) _mergeable(DuplicateGroup group) {
    final items = [
      for (final entry in group.items)
        if (_canChange(entry)) entry,
    ];
    if (items.length < 2) throw const CoreFailure('space_readOnly', 'fewer than two of these items are in a space this account may edit');
    return (group: DuplicateGroup(reason: group.reason, items: items), skipped: group.items.length - items.length);
  }

  Map<String, Object?> _plan(DuplicateGroup group, MergeChoices choices, {required String key, int skipped = 0}) => {
    'key': key,
    'skipped': ?(skipped == 0 ? null : skipped),
    'keptId': choices.keptId,
    'items': [for (final entry in group.items) _itemView(entry)],
    'fields': [
      for (final field in choices.differing)
        {
          'id': field.id,
          'picked': choices.pickFor(field).id,
          'options': [
            for (final entry in group.items) {'itemId': entry.id, 'text': duplicateFieldText(field.id, field.read(entry.item))},
          ],
        },
    ],
  };

  /// The logins linked to a code that goes: they are linked to the code that stays.
  List<Login> _relinked(Object result, Set<String> goneIds, Lists lists) => result is OtpAccount
      ? [
          for (final login in lists.logins)
            if (goneIds.contains(login.accountId)) login,
        ]
      : const <Login>[];

  /// Merges the group into the item [keptId], each field in [picks] (`{fieldId: itemId}`) taken from the item named, working on the
  /// group as a fresh check finds it: the merge record is written first, then the item that stays is saved with the others removed in
  /// one change, and the logins linked to a code that goes are linked to the one that stays.
  ///
  /// An item that changed between the record and the save makes it [CoreFailure.stale], and nothing is changed. A save that fails is
  /// written back whole (`VaultService.saveChanged`) and the record goes, since no merge happened; only when the write-back fails too,
  /// the record stays so that Undo can repair what storage holds. How many items went, and the record's id.
  Future<Map<String, Object?>> merge(String key, String keptId, Map<String, Object?> picks) async {
    final session = vault.requireSession();
    final whole = await _fresh(key);
    // The items of a space this account may not edit are skipped (and counted), not the whole merge refused
    final mergeable = _mergeable(whole);
    final group = mergeable.group;
    if (!group.items.any((entry) => entry.id == keptId)) {
      throw const CoreFailure(CoreFailure.invalid, 'the item that stays is not in the group');
    }
    var choices = MergeChoices(group.items, hiddenPasswords: vault.hiddenPasswordIds).withKept(keptId);
    for (final MapEntry(key: fieldId, value: itemId) in picks.entries) {
      if (itemId is! String || !group.items.any((entry) => entry.id == itemId)) continue;
      for (final field in mergeFieldsOf(choices.kept.item)) {
        if (field.id == fieldId) choices = choices.withPick(field, itemId);
      }
    }
    final now = vault.nowMs;
    final result = choices.merged(now);
    final gone = choices.removed;
    final goneIds = {for (final entry in gone) entry.id};
    final relink = _relinked(result, goneIds, vault.lists);
    // What the merge does to the links and custom fields: the kept item takes the removed items' and every entry that named one of them
    // now names it, from both ends. Worked out here for the record, and again on the lists the write holds
    final owner = vault.accountOwner?.call();
    final relinking = choices.relink(vault.lists, now: now, account: owner);
    final record = MergeRecord(
      id: newUuid(),
      at: now,
      kind: mergeKindOf(result),
      kept: mergeJsonOf(choices.kept.item),
      removed: [for (final entry in gone) mergeJsonOf(entry.item)],
      relinked: [for (final login in relink) mergeJsonOf(login)],
      relinkUndo: relinking.undo,
    );
    final store = DedupStore(vault.vault);
    final answers = await store.loadAnswers(session);
    await store.saveAnswers(answers.pruned(now).withMerge(record), session);
    Future<void> dropRecord() async {
      try {
        await store.saveAnswers(answers, session);
      } catch (_) {
        // The record stays: Undo puts the items back as they were, which is what they are
      }
    }

    try {
      // Checked and built on the lists the write holds once it has the lock, so that what is checked is what is saved: an item
      // changed, deleted or relinked since the check (by a save or a sync that went first) makes the merge stale, and nothing is
      // written. Stamped with the record's own time, which is how Undo tells an edit made since from the merge itself
      await vault.saveChanged((lists) {
        final again = _relinked(result, goneIds, lists);
        final sameLinks =
            again.length == relink.length &&
            [for (var i = 0; i < again.length; i++) jsonEncode(mergeJsonOf(again[i])) == jsonEncode(mergeJsonOf(relink[i]))]
                .every((same) => same);
        // The links and fields the merge joins, and the entries it rewrites, are those the record keeps for Undo: a link made or dropped
        // since (a save that went first) makes it stale, as an item changed does
        final relinkedNow = choices.relink(lists, now: now, account: owner);
        final sameRelink =
            jsonEncode(relinkedNow.kept.toJson()) == jsonEncode(relinking.kept.toJson()) &&
            jsonEncode([for (final step in relinkedNow.undo) step.toJson()]) ==
                jsonEncode([for (final step in relinking.undo) step.toJson()]);
        if (_stale(group, lists) || !sameLinks || !sameRelink) {
          throw const CoreFailure(CoreFailure.stale, 'an item changed since the check: check again');
        }
        final next = _replacing(_without(lists, goneIds), [relinkedNow.kept]);
        // The other entries are written in the same change; one in a space this account may not edit keeps what it holds, which Undo
        // (it puts a member back only where the entry still holds what the merge wrote) then leaves alone
        return _putting(next, relinkedNow.others);
      }, at: now);
    } on PartialSave {
      rethrow;
    } catch (_) {
      await dropRecord();
      rethrow;
    }
    return {'removed': gone.length, 'recordId': record.id, 'skipped': mergeable.skipped};
  }

  /// Every item of [lists] by id, whatever its kind.
  Map<String, Object> _byId(Lists lists) => {
    for (final item in lists.accounts) item.id: item,
    for (final item in lists.backupServices) item.id: item,
    for (final item in lists.keys) item.id: item,
    for (final item in lists.notes) item.id: item,
    for (final item in lists.passkeys) item.id: item,
    for (final item in lists.contacts) item.id: item,
    for (final item in lists.logins) item.id: item,
    for (final item in lists.cards) item.id: item,
    for (final item in lists.identities) item.id: item,
    for (final item in lists.files) item.id: item,
  };

  /// Puts back what the merge with [recordId] took, as `planUndo` plans it, and drops the record: the items that went, the item that
  /// stayed as it was, and each relinked login's link only. Answers `undone`; `unavailable` when there is no such record, it is past
  /// its 30 days, or it can't be read; and `edited` when the item that stayed was changed after the merge, which putting it back would
  /// lose: nothing is changed until the person says [overwrite].
  Future<String> undo(String recordId, {bool overwrite = false}) async {
    final session = vault.requireSession();
    final store = DedupStore(vault.vault);
    final answers = await store.loadAnswers(session);
    MergeRecord? record;
    for (final held in answers.mergeRecords) {
      if (held.id == recordId) record = held;
    }
    if (record == null || !record.undoable(vault.nowMs)) return 'unavailable';
    final merged = record;
    var outcome = 'undone';
    // Planned on the lists the write holds once it has the lock, so that an edit that went first is seen, not written over
    await vault.saveChanged((lists) {
      final held = _byId(lists);
      final plan = planUndo(merged, find: (id) => held[id]);
      if (plan == null) {
        outcome = 'unavailable';
        return lists;
      }
      // An item that named a file the server holds can't come back: the next run deletes that file, no body naming it any more
      if (plan.removed.any(_namesServerFile)) {
        outcome = 'unavailable';
        return lists;
      }
      if (plan.keptEdited && !overwrite) {
        outcome = 'edited';
        return lists;
      }
      var next = _replacing(lists, [plan.kept, ...plan.removed]);
      // A login the merge pointed at the code that stays goes back to the code that went (only a record from before `relinkUndo` needs
      // this; a newer one is put back below), unless it is in a space this account may not edit
      next = _putting(next, [
        for (final login in next.logins)
          if (plan.relinks.containsKey(login.id)) login.copyWith(accountId: plan.relinks[login.id]),
      ]);
      // What the merge wrote on the other entries goes back where they still hold it: one linked or edited since keeps what it holds
      return _putting(next, undoRelink(next, plan.relinkUndo, now: vault.nowMs));
    });
    if (outcome == 'undone') await store.saveAnswers(answers.withoutMerge(recordId), session);
    return outcome;
  }

  /// Whether [item] is a note or File item that names a file on the server.
  bool _namesServerFile(Object item) => switch (item) {
    final SecureNote note => note.files.any((file) => kmServerFileId(file) != null),
    final VaultFile file => kmServerFileId(file.file) != null,
    _ => false,
  };

  /// [lists] without the items with these ids, whatever their kind.
  Lists _without(Lists lists, Set<String> ids) => Lists(
    accounts: [
      for (final item in lists.accounts)
        if (!ids.contains(item.id)) item,
    ],
    backupServices: [
      for (final item in lists.backupServices)
        if (!ids.contains(item.id)) item,
    ],
    keys: [
      for (final item in lists.keys)
        if (!ids.contains(item.id)) item,
    ],
    notes: [
      for (final item in lists.notes)
        if (!ids.contains(item.id)) item,
    ],
    passkeys: [
      for (final item in lists.passkeys)
        if (!ids.contains(item.id)) item,
    ],
    keyAccounts: lists.keyAccounts,
    contacts: [
      for (final item in lists.contacts)
        if (!ids.contains(item.id)) item,
    ],
    logins: [
      for (final item in lists.logins)
        if (!ids.contains(item.id)) item,
    ],
    cards: [
      for (final item in lists.cards)
        if (!ids.contains(item.id)) item,
    ],
    identities: [
      for (final item in lists.identities)
        if (!ids.contains(item.id)) item,
    ],
    files: [
      for (final item in lists.files)
        if (!ids.contains(item.id)) item,
    ],
  );

  /// [lists] with each of [entries] put in place of the entry of its kind with its id, leaving out one in a space this account may not
  /// edit (the merge, and its Undo, do what they can and never fail for the other end of a link).
  Lists _putting(Lists lists, Iterable<VaultEntry<Object?>> entries) {
    var next = lists;
    for (final entry in entries) {
      try {
        vault.editGuard?.call(entry.spaceId, entry.id);
      } on CoreFailure {
        continue;
      }
      next = listsWithEntry(next, entry);
    }
    return next;
  }

  /// [lists] with each of [items] put in place of the item of its kind with its id, or added at the end.
  Lists _replacing(Lists lists, List<Object> items) {
    List<T> put<T>(List<T> list, Iterable<T> mine, String Function(T) idOf) {
      final by = {for (final item in mine) idOf(item): item};
      final held = {for (final item in list) idOf(item)};
      return [
        for (final item in list) by[idOf(item)] ?? item,
        for (final item in mine)
          if (!held.contains(idOf(item))) item,
      ];
    }

    return Lists(
      accounts: put(lists.accounts, items.whereType<OtpAccount>(), (a) => a.id),
      backupServices: put(lists.backupServices, items.whereType<BackupService>(), (a) => a.id),
      keys: put(lists.keys, items.whereType<VaultKey>(), (a) => a.id),
      notes: put(lists.notes, items.whereType<SecureNote>(), (a) => a.id),
      passkeys: put(lists.passkeys, items.whereType<Passkey>(), (a) => a.id),
      keyAccounts: lists.keyAccounts,
      contacts: put(lists.contacts, items.whereType<Contact>(), (a) => a.id),
      logins: put(lists.logins, items.whereType<Login>(), (a) => a.id),
      cards: put(lists.cards, items.whereType<PaymentCard>(), (a) => a.id),
      identities: put(lists.identities, items.whereType<Identity>(), (a) => a.id),
      files: put(lists.files, items.whereType<VaultFile>(), (a) => a.id),
    );
  }

  /// Remembers that the group is not duplicates: Check again leaves it out until another item joins it, which gives it another key.
  /// With server matching on, a same-sign-in group of the vault's logins is shared with the server too, so another device hides it
  /// after its next sync (best effort: the answer is kept here either way).
  Future<bool> dismiss(String key) async {
    final session = vault.requireSession();
    final group = await _fresh(key);
    final store = DedupStore(vault.vault);
    await store.saveAnswers((await store.loadAnswers(session)).withDismissed(key), session);
    final target = sync.kemlockTarget;
    if (target != null && target.matching && group.reason == DuplicateReason.sameSignIn) {
      final ids = serverIdsOfGroup(group, target.accountId);
      if (ids != null && ids.length >= 2 && ids.length <= 500) {
        try {
          final id = await sync.kemlockHost().withAccount(
            target,
            (connection, account) =>
                connection.call((token) => KmDedupApi(connection.api).dismiss(connection.server, token, 'user:${target.accountId}', ids)),
          );
          await store.saveAnswers((await store.loadAnswers(session)).withShared(key, id), session);
        } catch (_) {
          // The server can't be reached: the answer stays here
        }
      }
    }
    return true;
  }

  /// Takes "Not duplicates" back for the group with [key]: it is asked again at the next check, and the answer the server holds for
  /// it, if this browser shared one, is deleted.
  Future<void> restore(String key) async {
    final session = vault.requireSession();
    final store = DedupStore(vault.vault);
    final answers = await store.loadAnswers(session);
    final shared = answers.sharedDismissals[key];
    await store.saveAnswers(answers.withoutDismissal(key), session);
    final target = sync.kemlockTarget;
    if (shared != null && target != null) {
      try {
        await sync.kemlockHost().withAccount(
          target,
          (connection, account) => connection.call((token) => KmDedupApi(connection.api).undismiss(connection.server, token, shared)),
        );
      } catch (_) {
        // The server can't be reached: its answer stays, and hides the group on the other devices
      }
    }
  }

  /// Whether the vault syncs with a Kemlock Server, and whether server matching is on for it.
  Map<String, Object?> matching() {
    final target = sync.kemlockTarget;
    return {'available': target != null, 'on': target?.matching ?? false};
  }

  /// Turns server matching on for the vault, or off (which deletes every tag the server holds first), and says how it stands.
  Future<Map<String, Object?>> setMatching(bool on) async {
    final target = sync.kemlockTarget;
    if (target == null) throw const CoreFailure(CoreFailure.invalid, 'the vault does not sync with Kemlock Server');
    final owner = 'user:${target.accountId}';
    await sync.kemlockHost().withAccount(target, (connection, account) {
      final api = KmDedupApi(connection.api);
      return connection.call((token) => on ? api.turnOn(connection.server, token, owner) : api.deleteTags(connection.server, token, owner));
    });
    if (!on) sync.kemlockHints = null;
    await sync.saveKemlockTarget(target.copyWith(matching: on));
    return matching();
  }
}
