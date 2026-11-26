// The app's PGP tools for the browser (docs/plans/add-keys.md): encrypt, decrypt, sign and verify OpenPGP text and files with the
// vault's keys and contacts, and SSH signatures (`ssh-keygen -Y`) with the vault's SSH keys, including a git commit or tag's.
// The message code is Kemlock-core's `crypto/keys/pgp.dart`, called as the app's PGP job calls it, but here, in the
// background: there are no isolates. A passphrase is used for the call and never kept, and a private key never leaves.
import 'dart:convert';
import 'dart:typed_data';

import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/crypto/keys/git_signature.dart';
import 'package:kemlock_core/crypto/keys/keys.dart' as crypto;
import 'package:kemlock_core/crypto/keys/pgp.dart' as pgp;
import 'package:kemlock_core/crypto/keys/pkcs8.dart' show readPkcs8;
import 'package:kemlock_core/crypto/keys/sshsig.dart';
import 'package:kemlock_core/models/contact.dart';
import 'package:kemlock_core/models/vault_key.dart';

import 'failure.dart';
import 'keys_args.dart';
import 'keys_views.dart';
import 'vault_service.dart';

class PgpService {
  PgpService(this.vault);

  final VaultService vault;

  DateTime get _now => DateTime.fromMillisecondsSinceEpoch(vault.nowMs, isUtc: true);

  Future<Object?> call(String method, List<Object?> args) async {
    switch (method) {
      case 'pgpEncrypt':
        return encrypt(argObject(args, 0));
      case 'pgpDecrypt':
        return decrypt(argObject(args, 0));
      case 'pgpSign':
        return sign(argObject(args, 0));
      case 'pgpVerify':
        return verify(argObject(args, 0));
      case 'sshSign':
        return sshSign(argObject(args, 0));
      case 'sshVerify':
        return sshVerify(argObject(args, 0));
    }
    throw CoreFailure(CoreFailure.invalid, 'no such method: $method');
  }

