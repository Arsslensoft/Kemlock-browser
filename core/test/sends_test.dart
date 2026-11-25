// Sends in the browser's core: what a page may ask of them, over a fake browser. The making, listing and editing run in Kemlock-core's
// own tests over its fake server; here are the parts this core adds: where Sends are available, a file staged in pieces, a Send opened
// from its link as a recipient (over a fake public route), and what the core lets go of when the vault locks.
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kemlock_core/crypto/account/encoding.dart';
import 'package:kemlock_core/crypto/account/send.dart';
import 'package:kemlock_extension_core/src/core_service.dart';
import 'package:kemlock_extension_core/src/failure.dart';
import 'package:kemlock_extension_core/src/platform.dart';
import 'package:kemlock_extension_core/src/sends.dart';
import 'package:kemlock_extension_core/src/storage_area.dart';
import 'package:test/test.dart';

import 'support.dart';

const password = 'correct horse battery staple';

Matcher failure(String code) => throwsA(isA<CoreFailure>().having((e) => e.code, 'code', code));

/// A fake server's public Send routes, and every request it was asked.
class FakeServer {
  FakeServer();

  final requests = <http.Request>[];
  final sends = <String, ({String kind, Uint8List payload, Uint8List? file})>{};

  Future<http.Response> handle(http.Request request) async {
    requests.add(request);
    final match = RegExp(r'^/kem/v1/send-access/([A-Za-z0-9_-]{22})(/file)?$').firstMatch(request.url.path);
    final send = match == null ? null : sends[match.group(1)];
    if (send == null) return http.Response('{}', 404, headers: {'content-type': 'application/problem+json'});
    if (match!.group(2) != null) {
      return http.Response.bytes(send.file!, 200, headers: {'content-type': 'application/octet-stream'});
    }
    return http.Response(
      jsonEncode({
        'id': match.group(1),
        'kind': send.kind,
        'payload': b64urlEncode(send.payload),
        'deletionAt': 1800000000,
        if (send.file != null) 'fileSize': send.file!.length,
        'senderEmail': 'sam@example.com',
      }),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

/// A Send as its owner made it, planted in [server], and the link that opens it.
Future<String> plant(
  FakeServer server, {
  String kind = 'text',
  String name = 'Wi-Fi',
  String text = 'the password is on the fridge',
  Uint8List? file,
  Uint8List? sealedFor,
}) async {
  final id = newSendId();
  final key = newSendLinkKey();
  final payloadKey = sendPayloadKey(key);
  final payload = kind == 'file'
      ? SendPayload.file(name: name, mime: 'text/plain', size: file!.length)
      : SendPayload.text(name: name, text: text);
  final sealed = await sealSendPart(
    sealLabel: SendLabel.payload,
    key: payloadKey,
    sendId: sealedFor ?? id,
    kind: kind,
    plaintext: payload.encode(),
  );
  final access = sendAccessId(id);
  server.sends[access] = (kind: kind, payload: sealed, file: file == null ? null : await sealSendFile(file, key));
  return 'https://kem.example.com/#/send/$access/${b64urlEncode(key)}';
}

Future<Map<String, Object?>> result(CoreService core, String method, [List<Object?> args = const []]) async =>
    (await core.call(method, args))! as Map<String, Object?>;

void main() {
  late FakeServer server;
  late CoreService core;

  setUp(() async {
    server = FakeServer();
    core = await CoreService.start(fakePlatform(MemoryArea(), clientFor: (_) => MockClient(server.handle)), const CoreData());
    await core.call('createVault', [password]);
  });

  group('the owner\'s Sends', () {
    test('are not available without Kemlock Server sync, and the answer names no place', () async {
      expect(await result(core, 'sendsList'), {
        'ok': true,
        'value': {'available': false, 'place': null},
      });
      expect(await result(core, 'sendsGet', ['x']), {'ok': false, 'problem': 'noSync', 'place': null});
      expect(await result(core, 'sendsLink', ['x']), {'ok': false, 'problem': 'noSync', 'place': null});
      expect(await result(core, 'sendsDelete', ['x']), {'ok': false, 'problem': 'noSync', 'place': null});
      final made = await result(core, 'sendsMake', [
        {'kind': 'text', 'name': 'a', 'text': 'b', 'notes': '', 'deleteInDays': 7},
      ]);
      expect(made, {'ok': false, 'problem': 'noSync', 'place': null});
      expect(server.requests, isEmpty);
    });

    test('need the vault open', () async {
      await core.call('lock');
      await expectLater(core.call('sendsList'), failure(CoreFailure.locked));
      await expectLater(core.call('sendsOpen', ['https://kem.example.com/#/send/x/y']), failure(CoreFailure.locked));
    });

    test('a file is staged in pieces under a handle, refused over the limit, and started over', () async {
      final api = SendsApi(core.vault, core.sync, fileLimit: 10);
      String chunk(int length) => base64Encode(Uint8List(length));
      final first = (await api.call('sendsStageFile', [chunk(6), null]))! as Map<String, Object?>;
      final handle = (first['value']! as Map<String, Object?>)['handle']! as String;
      expect(handle, hasLength(22));
      expect(first['value'], {'handle': handle, 'length': 6});
      expect(await api.call('sendsStageFile', [chunk(4), handle]), {
        'ok': true,
        'value': {'handle': handle, 'length': 10},
      });
      expect(await api.call('sendsStageFile', [chunk(1), handle]), {'ok': false, 'problem': 'invalid', 'reason': 'fileTooBig'});
      // The refusal dropped what was staged: the handle is gone with it
      expect(await api.call('sendsStageFile', [chunk(3), handle]), {'ok': false, 'problem': 'lost'});
      api.unload();
      expect(await api.call('sendsStageFile', [chunk(5), handle]), {'ok': false, 'problem': 'lost'});
    });

    test("two tabs stage two files, and neither meets the other's", () async {
      final api = SendsApi(core.vault, core.sync);
      String chunk(int byte, int length) => base64Encode(Uint8List(length)..fillRange(0, length, byte));
      Future<String> start(int byte, int length) async {
        final answer = (await api.call('sendsStageFile', [chunk(byte, length), null]))! as Map<String, Object?>;
        return (answer['value']! as Map<String, Object?>)['handle']! as String;
      }

      final one = await start(1, 3);
      final two = await start(2, 5);
      expect(one, isNot(two));
      expect(await api.call('sendsStageFile', [chunk(1, 2), one]), {
        'ok': true,
        'value': {'handle': one, 'length': 5},
      });
      expect(await api.call('sendsStageFile', [chunk(2, 1), two]), {
        'ok': true,
        'value': {'handle': two, 'length': 6},
      });
      // Closing one leaves the other
      await api.call('sendsClose', [one]);
      expect(await api.call('sendsStageFile', [chunk(1, 1), one]), {'ok': false, 'problem': 'lost'});
      expect(await api.call('sendsStageFile', [chunk(2, 1), two]), {
        'ok': true,
        'value': {'handle': two, 'length': 7},
      });
    });

    test('a file Send is refused when what is staged is not the size the page counted, or a handle is not known', () async {
      final api = SendsApi(core.vault, core.sync);
      final answer = (await api.call('sendsStageFile', [base64Encode(Uint8List(4)), null]))! as Map<String, Object?>;
      final handle = (answer['value']! as Map<String, Object?>)['handle']! as String;
      Map<String, Object?> file(Object? handle, int size) => {
        'kind': 'file',
        'name': 'a',
        'notes': '',
        'deleteInDays': 7,
        'handle': handle,
        'size': size,
      };
      expect(await api.call('sendsMake', [file('nope', 4)]), {'ok': false, 'problem': 'lost'});
      expect(await api.call('sendsMake', [file(handle, 5)]), {'ok': false, 'problem': 'lost'});
      // The mismatch dropped the staging
      expect(await api.call('sendsStageFile', [base64Encode(Uint8List(1)), handle]), {'ok': false, 'problem': 'lost'});
    });

    test('a file Send needs a file staged, and a text Send its text', () async {
      await expectLater(
        core.call('sendsMake', [
          {'kind': 'text', 'name': 'a', 'notes': '', 'deleteInDays': 7},
        ]),
        failure(CoreFailure.invalid),
      );
    });
  });

  group('opening a Send', () {
    test('shows the text, from the link\'s key alone, and asks the server for the access id only', () async {
      final link = await plant(server);
      final opened = await result(core, 'sendsOpen', [link]);
      expect(opened['ok'], isTrue);
      final value = opened['value']! as Map<String, Object?>;
      expect(value['kind'], 'text');
      expect(value['name'], 'Wi-Fi');
      expect(value['text'], 'the password is on the fridge');
      expect(value['host'], 'kem.example.com');
      expect(value['senderEmail'], 'sam@example.com');
      expect(value['deletionAt'], 1800000000000);
      final key = link.split('/').last;
      for (final request in server.requests) {
        expect(request.method, 'POST');
        expect(request.url.toString(), isNot(contains(key)));
        expect(request.headers.keys.map((name) => name.toLowerCase()), isNot(contains('authorization')));
        expect(request.headers.keys.map((name) => name.toLowerCase()), isNot(contains('dpop')));
        expect(request.body, isNot(contains(key)));
      }
      expect(await core.call('sendsReceivedText', [value['handle']]), 'the password is on the fridge');
    });

    test('finds a link in a message, and refuses what is not one before any request', () async {
      final link = await plant(server);
      expect((await result(core, 'sendsOpen', ['Here you go: <$link>.']))['ok'], isTrue);
      server.requests.clear();
      expect(await result(core, 'sendsOpen', ['hello']), {'ok': false, 'problem': 'badLink'});
      expect(await result(core, 'sendsOpen', [link.replaceFirst('https', 'http')]), {'ok': false, 'problem': 'badLink'});
      // A Bitwarden Send: its key is 16 bytes
      final bitwarden = 'https://kem.example.com/#/send/${sendAccessId(newSendId())}/${b64urlEncode(Uint8List(16))}';
      expect(await result(core, 'sendsOpen', [bitwarden]), {'ok': false, 'problem': 'bitwarden'});
      expect(server.requests, isEmpty);
    });

    test('says a closed Send is not available, and one sealed for another id does not open', () async {
      final link = await plant(server);
      server.sends.clear();
      expect(await result(core, 'sendsOpen', [link]), {'ok': false, 'problem': 'notFound'});
      final other = await plant(server, sealedFor: newSendId());
      expect(await result(core, 'sendsOpen', [other]), {'ok': false, 'problem': 'doesntOpen'});
      await expectLater(core.call('sendsReceivedText', ['nope']), failure(CoreFailure.notFound));
    });

    test("two tabs open two Sends, and one tab's handle opens nothing of the other's", () async {
      final first = (await result(core, 'sendsOpen', [await plant(server, text: 'first')]))['value']! as Map<String, Object?>;
      final second = (await result(core, 'sendsOpen', [await plant(server, text: 'second')]))['value']! as Map<String, Object?>;
      expect(first['handle'], isNot(second['handle']));
      expect(await core.call('sendsReceivedText', [first['handle']]), 'first');
      expect(await core.call('sendsReceivedText', [second['handle']]), 'second');
      await core.call('sendsClose', [first['handle']]);
      await expectLater(core.call('sendsReceivedText', [first['handle']]), failure(CoreFailure.notFound));
      expect(await core.call('sendsReceivedText', [second['handle']]), 'second');
    });

    test('lets go of the oldest Send when too many are open', () async {
      final handles = <Object?>[];
      for (var i = 0; i < 5; i++) {
        final opened = (await result(core, 'sendsOpen', [await plant(server, text: 't$i')]))['value']! as Map<String, Object?>;
        handles.add(opened['handle']);
      }
      await expectLater(core.call('sendsReceivedText', [handles.first]), failure(CoreFailure.notFound));
      expect(await core.call('sendsReceivedText', [handles.last]), 't4');
    });

    test('a download of a Send that was closed meanwhile is lost, not held', () async {
      final plain = Uint8List.fromList(List.generate(100, (i) => i));
      final link = await plant(server, kind: 'file', name: 'a.bin', file: plain);
      final handle = ((await result(core, 'sendsOpen', [link]))['value']! as Map<String, Object?>)['handle'];
      await core.call('sendsClose', [handle]);
      expect(await result(core, 'sendsDownload', [handle]), {'ok': false, 'problem': 'lost'});
    });

    test('a file is fetched when asked, held in the core and read in pieces, and is let go on close', () async {
      final plain = Uint8List.fromList(List.generate(2500000, (i) => (i * 7) & 0xff));
      final link = await plant(server, kind: 'file', name: 'scan.txt', file: plain);
      final opened = (await result(core, 'sendsOpen', [link]))['value']! as Map<String, Object?>;
      final handle = opened['handle'];
      expect(opened['kind'], 'file');
      expect(opened['name'], 'scan.txt');
      expect(opened['mime'], 'text/plain');
      expect(opened['size'], plain.length);
      expect(opened['tooBig'], isFalse);
      expect(opened.containsKey('text'), isFalse);
      // Opening spent no file download
      expect(server.requests.where((request) => request.url.path.endsWith('/file')), isEmpty);
      await expectLater(core.call('sendsReadFile', [handle, 0]), failure(CoreFailure.notFound));
      expect(await result(core, 'sendsDownload', [handle]), {
        'ok': true,
        'value': {'size': plain.length},
      });
      // A second ask uses the bytes held
      await core.call('sendsDownload', [handle]);
      expect(server.requests.where((request) => request.url.path.endsWith('/file')), hasLength(1));
      final pieces = <int>[];
      for (var index = 0; ; index++) {
        final piece = (await core.call('sendsReadFile', [handle, index]))! as String;
        if (piece.isEmpty) break;
        pieces.addAll(base64Decode(piece));
      }
      expect(pieces, plain);
      await core.call('sendsClose', [handle]);
      await expectLater(core.call('sendsReadFile', [handle, 0]), failure(CoreFailure.notFound));
    });

    test('is dropped when the vault locks, and what it held with it', () async {
      final link = await plant(server);
      final handle = ((await result(core, 'sendsOpen', [link]))['value']! as Map<String, Object?>)['handle'];
      await core.call('lock');
      await core.call('unlock', [password]);
      await expectLater(core.call('sendsReceivedText', [handle]), failure(CoreFailure.notFound));
    });
  });
}
