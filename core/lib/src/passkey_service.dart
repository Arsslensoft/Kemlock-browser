// The passkeys of the vault, and the extension as a passkey provider (docs/plans/add-passkeys.md): what the popup lists, the
// relying-party check, and making and signing a passkey. The bytes, the key and the checks are Kemlock-core's
// (features/passkeys/passkey_provider.dart), which the phone's providers are held to; this only reads and writes the vault.
import 'dart:typed_data';

import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/features/passkeys/passkey_provider.dart';
import 'package:kemlock_core/models/passkey.dart';

import 'failure.dart';
import 'vault_service.dart';

/// The codes a request the core can't answer is told in: the DOM exception the background answers the page with.
abstract final class PasskeyFailures {
  static const security = 'passkeySecurity';
  static const notSupported = 'passkeyNotSupported';
  static const invalidState = 'passkeyInvalidState';
  static const encoding = 'passkeyEncoding';
  static const notAllowed = 'passkeyNotAllowed';
}

/// A request error as the failure the TypeScript side reads.
CoreFailure passkeyFailure(PasskeyRequestError error) => CoreFailure(switch (error.failure) {
  PasskeyFailure.security => PasskeyFailures.security,
  PasskeyFailure.notSupported => PasskeyFailures.notSupported,
  PasskeyFailure.invalidState => PasskeyFailures.invalidState,
  PasskeyFailure.encoding => PasskeyFailures.encoding,
  PasskeyFailure.notAllowed => PasskeyFailures.notAllowed,
}, error.detail);

/// [passkey] as a `PasskeyView` (src/shared/api.ts): what the popup lists, never the key.
Map<String, Object?> passkeyView(Passkey passkey, {required int order}) => {
  'id': passkey.id,
  'credentialId': passkey.credentialId,
  'rpId': passkey.rpId,
  'rpName': ?passkey.rpName,
  'userName': passkey.userName,
  'userDisplayName': ?passkey.userDisplayName,
  'label': ?passkey.label,
  'tags': passkey.tags ?? const <String>[],
  'name': passkey.displayName,
  'createdAt': passkey.addedAt,
  'changedAt': passkey.changedAt,
  'order': order,
};

/// Whether a page at [host] is the site of a passkey for [rpId]: the host is the relying party, or under it.
bool passkeyOnHost(String rpId, String host) => host == rpId || host.endsWith('.$rpId');

class PasskeyService {
  PasskeyService(this.vault);

  final VaultService vault;

  Passkey _passkey(String id) {
    for (final passkey in vault.lists.passkeys) {
      if (passkey.id == id) return passkey;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such passkey');
  }

  List<Map<String, Object?>> list() {
    vault.requireSession();
    return [for (final (i, passkey) in vault.lists.passkeys.indexed) passkeyView(passkey, order: i)];
  }

  Future<void> delete(String id) async {
    vault.requireSession();
    final held = _passkey(id);
    // A passkey of a space is changed only where the verified chain lets this account edit it (docs/plans/add-spaces.md)
    vault.editGuard?.call(held.spaceId, held.id);
    // The links to the passkey go in the same write, worked out from the lists the write holds
    await vault.saveChanged((lists) {
      final removed = lists.passkeys.where((passkey) => passkey.id == id).firstOrNull;
      return removed == null ? lists : vault.withoutEntry(lists, removed);
    });
  }

  /// The relying party id a request from [origin] may use (see `checkPasskeyRp`); needs no open vault, only the Public Suffix List.
  String checkRp(String origin, String? rpId) {
    try {
      return checkPasskeyRp(origin: origin, rpId: rpId, suffixes: vault.matcher.suffixes);
    } on PasskeyRequestError catch (error) {
      throw passkeyFailure(error);
    }
  }

  /// The passkeys that answer a sign-in at [rpId]: exactly that relying party's, and only the credentials in [allowed] (base64url)
  /// when it names any.
  List<Map<String, Object?>> find(String rpId, List<String> allowed) {
    vault.requireSession();
    final ids = <Uint8List>[];
    for (final id in allowed) {
      try {
        ids.add(unb64url(id));
      } on FormatException {
        continue;
      }
    }
    final wanted = matchingPasskeys(rpId, ids, vault.lists.passkeys).map((passkey) => passkey.id).toSet();
    return [
      for (final (i, passkey) in vault.lists.passkeys.indexed)
        if (wanted.contains(passkey.id)) passkeyView(passkey, order: i),
    ];
  }

  /// Makes a passkey for [options] (`PublicKeyCredentialCreationOptionsJSON`) from [origin], keeps it in the vault, and answers
  /// `{passkeyId, response}`: the `RegistrationResponseJSON` the page gets.
  Future<Map<String, Object?>> create(Map<String, Object?> options, String origin, String? topOrigin) async {
    vault.requireSession();
    final CreatedPasskey created;
    try {
      final request = CreationRequest.parse(options);
      final rpId = checkRp(origin, request.rpId);
      created = createPasskey(
        request: request,
        rpId: rpId,
        origin: origin,
        topOrigin: topOrigin,
        now: vault.nowMs,
        held: vault.lists.passkeys,
      );
    } on PasskeyRequestError catch (error) {
      throw passkeyFailure(error);
    }
    await vault.updatePasskeys((held) => [...held, created.passkey]);
    return {'passkeyId': created.passkey.id, 'response': created.response};
  }

  /// Signs [challenge] (base64url) with the passkey [id] for [origin], after checking that the passkey's relying party is one the
  /// origin may use, and answers the `AuthenticationResponseJSON`.
  Future<Map<String, Object?>> sign(String id, String challenge, String origin, String? topOrigin) async {
    vault.requireSession();
    final passkey = _passkey(id);
    if (checkRp(origin, passkey.rpId) != passkey.rpId) {
      throw const CoreFailure(PasskeyFailures.security, 'the passkey is for another site');
    }
    final Uint8List bytes;
    try {
      bytes = unb64url(challenge);
    } on FormatException {
      throw const CoreFailure(PasskeyFailures.encoding, 'the challenge is not base64url');
    }
    if (bytes.isEmpty) throw const CoreFailure(PasskeyFailures.encoding, 'no challenge');
    return assertPasskey(passkey: passkey, challenge: bytes, origin: origin, topOrigin: topOrigin);
  }
}