  /// Runs [body], turning what the message and key code throw into the words the pages know.
  Future<T> _guard<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on pgp.PgpException catch (error) {
      throw pgpFailure(error);
    } on crypto.KeyFormatException catch (error) {
      throw keyFailure(error);
    }
  }

  // ─── What the tools take from the vault ───────────────────────────────

  VaultKey _key(String id) {
    for (final key in vault.lists.keys) {
      if (key.id == id) return key;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such key');
  }

  VaultKey _pgpKey(String id, {bool secret = false}) {
    final key = _key(id);
    if (key.kind != KeyKind.pgp) throw const CoreFailure(CoreFailure.invalid, 'not a PGP key');
    if (secret && key.isOnCard) throw const CoreFailure('pgpNoSecretHere', 'the key is on a security key');
    return key;
  }

  Contact _contact(String id) {
    for (final contact in vault.lists.contacts) {
      if (contact.id == id) return contact;
    }
    throw const CoreFailure(CoreFailure.notFound, 'no such contact');
  }

  /// The binary transferable public keys that check a signature: the contacts' and the vault's own PGP keys'.
  List<Uint8List> _verifiers() => [
    for (final contact in vault.lists.contacts)
      if (contact.hasKey) unb64(contact.publicKey),
    for (final key in vault.lists.keys)
      if (key.kind == KeyKind.pgp && key.publicKey != null) unb64(key.publicKey!),
  ];

  /// [contact] when it has a key; a person kept without one can't be written to.
  Contact _keyOf(Contact contact) {
    if (!contact.hasKey) throw const CoreFailure(CoreFailure.invalid, 'the contact has no key');
    return contact;
  }

  /// Who each primary fingerprint (upper-case hexadecimal) is: a contact, or one of the vault's own keys.
  Map<String, Map<String, Object?>> _people() {
    final now = _now;
    final people = <String, Map<String, Object?>>{};
    for (final contact in vault.lists.contacts) {
      final standing = contactStandingOf(contact, now);
      final info = standing.info;
      if (info == null) continue;
      people[info.primary.fingerprintHex] = {
        'kind': 'contact',
        'id': contact.id,
        'name': contactView(contact, now)['name'],
        'checked': standing.checked,
      };
    }
    for (final key in vault.lists.keys) {
      if (key.kind != KeyKind.pgp) continue;
      final info = factsOf(key).info;
      if (info != null) people[info.primary.fingerprintHex] = {'kind': 'key', 'id': key.id, 'name': key.name, 'checked': true};
    }
    return people;
  }

  Map<String, Object?> _signatureView(pgp.SignatureResult result, Map<String, Map<String, Object?>> people) {
    final fingerprint = result.signerFingerprint;
    return {
      'verdict': result.verdict.name,
      'issuer': ?result.issuer,
      'signer': ?(fingerprint == null ? null : people[fingerprint]),
      'made': ?result.made?.millisecondsSinceEpoch,
      'keyExpired': result.keyExpired,
      'keyExpiredSince': result.keyExpiredSince,
      'keyRevoked': result.keyRevoked,
      'detail': ?result.detail,
    };
  }

  /// The data of a call: text as UTF-8, or a file's bytes. Text is held to the 1 MB the app takes of it.
  Uint8List _data(Map<String, Object?> args, {String text = 'text', String base64 = 'base64'}) {
    final typed = fieldString(args, text);
    if (typed != null) {
      final bytes = Uint8List.fromList(utf8.encode(typed));
      if (bytes.length > pgp.maxPgpTextLength) throw const CoreFailure('pgpTextTooLarge', 'over 1 MB of text');
      return bytes;
    }
    return decodeFile(needString(args, base64));
  }

  String? _passphrase(Map<String, Object?> args, [String name = 'passphrase']) {
    final value = fieldString(args, name);
    return value == null || value.isEmpty ? null : value;
  }

  // ─── OpenPGP ──────────────────────────────────────────────────────────

  /// Encrypts the text or file in [args] to the contacts in `contactIds` and the vault's own keys in `keyIds`, or, with neither,
  /// to the `passphrase`; signed with the vault's key `signWith` (and `signPassphrase`) when given. A text comes back armored in
  /// `text`; a file as the binary message in `base64`.
  Future<Map<String, Object?>> encrypt(Map<String, Object?> args) => _guard(() async {
    vault.requireSession();
    final recipients = [
      for (final id in fieldStrings(args, 'contactIds')) unb64(_keyOf(_contact(id)).publicKey),
      for (final id in fieldStrings(args, 'keyIds')) _publicOf(_pgpKey(id)),
    ];
    final passphrase = _passphrase(args);
    if (recipients.isEmpty && passphrase == null) throw const CoreFailure(CoreFailure.invalid, 'no recipient and no passphrase');
    final signWith = fieldString(args, 'signWith');
    final signer = signWith == null
        ? null
        : pgp.PgpSecretKey(unb64(_pgpKey(signWith, secret: true).privateKey), passphrase: _passphrase(args, 'signPassphrase'));
    final isText = args['text'] is String;
    final out = await pgp.encrypt(
      data: pgp.PgpData.bytes(_data(args)),
      recipients: recipients,
      passphrase: recipients.isEmpty ? passphrase : null,
      signer: signer,
      text: isText,
      fileName: isText ? '' : fieldString(args, 'fileName') ?? '',
      now: _now,
    );
    if (out == null) throw const CoreFailure(CoreFailure.failed, 'no message was made');
    return isText ? {'text': latin1.decode(out)} : {'base64': b64(out)};
  });

  Uint8List _publicOf(VaultKey key) => unb64(key.publicKey ?? key.privateKey);

  /// Opens the message in [args] (`text` or `base64`) with the vault's own PGP keys, or its `passphrase`; a key that keeps its own
  /// passphrase is opened with the same one. A signed message's signatures are checked against the contacts and the own keys.
  Future<Map<String, Object?>> decrypt(Map<String, Object?> args) => _guard(() async {
    vault.requireSession();
    final passphrase = _passphrase(args);
    final keys = [
      for (final key in vault.lists.keys)
        if (key.kind == KeyKind.pgp && !key.isOnCard) pgp.PgpSecretKey(unb64(key.privateKey), passphrase: passphrase),
    ];
    final result = await pgp.decrypt(
      data: pgp.PgpData.bytes(_data(args)),
      keys: keys,
      passphrase: passphrase,
      verifiers: _verifiers(),
      inputName: fieldString(args, 'fileName'),
      maxInMemory: maxFileBytes,
      now: _now,
    );
    final people = _people();
    final bytes = result.bytes ?? Uint8List(0);
    final opened = result.openedWithFingerprint;
    return {
      'isText': result.isText,
      'encrypted': result.encrypted,
      'length': result.length,
      'fileName': result.fileName,
      if (result.isText) 'text': utf8.decode(bytes, allowMalformed: true) else 'base64': b64(bytes),
      'openedWith': ?(opened == null ? null : people[opened]),
      'openedWithPassphrase': result.openedWithPassphrase,
      'cipher': ?result.cipher,
      'signatures': [for (final signature in result.signatures) _signatureView(signature, people)],
    };
  });

  /// Signs the text (clear-signed) or file in [args] with the vault's key `keyId`, opened with `passphrase` when it keeps one.
  /// `form` is `cleartext` (text), `detachedArmored` (a signature as text) or `detached` (binary, in `base64`).
  Future<Map<String, Object?>> sign(Map<String, Object?> args) => _guard(() async {
    vault.requireSession();
    final key = _pgpKey(needString(args, 'keyId'), secret: true);
    final form = switch (fieldString(args, 'form')) {
      'detached' => pgp.PgpSignatureForm.detached,
      'detachedArmored' => pgp.PgpSignatureForm.detachedArmored,
      _ => pgp.PgpSignatureForm.cleartext,
    };
    if (form == pgp.PgpSignatureForm.cleartext && args['text'] is! String) {
      throw const CoreFailure(CoreFailure.invalid, 'only a text is clear-signed');
    }
    final out = await pgp.sign(
      data: pgp.PgpData.bytes(_data(args)),
      signer: pgp.PgpSecretKey(unb64(key.privateKey), passphrase: _passphrase(args)),
      form: form,
      now: _now,
    );
    return form == pgp.PgpSignatureForm.detached ? {'base64': b64(out)} : {'text': utf8.decode(out, allowMalformed: true)};
  });

  /// Checks the clear-signed text, signed message or file in [args] against the contacts and the vault's own keys; with a
  /// `signature` (text) or `signatureBase64` it is that detached signature of the data. Each signature says who made it.
  Future<Map<String, Object?>> verify(Map<String, Object?> args) => _guard(() async {
    vault.requireSession();
    final detached = hasInput(args, text: 'signature', base64: 'signatureBase64')
        ? _data(args, text: 'signature', base64: 'signatureBase64')
        : null;
    final data = _data(args);
    final result = detached == null
        ? await pgp.verify(signed: pgp.PgpData.bytes(data), verifiers: _verifiers(), maxInMemory: maxFileBytes, now: _now)
        : await pgp.verify(signed: pgp.PgpData.bytes(detached), data: pgp.PgpData.bytes(data), verifiers: _verifiers(), now: _now);
    final people = _people();
    final content = result.content;
    return {
      'isText': result.isText,
      if (content != null && result.isText) 'text': utf8.decode(content, allowMalformed: true),
      if (content != null && !result.isText) 'base64': b64(content),
      'signatures': [for (final signature in result.signatures) _signatureView(signature, people)],
    };
  });

  // ─── SSH signatures ───────────────────────────────────────────────────

  /// Signs the text or file in [args] with the vault's SSH key `keyId` for `namespace` (`file`, `git` or one of the person's):
  /// the armored block `ssh-keygen -Y sign` writes.
  Future<Map<String, Object?>> sshSign(Map<String, Object?> args) async {
    vault.requireSession();
    final key = _key(needString(args, 'keyId'));
    if (key.kind != KeyKind.ssh) throw const CoreFailure(CoreFailure.invalid, 'not an SSH key');
    final namespace = needString(args, 'namespace');
    if (!isSshsigNamespace(namespace)) throw const CoreFailure(CoreFailure.invalid, 'namespace');
    try {
      return {'text': await sshsigSign(await readPkcs8(unb64(key.privateKey)), namespace, _data(args))};
    } on crypto.KeyFormatException catch (error) {
      throw keyFailure(error);
    } on ArgumentError {
      throw const CoreFailure(CoreFailure.invalid, 'this key cannot sign');
    }
  }

  /// Checks an SSH signature: the armored block in `signature` over the text or file, for `namespace`; or, with `git`, the
  /// signature inside a pasted git commit or tag. `signer` (an `authorized_keys` line) is the key it must be made by; without
  /// one the answer says whether the signer is one of the vault's SSH keys.
  Future<Map<String, Object?>> sshVerify(Map<String, Object?> args) async {
    vault.requireSession();
    final given = fieldString(args, 'signer');
    Uint8List? expected;
    if (given != null && given.trim().isNotEmpty) {
      try {
        expected = readSshPublicLine(given);
      } on crypto.KeyFormatException {
        throw const CoreFailure('sshBadSigner');
      }
    }
    final SshSignature signature;
    final SshsigResult result;
    try {
      if (fieldBool(args, 'git')) {
        final found = await verifyGitSignature(_data(args));
        switch (found.kind) {
          case GitSignatureKind.ssh:
            signature = found.signature!;
            result = found.result!;
          case GitSignatureKind.pgp:
            throw const CoreFailure('sshGitPgp');
          case GitSignatureKind.other:
            throw const CoreFailure('sshNotSsh');
          case GitSignatureKind.unsigned:
            throw const CoreFailure('sshGitUnsigned');
        }
      } else {
        final namespace = needString(args, 'namespace');
        if (!isSshsigNamespace(namespace)) throw const CoreFailure(CoreFailure.invalid, 'namespace');
        signature = readSshsig(needString(args, 'signature'));
        result = await sshsigVerify(signature, namespace, _data(args));
      }
    } on NotAGitObjectException {
      throw const CoreFailure('sshNotGit');
    } on SshsigFormatException catch (error) {
      throw CoreFailure(error.problem == SshsigProblem.damaged ? 'sshDamaged' : 'sshNotSsh');
    }
    Map<String, Object?>? own;
    for (final key in vault.lists.keys) {
      if (key.kind != KeyKind.ssh || key.publicKey == null) continue;
      try {
        if (crypto.sshFingerprintOfSpki(unb64(key.publicKey!)) == signature.fingerprint) {
          own = {'id': key.id, 'name': key.name};
          break;
        }
      } on crypto.KeyFormatException {
        continue;
      } on FormatException {
        continue;
      }
    }
    return {
      'verdict': result.verdict.name,
      'detail': ?result.detail,
      'keyType': signature.keyType,
      'fingerprint': signature.fingerprint,
      'namespace': signature.namespace,
      'matches': expected == null ? null : _same(expected, signature.publicKeyBlob),
      'own': own,
    };
  }

  bool _same(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
