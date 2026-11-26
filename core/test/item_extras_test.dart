// What every item shares beyond its own members, as the pages see it (item_extras.dart): custom fields in a view and from an input,
// websites with a rule each, and the count of an item's links. An entry nobody edited is written back exactly as it was read.
import 'dart:convert';

import 'package:kemlock_core/features/sync/sync_merge.dart' show Lists;
import 'package:kemlock_core/models/custom_field.dart';
import 'package:kemlock_core/models/item_link.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/website_rule.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/item_extras.dart';
import 'package:test/test.dart';

Matcher invalid() => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', CoreFailure.invalid));

List<CustomField> read(List<Object?> json) => readFields(json);

String text(Object? json) => jsonEncode(json);

void main() {
  group('a field view', () {
    final fields = read([
      {'name': 'Employee ID', 'value': 'E-42', 'kind': 'text', 'adminField': 'a1'},
      {'name': 'PIN', 'value': '9876', 'kind': 'hidden'},
      {'name': 'Verified', 'value': 'true', 'kind': 'boolean'},
      {'name': 'Linked', 'value': '101', 'kind': 'linked'},
      {'name': '', 'value': 'no name', 'kind': 'text'},
    ]);

    test('shows a text value and a checkbox, never a hidden one, and says what can be edited', () {
      final views = fieldViews(fields);
      expect(views.map((v) => v['index']), [0, 1, 2, 3], reason: 'a field with no name is kept and not shown');
      expect(views[0], {
        'index': 0,
        'name': 'Employee ID',
        'kind': 'text',
        'value': 'E-42',
        'hasValue': true,
        'adminField': 'a1',
        'editable': true,
      });
      expect(views[1].containsKey('value'), isFalse);
      expect(views[1]['hasValue'], isTrue);
      expect(views[2], containsPair('value', 'true'));
      expect(views[3], containsPair('editable', false));
      expect(views[3].containsKey('value'), isFalse);
      expect(text(views), isNot(contains('9876')));
    });

    test('is revealed one value at a time, and only for a field a person can edit', () {
      expect(fieldValueAt(fields, 1), '9876');
      expect(() => fieldValueAt(fields, 3), throwsA(isA<CoreFailure>()));
      expect(() => fieldValueAt(fields, 4), throwsA(isA<CoreFailure>()));
      expect(() => fieldValueAt(fields, 9), throwsA(isA<CoreFailure>()));
    });
  });

  group('field input', () {
    final original = <Object?>[
      {'name': 'Code', 'value': '1', 'kind': 'text', 'future': 'kept', 'adminField': 'a1'},
      {'name': 'Secret', 'value': 'abc', 'kind': 'hidden'},
      {'name': 'Linked', 'value': '101', 'kind': 'linked'},
      {'name': 'Done', 'value': true, 'type': 2},
    ];

    test('absent keeps the list itself', () {
      final fields = read(original);
      expect(identical(applyFields(fields, null), fields), isTrue);
    });

    test('rows that change nothing give the same list, and every entry writes back as it was', () {
      final fields = read(original);
      final same = applyFields(fields, [
        {'origin': 0, 'name': 'Code', 'kind': 'text', 'value': '1', 'adminField': 'a1'},
        {'origin': 1, 'name': 'Secret', 'kind': 'hidden', 'keepValue': true},
        {'origin': 3, 'name': 'Done', 'kind': 'boolean', 'value': 'true'},
      ]);
      expect(identical(same, fields), isTrue);
      expect(text(writeFields(same)), text(original));
    });

    test('an edit changes only the member edited, and the entry keeps its other keys and place', () {
      final next = applyFields(read(original), [
        {'origin': 0, 'name': 'Code', 'kind': 'text', 'value': '2', 'adminField': 'a1'},
        {'origin': 1, 'name': 'Secret', 'kind': 'hidden', 'keepValue': true},
        {'origin': 3, 'name': 'Done', 'kind': 'boolean', 'value': 'false'},
      ]);
      final json = writeFields(next)!;
      expect(json[0], {'name': 'Code', 'value': '2', 'kind': 'text', 'future': 'kept', 'adminField': 'a1'});
      expect(json[1], original[1]);
      expect(json[2], original[2], reason: 'a linked entry stays where it was');
      // A checkbox the importer wrote as a boolean stays one, and its type key stays
      expect(json[3], {'name': 'Done', 'value': false, 'type': 2});
    });

    test('a hidden value that is not kept is the one typed', () {
      final next = applyFields(read(original), [
        {'origin': 0, 'name': 'Code', 'kind': 'text', 'value': '1', 'adminField': 'a1'},
        {'origin': 1, 'name': 'Secret', 'kind': 'hidden', 'value': 'new'},
        {'origin': 3, 'name': 'Done', 'kind': 'boolean', 'value': 'true'},
      ]);
      expect(next[1].value, 'new');
    });

    test('a row left out is removed, a blank name too, a linked entry never, and new rows come after', () {
      final next = applyFields(read(original), [
        {'origin': 1, 'name': '  ', 'kind': 'hidden', 'value': 'x'},
        {'name': ' Site ', 'kind': 'text', 'value': 'here'},
        {'name': '', 'kind': 'text', 'value': 'nameless'},
        {'name': 'Cost centre', 'kind': 'hidden', 'keepValue': true, 'adminField': 'a2'},
      ]);
      expect(next.map((f) => f.name), ['Linked', 'Site', 'Cost centre']);
      expect(next[1].value, 'here');
      expect(next[2].adminField, 'a2');
      expect(next[2].value, '', reason: 'a new hidden field holds nothing the page could have kept');
    });

    test('a name or value over the limit that the field holds already is written back, a new one is refused', () {
      final fields = [CustomField(name: 'n' * 300, value: 'v' * 20000, kind: CustomFieldKind.text)];
      final same = applyFields(fields, [
        {'origin': 0, 'name': 'n' * 300, 'kind': 'text', 'value': 'v' * 20000},
      ]);
      expect(identical(same, fields), isTrue);
      expect(
        () => applyFields(fields, [
          {'origin': 0, 'name': 'n' * 300, 'kind': 'text', 'value': 'w' * 20000},
        ]),
        invalid(),
      );
      final many = [for (var i = 0; i < 120; i++) CustomField(name: 'f$i', value: '', kind: CustomFieldKind.text)];
      final back = applyFields(many, [
        for (var i = 0; i < 120; i++) {'origin': i, 'name': 'f$i', 'kind': 'text', 'value': ''},
      ]);
      expect(identical(back, many), isTrue, reason: 'a list over the limit is sent back whole');
    });

    test('refuses what is not a field', () {
      final fields = read(original);
      expect(() => applyFields(fields, 'x'), invalid());
      expect(() => applyFields(fields, ['x']), invalid());
      expect(
        () => applyFields(fields, [
          {'name': 'a', 'kind': 'secret', 'value': ''},
        ]),
        invalid(),
      );
      expect(
        () => applyFields(fields, [
          {'name': 'a' * 201, 'kind': 'text', 'value': ''},
        ]),
        invalid(),
      );
      expect(
        () => applyFields(fields, [
          {'name': 'a', 'kind': 'text', 'value': 'v' * 10001},
        ]),
        invalid(),
      );
      expect(
        () => applyFields(fields, [
          for (var i = 0; i < 101; i++) {'name': 'f$i', 'kind': 'text', 'value': ''},
        ]),
        invalid(),
      );
    });
  });

  group('website rules', () {
    const current = [
      WebsiteRule('example.co'),
      WebsiteRule('https://app.example.co/', match: WebsiteMatch.startsWith, extra: {'uriChecksum': 'abc'}),
      WebsiteRule('wiki.example.co', match: WebsiteMatch.never),
    ];

    test('are shown by the word of their rule, and a number a later version made as the default', () {
      expect(ruleViews([...current, const WebsiteRule('x.example', match: 9)]), [
        {'uri': 'example.co', 'match': 'default'},
        {'uri': 'https://app.example.co/', 'match': 'startsWith'},
        {'uri': 'wiki.example.co', 'match': 'never'},
        {'uri': 'x.example', 'match': 'default'},
      ]);
    });

    test('as shown come back as they are', () {
      final rules = readRules(ruleViews(current), current);
      expect(sameRules(rules, current), isTrue);
      expect(identical(rules[1], current[1]), isTrue);
    });

    test('a changed rule keeps what the website held beyond its number', () {
      final rules = readRules([
        {'uri': 'example.co', 'match': 'default'},
        {'uri': 'https://app.example.co/', 'match': 'exact'},
      ], current);
      expect(rules[1].match, WebsiteMatch.exact);
      expect(rules[1].extra, {'uriChecksum': 'abc'});
      expect(rules, hasLength(2));
    });

    test('a new website is a host on its rule, a blank row is dropped, and a regular expression stays a pattern', () {
      final rules = readRules([
        {'uri': ' https://www.Shop.example.co/cart ', 'match': 'domain'},
        {'uri': '', 'match': 'host'},
        {'uri': r'^https://.*\.example\.co/admin$', 'match': 'regex'},
        {'uri': 'androidapp://com.example', 'match': 'default'},
      ], const []);
      expect(rules.map((r) => r.uri), ['shop.example.co', r'^https://.*\.example\.co/admin$', 'androidapp://com.example']);
      expect(rules.map((r) => r.match), [WebsiteMatch.baseDomain, WebsiteMatch.regularExpression, null]);
    });

    test('refuse a scheme that is not the web or an app, a pattern that does not compile, an unknown rule and too many', () {
      expect(
        () => readRules([
          {'uri': 'javascript:alert(1)', 'match': 'default'},
        ], const []),
        invalid(),
      );
      expect(
        () => readRules([
          {'uri': 'javascript:alert(1)', 'match': 'startsWith'},
        ], const []),
        invalid(),
      );
      expect(
        () => readRules([
          {'uri': 'ftp://example.co', 'match': 'exact'},
        ], const []),
        invalid(),
      );
      expect(
        () => readRules([
          {'uri': '(', 'match': 'regex'},
        ], const []),
        invalid(),
      );
      expect(
        () => readRules([
          {'uri': 'example.co', 'match': 'sometimes'},
        ], const []),
        invalid(),
      );
      expect(
        () => readRules([
          for (var i = 0; i < 51; i++) {'uri': 'a$i.example.co'},
        ], const []),
        invalid(),
      );
      expect(() => readRules('example.co', const []), invalid());
    });

    test('check the scheme before the host and port shortcut, which only a host with a dot or localhost may use', () {
      for (final uri in ['javascript:1/alert(1)', 'data:1', 'file:80', 'vbscript:1/x', 'JavaScript:8080', 'intranet:8080']) {
        for (final match in ['default', 'domain', 'host', 'startsWith', 'exact', 'never']) {
          expect(() => readRules([{'uri': uri, 'match': match}], const []), invalid(), reason: '$uri on $match');
        }
      }
      final rules = readRules([
        {'uri': 'localhost:8080', 'match': 'exact'},
        {'uri': 'example.co:8443/admin', 'match': 'startsWith'},
        {'uri': 'iosapp://com.example.app', 'match': 'default'},
        {'uri': 'androidapp://com.example', 'match': 'never'},
      ], const []);
      expect(rules.map((r) => r.uri), ['localhost:8080', 'example.co:8443/admin', 'iosapp://com.example.app', 'androidapp://com.example']);
    });

    test('keep a website the item holds as it is whatever its length or scheme, and refuse a new one over the limit', () {
      final held = [
        WebsiteRule('x' * 2500),
        for (var i = 0; i < 60; i++) WebsiteRule('h$i.example.co'),
      ];
      final same = readRules(ruleViews(held), held);
      expect(same.map((r) => r.uri), held.map((r) => r.uri));
      expect(
        () => readRules([...ruleViews(held), {'uri': 'new.example.co', 'match': 'default'}], held),
        invalid(),
      );
    });

    test('hosts typed for a code are normalised, once each, and not hosts are left out', () {
      expect(readHosts(['https://www.Example.co/x', 'example.co', 'not a host', 'github.com']), ['example.co', 'github.com']);
    });
  });

  group('links', () {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const c = '33333333-3333-4333-8333-333333333333';

    test('are counted from both ends, each pair once, a login and its code too', () {
      final lists = Lists(
        logins: [
          Login(id: a, name: 'A', accountId: c, links: const [ItemLink(b)], addedAt: 1),
          const Login(id: b, name: 'B', addedAt: 1),
        ],
        accounts: [const OtpAccount(id: c, issuer: 'A', label: 'x', secret: 'JBSWY3DPEHPK3PXP', addedAt: 1)],
      );
      final counts = linkCountsOf(lists);
      expect(counts[a], 2);
      expect(counts[b], 1, reason: 'named by A only: the link shows on both ends');
      expect(counts[c], 1);
    });

    test('to an item the vault does not hold are kept and not counted', () {
      final lists = Lists(
        logins: [
          Login(id: a, name: 'A', links: const [ItemLink(b)], addedAt: 1),
        ],
      );
      expect(linkCountsOf(lists), isEmpty);
    });

    test('are read from an input, which names the kind and the entry id of each', () {
      expect(
        parseRefs([
          {'kind': 'login', 'id': a},
        ]),
        [(kind: 'login', id: a)],
      );
      expect(
        () => parseRefs([
          {'kind': 'login'},
        ]),
        invalid(),
      );
      expect(() => parseRefs('a'), invalid());
      expect(
        () => parseRefs([
          for (var i = 0; i < linkRefsReadMax + 1; i++) {'kind': 'login', 'id': '$i'},
        ]),
        invalid(),
      );
      expect(
        parseRefs([
          for (var i = 0; i < linkRefsMax + 1; i++) {'kind': 'login', 'id': '$i'},
        ]),
        hasLength(linkRefsMax + 1),
        reason: 'what an item holds may be sent back; setLinksOf checks the limit against it',
      );
    });
  });
}
