// The account's own calls as the TypeScript side makes them: one `account` call with an `op` and its arguments (src/shared/account.ts
// holds the list and validates each before it gets here), answered with JSON. Every op that needs the server runs through the Kemlock
// host's connection (`KmHost.withAccount`), which renews the access token, seals each new session before it is used, and wipes the
// account's keys when the call ends.
import '../failure.dart';
import '../sync_service.dart';
import '../vault_service.dart';
import 'account_context.dart';
import 'devices.dart';
import 'emergency.dart';
import 'kit.dart';
import 'kit_service.dart';
import 'two_step.dart';

class AccountService {
  AccountService(this._sync, this._vault);

  final SyncService _sync;
  final VaultService _vault;

  /// A kit made and not kept: its pieces were shown once, and it is sent to the server when one is typed back.
  MadeKit? _kit;

  /// Forgets what is held between calls, when the vault locks.
  void unload() => _kit = null;

  /// Answers one op, or throws a [CoreFailure] whose code the pages read.
  Future<Object?> call(Map<String, Object?> request) async {
    final op = request['op'];
    if (op is! String) throw const CoreFailure(CoreFailure.invalid, 'no op');
    _vault.requireSession();
    try {
      return await _dispatch(op, request);
    } catch (error) {
      final failure = accountFailure(error);
      if (identical(failure, error)) rethrow;
      throw failure;
    }
  }

  String _text(Map<String, Object?> args, String name) {
    final value = args[name];
    if (value is! String) throw CoreFailure(CoreFailure.invalid, '$name is not text');
    return value;
  }

  String? _optional(Map<String, Object?> args, String name) {
    final value = args[name];
    if (value == null) return null;
    if (value is! String) throw CoreFailure(CoreFailure.invalid, '$name is not text');
    return value;
  }

  int _number(Map<String, Object?> args, String name) {
    final value = args[name];
    if (value is! int) throw CoreFailure(CoreFailure.invalid, '$name is not a number');
    return value;
  }

  /// Runs [run] with the open account over the connection to the server in use.
  Future<T> _withAccount<T>(Future<T> Function(AccountContext c) run) {
    final host = _sync.kemlockHost();
    final target = _sync.kemlockTarget ?? (throw const CoreFailure('notKemlock', 'the vault does not sync with Kemlock Server'));
    final words = CoreDataAccess(_vault).approvalWords;
    return host.withAccount(
      target,
      (connection, account) => run(AccountContext(connection: connection, account: account, words: words, clock: _vault.platform.clock)),
    );
  }

  Future<Object?> _dispatch(String op, Map<String, Object?> a) {
    switch (op) {
      // Making an account, and moving a vault: the sync's own steps
      case 'register':
        return _sync.registerKemlock(a);
      case 'moveStatus':
        return _sync.moveStatus();
      case 'moveStart':
        return _sync.moveStart(a);
      case 'moveCancel':
        return _sync.moveCancel();
      // Devices and their approvals
      case 'devices':
        return _withAccount(listDevices);
      case 'signOutDevice':
        return _withAccount((c) => signOutDevice(c, _text(a, 'deviceId')));
      case 'approvals':
        return _withAccount(listApprovals);
      case 'approve':
        return _withAccount((c) => approveDevice(c, _text(a, 'id')));
      case 'deny':
        return _withAccount((c) => denyDevice(c, _text(a, 'id')));
      // Emergency access
      case 'emergency':
        return _withAccount(emergencyOverview);
      case 'emergencyInvite':
        return _withAccount((c) => emergencyInvite(c, _text(a, 'email'), _text(a, 'kind'), _number(a, 'waitDays')));
      case 'emergencyRevoke':
        return _withAccount((c) => emergencyRevoke(c, _text(a, 'id')));
      case 'emergencyStep':
        return _withAccount((c) => emergencyStep(c, _text(a, 'id'), _text(a, 'step')));
      case 'emergencyContact':
        return _withAccount((c) => emergencyContact(c, _text(a, 'id')));
      case 'emergencyConfirm':
        return _withAccount((c) => emergencyConfirm(c, _text(a, 'id'), _text(a, 'fingerprint')));
      case 'emergencyKey':
        return _withAccount((c) => emergencyKey(c, _text(a, 'id')));
      // The Recovery Kit
      case 'recoveryKit':
        return _withAccount((c) async => {'kit': await kitRecord(c)});
      case 'proofRequest':
        return _withAccount(proofRequest);
      case 'kitMake':
        return _withAccount((c) async {
          final kit = await makeKitFor(c);
          _kit = kit;
          return {'kitId': kit.kitId, 'pieces': kit.pieces};
        });
      case 'kitCancel':
        _kit = null;
        return Future.value(const <String, Object?>{});
      case 'kitKeep':
        return _withAccount((c) async {
          final kit = _kit;
          if (kit == null) throw const CoreFailure(CoreFailure.invalid, 'no kit was made');
          final kept = await keepKit(c, kit, typed: _text(a, 'piece'), proof: _optional(a, 'proof'));
          _kit = null;
          return {'kit': kept};
        });
      case 'kitRemove':
        return _withAccount((c) => removeKit(c, _text(a, 'proof')));
      // Second steps
      case 'twoStep':
        return _withAccount(twoStepList);
      case 'totpBegin':
        return _withAccount(totpBegin);
      case 'totpConfirm':
        return _withAccount((c) => totpConfirm(c, _text(a, 'code'), _optional(a, 'proof')));
      case 'emailBegin':
        return _withAccount((c) => emailBegin(c, _text(a, 'address')));
      case 'emailConfirm':
        return _withAccount((c) => emailConfirm(c, _text(a, 'address'), _text(a, 'code'), _optional(a, 'proof')));
      case 'emailOff':
        return _withAccount((c) => emailOff(c, _text(a, 'proof')));
      case 'recoveryCode':
        return _withAccount((c) => recoveryCode(c, _optional(a, 'proof')));
    }
    throw CoreFailure(CoreFailure.invalid, 'no such op: $op');
  }
}
