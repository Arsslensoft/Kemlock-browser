// Emergency access (crates/kemlock-api-kem/src/routes/emergency.rs, docs/crypto.md "The sealed box"): a contact the account names, the
// wait before they can ask, and the root key sealed to their kx1 key. The grantor compares the contact's fingerprint and seals; the
// server hands the box to the contact only once the request is approved, by the grantor or by the timer. The server's part ends there,
// so the contact's side here opens the key, checks that it is a root key, and lets it go.
import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/crypto/account/keys.dart';
import 'package:kemlock_core/crypto/account/sealed_box.dart';

import '../failure.dart';
import 'account_context.dart';

const _grants = '/emergency/grants';

Map<String, Object?> _grant(Object? json) {
  final grant = objectOf(json, 'a grant');
  return {
    'id': grant['id'],
    'grantorId': grant['grantorId'],
    'granteeEmail': grant['granteeEmail'],
    'granteeId': grant['granteeId'],
    'kind': grant['kind'],
    'waitDays': grant['waitDays'],
    'state': grant['state'],
    'recoveryInitiatedAt': grant['recoveryInitiatedAt'],
    'dueAt': grant['dueAt'],
    'createdAt': grant['createdAt'],
  };
}

Map<String, Object?> _view(Object? json) {
  final view = objectOf(json, 'a grant');
  return {
    'grant': _grant(view['grant']),
    'grantorEmail': view['grantorEmail'],
    // The bundle itself stays here: the page gets its fingerprint when it asks to confirm
    'hasKeys': view['contactKeys'] != null,
  };
}

Future<Map<String, Object?>> _overview(AccountContext c) async => objectOf(await c.call('GET', '/emergency'), 'the overview');

/// The grants the account made, and the ones that name it.
Future<Object?> emergencyOverview(AccountContext c) async {
  final overview = await _overview(c);
  List<Object?> views(String name) => [
    if (overview[name] case final List<Object?> list)
      for (final view in list) _view(view),
  ];
  return {'trusted': views('trustedContacts'), 'grantors': views('grantors')};
}

/// Names a contact, for [kind] `view` or `takeover` and a wait of 1 to 90 days.
Future<Object?> emergencyInvite(AccountContext c, String email, String kind, int waitDays) async {
  if (kind != 'view' && kind != 'takeover') throw const CoreFailure(CoreFailure.invalid, 'a kind is view or takeover');
  if (waitDays < 1 || waitDays > 90) throw const CoreFailure(CoreFailure.invalid, 'the wait is 1 to 90 days');
  return _grant(await c.call('POST', _grants, body: {'email': email.trim(), 'kind': kind, 'waitDays': waitDays}));
}

Future<Object?> emergencyRevoke(AccountContext c, String id) async {
  await c.call('DELETE', '$_grants/$id');
  return const <String, Object?>{};
}

/// One more step of a grant that takes no body: `accept`, `initiate`, `approve` or `reject`.
Future<Object?> emergencyStep(AccountContext c, String id, String step) async {
  if (!const {'accept', 'initiate', 'approve', 'reject'}.contains(step)) throw const CoreFailure(CoreFailure.invalid, 'no such step');
  return _grant(await c.call('POST', '$_grants/$id/$step'));
}

/// The contact's keys as the grantor reads them before sealing: the bundle must be well formed, signed by its own key and the account's
/// whom the grant names, so a server can't put another account's keys in its place without the fingerprint showing it.
Future<({Map<String, Object?> grant, KeyBundle bundle})> _contact(AccountContext c, String id) async {
  final overview = await _overview(c);
  for (final view in (overview['trustedContacts'] as List<Object?>? ?? const [])) {
    final entry = objectOf(view, 'a grant');
    final grant = objectOf(entry['grant'], 'a grant');
    if (grant['id'] != id) continue;
    if (grant['state'] != 'accepted') throw const CoreFailure(CoreFailure.invalid, 'the contact has not accepted');
    final keys = entry['contactKeys'];
    if (keys is! Map<String, Object?>) throw const CoreFailure(CoreFailure.invalid, 'the contact has not shared their keys');
    final KeyBundle bundle;
    try {
      bundle = KeyBundle.parse(b64urlDecode(keys['publicBundle'] as String? ?? ''));
      if (!await verifyBundle(bundle, b64urlDecode(keys['bundleSignature'] as String? ?? ''))) throw const MalformedException('unsigned');
    } on MalformedException {
      throw const CoreFailure('badBundle');
    }
    // An accepted grant names the contact's account, and the keys must be that account's: the server can't offer another's
    final grantee = grant['granteeId'];
    if (grantee is! String || grantee != uuidText(bundle.accountId)) throw const CoreFailure('badBundle');
    return (grant: grant, bundle: bundle);
  }
  throw const CoreFailure(CoreFailure.notFound, 'no such grant');
}

/// What the person compares before confirming: the contact's name and the 60 digits of their fingerprint, which they check with the
/// contact over another channel.
Future<Object?> emergencyContact(AccountContext c, String id) async {
  final found = await _contact(c, id);
  return {
    'name': found.grant['granteeEmail'],
    'kind': found.grant['kind'],
    'waitDays': found.grant['waitDays'],
    'fingerprint': found.bundle.fingerprintDigits,
  };
}

/// Confirms the contact: seals the root key to their kx1 key, bound to their account id, and sends the box. [fingerprint] is what the
/// person compared; if the contact's keys are others now, nothing is sealed.
Future<Object?> emergencyConfirm(AccountContext c, String id, String fingerprint) async {
  final found = await _contact(c, id);
  if (found.bundle.fingerprintDigits != fingerprint.trim()) throw const CoreFailure('changed');
  final sealed = await sealBox(
    found.bundle.kx1PublicKey,
    c.account.rootKey,
    context: SealContext.emergencyAccess,
    aad: found.bundle.accountId,
  );
  return _grant(await c.call('POST', '$_grants/$id/confirm', body: {'sealedKey': b64urlEncode(sealed)}));
}

/// The contact's side once a request is approved: fetches the sealed key and opens it with this account's key, to say it opens. The key
/// is wiped at once: the server has no route that reads the grantor's items with it, and the web vault stops here too.
Future<Object?> emergencyKey(AccountContext c, String id) async {
  final release = objectOf(await c.call('GET', '$_grants/$id/key'), 'a key release');
  final sealed = release['sealedKey'];
  if (sealed is! String) throw const CoreFailure(CoreFailure.failed, 'an answer without a key');
  try {
    final key = await openBox(
      b64urlDecode(sealed),
      c.account.kx1PrivateKey,
      context: SealContext.emergencyAccess,
      aad: uuidBytes(c.account.accountId),
    );
    final opens = key.length == rootKeyLength;
    wipe(key);
    return {'grantorId': release['grantorId'], 'kind': release['kind'], 'opens': opens};
  } on MalformedException {
    throw const CoreFailure('unreadable');
  } on CorruptedException {
    throw const CoreFailure('unreadable');
  }
}
