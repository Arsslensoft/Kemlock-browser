// Which items a site gets (design decision 8, and the browser-autofill spec): the registrable domain by the Public Suffix List,
// compared label by label, the websites' rules over the whole address, tenant hosts only exactly, and the look-alike guard
// when nothing matches. The lists and rules are Kemlock-core's; this only asks them for an address.
import 'package:kemlock_core/core/public_suffix_list.dart';
import 'package:kemlock_core/core/website_rules.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_core/models/passkey.dart';
import 'package:kemlock_core/models/website_rule.dart';

import 'directory.dart';

/// Domains under which anyone can open a site or a workspace of their own, such as `evil.okta.com` beside `acme.okta.com`.
/// An item matches one of them only on that exact host, so a code isn't offered to another tenant. (The phone's list,
/// `autofill_copy.dart`.)
const sharedHosts = {
  'auth0.com',
  'okta.com',
  'onelogin.com',
  'slack.com',
  'wordpress.com',
  'zendesk.com',
  'atlassian.net',
  'github.io',
  'gitlab.io',
  'blogspot.com',
  'herokuapp.com',
  'netlify.app',
  'vercel.app',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'appspot.com',
  'azurewebsites.net',
  'myshopify.com',
  'wixsite.com',
};

/// Whether [host] is one of [sharedHosts], or under one.
bool isSharedHost(String host) => sharedHosts.any((shared) => host == shared || host.endsWith('.$shared'));

/// The page an address names: its host, which only a web address has.
class Page {
  const Page(this.address, this.host);

  /// The address as a browser shows it.
  final String address;

  /// The host, in lowercase, with no trailing dot.
  final String host;

  /// The page [address] is, or null when it isn't an http or https address with a host (a browser's own page, a file).
  static Page? parse(String address) {
    final uri = Uri.tryParse(address.trim());
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) return null;
    var host = uri.host.toLowerCase();
    if (host.endsWith('.')) host = host.substring(0, host.length - 1);
    if (host.isEmpty) return null;
    return Page(address.trim(), host);
  }
}

/// What a site gets: the ids it matches, and the known site it looks like when it matches nothing.
class SiteMatches {
  const SiteMatches({required this.site, this.logins = const [], this.codes = const [], this.passkeys = const [], this.lookAlikeOf});

  /// The page's registrable domain, shown in the picker.
  final String site;
  final List<String> logins;
  final List<String> codes;

  /// The passkeys whose relying party is the page's host or a domain above it (docs/plans/add-passkeys.md).
  final List<String> passkeys;
  final String? lookAlikeOf;

  Map<String, Object?> toJson() => {
    'site': site,
    'logins': logins,
    'codes': codes,
    if (passkeys.isNotEmpty) 'passkeys': passkeys,
    'lookAlikeOf': ?lookAlikeOf,
  };
}

/// Matches pages to the vault's logins and codes.
class SiteMatcher {
  SiteMatcher({this.suffixes, this.directory});

  /// The Public Suffix List; without it a host is its own registrable domain, and so fills on itself and the hosts under it.
  final PublicSuffixList? suffixes;

  /// The 2FA directory, for the domains of a code's service.
  final TwoFactorDirectory? directory;

  /// The part of [host] a site owns.
  String registrable(String host) => suffixes?.registrableDomain(host) ?? host;

  /// Whether [rule] fills on the [page].
  bool _fills(WebsiteRule rule, Page page) => fillsOn(rule, page.address, registrable: registrable, isShared: isSharedHost);

  /// Whether a domain a code's service is known under ([autofillDomains]) fills on [page]: a `=host` only there, any other on
  /// its registrable domain and the hosts under it.
  bool _domainFills(String domain, Page page) {
    if (domain.startsWith('=')) return page.host == domain.substring(1);
    final base = registrable(domain);
    return page.host == base || page.host.endsWith('.$base');
  }

  /// The hosts a code of [issuer] is known on without any website of its own: the issuer when it is a domain, and the
  /// directory's domain for the service.
  List<String> issuerDomains(String issuer) {
    final domains = <String>[];
    final name = issuer.trim().toLowerCase();
    final url = RegExp(r'^[a-z][a-z0-9+.-]*://([^/?#:]*)').firstMatch(name);
    final host = url != null ? url[1]! : (_domain.hasMatch(name) ? name : null);
    if (host != null) _addDomain(domains, host);
    final entry = name.isEmpty ? null : directory?.findService(issuer);
    if (entry != null && entry.domain.isNotEmpty) _addDomain(domains, entry.domain);
    return domains;
  }

