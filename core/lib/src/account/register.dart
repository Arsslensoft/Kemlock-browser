// Making an account (docs/crypto.md, "Master key", "The root key" and the web vault's `registerAccount`): the master key from the
// password, OPAQUE's registration in two requests, a new root key wrapped under the password, and the account's key pairs, bundle and
// sealed private keys, all sent by `POST /kem/v1/accounts/register/finish`. The password goes nowhere but into the key derivation.
import 'dart:typed_data';

import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/crypto/account/argon2id.dart';
import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/crypto/account/keys.dart';
import 'package:kemlock_core/crypto/account/kx1.dart';
import 'package:kemlock_core/crypto/account/password_wrap.dart';
import 'package:kemlock_core/crypto/account/private_keys.dart';
import 'package:kemlock_core/crypto/account/sig1.dart';
import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_signin.dart';

/// What the server answers a finished registration with.
typedef Registered = ({String userId, bool admin});

/// A bundle, its signature and the sealed private keys of a new account, as the registration sends them.
Future<Map<String, Object?>> newAccountKeys(String accountId, Uint8List root, int keyVersion) async {
  final kx1 = await Kx1.generate();
  final sig1 = await Sig1.generate();
  final bundle = KeyBundle(
    accountId: uuidBytes(accountId),
    keyVersion: keyVersion,
    kx1PublicKey: kx1.publicKey,
    sig1PublicKey: sig1.publicKey,
  );
  final keys = AccountKeys.fromRoot(root);
  try {
    return {
      'publicBundle': b64urlEncode(bundle.bytes),
      'bundleSignature': b64urlEncode(await signBundle(bundle, sig1.privateKey)),
      'sealedPrivateKeys': b64urlEncode(
        await sealPrivateKeys(
          privateKeysKey: keys.privateKeysKey,
          accountId: uuidBytes(accountId),
          keyVersion: keyVersion,
          kx1PrivateKey: kx1.privateKey,
          sig1PrivateKey: sig1.privateKey,
        ),
      ),
    };
  } finally {
    keys.dispose();
    wipe(kx1.privateKey);
    wipe(sig1.privateKey);
  }
}

/// Whether the server's config says sign-ups are open, from the raw `GET /config` answer (the engine's [KmConfig] leaves it out).
/// A server that doesn't say is taken as open: its registration answers 403 when it isn't.
Future<bool> signupsOpen(KmApi api, Uri server) async {
  final config = await api.call('GET', server, '/config', proof: false);
  return config?['signupsAllowed'] != false;
}

/// Registers an account on [server]. [inviteToken] is the token of an invitation link, which lets an invited address register while
/// sign-ups are closed. Throws the server's [KmError]: 403 for closed sign-ups, 409 for an address that has an account.
Future<Registered> registerAccount({
  required KmApi api,
  required Uri server,
  required String email,
  required String name,
  required String password,
  String? inviteToken,
  KmOpaque? opaque,
  Argon2idRunner argon2 = isolateArgon2id,
  String Function()? newId,
}) async {
  final userId = (newId ?? newUuid)();
  final protocol = opaque ?? OpaqueKmOpaque();
  const settings = Argon2idSettings();
  final salt = randomBytes(Argon2idSettings.saltLength);
  final masterKey = await deriveMasterKey(password, salt, settings: settings, runner: argon2);
  Uint8List? exportKey;
  Uint8List? root;
  try {
    final first = protocol.registerStart(masterKey);
    final started = await api.call(
      'POST',
      server,
      '/accounts/register/start',
      body: {'email': email, 'request': b64urlEncode(first.request), 'inviteToken': ?inviteToken},
      proof: false,
    );
    final response = started?['response'];
    if (response is! String) throw const KmError(KmProblem.server, message: 'a registration answer');
    final second = protocol.registerFinish(first.state, b64urlDecode(response));
    exportKey = second.exportKey;
    root = newRootKey();
    final wrapped = await wrapRootWithPassword(
      masterKey: masterKey,
      exportKey: exportKey,
      accountId: uuidBytes(userId),
      keyVersion: 1,
      rootKey: root,
    );
    final done = await api.call(
      'POST',
      server,
      '/accounts/register/finish',
      body: {
        'userId': userId,
        'email': email,
        if (name.isNotEmpty) 'name': name,
        'upload': b64urlEncode(second.upload),
        'kdf': {
          'memoryKib': settings.memoryKiB,
          'iterations': settings.iterations,
          'parallelism': settings.parallelism,
          'salt': b64urlEncode(salt),
        },
        ...await newAccountKeys(userId, root, 1),
        'wrappedRootKey': b64urlEncode(wrapped),
        'inviteToken': ?inviteToken,
      },
      proof: false,
    );
    return (userId: (done?['userId'] as String?) ?? userId, admin: done?['admin'] == true);
  } finally {
    wipe(masterKey);
    if (exportKey != null) wipe(exportKey);
    if (root != null) wipe(root);
  }
}
