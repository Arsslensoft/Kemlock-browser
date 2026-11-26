// What every item shares beyond its own members: custom fields, links to other items, and the websites of a login or code with a rule
// each (docs/plans/add-item-format.md, crypto.md "Item bodies"). Pure functions over Kemlock-core's models: no secret leaves here (a
// hidden field's value is never in a view), and a change is made on the entries the item holds, so whatever the browser didn't edit is
// written back as it was (a field nobody edited, a link or an entry it can't read, the keys of a later version).
import 'dart:convert';

import 'package:kemlock_core/core/websites.dart';
import 'package:kemlock_core/crypto/account/encoding.dart' show Owner;
import 'package:kemlock_core/features/sync/kemlock/km_kinds.dart' show itemKindOf;
import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/backup_service.dart';
import 'package:kemlock_core/models/contact.dart';
import 'package:kemlock_core/models/custom_field.dart';
import 'package:kemlock_core/models/identity.dart';
import 'package:kemlock_core/models/item_link.dart';
import 'package:kemlock_core/models/json.dart';
import 'package:kemlock_core/models/key_account.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_core/models/payment_card.dart';
import 'package:kemlock_core/models/secure_note.dart';
import 'package:kemlock_core/models/vault_entry.dart';
import 'package:kemlock_core/models/vault_file.dart';
import 'package:kemlock_core/models/vault_key.dart';
import 'package:kemlock_core/models/website_rule.dart';
import 'package:kemlock_core/vault/item_links.dart';

import 'failure.dart';

/// The most custom fields an item holds through one call, the longest name and the longest value.
const fieldRowsMax = 100;
const fieldNameMax = 200;
const fieldValueMax = 10000;

/// The most items one call links, websites it gives, and the longest website; and the longest line of a contact's details.
const linkRefsMax = 100;
const websiteRulesMax = 50;
const websiteUriMax = 2000;
const contactDetailLimit = 2048;

CoreFailure _invalid(String what) => CoreFailure(CoreFailure.invalid, what);

bool _sameJson(Object? a, Object? b) => jsonEncode(a) == jsonEncode(b);

// ─── Custom fields ──────────────────────────────────────────────────────────────────────────────

/// The word a field's kind is shown as: `text`, `hidden`, `boolean`, `linked` (kept, never edited), or `other`.
String fieldKindName(String kind) => switch (kind) {
  CustomFieldKind.text => 'text',
  CustomFieldKind.hidden => 'hidden',
  CustomFieldKind.boolean => 'boolean',
  CustomFieldKind.linked => 'linked',
  _ => 'other',
};

/// [fields] as `FieldView`s: a field with a name, its place in the item's list (which is what `revealField` and an input's `origin`
/// name), and its value unless it is hidden. A field with no name is kept and not shown; a linked one or one of another kind is shown
/// without its value, and cannot be edited.
List<Map<String, Object?>> fieldViews(List<CustomField> fields) => [
  for (final (index, field) in fields.indexed)
    if (field.name.trim().isNotEmpty) _fieldView(index, field),
];

Map<String, Object?> _fieldView(int index, CustomField field) {
  final kind = fieldKindName(field.kind);
  return {
    'index': index,
    'name': field.name,
    'kind': kind,
    if (kind == 'text' || kind == 'boolean') 'value': field.value,
    'hasValue': kind == 'boolean' || field.value.isNotEmpty,
    'adminField': ?field.adminField,
    'editable': field.isEditable,
  };
}

/// The value of the field at [index] of [fields], which must be one a person can edit (text, hidden or a checkbox, with a name).
String fieldValueAt(List<CustomField> fields, int index) {
  if (index < 0 || index >= fields.length || !fields[index].isEditable) throw const CoreFailure(CoreFailure.notFound, 'no such field');
  return fields[index].value;
}

String _fieldBodyKind(String name) => switch (name) {
  'text' => CustomFieldKind.text,
  'hidden' => CustomFieldKind.hidden,
  'boolean' || 'checkbox' => CustomFieldKind.boolean,
  _ => throw _invalid('a field is text, hidden or a checkbox'),
};

