// An `http.Client` over the global `fetch` (design decision 2): a service worker has no `XMLHttpRequest`, and a sync file must
// never come from the browser's cache, nor carry a cookie of the server's. So each request says `cache: 'no-store'` and
// `credentials: 'omit'`, and the custom methods WebDAV uses (PROPFIND, MKCOL) go as they are. Whether a request may reach the
// server is the host permission the person granted at setup.
import 'dart:async';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:http/http.dart';
import 'package:web/web.dart' as web;

@JS('fetch')
external JSPromise<web.Response> _fetch(JSString input, [web.RequestInit init]);

/// The response's headers, which `forEach` walks with the value first.
extension type _IterableHeaders._(JSObject _) implements web.Headers {
  external void forEach(JSFunction callback);
}

/// `fetch`, as an `http.Client`.
class FetchClient extends BaseClient {
  var _closed = false;
  final _controllers = <web.AbortController>{};

  @override
  Future<StreamedResponse> send(BaseRequest request) async {
    if (_closed) throw ClientException('HTTP request failed. Client is already closed.', request.url);
    final controller = web.AbortController();
    _controllers.add(controller);
    final body = await request.finalize().toBytes();
    try {
      if (request case Abortable(:final abortTrigger?)) {
        unawaited(abortTrigger.whenComplete(() => controller.abort()));
      }
      final response = await _fetch(
        '${request.url}'.toJS,
        web.RequestInit(
          method: request.method,
          body: body.isNotEmpty ? body.toJS : null,
          cache: 'no-store',
          credentials: 'omit',
          headers: {for (final header in request.headers.entries) header.key: header.value}.jsify()! as web.HeadersInit,
          signal: controller.signal,
          redirect: request.followRedirects ? 'follow' : 'manual',
        ),
      ).toDart;
      final headers = <String, String>{};
      (response.headers as _IterableHeaders).forEach(
        (String value, String name, [JSAny? _]) {
          headers[name.toLowerCase()] = value;
        }.toJS,
      );
      final bytes = (await response.arrayBuffer().toDart).toDart.asUint8List();
      return StreamedResponse(
        ByteStream.fromBytes(Uint8List.fromList(bytes)),
        response.status,
        contentLength: bytes.length,
        request: request,
        headers: headers,
        isRedirect: response.redirected,
        reasonPhrase: response.statusText,
      );
    } catch (error, stack) {
      Error.throwWithStackTrace(_asClientException(error, request), stack);
    } finally {
      _controllers.remove(controller);
    }
  }

  /// Ends every request still going, and refuses new ones.
  @override
  void close() {
    for (final controller in _controllers) {
      controller.abort();
    }
    _closed = true;
  }

  Object _asClientException(Object error, BaseRequest request) {
    if (error is ClientException) return error;
    if (error case web.DOMException(name: 'AbortError')) return RequestAbortedException(request.url);
    var message = error.toString();
    if (message.startsWith('TypeError: ')) message = message.substring('TypeError: '.length);
    return ClientException(message, request.url);
  }
}