  static final _domain = RegExp(r'^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$');

  void _addDomain(List<String> into, String host) {
    var h = host.toLowerCase().trim();
    if (h.startsWith('www.')) h = h.substring(4);
    if (h.endsWith('.')) h = h.substring(0, h.length - 1);
    if (!_domain.hasMatch(h)) return;
    final entry = isSharedHost(h) ? '=$h' : h;
    if (!into.contains(entry)) into.add(entry);
  }

  /// Whether [login] is offered on [page].
  bool loginMatches(Login login, Page page) => login.rules.any((rule) => _fills(rule, page));

  /// Whether [account] is offered on [page]: on its own websites, or on the domains its issuer is known under.
  bool codeMatches(OtpAccount account, Page page) =>
      account.rules.any((rule) => _fills(rule, page)) || issuerDomains(account.issuer).any((domain) => _domainFills(domain, page));

  /// The registrable domains the vault knows, each with the item that holds it, for the look-alike check.
  Iterable<String> knownDomains(List<Login> logins, List<OtpAccount> accounts) sync* {
    final seen = <String>{};
    for (final rules in [for (final login in logins) login.rules, for (final account in accounts) account.rules]) {
      for (final rule in rules) {
        final host = rule.host;
        if (host == null) continue;
        final domain = registrable(host);
        if (seen.add(domain)) yield domain;
      }
    }
    for (final account in accounts) {
      for (final domain in issuerDomains(account.issuer)) {
        final known = registrable(domain.startsWith('=') ? domain.substring(1) : domain);
        if (seen.add(known)) yield known;
      }
    }
  }

  /// What [page] gets from the vault. Logins and codes in the vault's order; a code linked to a login that matches is
  /// offered too, as the code that follows its password.
  SiteMatches match(Page page, {required List<Login> logins, required List<OtpAccount> accounts, List<Passkey> passkeys = const []}) {
    final site = registrable(page.host);
    final loginIds = [
      for (final login in logins)
        if (loginMatches(login, page)) login.id,
    ];
    final linked = {
      for (final login in logins)
        if (loginIds.contains(login.id) && login.accountId != null) login.accountId!,
    };
    final codeIds = [
      for (final account in accounts)
        if (codeMatches(account, page) || linked.contains(account.id)) account.id,
    ];
    final passkeyIds = [
      for (final passkey in passkeys)
        if (page.host == passkey.rpId || page.host.endsWith('.${passkey.rpId}')) passkey.id,
    ];
    if (loginIds.isNotEmpty || codeIds.isNotEmpty || passkeyIds.isNotEmpty) {
      return SiteMatches(site: site, logins: loginIds, codes: codeIds, passkeys: passkeyIds);
    }
    return SiteMatches(site: site, lookAlikeOf: lookAlike(site, knownDomains(logins, accounts)));
  }
}

/// The known registrable domain [domain] looks like without being it, or null: the same once look-alike characters are folded
/// together, or one edit off it in a name of six letters or more under the same suffix. Two edits off, or a short name, is not
/// a look-alike: `gitlab.com` stays apart from `github.com`.
String? lookAlike(String domain, Iterable<String> known) {
  final shown = idnDecode(domain);
  final folded = foldLookAlikes(shown);
  final dot = shown.indexOf('.');
  for (final candidate in known) {
    if (candidate == domain) continue;
    final other = idnDecode(candidate);
    if (foldLookAlikes(other) == folded) return candidate;
    final otherDot = other.indexOf('.');
    if (dot <= 0 || otherDot <= 0) continue;
    final label = shown.substring(0, dot);
    final otherLabel = other.substring(0, otherDot);
    if (shown.substring(dot) != other.substring(otherDot)) continue;
    if (otherLabel.runes.length >= 6 && isOneEdit(label, otherLabel)) return candidate;
  }
  return null;
}

/// [domain] with each `xn--` label decoded to the characters it spells.
String idnDecode(String domain) =>
    domain.split('.').map((label) => label.startsWith('xn--') ? (punycodeDecode(label.substring(4)) ?? label) : label).join('.');

