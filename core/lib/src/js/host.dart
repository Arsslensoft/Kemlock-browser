// What the background gives the core as callbacks (src/background/core/wasm.ts): the browser's sign-in flow for SSO, the
// page that asks a passkey, and nothing else. A callback is a property of the `host` object given to `init`, and answers a
// promise. The one thing the core does for itself is decoding an image for the QR reader, through an offscreen canvas.
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import 'package:kemlock_core/crypto/bytes.dart';
import 'package:kemlock_core/features/sync/kemlock/km_auth_api.dart';
import 'package:kemlock_core/features/sync/kemlock/km_passkey.dart';
import 'package:kemlock_core/features/sync/kemlock/km_signin.dart';
import 'package:kemlock_core/features/sync/kemlock/km_sso.dart';
import 'package:web/web.dart' as web;

import '../platform.dart';

@JS('createImageBitmap')
external JSPromise<web.ImageBitmap> _createImageBitmap(web.Blob blob);

@JS('fetch')
external JSPromise<web.Response> _fetch(JSString input);

/// The `host` object the background gave.
class Host {
  Host(this._object);

  final JSObject _object;

  bool has(String name) => _object.getProperty<JSAny?>(name.toJS).isA<JSFunction>();

  String? string(String name) {
    final value = _object.getProperty<JSAny?>(name.toJS);
    return value.isA<JSString>() ? (value! as JSString).toDart : null;
  }

  /// Calls the callback [name], which answers a promise of a string (or nothing).
  Future<String?> call(String name, List<String> args) async {
    final result = await _object.callMethodVarArgs<JSPromise<JSAny?>>(name.toJS, [for (final arg in args) arg.toJS]).toDart;
    return result.isA<JSString>() ? (result! as JSString).toDart : null;
  }
}

/// SSO through `identity.launchWebAuthFlow`. The browser ends the trip at its own address (`https://<id>.chromiumapp.org/`),
/// which the server allows for a `kemlock-browser` device; the engine reads the redirect as `kemlock://sso`, so the address's
/// query is handed back under that.
class IdentityBrowserAuth implements KmBrowserAuth {
  IdentityBrowserAuth(this._host);

  final Host _host;

  @override
  Future<Uri?> authenticate(Uri url, {required String state}) async {
    if (!_host.has('launchWebAuthFlow')) throw const KmBrowserFailure('the browser gave no sign-in flow');
    final String? redirect;
    try {
      redirect = await _host.call('launchWebAuthFlow', [url.toString()]);
    } catch (error) {
      throw KmBrowserFailure('$error');
    }
    if (redirect == null || redirect.isEmpty) return null;
    final back = Uri.tryParse(redirect);
    if (back == null) throw const KmBrowserFailure('the browser gave an address that is none');
    return Uri(scheme: 'kemlock', host: 'sso', queryParameters: back.queryParameters);
  }

  @override
  Future<void> cancel() async {
    if (_host.has('cancelWebAuthFlow')) await _host.call('cancelWebAuthFlow', const []);
  }
}

/// A passkey or security key with its PRF, asked by the background in a page of the extension on the server's own address
/// (WebAuthn needs a page, not a service worker). The options go as JSON, and the assertion comes back as JSON, every binary
/// value base64url.
class PagePasskeys implements KmPasskeyAsserter {
  PagePasskeys(this._host);

  final Host _host;

  @override
  Future<KmPasskeyAssertion> assertion(KmPasskeyOptions options, Uint8List prfInput, Uri server) async {
    final String? answer;
    try {
      answer = await _host.call('passkeyAssertion', [
        jsonEncode({
          'challenge': b64url(options.challenge),
          'rpId': options.rpId,
          'credentialIds': [for (final id in options.credentialIds) b64url(id)],
          'userVerification': options.userVerification,
          'prfInput': b64url(prfInput),
        }),
        server.toString(),
      ]);
    } catch (error) {
      throw KmSignInError(KmSignInIssue.ssoFailed, detail: '$error');
    }
    // The person closed the page or dismissed the prompt
    if (answer == null) throw const KmSignInError(KmSignInIssue.cancelled);
    final json = jsonDecode(answer);
    if (json is! Map<String, Object?>) throw const FormatException('the passkey page gave no assertion');
    Uint8List bytes(String name) => unb64url(json[name]! as String);
    return KmPasskeyAssertion(
      credentialId: bytes('credentialId'),
      authenticatorData: bytes('authenticatorData'),
      clientData: bytes('clientData'),
      signature: bytes('signature'),
      userHandle: json['userHandle'] is String ? bytes('userHandle') : null,
      prfOutput: json['prfOutput'] is String ? bytes('prfOutput') : null,
    );
  }
}

/// The longest side of an image the QR reader is given, in pixels: bigger ones are scaled down.
const _longestSide = 2048;

/// An image's pixels from a data URL, through `createImageBitmap` and an offscreen canvas (a service worker has no DOM).
Future<Pixels?> decodeImage(String dataUrl) async {
  final response = await _fetch(dataUrl.toJS).toDart;
  final bitmap = await _createImageBitmap(await response.blob().toDart).toDart;
  try {
    final scale = (bitmap.width > bitmap.height ? bitmap.width : bitmap.height) > _longestSide
        ? _longestSide / (bitmap.width > bitmap.height ? bitmap.width : bitmap.height)
        : 1.0;
    final width = (bitmap.width * scale).round();
    final height = (bitmap.height * scale).round();
    if (width <= 0 || height <= 0) return null;
    final canvas = web.OffscreenCanvas(width, height);
    final context = canvas.getContext('2d')! as web.OffscreenCanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0, width, height);
    final rgba = context.getImageData(0, 0, width, height).data.toDart;
    final argb = Int32List(width * height);
    for (var i = 0; i < argb.length; i++) {
      final at = i * 4;
      argb[i] = (rgba[at + 3] << 24) | (rgba[at] << 16) | (rgba[at + 1] << 8) | rgba[at + 2];
    }
    return (width: width, height: height, argb: argb);
  } finally {
    bitmap.close();
  }
}
