// The account's own calls over a fake server: devices and their approvals, emergency access, the Recovery Kit, second steps and
// registration. The server is a `MockClient` that answers the routes of crates/kemlock-api-kem; the crypto is the engine's own, so a
// box sealed here must open with the other side's key, and what registration sends must open as an account.
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hash;
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/core/ids.dart';
import 'package:kemlock_core/crypto/account/argon2id.dart';
import 'package:kemlock_core/crypto/account/bundle.dart';
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/crypto/account/keys.dart';
import 'package:kemlock_core/crypto/account/kx1.dart';
import 'package:kemlock_core/crypto/account/password_wrap.dart';
import 'package:kemlock_core/crypto/account/sealed_box.dart';
import 'package:kemlock_core/crypto/account/sig1.dart';
import 'package:kemlock_core/features/sync/kemlock/km_account.dart';
import 'package:kemlock_core/features/sync/kemlock/km_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_approvals.dart';
import 'package:kemlock_core/features/sync/kemlock/km_auth_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_phrase.dart';
import 'package:kemlock_core/features/sync/kemlock/km_session.dart';
import 'package:kemlock_core/features/sync/kemlock/km_signin.dart';
import 'package:kemlock_extension_core/src/account/account_context.dart';
import 'package:kemlock_extension_core/src/account/devices.dart';
import 'package:kemlock_extension_core/src/account/emergency.dart';
import 'package:kemlock_extension_core/src/account/kit.dart';
import 'package:kemlock_extension_core/src/account/kit_pieces.dart';
import 'package:kemlock_extension_core/src/account/kit_service.dart';
import 'package:kemlock_extension_core/src/account/register.dart';
import 'package:kemlock_extension_core/src/account/two_step.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/platform.dart' show CoreData;
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

final _server = Uri.parse('https://km.example');

