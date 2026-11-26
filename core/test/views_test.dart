import 'package:kemlock_core/models/key_account.dart';
import 'package:kemlock_core/models/login.dart';
import 'package:kemlock_core/models/otp_account.dart';
import 'package:kemlock_extension_core/src/health.dart';
import 'package:kemlock_extension_core/src/views.dart';
import 'package:test/test.dart';

void main() {
  const totp = OtpAccount(
    id: 'a',
    type: OtpType.totp,
    issuer: 'Orbit',
    label: 'sam@orbit.test',
    secret: 'JBSWY3DPEHPK3PXP',
    websites: ['orbit-cloud.com'],
    tags: ['work'],
    addedAt: 1,
  );

  test('a code view names the account and holds no secret', () {
    final view = codeView(totp, order: 3, loginId: 'l', backupCodesLeft: 4);
    expect(view, {
      'id': 'a',
      'issuer': 'Orbit',
      'account': 'sam@orbit.test',
      'type': 'totp',
      'digits': 6,
      'period': 30,
      'tags': ['work'],
      'order': 3,
      'onSecurityKey': false,
      'websites': ['orbit-cloud.com'],
      'ownWebsites': ['orbit-cloud.com'],
      'loginId': 'l',
      'backupCodesLeft': 4,
      'fields': <Object?>[],
      'links': 0,
    });
    expect(view.values.join(), isNot(contains('JBSWY3DPEHPK3PXP')));
  });

  test('an account on a security key is named, never computed', () {
    final view = keyAccountView(const KeyAccount(id: 'k', device: 'd', name: 'Orbit', label: 'sam', addedAt: 1), order: 0);
    expect(view['onSecurityKey'], isTrue);
    expect(view.containsKey('secret'), isFalse);
  });

  test('a live code ends with its window; a counter code has no end', () {
    final live = liveCode(totp, 1700000000000);
    expect(live['id'], 'a');
    expect(live['code'], matches(RegExp(r'^\d{6}$')));
    expect(live['expiresAt'], (1700000000 ~/ 30 + 1) * 30 * 1000);
    final hotp = liveCode(totp.copyWith(type: OtpType.hotp, counter: 3), 1700000000000);
    expect(hotp.containsKey('expiresAt'), isFalse);
  });

  test('a login view holds no password, and says how strong it is', () {
    const login = Login(id: 'l', name: 'Orbit', username: 'sam', password: 'Correct-Horse-9!', websites: ['orbit-cloud.com'], addedAt: 1);
    final view = loginView(login, order: 0, health: LoginHealth.empty);
    expect(view['hasPassword'], isTrue);
    expect(view['strength'], 4);
    expect(view['username'], 'sam');
    expect(view.values.join(), isNot(contains('Correct-Horse')));
    expect((view['health']! as Map<String, Object?>)['ignored'], isFalse);
  });

  test('the meter holds a short password to fair', () {
    expect(strengthLevel('Abc1!'), lessThanOrEqualTo(2));
    expect(strengthLevel(''), 0);
    expect(strengthLevel('abcdefghijkl'), lessThan(3));
    expect(strengthLevel('Abcdefghij1!'), 4);
  });
}
