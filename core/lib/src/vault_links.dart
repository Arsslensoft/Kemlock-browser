// Links and custom fields of the browser's vault: which items an item is linked to, linking and unlinking two items (both ends
// written together), the items a link could name, one field's value, and the changes to a code's or backup codes' own members. A
// part of the vault service, so each write has the vault's lock and is counted as a change made here, and the formats are
// Kemlock-core's (item_extras.dart holds the pure steps).
part of 'vault_service.dart';

extension VaultLinks on VaultService {
  /// [value] trimmed, or null when it is blank; refuses what is longer than [max].
  String? _textOf(Object? value, String what, {int max = 2048}) {
    final text = asString(value).trim();
    if (text.length > max) throw CoreFailure(CoreFailure.invalid, '$what is too long');
    return text.isEmpty ? null : text;
  }

  // ─── Fields ───────────────────────────────────────────────────────────

  List<CustomField> _fieldsOf(VaultEntry<Object?> entry) => switch (entry) {
    final Login item => item.fields,
    final OtpAccount item => item.fields,
    final BackupService item => item.fields,
    final SecureNote item => item.fields,
    final PaymentCard item => item.fields,
    final Identity item => item.fields,
    final Contact item => item.fields,
    final VaultKey item => item.fields,
    _ => throw const CoreFailure(CoreFailure.invalid, 'this item has no custom fields'),
  };

  VaultEntry<Object?> _entryOf(ItemRef ref) =>
      findEntry(_lists, ref.kind, ref.id) ?? (throw const CoreFailure(CoreFailure.notFound, 'no such item'));

  /// The value of one custom field of the item [ref], hidden or not: the page asks for one at a time.
  String revealField(ItemRef ref, int index) {
    requireSession();
    return fieldValueAt(_fieldsOf(_entryOf(ref)), index);
  }

  /// The value of every field of the item [ref] the browser can edit, for its edit page.
  List<Map<String, Object?>> revealFields(ItemRef ref) {
    requireSession();
    return [
      for (final (index, field) in _fieldsOf(_entryOf(ref)).indexed)
        if (field.isEditable) {'index': index, 'value': field.value},
    ];
  }

  // ─── Links ────────────────────────────────────────────────────────────

  Map<String, Object?> _linkedView(LinkedItem item) {
    final entry = item.entry!;
    return {
      'ref': refOf(entry),
      'name': entryNameOf(entry),
      'detail': ?entryDetailOf(entry),
      'halfMade': ?(item.oneWay ? true : null),
      'space': ?spaceNote?.call(entry.spaceId, entry.id, login: entry is Login),
    };
  }

  int _byName(VaultEntry<Object?> a, VaultEntry<Object?> b) {
    final order = entryNameOf(a).toLowerCase().compareTo(entryNameOf(b).toLowerCase());
    return order != 0 ? order : a.id.compareTo(b.id);
  }

  /// The items [ref] is linked to, from both ends, as `LinkedItemView`s by name. A link to an item the vault doesn't hold is kept and
  /// left out here.
  List<Map<String, Object?>> linkedItemViews(ItemRef ref) {
    requireSession();
    final entry = _entryOf(ref);
    final items = [
      for (final item in linkedItemsOf(_lists, entry, account: accountOwner?.call()))
        if (item.entry != null) item,
    ]..sort((a, b) => _byName(a.entry!, b.entry!));
    return [for (final item in items) _linkedView(item)];
  }

