// The browser's globals as the background sees them, in a service worker (no `window`) as in Firefox's event page: the
// extension's API object (`browser`, else `chrome`), WebCrypto and IndexedDB from the global scope.
import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:web/web.dart' as web;

/// The WebExtensions API: `browser` where there is one (Firefox, and its promises), else `chrome` (whose MV3 calls return
/// promises too).
JSObject extensionApi() {
  for (final name in const ['browser', 'chrome']) {
    final api = globalContext.getProperty<JSAny?>(name.toJS);
    if (api.isDefinedAndNotNull) return api! as JSObject;
  }
  throw StateError('this is not a browser extension');
}

/// The global scope's `crypto`.
@JS('crypto')
external web.Crypto get globalCrypto;

/// The global scope's `indexedDB`.
@JS('indexedDB')
external web.IDBFactory get globalIndexedDb;

/// The browser's `navigator.userAgent`, from the global scope (a worker has a `navigator` too).
String userAgent() {
  final navigator = globalContext.getProperty<JSAny?>('navigator'.toJS);
  if (!navigator.isDefinedAndNotNull) return '';
  final agent = (navigator! as JSObject).getProperty<JSAny?>('userAgent'.toJS);
  return agent.isDefinedAndNotNull ? (agent! as JSString).toDart : '';
}

/// Waits for an IndexedDB request and gives its result.
Future<JSAny?> awaitRequest(web.IDBRequest request) {
  final done = Completer<JSAny?>();
  request.onsuccess = ((web.Event _) {
    if (!done.isCompleted) done.complete(request.result);
  }).toJS;
  request.onerror = ((web.Event _) {
    if (!done.isCompleted) done.completeError(StateError(request.error?.message ?? 'IndexedDB request failed'));
  }).toJS;
  return done.future;
}
