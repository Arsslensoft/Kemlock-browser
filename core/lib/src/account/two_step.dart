// The account's own second steps (crates/kemlock-api-kem/src/routes/two_step.rs and auth.rs), as far as an extension page can set them
// up: the authenticator app (a secret and an otpauth link, confirmed by a code), the code mailed to an address, and the account's
// recovery code. Security keys, YubiKeys and Duo are the web vault's: a key is made by a WebAuthn creation on the server's own address
// (design 13 of add-browser-extension), which an extension page can't do. A secret goes only where the server must see it to check it.
import '../failure.dart';
import 'account_context.dart';

const _factor = '/account/two-factor';

/// Which methods the account has and whether each is on, whether it holds a recovery code, and what the email method has set up.
Future<Object?> twoStepList(AccountContext c) async {
  final list = objectOf(await c.call('GET', '/account/two-step'), 'the list');
  final setup = await c.call('GET', '/account/two-step/setup', absentIsNull: true);
  return {
    'methods': [
      if (list['methods'] case final List<Object?> methods)
        for (final method in methods)
          if (method is Map<String, Object?>) {'method': method['method'], 'enabled': method['enabled'] == true},
    ],
    'recoveryCodes': list['recoveryCodes'] == true,
    'email': setup?['email'],
    'emailOffered': setup?['emailOffered'] == true,
  };
}

/// Starts an authenticator app's enrolment: the secret to type and the link a QR code carries.
Future<Object?> totpBegin(AccountContext c) async {
  final enrolment = objectOf(await c.call('POST', '$_factor/totp'), 'an enrolment');
  return {'secret': enrolment['secret'], 'uri': enrolment['uri']};
}

/// Turns the authenticator app on with a code from it. Beside another step that is on, [proof] is the fresh proof.
Future<Object?> totpConfirm(AccountContext c, String code, String? proof) async {
  await c.call(
    'POST',
    '$_factor/totp/confirm',
    body: {'code': code.trim(), if (proof != null && proof.trim().isNotEmpty) 'proof': proof.trim()},
  );
  return const <String, Object?>{};
}

/// Mails a code to [address], to confirm it is the account's.
Future<Object?> emailBegin(AccountContext c, String address) async {
  await c.call('POST', '$_factor/email', body: {'address': address.trim()});
  return const <String, Object?>{};
}

Future<Object?> emailConfirm(AccountContext c, String address, String code, String? proof) async {
  await c.call(
    'POST',
    '$_factor/email/confirm',
    body: {'address': address.trim(), 'code': code.trim(), if (proof != null && proof.trim().isNotEmpty) 'proof': proof.trim()},
  );
  return const <String, Object?>{};
}

Future<Object?> emailOff(AccountContext c, String proof) async {
  if (proof.trim().isEmpty) throw const CoreFailure('proofNeeded');
  await c.call('DELETE', '$_factor/email', body: {'proof': proof.trim()});
  return const <String, Object?>{};
}

/// The account's recovery code, or null when it has none or spent it. [proof] is a fresh proof that is not the recovery code itself;
/// the server wants none while the account has no second step.
Future<Object?> recoveryCode(AccountContext c, String? proof) async {
  final answer = objectOf(
    await c.call('POST', '$_factor/recovery-code', body: {if (proof != null && proof.trim().isNotEmpty) 'proof': proof.trim()}),
    'a code',
  );
  return {'code': answer['code']};
}
