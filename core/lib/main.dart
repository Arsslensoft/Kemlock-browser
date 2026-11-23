// The Kemlock extension's core: Kemlock-core's Dart, compiled with `dart compile wasm`, run in the background, and called from
// TypeScript through the one global this registers (src/background/core/wasm.ts, and js/bridge.dart for what it takes).
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'src/js/bridge.dart';

void main() {
  globalContext.setProperty('kemlockCore'.toJS, createJSInteropWrapper(CoreBridge()));
}
