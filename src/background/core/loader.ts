// The declaration of the module below, which the test project (tsconfig.test.json) would not otherwise see
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./core.d.ts" />
// The Dart loader, imported statically: a service worker may not `import()`, so tool/build.mjs keeps this address out of the
// bundle, as 'kemlock-core-wasm', and rewrites it to the file in the extension's own core/ folder (/core/core.mjs).
export { compile, compileStreaming } from 'kemlock-core-wasm'
export type { CompiledApp, InstantiatedApp } from 'kemlock-core-wasm'