/// [current] with the rows of [input] (`FieldInput`s) applied. No input keeps [current] (the same list). A row names the field it
/// edits by `origin`, its place in [current]; a row with no usable origin adds a field, after the others; a field no row names is
/// removed, and so is a row with no name. A hidden row with `keepValue` keeps the value the field has (the page never held it). An
/// entry that can't be edited (linked, of another kind, nameless) stays where it was, whatever the rows say. A field nobody changed
/// is written back as it was, and so is the list when nothing changed (the same list again).
List<CustomField> applyFields(List<CustomField> current, Object? input) {
  if (input == null) return current;
  if (input is! List<Object?>) throw _invalid('the fields are not a list');
  if (input.length > fieldRowsMax) throw _invalid('too many fields');
  final byOrigin = <int, Map<String, Object?>>{};
  final added = <Map<String, Object?>>[];
  for (final row in input) {
    if (row is! Map<String, Object?>) throw _invalid('a field is not an object');
    final origin = asInt(row['origin']);
    if (origin != null && origin >= 0 && origin < current.length && current[origin].isEditable && !byOrigin.containsKey(origin)) {
      byOrigin[origin] = row;
    } else {
      added.add(row);
    }
  }
  ({String name, String kind, String value, bool keepValue, String? admin}) read(Map<String, Object?> row) {
    final name = row['name'];
    final value = row['value'];
    final admin = row['adminField'];
    if (name is! String || name.length > fieldNameMax) throw _invalid('a field name is too long');
    if (value != null && value is! String && value is! bool) throw _invalid('a field value is not text');
    final text = value is bool ? '$value' : (value as String?) ?? '';
    if (text.length > fieldValueMax) throw _invalid('a field value is too long');
    if (admin != null && (admin is! String || admin.length > 100)) throw _invalid('a field definition is not an id');
    final kind = _fieldBodyKind(asString(row['kind'], 'text'));
    return (
      name: name,
      kind: kind,
      value: kind == CustomFieldKind.boolean ? (text == 'true' ? 'true' : 'false') : text,
      keepValue: row['keepValue'] == true,
      admin: admin is String && admin.isNotEmpty ? admin : null,
    );
  }

  final out = <CustomField>[];
  for (final (index, field) in current.indexed) {
    if (!field.isEditable) {
      out.add(field);
      continue;
    }
    final row = byOrigin[index];
    if (row == null) continue;
    final next = read(row);
    if (next.name.trim().isEmpty) continue;
    // A hidden value the page never held is the field's own, unless the row is changed to another kind
    final keepsValue = next.keepValue && next.kind == CustomFieldKind.hidden && field.kind == CustomFieldKind.hidden;
    out.add(
      field.copyWith(
        name: next.name,
        value: keepsValue ? field.value : next.value,
        kind: next.kind,
        adminField: next.admin ?? field.adminField,
      ),
    );
  }
  for (final row in added) {
    final next = read(row);
    if (next.name.trim().isEmpty) continue;
    out.add(CustomField(name: next.name.trim(), value: next.keepValue ? '' : next.value, kind: next.kind, adminField: next.admin));
  }
  return _sameJson([for (final field in out) field.toJson()], [for (final field in current) field.toJson()]) ? current : out;
}

// ─── Websites with a rule each ──────────────────────────────────────────────────────────────────

const _ruleNames = ['domain', 'host', 'startsWith', 'exact', 'regex', 'never'];

/// The word of Bitwarden's rule number [match]: `default` for none (and for a number a later version made).
String ruleName(int? match) => match == null || match < 0 || match >= _ruleNames.length ? 'default' : _ruleNames[match];

int? _ruleNumber(String name) {
  if (name == 'default') return null;
  final at = _ruleNames.indexOf(name);
  if (at < 0) throw _invalid('a website rule is not one of ours');
  return at;
}

/// [rules] as `WebsiteRuleView`s.
List<Map<String, Object?>> ruleViews(Iterable<WebsiteRule> rules) => [
  for (final rule in rules) {'uri': rule.uri, 'match': ruleName(rule.match)},
];

final _scheme = RegExp(r'^([a-z][a-z0-9+.-]*):', caseSensitive: false);
final _hostPort = RegExp(r'^[a-z0-9.-]+:\d{1,5}(?:[/?#].*)?$', caseSensitive: false);
const _schemes = {'http', 'https', 'androidapp', 'iosapp'};