  /// At most 50 items that could be linked to [ref] (to a new item, when it is null), matching [query] in name, username, website and
  /// the like: never the item itself or one it is linked to already, and only those this account may change, since a link writes both
  /// ends.
  List<Map<String, Object?>> linkCandidateViews(ItemRef? ref, String query) {
    requireSession();
    final owner = accountOwner?.call();
    final lists = _lists;
    final self = ref == null ? null : _entryOf(ref);
    final taken = <String>{
      if (self != null)
        for (final item in linkedItemsOf(lists, self, account: owner)) item.id,
    };
    final needle = query.trim().toLowerCase();
    final found = [
      for (final entry in entriesOf(lists))
        if (entry is! KeyAccount &&
            (self == null || entry.id != self.id) &&
            !taken.contains(linkIdOf(entry, account: owner).toLowerCase()) &&
            (needle.isEmpty || entrySearchText(entry).contains(needle)))
          entry,
    ]..sort(_byName);
    final out = <Map<String, Object?>>[];
    for (final entry in found) {
      if (out.length >= linkCandidatesMax) break;
      try {
        editGuard?.call(entry.spaceId, entry.id);
      } on CoreFailure {
        continue;
      }
      out.add(
        _linkedView(
          LinkedItem(
            id: linkIdOf(entry, account: owner).toLowerCase(),
            entry: entry,
          ),
        ),
      );
    }
    return out;
  }

  /// Makes the item [kind] [id] linked to the items of [wanted] and to no other it can see: each end is written, both together, so a
  /// link is never made at one end alone. A link the item holds that the vault has no item for stays. An end this account may not
  /// edit, an item that isn't there and one that has no item id yet are left as they were and named in the answer.
  Future<List<String>> setLinksOf(String kind, String id, List<ItemRef> wanted) async {
    requireSession();
    final owner = accountOwner?.call();
    final lists = _lists;
    final self = findEntry(lists, kind, id) ?? (throw const CoreFailure(CoreFailure.notFound, 'no such item'));
    editGuard?.call(self.spaceId, self.id);
    final failed = <String>[];
    final current = {
      for (final item in linkedItemsOf(lists, self, account: owner))
        if (item.entry != null) item.id: item,
    };
    // An item that holds more links than the limit already may be saved with the ones it has
    if (wanted.length > linkRefsMax && wanted.length > current.length) throw const CoreFailure(CoreFailure.invalid, 'too many links');
    final desired = <String, VaultEntry<Object?>>{};
    for (final ref in wanted) {
      final other = findEntry(lists, ref.kind, ref.id);
      if (other == null) {
        failed.add(ref.id);
      } else if (other.id != self.id) {
        desired[linkIdOf(other, account: owner).toLowerCase()] = other;
      }
    }
    bool writable(VaultEntry<Object?> other) {
      try {
        editGuard?.call(other.spaceId, other.id);
        return true;
      } on CoreFailure {
        failed.add(entryNameOf(other));
        return false;
      }
    }

    // A link one end names is made whole by asking for it again
    final adds = [
      for (final MapEntry(:key, :value) in desired.entries)
        if (current[key] == null || current[key]!.oneWay) value,
    ].where(writable).toList();
    final drops = [
      for (final MapEntry(:key, :value) in current.entries)
        if (!desired.containsKey(key)) value.entry!,
    ].where(writable).toList();
    if (adds.isEmpty && drops.isEmpty) return failed;
    await saveChanged((held) {
      var next = held;
      void change(VaultEntry<Object?> other, {required bool link}) {
        final a = findEntry(next, kind, id) ?? (throw const CoreFailure(CoreFailure.notFound, 'no such item'));
        final b = findEntry(next, itemKindOf(other), other.id);
        if (b == null) return;
        if (link && (!isLinkId(linkIdOf(a, account: owner)) || !isLinkId(linkIdOf(b, account: owner)))) {
          failed.add(entryNameOf(b));
          return;
        }
        final result = link ? linkEntries(a, b, now: nowMs, account: owner) : unlinkEntries(a, b, now: nowMs, account: owner);
        next = listsWithEntry(listsWithEntry(next, result.a), result.b);
      }

      for (final other in adds) {
        change(other, link: true);
      }
      for (final other in drops) {
        change(other, link: false);
      }
      return next;
    });
    return failed;
  }

