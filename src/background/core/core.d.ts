// The module `dart compile wasm` writes beside the core's .wasm (tool/build.mjs puts both in core/ of each browser's folder),
// as Dart 3.6 and later write it: the module is compiled once, then instantiated, then its `main` runs.
declare module 'kemlock-core-wasm' {
  export interface InstantiatedApp {
    invokeMain(...args: unknown[]): unknown
  }
  export interface CompiledApp {
    instantiate(additionalImports?: Record<string, unknown>): Promise<InstantiatedApp>
  }
  export function compileStreaming(
    source: Response | Promise<Response>,
    builtins?: Record<string, unknown>,
  ): Promise<CompiledApp>
  export function compile(
    bytes: BufferSource,
    builtins?: Record<string, unknown>,
  ): Promise<CompiledApp>
}