http.Response _json(Object? body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

Matcher _failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

Future<KmAccount> _account() async {
  final kx1 = await Kx1.generate();
  final sig1 = await Sig1.generate();
  return KmAccount(
    accountId: newUuid(),
    keyVersion: 1,
    rootKey: newRootKey(),
    kx1PrivateKey: kx1.privateKey,
    sig1PrivateKey: sig1.privateKey,
    kx1PublicKey: kx1.publicKey,
    sig1PublicKey: sig1.publicKey,
  );
}

AccountContext _context(KmAccount account, http.Client client, {List<String>? words}) {
  final later = DateTime.now().add(const Duration(days: 1)).millisecondsSinceEpoch;
  final session = KmSession(
    userId: account.accountId,
    deviceId: newUuid(),
    tokens: KmTokens(access: 'access', refresh: 'refresh', accessExpiresAt: later, refreshExpiresAt: later),
  );
  final connection = KmConnection(api: KmApi(client), server: _server, session: session, save: (_) async {});
  return AccountContext(connection: connection, account: account, words: words);
}

/// A client that answers by `METHOD path` and remembers the bodies it was sent.
class _Server {
  final routes = <String, http.Response Function(http.Request request)>{};
  final bodies = <String, Object?>{};

  late final client = MockClient((request) async {
    final key = '${request.method} ${request.url.path}';
    if (request.body.isNotEmpty) bodies[key] = jsonDecode(request.body);
    final route = routes[key];
    return route == null ? http.Response('{"title":"not found"}', 404, headers: {'content-type': 'application/json'}) : route(request);
  });

  Object? sent(String key) => bodies[key];
}

void main() {
  group('the Recovery Kit', () {
    test('opens the root key with any two pieces of its three, and no fewer', () async {
      final account = await _account();
      final kit = await makeRecoveryKit(rootKey: account.rootKey, accountId: uuidBytes(account.accountId), keyVersion: 1);
      expect(kit.pieces, hasLength(3));
      expect(kit.wrappedKey, hasLength(kitWrappedLength));
      expect(kit.kitId, matches(RegExp(r'^[A-Z2-7]{8}$')));
      for (final pair in const [
        [0, 1],
        [0, 2],
        [1, 2],
      ]) {
        final root = await openKitRoot(
          pieces: [kit.pieces[pair[0]], kit.pieces[pair[1]]],
          kitId: kit.kitId,
          accountId: uuidBytes(account.accountId),
          keyVersion: 1,
          wrapped: kit.wrappedKey,
        );
        expect(root, account.rootKey);
      }
      await expectLater(
        openKitRoot(
          pieces: [kit.pieces[0]],
          kitId: kit.kitId,
          accountId: uuidBytes(account.accountId),
          keyVersion: 1,
          wrapped: kit.wrappedKey,
        ),
        throwsA(isA<PieceError>().having((e) => e.problem, 'problem', PieceProblem.notEnough)),
      );
    });

    test('writes pieces as the app does, and reads them in any case and spacing', () async {
      final account = await _account();
      final kit = await makeRecoveryKit(rootKey: account.rootKey, accountId: uuidBytes(account.accountId), keyVersion: 1);
      final piece = kit.pieces.first;
      expect(piece, matches(RegExp(r'^BMCKIT1-[A-Z2-7]{8}-231-[A-Z2-7]{52}-[A-Z2-7]{4}$')));
      expect(readPiece(displayPiece(piece).toLowerCase()).kitId, kit.kitId);
      expect(readPiece(piece).index, 1);
    });

    test('refuses a typo, another kit, a repeat and a root of another account or key version', () async {
      final account = await _account();
      final other = await _account();
      final kit = await makeRecoveryKit(rootKey: account.rootKey, accountId: uuidBytes(account.accountId), keyVersion: 1);
      final elsewhere = await makeRecoveryKit(rootKey: other.rootKey, accountId: uuidBytes(other.accountId), keyVersion: 1);
      final piece = kit.pieces.first;
      final typo = '${piece.substring(0, piece.length - 1)}${piece.endsWith('A') ? 'B' : 'A'}';
      expect(readPiece(typo).problem, PieceProblem.checksum);
      expect(readPiece('nonsense').problem, PieceProblem.format);
      expect(checkPieces([kit.pieces[0], elsewhere.pieces[1]]), PieceProblem.otherKit);
      expect(checkPieces([kit.pieces[0], kit.pieces[0]]), PieceProblem.duplicate);
      expect(checkPieces([kit.pieces[0], kit.pieces[1]]), isNull);
      // The wrap is bound to the account and the key version
      for (final (accountId, version) in [(uuidBytes(other.accountId), 1), (uuidBytes(account.accountId), 2)]) {
        await expectLater(
          openKitRoot(
            pieces: [kit.pieces[0], kit.pieces[1]],
            kitId: kit.kitId,
            accountId: accountId,
            keyVersion: version,
            wrapped: kit.wrappedKey,
          ),
          throwsA(isA<CorruptedException>()),
        );
      }
    });

    test('is kept on the server only once a piece is typed back, and replaced only with a proof', () async {
      final account = await _account();
      final server = _Server();
      server.routes['GET /kem/v1/account/recovery-kit'] = (_) => http.Response('{}', 404, headers: {'content-type': 'application/json'});
      server.routes['POST /kem/v1/account/recovery-kit'] = (_) => _json({});
      final c = _context(account, server.client);
      expect(await kitRecord(c), isNull);
      final kit = await makeKitFor(c);
      await expectLater(keepKit(c, kit, typed: 'BMCKIT1-NOPE'), _failure('pieceMismatch'));
      expect(server.sent('POST /kem/v1/account/recovery-kit'), isNull);
      await keepKit(c, kit, typed: displayPiece(kit.pieces[1]).toLowerCase());
      final body = server.sent('POST /kem/v1/account/recovery-kit')! as Map<String, Object?>;
      expect(body['kitId'], kit.kitId);
      expect(body['keyVersion'], 1);
      // What the server holds opens with two pieces
      final root = await openKitRoot(
        pieces: [kit.pieces[2], kit.pieces[0]],
        kitId: kit.kitId,
        accountId: uuidBytes(account.accountId),
        keyVersion: 1,
        wrapped: b64urlDecode(body['wrappedKey']! as String),
      );
      expect(root, account.rootKey);

      // A kit that exists is replaced behind a proof
      server.routes['GET /kem/v1/account/recovery-kit'] = (_) => _json({
        'kitId': kit.kitId,
        'threshold': 2,
        'shares': 3,
        'keyVersion': 1,
        'createdAt': '2026-11-24T00:00:00Z',
        'current': true,
        'wrappedKey': body['wrappedKey'],
      });
      server.routes['PUT /kem/v1/account/recovery-kit'] = (_) => _json({});
      server.routes['DELETE /kem/v1/account/recovery-kit'] = (_) => http.Response('', 204);
      final next = await makeKitFor(c);
      await expectLater(keepKit(c, next, typed: next.pieces.first), _failure('proofNeeded'));
      final record = (await kitRecord(c))!;
      // The wrap stays on the server: the page gets the record only
      expect(record.containsKey('wrappedKey'), isFalse);
      expect(record['current'], isTrue);
      await keepKit(c, next, typed: next.pieces.first, proof: ' 123456 ');
      expect((server.sent('PUT /kem/v1/account/recovery-kit')! as Map<String, Object?>)['proof'], '123456');
      await expectLater(removeKit(c, ''), _failure('proofNeeded'));
      await removeKit(c, '654321');
      expect(server.sent('DELETE /kem/v1/account/recovery-kit'), {'proof': '654321'});
    });
  });

  group('devices and approvals', () {
    late KmAccount account;
    late List<String> words;

    setUp(() async {
      account = await _account();
      words = List.generate(effWordCount, (i) => 'word$i');
    });

    Map<String, Object?> request(String id, Uint8List key, String phrase) => {
      'id': id,
      'deviceName': 'Kemlock · Firefox',
      'deviceKind': 'kemlock-browser',
      'ip': '203.0.113.0',
      'phrase': phrase,
      'createdAt': DateTime.now().subtract(const Duration(seconds: 3)).toUtc().toIso8601String(),
      'expiresAt': DateTime.now().add(const Duration(minutes: 10)).toUtc().toIso8601String(),
      'ageSeconds': 3,
      'publicKey': b64urlEncode(key),
    };

    test('shows the words it worked out itself, and seals the root key to the request\'s key when approved', () async {
      final pair = await Kx1.generate();
      final id = newUuid();
      final server = _Server();
      server.routes['GET /kem/v1/devices/approvals'] = (_) => _json({
        'approvals': [request(id, pair.publicKey, approvalPhrase(pair.publicKey, words))],
      });
      server.routes['POST /kem/v1/devices/approvals/$id'] = (_) => _json({});
      final c = _context(account, server.client, words: words);
      final listed = ((await listApprovals(c))! as Map<String, Object?>)['approvals']! as List<Object?>;
      final shown = listed.single! as Map<String, Object?>;
      expect(shown['phrase'], approvalPhrase(pair.publicKey, words).split(' '));
      expect(shown['agrees'], isTrue);
      expect(shown['canApprove'], isTrue);
      await approveDevice(c, id);
      final posted = server.sent('POST /kem/v1/devices/approvals/$id')! as Map<String, Object?>;
      expect(posted['decision'], 'approve');
      final root = await openBox(
        b64urlDecode(posted['sealedKey']! as String),
        pair.privateKey,
        context: SealContext.deviceApproval,
        aad: approvalAad(account.accountId, id),
      );
      expect(root, account.rootKey);
    });

    test('refuses to approve when the server\'s words are not the ones worked out here, and denies without a key', () async {
      final pair = await Kx1.generate();
      final id = newUuid();
      final server = _Server();
      server.routes['GET /kem/v1/devices/approvals'] = (_) => _json({
        'approvals': [request(id, pair.publicKey, 'one two three four five')],
      });
      server.routes['POST /kem/v1/devices/approvals/$id'] = (_) => _json({});
      final c = _context(account, server.client, words: words);
      final shown = (((await listApprovals(c))! as Map<String, Object?>)['approvals']! as List<Object?>).single! as Map<String, Object?>;
      expect(shown['agrees'], isFalse);
      expect(shown['canApprove'], isFalse);
      await expectLater(
        approveDevice(c, id),
        throwsA(isA<KmApprovalError>().having((e) => e.issue, 'issue', KmApprovalIssue.phraseMismatch)),
      );
      expect(server.sent('POST /kem/v1/devices/approvals/$id'), isNull);
      await denyDevice(c, id);
      expect(server.sent('POST /kem/v1/devices/approvals/$id'), {'decision': 'deny'});
    });

    test('needs the word list, and says a request that is gone is gone', () async {
      final server = _Server();
      server.routes['GET /kem/v1/devices/approvals'] = (_) => _json({'approvals': <Object?>[]});
      await expectLater(listApprovals(_context(account, server.client)), _failure(CoreFailure.unavailable));
      await expectLater(approveDevice(_context(account, server.client, words: words), newUuid()), _failure(CoreFailure.notFound));
    });

    test('lists the devices, marks this one, and signs out another but never itself', () async {
      final server = _Server();
      final other = newUuid();
      final c = _context(account, server.client);
      final self = c.connection.session.deviceId;
      server.routes['GET /kem/v1/devices'] = (_) => _json({
        'devices': [
          {
            'id': self,
            'name': 'Kemlock · Chrome',
            'kind': 'kemlock-browser',
            'current': true,
            'trusted': false,
            'lastSeenAt': '2026-11-24T10:00:00Z',
          },
          {
            'id': other,
            'name': 'Pixel',
            'kind': 'kemlock-android',
            'current': false,
            'trusted': true,
            'lastSeenAt': '2026-11-23T10:00:00Z',
          },
        ],
      });
      server.routes['POST /kem/v1/devices/sign-out'] = (_) => http.Response('', 204);
      final devices = (((await listDevices(c))! as Map<String, Object?>)['devices']! as List<Object?>).cast<Map<String, Object?>>();
      expect(devices.map((d) => d['name']), ['Kemlock · Chrome', 'Pixel']);
      expect(devices.map((d) => d['current']), [true, false]);
      expect(devices[1]['trusted'], isTrue);
      expect(devices[1]['lastSeen'], DateTime.utc(2026, 11, 23, 10).millisecondsSinceEpoch);
      await expectLater(signOutDevice(c, self), _failure(CoreFailure.invalid));
      await signOutDevice(c, other);
      expect(server.sent('POST /kem/v1/devices/sign-out'), {'deviceId': other});
    });
  });

  group('emergency access', () {
    late KmAccount grantor;
    late KmAccount grantee;

    setUp(() async {
      grantor = await _account();
      grantee = await _account();
    });

    Future<Map<String, Object?>> view(KmAccount contact, {Uint8List? signedBy, String state = 'accepted'}) async {
      final bundle = KeyBundle(
        accountId: uuidBytes(contact.accountId),
        keyVersion: 1,
        kx1PublicKey: contact.kx1PublicKey,
        sig1PublicKey: contact.sig1PublicKey,
      );
      final signature = await signBundle(bundle, signedBy ?? contact.sig1PrivateKey);
      return {
        'grant': {
          'id': 'g1',
          'grantorId': grantor.accountId,
          'granteeEmail': 'ada@example.com',
          'granteeId': grantee.accountId,
          'kind': 'view',
          'waitDays': 7,
          'state': state,
          'recoveryInitiatedAt': null,
          'dueAt': null,
          'createdAt': '2026-11-24T00:00:00Z',
          'updatedAt': '2026-11-24T00:00:00Z',
        },
        'grantorEmail': null,
        'contactKeys': {'publicBundle': b64urlEncode(bundle.bytes), 'bundleSignature': b64urlEncode(signature), 'keyVersion': 1},
      };
    }

    _Server serverWith(Map<String, Object?> contact) {
      final server = _Server();
      server.routes['GET /kem/v1/emergency'] = (_) => _json({
        'trustedContacts': [contact],
        'grantors': <Object?>[],
      });
      server.routes['POST /kem/v1/emergency/grants/g1/confirm'] = (_) => _json((contact['grant']! as Map<String, Object?>));
      return server;
    }

    test('lists both sides without the contact\'s keys, only whether they were shared', () async {
      final server = serverWith(await view(grantee));
      final overview = (await emergencyOverview(_context(grantor, server.client)))! as Map<String, Object?>;
      final trusted = (overview['trusted']! as List<Object?>).single! as Map<String, Object?>;
      expect(trusted['hasKeys'], isTrue);
      expect(trusted.containsKey('contactKeys'), isFalse);
      expect((trusted['grant']! as Map<String, Object?>)['state'], 'accepted');
    });

    test('seals the root key to the contact\'s kx1 key, bound to their account, after their fingerprint is shown', () async {
      final server = serverWith(await view(grantee));
      final c = _context(grantor, server.client);
      final shown = (await emergencyContact(c, 'g1'))! as Map<String, Object?>;
      final bundle = KeyBundle(
        accountId: uuidBytes(grantee.accountId),
        keyVersion: 1,
        kx1PublicKey: grantee.kx1PublicKey,
        sig1PublicKey: grantee.sig1PublicKey,
      );
      expect(shown['fingerprint'], bundle.fingerprintDigits);
      await emergencyConfirm(c, 'g1', shown['fingerprint']! as String);
      final sealed = (server.sent('POST /kem/v1/emergency/grants/g1/confirm')! as Map<String, Object?>)['sealedKey']! as String;
      final root = await openBox(
        b64urlDecode(sealed),
        grantee.kx1PrivateKey,
        context: SealContext.emergencyAccess,
        aad: uuidBytes(grantee.accountId),
      );
      expect(root, grantor.rootKey);
    });

    test('seals nothing when the fingerprint is not the one that was shown, or the keys are not the contact\'s', () async {
      final server = serverWith(await view(grantee));
      final c = _context(grantor, server.client);
      await expectLater(emergencyConfirm(c, 'g1', '00000 00000'), _failure('changed'));
      expect(server.sent('POST /kem/v1/emergency/grants/g1/confirm'), isNull);

      // Signed by another key than the bundle's own
      final stranger = await Sig1.generate();
      final forged = serverWith(await view(grantee, signedBy: stranger.privateKey));
      await expectLater(emergencyContact(_context(grantor, forged.client), 'g1'), _failure('badBundle'));
      // The bundle of another account than the one the grant names
      final swapped = serverWith(await view(grantor));
      await expectLater(emergencyContact(_context(grantor, swapped.client), 'g1'), _failure('badBundle'));
      // An accepted grant that names no account can't take any keys
      final unnamed = await view(grantee);
      (unnamed['grant']! as Map<String, Object?>)['granteeId'] = null;
      await expectLater(emergencyContact(_context(grantor, serverWith(unnamed).client), 'g1'), _failure('badBundle'));
      // A contact who has not accepted can't be confirmed
      final waiting = serverWith(await view(grantee, state: 'invited'));
      await expectLater(emergencyContact(_context(grantor, waiting.client), 'g1'), _failure(CoreFailure.invalid));
    });

    test('opens the released key with the contact\'s own key, and says so when it does not open', () async {
      final sealed = await sealBox(
        grantee.kx1PublicKey,
        grantor.rootKey,
        context: SealContext.emergencyAccess,
        aad: uuidBytes(grantee.accountId),
      );
      final wrong = await sealBox(
        grantee.kx1PublicKey,
        grantor.rootKey,
        context: SealContext.emergencyAccess,
        aad: uuidBytes(grantor.accountId),
      );
      Future<Object?> release(Uint8List box) {
        final server = _Server();
        server.routes['GET /kem/v1/emergency/grants/g1/key'] = (_) =>
            _json({'grantId': 'g1', 'grantorId': grantor.accountId, 'kind': 'takeover', 'sealedKey': b64urlEncode(box)});
        return emergencyKey(_context(grantee, server.client), 'g1');
      }

      expect(await release(sealed), {'grantorId': grantor.accountId, 'kind': 'takeover', 'opens': true});
      await expectLater(release(wrong), _failure('unreadable'));
    });

    test('names, answers and ends grants through their own routes', () async {
      final server = _Server();
      for (final route in const ['accept', 'initiate', 'approve', 'reject']) {
        server.routes['POST /kem/v1/emergency/grants/g1/$route'] = (_) => _json({'id': 'g1', 'state': route});
      }
      server.routes['POST /kem/v1/emergency/grants'] = (_) => _json({'id': 'g1', 'state': 'invited'}, 201);
      server.routes['DELETE /kem/v1/emergency/grants/g1'] = (_) => http.Response('', 204);
      final c = _context(grantor, server.client);
      await emergencyInvite(c, ' ada@example.com ', 'takeover', 30);
      expect(server.sent('POST /kem/v1/emergency/grants'), {'email': 'ada@example.com', 'kind': 'takeover', 'waitDays': 30});
      await expectLater(emergencyInvite(c, 'a@b.c', 'owner', 7), _failure(CoreFailure.invalid));
      await expectLater(emergencyInvite(c, 'a@b.c', 'view', 91), _failure(CoreFailure.invalid));
      expect(((await emergencyStep(c, 'g1', 'reject'))! as Map<String, Object?>)['state'], 'reject');
      await expectLater(emergencyStep(c, 'g1', 'delete'), _failure(CoreFailure.invalid));
      await emergencyRevoke(c, 'g1');
    });
  });

  group('second steps', () {
    test('are listed with what the account set up, and turned on with the proof beside another', () async {
      final account = await _account();
      final server = _Server();
      server.routes['GET /kem/v1/account/two-step'] = (_) => _json({
        'methods': [
          {'method': 'email', 'enabled': true},
        ],
        'recoveryCodes': true,
      });
      server.routes['GET /kem/v1/account/two-step/setup'] = (_) => _json({'email': 'me@example.com', 'emailOffered': true});
      server.routes['POST /kem/v1/account/two-factor/totp'] = (_) =>
          _json({'secret': 'JBSWY3DPEHPK3PXP', 'uri': 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP'});
      server.routes['POST /kem/v1/account/two-factor/totp/confirm'] = (_) => http.Response('', 204);
      server.routes['POST /kem/v1/account/two-factor/recovery-code'] = (_) => _json({'code': 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'});
      server.routes['DELETE /kem/v1/account/two-factor/email'] = (_) => http.Response('', 204);
      final c = _context(account, server.client);
      expect(await twoStepList(c), {
        'methods': [
          {'method': 'email', 'enabled': true},
        ],
        'recoveryCodes': true,
        'email': 'me@example.com',
        'emailOffered': true,
      });
      expect(await totpBegin(c), {'secret': 'JBSWY3DPEHPK3PXP', 'uri': 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP'});
      await totpConfirm(c, ' 123456 ', null);
      expect(server.sent('POST /kem/v1/account/two-factor/totp/confirm'), {'code': '123456'});
      await totpConfirm(c, '123456', '987654');
      expect(server.sent('POST /kem/v1/account/two-factor/totp/confirm'), {'code': '123456', 'proof': '987654'});
      expect(await recoveryCode(c, null), {'code': 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'});
      expect(server.sent('POST /kem/v1/account/two-factor/recovery-code'), <String, Object?>{});
      await recoveryCode(c, '111111');
      expect(server.sent('POST /kem/v1/account/two-factor/recovery-code'), {'proof': '111111'});
      await expectLater(emailOff(c, ' '), _failure('proofNeeded'));
      await emailOff(c, '222222');
      expect(server.sent('DELETE /kem/v1/account/two-factor/email'), {'proof': '222222'});
    });
  });

  group('registration', () {
    test('sends what opens as an account: the bundle is signed, the keys are sealed, the root is wrapped under the password', () async {
      final server = _Server();
      server.routes['POST /kem/v1/accounts/register/start'] = (_) => _json({'response': b64urlEncode(Uint8List(8))});
      server.routes['POST /kem/v1/accounts/register/finish'] = (request) =>
          _json({'userId': (jsonDecode(request.body) as Map<String, Object?>)['userId'], 'admin': false}, 201);
      final fakeOpaque = _FakeOpaque();
      Future<Uint8List> cheap(Uint8List password, Uint8List salt, Argon2idSettings settings) async =>
          Uint8List.fromList(hash.sha256.convert([...password, ...salt]).bytes);
      final done = await registerAccount(
        api: KmApi(server.client),
        server: _server,
        email: 'sam@example.com',
        name: 'Sam',
        password: 'a long enough password',
        opaque: fakeOpaque,
        argon2: cheap,
      );
      expect(done.admin, isFalse);
      final start = server.sent('POST /kem/v1/accounts/register/start')! as Map<String, Object?>;
      expect(start, {'email': 'sam@example.com', 'request': b64urlEncode(List.filled(32, 7))});
      final finish = server.sent('POST /kem/v1/accounts/register/finish')! as Map<String, Object?>;
      expect(finish['userId'], done.userId);
      expect(finish['name'], 'Sam');
      expect(finish['kdf'], containsPair('memoryKib', 65536));
      expect((finish['kdf']! as Map<String, Object?>)['iterations'], 3);
      expect((finish['kdf']! as Map<String, Object?>)['parallelism'], 4);
      final salt = b64urlDecode((finish['kdf']! as Map<String, Object?>)['salt']! as String);
      expect(salt, hasLength(16));
      // The password opens the root key, and the root key opens the keys the bundle names
      final master = await deriveMasterKey('a long enough password', salt, runner: cheap);
      final root = await unwrapRootWithPassword(
        masterKey: master,
        exportKey: Uint8List.fromList(List.filled(64, 3)),
        accountId: uuidBytes(done.userId),
        keyVersion: 1,
        wrapped: b64urlDecode(finish['wrappedRootKey']! as String),
      );
      final opened = await openKmAccount(
        accountId: done.userId,
        rootKey: root,
        material: KmAccountMaterial(
          keyVersion: 1,
          wrappedRootKey: b64urlDecode(finish['wrappedRootKey']! as String),
          publicBundle: b64urlDecode(finish['publicBundle']! as String),
          bundleSignature: b64urlDecode(finish['bundleSignature']! as String),
          sealedPrivateKeys: b64urlDecode(finish['sealedPrivateKeys']! as String),
        ),
      );
      expect(opened.accountId, done.userId);
      expect(opened.rootKey, root);
      expect(finish.containsKey('inviteToken'), isFalse);
    });

    test('carries an invitation\'s token through both requests, and says whether sign-ups are open', () async {
      final server = _Server();
      server.routes['POST /kem/v1/accounts/register/start'] = (_) => _json({'response': b64urlEncode(Uint8List(8))});
      server.routes['POST /kem/v1/accounts/register/finish'] = (_) => _json({'userId': newUuid(), 'admin': true}, 201);
      server.routes['GET /kem/v1/config'] = (_) => _json({'signupsAllowed': false});
      final api = KmApi(server.client);
      expect(await signupsOpen(api, _server), isFalse);
      server.routes['GET /kem/v1/config'] = (_) => _json({'server': 'kemlock-server'});
      expect(await signupsOpen(api, _server), isTrue);
      final done = await registerAccount(
        api: api,
        server: _server,
        email: 'sam@example.com',
        name: '',
        password: 'pw',
        inviteToken: 'tok',
        opaque: _FakeOpaque(),
        argon2: (password, salt, settings) async => Uint8List(32),
      );
      expect(done.admin, isTrue);
      expect((server.sent('POST /kem/v1/accounts/register/start')! as Map<String, Object?>)['inviteToken'], 'tok');
      final finish = server.sent('POST /kem/v1/accounts/register/finish')! as Map<String, Object?>;
      expect(finish['inviteToken'], 'tok');
      // An empty name is not sent
      expect(finish.containsKey('name'), isFalse);
    });

    test('lets the server\'s refusal through as its own error', () async {
      final server = _Server();
      server.routes['POST /kem/v1/accounts/register/start'] = (_) => _json({'title': 'closed'}, 403);
      await expectLater(
        registerAccount(
          api: KmApi(server.client),
          server: _server,
          email: 'sam@example.com',
          name: '',
          password: 'pw',
          opaque: _FakeOpaque(),
          argon2: (password, salt, settings) async => Uint8List(32),
        ),
        throwsA(isA<KmError>().having((e) => e.status, 'status', 403)),
      );
    });
  });

  group('failures', () {
    test('are told to the pages by their kind, never by their text', () {
      CoreFailure code(Object error) => accountFailure(error) as CoreFailure;
      expect(code(const KmError(KmProblem.server, status: 409)).code, 'conflict');
      expect(code(const KmError(KmProblem.server, status: 404)).code, 'notFound');
      expect(code(const KmError(KmProblem.server, status: 422)).code, 'badRequest');
      expect(code(const KmError(KmProblem.rateLimited, status: 429)).code, 'rateLimited');
      expect(code(const KmError(KmProblem.sessionEnded)).code, 'sessionEnded');
      expect(code(const KmApprovalError(KmApprovalIssue.phraseMismatch)).code, 'phraseMismatch');
      expect(code(const PieceError(PieceProblem.otherKit)).code, 'pieceOtherKit');
      expect(code(const CorruptedException()).code, 'unreadable');
      expect(code(const MalformedException('x')).code, 'unreadable');
      // What it knows nothing of passes through as it is
      final other = StateError('x');
      expect(identical(accountFailure(other), other), isTrue);
    });
  });

  group('the core\'s account call', () {
    test('answers what needs no server, and says why when the vault does not sync with Kemlock Server', () async {
      final core = await startCore(MemoryArea());
      await expectLater(
        core.call('account', [
          <String, Object?>{'op': 'devices'},
        ]),
        _failure(CoreFailure.noVault),
      );
      await core.call('createVault', ['correct horse battery staple']);
      expect(
        await core.call('account', [
          <String, Object?>{'op': 'kitCancel'},
        ]),
        <String, Object?>{},
      );
      final status =
          (await core.call('account', [
                <String, Object?>{'op': 'moveStatus'},
              ]))!
              as Map<String, Object?>;
      expect(status['offered'], isFalse);
      expect(status['running'], isFalse);
      expect(status['finished'], isFalse);
      for (final op in const ['devices', 'approvals', 'emergency', 'recoveryKit', 'twoStep', 'kitMake']) {
        await expectLater(
          core.call('account', [
            <String, Object?>{'op': op},
          ]),
          _failure('notKemlock'),
          reason: op,
        );
      }
      await expectLater(
        core.call('account', [
          <String, Object?>{'op': 'nope'},
        ]),
        _failure(CoreFailure.invalid),
      );
      await expectLater(
        core.call('account', [
          <String, Object?>{'op': 'moveStart'},
        ]),
        _failure(CoreFailure.invalid),
      );
      // A start that was refused leaves no move running, and there is nothing to abandon
      final after =
          (await core.call('account', [
                <String, Object?>{'op': 'moveCancel'},
              ]))!
              as Map<String, Object?>;
      expect(after['running'], isFalse);
      expect(after['held'], isFalse);
      expect((await core.call('syncStatus')), isNull);
      await core.call('lock');
      await expectLater(
        core.call('account', [
          <String, Object?>{'op': 'moveStatus'},
        ]),
        _failure(CoreFailure.locked),
      );
    });

    test('refuses to register on an address that is not https, and when sign-ups are closed', () async {
      final server = _Server();
      server.routes['GET /kem/v1/config'] = (_) => _json({
        'server': 'kemlock-server',
        'apiVersions': ['v1'],
        'serverId': 'id',
        'domain': 'km.example',
        'version': '1',
        'features': <Object?>[],
        'setup': 'complete',
        'signupsAllowed': false,
      });
      final core = await CoreService.start(fakePlatform(MemoryArea(), clientFor: (_) => server.client), const CoreData());
      await core.call('createVault', ['correct horse battery staple']);
      Future<Map<String, Object?>> register(String address, {String? token}) async =>
          (await core.call('account', [
                {
                  'op': 'register',
                  'server': address,
                  'email': 'sam@example.com',
                  'name': '',
                  'password': 'a long enough password',
                  'inviteToken': ?token,
                },
              ]))!
              as Map<String, Object?>;
      expect(await register('http://km.example'), {'step': 'error', 'problem': 'insecure'});
      expect(await register('https://km.example'), {'step': 'error', 'problem': 'signupsClosed'});
    });
  });
}

class _FakeOpaque implements KmOpaque {
  @override
  ({Uint8List request, Object state}) registerStart(Uint8List masterKey) =>
      (request: Uint8List.fromList(List.filled(32, 7)), state: 'state');

  @override
  ({Uint8List upload, Uint8List exportKey}) registerFinish(Object state, Uint8List response) =>
      (upload: Uint8List.fromList(List.filled(40, 9)), exportKey: Uint8List.fromList(List.filled(64, 3)));

  @override
  ({Uint8List request, Object state}) start(Uint8List masterKey) => throw UnimplementedError();

  @override
  ({Uint8List finalization, Uint8List exportKey}) finish(Object state, Uint8List response) => throw UnimplementedError();
}
