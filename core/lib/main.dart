// The Kemlock extension's core: Kemlock-core's Dart, compiled with `dart compile wasm`, run in the background, and called from
// TypeScript through the one global this registers (src/background/core/wasm.ts, and js/bridge.dart for what it takes).
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart';

import 'src/js/bridge.dart';

void main() {
  // package:cryptography's browser implementation reads window.isSecureContext, and a service worker has no window, so
  // every call through it threw. The pure-Dart implementation is the one the app runs on the phone: the same bytes, no global.
  Cryptography.freezeInstance(DartCryptography.defaultInstance);
  globalContext.setProperty('kemlockCore'.toJS, createJSInteropWrapper(CoreBridge()));
}
