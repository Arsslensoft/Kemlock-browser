/**
 * Set by tool/build.mjs: true when `KEMLOCK_FAKE_CORE=1`, so the build runs on `FakeCore`
 * (src/background/core/fake.ts) in place of the Dart core. A test or a release has it false or unset.
 */
declare const __FAKE_CORE__: boolean | undefined