/// What a website the person typed may be, as the web vault's form holds it: a host, a web address or an app's package name. Any other
/// scheme (`javascript:`) is refused.
void _checkWebsite(String text) {
  if (_hostPort.hasMatch(text)) return;
  final scheme = _scheme.firstMatch(text)?.group(1)?.toLowerCase();
  if (scheme == null) {
    if (RegExp(r'\s').hasMatch(text)) throw _invalid('a website holds a space');
    return;
  }
  if (!_schemes.contains(scheme)) throw _invalid('a website is a web address');
  if (scheme == 'http' || scheme == 'https') {
    final host = Uri.tryParse(text)?.host ?? '';
    if (host.isEmpty) throw _invalid('a website has no host');
  }
}

/// What a website's text is kept as for its rule: a host for the default, base domain, host and never rules (an app's package name
/// stays as typed), the address for starts-with and exact, the pattern for a regular expression, which must compile.
String _ruleUri(String text, String name) {
  if (name == 'regex') {
    try {
      RegExp(text);
    } on FormatException {
      throw _invalid('a regular expression does not compile');
    }
    return text;
  }
  _checkWebsite(text);
  if (name == 'startsWith' || name == 'exact') return text;
  final scheme = _scheme.firstMatch(text)?.group(1)?.toLowerCase();
  if (scheme == 'androidapp' || scheme == 'iosapp') return text;
  return normaliseWebsite(text) ?? (throw _invalid('a website is not a host'));
}

/// The websites of [input] (`WebsiteRuleView`s) as rules, built on those [current] holds: a row that names a website and rule the item
/// has is that rule as it is, and one that only changes a rule's match keeps what else the rule held (Bitwarden's checksum). A blank row
/// is left out. Refuses a scheme that isn't a web or app one, an expression that doesn't compile, and more than 50 websites.
List<WebsiteRule> readRules(Object? input, List<WebsiteRule> current) {
  if (input is! List<Object?>) throw _invalid('the websites are not a list');
  if (input.length > websiteRulesMax) throw _invalid('too many websites');
  final rules = <WebsiteRule>[];
  final used = <int>{};
  for (final row in input) {
    if (row is! Map<String, Object?>) throw _invalid('a website is not an object');
    final text = asString(row['uri']).trim();
    if (text.isEmpty) continue;
    if (text.length > websiteUriMax) throw _invalid('a website is too long');
    final name = asString(row['match'], 'default');
    final number = _ruleNumber(name);
    final same = [
      for (final (i, rule) in current.indexed)
        if (!used.contains(i) && rule.uri == text && ruleName(rule.match) == name) i,
    ];
    if (same.isNotEmpty) {
      used.add(same.first);
      rules.add(current[same.first]);
      continue;
    }
    final uri = _ruleUri(text, name);
    final alike = [
      for (final (i, rule) in current.indexed)
        if (!used.contains(i) && rule.uri == uri) i,
    ];
    if (alike.isNotEmpty) {
      used.add(alike.first);
      rules.add(current[alike.first].withMatch(number, uri: uri));
    } else {
      rules.add(WebsiteRule(uri, match: number));
    }
  }
  return rules;
}

/// Whether [rules] are the websites [current] holds, entry for entry.
bool sameRules(List<WebsiteRule> rules, List<WebsiteRule> current) =>
    _sameJson([for (final rule in rules) rule.toJson()], [for (final rule in current) rule.toJson()]);

/// The hosts [input], a list of websites typed for a code or backup codes, names: each as `normaliseWebsite` keeps it, once; one that
/// isn't a host is left out.
List<String> readHosts(Object? input) {
  if (input is! List<Object?>) throw _invalid('the websites are not a list');
  if (input.length > websiteRulesMax) throw _invalid('too many websites');
  final hosts = <String>[];
  for (final site in input) {
    if (site is! String) throw _invalid('a website is not text');
    if (site.length > websiteUriMax) throw _invalid('a website is too long');
    final host = normaliseWebsite(site);
    if (host != null && !hosts.contains(host)) hosts.add(host);
  }
  return hosts;
}

