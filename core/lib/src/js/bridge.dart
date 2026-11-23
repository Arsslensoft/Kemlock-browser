// The core's face to JavaScript. The module registers one global, `kemlockCore`, with two methods (src/background/core/wasm.ts
// loads the module and wraps them as `CoreApi`):
//
// - `init(host)`: the background's object, with the callbacks (`launchWebAuthFlow`, `cancelWebAuthFlow`, `passkeyAssertion`),
//   `version`, `sessionKey` (base64, 32 bytes, kept in `storage.session`), `redirectUrl`, optionally `browser`
//   (`chrome`, `edge` or `firefox`; else read from the user agent), and the files it read from the extension's own files
//   (`publicSuffixList`, `wordList`, `twoFactorDirectory`, as text). Answers a promise.
// - `call(method, argsJson)`: a `CoreApi` method with its arguments as a JSON array. Answers a promise of JSON text, always an
//   envelope: `{"ok": true, "value": …}` or `{"ok": false, "error": {"code", "message"}}`, so no failure crosses as an exception.
import 'dart:convert';
import 'dart:js_interop';

import 'package:http/http.dart' as http;
import 'package:kemlock_core/crypto/bytes.dart';

import '../browser.dart';
import '../core_service.dart';
import '../failure.dart';
import '../platform.dart';
import '../storage_area.dart';
import 'chrome_storage.dart';
import 'device_keys.dart';
import 'fetch_client.dart';
import 'globals.dart';
import 'host.dart';

String _ok(Object? value) => jsonEncode({'ok': true, 'value': value});

String _failed(Object error) {
  final (code, message) = switch (error) {
    CoreFailure(:final code, :final message) => (code, message),
    http.ClientException() => ('network', error.message),
    _ => (CoreFailure.failed, '$error'),
  };
  return jsonEncode({
    'ok': false,
    'error': {'code': code, 'message': message},
  });
}

/// Runs [run] to its envelope.
Future<String> answer(Future<Object?> Function() run) async {
  try {
    return _ok(await run());
  } catch (error) {
    return _failed(error);
  }
}

/// What JavaScript calls.
@JSExport()
class CoreBridge {
  CoreService? _service;

  JSPromise<JSString> init(JSObject object) => (() async {
    return (await answer(() async {
      final host = Host(object);
      final key = host.string('sessionKey');
      if (key == null) throw const CoreFailure(CoreFailure.invalid, 'no session key');
      final redirect = host.string('redirectUrl');
      final platform = CorePlatform(
        storage: AreaPreferences(ChromeStorageArea.local()),
        clientFor: (_) => FetchClient(),
        deviceKeys: WebCryptoDeviceKeys(),
        browserAuth: IdentityBrowserAuth(host),
        passkeys: host.has('passkeyAssertion') ? PagePasskeys(host) : null,
        ssoRedirect: redirect == null || redirect.isEmpty ? null : Uri.tryParse(redirect),
        browser: Browser.named(host.string('browser')) ?? Browser.fromUserAgent(userAgent()),
        sessionKey: unb64(key),
        decodeImage: decodeImage,
        version: host.string('version') ?? '0.0.0',
      );
      final data = CoreData(
        publicSuffixList: host.string('publicSuffixList'),
        wordList: host.string('wordList'),
        twoFactorDirectory: host.string('twoFactorDirectory'),
      );
      _service = await CoreService.start(platform, data);
      return null;
    })).toJS;
  })().toJS;

  JSPromise<JSString> call(JSString method, JSString argsJson) => (() async {
    return (await answer(() async {
      final service = _service;
      if (service == null) throw const CoreFailure(CoreFailure.failed, 'the core is not initialised');
      final args = jsonDecode(argsJson.toDart);
      return service.call(method.toDart, args is List<Object?> ? args : const []);
    })).toJS;
  })().toJS;
}
