// Which logins put the person at risk, as the app works them out (`login_health.dart`, `password_strength.dart`): passwords
// used twice, weak ones, sites that offer codes where none is linked, and, only while the breach check is on, passwords seen in
// breaches. Worked out from the open vault's logins, and never stored or synced.
import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:kemlock_core/models/login.dart';

import 'matching.dart';

/// A master password is long enough from here (the app's rule, which the strength meter holds every password to).
const minStrongLength = 12;

/// How many of the five checks [password] passes: 12 characters or more, an upper-case letter, a lower-case one, a digit and a
/// symbol.
int passwordScore(String password) {
  final passed = [
    password.runes.length >= minStrongLength,
    RegExp('[A-Z]').hasMatch(password),
    RegExp('[a-z]').hasMatch(password),
    RegExp(r'\d').hasMatch(password),
    RegExp('[^A-Za-z0-9]').hasMatch(password),
  ];
  return passed.where((ok) => ok).length;
}

/// The strength meter's level, 0 (very weak) to 4 (very strong): the score, never more than 2 for a password shorter than
/// [minStrongLength], whatever else it has.
int strengthLevel(String password) {
  final score = passwordScore(password);
  if (password.runes.length < minStrongLength) return math.min(score, 2);
  return math.min(score, 4);
}

/// A password the meter rates below "strong".
bool isWeakPassword(String password) => strengthLevel(password) < 3;

/// What can be wrong with a login.
enum LoginWarning { reused, weak, noCode, breached }

/// The warnings of a vault's logins.
class LoginHealth {
  const LoginHealth(this._warnings);

  static const empty = LoginHealth({});

  final Map<String, Set<LoginWarning>> _warnings;

  Set<LoginWarning> of(String id) => _warnings[id] ?? const {};

  /// The ids of the logins with [warning], in the vault's order.
  List<String> idsWith(LoginWarning warning) => [
    for (final MapEntry(:key, :value) in _warnings.entries)
      if (value.contains(warning)) key,
  ];
}

String _digest(String password) => sha256.convert(utf8.encode(password)).toString();

/// The registrable domains of the services the 2FA directory lists as offering codes.
Set<String> codeDomains(Iterable<String> directoryDomains, SiteMatcher matcher) => {
  for (final domain in directoryDomains)
    if (domain.isNotEmpty) matcher.registrable(domain),
};

/// Whether [login] is for a site of [offering] with no code linked, and the person didn't ask not to be warned.
bool lacksItsCode(Login login, Set<String> offering, SiteMatcher matcher) {
  if (login.accountId != null || login.codeWarning == false) return false;
  return login.rules.any((rule) {
    final host = rule.host;
    return host != null && offering.contains(matcher.registrable(host));
  });
}

/// The warnings of [logins]: a password two logins share, compared by its SHA-256 held only here, a weak one, a site of
/// [offering] with no code, and the logins [breached] names.
LoginHealth loginHealth(List<Login> logins, SiteMatcher matcher, {Set<String> offering = const {}, Set<String> breached = const {}}) {
  final byDigest = <String, List<String>>{};
  for (final login in logins) {
    final password = login.password;
    if (password == null || password.isEmpty) continue;
    (byDigest[_digest(password)] ??= []).add(login.id);
  }
  final reused = {
    for (final ids in byDigest.values)
      if (ids.length > 1) ...ids,
  };
  return LoginHealth({
    for (final login in logins)
      login.id: {
        if (reused.contains(login.id)) LoginWarning.reused,
        if (login.password case final password? when password.isNotEmpty && isWeakPassword(password)) LoginWarning.weak,
        if (lacksItsCode(login, offering, matcher)) LoginWarning.noCode,
        if (breached.contains(login.id)) LoginWarning.breached,
      },
  });
}