// ─── Links ──────────────────────────────────────────────────────────────────────────────────────

/// A reference to an item as the pages hold it: its kind (`ItemKind`) and its entry id, never the server's item id.
typedef ItemRef = ({String kind, String id});

/// The `ItemRef`s of [raw]; none for a call that has no links.
List<ItemRef> parseRefs(Object? raw) {
  if (raw is! List<Object?>) throw _invalid('the links are not a list');
  if (raw.length > linkRefsMax) throw _invalid('too many links');
  return [for (final item in raw) parseRef(item)];
}

/// The `ItemRef` of [raw].
ItemRef parseRef(Object? raw) {
  if (raw is! Map<String, Object?>) throw _invalid('an item is not an object');
  final kind = raw['kind'];
  final id = raw['id'];
  if (kind is! String || kind.isEmpty || kind.length > 40 || id is! String || id.isEmpty || id.length > 100) {
    throw _invalid('an item needs its kind and id');
  }
  return (kind: kind, id: id);
}

/// [entry] as the `ItemRef` the pages hold it by.
Map<String, Object?> refOf(VaultEntry<dynamic> entry) => {'kind': itemKindOf(entry), 'id': entry.id};

/// The entry of [lists] with this [kind] and [id], or null.
VaultEntry<dynamic>? findEntry(Lists lists, String kind, String id) {
  for (final entry in entriesOf(lists)) {
    if (entry.id == id && itemKindOf(entry) == kind) return entry;
  }
  return null;
}

/// What [entry] is called, as a list of items shows it.
String entryNameOf(VaultEntry<dynamic> entry) => switch (entry) {
  final Login login => login.name,
  final OtpAccount code => _firstText([code.name, code.issuer, code.label]),
  final BackupService service => _firstText([service.name, service.serviceName]),
  final SecureNote note => note.title,
  final PaymentCard card => card.name,
  final Identity identity => identity.name,
  final Contact contact => contact.name,
  final VaultKey key => key.name,
  final VaultFile file => file.name,
  final Passkey passkey => passkey.displayName,
  final KeyAccount account => account.displayName,
  _ => '',
};

String _firstText(List<String?> texts) {
  for (final text in texts) {
    if (text != null && text.trim().isNotEmpty) return text;
  }
  return '';
}

/// The line under [entry]'s name, when it has one.
String? entryDetailOf(VaultEntry<dynamic> entry) {
  final String? text = switch (entry) {
    final Login login => login.username,
    final OtpAccount code => code.label,
    final PaymentCard card => card.lastFour,
    final Identity identity => identity.email,
    final Contact contact => contact.email ?? contact.company,
    final VaultFile file => file.file.name,
    _ => null,
  };
  return text == null || text.trim().isEmpty ? null : text;
}

/// The text a search for an item to link looks in.
String entrySearchText(VaultEntry<dynamic> entry) {
  final parts = <String?>[entryNameOf(entry), entryDetailOf(entry)];
  switch (entry) {
    case final Login login:
      parts.addAll([...?login.websites, for (final rule in login.rules) rule.uri]);
    case final OtpAccount code:
      parts.addAll([code.issuer, code.label, ...?code.websites]);
    case final BackupService service:
      parts.addAll([service.serviceName, ...?service.websites]);
    case final Contact contact:
      parts.addAll([contact.company, contact.email, contact.phone]);
    case final PaymentCard card:
      parts.add(card.cardholder);
    case final Identity identity:
      parts.addAll([identity.email, identity.company, identity.username]);
    default:
  }
  return [
    for (final part in parts)
      if (part != null && part.isNotEmpty) part,
  ].join('\n').toLowerCase();
}