/// Look-alike letters of other scripts, and the digits and letters Latin ones are mistaken for, as the Latin letter they pass for.
const _confusable = {
  // Cyrillic
  'а': 'a', 'с': 'c', 'е': 'e', 'һ': 'h', 'і': 'l', 'ј': 'j', 'к': 'k', 'о': 'o', 'р': 'p', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', //
  'х': 'x', 'у': 'y', 'ӏ': 'l', 'ɡ': 'g', 'ᴏ': 'o', 'ᴠ': 'v', 'ᴡ': 'w', 'ᴢ': 'z',
  // Greek
  'ο': 'o', 'α': 'a', 'ν': 'v', 'ρ': 'p', 'ι': 'l', 'κ': 'k', 'χ': 'x', 'υ': 'u', 'ε': 'e', 'τ': 't', 'γ': 'y', 'β': 'b',
  // Digits and Latin letters
  '0': 'o', '1': 'l', 'i': 'l',
};

/// [text] with the look-alikes of the guard folded together: `0` to `o`, `1` and `i` to `l`, `rn` to `m`, `vv` to `w`, and the
/// Cyrillic and Greek letters that look Latin to the Latin ones.
String foldLookAlikes(String text) {
  final out = StringBuffer();
  for (final rune in text.toLowerCase().runes) {
    final char = String.fromCharCode(rune);
    out.write(_confusable[char] ?? char);
  }
  return out.toString().replaceAll('rn', 'm').replaceAll('vv', 'w');
}

/// Whether [a] and [b] differ by one edit: a letter changed, added or left out, or two next to each other swapped
/// (Damerau–Levenshtein distance 1).
bool isOneEdit(String a, String b) {
  final x = a.runes.toList();
  final y = b.runes.toList();
  if (x.length == y.length) {
    final at = <int>[
      for (var i = 0; i < x.length; i++)
        if (x[i] != y[i]) i,
    ];
    if (at.length == 1) return true;
    return at.length == 2 && at[1] == at[0] + 1 && x[at[0]] == y[at[1]] && x[at[1]] == y[at[0]];
  }
  if ((x.length - y.length).abs() != 1) return false;
  final longer = x.length > y.length ? x : y;
  final shorter = x.length > y.length ? y : x;
  var i = 0;
  while (i < shorter.length && longer[i] == shorter[i]) {
    i++;
  }
  for (var j = i; j < shorter.length; j++) {
    if (shorter[j] != longer[j + 1]) return false;
  }
  return true;
}

/// [input] decoded from Punycode (RFC 3492), without the `xn--` prefix; null when it isn't Punycode.
String? punycodeDecode(String input) {
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  var n = 128;
  var i = 0;
  var bias = 72;
  final output = <int>[];
  final dash = input.lastIndexOf('-');
  if (dash > 0) {
    for (var j = 0; j < dash; j++) {
      final c = input.codeUnitAt(j);
      if (c >= 0x80) return null;
      output.add(c);
    }
  }
  int adapt(int delta, int points, bool first) {
    var d = first ? delta ~/ damp : delta ~/ 2;
    d += d ~/ points;
    var k = 0;
    while (d > ((base - tMin) * tMax) ~/ 2) {
      d ~/= base - tMin;
      k += base;
    }
    return k + (base - tMin + 1) * d ~/ (d + skew);
  }

  var index = dash > 0 ? dash + 1 : 0;
  while (index < input.length) {
    final oldI = i;
    var w = 1;
    for (var k = base; ; k += base) {
      if (index >= input.length) return null;
      final c = input.codeUnitAt(index++);
      final digit = c >= 0x30 && c <= 0x39
          ? c - 0x30 + 26
          : c >= 0x61 && c <= 0x7a
          ? c - 0x61
          : c >= 0x41 && c <= 0x5a
          ? c - 0x41
          : -1;
      if (digit < 0) return null;
      i += digit * w;
      final t = k <= bias
          ? tMin
          : k >= bias + tMax
          ? tMax
          : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldI, output.length + 1, oldI == 0);
    n += i ~/ (output.length + 1);
    i %= output.length + 1;
    if (n > 0x10ffff) return null;
    output.insert(i, n);
    i++;
  }
  return String.fromCharCodes(output);
}
