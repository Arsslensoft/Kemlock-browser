// Which core the background runs on: the Dart core compiled to WebAssembly (./wasm), or, in a build
// made with `KEMLOCK_FAKE_CORE=1` (the `__FAKE_CORE__` define), the fake in memory.
// Both imports are static: a service worker may not `import()`.
import type { CoreApi } from '../../shared/api'
import { FakeCore } from './fake'
import { loadCore } from './wasm'

export function loadBackgroundCore(): Promise<CoreApi> {
  if (typeof __FAKE_CORE__ !== 'undefined' && __FAKE_CORE__)
    return Promise.resolve(new FakeCore({ sample: true }))
  return loadCore()
}
