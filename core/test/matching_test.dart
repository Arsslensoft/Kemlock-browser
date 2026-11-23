import 'package:kemlock_core/core/public_suffix_list.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/website_rule.dart';
import 'package:kemlock_extension_core/src/directory.dart';
import 'package:kemlock_extension_core/src/matching.dart';
import 'package:test/test.dart';

import 'support.dart';

Login login(String id, List<String> websites, {List<WebsiteRule>? uris, String? accountId}) =>
    Login(id: id, name: id, username: 'sam', password: 'x', websites: websites, uris: uris, accountId: accountId, addedAt: 1);

OtpAccount code(String id, {String issuer = '', List<String>? websites}) =>
    OtpAccount(id: id, issuer: issuer, label: 'sam', secret: 'JBSWY3DPEHPK3PXP', websites: websites, addedAt: 1);

void main() {
  final matcher = SiteMatcher(suffixes: PublicSuffixList.parse(smallSuffixList));

  SiteMatches at(String address, {List<Login> logins = const [], List<OtpAccount> codes = const []}) =>
      matcher.match(Page.parse(address)!, logins: logins, accounts: codes);

  group('Page', () {
    test('is a web address with a host', () {
      expect(Page.parse('https://Accounts.Orbit-Cloud.com/sign-in?x=1')!.host, 'accounts.orbit-cloud.com');
      expect(Page.parse('http://localhost:3000/')!.host, 'localhost');
      expect(Page.parse('chrome://extensions'), isNull);
      expect(Page.parse('about:blank'), isNull);
      expect(Page.parse('file:///tmp/a.html'), isNull);
      expect(Page.parse('not an address'), isNull);
    });
  });

  group('an item fills only on its own site', () {
    final orbit = login('orbit', ['accounts.orbit-cloud.com']);

    test('another subdomain of the registrable domain is offered', () {
      expect(at('https://app.orbit-cloud.com/', logins: [orbit]).logins, ['orbit']);
      expect(at('https://orbit-cloud.com/', logins: [orbit]).logins, ['orbit']);
      expect(at('https://app.orbit-cloud.com/', logins: [orbit]).site, 'orbit-cloud.com');
    });

    test('a host that only looks like it is not', () {
      expect(at('https://orbit-cloud.com.evil.io/', logins: [orbit]).logins, isEmpty);
      expect(at('https://evilorbit-cloud.com/', logins: [orbit]).logins, isEmpty);
    });

    test('a private suffix matches only exactly', () {
      final sam = login('sam', ['sam.github.io']);
      expect(at('https://sam.github.io/', logins: [sam]).logins, ['sam']);
      expect(at('https://alex.github.io/', logins: [sam]).logins, isEmpty);
    });

    test('a tenant host matches only exactly', () {
      final acme = login('acme', ['acme.okta.com']);
      expect(at('https://acme.okta.com/', logins: [acme]).logins, ['acme']);
      expect(at('https://evil.okta.com/', logins: [acme]).logins, isEmpty);
    });

    test('a rule on the address is held to the whole address', () {
      final exact = login(
        'exact',
        ['orbit-cloud.com'],
        uris: const [WebsiteRule('https://orbit-cloud.com/login', match: WebsiteMatch.exact)],
      );
      expect(at('https://orbit-cloud.com/login', logins: [exact]).logins, ['exact']);
      expect(at('https://orbit-cloud.com/other', logins: [exact]).logins, isEmpty);
    });

    test("several matches are each offered, in the vault's order", () {
      final logins = [
        orbit,
        login('b', ['orbit-cloud.com']),
        login('c', ['other.net']),
      ];
      expect(at('https://orbit-cloud.com/', logins: logins).logins, ['orbit', 'b']);
    });
  });

  group('codes', () {
    test('a code is offered on its websites', () {
      expect(
        at(
          'https://orbit-cloud.com/',
          codes: [
            code('a', websites: ['orbit-cloud.com']),
          ],
        ).codes,
        ['a'],
      );
      expect(
        at(
          'https://other.net/',
          codes: [
            code('a', websites: ['orbit-cloud.com']),
          ],
        ).codes,
        isEmpty,
      );
    });

    test('a code whose issuer is a domain is offered there', () {
      expect(at('https://orbit-cloud.com/', codes: [code('a', issuer: 'orbit-cloud.com')]).codes, ['a']);
    });

    test('the 2FA directory gives a service its domain', () {
      final directory = TwoFactorDirectory.fromJson({
        'entries': [
          ['Orbit Cloud', 'orbit-cloud.com', 0, 0],
        ],
      });
      final withDirectory = SiteMatcher(suffixes: PublicSuffixList.parse(smallSuffixList), directory: directory);
      final result = withDirectory.match(
        Page.parse('https://orbit-cloud.com/')!,
        logins: const [],
        accounts: [code('a', issuer: 'Orbit Cloud')],
      );
      expect(result.codes, ['a']);
    });

    test('a code linked to a login that matches follows it', () {
      final result = at(
        'https://orbit-cloud.com/',
        logins: [
          login('l', ['orbit-cloud.com'], accountId: 'a'),
        ],
        codes: [code('a', issuer: 'Elsewhere')],
      );
      expect(result.logins, ['l']);
      expect(result.codes, ['a']);
    });
  });

  group('the look-alike guard', () {
    final orbit = login('orbit', ['orbit-cloud.com']);

    test('a digit for a letter', () {
      expect(at('https://orbit-c1oud.com/', logins: [orbit]).lookAlikeOf, 'orbit-cloud.com');
      expect(at('https://orbit-c1oud.com/', logins: [orbit]).logins, isEmpty);
    });

    test('one character off, in a name of six letters or more', () {
      expect(at('https://orbit-clouds.com/', logins: [orbit]).lookAlikeOf, 'orbit-cloud.com');
      expect(at('https://orbt-cloud.com/', logins: [orbit]).lookAlikeOf, 'orbit-cloud.com');
      expect(at('https://orbti-cloud.com/', logins: [orbit]).lookAlikeOf, 'orbit-cloud.com');
    });

    test('a different site with a similar name is not one', () {
      expect(
        at(
          'https://gitlab.com/',
          logins: [
            login('gh', ['github.com']),
          ],
        ).lookAlikeOf,
        isNull,
      );
    });

    test('a short name is not one', () {
      expect(
        at(
          'https://abcd.com/',
          logins: [
            login('x', ['abce.com']),
          ],
        ).lookAlikeOf,
        isNull,
      );
    });

    test('the same name under another suffix is not one', () {
      expect(at('https://orbit-cloud.io/', logins: [orbit]).lookAlikeOf, isNull);
    });

    test('only when nothing matches', () {
      expect(at('https://orbit-cloud.com/', logins: [orbit]).lookAlikeOf, isNull);
    });

    test('letters of another script that look Latin are folded', () {
      expect(lookAlike('оrbit-cloud.com', ['orbit-cloud.com']), 'orbit-cloud.com');
      expect(lookAlike('orbit-cloud.com', ['orbit-cloud.com']), isNull);
      expect(foldLookAlikes('rnicro'), foldLookAlikes('micro'));
      expect(foldLookAlikes('vvhite'), foldLookAlikes('white'));
    });

    test('a punycode name is read as the characters it spells', () {
      expect(idnDecode('xn--bcher-kva.example'), 'bücher.example');
      expect(punycodeDecode('bcher-kva'), 'bücher');
      expect(punycodeDecode('!!'), isNull);
    });
  });

  test('one edit is a change, an addition, a loss or a swap', () {
    expect(isOneEdit('github', 'githud'), isTrue);
    expect(isOneEdit('github', 'githubs'), isTrue);
    expect(isOneEdit('github', 'gihub'), isTrue);
    expect(isOneEdit('github', 'gihtub'), isTrue);
    expect(isOneEdit('github', 'gitlab'), isFalse);
    expect(isOneEdit('github', 'github'), isFalse);
  });

  test('without the Public Suffix List a host is its own site', () {
    final plain = SiteMatcher();
    final logins = [
      login('a', ['accounts.orbit-cloud.com']),
    ];
    expect(plain.match(Page.parse('https://app.orbit-cloud.com/')!, logins: logins, accounts: const []).logins, isEmpty);
    expect(plain.match(Page.parse('https://sub.accounts.orbit-cloud.com/')!, logins: logins, accounts: const []).logins, ['a']);
  });
}