  // ─── Codes and backup codes ───────────────────────────────────────────

  /// [service] as a `BackupCodeView`, with its custom fields (no hidden value), its links and the space it is in.
  Map<String, Object?> backupViewOf(BackupService service) => backupView(
    service,
    space: spaceNote?.call(service.spaceId, service.id),
    fields: fieldViews(service.fields),
    links: linkCount(service.id),
  );

  /// Saves a code's own members: its name, websites (unless a linked item lends them: those are changed there), note and pin, its
  /// custom fields and its links, and never its secret. A member the input leaves out is kept.
  Future<Map<String, Object?>> saveCode(String id, Map<String, Object?> input) async {
    requireSession();
    final current = _account(id);
    editGuard?.call(current.spaceId, id);
    final lent = lentWebsites(_lists, current, account: accountOwner?.call()) != null;
    // The edit is made on the code the write holds, so what a run wrote meanwhile (an HOTP counter) is not put back
    OtpAccount edit(OtpAccount held) {
      var next = held;
      if (input.containsKey('name')) next = next.copyWith(name: _textOf(input['name'], 'the name') ?? unset);
      if (input.containsKey('note')) next = next.copyWith(note: _textOf(input['note'], 'the note', max: noteTextLimit) ?? unset);
      if (input['pinned'] is bool) next = next.copyWith(pinned: input['pinned'] == true ? true : unset);
      if (input.containsKey('websites') && !lent) {
        final hosts = readHosts(input['websites']);
        next = next.copyWith(websites: hosts.isEmpty ? unset : hosts);
      }
      final fields = applyFields(next.fields, input['fields']);
      return identical(fields, next.fields) ? next : next.copyWith(fields: fields);
    }

    edit(current);
    final refs = input.containsKey('links') ? parseRefs(input['links']) : null;
    await _saveAccounts((held) => [for (final account in held) account.id == id ? edit(account) : account]);
    final failures = refs == null ? const <String>[] : await setLinksOf('otp', id, refs);
    final index = _lists.accounts.indexWhere((account) => account.id == id);
    return {..._codeView(_lists.accounts[index], index), if (failures.isNotEmpty) 'linkFailures': failures};
  }

  /// Saves backup codes' own members: name, websites, note, custom fields and links; the codes themselves never change here.
  Future<Map<String, Object?>> saveBackupCodes(String serviceId, Map<String, Object?> input) async {
    requireSession();
    final current = _lists.backupServices.where((service) => service.id == serviceId).firstOrNull;
    if (current == null) throw const CoreFailure(CoreFailure.notFound, 'no such service');
    editGuard?.call(current.spaceId, serviceId);
    // The edit is made on the service the write holds, so a code used meanwhile stays used
    BackupService edit(BackupService held) {
      var next = held;
      if (input.containsKey('name')) next = next.copyWith(name: _textOf(input['name'], 'the name') ?? unset);
      if (input.containsKey('note')) next = next.copyWith(note: _textOf(input['note'], 'the note', max: noteTextLimit) ?? unset);
      if (input.containsKey('websites')) {
        final hosts = readHosts(input['websites']);
        next = next.copyWith(websites: hosts.isEmpty ? unset : hosts);
      }
      final fields = applyFields(next.fields, input['fields']);
      return identical(fields, next.fields) ? next : next.copyWith(fields: fields);
    }

    edit(current);
    final refs = input.containsKey('links') ? parseRefs(input['links']) : null;
    await _saveServices((held) => [for (final service in held) service.id == serviceId ? edit(service) : service]);
    final failures = refs == null ? const <String>[] : await setLinksOf('backup-codes', serviceId, refs);
    final stored = _lists.backupServices.firstWhere((service) => service.id == serviceId);
    return {...backupViewOf(stored), if (failures.isNotEmpty) 'linkFailures': failures};
  }
}

/// The most items a search for one to link gives back.
const linkCandidatesMax = 50;
