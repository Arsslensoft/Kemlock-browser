// The app's cases for the websites' match rules (`test/fixtures/websites/rules.json`, the app's, copied here and never edited; the
// app's test/core/website_rules_test.dart reads the same file), run through Kemlock-core's `fillsOn` and `phoneDomains` and through
// the extension's matcher, which decides what a page is offered with them (add-browser-extension, design decision 8 and task 7.6).
import 'dart:convert';
import 'dart:io';

import 'package:kemlock_core/core/website_rules.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/website_rule.dart';
import 'package:kemlock_extension_core/src/matching.dart';
import 'package:test/test.dart';

typedef _Json = Map<String, Object?>;

final _fixture = jsonDecode(File('../test/fixtures/websites/rules.json').readAsStringSync()) as _Json;
final _registrable = (_fixture['registrable']! as _Json).cast<String, String>();
final _cases = [for (final c in _fixture['cases']! as List<Object?>) c! as _Json];

String _registrableOf(String host) => _registrable[host] ?? host;

WebsiteRule _ruleOf(_Json c) => WebsiteRule(c['uri']! as String, match: c['match'] as int?);

String _addressOf(_Json c) {
  final fill = c['addressFill'];
  if (fill is _Json) return (fill['repeat']! as String) * (fill['times']! as int) + (fill['then']! as String);
  return c['address']! as String;
}

/// The extension's matcher, with the Public Suffix List the fixture says for the hosts it names.
class _FixtureMatcher extends SiteMatcher {
  @override
  String registrable(String host) => _registrableOf(host);
}

void main() {
  final matcher = _FixtureMatcher();

  test('the fixture holds the app\'s cases', () {
    expect(_cases, isNotEmpty);
    expect(_registrable, isNotEmpty);
  });

  group('rules.json, through fillsOn', () {
    for (final c in _cases) {
      test('fills: ${c['name']}', () {
        expect(fillsOn(_ruleOf(c), _addressOf(c), registrable: _registrableOf, isShared: isSharedHost), c['fills']);
      });
    }
  });

  group('rules.json, through the matcher a page is offered items by', () {
    for (final c in _cases) {
      final page = Page.parse(_addressOf(c));
      // An address with no web scheme or host is no page: nothing is offered on it
      test('a login is offered: ${c['name']}', () {
        final login = Login(id: 'l', name: 'l', username: 'sam', password: 'x', uris: [_ruleOf(c)], addedAt: 1);
        expect(page != null && matcher.loginMatches(login, page), page == null ? isFalse : c['fills']);
      });
    }

    test('a login keeps each of its websites\' own rules, and matches on any of them', () {
      final login = Login(
        id: 'l',
        name: 'l',
        username: 'sam',
        password: 'x',
        uris: const [
          WebsiteRule('example.co'),
          WebsiteRule('https://intranet.example.co/login', match: WebsiteMatch.exact),
          WebsiteRule('wiki.example.co', match: WebsiteMatch.never),
        ],
        addedAt: 1,
      );
      Page at(String address) => Page.parse(address)!;
      expect(matcher.loginMatches(login, at('https://shop.example.co/cart')), isTrue);
      expect(matcher.loginMatches(login, at('https://intranet.example.co/login')), isTrue);
      expect(matcher.loginMatches(login, at('https://evilexample.co/')), isFalse);
      // Never fills nowhere, but the Default rule of the same domain still does
      expect(matcher.loginMatches(login, at('https://wiki.example.co/')), isTrue);
    });

    test('a code is offered by its websites\' rules too', () {
      final code = OtpAccount(
        id: 'c',
        issuer: '',
        label: 'sam',
        secret: 'JBSWY3DPEHPK3PXP',
        uris: const [WebsiteRule('https://app.example.co/', match: WebsiteMatch.startsWith)],
        addedAt: 1,
      );
      expect(matcher.codeMatches(code, Page.parse('https://app.example.co/sign-in')!), isTrue);
      expect(matcher.codeMatches(code, Page.parse('https://shop.example.co/')!), isFalse);
    });
  });

  group('rules.json, through phoneDomains', () {
    for (final c in _cases) {
      test('phones: ${c['name']}', () {
        final phones = c['phones']! as _Json;
        for (final (kind, key) in [(WebsiteKind.login, 'login'), (WebsiteKind.account, 'account')]) {
          expect(
            phoneDomains([_ruleOf(c)], kind, registrable: _registrableOf, isShared: isSharedHost),
            (phones[key]! as List<Object?>).cast<String>(),
            reason: key,
          );
        }
      });
    }
  });
}
