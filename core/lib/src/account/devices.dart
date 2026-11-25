// The account's devices and the approvals of new ones (add-kemlock-server-sync, design 11): the list with each device's last use,
// signing one out, and the requests another device made to sign in, which this open browser approves by sealing the root key to the
// request's one-time key, or denies. The five words are worked out here from the request's key, never taken from the server.
import 'package:kemlock_core/features/sync/kemlock/km_approvals.dart';
import 'package:kemlock_core/features/sync/kemlock/km_auth_api.dart';

import '../failure.dart';
import 'account_context.dart';

/// The account's devices, most recently seen first as the server lists them.
Future<Object?> listDevices(AccountContext c) async {
  final devices = await c.connection.call((token) => KmAuthApi(c.api, clock: c.clock).devices(c.server, token));
  return {
    'devices': [
      for (final device in devices)
        {
          'id': device.id,
          'name': device.name,
          'kind': device.kind,
          'current': device.current || device.id == c.connection.session.deviceId,
          'trusted': device.trusted,
          'createdAt': millis(device.createdAt),
          'lastSeen': millis(device.lastSeen),
          'lastKemlock': millis(device.lastKemlock),
          'lastBitwarden': millis(device.lastBitwarden),
        },
    ],
  };
}

/// Ends another device's session and deletes its key copy. This browser's own session ends with "Sign out of Kemlock Server".
Future<Object?> signOutDevice(AccountContext c, String deviceId) async {
  if (deviceId == c.connection.session.deviceId) {
    throw const CoreFailure(CoreFailure.invalid, 'this browser signs out from the sync card');
  }
  await c.connection.call((token) => KmAuthApi(c.api, clock: c.clock).signOutDevice(c.server, token, deviceId));
  return const <String, Object?>{};
}

KmApprovals _approvals(AccountContext c) {
  final words = c.words;
  if (words == null) throw const CoreFailure(CoreFailure.unavailable, 'the word list was not given');
  return KmApprovals(
    auth: KmAuthApi(c.api, clock: c.clock),
    connection: c.connection,
    words: words,
    account: c.account,
    // The phone asks its owner to show it is them. A browser has no screen lock to ask: the call comes from an extension page
    // only (the background checks the sender), with the vault open, from the person's own click on Approve.
    ownerCheck: (_) async => true,
    clock: c.clock,
  );
}

/// The requests to show: open ones under 15 minutes old, newest first.
Future<Object?> listApprovals(AccountContext c) async {
  final pending = await _approvals(c).pending();
  return {
    'approvals': [
      for (final item in pending)
        {
          'id': item.request.id,
          'deviceName': item.request.deviceName,
          'deviceKind': item.request.deviceKind,
          'ip': item.request.ip,
          // Computed here from the request's key; null when the server gave none
          'phrase': item.phrase?.split(' '),
          'agrees': item.serverPhraseAgrees,
          'canApprove': item.canApprove,
          'ageSeconds': item.age.inSeconds,
          'createdAt': item.request.createdAt.millisecondsSinceEpoch,
          'expiresAt': item.request.expiresAt.millisecondsSinceEpoch,
        },
    ],
  };
}

Future<KmPendingApproval> _find(KmApprovals approvals, String id) async {
  for (final item in await approvals.pending()) {
    if (item.request.id == id) return item;
  }
  throw const CoreFailure(CoreFailure.notFound, 'the request is over or answered');
}

/// Approves the request [id]: the root key sealed to its key, and nothing else sent. Refused before anything is sealed when the
/// server's words aren't the ones computed here.
Future<Object?> approveDevice(AccountContext c, String id) async {
  final approvals = _approvals(c);
  await approvals.approve(await _find(approvals, id), reason: 'browser');
  return const <String, Object?>{};
}

/// Denies the request [id]: a refusal that carries no key.
Future<Object?> denyDevice(AccountContext c, String id) async {
  final approvals = _approvals(c);
  await approvals.deny(await _find(approvals, id));
  return const <String, Object?>{};
}