/// [lists] with [entry] put in place of the entry of its kind with its id.
Lists listsWithEntry(Lists lists, VaultEntry<dynamic> entry) {
  List<T> put<T extends VaultEntry<T>>(List<T> list, T item) => [for (final held in list) held.id == item.id ? item : held];
  return Lists(
    accounts: entry is OtpAccount ? put(lists.accounts, entry) : lists.accounts,
    backupServices: entry is BackupService ? put(lists.backupServices, entry) : lists.backupServices,
    keys: entry is VaultKey ? put(lists.keys, entry) : lists.keys,
    notes: entry is SecureNote ? put(lists.notes, entry) : lists.notes,
    passkeys: entry is Passkey ? put(lists.passkeys, entry) : lists.passkeys,
    keyAccounts: entry is KeyAccount ? put(lists.keyAccounts, entry) : lists.keyAccounts,
    contacts: entry is Contact ? put(lists.contacts, entry) : lists.contacts,
    logins: entry is Login ? put(lists.logins, entry) : lists.logins,
    cards: entry is PaymentCard ? put(lists.cards, entry) : lists.cards,
    identities: entry is Identity ? put(lists.identities, entry) : lists.identities,
    files: entry is VaultFile ? put(lists.files, entry) : lists.files,
  );
}

/// How many items each entry of [lists] is linked to, from both ends, by entry id: the figure of every view's `links`. Counts the
/// items the vault holds, each pair once, whichever end names it (a link, a code's `linkedLoginId`, a login's code); a link to an item
/// that isn't there is kept but not counted. The same pairs `linkedItemsOf` finds, worked out for every entry in one pass.
Map<String, int> linkCountsOf(Lists lists, {Owner? account}) {
  final entries = entriesOf(lists);
  final byName = <String, int>{};
  for (final (i, entry) in entries.indexed) {
    for (final name in {linkIdOf(entry, account: account).toLowerCase(), entry.id.toLowerCase()}) {
      byName.putIfAbsent(name, () => i);
    }
  }
  final pairs = <(int, int)>{};
  void tie(int a, int? b) {
    if (b == null || a == b) return;
    pairs.add(a < b ? (a, b) : (b, a));
  }

  for (final (i, entry) in entries.indexed) {
    for (final link in entry.links.readable) {
      tie(i, byName[link.key]);
    }
    if (entry is OtpAccount && entry.linkedLoginId != null) tie(i, byName[entry.linkedLoginId!.toLowerCase()]);
    if (entry is Login && entry.accountId != null) {
      final code = byName[entry.accountId!.toLowerCase()];
      if (code != null && entries[code] is OtpAccount) tie(i, code);
    }
  }
  final counts = <String, int>{};
  for (final (a, b) in pairs) {
    counts[entries[a].id] = (counts[entries[a].id] ?? 0) + 1;
    counts[entries[b].id] = (counts[entries[b].id] ?? 0) + 1;
  }
  return counts;
}

/// The websites an entry holds, with their rules; none for a kind with no websites.
List<WebsiteRule> rulesOf(VaultEntry<dynamic> entry) => switch (entry) {
  final Login login => login.rules,
  final OtpAccount code => code.rules,
  final BackupService service => service.rules,
  _ => const [],
};

/// The hosts of [rules], each once, in order: those a rule fills on.
List<String> hostsOf(Iterable<WebsiteRule> rules) => <String>{for (final rule in rules) ?rule.host}.toList();

/// What the items [entry] is linked to lend it as websites: the hosts of those that have some, each once, and who they are from, in
/// the order of their ids; null when none has a website. A code shows these instead of its own.
({List<String> hosts, List<Map<String, Object?>> from})? lentWebsites(Lists lists, VaultEntry<dynamic> entry, {Owner? account}) {
  final hosts = <String>{};
  final from = <Map<String, Object?>>[];
  for (final linked in linkedItemsOf(lists, entry, account: account)) {
    final other = linked.entry;
    if (other == null) continue;
    final own = hostsOf(rulesOf(other));
    if (own.isEmpty) continue;
    hosts.addAll(own);
    from.add(refOf(other));
  }
  return from.isEmpty ? null : (hosts: hosts.toList(), from: from);
}

/// [lists] with [files] as the File items.
Lists listsWithFiles(Lists lists, List<VaultFile> files) => Lists(
  accounts: lists.accounts,
  backupServices: lists.backupServices,
  keys: lists.keys,
  notes: lists.notes,
  passkeys: lists.passkeys,
  keyAccounts: lists.keyAccounts,
  contacts: lists.contacts,
  logins: lists.logins,
  cards: lists.cards,
  identities: lists.identities,
  files: files,
);
